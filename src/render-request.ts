/**
 * Rendering an `Exchange` — the band above the overview, collapsed to one
 * line, and the three-mode review it opens into. `docs/task-specs/T2.md`'s
 * "form" subsection, "review", "anchors" and part of "persistence" sections;
 * T2a's `exchange.ts`/`params.ts`/`headers.ts`/`cookies.ts`/`secrets.ts` own
 * the model and the decoders this module only reads.
 *
 * ## Why this never builds an HTML string
 *
 * `render-resource.ts`'s bulk path builds HTML strings because a response can
 * hold 50,000 resources and per-node `createElement` is measurably too slow
 * at that size. A request or response an engineer hand-enters, or pastes from
 * a curl command, is never that — a handful of headers, a handful of query
 * parameters, at most a few resources in a body. So every function here
 * builds real DOM through `el()`, which means every interpolated value is
 * safe by construction (`textContent`/`setAttribute`, never `innerHTML`) and
 * there is no `escapeHtml` call anywhere in this file to audit — see
 * `docs/PROCESS.md` §4. The one place that still needs care is a URL turned
 * into an `href`: `safeAnchorHref` below is the scheme allowlist, because
 * `javascript:`/`data:` survive `setAttribute` exactly as well as they would
 * survive `escapeHtml`.
 *
 * ## Why request-body anchors cannot reuse `render-resource.ts`/`render-json.ts`
 *
 * `render-resource.ts#chip`/`chipHtml` and `parse.ts#buildIndex`'s own
 * `Resource.domId` field are hard-wired to the response's `r_`/`g_` scopes.
 * Reusing them for a request body would either mint the very collision D1
 * exists to prevent (a `POST` body and its response sharing `type:id`), or
 * require threading a scope parameter through the hot, heavily-tested
 * response render path for a feature that never needs more than a few dozen
 * nodes. So this module mints its own request-body chips and section ids,
 * directly from `ident.ts`'s `requestResourceDomId`/`requestResourceHref` —
 * the *data* (`byKey`, relationships, attributes) still comes from
 * `parse.ts#buildIndex`, unmodified; only the anchors are this module's own.
 *
 * The plain-JSON case is different: `json-index.ts#buildJsonIndex` and
 * `render-json.ts#buildAnnotations` both took a small, additive, optional
 * scope parameter as part of this task (defaulting to the response's `n_`
 * ids, so every existing caller is unaffected) specifically so this module
 * can pass `requestNodeDomId`/`requestNodeHref` instead and reuse the
 * collection/identity machinery verbatim rather than re-implementing
 * `looksLikeCollection`/`canonicalScope` — logic worth not duplicating.
 *
 * ## Why a request-body value's "copy" action cannot reuse `render-value.ts`'s as-is
 *
 * `renderObjectBlock`/`renderTopLevelValue` (`render-value.ts`) are reused
 * here unchanged for attribute/meta/tree rendering — they mint no anchors of
 * their own and are already generic. But they also embed `rowActions()`,
 * whose `data-copy`/`data-pointer` attributes are read by `main.ts`'s single
 * delegated handler on `docEl`, which resolves the pointer against
 * `current.lens.index.root` — the *response's* root. A request-body value
 * copied through that path would silently resolve against the wrong
 * document. So every request-body container this module renders carries
 * `data-req-root="true"` (`REQ_ROOT_ATTR`), and `main.ts` checks for that
 * ancestor *before* falling through to the response's own handling, resolving
 * against the request body's own parsed root instead — see
 * `requestBodyRoot` below, which `main.ts` calls to get that root back.
 *
 * ## What this module does not do
 *
 * No persistence (that is `main.ts`, via `store.ts`'s unchanged API), no
 * network (nothing here may — see `docs/PROCESS.md` §5), and no editing: the
 * form that produces an `Exchange` is `src/request-form.ts`. This module only
 * reads one and renders it.
 */

import { el } from "./dom.js";
import { t } from "./i18n/index.js";
import {
  requestFieldDomId,
  requestNodeDomId,
  requestNodeHref,
  requestResourceDomId,
  requestResourceHref,
  typeHue,
  typeSigil,
} from "./ident.js";
import { buildAnnotations, renderJsonGroups, renderJsonLeftover } from "./render-json.js";
import { buildJsonIndex } from "./json-index.js";
import { DocumentError, parseJson, readAny } from "./parse.js";
import { renderObjectBlock } from "./render-value.js";
import { formatBytes } from "./format.js";
import { getHeader } from "./headers.js";
import type { HeaderSet } from "./headers.js";
import type { CookieSet, SetCookie, SetCookieSet } from "./cookies.js";
import { decodeParams } from "./params.js";
import type { ParamEntry, ParamSet, ParamValue } from "./params.js";
import { decodeJwt, detectCredentialShape, shouldMaskHeader } from "./secrets.js";
import type { DecodedJwt } from "./secrets.js";
import type { BodyPart, Exchange, RequestPart, ResponsePart } from "./exchange.js";
import type { DocumentIndex, JsonIndex, JsonValue, Lens, Resource } from "./types.js";

/* ------------------------------------------------------------- attributes --- */

/**
 * The data attributes this module's markup carries, so `main.ts`'s delegated
 * click handler and this module agree on the exact strings without either
 * side hand-typing them twice. Every value here is a literal attribute name
 * (as `el()` receives it), not a `dataset` camelCase key.
 */
