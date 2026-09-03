/**
 * Secret detection, JWT decoding, and redaction — `docs/task-specs/T2.md`'s
 * "Headers, cookies, and secrets", and the constraint from the same spec
 * that this module exists specifically to satisfy: **redaction has to be
 * possible before a stored exchange is ever put on the wire, or masking it
 * in the UI is only half the job.** T6's review of the share path found that
 * it is the first code that puts a stored `exchange` on the wire at all —
 * harmless today only because nothing writes that field yet. T2a is what
 * starts writing it, so `redactExchange` below is not a nice-to-have; it is
 * the function that has to exist before that becomes true.
 *
 * Two things this module deliberately does not do:
 *
 *   - **No display masking.** "Click to reveal, one at a time" is a DOM
 *     interaction — this module only says *which* values are secret-shaped
 *     (`isSecretHeaderName`, `detectCredentialShape`), never how to draw a
 *     hidden one. T2b decides that.
 *   - **No verification, no network.** `decodeJwt` reads a token's header and
 *     payload the way any base64url-JSON reader would; it never checks a
 *     signature and never fetches a JWKS. See `docs/PROCESS.md` §5 — nothing
 *     outside `store.ts`/`share.ts`/`crypto.ts`/the Worker may open a
 *     network connection, and this module is not one of those four.
 *
 * ## `redactExchange`'s scope, precisely — see `docs/task-specs/T2.md`
 *
 * A credential in a query parameter (a presigned URL's `X-Amz-Signature`, a
 * webhook's `?sig=`, an older API's `?api_key=`) is not an edge case; it is
 * one of the most common places a real request carries one, and a redaction
 * function that only looks at headers and cookies hands one straight back to
 * whoever asked for a "redacted" copy. So this module's actual coverage is:
 *
 *   - **Headers and cookies**: fully redacted, as before.
 *   - **The URL and `RequestPart.query`**: fully redacted. A query parameter
 *     is flagged by name (`isSecretParamName` — a superset of
 *     `isSecretHeaderName`'s exact list, matched as a substring since a query
 *     parameter's name is whatever the API author chose, not a small set HTTP
 *     defines) or by value shape (`detectCredentialShape`, applied to every
 *     leaf of a decoded value — an array or nested object included). Redacting
 *     the URL **rewrites the URL string itself** from the redacted parameters
 *     via `params.ts#encodeParams`, rather than leaving the original text
 *     sitting beside a scrubbed copy — two representations of the same data
 *     where only one is scrubbed is worse than neither, because whichever one
 *     a later reader reaches for is a coin flip.
 *   - **A form-urlencoded body**: fully redacted, the same way, for the same
 *     reason — `BodyPart.form` is a `ParamSet` like `query`, so the same
 *     redaction reuses the same code, and `BodyPart.raw` is **rewritten** from
 *     the redacted form for the same reason the URL string is.
 *   - **Any other body** (JSON, plain text, anything `form` was not decoded
 *     from): **detected, not redacted.** Rewriting arbitrary body text without
 *     corrupting it is a bigger job than this module attempts tonight, so
 *     `redactExchange` instead sets `bodyMayContainSecret: true` when a
 *     request or response body's raw text contains a credential-shaped
 *     substring, so a caller can warn rather than imply the body is clean.
 *
 * What is still out of scope, and disclosed rather than silently absent: a
 * credential embedded in the URL's **path** rather than its query string, and
 * full redaction of a non-form body's content. Both are named in
 * `docs/task-specs/T2.md` rather than left for a reader to discover in the
 * source.
 *
 * Pure data and pure functions — no DOM, no `t()`, no network.
 */

import type { Exchange, BodyPart } from "./exchange.js";
import type { HeaderSet } from "./headers.js";
import type { CookieSet, SetCookieSet } from "./cookies.js";
import type { JsonObject } from "./types.js";
import { base64UrlToBytes, decodeParams, encodeParams } from "./params.js";
import type { ParamEntry, ParamSet, ParamValue } from "./params.js";

/**
 * Header names masked by default regardless of their value, per the spec's
 * table. Matched case-insensitively — see `headers.ts`, whose whole reason
 * for existing is that header names never come pre-normalised.
 */
const SECRET_HEADER_NAMES = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "api-key",
  "x-auth-token",
]);

