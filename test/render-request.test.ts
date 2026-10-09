import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  effectiveMode,
  hasExchangeContent,
  parseReqResourceMarker,
  canBeHost,
  parseRequestUrl,
  resolveSecret,
  secretRef,
  toggleMaskedValue,
  readBodyLens,
  renderBodyPart,
  renderExchangeBand,
  requestBodyJsonApiIndex,
  requestBodyRoot,
  responseReferenceTime,
} from "../src/render-request.js";
import { t } from "../src/i18n/index.js";
import { typeIntoForm, resetModalRoot } from "./helpers/type-into-form.js";
import { requestResourceDomId, requestNodeDomId } from "../src/ident.js";
import { buildIndex } from "../src/parse.js";
import { groupsHtml } from "../src/render-document.js";
import { buildJsonIndex } from "../src/json-index.js";
import { buildAnnotations, renderJsonGroups } from "../src/render-json.js";
import { headerSet } from "../src/headers.js";
import { decodeParams } from "../src/params.js";import type { Exchange } from "../src/exchange.js";
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

  /*
   * A scheme that was given and is invalid is not a missing scheme.
   * `ht!tp://[not a url]` used to fall through to the assumed-scheme attempt,
   * where `https://ht!tp://…` parses — so the review showed the origin
   * `https://ht!tp`, which no request ever went to, captioned "No scheme was
   * given". The caller renders the raw text with an "unparseable" note when
   * this returns null, which is the honest answer.
   */
  it("does not invent an origin for a malformed scheme", () => {
    expect(parseRequestUrl("ht!tp://[not a url]:99999/path?a=%ZZ&b")).toBeNull();
    expect(parseRequestUrl("ht!tp://example.com")).toBeNull();
    expect(parseRequestUrl("2http://example.com")).toBeNull();
  });

  it("still assumes a scheme for a bare host, and is not confused by a colon further along", () => {
    // The other half of the fix: refusing a *claimed* scheme must not stop the
    // ordinary bare-host case from getting one assumed.
    expect(parseRequestUrl("api.example.com/x")?.assumedScheme).toBe(true);
    // A colon inside the query is past the first slash, so it is not a scheme.
    expect(parseRequestUrl("api.example.com/go?to=https://x")?.assumedScheme).toBe(true);
    expect(parseRequestUrl("api.example.com/go?to=https://x")?.url.href).toBe(
      "https://api.example.com/go?to=https://x",
    );
  });

  it("assumes a scheme for a bare IPv6 host, whose own colons are not a scheme", () => {
    // Review of #23, blocker. The first colon in `[::1]:8080` belongs to the
    // address, not to a port, so reading it as a malformed scheme rejected
    // every bare IPv6 URL — with or without a port — where both used to work.
    expect(parseRequestUrl("[::1]/x")?.url.href).toBe("https://[::1]/x");
    expect(parseRequestUrl("[::1]:8080/x")?.url.href).toBe("https://[::1]:8080/x");
    expect(parseRequestUrl("[2001:db8::1]:443/v2/articles")?.assumedScheme).toBe(true);
    // Round two of the same blocker: an empty port ends the authority in a
    // colon, which is also how `scheme://` ends. The `//` is what tells them
    // apart, and without requiring it these two regressed while the cases
    // above were passing.
    expect(parseRequestUrl("[::1]:")?.url.href).toBe("https://[::1]/");
    expect(parseRequestUrl("[::1]:/x")?.url.href).toBe("https://[::1]/x");
  });

  it("does not mistake a URL in the query for the authority", () => {
    // Review of #23, round three. The authority was taken as everything before
    // the first `/` — but a bare host with no path has no `/` before its query,
    // so `example.com?a=http://x` ran into the embedded `://` and the whole
    // thing was read as claiming a scheme. An OAuth `redirect_uri` is exactly
    // this shape.
    expect(parseRequestUrl("example.com?a=http://evil.com")?.url.origin).toBe("https://example.com");
    expect(parseRequestUrl("example.com#a:b")?.url.origin).toBe("https://example.com");
    expect(parseRequestUrl("[::1]?to=https://x")?.url.origin).toBe("https://[::1]");
  });

  /*
   * The property F5 is actually about, asserted over a generated corpus rather
   * than a list somebody thought of: **a host that was never named.**
   *
   * Three rounds of review went by fixing one input and breaking its neighbour,
   * because each fix was checked against cases chosen by hand. This is the
   * invariant those cases were all circling.
   */
  it("never returns a host the input did not name", () => {
    const schemes = ["", "http://", "https://", "HTTP://", "ht!tp://", "2http://", "a+b-c.d://", "mailto:", "http:"];
    const authorities = [
      "example.com", "example.com:8080", "example.com:", "example.com:abc", "192.0.2.1",
      "[::1]", "[::1]:8080", "[::1]:", "[2001:db8::1]:443", "user@example.com",
      "user:pass@example.com", "xn--80ak6aa92e.com", "example.com.", "", "x",
    ];
    const tails = ["", "/", "//", "/p", "?a=1", "?a=http://evil.com", "#f", "#a:b", "/p?a=http://evil.com", "?a=1#f"];

    // Skipping every `null` makes the sweep satisfiable by refusing everything —
    // reverting the `?`/`#` split left this test green for exactly that reason.
    // These must come back with an origin, whatever else changes.
    for (const mustParse of [
      "example.com?a=http://evil.com",
      "example.com#a:b",
      "example.com?a=1#f",
      "[::1]?to=https://x",
      "api.example.com/go?to=https://x",
      "example.com",
    ]) {
      expect(parseRequestUrl(mustParse)?.url.origin, mustParse).toBeTruthy();
    }

    let parsedCount = 0;
    for (const scheme of schemes) {
      for (const authority of authorities) {
        for (const tail of tails) {
          const input = scheme + authority + tail;
          const parsed = parseRequestUrl(input);
          if (!parsed) continue;
          parsedCount++;
          // An empty host is an opaque URL (`mailto:`, `api.example.com:8080`),
          // which names nothing and invents nothing.
          if (parsed.url.host === "") continue;
          expect(input.toLowerCase(), input).toContain(parsed.url.host.toLowerCase());

          // Substring is not enough on its own: `ht!tp` *is* a substring of
          // `ht!tp://x`, so the check above passed while the scheme was being
          // served as the host — the exact defect. When the text writes
          // `X://…`, X is a scheme and must not come back as the host. A
          // bracketed literal is exempt: `[::1]` is an address, not a scheme.
          const beforeSlashes = input.includes("://") ? input.slice(0, input.indexOf("://")) : null;
          if (beforeSlashes !== null && beforeSlashes !== "" && !beforeSlashes.startsWith("[")) {
            expect(parsed.url.host.toLowerCase(), input).not.toBe(beforeSlashes.toLowerCase());
          }
        }
      }
    }
    // Guards the loop itself: a corpus that parses nothing asserts nothing.
    expect(parsedCount).toBeGreaterThan(200);
  });

  it("reads a bracketed literal as a host, never as a scheme", () => {
    // `[::1]://` ends its authority in a colon, which is also how `scheme://`
    // ends — so the scheme branch caught it and an address became unparseable.
    // An IPv6 literal is a host by definition; nothing else pinned this.
    expect(parseRequestUrl("[::1]://")?.url.origin).toBe("https://[::1]");
    expect(parseRequestUrl("[::1]://x")?.url.origin).toBe("https://[::1]");
  });

  it("reads `host:port` as a host and a port (changed in QA6; it used to be an opaque `api.example.com:` URL)", () => {
    // `api.example.com` is a syntactically valid scheme, so `new URL` accepted
    // `api.example.com:8080/x` on the first attempt — origin "null", nothing to
    // link — and this test pinned that as "not something this fix changes".
    // QA6's boundary pass listed `localhost:8080` as a genuine scheme-less host,
    // which is what `claimsScheme`'s own comment says it should be: digits after
    // the colon are a port. Anything else after a colon is still a scheme.
    const parsed = parseRequestUrl("api.example.com:8080/x");
    expect(parsed?.assumedScheme).toBe(true);
    expect(parsed?.url.href).toBe("https://api.example.com:8080/x");
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

describe("parseRequestUrl: only text that could be a host gets an assumed scheme (QA6)", () => {
  const linked: Array<[string, string]> = [
    ["api.example.com/v2/x", "https://api.example.com/v2/x"],
    ["localhost:8080", "https://localhost:8080/"],
    ["localhost:8080/a?b=1", "https://localhost:8080/a?b=1"],
    ["intranet", "https://intranet/"],
    ["[::1]:8080/x", "https://[::1]:8080/x"],
    ["[2001:db8::1]/x", "https://[2001:db8::1]/x"],
    ["münchen.de/x", "https://xn--mnchen-3ya.de/x"],
    ["api.example.com./x", "https://api.example.com./x"],
    ["user@api.example.com/x", "https://user@api.example.com/x"],
    ["my_host.example.com", "https://my_host.example.com/"],
    ["192.0.2.1:3000", "https://192.0.2.1:3000/"],
  ];
  for (const [input, href] of linked) {
    it(`links ${JSON.stringify(input)} under an assumed https`, () => {
      const parsed = parseRequestUrl(input);
      expect(parsed?.assumedScheme).toBe(true);
      expect(parsed?.url.href).toBe(href);
    });
  }

  const text = [
    "not a url",
    "a b.com/x",
    ":8080/x",
    "user@",
    "a..b",
    ".example.com",
    "%20.com",
    "ex ample",
    "[::1",
    "[nothex]/x",
  ];
  for (const input of text) {
    it(`keeps ${JSON.stringify(input)} as text`, () => {
      expect(parseRequestUrl(input)).toBeNull();
    });
  }

  it("still refuses a claimed-but-invalid scheme and a bare path, and still accepts a given scheme", () => {
    expect(parseRequestUrl("ht!tp://example.com")).toBeNull();
    expect(parseRequestUrl("/just/a/path")).toBeNull();
    expect(parseRequestUrl("https://a.example/x")?.assumedScheme).toBe(false);
  });

  it("a port above 65535 is the URL parser's to refuse", () => {
    expect(parseRequestUrl("host:99999/x")).toBeNull();
  });

  it("host:notaport is a scheme, not a host — read as given, never an assumed https, never a link", () => {
    // Digits after the colon make a port; anything else is something trying to
    // be a scheme (`claimsScheme`'s rule), so it is not given an https it did
    // not claim.
    for (const input of ["host:notaport", "api.example.com:80:80"]) {
      expect(parseRequestUrl(input)?.assumedScheme).toBe(false);
      const band = renderExchangeBand({ exchange: { request: { url: input } }, mode: "request", currentDocument: null });
      expect(band!.querySelector(".xurl a")).toBeNull();
    }
  });

  it("renders text with the unparseable note and no link, and never the assumed-scheme note", () => {
    const band = renderExchangeBand({ exchange: { request: { url: "not a url" } }, mode: "request", currentDocument: null });
    expect(band!.querySelector(".xurl a")).toBeNull();
    expect(band!.textContent).toContain("not a url");
    expect(band!.textContent).toContain(t().request.review.urlUnparseable);
    expect(band!.textContent).not.toContain("assumed");
  });

  it("the new host:port branch can only ever produce an https link; a given scheme is never linked (S6)", () => {
    const hrefOf = (url: string) => {
      const band = renderExchangeBand({ exchange: { request: { url } }, mode: "request", currentDocument: null });
      return band!.querySelector<HTMLAnchorElement>(".xurl a")?.getAttribute("href") ?? null;
    };
    for (const input of ["javascript:1", "JAVASCRIPT:1", "data:123", "tel:555"]) {
      const href = hrefOf(input);
      expect(href, input).not.toBeNull();
      expect(href!.startsWith("https://"), input).toBe(true);
    }
    expect(hrefOf("javascript:alert(1)")).toBeNull();
    expect(hrefOf("data:text/html,<script>alert(1)</script>")).toBeNull();
    // `tel:5551234` is a port above 65535, so it is text; `tel:555` is the linked case.
    expect(parseRequestUrl("tel:5551234")).toBeNull();
    expect(parseRequestUrl("tel:555")?.url.href).toBe("https://tel:555/");
  });

  it("canBeHost is a shape check on the authority only", () => {
    expect(canBeHost("example.com/a b c")).toBe(true);
    expect(canBeHost("example.com?q=a b")).toBe(true);
    expect(canBeHost("")).toBe(false);
  });
});

describe("masked values are not in the DOM until revealed (QA6)", () => {
  const TOKEN = "qa-fake-bearer-9f3a1c-not-real";
  const COOKIE = "qa-fake-session-7b2e-not-real";
  const SETCOOKIE = "qa-fake-setcookie-4d8a-not-real";
  const exchange: Exchange = {
    request: {
      headers: headerSet([
        { name: "Authorization", value: `Bearer ${TOKEN}` },
        { name: "Accept", value: "application/vnd.api+json" },
      ]),
      cookies: { entries: [{ name: "session", value: COOKIE }] },
    },
    response: { status: 200, cookies: { entries: [{ name: "sid", value: SETCOOKIE }] } },
  };

  const mount = (ex: Exchange = exchange) => {
    const band = renderExchangeBand({ exchange: ex, mode: "both", currentDocument: null })!;
    document.body.replaceChildren(band);
    return band;
  };
  const toggles = () => Array.from(document.querySelectorAll<HTMLElement>(".xmask__toggle"));
  const everywhere = () => {
    // text, markup, and every attribute of every element: "the DOM" is all three.
    const attrs = Array.from(document.querySelectorAll("*")).flatMap((n) =>
      Array.from(n.attributes).map((a) => a.value),
    );
    return [document.body.textContent, new XMLSerializer().serializeToString(document.body), ...attrs].join("\n");
  };

  it("renders only the mask for each secret, and the ordinary header in full", () => {
    mount();
    const all = everywhere();
    for (const secret of [TOKEN, COOKIE, SETCOOKIE]) expect(all).not.toContain(secret);
    expect(document.body.textContent).toContain("application/vnd.api+json");
    expect(toggles()).toHaveLength(3);
    expect(document.querySelectorAll(".xmask__dots")).toHaveLength(3);
    expect(document.querySelectorAll(".xmask[data-x-secret] .xmask__value")).toHaveLength(0);
  });

  it("reveals one value, and only that one, from the exchange", () => {
    mount();
    toggleMaskedValue(toggles()[0]!, exchange);
    expect(document.body.textContent).toContain(TOKEN);
    expect(document.body.textContent).not.toContain(COOKIE);
    expect(document.body.textContent).not.toContain(SETCOOKIE);
    expect(document.querySelectorAll(".xmask[data-x-secret] .xmask__value")).toHaveLength(1);
  });

  it("hides again by removing the text from the DOM, and can reveal a second time", () => {
    mount();
    const button = toggles()[0]!;
    toggleMaskedValue(button, exchange);
    toggleMaskedValue(button, exchange);
    expect(everywhere()).not.toContain(TOKEN);
    expect(document.querySelectorAll(".xmask[data-x-secret] .xmask__value")).toHaveLength(0);
    toggleMaskedValue(button, exchange);
    expect(document.body.textContent).toContain(TOKEN);
    expect(document.body.textContent!.split(TOKEN)).toHaveLength(2); // exactly one copy
  });

  it("keeps the toggle a real button with a translated name that follows its state", () => {
    mount();
    const button = toggles()[0]!;
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("aria-label")).toBe(t().request.review.revealLabel);
    expect(button.hasAttribute("aria-pressed")).toBe(false); // one pattern: the name flips (S3)
    toggleMaskedValue(button, exchange);
    expect(button.getAttribute("aria-label")).toBe(t().request.review.hideLabel);
    expect(button.textContent).toBe(t().request.review.hide);
    expect(button.hasAttribute("aria-pressed")).toBe(false);
    expect(t().request.review.hideLabel).not.toBe(t().request.review.revealLabel);
  });

  it("puts a hostile value in the DOM as text, never as markup", () => {
    const hostile = '"><img src=x onerror=alert(1)><script>alert(2)</script>';
    const ex: Exchange = { request: { headers: headerSet([{ name: "Authorization", value: hostile }]) } };
    mount(ex);
    expect(everywhere()).not.toContain("onerror");
    toggleMaskedValue(toggles()[0]!, ex);
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector(".xmask__value")!.textContent).toBe(hostile);
  });

  it("shows nothing when the exchange no longer has the entry the locator points at", () => {
    mount();
    toggleMaskedValue(toggles()[0]!, { request: { headers: headerSet([]) } });
    expect(document.querySelectorAll(".xmask[data-x-secret] .xmask__value")).toHaveLength(0);
    expect(toggles()[0]!.getAttribute("aria-label")).toBe(t().request.review.revealLabel);
  });

  it("a rebuilt band is masked again, and a duplicate header is located by position", () => {
    const dup: Exchange = {
      request: {
        headers: headerSet([
          { name: "Authorization", value: "Bearer first-fake-not-real" },
          { name: "Authorization", value: "Bearer second-fake-not-real" },
        ]),
      },
    };
    mount(dup);
    toggleMaskedValue(toggles()[1]!, dup);
    expect(document.body.textContent).toContain("second-fake-not-real");
    expect(document.body.textContent).not.toContain("first-fake-not-real");
    mount(dup);
    expect(everywhere()).not.toContain("second-fake-not-real");
  });

  it("resolveSecret accepts only its own locator format", () => {
    expect(resolveSecret(exchange, secretRef("req", "header", 0))).toBe(`Bearer ${TOKEN}`);
    expect(resolveSecret(exchange, secretRef("req", "cookie", 0))).toBe(COOKIE);
    expect(resolveSecret(exchange, secretRef("res", "cookie", 0))).toBe(SETCOOKIE);
    for (const bad of ["", "req.header.9", "req.header.-1", "req.header.0.x", "__proto__", "req.body.0", "res.header.0"]) {
      expect(resolveSecret(exchange, bad)).toBeNull();
    }
  });
});

