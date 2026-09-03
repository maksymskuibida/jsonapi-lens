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
import { decodeParams, findParam } from "../src/params.js";

/**
 * A JWT built independently of `src/params.ts#bytesToBase64Url`, so this test
 * is not validated by the very encoder it is meant to exercise — only
 * `decodeJwt`'s own `base64UrlToBytes` is under test here.
 */
function makeJwt(
  header: unknown,
  payload: unknown,
  signature = "s1gnatur3_not_verified_but_realistically_long",
): string {
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
    expect(detectCredentialShape("sk_test_4242424242424242")).toEqual({ kind: "stripe-key" });
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
    const secret = "sk_test_super_secret_value_1234567890";
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

  it("redacts a credential in the URL's query string by rewriting the URL itself, not by leaving a scrubbed copy beside the original", () => {
    const secret = "sk_test_FAKE_NOT_REAL_1234567890_abcXYZ";
    const exchange: Exchange = {
      request: { url: `https://api.example.com/v1/charge?amount=100&api_key=${secret}` },
    };
    const { exchange: redacted, count } = redactExchange(exchange);
    expect(count).toBe(1);
    expect(redacted.request?.url).not.toContain(secret);
    expect(redacted.request?.url).toContain("amount=100");
    expect(redacted.request?.url).toMatch(/^https:\/\/api\.example\.com\/v1\/charge\?/);
    expect(JSON.stringify(redacted)).not.toContain(secret);
  });

  it("redacts a query parameter by name even when its value looks ordinary", () => {
    for (const name of ["access_token", "X-Secret", "signature", "sig", "user_password"]) {
      const url = `https://api.example.com/x?${name}=hello&other=1`;
      const { exchange: redacted, count } = redactExchange({ request: { url } });
      expect(count).toBe(1);
      expect(redacted.request?.url).toContain("other=1");
      expect(redacted.request?.url).not.toContain(`${name}=hello`);
    }
  });

  it("redacts a query parameter by value shape even when its name is innocuous", () => {
    const jwt = makeJwt({ alg: "none" }, { sub: "x" });
    const url = `https://api.example.com/x?ref=${encodeURIComponent(jwt)}&page=2`;
    const { exchange: redacted, count } = redactExchange({ request: { url } });
    expect(count).toBe(1);
    expect(redacted.request?.url).not.toContain(jwt);
    expect(redacted.request?.url).toContain("page=2");
  });

  it("preserves a URL fragment and a query-free URL", () => {
    const secret = "sk_test_FAKE_NOT_REAL_1234567890_abcXYZ";
    const withFragment = redactExchange({
      request: { url: `https://api.example.com/x?api_key=${secret}#section` },
    }).exchange.request?.url;
    expect(withFragment).not.toContain(secret);
    expect(withFragment).toMatch(/#section$/);

    const noQuery = "https://api.example.com/x";
    expect(redactExchange({ request: { url: noQuery } }).exchange.request?.url).toBe(noQuery);
  });

  it("redacts RequestPart.query the same way as the URL, independent of it", () => {
    const secret = "sk_test_FAKE_NOT_REAL_1234567890_abcXYZ";
    const exchange: Exchange = { request: { query: decodeParams(`amount=100&api_key=${secret}`) } };
    const { exchange: redacted, count } = redactExchange(exchange);
    expect(count).toBe(1);
    expect(JSON.stringify(redacted)).not.toContain(secret);
    const query = redacted.request!.query!;
    expect(findParam(query, "amount")?.value).toBe("100");
    expect(findParam(query, "api_key")?.value).toBe(REDACTED_VALUE);
  });

  it("fully redacts a form-urlencoded body, rewriting raw from the redacted form rather than leaving it stale", () => {
    const secret = "sk_test_FAKE_NOT_REAL_1234567890_abcXYZ";
    const rawForm = `amount=100&api_key=${secret}`;
    const exchange: Exchange = {
      request: {
        body: { raw: rawForm, contentType: "application/x-www-form-urlencoded", form: decodeParams(rawForm) },
      },
    };
    const { exchange: redacted, count, bodyMayContainSecret } = redactExchange(exchange);
    expect(count).toBe(1);
    expect(bodyMayContainSecret).toBe(false);
    expect(redacted.request?.body?.raw).not.toContain(secret);
    expect(redacted.request?.body?.raw).toContain("amount=100");
    expect(JSON.stringify(redacted)).not.toContain(secret);
  });

  it("flags, but does not alter, a non-form body containing a credential-shaped value", () => {
    const secret = "sk_test_FAKE_NOT_REAL_1234567890_abcXYZ";
    const raw = `{"amount":100,"api_key":"${secret}"}`;
    const exchange: Exchange = { request: { body: { raw, contentType: "application/json" } } };
    const { exchange: redacted, count, bodyMayContainSecret } = redactExchange(exchange);
    expect(bodyMayContainSecret).toBe(true);
    expect(redacted.request?.body?.raw).toBe(raw); // untouched, as documented
    expect(count).toBe(0); // nothing was actually redacted -- the flag is the honest signal here
  });

  it("flags a credential-ish named field even when its value has no distinctive shape of its own", () => {
    // "hunter2" is not a JWT, not sk_/pk_-prefixed, and far too short to be a
    // long hex/base64 run -- detectCredentialShape alone would miss it. This
    // is specifically the key=value/"key":"value" pattern, not the stripe-key
    // pattern the test above already covers via its sk_-prefixed secret.
    for (const raw of ['{"amount":100,"password":"hunter2"}', "amount=100&password=hunter2"]) {
      const exchange: Exchange = { request: { body: { raw, contentType: "text/plain" } } };
      expect(redactExchange(exchange).bodyMayContainSecret).toBe(true);
    }
  });

  it("does not flag prose that merely contains a credential-ish word without a key/value shape", () => {
    const exchange: Exchange = { request: { body: { raw: "please sign here and return the form" } } };
    expect(redactExchange(exchange).bodyMayContainSecret).toBe(false);
  });

  it("does not flag a non-form body with nothing credential-shaped in it", () => {
    const exchange: Exchange = {
      response: { body: { raw: '{"amount":100,"currency":"usd"}', contentType: "application/json" } },
    };
    expect(redactExchange(exchange).bodyMayContainSecret).toBe(false);
  });

  it("a JWT embedded in a JSON body is still detected even though the body itself is not redacted", () => {
    const jwt = makeJwt({ alg: "none" }, { sub: "x" });
    const exchange: Exchange = {
      response: { body: { raw: `{"session":"${jwt}"}`, contentType: "application/json" } },
    };
    expect(redactExchange(exchange).bodyMayContainSecret).toBe(true);
  });
});
