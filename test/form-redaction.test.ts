/**
 * Redaction, driven with the exchange the **real request form produces**.
 *
 * QA6's local QA found that form-urlencoded credentials were never redacted in
 * the product: redaction waited for `BodyPart.form`, which nothing in the app
 * ever populates, while every test seeded `form` by hand. So these tests do not
 * build an exchange object. They open the real form (`openRequestForm`), type
 * into its real fields, press its real Save, and hand whatever `onSave` returns
 * (folded in with `mergeExchange`, exactly as `main.ts` does) to redaction.
 *
 * Fixture audit (QA6): in the earlier tests the hand-populated fields the form
 * never fills were `BodyPart.form` (share-document-secrets.test.ts) and
 * `Exchange.origin` (the provenance placeholder: nothing writes it). `query` is
 * filled by the form and was fine. `origin` is kept in one test, marked as a
 * model field; `form` is no longer seeded anywhere in the redaction tests that
 * matter.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { typeIntoForm, resetModalRoot } from "./helpers/type-into-form.js";
import type { Exchange } from "../src/exchange.js";
import { redactExchange } from "../src/secrets.js";
import { inspectExchangeForShare } from "../src/share.js";

beforeEach(resetModalRoot);

describe("the real form's body shape: { raw, contentType } and nothing else", () => {
  it("never populates BodyPart.form (which is why redaction cannot wait for it)", () => {
    const exchange = typeIntoForm({ contentType: "application/x-www-form-urlencoded", body: "a=1" });
    expect(exchange.request?.body).toEqual({ raw: "a=1", contentType: "application/x-www-form-urlencoded" });
    expect(exchange.request?.body && "form" in exchange.request.body).toBe(false);
  });
});

describe("a form body typed into the real form is redacted (QA6 finding 1)", () => {
  const body = "a=1&client_secret=qa-fake-0005-not-real&password=qa-fake-0007-not-real";
  const types = [
    "application/x-www-form-urlencoded",
    "application/x-www-form-urlencoded; charset=UTF-8",
    "Application/X-WWW-Form-Urlencoded",
    "",
    "text/plain",
    "text/plain; charset=utf-8",
  ];
  for (const contentType of types) {
    it(`content type ${JSON.stringify(contentType)}: both secrets masked, counted, raw rewritten, no warning`, () => {
      const exchange = typeIntoForm({ contentType, body });
      const { exchange: out, count, bodyMayContainSecret } = redactExchange(exchange);
      expect(count).toBe(2);
      expect(bodyMayContainSecret).toBe(false);
      expect(JSON.stringify(out)).not.toContain("qa-fake-");
      expect(out.request?.body?.raw).toContain("a=1");
      expect(out.request?.body?.raw).toContain("client_secret=");
      expect(inspectExchangeForShare([{ label: "a", text: "{}", exchange }])).toEqual({
        redacting: 2,
        bodyUnredacted: false,
      });
    });
  }

  it("the notes' own example, a=1&client_secret=qa-fake-1", () => {
    const exchange = typeIntoForm({ contentType: "application/x-www-form-urlencoded", body: "a=1&client_secret=qa-fake-1" });
    expect(redactExchange(exchange).count).toBe(1);
    expect(JSON.stringify(redactExchange(exchange).exchange)).not.toContain("qa-fake-1");
  });

  it("counts each of two parameters with the same name", () => {
    const exchange = typeIntoForm({ contentType: "application/x-www-form-urlencoded", body: "password=qa-fake-p1&password=qa-fake-p2" });
    expect(redactExchange(exchange).count).toBe(2);
  });

  it("a clean form with nothing credential-like is untouched and not flagged", () => {
    const exchange = typeIntoForm({ contentType: "application/x-www-form-urlencoded", body: "a=1&b=2" });
    const result = redactExchange(exchange);
    expect(result.count).toBe(0);
    expect(result.exchange.request?.body?.raw).toBe("a=1&b=2");
    expect(result.bodyMayContainSecret).toBe(false);
  });

  it("a JSON body is still only flagged, never rewritten, even with k=v inside it", () => {
    for (const [contentType, raw] of [
      ["application/json", '{"password":"qa-fake-j1"}'],
      ["", '{"note":"a=1&password=qa-fake-j2"}'],
      ["application/json", "a=1&password=qa-fake-j3"],
    ] as const) {
      const exchange = typeIntoForm({ contentType, body: raw });
      const result = redactExchange(exchange);
      expect(result.exchange.request?.body?.raw, raw).toBe(raw);
      expect(result.bodyMayContainSecret, raw).toBe(true);
    }
  });

  it("a form body's credentials and a header's make one combined count and no body warning", () => {
    const exchange = typeIntoForm({
      headers: [["Authorization", "Bearer qa-fake-h1-not-real"]],
      contentType: "application/x-www-form-urlencoded",
      body,
    });
    expect(inspectExchangeForShare([{ label: "a", text: "{}", exchange }])).toEqual({
      redacting: 3,
      bodyUnredacted: false,
    });
  });

  it("a request with a credential form body and a JSON response body: count includes the form, warning is for the JSON", () => {
    const exchange: Exchange = {
      ...typeIntoForm({ contentType: "application/x-www-form-urlencoded", body }),
      response: { body: { raw: '{"token":"qa-fake-r1"}', contentType: "application/json" } },
    };
    expect(inspectExchangeForShare([{ label: "a", text: "{}", exchange }])).toEqual({
      redacting: 2,
      bodyUnredacted: true,
    });
  });
});

describe("URL-valued headers typed into the real form, including Origin (QA6 finding 2)", () => {
  const headers: Array<[string, string]> = [
    ["Origin", "https://u:qa-fake-o-2@o.example.com"],
    ["origin", "https://qa-fake-o-1@o.example.com"],
    ["ORIGIN", "https://o.example.com/?token=qa-fake-o-3-not-real"],
    ["Referer", "https://r.example.com/p?access_token=qa-fake-r-4-not-real"],
  ];
  it("masks and counts every one", () => {
    const exchange = typeIntoForm({ headers });
    const { exchange: out, count } = redactExchange(exchange);
    expect(JSON.stringify(out)).not.toContain("qa-fake-");
    expect(count).toBe(4);
  });
  it("leaves a clean Origin alone", () => {
    const exchange = typeIntoForm({ headers: [["Origin", "https://app.example.com"]] });
    expect(redactExchange(exchange).count).toBe(0);
  });
});

describe("the whole typed request, end to end through redaction", () => {
  it("URL, headers, cookie and form body typed in: nothing survives, and the count is the number of masked values", () => {
    const exchange = typeIntoForm({
      url: "https://admin:qa-fake-pw-not-real@api.example.com/x?api_key=qa-fake-key-0123456789-not-real&page=2",
      headers: [
        ["Authorization", "Bearer qa-fake-bearer-not-real"],
        ["Accept", "application/vnd.api+json"],
      ],
      cookies: [["session", "qa-fake-cookie-not-real"]],
      contentType: "application/x-www-form-urlencoded",
      body: "client_secret=qa-fake-form-not-real&a=1",
    });
    const { exchange: out, count } = redactExchange(exchange);
    const json = JSON.stringify(out);
    expect(json).not.toContain("qa-fake-");
    expect(json).toContain("application/vnd.api+json");
    expect(json).toContain("page=2");
    // userinfo, api_key (url + query once), Authorization, cookie, form field
    expect(count).toBe(5);
  });
});

describe("a body that is not a clean form is never called safe (QA6 review B5, S12)", () => {
  const FORM = "application/x-www-form-urlencoded";
  const cases: Array<[string, string, string]> = [
    ["JSON labelled as a form", FORM, '{"password":"hunter2secretX"}'],
    ["a percent-encoded `=` inside one name", FORM, "password%3Dhunter2secretX"],
    ["a `;`-separated body", FORM, "a=1;password=hunter2secretX"],
    ["a multi-line body", FORM, "a=1\npassword=hunter2secretX"],
    ["a name with a colon", FORM, "pass:word=hunter2secretX"],
    ["an array-looking body with a form type", FORM, '["password=hunter2secretX"]'],
    ["a multipart body", "multipart/form-data; boundary=b", '--b\r\nContent-Disposition: form-data; name="password"\r\n\r\nhunter2secretX\r\n--b--'],
    ["a benign multipart body (cannot be parsed, so flagged)", "multipart/form-data; boundary=b", '--b\r\nContent-Disposition: form-data; name="title"\r\n\r\nhello\r\n--b--'],
  ];
  for (const [name, contentType, raw] of cases) {
    it(`${name}: not rewritten, counts nothing, and the dialog warns`, () => {
      const exchange = typeIntoForm({ contentType, body: raw });
      const result = redactExchange(exchange);
      expect(result.exchange.request?.body?.raw).toBe(exchange.request?.body?.raw); // untouched: nothing claimed as removed
      expect(result.count).toBe(0);
      expect(result.bodyMayContainSecret).toBe(true);
      expect(inspectExchangeForShare([{ label: "a", text: "{}", exchange }])).toEqual({
        redacting: 0,
        bodyUnredacted: true,
      });
    });
  }

  it("the strict name rule: letters, digits and _ . - [ ] (also percent-encoded) are a clean form; anything else is not", () => {
    for (const ok of ["user[name]=a&pass.word=b", "a%5Bb%5D=1", "x-y_z=1", "pass%77ord=hunter2secretX"]) {
      const result = redactExchange(typeIntoForm({ contentType: FORM, body: ok }));
      expect(result.bodyMayContainSecret, ok).toBe(false);
    }
    expect(redactExchange(typeIntoForm({ contentType: FORM, body: "pass%77ord=hunter2secretX" })).count).toBe(1);
  });
});

describe("fail closed: the body warning is suppressed only for a clean, fully redacted form (QA6 review B6, S13)", () => {
  const FORM = "application/x-www-form-urlencoded";
  const warns = (contentType: string, body: string) => {
    const exchange = typeIntoForm({ contentType, body });
    return inspectExchangeForShare([{ label: "a", text: "{}", exchange }]);
  };

  // Every row of the reviewer's B6 table, with the form type and with none.
  const b6 = ["a=1;password=x", "a=1\npassword=abc", "pass:word=x", "password=my secret phrase", "client_secret=abc def"];
  for (const body of b6) {
    for (const contentType of [FORM, ""]) {
      it(`warns: ${JSON.stringify(body)} with content type ${JSON.stringify(contentType)}`, () => {
        const result = warns(contentType, body);
        expect(result.bodyUnredacted).toBe(true);
        // and nothing is claimed as removed that was not (the count is only masked values)
        const exchange = typeIntoForm({ contentType, body });
        const redacted = redactExchange(exchange);
        expect(redacted.exchange.request?.body?.raw).toBe(exchange.request?.body?.raw);
        expect(redacted.count).toBe(0);
      });
    }
  }

  it("S13: a redacted form with a credential-shaped leftover still warns (count counts only what was masked)", () => {
    const stripe = ["sk", "live", "FAKE0notREAL0stripe0key00"].join("_");
    const jwt = "eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.c2lnbmF0dXJlLWZha2U";
    for (const body of [`password=x&${stripe}`, `password=x&${jwt}`]) {
      const result = warns(FORM, body);
      expect(result.bodyUnredacted, body).toBe(true);
      expect(result.redacting, body).toBeGreaterThanOrEqual(1);
    }
  });

  it("a credential-shaped *value* is masked and counted, so nothing is left and it does not warn", () => {
    const stripe = ["sk", "live", "FAKE0notREAL0stripe0key00"].join("_");
    expect(warns(FORM, `password=x&note=${stripe}`)).toEqual({ redacting: 2, bodyUnredacted: false });
  });

  it("a genuinely clean form is redacted, counted, and does not warn", () => {
    for (const contentType of [FORM, "", "text/plain"]) {
      const result = warns(contentType, "a=1&password=x");
      expect(result).toEqual({ redacting: 1, bodyUnredacted: false });
    }
  });

  it("an empty or blank body never warns; a JSON body always does", () => {
    expect(warns(FORM, "").bodyUnredacted).toBe(false);
    expect(warns("application/json", '{"amount":100}').bodyUnredacted).toBe(true);
    expect(warns("application/json", '{"a":{"b":[1,2,3]}}').bodyUnredacted).toBe(true);
    expect(warns("text/plain", "hello there").bodyUnredacted).toBe(true);
  });

  it("`pass`, `pwd` and `passwd` parameters are masked; `passport` and `bypass` are left alone", () => {
    const result = redactExchange(typeIntoForm({ contentType: FORM, body: "pass=a1&pwd=b2&passwd=c3&passport=P123&bypass=1" }));
    expect(result.count).toBe(3);
    expect(result.exchange.request?.body?.raw).toContain("passport=P123");
    expect(result.exchange.request?.body?.raw).toContain("bypass=1");
    expect(result.bodyMayContainSecret).toBe(false);
  });
});