describe("an invalid-JSON request body reads as text, in every language (QA6)", () => {
  // `DocumentError.hint` is `string | RichPart[]`; interpolating it printed
  // `[object Object]`. The locale is memoised on first use, so each language gets
  // a fresh module graph with its choice already stored.
  for (const lang of ["en", "de", "uk"] as const) {
    it(`${lang}: headline and hint are readable, nothing is [object Object], and the raw text stays`, async () => {
      vi.resetModules();
      localStorage.setItem("jsonapi-lens:locale", lang);
      try {
        const { renderBodyPart: render } = await import("../src/render-request.js");
        const i18n = await import("../src/i18n/index.js");
        expect(i18n.locale()).toBe(lang);
        const hostile = '{"a": <img src=x onerror=alert(1)>';
        const el = render({ raw: hostile, contentType: "application/json" });
        const note = el?.querySelector(".xrow__note--conflict");
        expect(note).not.toBeNull();
        expect(note!.textContent).not.toContain("[object Object]");
        expect(note!.textContent!.trim().length).toBeGreaterThan(15);
        // The JS engine's own English message must not reach any language (S9).
        expect(note!.textContent).not.toMatch(/Expected|Unexpected|position \d|property name|JSON\.parse/);
        // the note is catalogue text plus text nodes; the payload is only in the <pre>
        expect(el!.querySelector("img")).toBeNull();
        expect(el!.querySelector("pre")!.textContent).toBe(hostile);
      } finally {
        localStorage.setItem("jsonapi-lens:locale", "en");
        vi.resetModules();
      }
    });
  }
});

