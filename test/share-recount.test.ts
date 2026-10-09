// @vitest-environment node
/**
 * Prod QA of QA5, finding 1: a share recipient's Copy toast said "3 redacted" for an export byte-identical to the
 * sender's, where the sender's toast and the share dialog said 4. The userinfo (`https://[REDACTED]@host`) was the one
 * value a second pass did not count, because it was "already redacted". D8's rule: the count is the number of masked
 * values *in the export*, so a value that already reads `[REDACTED]` counts, unchanged. These tests run the real
 * path: export, seal, open, export again.
 */
import { describe, expect, it } from "vitest";
import { mintShareEnvelope } from "../src/bundle.js";
import { generateSecret, open as openSealed } from "../src/crypto.js";
import type { SharePayload } from "../src/crypto.js";
import { headerSet } from "../src/headers.js";
import { redactForExport } from "../src/secrets.js";
import type { Exchange } from "../src/exchange.js";

const JWT = ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxIn0", "qafakesigAAAA1111"].join(".");

const FINDING: Exchange = {
  request: {
    method: "GET",
    url: "https://admin:qa-fake-userpw-not-real@api.example.com/v1/x?api_key=qa-fake-key-not-real&page=2",
    headers: headerSet([
      { name: "Authorization", value: "Bearer qa-fake-bearer-not-real" },
      { name: "Accept", value: "application/vnd.api+json" },
    ]),
    cookies: { entries: [{ name: "session", value: "qa-fake-session-not-real" }] },
  },
};

const MORE: Exchange = {
  request: {
    url: "https://u:pw@api.example.com/x#access_token=qa-fake-frag-not-real",
    headers: headerSet([
      { name: "X-Forwarded", value: `Bearer qa-fake-fwd-not-real` },
      { name: "Location", value: "https://v:pw@h.example.com/cb?sig=qa-fake-sig-not-real" },
    ]),
    body: { raw: `a=1&token=qa-fake-tok-not-real&${JWT}`, contentType: "application/x-www-form-urlencoded" },
  },
  response: { cookies: { entries: [{ name: "sid", value: "v", path: "/x" }] } },
  origin: { src: "x", api_token: "qa-fake-origin-not-real" },
};

async function roundTrip(exchange: Exchange): Promise<{ sender: ReturnType<typeof redactForExport>; recipient: ReturnType<typeof redactForExport> }> {
  const sender = redactForExport(exchange);
  const secret = generateSecret();
  const opened = (await openSealed(await mintShareEnvelope([{ label: "a.json", text: '{"data":null}', exchange }], secret), secret)) as SharePayload;
  const recipient = redactForExport(opened.exchange as Exchange);
  return { sender, recipient };
}

describe("export -> share -> open -> export reports the same count and the same bytes", () => {
  for (const [name, exchange, expected] of [
    ["the finding's request (header, cookie, userinfo, api_key)", FINDING, 4],
    ["userinfo, fragment token, two headers, a form body with a token-named pair, origin", MORE, undefined],
  ] as const) {
    it(name, async () => {
      const { sender, recipient } = await roundTrip(exchange);
      if (expected !== undefined) expect(sender.count).toBe(expected);
      expect(recipient.count).toBe(sender.count);
      expect(JSON.stringify(recipient.exchange)).toBe(JSON.stringify(sender.exchange));
    });
  }

  it("a third pass changes nothing either (idempotent in text and in count)", () => {
    const once = redactForExport(FINDING);
    const twice = redactForExport(once.exchange);
    const thrice = redactForExport(twice.exchange);
    expect([twice.count, thrice.count]).toEqual([once.count, once.count]);
    expect(JSON.stringify(thrice.exchange)).toBe(JSON.stringify(once.exchange));
  });

  it("does not count a value that was never masked: an ordinary exchange stays at zero on both sides", async () => {
    const plain: Exchange = { request: { url: "https://api.example.com/x?page=2", headers: headerSet([{ name: "Accept", value: "x/y" }]) } };
    const { sender, recipient } = await roundTrip(plain);
    expect([sender.count, recipient.count]).toEqual([0, 0]);
  });
});

describe("Set-Cookie and every other exact `[REDACTED]` is recounted (QA7 blind QA, low 1)", () => {
  const sc = async (lines: string[]) => (await import("../src/cookies.js")).parseSetCookies(lines);

  it("the reported case: `sid=1; Domain=Bearer x` is 2 on both sides, byte-identical", async () => {
    const ex: Exchange = { response: { cookies: await sc(["sid=1; Domain=Bearer qafakeBBB"]) } };
    const { sender, recipient } = await roundTrip(ex);
    expect(sender.count).toBe(2);
    expect(recipient.count).toBe(2);
    expect(JSON.stringify(recipient.exchange)).toBe(JSON.stringify(sender.exchange));
  });

  it("a fixture with every Set-Cookie field (value, each attribute, unrecognised with a value, a bare flag, a token-named cookie and flag)", async () => {
    const ex: Exchange = {
      response: {
        cookies: await sc([
          "a=1; Path=Bearer qafakeP; Domain=Bearer qafakeD; Expires=Token qafakeE; SameSite=Bearer qafakeS; Secure; HttpOnly; Max-Age=60; extra=qafakeX; flagonly",
          `${JWT}=v; Path=/ok`,
          `b=2; ${JWT}`,
          `c=3; ${JWT}=w`,
          "d=4; Path=/plain; Domain=example.com; SameSite=Lax",
        ]),
        headers: headerSet([{ name: JWT, value: "x" }, { name: "X-Note", value: "Bearer qafakeN" }]),
      },
      request: { cookies: { entries: [{ name: JWT, value: "v" }] } },
      origin: { a: "Bearer qafakeO", b: "plain" },
    };
    const { sender, recipient } = await roundTrip(ex);
    expect(sender.count).toBeGreaterThan(10);
    expect(recipient.count).toBe(sender.count);
    expect(JSON.stringify(recipient.exchange)).toBe(JSON.stringify(sender.exchange));
    expect(JSON.stringify(sender.exchange)).not.toContain("qafake");
    // and a third pass
    const third = redactForExport(recipient.exchange);
    expect(third.count).toBe(sender.count);
    expect(JSON.stringify(third.exchange)).toBe(JSON.stringify(sender.exchange));
  });

  it("the one documented exception: a token masked inside a longer attribute value is not recounted (D8)", async () => {
    const { sender, recipient } = await roundTrip({ response: { cookies: await sc(["sid=1; Path=/x Bearer qafakeAAA"]) } });
    expect([sender.count, recipient.count]).toEqual([2, 1]);
    expect(JSON.stringify(recipient.exchange)).toBe(JSON.stringify(sender.exchange));
  });

  it("a literal `[REDACTED]` the author wrote counts like one the app wrote", () => {
    const authored: Exchange = { request: { headers: headerSet([{ name: "X-Foo", value: "[REDACTED]" }]) }, origin: { k: "[REDACTED]" } };
    expect(redactForExport(authored).count).toBe(2);
  });
});
