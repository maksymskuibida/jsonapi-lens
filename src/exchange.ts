/**
 * The exchange model — T2's contribution to T5's placeholder. See
 * `docs/DECISIONS.md` D2 for why this file started as
 * `{ readonly [key: string]: unknown }`: T5 needed a type to hang an
 * optional `exchange` field off `StoredDocument`, `LibraryEntry`,
 * `SharePayload` and `BundleEntry` before this design existed, and D2's
 * whole point was that filling in *this file's body* is the only edit T2
 * needs to make — `store.ts` and `crypto.ts` only ever carry an `Exchange`
 * value forward, never read a field off it, so neither needed to change.
 *
 * Everything here is data and one merge function. No DOM, no `t()`, no
 * network — see `docs/task-specs/T2.md` and `docs/PROCESS.md` §5. Rendering
 * an `Exchange` (the field-separated form, the three-mode review, request-
 * scoped anchors) is T2b's half of this task, built on top of this module;
 * this file and its siblings (`params.ts`, `headers.ts`, `cookies.ts`,
 * `secrets.ts`) own the model, the parameter decoder, and secret handling.
 *
 * ## Every field is optional at the type level
 *
 * Not by convention — literally: nothing here has a required property except
 * `BodyPart.raw`, which exists only when a `BodyPart` exists at all (there is
 * no such thing as "a body with no text"; the *absence* of a body is
 * `body: undefined` one level up). You can have a request with a URL and
 * nothing else, a response with only a status, or nothing at all — the last
 * of which is what makes "with no request entered, the view is exactly
 * today's document view" true by construction rather than by a branch
 * somewhere checking whether the feature is "in use".
 *
 * ## Where a response's own timestamp comes from
 *
 * The spec asks for a JWT's `exp` to render "relative to the response's own
 * timestamp when there is one". `ResponsePart` has no `timestamp` field for
 * this on purpose: a response's own timestamp is its `Date` header — an
 * ordinary response header a server sets, not something T2's model invents a
 * place for. A caller with a `ResponsePart` gets it via
 * `getHeader(response.headers, "date")` and hands the parsed result to
 * `secrets.ts#decodeJwt` as its reference time; `elapsedMs` below is a
 * duration, not a point in time, and answers a different question (how long
 * the call took, not when it happened).
 */

import type { HeaderSet } from "./headers.js";
import type { CookieSet, SetCookieSet } from "./cookies.js";
import type { ParamSet } from "./params.js";
import type { Lens } from "./types.js";

/**
 * `raw` is the one required field in this file: a `BodyPart` only exists when
 * there is a body to show, so "no body" is `body: undefined` on the part
 * above, never a `BodyPart` with empty `raw`.
 */
export interface BodyPart {
  /** Exactly as captured — never re-serialised, so what was pasted or imported is what is shown. */
  raw: string;
  contentType?: string;
  /**
   * `raw` read through T1's `Lens` (`parse.ts#readAny`) — a JSON:API body
   * gets the same resource treatment as a top-level document, a plain-JSON
   * body gets the tree and its inferred graph, and anything else stays text.
   * This field only names where that reading lives; computing it is a
   * rendering-time concern for whoever is about to show the body; `readAny`
   * already exists and already never throws for anything JSON- or
   * JSON-Lines-shaped, throwing only when nothing at all could be read as
   * JSON — which is exactly the "anything else stays text" case, caught by
   * the caller rather than propagated here.
   */
  lens?: Lens;
  /**
   * `raw` read as `application/x-www-form-urlencoded`, via
   * `params.ts#decodeParams` — the same decoder a URL's query string goes
   * through.
   */
  form?: ParamSet;
}

export interface RequestPart {
  method?: string;
  url?: string;
  query?: ParamSet;
  headers?: HeaderSet;
  cookies?: CookieSet;
  body?: BodyPart;
}

export interface ResponsePart {
  status?: number;
  statusText?: string;
  headers?: HeaderSet;
  /** Response cookies are `Set-Cookie` readings, not the simpler request `Cookie` shape — see `cookies.ts`. */
  cookies?: SetCookieSet;
  body?: BodyPart;
  /**
   * Wall-clock duration of the call in milliseconds — a duration, not a point
   * in time. See this file's header for where a response *timestamp* comes
   * from instead.
   */
  elapsedMs?: number;
}

/**
 * Where an `Exchange` came from, when it arrived by import rather than by
 * hand — T3's field, on T3's schedule. T3 depends on this module
 * (`docs/task-specs/T3.md`'s own header says so) and is not built yet, so
 * this is deliberately the same opaque-placeholder shape D2 used for
 * `Exchange` itself: an index signature rather than a guessed set of named
 * fields, so T3 can shape it to what cURL, raw HTTP, HAR and transport-log
 * imports actually need without this module standing in the way. Every
 * consumer that only carries an `OriginMeta` value forward — nothing in T2a
 * does more than that — keeps compiling unchanged when T3 replaces this.
 */
export interface OriginMeta {
  readonly [key: string]: unknown;
}

export interface Exchange {
  request?: RequestPart;
  response?: ResponsePart;
  origin?: OriginMeta;
}

/**
 * `incoming`'s value when present, `base`'s otherwise — the one combinator
 * every merge below is built from. Associative: see `mergeExchange`.
 */