describe("the band's redaction caveat says what redaction does, and no more (QA6)", () => {
  it("redactExchange does everything the caveat claims, and does not rewrite a JSON body", async () => {
    const { redactExchange } = await import("../src/secrets.js");
    const form = "a=1&client_secret=qa-fake-form-not-real";
    const json = '{"password":"qa-fake-json-not-real"}';
    const { exchange } = redactExchange({
      request: {
        url: "https://user:qa-fake-pw-not-real@api.example.com/x?api_key=qa-fake-key-0123456789-not-real",
        headers: headerSet([{ name: "Authorization", value: "Bearer qa-fake-not-real" }]),
        cookies: { entries: [{ name: "s", value: "qa-fake-cookie-not-real" }] },
        body: { raw: form, contentType: "application/x-www-form-urlencoded" },
      },
      response: { body: { raw: json, contentType: "application/json" } },
    });
    const out = JSON.stringify(exchange);
    for (const fake of ["qa-fake-not-real", "qa-fake-cookie", "qa-fake-pw", "qa-fake-key", "qa-fake-form"]) {
      expect(out, fake).not.toContain(fake);
    }
    expect(exchange.response?.body?.raw).toBe(json); // "not rewritten", as the caveat says
  });

  const words = {
    en: ["user name", "form", "JSON", "review"],
    de: ["Benutzername", "Formular", "JSON", "prüfen"],
    uk: ["імʼя користувача", "форм", "JSON", "перегляньте"],
  } as const;
  for (const lang of ["en", "de", "uk"] as const) {
    it(`${lang}: the caveat names userinfo, form bodies and the unrewritten JSON body, and no longer says the URL is not scanned`, async () => {
      vi.resetModules();
      localStorage.setItem("jsonapi-lens:locale", lang);
      try {
        const { t: tt } = await import("../src/i18n/index.js");
        const text = tt().request.band.redactionCaveat;
        for (const word of words[lang]) expect(text, word).toContain(word);
        expect(text).not.toMatch(/does not scan the body or the URL|Body und URL werden nicht|не перевіряються/);
      } finally {
        localStorage.setItem("jsonapi-lens:locale", "en");
        vi.resetModules();
      }
    });
  }
});

