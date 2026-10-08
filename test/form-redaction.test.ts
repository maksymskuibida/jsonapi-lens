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
import { openRequestForm } from "../src/request-form.js";
import type { RequestFormResult } from "../src/request-form.js";
import { mergeExchange } from "../src/exchange.js";
import type { Exchange } from "../src/exchange.js";
import { redactExchange } from "../src/secrets.js";
import { inspectExchangeForShare } from "../src/share.js";

beforeEach(() => {
  const root = document.createElement("div");
  root.id = "modal-root";
  const toast = document.createElement("div");
  toast.id = "toast";
  document.body.replaceChildren(root, toast);
});

interface Typed {
  url?: string;
  headers?: Array<[string, string]>;
  cookies?: Array<[string, string]>;
  contentType?: string;
  body?: string;
}

const set = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
};

/** Type into the real form and Save; return the exchange `main.ts` would hold. */
function typeIntoForm(typed: Typed): Exchange {
  let saved: RequestFormResult | null = null;
  openRequestForm({}, (result) => {
    saved = result;
  });
  const lists = [...document.querySelectorAll<HTMLElement>(".xform-rowlist")];
  const addRows = (list: HTMLElement, rows: Array<[string, string]> = []) => {
    for (const [name, value] of rows) {
      list.querySelector<HTMLButtonElement>(".btn--sm")!.click();
      const all = list.querySelectorAll<HTMLElement>(".xform-row");
      const row = all[all.length - 1]!;
      set(row.querySelector<HTMLInputElement>(".xform__name")!, name);
      set(row.querySelector<HTMLInputElement>(".xform__value")!, value);
    }
  };
  if (typed.url !== undefined) set(document.querySelector<HTMLInputElement>(".xform__url-input")!, typed.url);
  addRows(lists[1]!, typed.headers); // request headers (query is first)
  addRows(lists[2]!, typed.cookies); // request cookies
  const requestBody = document.querySelector<HTMLElement>(".xform-body")!;
  if (typed.contentType !== undefined) set(requestBody.querySelector<HTMLInputElement>("input")!, typed.contentType);
  if (typed.body !== undefined) set(requestBody.querySelector<HTMLTextAreaElement>("textarea")!, typed.body);
  document.querySelector<HTMLButtonElement>(".modal .modal__actions .xform__save")!.click();
  expect(saved, "the form saved").not.toBeNull();
  const { request, response } = saved as unknown as RequestFormResult;
  return mergeExchange({}, { request, response });
}

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
