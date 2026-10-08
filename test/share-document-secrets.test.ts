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
import { redactExchange } from "../src/secrets.js";
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
  userinfo: "qa-fake-userpw-0009-not-real",
};

const form = `grant=client&client_secret=${FAKES.formPass}`;

function fullExchange(): Exchange {
  return {
    request: {
      method: "POST",
      url: `https://admin:${FAKES.userinfo}@api.example.com/v2/x?api_key=${FAKES.urlKey}&page=2`,
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
    // origin field, the URL password, and the URL/query key counted once (two
    // views of one value).
    expect(redacting).toBe(8);
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
    expect(inspectExchangeForShare([entry("a"), entry("b")]).redacting).toBe(16);
  });
});

describe("a credential in a URL's user[:password]@ prefix (QA6 review B2, B3)", () => {
  const redactedUrl = (url: string) => {
    const { exchange, count } = redactExchange({ request: { url } });
    return { url: exchange.request?.url, count };
  };

  // The whole userinfo is masked, never just the password: in these two real
  // forms the *user name* is the secret.
  // Assembled at runtime: a literal key-shaped string in the source trips GitHub push protection.
  const STRIPE = ["sk", "live", "FAKE0notREAL0stripe0key00"].join("_");
  const GITHUB = "0123456789abcdef0123456789abcdef01234567";
  const forms: Array<[string, string, string]> = [
    ["a user and a password", "https://admin:hunter2pass@api.example.com/v1?page=2", "https://[REDACTED]@api.example.com/v1?page=2"],
    ["Stripe's key as the user name, empty password", `https://${STRIPE}:@api.example.com/v1/charges`, "https://[REDACTED]@api.example.com/v1/charges"],
    ["GitHub's token as the user name", `https://${GITHUB}:x-oauth-basic@api.example.com/user`, "https://[REDACTED]@api.example.com/user"],
    ["a token alone", "https://faketoken123@api.example.com/o/r", "https://[REDACTED]@api.example.com/o/r"],
    ["an empty password", "https://admin:@api.example.com/x", "https://[REDACTED]@api.example.com/x"],
    ["scheme-less with a port and a fragment", "admin:hunter2pass@api.example.com:8080/x#a=1", "[REDACTED]@api.example.com:8080/x#a=1"],
  ];
  for (const [name, input, expected] of forms) {
    it(`masks the whole userinfo, counted once: ${name}`, () => {
      expect(redactedUrl(input)).toEqual({ url: expected, count: 1 });
    });
  }

  it("counts the userinfo and the query separately", () => {
    expect(redactedUrl("https://u:pw1@h.example.com/x?api_key=k1234567890").count).toBe(2);
  });

  it("leaves alone what is not userinfo: no @, an empty userinfo, an @ in the path or query, a mailto address, a port", () => {
    for (const url of [
      "https://api.example.com/x",
      "https://@api.example.com/x",
      "https://api.example.com/users/@me",
      "https://api.example.com/x?email=a@b.example.com",
      "mailto:someone@example.com",
      "localhost:8080/x",
    ]) {
      expect(redactedUrl(url), url).toEqual({ url, count: 0 });
    }
  });

  it("is idempotent: redacting twice neither double-counts nor changes the text", () => {
    const once = redactExchange({ request: { url: "https://admin:hunter2pass@api.example.com/" } });
    const twice = redactExchange(once.exchange);
    expect(twice.count).toBe(0);
    expect(twice.exchange.request?.url).toBe(once.exchange.request?.url);
  });

  it("never reaches a sealed single share or bundle, by either share path", async () => {
    const urls = [`https://${STRIPE}:@api.example.com/v1`, `https://${GITHUB}:x-oauth-basic@api.example.com/u`, "https://admin:qa-fake-urlpw-only-not-real@api.example.com/v1", "https://:qa-fake-emptyuser-pw-not-real@api.example.com/v1"];
    const entries = (label: string): BundleEntry[] =>
      urls.map((url, i) => ({ label: `${label}${i}`, text: "{}", exchange: { request: { url } } }));
    const fakes = [STRIPE, GITHUB, "qa-fake-urlpw-only-not-real", "qa-fake-emptyuser-pw-not-real", "x-oauth-basic"];
    for (const documents of [[entries("a")[0]!], [entries("a")[1]!], [entries("a")[2]!], [entries("a")[3]!], entries("b")]) {
      const secret = generateSecret();
      const opened = await openSealed(await mintShareEnvelope(documents, secret), secret);
      const json = JSON.stringify(opened);
      for (const fake of fakes) expect(json, fake).not.toContain(fake);
      expect(json).toContain("https://[REDACTED]@api.example.com");
    }
    expect(inspectExchangeForShare(entries("a")).redacting).toBe(4);
  });
});

describe("a header whose value is a URL is scanned like the request URL (QA6 review S7)", () => {
  it("masks a credential in Location, Referer and Content-Location, and leaves a clean one alone", () => {
    const { exchange, count } = redactExchange({
      response: {
        headers: headerSet([
          { name: "Location", value: "https://app.example.com/cb?access_token=qa-fake-tok-0123456789-not-real&state=1" },
          { name: "Referer", value: "https://u:pw@app.example.com/x" },
          { name: "Content-Location", value: "/v2/articles/1" },
          { name: "Link", value: "</v2?page=2>; rel=next" },
        ]),
      },
    });
    const values = exchange.response!.headers!.entries.map((e) => e.value);
    expect(values[0]).not.toContain("qa-fake-tok");
    expect(values[0]).toContain("state=1");
    expect(values[1]).toBe("https://[REDACTED]@app.example.com/x");
    expect(values[2]).toBe("/v2/articles/1");
    expect(values[3]).toBe("</v2?page=2>; rel=next");
    expect(count).toBe(2);
  });
});

describe("the number the dialog states is exact (QA6 review N5)", () => {
  it("equals the number of masked values in the sealed payload, with the same parameter name in every header and the URL", async () => {
    // No `query` ParamSet: it is a second view of the URL's table, so a value
    // present in both is counted once but appears twice. Here every masked value
    // appears exactly once, which makes "count == occurrences" a real equality.
    const entry: BundleEntry = {
      label: "a.json",
      text: "{}",
      exchange: {
        request: {
          url: "https://u:pw@api.example.com/x?access_token=qa-fake-tok-0000000001-not-real&page=2",
          headers: headerSet([
            { name: "Authorization", value: "Bearer qa-fake-not-real" },
            { name: "Referer", value: "https://v:pw2@app.example.com/p?access_token=qa-fake-tok-0000000002-not-real" },
            { name: "Accept", value: "application/vnd.api+json" },
          ]),
          cookies: { entries: [{ name: "s", value: "qa-fake-cookie-not-real" }] },
        },
        response: {
          headers: headerSet([
            { name: "Location", value: "https://app.example.com/cb?access_token=qa-fake-tok-0000000003-not-real" },
            { name: "Content-Location", value: "/v2/x?access_token=qa-fake-tok-0000000004-not-real" },
          ]),
        },
      },
    };
    const { redacting } = inspectExchangeForShare([entry]);
    const secret = generateSecret();
    const opened = await openSealed(await mintShareEnvelope([entry], secret), secret);
    const json = JSON.stringify(opened);
    const occurrences = (json.match(/\[REDACTED\]|%5BREDACTED%5D/g) ?? []).length;
    expect(json).not.toContain("qa-fake-");
    expect(json).toContain("page=2");
    expect(redacting).toBe(occurrences);
    expect(redacting).toBe(8); // url userinfo+token, Authorization, Referer userinfo+token, cookie, Location, Content-Location
  });
});