describe("URL and parameter credentials are masked on screen until revealed (QA6 gap A)", () => {
  const PW = "qa-fake-urlpw-0004-not-real";
  const KEY = "qa-fake-urlkey-0003-not-real";
  const FORM = "qa-fake-formsecret-0005-not-real";
  const exchange: Exchange = {
    request: {
      method: "POST",
      url: `https://admin:${PW}@api.example.com/v2/x?api_key=${KEY}&page=2`,
      query: decodeParams(`api_key=${KEY}&page=2`),
      body: { raw: `a=1&client_secret=${FORM}`, contentType: "application/x-www-form-urlencoded" },
    },
  };
  const mount = () => {
    const band = renderExchangeBand({ exchange, mode: "request", currentDocument: null })!;
    document.body.replaceChildren(band);
    return band;
  };
  const everything = () =>
    [
      document.body.textContent,
      new XMLSerializer().serializeToString(document.body),
      ...Array.from(document.querySelectorAll("*")).flatMap((n) => Array.from(n.attributes).map((a) => a.value)),
    ].join("\n");

  it("keeps the password, the key and the form secret out of text, markup, hrefs and tooltips", () => {
    mount();
    const all = everything();
    for (const secret of [PW, KEY, FORM]) expect(all, secret).not.toContain(secret);
    // what *is* readable: the host, the ordinary parameter, the parameter names
    expect(all).toContain("api.example.com");
    expect(all).toContain("page");
    expect(all).toContain("client_secret");
    expect(document.querySelector(".xurl a")).toBeNull();
    expect(document.querySelector(".xband__url")!.textContent).toContain("[REDACTED]@api.example.com");
  });

  it("reveals the URL as a real link with its full href, and hides it again", () => {
    mount();
    const urlToggle = document.querySelector<HTMLElement>('.xmask[data-x-secret="req.url"] .xmask__toggle')!;
    toggleMaskedValue(urlToggle, exchange);
    const link = document.querySelector<HTMLAnchorElement>(".xurl a");
    expect(link?.getAttribute("href")).toContain(`${PW}@api.example.com`);
    toggleMaskedValue(urlToggle, exchange);
    expect(document.querySelector(".xurl a")).toBeNull();
    expect(document.querySelector(".xurl")!.textContent).not.toContain(PW);
  });

  it("reveals one query parameter, and one form-body parameter, from the exchange", () => {
    mount();
    const toggle = (ref: string) =>
      document.querySelector<HTMLElement>(`.xmask[data-x-secret="${ref}"] .xmask__toggle`)!;
    toggleMaskedValue(toggle("req.query.0"), exchange);
    expect(document.body.textContent).toContain(KEY);
    expect(document.body.textContent).not.toContain(FORM);
    toggleMaskedValue(toggle("req.body.1"), exchange);
    expect(document.body.textContent).toContain(FORM);
    toggleMaskedValue(toggle("req.query.0"), exchange);
    expect(document.body.textContent).not.toContain(KEY);
  });

  it("a URL with nothing to hide is a plain link, with no reveal control", () => {
    const band = renderExchangeBand({
      exchange: { request: { url: "https://api.example.com/v2/x?page=2" } },
      mode: "request",
      currentDocument: null,
    })!;
    document.body.replaceChildren(band);
    expect(document.querySelector<HTMLAnchorElement>(".xurl a")?.getAttribute("href")).toBe("https://api.example.com/v2/x?page=2");
    expect(document.querySelector('[data-x-secret="req.url"]')).toBeNull();
  });

  it("shows a scheme-only URL as typed, never as `null` plus the rest, and never as a link", () => {
    for (const url of ["host:notaport", "javascript:alert(1)"]) {
      const band = renderExchangeBand({ exchange: { request: { url } }, mode: "request", currentDocument: null })!;
      document.body.replaceChildren(band);
      const line = document.querySelector(".xurl")!;
      expect(line.textContent, url).toBe(url);
      expect(line.querySelector("a"), url).toBeNull();
    }
  });
});

