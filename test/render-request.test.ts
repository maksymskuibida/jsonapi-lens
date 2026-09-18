import { describe, expect, it } from "vitest";
import {
  effectiveMode,
  hasExchangeContent,
  parseReqResourceMarker,
  parseRequestUrl,
  readBodyLens,
  renderBodyPart,
  renderExchangeBand,
  requestBodyJsonApiIndex,
  requestBodyRoot,
  responseReferenceTime,
} from "../src/render-request.js";
import { requestResourceDomId, requestNodeDomId } from "../src/ident.js";
import { buildIndex } from "../src/parse.js";
import { groupsHtml } from "../src/render-document.js";
import { buildJsonIndex } from "../src/json-index.js";
import { buildAnnotations, renderJsonGroups } from "../src/render-json.js";
import { headerSet } from "../src/headers.js";
import type { Exchange } from "../src/exchange.js";
import type { JsonObject } from "../src/types.js";

const doc = (value: unknown): JsonObject => value as JsonObject;

/**
 * Values that break things in shapes other than markup. `test/ident.test.ts`
 * has the anchor-scheme corpus; this is the rendering-time equivalent —
 * `__proto__`/`constructor` are meaningless to `escapeHtml` and to a scheme
 * allowlist, but they are exactly the shape a plain-object property write
 * turns into a prototype-pollution bug, which is a different failure mode
 * than script injection and needs its own coverage.
 */
const HOSTILE = [
  "<script>alert(1)</script>",
  '"><img src=x onerror=alert(1)>',
  "__proto__",
  "constructor",
  "prototype",
  "__proto__.polluted",
];

describe("hasExchangeContent / effectiveMode", () => {
  it("is false for an empty exchange, true for either part alone", () => {
    expect(hasExchangeContent({})).toBe(false);
    expect(hasExchangeContent({ request: { method: "GET" } })).toBe(true);
    expect(hasExchangeContent({ response: { status: 200 } })).toBe(true);
  });

  it("picks the one part that exists, regardless of the preferred mode", () => {
    expect(effectiveMode({ request: {} }, "both")).toBe("request");
    expect(effectiveMode({ response: {} }, "both")).toBe("response");
  });

  it("honours the preferred mode only when both parts exist", () => {
    const both: Exchange = { request: {}, response: {} };
    expect(effectiveMode(both, "both")).toBe("both");
    expect(effectiveMode(both, "request")).toBe("request");
    expect(effectiveMode(both, "response")).toBe("response");
  });
});

describe("parseRequestUrl", () => {
  it("parses a URL with a scheme as-is", () => {
    const parsed = parseRequestUrl("https://api.example.com/trips?a=1");
    expect(parsed?.assumedScheme).toBe(false);
    expect(parsed?.url.origin).toBe("https://api.example.com");
  });

  it("assumes https for a bare host and path, and says so", () => {
    const parsed = parseRequestUrl("api.example.com/x");
    expect(parsed?.assumedScheme).toBe(true);
    expect(parsed?.url.href).toBe("https://api.example.com/x");
  });

  it("refuses to guess a scheme in front of a bare path", () => {
    expect(parseRequestUrl("/just/a/path")).toBeNull();
  });

  it("returns null for empty or genuinely unparseable text", () => {
    expect(parseRequestUrl("")).toBeNull();
    expect(parseRequestUrl("   ")).toBeNull();
    expect(parseRequestUrl("not a url at all with spaces")).toBeNull();
  });
});

describe("responseReferenceTime", () => {
  it("reads the Date header, case-insensitively", () => {
    const ms = responseReferenceTime({ headers: headerSet([{ name: "Date", value: "Mon, 01 Jan 2024 00:00:00 GMT" }]) });
    expect(ms).toBe(Date.parse("Mon, 01 Jan 2024 00:00:00 GMT"));
  });

  it("is null when there is no Date header, or it does not parse", () => {
    expect(responseReferenceTime(undefined)).toBeNull();
    expect(responseReferenceTime({})).toBeNull();
    expect(responseReferenceTime({ headers: headerSet([{ name: "Date", value: "not a date" }]) })).toBeNull();
  });
});

