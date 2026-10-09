/**
 * QA7 S19: the final export sweep now also covers the three surfaces D8 used to
 * list as "not yet swept" — Set-Cookie names, `body.contentType`, and string
 * leaves inside `origin` (a token embedded in a longer string, which the older
 * per-leaf pass cannot see because the leaf as a whole is not credential-shaped).
 * Every assertion is on `JSON.stringify` of the whole export.
 */
import { describe, expect, it } from "vitest";
import { redactForExport } from "../src/secrets.js";
import type { Exchange } from "../src/exchange.js";

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.qafakesigAAAA1111";
const STRIPE = ["sk", "live", "qaFakeStripe123456"].join("_");

describe("S19: Set-Cookie names", () => {
  it("masks a token used as a response cookie name, counts it, and keeps the cookie", () => {
    const ex: Exchange = {
      response: {
        cookies: { entries: [{ name: JWT, value: "v", unrecognized: [] }, { name: "theme", value: "dark", unrecognized: [] }] },
      },
    };
    const out = redactForExport(ex);
    const whole = JSON.stringify(out.exchange);
    expect(whole).not.toContain("qafakesig");
    expect(whole).toContain("theme");
    expect(out.exchange.response?.cookies?.entries).toHaveLength(2);
    // two cookies, two values masked; the swept name belongs to a pair whose value is masked, so it adds nothing (D8)
    expect(out.count).toBe(2);
  });
});

describe("S19 (review B1): unrecognised Set-Cookie attribute names", () => {
  it("masks a token that sits in an attribute name, parsed from the real wire text", async () => {
    const { parseSetCookies } = await import("../src/cookies.js");
    const jwt = ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxIn0", "qafakesigAAAA1111"].join(".");
    const ex: Exchange = { response: { cookies: parseSetCookies([`sid=1; ${jwt}=1`]) } };
    expect(JSON.stringify(ex)).toContain(jwt); // the fixture really carries it in an attribute name
    const out = redactForExport(ex);
    expect(JSON.stringify(out.exchange)).not.toContain("qafakesig");
    expect(out.exchange.response?.cookies?.entries[0]?.unrecognized?.[0]?.name).toContain("[REDACTED]");
    expect(out.count).toBe(2); // the cookie value and the attribute pair `<jwt>=1` (one count for name+value)
  });
});

describe("S19: body.contentType", () => {
  it("masks a token in a request and a response content type", () => {
    const ex: Exchange = {
      request: { body: { raw: "{}", contentType: `application/json; token=Bearer qa-fake-ct1` } },
      response: { body: { raw: "{}", contentType: `text/plain; x=${STRIPE}` } },
    };
    const out = redactForExport(ex);
    const whole = JSON.stringify(out.exchange);
    expect(whole).not.toContain("qa-fake-ct1");
    expect(whole).not.toContain("qaFakeStripe");
    expect(out.exchange.request?.body?.contentType).toContain("[REDACTED]");
    expect(out.exchange.request?.body?.raw).toBe("{}"); // a non-form body's raw is flagged, never rewritten
    expect(out.count).toBeGreaterThanOrEqual(2);
  });
  it("leaves an ordinary content type, and a missing one, alone", () => {
    const out = redactForExport({ request: { body: { raw: "a=1", contentType: "application/x-www-form-urlencoded; charset=utf-8" } }, response: { body: { raw: "x" } } });
    expect(out.exchange.request?.body?.contentType).toBe("application/x-www-form-urlencoded; charset=utf-8");
    expect(out.exchange.response?.body && "contentType" in out.exchange.response.body).toBe(false);
  });
});