describe("the invalid-JSON body note always has a hint, with no engine text (QA6 finding 4)", () => {
  for (const lang of ["en", "de", "uk"] as const) {
    it(`${lang}: a body of {"a": } shows a translated headline and a translated hint`, async () => {
      vi.resetModules();
      localStorage.setItem("jsonapi-lens:locale", lang);
      try {
        const { renderBodyPart: render } = await import("../src/render-request.js");
        const { t: tt } = await import("../src/i18n/index.js");
        const el = render({ raw: '{"a": }', contentType: "application/json" });
        const note = el!.querySelector(".xrow__note--conflict")!;
        expect(note.querySelector(".xrow__note-hint")!.textContent).toBe(tt().request.review.invalidJsonBody);
        expect(note.textContent).not.toMatch(/Expected|Unexpected|position \d/);
      } finally {
        localStorage.setItem("jsonapi-lens:locale", "en");
        vi.resetModules();
      }
    });
  }
});

describe("the screen masks what the share masks, for every shape the real form produces (QA6 review B4, S10)", () => {
  const dom = () => {
    const attrs = Array.from(document.querySelectorAll("*")).flatMap((n) => Array.from(n.attributes).map((a) => a.value));
    return [document.body.textContent, new XMLSerializer().serializeToString(document.body), ...attrs].join("\n");
  };
  beforeEach(resetModalRoot);
  const show = (exchange: Exchange) => {
    const band = renderExchangeBand({ exchange, mode: "request", currentDocument: null })!;
    document.body.replaceChildren(band);
    return band;
  };
  const press = (exchange: Exchange, selector = ".xmask__toggle") => {
    for (const b of document.querySelectorAll<HTMLElement>(selector)) toggleMaskedValue(b, exchange);
  };

  for (const contentType of ["application/x-www-form-urlencoded", "", "text/plain"]) {
    it(`a form body with content type ${JSON.stringify(contentType)}: the password is not on screen until revealed`, () => {
      const exchange = typeIntoForm({ contentType, body: "username=alice&password=qa-fake-screen-pw-not-real" });
      show(exchange);
      expect(dom()).not.toContain("qa-fake-screen-pw");
      expect(dom()).toContain("alice");
      expect(document.querySelectorAll(".xrow--param").length).toBe(2);
      press(exchange);
      expect(document.body.textContent).toContain("qa-fake-screen-pw-not-real");
    });
  }

  it("a JSON body labelled as a form is not drawn as a parameter table, and is not called safe", () => {
    const exchange = typeIntoForm({ contentType: "application/x-www-form-urlencoded", body: '{"password":"qa-fake-j"}' });
    show(exchange);
    expect(document.querySelectorAll(".xrow--param").length).toBe(0);
  });

  const rawUrls: Array<[string, string]> = [
    ["a scheme-less user:password@host", "admin:qa-fake-urlpw-s-not-real@api.example.com/x"],
    ["an unparseable URL with a credential query", "not a url?api_key=qa-fake-urlkey-s-not-real"],
    ["a scheme-only URL with a credential query", "javascript:alert(1)//?token=qa-fake-tok-s-0123456789-not-real"],
  ];
  for (const [name, url] of rawUrls) {
    it(`${name}: masked in the line and the summary, revealable, no href`, () => {
      const exchange = typeIntoForm({ url });
      show(exchange);
      expect(dom()).not.toContain("qa-fake-");
      expect(document.querySelector(".xband__url")!.textContent).toMatch(/REDACTED/);
      expect(document.querySelector('.xmask[data-x-secret="req.url"]')).not.toBeNull();
      press(exchange);
      expect(document.querySelector(".xurl")!.textContent).toContain(url);
      expect(document.querySelector(".xurl a")).toBeNull(); // never linked
    });
  }

  it("Location, Referer, Content-Location and Origin: shown redacted with a reveal when they carry a credential, plain when clean", () => {
    const exchange = typeIntoForm({
      headers: [
        ["Origin", "https://u:qa-fake-o-pw-not-real@o.example.com"],
        ["Referer", "https://r.example.com/p?access_token=qa-fake-r-tok-0123456789-not-real"],
        ["Location", "https://l.example.com/cb?state=1"],
        ["Content-Location", "/v2/x?token=qa-fake-cl-tok-0123456789-not-real"],
      ],
    });
    show(exchange);
    expect(dom()).not.toContain("qa-fake-");
    expect(document.body.textContent).toContain("https://l.example.com/cb?state=1"); // clean: shown as is
    expect(document.querySelectorAll(".xmask__toggle")).toHaveLength(3);
    press(exchange);
    expect(document.body.textContent).toContain("qa-fake-o-pw-not-real");
    expect(document.body.textContent).toContain("qa-fake-r-tok");
    expect(document.body.textContent).toContain("qa-fake-cl-tok");
  });
});