export function isSecretHeaderName(name: string): boolean {
  return SECRET_HEADER_NAMES.has(name.toLowerCase());
}

export type CredentialShape =
  | { kind: "jwt" }
  | { kind: "stripe-key" }
  | { kind: "hex"; length: number }
  | { kind: "base64"; length: number };

const JWT_SHAPE_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const STRIPE_KEY_RE = /^(sk|pk)_[A-Za-z0-9_]{6,}$/i;
const HEX_RE = /^[0-9a-fA-F]+$/;
const BASE64_RE = /^[A-Za-z0-9+/_-]+={0,2}$/;

/**
 * Minimum lengths below which a matching string is common enough (short ids,
 * hashes of nothing) to be worth leaving unmasked.
 */
const MIN_HEX_LENGTH = 32; // the shortest hash anyone still generates (MD5)
const MIN_BASE64_LENGTH = 24; // roughly a 128-bit token once decoded

/**
 * Does `value` look like a credential, independent of which header it is on?
 * Checked in order from most to least specific, so a value matching more
 * than one shape (every hex string is also valid base64) gets the most
 * informative label rather than the broadest one.
 *
 * This intentionally over-masks rather than under-masks: a long alphanumeric
 * identifier that is not actually a secret may get flagged, and the cost of
 * that is one unnecessary click to reveal it. The cost of the opposite
 * mistake — an unmasked secret — is the one this feature exists to avoid, so
 * the trade is deliberate, not an oversight.
 */
export function detectCredentialShape(value: string): CredentialShape | null {
  // A scheme prefix (`Authorization: Bearer <token>`) names the scheme, not
  // the credential — strip it so the shape check runs on the token itself.
  const token = value.replace(/^(Bearer|Basic|Token|JWT)\s+/i, "");
  if (token === "") return null;

  if (JWT_SHAPE_RE.test(token)) return { kind: "jwt" };
  if (STRIPE_KEY_RE.test(token)) return { kind: "stripe-key" };
  if (token.length >= MIN_HEX_LENGTH && HEX_RE.test(token)) return { kind: "hex", length: token.length };
  if (token.length >= MIN_BASE64_LENGTH && BASE64_RE.test(token)) return { kind: "base64", length: token.length };
  return null;
}

/** Should this header be masked by default — by name, or because its value looks like a credential? */
export function shouldMaskHeader(name: string, value: string): boolean {
  return isSecretHeaderName(name) || detectCredentialShape(value) !== null;
}

export interface DecodedJwt {
  header: JsonObject;
  payload: JsonObject;
  /**
   * The third segment, kept opaque — it is a signature, not base64url-JSON,
   * and this module never attempts to decode it.
   */
  signature: string;
  /**
   * `payload.exp` (seconds since epoch, per RFC 7519) converted to epoch ms —
   * absent when there is no numeric `exp` claim.
   */
  expiresAt?: number;
  /** `expiresAt < referenceTime` — absent exactly when `expiresAt` is. */
  expired?: boolean;
}

const JWT_RE = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/;

function decodeJwtSegment(segment: string): JsonObject | null {
  const bytes = base64UrlToBytes(segment);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const parsed: unknown = JSON.parse(text);
  if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as JsonObject;
  return null;
}

/**
 * Decode a `Bearer` JWT's header and payload — locally, with no signature
 * check and no network call, per the spec. A leading `Bearer ` scheme is
 * stripped if present, so this accepts either a raw token or a full
 * `Authorization` header value.
 *
 * Returns `null`, never throws, for anything that is not exactly three
 * base64url segments, or whose header/payload segment does not decode to a
 * JSON object — "a JWT that is not three base64url segments: not decoded;
 * shown as an opaque masked value, no error" from the spec's edge-case
 * table. `referenceTime` defaults to `Date.now()`; pass the response's own
 * `Date` header (parsed) to judge expiry against when it originated, not
 * against whenever this happens to run — see `exchange.ts`'s header comment
 * for why that timestamp lives on the `Date` header rather than on the model.
 */