export const BAND_ACTION_ATTR = "data-x-action";
export const BAND_MODE_ATTR = "data-x-mode";
export const REVEAL_ATTR = "data-x-reveal";
/**
 * Marks the ancestor of a request-body value row. `render-value.ts#rowActions`
 * is reused as-is for request-body attributes, which means it still emits the
 * *same* `data-copy`/`data-pointer` attributes it always has — reused, not
 * reinvented, per this module's header. What changes is resolution: `main.ts`
 * checks for this ancestor before falling through to the response's own
 * `data-copy` handling, and resolves the pointer against `requestBodyRoot()`
 * instead of `current.lens.index.root` when it is present.
 */
export const REQ_ROOT_ATTR = "data-req-root";
export const REQ_OBJECT_ACTION_ATTR = "data-req-object-action";
export const REQ_RESOURCE_ATTR = "data-req-resource";
/**
 * Separator inside a `REQ_RESOURCE_ATTR` marker's `"<type><sep><id>"` value.
 * A NUL character, the same choice `json-index.ts#GLOBAL_IDENTITY_SCOPE` makes for
 * the same reason: a real JSON:API `type`/`id` essentially never contains a
 * NUL character, which a space or a hyphen genuinely can (see `ident.test.ts`'s
 * `HOSTILE` corpus — "with space" is a real test case). Built with
 * `String.fromCharCode`, not a literal control character in this file's own
 * source — a raw NUL byte on disk defeats `grep` and confuses editors.
 */
const REQ_RESOURCE_SEP = String.fromCharCode(0);

export type ReviewMode = "response" | "request" | "both";

/** Does this exchange carry anything at all — the "no band at all" gate. */
export function hasExchangeContent(exchange: Exchange): boolean {
  return exchange.request !== undefined || exchange.response !== undefined;
}

/**
 * The mode actually shown. `preferred` (the segmented control's last choice,
 * "both" by default) only applies when both parts exist — a single part
 * always selects its own mode, per the spec: "a single part selects its own
 * mode and the control is hidden."
 */
export function effectiveMode(exchange: Exchange, preferred: ReviewMode): ReviewMode {
  const hasReq = exchange.request !== undefined;
  const hasRes = exchange.response !== undefined;
  if (hasReq && hasRes) return preferred;
  return hasReq ? "request" : "response";
}

/* ------------------------------------------------------------------ time --- */

type RelativeUnit = "second" | "minute" | "hour" | "day";

/** Bucket a millisecond magnitude into the largest whole unit worth naming. Shared across languages so the thresholds cannot drift between them. */
function relativeMagnitude(deltaMs: number): { value: number; unit: RelativeUnit } {
  const totalSeconds = Math.round(Math.abs(deltaMs) / 1000);
  if (totalSeconds < 60) return { value: totalSeconds, unit: "second" };
  const minutes = Math.round(totalSeconds / 60);
  if (minutes < 60) return { value: minutes, unit: "minute" };
  const hours = Math.round(minutes / 60);
  if (hours < 24) return { value: hours, unit: "hour" };
  return { value: Math.round(hours / 24), unit: "day" };
}

const NOW_THRESHOLD_MS = 5000;

/** "in 3 days" / "3 days ago" / "just now" — for a cookie's `Expires`, relative to wall-clock now. */
function relativeToNow(deltaMs: number): string {
  if (Math.abs(deltaMs) < NOW_THRESHOLD_MS) return t().request.relative.now;
  const { value, unit } = relativeMagnitude(deltaMs);
  const text = t().request.relative.unit(value, unit);
  return deltaMs > 0 ? t().request.relative.inFuture(text) : t().request.relative.inPast(text);
}

/** "4 minutes before this call" / "at the time of this call" — for a JWT `exp`, relative to the response's own `Date` header. */
function relativeToCall(deltaMs: number): string {
  if (Math.abs(deltaMs) < NOW_THRESHOLD_MS) return t().request.relative.atCallTime;
  const { value, unit } = relativeMagnitude(deltaMs);
  const text = t().request.relative.unit(value, unit);
  return deltaMs > 0 ? t().request.relative.afterCall(text) : t().request.relative.beforeCall(text);
}

/** The response's own timestamp, per `exchange.ts`'s header comment: its `Date` header, parsed — `null` when absent or unparseable. */
export function responseReferenceTime(response: ResponsePart | undefined): number | null {
  const raw = response?.headers ? getHeader(response.headers, "date") : undefined;
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : parsed;
}

/* -------------------------------------------------------------- schemes --- */

/** `http`/`https`/`mailto` only — see this module's header for why an escape is not enough here. */
const LINKABLE_SCHEMES = new Set(["http:", "https:", "mailto:"]);

