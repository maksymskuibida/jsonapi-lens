import { describe, expect, it } from "vitest";
import {
  detectCredentialShape,
  decodeJwt,
  isSecretHeaderName,
  redactExchange,
  REDACTED_VALUE,
  shouldMaskHeader,
} from "../src/secrets.js";
import type { Exchange } from "../src/exchange.js";
import { headerSet } from "../src/headers.js";

/**
 * A JWT built independently of `src/params.ts#bytesToBase64Url`, so this test
 * is not validated by the very encoder it is meant to exercise — only
 * `decodeJwt`'s own `base64UrlToBytes` is under test here.
 */
function makeJwt(header: unknown, payload: unknown, signature = "sig"): string {
  const seg = (value: unknown) =>
    btoa(JSON.stringify(value))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  return `${seg(header)}.${seg(payload)}.${signature}`;
}

describe("isSecretHeaderName", () => {
  it("matches every name in the spec's list, case-insensitively", () => {
    for (const name of [
      "Authorization",
      "AUTHORIZATION",
      "Proxy-Authorization",
      "Cookie",
      "Set-Cookie",
      "X-Api-Key",
      "api-key",
      "X-Auth-Token",
    ]) {
      expect(isSecretHeaderName(name)).toBe(true);
    }
  });

  it("does not flag an ordinary header", () => {
    expect(isSecretHeaderName("Content-Type")).toBe(false);
    expect(isSecretHeaderName("Accept")).toBe(false);
  });
});

describe("detectCredentialShape", () => {
  it("recognises a JWT shape — three base64url segments — without decoding it", () => {
    expect(detectCredentialShape("abc.def.ghi")).toEqual({ kind: "jwt" });
    expect(detectCredentialShape("Bearer abc.def.ghi")).toEqual({ kind: "jwt" });
  });

  it("recognises sk_/pk_-prefixed keys", () => {
    expect(detectCredentialShape("sk_live_4242424242424242")).toEqual({ kind: "stripe-key" });
    expect(detectCredentialShape("pk_test_abcdef123456")).toEqual({ kind: "stripe-key" });
  });

  it("recognises a long hex run", () => {
    const hex = "a".repeat(40);
    expect(detectCredentialShape(hex)).toEqual({ kind: "hex", length: 40 });
  });

  it("recognises a long base64-ish run that is not hex", () => {
    const value = "QWxhZGRpbjpvcGVuIHNlc2FtZS1sb25nZXItdG9rZW4"; // > 24 chars, not hex
    expect(detectCredentialShape(value)).toEqual({ kind: "base64", length: value.length });
  });

  it("does not flag short or ordinary values", () => {
    expect(detectCredentialShape("application/json")).toBeNull();
    expect(detectCredentialShape("42")).toBeNull();
    expect(detectCredentialShape("")).toBeNull();
    expect(detectCredentialShape("short")).toBeNull();
  });
});

describe("shouldMaskHeader", () => {
  it("masks by name even when the value looks ordinary", () => {
    expect(shouldMaskHeader("Authorization", "hello")).toBe(true);
  });

  it("masks by value shape even under an unlisted header name", () => {
    expect(shouldMaskHeader("X-Session", "abc.def.ghi")).toBe(true);
  });

  it("leaves an ordinary header/value pair alone", () => {
    expect(shouldMaskHeader("Content-Type", "application/json")).toBe(false);
  });
});

describe("decodeJwt", () => {
  it("decodes header and payload, and marks an exp in the past as expired", () => {
    const jwt = makeJwt(
      { alg: "HS256", typ: "JWT" },
      { sub: "user-1", iss: "https://issuer.example.com", scope: "read", exp: Math.floor(Date.now() / 1000) - 3600 },
    );
    const decoded = decodeJwt(jwt);
    expect(decoded).not.toBeNull();
    expect(decoded?.header).toEqual({ alg: "HS256", typ: "JWT" });
    expect(decoded?.payload.sub).toBe("user-1");
    expect(decoded?.payload.iss).toBe("https://issuer.example.com");
    expect(decoded?.payload.scope).toBe("read");
    expect(decoded?.expired).toBe(true);
  });

  it("marks an exp in the future as not expired", () => {
    const jwt = makeJwt({ alg: "HS256" }, { exp: Math.floor(Date.now() / 1000) + 3600 });
    expect(decodeJwt(jwt)?.expired).toBe(false);
  });

  it("judges expiry against an explicit reference time, not only Date.now()", () => {
    const exp = 1_700_000_000; // a fixed point in the past relative to "now"
    const jwt = makeJwt({}, { exp });
    expect(decodeJwt(jwt, (exp - 10) * 1000)?.expired).toBe(false); // reference is before exp
    expect(decodeJwt(jwt, (exp + 10) * 1000)?.expired).toBe(true); // reference is after exp
  });

  it("strips a Bearer prefix before decoding", () => {
    const jwt = makeJwt({ alg: "none" }, { sub: "x" });
    expect(decodeJwt(`Bearer ${jwt}`)?.payload.sub).toBe("x");
  });

  it("has no expired/expiresAt fields when there is no exp claim", () => {
    const jwt = makeJwt({}, { sub: "x" });
    const decoded = decodeJwt(jwt);
    expect(decoded?.expiresAt).toBeUndefined();
    expect(decoded?.expired).toBeUndefined();
  });

  it("a non-JWT bearer value is not decoded and does not throw", () => {
    expect(() => decodeJwt("just-an-opaque-token")).not.toThrow();
    expect(decodeJwt("just-an-opaque-token")).toBeNull();
    expect(() => decodeJwt("Bearer just-an-opaque-token")).not.toThrow();
    expect(decodeJwt("Bearer just-an-opaque-token")).toBeNull();
  });

  it("a value with three dot-separated segments that are not valid base64url JSON does not throw", () => {
    expect(() => decodeJwt("abc.def.ghi")).not.toThrow();
    expect(decodeJwt("abc.def.ghi")).toBeNull();
  });

  it("a segment whose length makes base64 padding impossible (atob itself throws) is caught, not propagated", () => {
    // Base64 length ≡ 1 (mod 4) cannot be fixed by padding and makes `atob`
    // throw — a single-character segment hits this directly.
    expect(() => decodeJwt("a.b.c")).not.toThrow();
    expect(decodeJwt("a.b.c")).toBeNull();
  });

  it("rejects anything that is not exactly three segments", () => {
    expect(decodeJwt("only.two")).toBeNull();
    expect(decodeJwt("a.b.c.d")).toBeNull();
    expect(decodeJwt("")).toBeNull();
  });
});

