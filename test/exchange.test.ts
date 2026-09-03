import { describe, expect, it } from "vitest";
import { mergeExchange } from "../src/exchange.js";
import type { Exchange } from "../src/exchange.js";
import { headerSet } from "../src/headers.js";
import { decodeParams } from "../src/params.js";

describe("mergeExchange — non-destructive", () => {
  it("never discards a field present in the base and absent from the incoming", () => {
    const base: Exchange = {
      request: { method: "GET", url: "https://api.example.com/widgets" },
      response: { status: 200 },
    };
    const incoming: Exchange = { request: { headers: headerSet([{ name: "Accept", value: "*/*" }]) } };

    const merged = mergeExchange(base, incoming);
    expect(merged.request?.method).toBe("GET");
    expect(merged.request?.url).toBe("https://api.example.com/widgets");
    expect(merged.request?.headers).toEqual(headerSet([{ name: "Accept", value: "*/*" }]));
    expect(merged.response?.status).toBe(200);
  });

  it("an incoming field that is present, even if empty, replaces the base's — that is an intentional clear, not data loss", () => {
    const base: Exchange = { request: { headers: headerSet([{ name: "X-A", value: "1" }]) } };
    const incoming: Exchange = { request: { headers: headerSet([]) } };
    expect(mergeExchange(base, incoming).request?.headers).toEqual(headerSet([]));
  });

  it("incoming overrides base when both define the same scalar field", () => {
    const merged = mergeExchange({ request: { method: "GET" } }, { request: { method: "POST" } });
    expect(merged.request?.method).toBe("POST");
  });

  it("headers/cookies/query/body are replaced as a whole, not merged entry-by-entry — a form group always resubmits its full current value", () => {
    const base: Exchange = {
      request: {
        headers: headerSet([
          { name: "A", value: "1" },
          { name: "B", value: "2" },
        ]),
      },
    };
    const incoming: Exchange = { request: { headers: headerSet([{ name: "C", value: "3" }]) } };
    const merged = mergeExchange(base, incoming);
    // If this were an entry-level merge, A and B would still be present.
    expect(merged.request?.headers?.entries).toEqual([{ name: "C", value: "3" }]);
  });
});

describe("mergeExchange — never manufactures a present-but-empty part", () => {
  it("merging two exchanges with no request at all leaves `request` absent, not `{}`", () => {
    const merged = mergeExchange({}, {});
    expect(merged).toEqual({});
    expect("request" in merged).toBe(false);
    expect("response" in merged).toBe(false);
  });

  it("undefined on both sides is treated as no exchange at all, and still returns a concrete object", () => {
    expect(mergeExchange(undefined, undefined)).toEqual({});
  });

  it("a response-only base stays response-only after merging in a response-only incoming", () => {
    const merged = mergeExchange({ response: { status: 200 } }, { response: { statusText: "OK" } });
    expect("request" in merged).toBe(false);
    expect(merged.response).toEqual({ status: 200, statusText: "OK" });
  });
});

describe("mergeExchange — associative over partials", () => {
  const a: Exchange = { request: { method: "GET", url: "https://api.example.com/a" } };
  const b: Exchange = {
    request: { query: decodeParams("x=1"), headers: headerSet([{ name: "Accept", value: "*/*" }]) },
    response: { status: 200 },
  };
  const c: Exchange = {
    request: { method: "POST" }, // overrides a's method
    response: { statusText: "OK", elapsedMs: 42 },
    origin: { kind: "manual" },
  };

  it("(a merge b) merge c equals a merge (b merge c)", () => {
    const left = mergeExchange(mergeExchange(a, b), c);
    const right = mergeExchange(a, mergeExchange(b, c));
    expect(left).toEqual(right);
  });

  it("holds regardless of grouping for a second, differently-shaped triple", () => {
    const x: Exchange = { response: { headers: headerSet([{ name: "X-A", value: "1" }]) } };
    const y: Exchange = {};
    const z: Exchange = { request: { body: { raw: "{}", contentType: "application/json" } } };

    const left = mergeExchange(mergeExchange(x, y), z);
    const right = mergeExchange(x, mergeExchange(y, z));
    expect(left).toEqual(right);
  });

  it("merging with an empty partial on either side is a no-op", () => {
    expect(mergeExchange(a, {})).toEqual(mergeExchange({}, a));
    // Left side must literally be `a`'s content — merging in nothing changes nothing.
    expect(mergeExchange(a, {})).toEqual(a);
  });
});

describe("mergeExchange — BodyPart", () => {
  it("body is replaced whole, and always carries a valid `raw`", () => {
    const base: Exchange = { request: { body: { raw: "old", contentType: "text/plain" } } };
    const incoming: Exchange = { request: { body: { raw: "new", contentType: "application/json" } } };
    const merged = mergeExchange(base, incoming);
    expect(merged.request?.body).toEqual({ raw: "new", contentType: "application/json" });
  });

  it("a base body survives when incoming touches other request fields but not body", () => {
    const base: Exchange = { request: { body: { raw: "kept" } } };
    const incoming: Exchange = { request: { method: "PUT" } };
    const merged = mergeExchange(base, incoming);
    expect(merged.request?.body).toEqual({ raw: "kept" });
    expect(merged.request?.method).toBe("PUT");
  });
});
