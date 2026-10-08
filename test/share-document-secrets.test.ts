// @vitest-environment node
/**
 * QA6, item 1: nothing credential-shaped reaches the sealed payload of a share,
 * on any surface `redactExchange` covers, by either share entry point.
 *
 * The document's own Share and Library → Share both end in
 * `mintShareEnvelope`; this drives that function with an exchange that carries a
 * fake secret on **every surface at once** — request header, cookie, a
 * credential in the URL and in `query`, a form body, the response's headers and
 * `Set-Cookie`, and `origin` — then decrypts what was sealed and searches every
 * serialisation of it. Node, not jsdom, because `crypto.ts` needs a real
 * `CompressionStream` (see `bundle.test.ts`).
 *
 * The secrets are synthetic and shaped to be caught by name, not by luck.
 */
import { describe, expect, it } from "vitest";
import { mintShareEnvelope } from "../src/bundle.js";
import { generateSecret, isBundlePayload, open as openSealed } from "../src/crypto.js";
import type { BundleEntry } from "../src/crypto.js";
import { headerSet } from "../src/headers.js";
import { decodeParams } from "../src/params.js";
import { inspectExchangeForShare } from "../src/share.js";
import type { Exchange } from "../src/exchange.js";

const FAKES = {
  bearer: "qa-fake-bearer-0001-not-real",
  cookie: "qa-fake-session-0002-not-real",
  setCookie: "qa-fake-setcookie-0003-not-real",
  urlKey: "qa-fake-urlkey-0004-not-real",
  queryKey: "qa-fake-querykey-0005-not-real",
  formPass: "qa-fake-formpass-0006-not-real",
  resAuth: "qa-fake-resauth-0007-not-real",
  origin: "qa-fake-origin-0008-not-real",
};

const form = `grant=client&client_secret=${FAKES.formPass}`;

function fullExchange(): Exchange {
  return {
    request: {
      method: "POST",
      url: `https://api.example.com/v2/x?api_key=${FAKES.urlKey}&page=2`,
      query: decodeParams(`api_key=${FAKES.queryKey}&page=2`),
      headers: headerSet([
        { name: "Authorization", value: `Bearer ${FAKES.bearer}` },
        { name: "Accept", value: "application/vnd.api+json" },
      ]),
      cookies: { entries: [{ name: "session", value: FAKES.cookie }] },
      body: { raw: form, contentType: "application/x-www-form-urlencoded", form: decodeParams(form) },
    },
    response: {
      status: 200,
      headers: headerSet([{ name: "Authorization", value: FAKES.resAuth }]),
      cookies: { entries: [{ name: "sid", value: FAKES.setCookie }] },
    },
    origin: { source: "curl", api_token: FAKES.origin },
  };
}

const entry = (label: string): BundleEntry => ({ label, text: '{"data":null}', exchange: fullExchange() });

function expectClean(opened: unknown): void {
  const json = JSON.stringify(opened);
  for (const [surface, fake] of Object.entries(FAKES)) {
    expect(json, `${surface} leaked`).not.toContain(fake);
  }
  expect(json).toContain("[REDACTED]");
  // The control: redaction is not a blanket wipe — an ordinary header and an
  // ordinary parameter survive, so a green result here is not "everything was
  // removed".
  expect(json).toContain("application/vnd.api+json");
  expect(json).toContain("page=2");
}

describe("a share seals no credential, on any surface", () => {
  it("single document (the document's own Share and Library → Share for one row)", async () => {
    const secret = generateSecret();
    const opened = await openSealed(await mintShareEnvelope([entry("a.json")], secret), secret);
    expect(isBundlePayload(opened)).toBe(false);
    expectClean(opened);
  });

  it("bundle", async () => {
    const secret = generateSecret();
    const opened = await openSealed(await mintShareEnvelope([entry("a.json"), entry("b.json")], secret), secret);
    expect(isBundlePayload(opened)).toBe(true);
    expectClean(opened);
  });

  it("the number the dialog states is the number of values actually masked", async () => {
    const { redacting } = inspectExchangeForShare([entry("a.json")]);
    // header, request cookie, response header, response cookie, form field,
    // origin field, and the URL/query key counted once (two views of one value).
    expect(redacting).toBe(7);
    const secret = generateSecret();
    const opened = await openSealed(await mintShareEnvelope([entry("a.json")], secret), secret);
    expect(JSON.stringify(opened).split("[REDACTED]").length - 1).toBeGreaterThanOrEqual(redacting);
  });
});

describe("inspectExchangeForShare", () => {
  it("is zero and false for no exchange and for an exchange with nothing to mask", () => {
    expect(inspectExchangeForShare([{ label: "a", text: "{}" }])).toEqual({ redacting: 0, bodyUnredacted: false });
    expect(
      inspectExchangeForShare([
        { label: "a", text: "{}", exchange: { request: { headers: headerSet([{ name: "Accept", value: "*/*" }]) } } },
      ]),
    ).toEqual({ redacting: 0, bodyUnredacted: false });
  });

  it("flags a non-form body that looks credential-shaped, which redaction does not rewrite", () => {
    const exchange: Exchange = {
      response: { body: { raw: '{"password":"hunter2"}', contentType: "application/json" } },
    };
    expect(inspectExchangeForShare([{ label: "a", text: "{}", exchange }])).toEqual({
      redacting: 0,
      bodyUnredacted: true,
    });
  });

  it("sums across a bundle", () => {
    expect(inspectExchangeForShare([entry("a"), entry("b")]).redacting).toBe(14);
  });
});