export function decodeJwt(value: string, referenceTime: number = Date.now()): DecodedJwt | null {
  const token = value.replace(/^Bearer\s+/i, "");
  const match = JWT_RE.exec(token);
  if (!match) return null;

  try {
    const header = decodeJwtSegment(match[1]!);
    const payload = decodeJwtSegment(match[2]!);
    if (header === null || payload === null) return null;

    const result: DecodedJwt = { header, payload, signature: match[3]! };
    const exp = (payload as { exp?: unknown }).exp;
    if (typeof exp === "number" && Number.isFinite(exp)) {
      const expiresAt = exp * 1000;
      result.expiresAt = expiresAt;
      result.expired = expiresAt < referenceTime;
    }
    return result;
  } catch {
    // Malformed base64url, invalid UTF-8, or invalid JSON in either segment.
    return null;
  }
}

export const REDACTED_VALUE = "[REDACTED]";

export interface RedactionResult {
  exchange: Exchange;
  /**
   * How many values were actually replaced — headers, cookies, URL/query
   * parameters and form-body parameters, combined, on both sides of the
   * exchange. Counts only what was rewritten; see `bodyMayContainSecret` for
   * the one case this function detects but does not redact.
   */
  count: number;
  /**
   * True when a request or response body's raw text — one that was not a
   * form-urlencoded body fully redacted above — contains a credential-shaped
   * substring this function did not remove. A caller must treat this as "the
   * body was not scrubbed, warn rather than reassure", not as informational.
   */
  bodyMayContainSecret: boolean;
}

function redactHeaderSet(headers: HeaderSet | undefined, tally: { count: number }): HeaderSet | undefined {
  if (!headers) return headers;
  let changed = false;
  const entries = headers.entries.map((entry) => {
    if (!shouldMaskHeader(entry.name, entry.value)) return entry;
    changed = true;
    tally.count++;
    return { name: entry.name, value: REDACTED_VALUE };
  });
  return changed ? { entries } : headers;
}

function redactCookieSet(cookies: CookieSet | undefined, tally: { count: number }): CookieSet | undefined {
  if (!cookies || cookies.entries.length === 0) return cookies;
  tally.count += cookies.entries.length;
  return { entries: cookies.entries.map((cookie) => ({ name: cookie.name, value: REDACTED_VALUE })) };
}

function redactSetCookieSet(cookies: SetCookieSet | undefined, tally: { count: number }): SetCookieSet | undefined {
  if (!cookies || cookies.entries.length === 0) return cookies;
  tally.count += cookies.entries.length;
  return { entries: cookies.entries.map((cookie) => ({ ...cookie, value: REDACTED_VALUE })) };
}

/* --------------------------------------------------- URL/query redaction --- */

/**
 * Substrings that make a query- or form-parameter *name* credential-ish,
 * matched case-insensitively after stripping `-`/`_`/` ` — so `api_key`,
 * `API-KEY` and `apiKey` all normalise to `apikey`, and `access_token`/
 * `X-Token` both contain `token`. Deliberately broader than
 * `isSecretHeaderName`'s exact list: a header name is a small set HTTP
 * defines, a parameter name is whatever the API author chose, so this
 * matches a substring rather than a whole name.
 *
 * `sig` is a real false-positive source (`design`, `assign`, `resign`,
 * `consign` all contain it) — kept anyway, deliberately, on the same
 * over-mask-rather-than-under-mask trade `detectCredentialShape` already
 * makes: one unnecessary redaction costs a click to notice; one missed
 * credential is the failure this module exists to prevent.
 */
const SECRET_PARAM_NAME_SUBSTRINGS = ["token", "secret", "signature", "sig", "apikey", "password"];

function normalizeParamName(name: string): string {
  return name.toLowerCase().replace(/[-_ ]/g, "");
}

export function isSecretParamName(name: string): boolean {
  const normalized = normalizeParamName(name);
  return SECRET_PARAM_NAME_SUBSTRINGS.some((needle) => normalized.includes(needle));
}

/**
 * Does any leaf of a decoded parameter value — a plain string, or one nested
 * in an array/object — look like a credential?
 */
function valueHasCredentialShape(value: ParamValue | undefined): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return detectCredentialShape(value) !== null;
  if (Array.isArray(value)) return value.some(valueHasCredentialShape);
  if (typeof value === "object") return Object.values(value).some(valueHasCredentialShape);
  return false; // number, boolean
}