describe("S19: string leaves inside origin", () => {
  it("masks a token embedded in a longer string, at any depth, in arrays too", () => {
    const ex: Exchange = {
      origin: {
        source: "curl",
        text: `curl -H 'Authorization: Bearer qa-fake-or1' https://api.example.com/x`,
        nested: { lines: [`GET /x HTTP/1.1`, `X-Debug: ${JWT}`], n: 3, ok: true, none: null },
      },
    };
    const out = redactForExport(ex);
    const whole = JSON.stringify(out.exchange);
    expect(whole).not.toContain("qa-fake-or1");
    expect(whole).not.toContain("qafakesig");
    expect(whole).toContain("GET /x HTTP/1.1");
    expect(out.exchange.origin?.source).toBe("curl");
    expect((out.exchange.origin?.nested as { n: number }).n).toBe(3);
    expect(out.count).toBeGreaterThanOrEqual(2);
  });
  it("returns the same origin object (reference) when nothing needed sweeping", () => {
    const origin = { source: "har", text: "GET /x" };
    const out = redactForExport({ origin });
    expect(out.exchange.origin).toBe(origin);
    expect(out.count).toBe(0);
  });
  it("does not resurrect a prototype-pollution key", () => {
    const origin = JSON.parse(`{"__proto__": {"x": "Bearer qa-fake-pp"}, "ok": "fine"}`);
    const out = redactForExport({ origin });
    expect(JSON.stringify(out.exchange)).not.toContain("qa-fake-pp");
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
});

describe("QA7 review S3/S4/nit: Set-Cookie attributes are swept, counted, and allowlisted", () => {
  const JWTX = ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxIn0", "qafakesigAAAA1111"].join(".");
  const tokens = (ex: Exchange) => (JSON.stringify(ex).match(/\[REDACTED\]/g) ?? []).length;

  it("S3: a token embedded in a longer Path, Domain, Expires or SameSite value is masked", async () => {
    const { parseSetCookies } = await import("../src/cookies.js");
    for (const line of [`sid=1; Path=/${JWTX}`, `sid=1; Path=/x Bearer qafakeAAA`, `sid=1; Domain=h.example.com/${JWTX}`, `sid=1; Expires=soon ${JWTX}`, `sid=1; SameSite=Lax ${JWTX}`]) {
      const ex: Exchange = { response: { cookies: parseSetCookies([line]) } };
      const out = redactForExport(ex);
      const whole = JSON.stringify(out.exchange);
      expect(whole, line).not.toContain("qafake");
      expect(whole, line).not.toContain("eyJhbG");
    }
    // an ordinary one is untouched
    const ok = redactForExport({ response: { cookies: parseSetCookies(["sid=1; Path=/x; Domain=example.com; SameSite=Lax"]) } });
    expect(ok.exchange.response?.cookies?.entries[0]).toMatchObject({ path: "/x", domain: "example.com", sameSite: "Lax" });
  });

  it("S4: the count equals the number of [REDACTED] value tokens, attributes and unrecognised values included", async () => {
    const { parseSetCookies } = await import("../src/cookies.js");
    for (const [line, expected] of [
      [`sid=1; Domain=Bearer x`, 2],
      [`sid=1; Path=/x Bearer qafakeAAA`, 2],
      [`sid=1; Path=/${JWTX}; HttpOnly`, 2],
      [`sid=1; flag=secretvalue`, 2], // an unrecognised attribute with a value
      [`sid=1; flagonly`, 1], // a bare flag has no value
      [`sid=1; Path=/x`, 1],
    ] as const) {
      const out = redactForExport({ response: { cookies: parseSetCookies([line]) } });
      expect(tokens(out.exchange), line).toBe(expected);
      expect(out.count, line).toBe(expected);
    }
  });

  it("S4: a masked name and its masked value are one count (the documented pair rule), for cookies and attributes", async () => {
    const { parseSetCookies } = await import("../src/cookies.js");
    const out = redactForExport({ response: { cookies: parseSetCookies([`${JWTX}=v`]) } });
    expect(out.exchange.response?.cookies?.entries[0]?.name).toBe("[REDACTED]");
    expect(out.count).toBe(1);
    const req = redactForExport({ request: { cookies: { entries: [{ name: JWTX, value: "v" }] } } });
    expect(JSON.stringify(req.exchange)).not.toContain("qafakesig");
    expect(req.count).toBe(1);
  });

  it("nit: a key outside the SetCookie type does not ride through the export", () => {
    const ex = { response: { cookies: { entries: [{ name: "sid", value: "1", extra: `Bearer qafakeEXTRA`, unrecognized: [{ name: "a", value: "b", more: "qafakeMORE" }] }] } } } as unknown as Exchange;
    const whole = JSON.stringify(redactForExport(ex).exchange);
    expect(whole).not.toContain("qafakeEXTRA");
    expect(whole).not.toContain("qafakeMORE");
    expect(whole).not.toContain('"extra"');
  });
});