describe("readBodyLens / requestBodyRoot / requestBodyJsonApiIndex", () => {
  it("reads a JSON:API body as jsonapi, exposing its root and index", () => {
    const raw = JSON.stringify({ data: { type: "a", id: "1" } });
    expect(readBodyLens(raw)?.kind).toBe("jsonapi");
    expect(requestBodyRoot({ raw })).toEqual({ data: { type: "a", id: "1" } });
    expect(requestBodyJsonApiIndex({ raw })?.byKey.size).toBe(1);
  });

  it("reads a plain-JSON body as json", () => {
    const raw = JSON.stringify({ items: [{ id: "1" }, { id: "2" }] });
    expect(readBodyLens(raw)?.kind).toBe("json");
    expect(requestBodyJsonApiIndex({ raw })).toBeNull();
  });

  it("is null for text that is not JSON at all, and for no body", () => {
    expect(readBodyLens("not json")).toBeNull();
    expect(readBodyLens("")).toBeNull();
    expect(requestBodyRoot(undefined)).toBeNull();
    expect(requestBodyRoot({ raw: "" })).toBeNull();
    expect(requestBodyJsonApiIndex(undefined)).toBeNull();
  });
});

describe("parseReqResourceMarker", () => {
  it("round-trips type and id, including values that themselves contain a space", () => {
    for (const [type, id] of [
      ["articles", "1"],
      ["with space", "also space"],
      ["<script>", '"><img src=x onerror=alert(1)>'],
      ["__proto__", "constructor"],
    ]) {
      const marker = `${type}${String.fromCharCode(0)}${id}`;
      expect(parseReqResourceMarker(marker)).toEqual({ type, id });
    }
  });

  it("returns null for a marker with no separator", () => {
    expect(parseReqResourceMarker("no-separator-here")).toBeNull();
  });
});

describe("renderBodyPart — dispatch", () => {
  it("renders nothing for an absent or blank body", () => {
    expect(renderBodyPart(undefined)).toBeNull();
    expect(renderBodyPart({ raw: "" })).toBeNull();
    expect(renderBodyPart({ raw: "   " })).toBeNull();
  });

  it("renders a form-urlencoded body as a parameter table, not an attempted JSON parse", () => {
    const el = renderBodyPart({ raw: "a=1&b=2", contentType: "application/x-www-form-urlencoded" });
    expect(el?.querySelectorAll(".xrow--param")).toHaveLength(2);
  });

  it("renders unparseable text declared as JSON with a visible parse-error note, and still shows the raw text", () => {
    const el = renderBodyPart({ raw: "{not valid", contentType: "application/json" });
    expect(el?.querySelector(".xrow__note--conflict")).not.toBeNull();
    expect(el?.textContent).toContain("{not valid");
  });

  it("renders non-JSON text with no content type as plain text and no error note", () => {
    const el = renderBodyPart({ raw: "hello, world" });
    expect(el?.querySelector(".xrow__note--conflict")).toBeNull();
    expect(el?.textContent).toContain("hello, world");
  });
});

describe("renderBodyPart — hostile values never become markup or pollute Object.prototype", () => {
  for (const value of HOSTILE) {
    it(`keeps ${JSON.stringify(value)} as inert text in a JSON:API request body`, () => {
      const raw = JSON.stringify({ data: { type: value, id: value, attributes: { name: value } } });
      const el = renderBodyPart({ raw, contentType: "application/json" });
      expect(el).not.toBeNull();
      expect(el!.querySelector("script")).toBeNull();
      expect(el!.querySelector("img")).toBeNull();
      expect(el!.textContent).toContain(value);
      // The identity that matters most: rendering never wrote through a
      // hostile key onto a plain object anywhere in the pipeline (`byKey`,
      // `groups`, `seen`/`anchored` tracking, etc. are all `Map`/`Set` for
      // exactly this reason — see `render-request.ts`'s header).
      expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(Object.prototype, "polluted")).toBe(false);
    });

    it(`keeps ${JSON.stringify(value)} as inert text in a header row, and never as a plain-object key collision`, () => {
      const exchange: Exchange = {
        request: { headers: headerSet([{ name: value, value }]) },
      };
      const band = renderExchangeBand({ exchange, mode: "request", currentDocument: null });
      expect(band).not.toBeNull();
      expect(band!.querySelector("script")).toBeNull();
      expect(band!.textContent).toContain(value);
      expect(Object.prototype.hasOwnProperty.call(Object.prototype, "polluted")).toBe(false);
    });
  }

  it("never renders a javascript: or data: URL as a clickable href", () => {
    for (const url of ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>"]) {
      const band = renderExchangeBand({ exchange: { request: { url } }, mode: "request", currentDocument: null });
      const link = band!.querySelector(".xurl__origin a");
      expect(link).toBeNull();
      expect(band!.textContent).toContain(url);
    }
  });

  it("does render an http(s) URL as a real link", () => {
    const band = renderExchangeBand({
      exchange: { request: { url: "https://api.example.com/trips" } },
      mode: "request",
      currentDocument: null,
    });
    const link = band!.querySelector<HTMLAnchorElement>(".xurl__origin a");
    // The href is the full, real URL (so the link actually opens the right
    // page); only the *display text* is shortened to the origin, with the
    // path split out beside it — see `renderUrlBlock`.
    expect(link?.getAttribute("href")).toBe("https://api.example.com/trips");
    expect(link?.textContent).toBe("https://api.example.com");
  });
});