describe("redactExchange", () => {
  it("removes an Authorization value from the Copy/Download/Share payload, with a count", () => {
    const secret = "sk_live_super_secret_value_1234567890";
    const exchange: Exchange = {
      request: { headers: headerSet([{ name: "Authorization", value: `Bearer ${secret}` }]) },
    };
    const { exchange: redacted, count } = redactExchange(exchange);
    expect(count).toBe(1);
    expect(JSON.stringify(redacted)).not.toContain(secret);
    expect(redacted.request?.headers?.entries[0]).toEqual({ name: "Authorization", value: REDACTED_VALUE });
  });

  it("leaves ordinary headers untouched and counts only what it redacted", () => {
    const exchange: Exchange = {
      request: {
        headers: headerSet([
          { name: "Accept", value: "application/json" },
          { name: "Authorization", value: "Bearer abc" },
        ]),
      },
    };
    const { exchange: redacted, count } = redactExchange(exchange);
    expect(count).toBe(1);
    expect(redacted.request?.headers?.entries[0]).toEqual({ name: "Accept", value: "application/json" });
  });

  it("redacts request cookie values and response Set-Cookie values, keeping names and attributes", () => {
    const exchange: Exchange = {
      request: { cookies: { entries: [{ name: "session_id", value: "abc123secret" }] } },
      response: {
        cookies: { entries: [{ name: "session_id", value: "xyz789secret", path: "/", httpOnly: true }] },
      },
    };
    const { exchange: redacted, count } = redactExchange(exchange);
    expect(count).toBe(2);
    expect(redacted.request?.cookies?.entries[0]).toEqual({ name: "session_id", value: REDACTED_VALUE });
    expect(redacted.response?.cookies?.entries[0]).toEqual({
      name: "session_id",
      value: REDACTED_VALUE,
      path: "/",
      httpOnly: true,
    });
    expect(JSON.stringify(redacted)).not.toContain("abc123secret");
    expect(JSON.stringify(redacted)).not.toContain("xyz789secret");
  });

  it("masks a credential-shaped value even under a header name not on the known list", () => {
    const jwt = makeJwt({ alg: "none" }, { sub: "x" });
    const exchange: Exchange = { response: { headers: headerSet([{ name: "X-Session-Token", value: jwt }]) } };
    const { count } = redactExchange(exchange);
    expect(count).toBe(1);
  });

  it("counts zero and changes nothing when there is nothing to redact", () => {
    const exchange: Exchange = { request: { method: "GET", headers: headerSet([{ name: "Accept", value: "*/*" }]) } };
    const { exchange: redacted, count } = redactExchange(exchange);
    expect(count).toBe(0);
    expect(redacted).toEqual(exchange);
  });

  it("does not mutate the exchange it was given", () => {
    const original: Exchange = { request: { headers: headerSet([{ name: "Authorization", value: "Bearer x" }]) } };
    const snapshot = JSON.parse(JSON.stringify(original));
    redactExchange(original);
    expect(original).toEqual(snapshot);
  });

  it("leaves the URL, query parameters and body untouched — out of this function's scope", () => {
    const exchange: Exchange = {
      request: {
        url: "https://api.example.com/x?token=sk_live_abcdefghijklmnop",
        body: { raw: "authorization=Bearer abc" },
      },
    };
    const { exchange: redacted } = redactExchange(exchange);
    expect(redacted.request?.url).toBe(exchange.request?.url);
    expect(redacted.request?.body).toEqual(exchange.request?.body);
  });
});
