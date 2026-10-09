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
    // 2 values masked by redactSetCookieSet + 1 name swept
    expect(out.count).toBe(3);
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
  it("returns the same origin object when nothing needed sweeping", () => {
    const origin = { source: "har", text: "GET /x" };
    const out = redactForExport({ origin });
    expect(out.exchange.origin).toEqual(origin);
    expect(out.count).toBe(0);
  });
  it("does not resurrect a prototype-pollution key", () => {
    const origin = JSON.parse(`{"__proto__": {"x": "Bearer qa-fake-pp"}, "ok": "fine"}`);
    const out = redactForExport({ origin });
    expect(JSON.stringify(out.exchange)).not.toContain("qa-fake-pp");
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
});