/**
 * Should this parameter be redacted — by name, or because any reading of its
 * value looks like a credential?
 */
function shouldRedactParam(entry: ParamEntry): boolean {
  if (isSecretParamName(entry.name)) return true;
  if (valueHasCredentialShape(entry.value)) return true;
  if (entry.alternatives.some((alt) => valueHasCredentialShape(alt.value))) return true;
  if (entry.conflict?.some((reading) => valueHasCredentialShape(reading.value))) return true;
  return false;
}

/** Replace every leaf of a decoded value with the redaction marker, preserving array/object shape where cheap to. */
function redactParamValue(value: ParamValue): ParamValue {
  if (Array.isArray(value)) return value.map(() => REDACTED_VALUE);
  if (value !== null && typeof value === "object") {
    const out: Record<string, ParamValue> = {};
    for (const key of Object.keys(value)) out[key] = REDACTED_VALUE;
    return out;
  }
  return REDACTED_VALUE;
}

/**
 * Redact every value-bearing field of one `ParamEntry` — `raw` (what
 * `encodeParams` uses for a conflicted entry), `value`, `conflict`, and
 * `alternatives` (cleared: nothing is left to disambiguate once redacted).
 */
function redactParamEntry(entry: ParamEntry): ParamEntry {
  const redacted: ParamEntry = {
    ...entry,
    raw: entry.raw.map((pair) => (pair.value === null ? pair : { key: pair.key, value: REDACTED_VALUE })),
    alternatives: [],
  };
  if (entry.value !== undefined) redacted.value = redactParamValue(entry.value);
  if (entry.conflict) {
    redacted.conflict = entry.conflict.map((reading) => ({
      convention: reading.convention,
      value: redactParamValue(reading.value),
    }));
  }
  return redacted;
}

/**
 * `shouldRedactParam` + `redactParamEntry`, applied across a list of entries —
 * reused by `query`, a form body, and a URL's decoded query string alike.
 */
function redactEntries(
  entries: ParamEntry[],
  tally: { count: number },
): { entries: ParamEntry[]; changed: boolean } {
  let changed = false;
  const result = entries.map((entry) => {
    if (!shouldRedactParam(entry)) return entry;
    changed = true;
    tally.count++;
    return redactParamEntry(entry);
  });
  return { entries: result, changed };
}

function redactParamSet(params: ParamSet | undefined, tally: { count: number }): ParamSet | undefined {
  if (!params) return params;
  const { entries, changed } = redactEntries(params.entries, tally);
  return changed ? { entries } : params;
}

/**
 * Split a URL into everything before its query string, the query string
 * itself (no leading `?`), and everything from a `#` fragment onward — so the
 * query can be decoded, redacted and re-encoded without disturbing the
 * origin, path or fragment. Not a general URL parser: it only ever looks for
 * the first `?` and the first `#`, which is all `redactUrl` needs.
 */
function splitUrl(url: string): { prefix: string; query: string; suffix: string } {
  const hashAt = url.indexOf("#");
  const withoutFragment = hashAt < 0 ? url : url.slice(0, hashAt);
  const fragment = hashAt < 0 ? "" : url.slice(hashAt);
  const queryAt = withoutFragment.indexOf("?");
  if (queryAt < 0) return { prefix: withoutFragment, query: "", suffix: fragment };
  return { prefix: withoutFragment.slice(0, queryAt), query: withoutFragment.slice(queryAt + 1), suffix: fragment };
}

/**
 * Redact credential-shaped query parameters from a URL, **rewriting the URL
 * string itself** from the redacted parameters — see this module's header
 * comment for why leaving the original text next to a scrubbed copy would be
 * worse than not scrubbing at all. Out of scope: a credential embedded in the
 * path rather than the query string.
 */
function redactUrl(url: string | undefined, tally: { count: number }): string | undefined {
  if (!url) return url;
  const { prefix, query, suffix } = splitUrl(url);
  if (query === "") return url;

  const { entries, changed } = redactEntries(decodeParams(query).entries, tally);
  if (!changed) return url;

  const redactedQuery = encodeParams({ entries });
  return redactedQuery ? `${prefix}?${redactedQuery}${suffix}` : `${prefix}${suffix}`;
}