function safeAnchorHref(candidate: string): string | null {
  try {
    const url = new URL(candidate);
    return LINKABLE_SCHEMES.has(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export interface ParsedRequestUrl {
  url: URL;
  /** `true` when no scheme was present and `https://` was assumed to parse it. */
  assumedScheme: boolean;
}

/**
 * A request URL, tolerant of a missing scheme — `api.example.com/x` is
 * accepted with `https` assumed, per the spec's edge-case table. `null` when
 * nothing recognisable as a URL comes out even after that: the caller shows
 * the raw text instead, with a note saying why.
 */
export function parseRequestUrl(raw: string): ParsedRequestUrl | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  try {
    return { url: new URL(trimmed), assumedScheme: false };
  } catch {
    /* fall through to the assumed-scheme attempt */
  }
  // A leading `/` means "this is a path, not a bare host" — assuming a scheme
  // in front of it would parse to a URL with an empty host, which is not what
  // the spec's `api.example.com/x` example means.
  if (trimmed.startsWith("/")) return null;
  // A scheme that was given and is *invalid* is not a missing scheme. Without
  // this, `ht!tp://[not a url]` fell through and `https://ht!tp://…` parsed —
  // producing the origin `https://ht!tp`, which no request ever went to, under
  // a note reading "No scheme was given". A tool people open precisely because
  // a request looks wrong must not invent the part they came to check.
  if (claimsScheme(trimmed)) return null;
  try {
    return { url: new URL(`https://${trimmed}`), assumedScheme: true };
  } catch {
    return null;
  }
}

/**
 * Does this text claim a scheme of its own?
 *
 * Only the part before the first `/` is considered, so a query that happens to
 * carry a URL (`api.example.com/go?to=https://x`) is still a bare host. Within
 * that, a colon followed by digits alone is a port — `api.example.com:8080` has
 * no scheme and should still get one assumed. Anything else after a colon is
 * something trying to be a scheme, and if the URL parser has already rejected
 * it, it is a broken one.
 */
function claimsScheme(text: string): boolean {
  const authority = text.split("/", 1)[0] ?? "";
  const colon = authority.indexOf(":");
  if (colon < 0) return false;
  return !/^\d+$/.test(authority.slice(colon + 1));
}

/* -------------------------------------------------------- masked values --- */

/**
 * One value that may be secret-shaped: both the masked placeholder and the
 * real value are in the DOM from the start, and a click toggles which is
 * visible via `REVEAL_ATTR` — no re-render, no value duplicated anywhere it
 * was not already going to be (the real value already had to be in the DOM
 * for the unmasked case). "Click to reveal, one at a time" — each value has
 * its own toggle; revealing one never affects any other.
 */
const MASK_DOTS = 12;

function maskableValue(value: string, masked: boolean): HTMLElement {
  const wrap = el("span", { class: "xmask" });
  if (!masked) {
    wrap.append(el("span", { class: "xmask__value", text: value }));
    return wrap;
  }

  wrap.setAttribute(REVEAL_ATTR, "false");
  // A fixed run, not one derived from the value. Scaling it to the length
  // counted the secret out on screen — a 21-character session id showed exactly
  // 21 dots — which is the one thing a mask must not do.
  const dots = el("span", { class: "xmask__dots", text: "•".repeat(MASK_DOTS) });
  const real = el("span", { class: "xmask__value", text: value });
  const button = el("button", {
    class: "xmask__toggle",
    type: "button",
    [BAND_ACTION_ATTR]: "reveal",
    "aria-label": t().request.review.revealLabel,
    title: t().request.review.revealTitle,
    text: t().request.review.reveal,
  });
  wrap.append(dots, real, button);
  return wrap;
}

/* ------------------------------------------------------------------ jwt --- */

function jwtClaimRow(label: string, value: string | undefined): HTMLElement | null {
  if (value === undefined) return null;
  return el(
    "div",
    { class: "xjwt__claim" },
    el("span", { class: "xjwt__claim-key", text: label }),
    el("code", { class: "xjwt__claim-val", text: value }),
  );
}

function stringClaim(payload: DecodedJwt["payload"], key: string): string | undefined {
  const value = payload[key];
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

/** `sub`, `iss`, `scope` and `exp` — the four claims the spec names by name. */
function renderJwtPanel(decoded: DecodedJwt, referenceTime: number | null): HTMLElement {
  const m = t().request.review.jwt;
  const panel = el("div", { class: "xjwt" });
  panel.append(el("p", { class: "xjwt__title", text: m.title }));

  const claims = el(
    "div",
    { class: "xjwt__claims" },
    jwtClaimRow(m.sub, stringClaim(decoded.payload, "sub")),
    jwtClaimRow(m.iss, stringClaim(decoded.payload, "iss")),
    jwtClaimRow(m.scope, stringClaim(decoded.payload, "scope")),
  );

  if (decoded.expiresAt !== undefined) {
    const usingCallTime = referenceTime !== null;
    const delta = decoded.expiresAt - (referenceTime ?? Date.now());
    const relative = usingCallTime ? relativeToCall(delta) : relativeToNow(delta);
    claims.append(
      el(
        "div",
        { class: "xjwt__claim" },
        el("span", { class: "xjwt__claim-key", text: m.exp }),
        el(
          "code",
          { class: `xjwt__claim-val${decoded.expired ? " xjwt__claim-val--expired" : ""}` },
          new Date(decoded.expiresAt).toISOString(),
          " · ",
          relative,
        ),
      ),
    );
  }

  panel.append(claims);
  return panel;
}

/* -------------------------------------------------------------- headers --- */

/**
 * Which `q_` field-kind a row anchors under — encodes both the field type
 * *and* the side (request/response), since D1's `q_` segments are exactly
 * `kind, name` with no third segment for the side. Folding the side into
 * `kind` is what keeps a request `Accept` header and a response `Accept`
 * header from minting the same id.
 */
type FieldKind = "reqHeader" | "resHeader" | "reqCookie" | "resCookie" | "reqParam";

interface HeaderRowOptions {
  fieldKind: FieldKind;
  /** Set exactly for the first row with this name — a repeated header/cookie name still renders every row, but only the first gets a deep-linkable anchor, so two rows can never mint the same `q_` id. */
  anchorName: string | null;
  referenceTime: number | null;
}

function headerRow(name: string, value: string, options: HeaderRowOptions): HTMLElement {
  const masked = shouldMaskHeader(name, value);
  const row = el("div", {
    class: "xrow xrow--header",
    id: options.anchorName !== null ? requestFieldDomId(options.fieldKind, options.anchorName) : undefined,
  });
  row.append(
    el("code", { class: "xrow__name", text: name }),
    el("div", { class: "xrow__value" }, maskableValue(value, masked)),
  );

  const shape = detectCredentialShape(value);
  if (shape?.kind === "jwt") {
    const decoded = decodeJwt(value, options.referenceTime ?? undefined);
    if (decoded) row.append(renderJwtPanel(decoded, options.referenceTime));
    else row.append(el("p", { class: "xrow__note", text: t().request.review.jwt.notAJwt }));
  }

  return row;
}

/** Every header in a `HeaderSet`, one row per entry — duplicates kept in wire order, per `headers.ts`'s own contract. */
function renderHeaderTable(headers: HeaderSet, fieldKind: FieldKind, referenceTime: number | null): HTMLElement {
  const list = el("div", { class: "xtable xtable--headers" });
  if (headers.entries.length === 0) {
    list.append(el("p", { class: "xtable__empty", text: t().request.review.headersEmpty }));
    return list;
  }

  const totalByName = new Map<string, number>();
  for (const entry of headers.entries) {
    const lower = entry.name.toLowerCase();
    totalByName.set(lower, (totalByName.get(lower) ?? 0) + 1);
  }

  const anchored = new Set<string>();
  for (const entry of headers.entries) {
    const lower = entry.name.toLowerCase();
    const isFirst = !anchored.has(lower);
    if (isFirst) anchored.add(lower);
    const row = headerRow(entry.name, entry.value, {
      fieldKind,
      anchorName: isFirst ? entry.name : null,
      referenceTime,
    });
    const count = totalByName.get(lower) ?? 1;
    if (count > 1) {
      row.append(el("span", { class: "xrow__badge", text: t().request.review.duplicateHeader(count) }));
    }
    list.append(row);
  }
  return list;
}

/* -------------------------------------------------------------- cookies --- */

function renderRequestCookieTable(cookies: CookieSet): HTMLElement {
  const list = el("div", { class: "xtable xtable--cookies" });
  if (cookies.entries.length === 0) {
    list.append(el("p", { class: "xtable__empty", text: t().request.review.cookiesEmpty }));
    return list;
  }
  const anchored = new Set<string>();
  for (const cookie of cookies.entries) {
    const isFirst = !anchored.has(cookie.name);
    if (isFirst) anchored.add(cookie.name);
    list.append(
      el(
        "div",
        {
          class: "xrow xrow--cookie",
          id: isFirst ? requestFieldDomId("reqCookie", cookie.name) : undefined,
        },
        el("code", { class: "xrow__name", text: cookie.name }),
        el("div", { class: "xrow__value" }, maskableValue(cookie.value, true)),
      ),
    );
  }
  return list;
}

function cookieAttributeChips(cookie: SetCookie): HTMLElement[] {
  const m = t().request.review.cookieAttrs;
  const chips: HTMLElement[] = [];
  if (cookie.domain !== undefined) chips.push(el("span", { class: "xattr", text: m.domain(cookie.domain) }));
  if (cookie.path !== undefined) chips.push(el("span", { class: "xattr", text: m.path(cookie.path) }));
  if (cookie.maxAge !== undefined) chips.push(el("span", { class: "xattr", text: m.maxAge(cookie.maxAge) }));
  if (cookie.sameSite !== undefined) chips.push(el("span", { class: "xattr", text: m.sameSite(cookie.sameSite) }));
  if (cookie.secure) chips.push(el("span", { class: "xattr", text: m.secure }));
  if (cookie.httpOnly) chips.push(el("span", { class: "xattr", text: m.httpOnly }));
  if (cookie.unrecognized?.length) {
    for (const attr of cookie.unrecognized) {
      chips.push(
        el("span", {
          class: "xattr xattr--unknown",
          title: t().request.review.cookieAttrs.unrecognizedTitle,
          text: attr.value !== undefined ? `${attr.name}=${attr.value}` : attr.name,
        }),
      );
    }
  }
  return chips;
}

function renderResponseCookieTable(cookies: SetCookieSet): HTMLElement {
  const list = el("div", { class: "xtable xtable--cookies" });
  if (cookies.entries.length === 0) {
    list.append(el("p", { class: "xtable__empty", text: t().request.review.cookiesEmpty }));
    return list;
  }

  const anchored = new Set<string>();
  cookies.entries.forEach((cookie, index) => {
    const isFirst = cookie.name !== "" && !anchored.has(cookie.name);
    if (isFirst) anchored.add(cookie.name);
    const row = el(
      "div",
      {
        class: "xrow xrow--cookie",
        id: isFirst ? requestFieldDomId("resCookie", cookie.name) : undefined,
      },
      el("code", { class: "xrow__name", text: cookie.name || t().request.review.unnamedCookie(index + 1) }),
      el("div", { class: "xrow__value" }, maskableValue(cookie.value, true)),
    );
    const chips = cookieAttributeChips(cookie);
    if (chips.length) row.append(el("div", { class: "xrow__attrs" }, ...chips));
    if (cookie.expiresAt !== undefined) {
      row.append(
        el("p", {
          class: `xrow__note${cookie.expiresAt < Date.now() ? " xrow__note--expired" : ""}`,
          text: `${cookie.expires} · ${relativeToNow(cookie.expiresAt - Date.now())}`,
        }),
      );
    }
    list.append(row);
  });
  return list;
}

/* ---------------------------------------------------------------- params --- */

function stringifyParamValue(value: ParamValue): string {
  if (value === null) return t().request.review.params.novalue;
  if (typeof value === "string") return value === "" ? t().request.review.params.emptyValue : value;
  return JSON.stringify(value);
}

function alternativePath(path: (string | number)[]): string {
  return path.length === 0 ? "" : "." + path.join(".");
}

function paramRow(entry: ParamEntry): HTMLElement {
  const m = t().request.review.params;
  const row = el("div", { class: "xrow xrow--param", id: requestFieldDomId("reqParam", entry.name) });
  row.append(el("code", { class: "xrow__name", text: entry.name }));

  if (entry.conflict) {
    const body = el("div", { class: "xparam__conflict" });
    body.append(el("p", { class: "xrow__note xrow__note--conflict", text: m.conflict }));
    for (const reading of entry.conflict) {
      body.append(
        el(
          "p",
          { class: "xparam__reading" },
          el("code", null, stringifyParamValue(reading.value)),
          " — ",
          m.convention(reading.convention),
        ),
      );
    }
    row.append(body);
    return row;
  }

  const body = el("div", { class: "xparam__body" });
  body.append(
    el(
      "p",
      { class: "xparam__reading" },
      el("code", null, stringifyParamValue(entry.value ?? null)),
      entry.convention ? ` — ${m.convention(entry.convention)}` : "",
    ),
  );

  if (entry.alternatives.length) {
    const alts = el("ul", { class: "xparam__alts" });
    for (const alt of entry.alternatives) {
      const at = alternativePath(alt.path);
      alts.append(
        el(
          "li",
          null,
          el("code", null, stringifyParamValue(alt.value)),
          ` — ${m.convention(alt.convention)}${at ? ` (${at.slice(1)})` : ""}`,
        ),
      );
    }
    body.append(el("p", { class: "xparam__alts-label", text: m.alternatives }), alts);
  }

  const raw = entry.raw.map((pair) => (pair.value === null ? pair.key : `${pair.key}=${pair.value}`)).join("&");
  body.append(
    el(
      "p",
      { class: "xparam__raw" },
      el("span", { class: "xparam__raw-label", text: m.rawWire }),
      el("code", { text: raw }),
    ),
  );

  row.append(body);
  return row;
}

function renderParamTable(params: ParamSet): HTMLElement {
  const list = el("div", { class: "xtable xtable--params" });
  if (params.entries.length === 0) {
    list.append(el("p", { class: "xtable__empty", text: t().request.review.params.empty }));
    return list;
  }
  for (const entry of params.entries) list.append(paramRow(entry));
  return list;
}

/* ------------------------------------------------------------------ body --- */

const FORM_URLENCODED_RE = /^\s*application\/x-www-form-urlencoded\s*(?:;|$)/i;
const JSON_CONTENT_TYPE_RE = /json/i;

/** `readAny`, but `null` instead of a thrown `DocumentError` — "anything else stays text." */
export function readBodyLens(raw: string): Lens | null {
  if (raw.trim() === "") return null;
  try {
    return readAny(raw);
  } catch {
    return null;
  }
}

/**
 * The request body's own parsed root, for `main.ts` to resolve a
 * `REQ_POINTER_ATTR` value against — see this module's header for why that
 * cannot go through the response's own pointer resolution.
 */
export function requestBodyRoot(body: BodyPart | undefined): JsonValue | null {
  if (!body) return null;
  const lens = readBodyLens(body.raw);
  if (!lens) return null;
  return lens.kind === "jsonapi" ? lens.index.root : (lens.index.root as JsonValue);
}

/** A chip for a resource inside the request body — the `b_`-scoped sibling of `render-resource.ts#chip`. See this module's header for why that function cannot be reused directly. */
function requestChip(type: string, id: string, resolved: boolean): HTMLElement {
  const node = resolved
    ? el("a", { class: "chip chip--link", href: requestResourceHref(type, id) })
    : el("span", { class: "chip chip--absent", title: t().resource.absentChipTitle(type, id) });
  node.dataset["hue"] = String(typeHue(type));
  node.append(
    el("b", { class: "chip__sigil", text: typeSigil(type) }),
    el("span", { class: "chip__type", text: type }),
    el("span", { class: "chip__id", text: id }),
  );
  if (!resolved) node.append(el("span", { class: "chip__absent", text: t().resource.notInDocument }));
  return node;
}

function requestResourceRelationships(resource: Resource, index: DocumentIndex): HTMLElement | null {
  if (!resource.relationships.length) return null;
  const block = el("div", { class: "block block--rels" });
  block.append(el("h4", { class: "block__title", text: t().relationships.title }));
  for (const rel of resource.relationships) {
    const row = el("div", { class: "rel" }, el("span", { class: "rel__name", text: rel.name }));
    const list = el("ul", { class: "rel__targets" });
    for (const target of rel.targets) {
      const resolved = index.byKey.has(`${target.type}:${target.id}`);
      list.append(el("li", { class: "rel__target" }, requestChip(target.type, target.id, resolved)));
    }
    if (rel.targets.length) row.append(list);
    else row.append(el("p", { class: "rel__note", text: t().relationships.nullNote }));
    block.append(row);
  }
  return block;
}

function requestResourceSection(resource: Resource, index: DocumentIndex): HTMLElement {
  const section = el("section", {
    class: "xreqres",
    id: requestResourceDomId(resource.type, resource.id),
    [REQ_RESOURCE_ATTR]: `${resource.type}${REQ_RESOURCE_SEP}${resource.id}`,
  });

  const actions = el(
    "div",
    { class: "res__actions" },
    el("button", {
      class: "act",
      type: "button",
      [REQ_OBJECT_ACTION_ATTR]: "copy-object",
      title: t().request.review.body.copyObjectTitle,
      "aria-label": t().request.review.body.copyObjectTitle,
      text: t().overview.copy,
    }),
    el("button", {
      class: "act",
      type: "button",
      [REQ_OBJECT_ACTION_ATTR]: "copy-pointer",
      title: t().request.review.body.copyPointerTitle(resource.pointer),
      "aria-label": t().request.review.body.copyPointerTitle(resource.pointer),
      text: t().value.copyPointerLabel,
    }),
  );

  section.append(
    el(
      "header",
      { class: "xreqres__head" },
      requestChip(resource.type, resource.id, true),
      actions,
    ),
  );

  if (resource.attributes) {
    section.append(renderObjectBlock(t().block.attributes, resource.attributes, resource.pointer));
  }
  const rels = requestResourceRelationships(resource, index);
  if (rels) section.append(rels);

  return section;
}

/** The request body's own JSON:API resource tree, under the `b_` scope. */
function renderRequestJsonApiBody(index: DocumentIndex): HTMLElement {
  const container = el("div", { class: "xreqbody xreqbody--jsonapi", [REQ_ROOT_ATTR]: "true" });
  for (const group of index.groups) {
    const groupEl = el(
      "div",
      { class: "xreqgroup" },
      el(
        "p",
        { class: "xreqgroup__label" },
        el("b", { text: typeSigil(group.type) }),
        ` ${group.type} `,
        el("span", { class: "xreqgroup__count", text: t().num(group.resources.length) }),
      ),
    );
    for (const resource of group.resources) groupEl.append(requestResourceSection(resource, index));
    container.append(groupEl);
  }
  return container;
}

/** The request body's own plain-JSON tree, under the `d_` scope — reuses `render-json.ts` verbatim with a scoped anchor pair. */
function renderRequestPlainJsonBody(index: JsonIndex): HTMLElement {
  const container = el("div", { class: "xreqbody xreqbody--plain", [REQ_ROOT_ATTR]: "true" });
  const annotations = buildAnnotations(index, { domId: requestNodeDomId, href: requestNodeHref });
  container.append(renderJsonGroups(index, annotations));
  const leftover = renderJsonLeftover(index, annotations);
  if (leftover) container.append(leftover);
  return container;
}

function renderTextBody(raw: string, contentType: string | undefined): HTMLElement {
  const wrap = el("div", { class: "xreqbody xreqbody--text" });
  if (contentType && JSON_CONTENT_TYPE_RE.test(contentType)) {
    try {
      parseJson(raw);
    } catch (error) {
      if (error instanceof DocumentError) {
        wrap.append(
          el(
            "p",
            { class: "xrow__note xrow__note--conflict" },
            `${error.headline} ${error.hint}`,
            error.line !== undefined ? ` (${t().paste.errorWhere(error.line)})` : "",
          ),
        );
      }
    }
  }
  wrap.append(el("pre", { class: "raw xreqbody__pre" }, el("code", { text: raw })));
  return wrap;
}

/**
 * Dispatch a `BodyPart` to the right reading — form-urlencoded as a parameter
 * table, JSON:API/plain-JSON through their own anchored trees, anything else
 * as text. `null` for no body at all.
 */
export function renderBodyPart(body: BodyPart | undefined): HTMLElement | null {
  if (!body || body.raw.trim() === "") return null;

  const wrap = el("div", { class: "xbody" });
  wrap.append(
    el(
      "p",
      { class: "xbody__meta" },
      body.contentType ? el("code", { text: body.contentType }) : el("em", { text: t().request.review.body.noContentType }),
      ` · ${formatBytes(new TextEncoder().encode(body.raw).byteLength)}`,
    ),
  );

  if (body.contentType && FORM_URLENCODED_RE.test(body.contentType)) {
    wrap.append(renderParamTable(decodeParams(body.raw)));
    return wrap;
  }

  const lens = readBodyLens(body.raw);
  if (!lens) {
    wrap.append(renderTextBody(body.raw, body.contentType));
    return wrap;
  }

  if (lens.kind === "jsonapi") {
    wrap.append(renderRequestJsonApiBody(lens.index));
  } else {
    // Re-scoped so a plain-JSON request body's own collections/identities
    // anchor under `d_` — see this module's header. `buildIndex`, above,
    // needs no such rebuild for the JSON:API case: this module never reads
    // its `.domId` field, only `byKey`/`groups`/relationships/attributes.
    const rescoped = buildJsonIndex(lens.index.root, lens.index.shape, lens.index.shapeEvidence, requestNodeDomId);
    wrap.append(renderRequestPlainJsonBody(rescoped));
  }
  return wrap;
}

/**
 * The request body's `DocumentIndex`, when it reads as JSON:API — for
 * `main.ts`'s resource-level actions (`REQ_OBJECT_ACTION_ATTR`), which need
 * more than the root: `resource.raw` for "copy object", and `byKey` to look
 * a `REQ_RESOURCE_ATTR` marker's `{type, id}` back up to it. `null` for
 * anything that is not a request body reading as JSON:API — including no
 * body at all — so a caller need not duplicate `readBodyLens`'s branching.
 */
export function requestBodyJsonApiIndex(body: BodyPart | undefined): DocumentIndex | null {
  if (!body) return null;
  const lens = readBodyLens(body.raw);
  return lens?.kind === "jsonapi" ? lens.index : null;
}

/* --------------------------------------------------------- response body --- */

/** A compact stand-in for the response body inside the review — see this module's header for why the full tree is not duplicated here. */
function renderResponseBodySummary(current: { lens: Lens; bytes: number } | null): HTMLElement {
  const m = t().request.review.responseBody;
  if (!current) return el("p", { class: "xtable__empty", text: m.none });

  const summary =
    current.lens.kind === "jsonapi"
      ? m.jsonApiSummary(current.lens.index.counts.total, current.lens.index.groups.length)
      : m.plainSummary(t().shape.name(current.lens.index.shape), current.lens.index.counts.total);

  return el(
    "p",
    { class: "xbody__meta" },
    `${summary} · ${formatBytes(current.bytes)} — `,
    el("a", { href: "#overview", text: m.jumpLink }),
  );
}

/* -------------------------------------------------------------- url block --- */

function renderUrlBlock(url: string | undefined): HTMLElement {
  const m = t().request.review;
  if (url === undefined || url.trim() === "") {
    return el("p", { class: "xtable__empty", text: m.noUrl });
  }

  const parsed = parseRequestUrl(url);
  if (!parsed) {
    return el(
      "div",
      { class: "xurl" },
      el("code", { class: "xurl__raw", text: url }),
      el("p", { class: "xrow__note", text: m.urlUnparseable }),
    );
  }

  const wrap = el("div", { class: "xurl" });
  const href = safeAnchorHref(parsed.url.href);
  wrap.append(
    el(
      "div",
      { class: "xurl__origin" },
      href
        ? el("a", { href, target: "_blank", rel: "noopener noreferrer", text: parsed.url.origin })
        : el("code", { text: parsed.url.origin }),
      el("code", { class: "xurl__path", text: parsed.url.pathname + parsed.url.search + parsed.url.hash }),
    ),
  );
  if (parsed.assumedScheme) {
    wrap.append(el("p", { class: "xrow__note", text: m.assumedScheme(parsed.url.protocol.replace(":", "")) }));
  }
  return wrap;
}

/* --------------------------------------------------------------- sections --- */

function reviewSection(title: string, body: HTMLElement, count?: number): HTMLElement {
  return el(
    "section",
    { class: "xsection" },
    el(
      "h4",
      { class: "xsection__title" },
      title,
      count !== undefined ? el("span", { class: "xsection__count", text: t().num(count) }) : null,
    ),
    body,
  );
}

function renderRequestReview(request: RequestPart): HTMLElement {
  const m = t().request.review;
  const section = el("div", { class: "xreview xreview--request" });

  section.append(
    el(
      "div",
      { class: "xreview__line" },
      el("span", { class: "xreview__method", text: request.method ?? m.noMethod }),
      renderUrlBlock(request.url),
    ),
  );

  if (request.query) section.append(reviewSection(m.queryTitle, renderParamTable(request.query), request.query.entries.length));
  if (request.headers) {
    section.append(
      reviewSection(m.headersTitle, renderHeaderTable(request.headers, "reqHeader", null), request.headers.entries.length),
    );
  }
  if (request.cookies) {
    section.append(reviewSection(m.cookiesTitle, renderRequestCookieTable(request.cookies), request.cookies.entries.length));
  }
  const body = renderBodyPart(request.body);
  if (body) section.append(reviewSection(m.bodyTitle, body));

  return section;
}

function renderResponseReview(
  response: ResponsePart,
  currentDocument: { lens: Lens; bytes: number } | null,
): HTMLElement {
  const m = t().request.review;
  const referenceTime = responseReferenceTime(response);
  const section = el("div", { class: "xreview xreview--response" });

  section.append(
    el(
      "div",
      { class: "xreview__line" },
      el("span", {
        class: `xreview__status${response.status !== undefined && response.status >= 400 ? " xreview__status--error" : ""}`,
        text: response.status !== undefined ? String(response.status) : m.noStatus,
      }),
      response.statusText ? el("span", { class: "xreview__status-text", text: response.statusText }) : null,
      response.elapsedMs !== undefined
        ? el("span", { class: "xreview__elapsed", text: m.elapsed(response.elapsedMs) })
        : null,
    ),
  );

  if (response.headers) {
    section.append(
      reviewSection(
        m.headersTitle,
        renderHeaderTable(response.headers, "resHeader", referenceTime),
        response.headers.entries.length,
      ),
    );
  }
  if (response.cookies) {
    section.append(
      reviewSection(m.cookiesTitle, renderResponseCookieTable(response.cookies), response.cookies.entries.length),
    );
  }
  section.append(reviewSection(m.bodyTitle, renderResponseBodySummary(currentDocument)));

  return section;
}

/* ------------------------------------------------------------------ mode --- */

function renderModeControl(mode: ReviewMode): HTMLElement {
  const m = t().request.band;
  const group = el("div", { class: "xmodes", role: "radiogroup", "aria-label": m.modeGroupLabel });
  const options: { key: ReviewMode; label: string }[] = [
    { key: "response", label: m.modeResponse },
    { key: "request", label: m.modeRequest },
    { key: "both", label: m.modeBoth },
  ];
  for (const option of options) {
    group.append(
      el("button", {
        class: "xmodes__choice",
        type: "button",
        role: "radio",
        "aria-checked": String(option.key === mode),
        [BAND_ACTION_ATTR]: "mode",
        [BAND_MODE_ATTR]: option.key,
        text: option.label,
      }),
    );
  }
  return group;
}

/* ----------------------------------------------------------------- band --- */

function countLine(request: RequestPart | undefined, response: ResponsePart | undefined): string {
  const m = t().request.band;
  const parts: string[] = [];
  const paramCount = request?.query?.entries.length ?? 0;
  const headerCount = (request?.headers?.entries.length ?? 0) + (response?.headers?.entries.length ?? 0);
  const cookieCount = (request?.cookies?.entries.length ?? 0) + (response?.cookies?.entries.length ?? 0);
  if (paramCount > 0) parts.push(m.summaryParams(paramCount));
  if (headerCount > 0) parts.push(m.summaryHeaders(headerCount));
  if (cookieCount > 0) parts.push(m.summaryCookies(cookieCount));
  return parts.join(" · ");
}

function renderBandSummary(exchange: Exchange): HTMLElement {
  const m = t().request.band;
  const request = exchange.request;
  const response = exchange.response;
  const line = el("summary", { class: "xband__summary" });

  line.append(el("span", { class: "xband__caret", "aria-hidden": "true" }));
  if (request?.method) line.append(el("code", { class: "xband__method", text: request.method }));
  if (request?.url) {
    line.append(el("code", { class: "xband__url", text: request.url }));
  } else if (!request) {
    line.append(el("span", { class: "xband__hint", text: m.responseOnly }));
  }
  if (response?.status !== undefined) {
    line.append(
      el("span", {
        class: `xband__status${response.status >= 400 ? " xband__status--error" : ""}`,
        text: String(response.status),
      }),
    );
  }
  const counts = countLine(request, response);
  if (counts) line.append(el("span", { class: "xband__counts", text: counts }));

  return line;
}

export interface ExchangeBandOptions {
  exchange: Exchange;
  mode: ReviewMode;
  /** The response document currently on screen — used only for the compact body summary + jump link. */
  currentDocument: { lens: Lens; bytes: number } | null;
}

/**
 * The band above the overview: a `<details>` element, collapsed to one line
 * by default. `null` when the exchange has nothing in it at all — the "no
 * band, no segmented control" edge case, so `main.ts` never has to special-
 * case an empty exchange.
 */
export function renderExchangeBand(options: ExchangeBandOptions): HTMLElement | null {
  const { exchange } = options;
  if (!hasExchangeContent(exchange)) return null;

  const hasRequest = exchange.request !== undefined;
  const hasResponse = exchange.response !== undefined;
  const mode = effectiveMode(exchange, options.mode);

  const band = el("details", { class: "xband", id: "exchange-band" });
  band.append(renderBandSummary(exchange));

  const body = el("div", { class: "xband__body" });

  const actions = el(
    "div",
    { class: "xband__actions" },
    el("button", {
      class: "btn btn--sm",
      type: "button",
      [BAND_ACTION_ATTR]: "edit",
      text: t().request.band.edit,
      title: t().request.band.editTitle,
    }),
    el("button", {
      class: "btn btn--sm",
      type: "button",
      [BAND_ACTION_ATTR]: "copy",
      text: t().overview.copy,
      title: t().request.band.copyTitle,
    }),
    el("button", {
      class: "btn btn--sm",
      type: "button",
      [BAND_ACTION_ATTR]: "download",
      text: t().request.band.download,
      title: t().request.band.downloadTitle,
    }),
    el("button", {
      class: "btn btn--sm",
      type: "button",
      [BAND_ACTION_ATTR]: "share",
      text: t().request.band.share,
      title: t().request.band.shareTitle,
    }),
  );
  body.append(actions);
  // Shown next to the actions unconditionally, not only after a redaction
  // finds something — see the string's own comment in `en.ts` for why a
  // `0`-count toast must never be the only signal a user gets about scope.
  body.append(el("p", { class: "xrow__note xband__caveat", text: t().request.band.redactionCaveat }));

  if (hasRequest && hasResponse) body.append(renderModeControl(mode));

  if (mode !== "response" && exchange.request) body.append(renderRequestReview(exchange.request));
  if (mode !== "request" && exchange.response) {
    body.append(renderResponseReview(exchange.response, options.currentDocument));
  }
  if (mode === "response" && !exchange.response) {
    // Unreachable in practice (effectiveMode never picks "response" without a
    // response part), kept so a future caller passing its own `mode` cannot
    // silently render an empty body.
    body.append(el("p", { class: "xtable__empty", text: t().request.review.noResponse }));
  }

  band.append(body);
  return band;
}

/** Recover a `{type, id}` from a `data-req-resource` marker — see `REQ_RESOURCE_ATTR`. */
export function parseReqResourceMarker(marker: string): { type: string; id: string } | null {
  const at = marker.indexOf(REQ_RESOURCE_SEP);
  if (at < 0) return null;
  return { type: marker.slice(0, at), id: marker.slice(at + 1) };
}