describe("D1 — a request-body document and the response share every identity with no duplicate DOM id", () => {
  /** A `type`/`id` pair chosen to look like the encoded body of the other scope. */
  const IDENTITY_CORPUS: [string, string][] = [
    ["articles", "1"],
    ["with space", "also/slash"],
    ["<script>alert(1)</script>", '"><img src=x onerror=alert(1)>'],
    ["__proto__", "constructor"],
    ["b_articles__1", "r_articles__1"], // deliberately shaped like another scope's own minted id
  ];

  it("JSON:API: b_ (request body) and r_/g_ (response) never collide, over a hostile corpus", () => {
    for (const [type, id] of IDENTITY_CORPUS) {
      const shared = { type, id };
      const responseDoc = doc({ data: shared, included: [{ type: "people", id: "9" }] });
      const responseIndex = buildIndex(responseDoc);
      const responseHtml = groupsHtml(responseIndex);

      const requestBody = { raw: JSON.stringify({ data: shared }), contentType: "application/json" };
      const requestEl = renderBodyPart(requestBody);

      const host = document.createElement("div");
      host.innerHTML = responseHtml;
      host.append(requestEl!);
      document.body.append(host);

      const ids = [...host.querySelectorAll("[id]")].map((n) => n.id);
      expect(new Set(ids).size, `duplicate id for ${JSON.stringify([type, id])}: ${ids.join(", ")}`).toBe(ids.length);
      // The request-body identity is independently reachable under its own
      // `b_` id — not merely "no collision", but an actual, distinct anchor.
      expect(host.querySelector(`#${CSS.escape(requestResourceDomId(type, id))}`)).not.toBeNull();

      host.remove();
    }
  });

  it("plain JSON: d_ (request body) and n_ (response) never collide even from identical pointers", () => {
    const shared = doc({ items: [{ id: "1" }, { id: "2" }] });

    const responseIndex = buildJsonIndex(shared, "plain", { kind: "plain-object" });
    const responseAnnotations = buildAnnotations(responseIndex);
    const responseEl = renderJsonGroups(responseIndex, responseAnnotations);

    const requestEl = renderBodyPart({ raw: JSON.stringify(shared), contentType: "application/json" })!;

    const host = document.createElement("div");
    host.append(responseEl, requestEl);
    document.body.append(host);

    const ids = [...host.querySelectorAll("[id]")].map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(host.querySelector(`#${CSS.escape(requestNodeDomId("/items"))}`)).not.toBeNull();

    host.remove();
  });
});

// The redaction/seal/open round trip moved out to its own file, pinned to
// the Node test environment — jsdom's `Blob` has no `.stream()` at all, which
// `crypto.ts#gzip` needs. See `test/exchange-redaction.test.ts`.
//
// (Deliberately not spelling out *which* environment-override comment that
// file starts with, here in a plain comment: Vitest's docblock scanner reads
// that exact two-word directive anywhere it appears in a file, not only in a
// leading docblock — writing it out in prose here previously made this whole
// file silently run without a DOM and fail 19 tests with "document is not
// defined". Say what it did wrong, never how, if this comment is edited again.