function pick<T>(base: T | undefined, incoming: T | undefined): T | undefined {
  return incoming !== undefined ? incoming : base;
}

/**
 * `RequestPart`'s six fields are exactly the form's six independently
 * editable groups (`docs/task-specs/T2.md`'s form table: method, URL, query,
 * headers, cookies, body) — each is merged as one atomic unit with
 * `pick`, not diffed entry-by-entry, because a form group always submits its
 * *current whole value* for the fields it owns rather than a delta. That is
 * what makes whole-field replacement correct here rather than lossy: when
 * `incoming.headers` is present at all, it already contains every header the
 * form's table currently shows (edited, kept, and newly added alike), so
 * replacing `base.headers` with it outright loses nothing a caller meant to
 * keep. `body` gets the same treatment for a second, structural reason —
 * `BodyPart.raw` is required, so a genuine partial `incoming.body` is not
 * constructible without a cast in the first place.
 *
 * Returns `undefined`, not `{}`, when neither side has a request at all —
 * deliberately, because an empty object is truthy in JavaScript and this
 * model's whole "no request entered" contract depends on `exchange.request`
 * being absent, not present-and-empty. Manufacturing `{}` here would be the
 * same class of bug `docs/DECISIONS.md`'s history already names once
 * (`[]` read as truthy broke a different feature's restoration check) — see
 * `test/exchange.test.ts` for the regression test this guards.
 */
function mergeRequestPart(
  base: RequestPart | undefined,
  incoming: RequestPart | undefined,
): RequestPart | undefined {
  if (base === undefined && incoming === undefined) return undefined;
  const b = base ?? {};
  const i = incoming ?? {};
  const merged: RequestPart = {};
  const method = pick(b.method, i.method);
  const url = pick(b.url, i.url);
  const query = pick(b.query, i.query);
  const headers = pick(b.headers, i.headers);
  const cookies = pick(b.cookies, i.cookies);
  const body = pick(b.body, i.body);
  if (method !== undefined) merged.method = method;
  if (url !== undefined) merged.url = url;
  if (query !== undefined) merged.query = query;
  if (headers !== undefined) merged.headers = headers;
  if (cookies !== undefined) merged.cookies = cookies;
  if (body !== undefined) merged.body = body;
  return merged;
}

/**
 * `ResponsePart`'s equivalent of `mergeRequestPart` — same reasoning, same
 * "absent beats empty" guarantee.
 */
function mergeResponsePart(
  base: ResponsePart | undefined,
  incoming: ResponsePart | undefined,
): ResponsePart | undefined {
  if (base === undefined && incoming === undefined) return undefined;
  const b = base ?? {};
  const i = incoming ?? {};
  const merged: ResponsePart = {};
  const status = pick(b.status, i.status);
  const statusText = pick(b.statusText, i.statusText);
  const headers = pick(b.headers, i.headers);
  const cookies = pick(b.cookies, i.cookies);
  const body = pick(b.body, i.body);
  const elapsedMs = pick(b.elapsedMs, i.elapsedMs);
  if (status !== undefined) merged.status = status;
  if (statusText !== undefined) merged.statusText = statusText;
  if (headers !== undefined) merged.headers = headers;
  if (cookies !== undefined) merged.cookies = cookies;
  if (body !== undefined) merged.body = body;
  if (elapsedMs !== undefined) merged.elapsedMs = elapsedMs;
  return merged;
}

/**
 * Fold `incoming` into `base` — the single write path. The form and every
 * importer in T3 go through this; there is no other way an `Exchange` gets
 * written. Two guarantees, both required by `docs/task-specs/T2.md` and both
 * proved by the tests in `test/exchange.test.ts` rather than by inspection:
 *
 *   - **Non-destructive.** A field present in `base` and absent from
 *     `incoming` (meaning: `undefined`, never provided this time) survives
 *     unchanged. This is `pick`, applied at every field this module knows
 *     about, all the way down.
 *   - **Associative.** `mergeExchange(mergeExchange(a, b), c)` equals
 *     `mergeExchange(a, mergeExchange(b, c))`. This holds structurally, not
 *     by luck: `pick(x, y) = y ?? x` is itself associative (whichever of the
 *     three is rightmost-defined wins, regardless of how the pair-wise calls
 *     are grouped — working through the four cases of `c` defined/undefined
 *     crossed with `b` defined/undefined confirms this), and folding an
 *     associative combinator across a fixed set of independent fields
 *     (`Exchange`'s three, then each part's own) stays associative, because
 *     no field's result ever depends on another field's value.
 *
 * `base`/`incoming` may themselves be `undefined` — there is no exchange yet
 * until the first save — and the result is always a concrete `Exchange`,
 * never `undefined`, so a caller never has to null-check its own write path.
 */
export function mergeExchange(base: Exchange | undefined, incoming: Exchange | undefined): Exchange {
  const b = base ?? {};
  const i = incoming ?? {};
  const request = mergeRequestPart(b.request, i.request);
  const response = mergeResponsePart(b.response, i.response);
  const origin = pick(b.origin, i.origin);

  const merged: Exchange = {};
  if (request !== undefined) merged.request = request;
  if (response !== undefined) merged.response = response;
  if (origin !== undefined) merged.origin = origin;
  return merged;
}
