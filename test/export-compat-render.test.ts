/** The reader re-derives what the canonical export leaves out (QA6 blind QA 2); see `export-compat-seal.test.ts` for the envelope half. */
import { describe, expect, it } from "vitest";
import { queryOf, renderExchangeBand } from "../src/render-request.js";
import { canonicalExchange } from "../src/secrets.js";
import { headerSet } from "../src/headers.js";
import { decodeParams } from "../src/params.js";
import type { Exchange } from "../src/exchange.js";

const typed: Exchange = {
  request: {
    method: "GET",
    url: "https://api.example.com/x?page=2&sort=name",
    query: decodeParams("page=2&sort=name"),
    headers: headerSet([{ name: "Accept", value: "application/json" }]),
  },
};

describe("the reader derives the query table from the URL", () => {
  it("a canonical exchange (no `query`) renders the same parameter rows as the typed one", () => {
    const canonical = canonicalExchange(typed);
    expect(canonical.request?.query).toBeUndefined();
    const rows = (exchange: Exchange) => {
      const band = renderExchangeBand({ exchange, mode: "request", currentDocument: null })!;
      return Array.from(band.querySelectorAll(".xrow--param .xrow__name")).map((n) => n.textContent);
    };
    expect(rows(typed)).toEqual(["page", "sort"]);
    expect(rows(canonical)).toEqual(["page", "sort"]);
    expect(queryOf(canonical.request)?.entries.map((e) => e.name)).toEqual(["page", "sort"]);
  });

  it("an old payload that still carries `query` keeps using it", () => {
    expect(queryOf(typed.request)).toBe(typed.request!.query);
  });

  it("a URL with no query derives an empty table, and no URL derives none", () => {
    expect(queryOf({ url: "https://a.example.com/x" })?.entries).toEqual([]);
    expect(queryOf({ method: "GET" })).toBeNull();
  });
});