/* -------------------------------------------------------- body detection --- */

/**
 * A JWT-shaped substring, matched anywhere in a body rather than requiring
 * the whole string to be one, per `bodyMightContainCredential`.
 */
const JWT_ANYWHERE_RE = /[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/;
const STRIPE_KEY_ANYWHERE_RE = /\b(?:sk|pk)_[A-Za-z0-9_]{6,}\b/i;
/**
 * A `"...token...": "value"` or `token=value`-shaped pair, JSON- or
 * form-style, naming a credential-ish field rather than being a bare token.
 */
const CREDENTIAL_KEY_VALUE_RE =
  /["']?[\w-]*(?:token|secret|password|signature|api[-_]?key)[\w-]*["']?\s*[:=]\s*["']?[^"'\s,}&]{4,}/i;

/**
 * Sniff `raw` body text for a credential-shaped substring, without altering
 * it — full redaction of arbitrary body text (JSON, XML, plain text) is a
 * bigger job than this function attempts. Coarser than `detectCredentialShape`
 * on purpose: it matches a pattern *anywhere* in the text rather than
 * requiring the whole string to be one shape, because a body is prose or
 * structured data with a credential embedded in it, not a bare token.
 */
function bodyMightContainCredential(raw: string): boolean {
  return JWT_ANYWHERE_RE.test(raw) || STRIPE_KEY_ANYWHERE_RE.test(raw) || CREDENTIAL_KEY_VALUE_RE.test(raw);
}

/**
 * A form-urlencoded body (`BodyPart.form` populated) is redacted exactly like
 * `query` — it is the same `ParamSet` shape — and `raw` is **rewritten** from
 * the redacted form for the same reason a URL's query string is: a redacted
 * `form` sitting beside an untouched `raw` would still leak the secret the
 * moment anything serialises `raw`. Any other body is left untouched and
 * merely sniffed via `bodyMightContainCredential`.
 */
function redactBodyPart(
  body: BodyPart | undefined,
  tally: { count: number },
): { body: BodyPart | undefined; mayContainSecret: boolean } {
  if (!body) return { body, mayContainSecret: false };

  if (body.form) {
    const { entries, changed } = redactEntries(body.form.entries, tally);
    if (changed) {
      const redactedForm: ParamSet = { entries };
      return { body: { ...body, raw: encodeParams(redactedForm), form: redactedForm }, mayContainSecret: false };
    }
  }

  return { body, mayContainSecret: bodyMightContainCredential(body.raw) };
}

/**
 * A copy of `exchange` with every secret-bearing value replaced, a count of
 * how many were, and a flag for the one thing this function detects but
 * cannot safely rewrite. See this module's header comment for the exact
 * scope: headers, cookies, the URL, `query`, and a form body are fully
 * redacted (the URL and a form body's `raw` are rewritten, not left stale
 * beside a redacted copy); any other body is flagged, not altered.
 *
 * T2b's Copy/Download and T6's Share call this before writing an `exchange`
 * anywhere that leaves the browser — see this module's header comment for
 * why that has to be possible starting now, not added later.
 */
export function redactExchange(exchange: Exchange): RedactionResult {
  const tally = { count: 0 };

  const requestBody = redactBodyPart(exchange.request?.body, tally);
  const responseBody = redactBodyPart(exchange.response?.body, tally);
  const bodyMayContainSecret = requestBody.mayContainSecret || responseBody.mayContainSecret;

  const request = exchange.request
    ? {
        ...exchange.request,
        headers: redactHeaderSet(exchange.request.headers, tally),
        cookies: redactCookieSet(exchange.request.cookies, tally),
        url: redactUrl(exchange.request.url, tally),
        query: redactParamSet(exchange.request.query, tally),
        body: requestBody.body,
      }
    : exchange.request;

  const response = exchange.response
    ? {
        ...exchange.response,
        headers: redactHeaderSet(exchange.response.headers, tally),
        cookies: redactSetCookieSet(exchange.response.cookies, tally),
        body: responseBody.body,
      }
    : exchange.response;

  const redacted: Exchange = { ...exchange };
  if (request !== undefined) redacted.request = request;
  if (response !== undefined) redacted.response = response;

  return { exchange: redacted, count: tally.count, bodyMayContainSecret };
}
