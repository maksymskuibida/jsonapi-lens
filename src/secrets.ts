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
 *     reason, **read from what is stored**: the request form keeps a body as
 *     `{ raw, contentType }` only (`BodyPart.form` is never populated), so
 *     `classifyBody` decides whether it is a clean form — the one function the
 *     screen and the share both ask — and `raw` is **rewritten** from the
 *     redacted parameters.
 *   - **Header values that are URLs** (`Location`, `Referer`, `Content-Location`,
 *     `Origin`) and a URL's `user[:password]@` prefix: see `redactUrl`.
 *   - **Any other body** (JSON, plain text, multipart, anything that is not a
 *     clean form): **detected, not redacted.** Rewriting arbitrary body text without
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

import type { Exchange, BodyPart, OriginMeta, RequestPart, ResponsePart } from "./exchange.js";
import type { HeaderSet } from "./headers.js";
import type { CookieSet, SetCookieSet } from "./cookies.js";
import type { JsonObject } from "./types.js";
import { base64UrlToBytes, decodeParams, encodeParams, isUnsafeObjectKey, safeObject } from "./params.js";
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
  | { kind: "aws-key" }
  | { kind: "auth-scheme" }
  | { kind: "hex"; length: number }
  | { kind: "base64"; length: number };

// `{10,}` per segment, matching `JWT_ANYWHERE_RE` below — without a floor
// this matched `1.2.3`, `my.file.txt`, `en.US.utf8` and any other ordinary
// three-part dotted value, which `redactExchange` then rewrote out of a
// URL as `[REDACTED]` with nothing wrong to report. A real JWT segment is
// never this short (even the minimal `{"alg":"none"}` header is 20+
// base64url characters), so the floor costs no real detection.
const JWT_SHAPE_RE = /^[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/;
const STRIPE_KEY_RE = /^(sk|pk)_[A-Za-z0-9_]{6,}$/i;
/** An AWS access key id: `AKIA…` (long-lived) or `ASIA…` (temporary), 20 characters. */
const AWS_KEY_RE = /^(?:AKIA|ASIA)[0-9A-Z]{16}$/;
/** `Bearer x`, `Basic x`, `Token x`, `JWT x`: a credential whatever the length of `x`. */
const AUTH_SCHEME_VALUE_RE = /^(?:Bearer|Basic|Token|JWT)\s+\S+/i;
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
  if (AWS_KEY_RE.test(token)) return { kind: "aws-key" };
  if (token.length >= MIN_HEX_LENGTH && HEX_RE.test(token)) return { kind: "hex", length: token.length };
  if (token.length >= MIN_BASE64_LENGTH && BASE64_RE.test(token)) return { kind: "base64", length: token.length };
  // `Bearer x` is a credential whatever the length or shape of `x`.
  if (AUTH_SCHEME_VALUE_RE.test(value.trim())) return { kind: "auth-scheme" };
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

/**
 * Headers whose value is a URL. `Location: …/cb?access_token=…` and a `Referer`
 * carrying a token are common leaks and neither name is a credential name, so
 * `shouldMaskHeader` misses them; their value goes through the same URL
 * redaction as the request URL (userinfo, query, fragment).
 */
const URL_VALUED_HEADERS = new Set(["location", "referer", "content-location", "origin"]);

/** Is this a header whose value is a URL? The review masks these on screen the way the share does. */
export function isUrlValuedHeader(name: string): boolean {
  return URL_VALUED_HEADERS.has(name.toLowerCase());
}

function redactHeaderSet(headers: HeaderSet | undefined, tally: RedactionTally): HeaderSet | undefined {
  if (!headers) return headers;
  let changed = false;
  const entries = headers.entries.map((entry) => {
    if (!shouldMaskHeader(entry.name, entry.value)) {
      if (!URL_VALUED_HEADERS.has(entry.name.toLowerCase())) return entry;
      // A fresh tally per header value: `countedNames` exists so that a request's
      // `url` and `query` (two views of one table) count a parameter once. Two
      // different headers are two values, and sharing it made `Location` and
      // `Content-Location` carrying the same parameter name count as one (N5).
      const own = freshTally();
      const value = redactUrl(entry.value, own);
      if (value === undefined || value === entry.value) return entry;
      tally.count += own.count;
      changed = true;
      return { name: entry.name, value };
    }
    changed = true;
    tally.count++;
    return { name: entry.name, value: REDACTED_VALUE };
  });
  return changed ? { entries } : headers;
}

function redactCookieSet(cookies: CookieSet | undefined, tally: RedactionTally): CookieSet | undefined {
  if (!cookies || cookies.entries.length === 0) return cookies;
  tally.count += cookies.entries.length;
  return { entries: cookies.entries.map((cookie) => ({ name: cookie.name, value: REDACTED_VALUE })) };
}

/**
 * `Domain`/`Path`/`Expires`/`SameSite` never legitimately contain an `=` —
 * a hostname, a URL path, an RFC 1123 date and the three `SameSite` tokens
 * none of them do. Its presence is exactly the signature of the failure
 * `cookies.ts`'s own header comment warns about: a naive upstream comma-join
 * of several `Set-Cookie` lines smuggles a second cookie's `name=value` into
 * the first one's attribute text (`Path=/x, token=SECRET` parses as one
 * `path` of `"/x, token=SECRET"`, verbatim, by design — see that file's
 * "never comma-split" comment). `detectCredentialShape` is checked too, for
 * a value that is itself credential-shaped without any smuggled `=` at all.
 * Gated rather than blanket-redacted, so an ordinary `Expires`/`SameSite`
 * value stays readable — the spec's "expiry shown relative to now" needs it.
 */
function attributeLooksUnsafe(value: string | undefined): boolean {
  if (value === undefined) return false;
  return value.includes("=") || detectCredentialShape(value) !== null;
}

/**
 * Redacts `value` unconditionally (as before), and — the review-round-two
 * fix — every other field capable of holding wire text verbatim:
 * `domain`/`path`/`expires`/`sameSite` when `attributeLooksUnsafe`, and
 * `unrecognized[].value` unconditionally, since `unrecognized` is by
 * definition this parser's designated holding pen for arbitrary attribute
 * text it did not recognise (`cookies.ts`'s "Malformed Set-Cookie" row).
 * Attribute *names* and the flags (`secure`/`httpOnly`) are never secrets
 * and are left alone.
 */
function redactSetCookieSet(cookies: SetCookieSet | undefined, tally: RedactionTally): SetCookieSet | undefined {
  if (!cookies || cookies.entries.length === 0) return cookies;
  tally.count += cookies.entries.length;
  return {
    entries: cookies.entries.map((cookie) => ({
      ...cookie,
      value: REDACTED_VALUE,
      domain: attributeLooksUnsafe(cookie.domain) ? REDACTED_VALUE : cookie.domain,
      path: attributeLooksUnsafe(cookie.path) ? REDACTED_VALUE : cookie.path,
      expires: attributeLooksUnsafe(cookie.expires) ? REDACTED_VALUE : cookie.expires,
      sameSite: attributeLooksUnsafe(cookie.sameSite) ? REDACTED_VALUE : cookie.sameSite,
      unrecognized: cookie.unrecognized?.map((attribute) => ({
        name: attribute.name,
        value: attribute.value !== undefined ? REDACTED_VALUE : undefined,
      })),
    })),
  };
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
const SECRET_PARAM_NAME_SUBSTRINGS = [
  "token",
  "secret",
  "signature",
  "sig",
  "apikey",
  "password",
  "passwd",
  "pwd",
  // Added after QA6's review (S15). Each is a word that is, in practice, only
  // ever a credential: `authorization` (an `authorization=` parameter is a
  // header pasted into a form), `credential(s)`, `privatekey` (private_key,
  // privateKey), `clientassertion` (OAuth client_assertion JWTs), `codeverifier`
  // (the PKCE secret), `passphrase` and `passcode`.
  "authorization",
  "credential",
  "privatekey",
  "clientassertion",
  "codeverifier",
  "passphrase",
  "passcode",
];

/**
 * Names that are credentials only as a *whole* name (after normalisation, and
 * judged **per bracket/dot segment**, so `user[pass]` and `data.pwd` count):
 * as substrings they would mask `passport`, `bypass`, `compass`, `author`,
 * `authority` and `sessionization`.
 *   - `pass`, `auth`: the common short spellings of password / authorization;
 *   - `session`, `sessionid`, `sid`: a session identifier is a bearer credential;
 *   - `bearer`, `cookie`, `otp`: a pasted bearer token, cookie string, one-time code.
 * Deliberately **not** here: `key` (a sort key, a map key), `pin` (a map pin),
 * `code` (see `OAUTH_CONTEXT_NAMES`).
 */
const SECRET_PARAM_WHOLE_NAMES = new Set(["pass", "auth", "session", "sessionid", "sid", "bearer", "cookie", "otp"]);

/**
 * `code` is an OAuth credential (the authorization code) and also a perfectly
 * ordinary parameter (`code=US`, `code_style=…`, a promo code). It is masked
 * only when the same parameter set carries OAuth context — a `grant_type`,
 * `redirect_uri`, `client_id` or `code_verifier` — and otherwise left alone, so
 * a plain `code=4f2a9c` is not masked (D8 lists it under "not caught").
 */
const OAUTH_CONTEXT_NAMES = new Set(["granttype", "redirecturi", "clientid", "codeverifier"]);

/**
 * Percent-decode a parameter name for judging, as far as it will go (a
 * double-encoded `%255B` is `%5B` after one pass and `[` after two), without
 * ever throwing: a browser submits `name="user[pass]"` as `user%5Bpass%5D`, so a
 * name judged in its wire form is judged wrongly. `ok` is false when a pass
 * hit a malformed escape; the caller then judges the raw text *and* treats the
 * name as not clean (fail closed). `+` is a space in a form name.
 */
export function decodeParamNameForJudging(name: string): { names: string[]; ok: boolean } {
  const names = [name];
  let current = name;
  for (let pass = 0; pass < 3; pass++) {
    let next: string;
    try {
      next = decodeURIComponent(current.replace(/\+/g, "%20"));
    } catch {
      return { names, ok: false };
    }
    if (next === current) break;
    names.push(next);
    current = next;
  }
  return { names, ok: true };
}

export function hasOauthContext(entries: readonly ParamEntry[]): boolean {
  const names = new Set(entries.map((entry) => normalizeParamName(decodeParamNameForJudging(entry.name).names.at(-1) ?? entry.name)));
  if ([...OAUTH_CONTEXT_NAMES].some((needle) => names.has(needle))) return true;
  // The standard callback is `?code=…&state=…` with no `client_id`. `code` plus
  // `state` is treated as OAuth. Accepted cost: an address-like `code=US&state=CA`
  // is masked too — a click to reveal, against a login code left in a Referer.
  return names.has("code") && names.has("state");
}

function normalizeParamName(name: string): string {
  return name.toLowerCase().replace(/[-_ ]/g, "");
}

export function isSecretParamName(name: string, oauthContext = false): boolean {
  // The raw text and every decoded stage: `user%5Bpass%5D`, `%5b`, `%255B`.
  for (const candidate of decodeParamNameForJudging(name).names) {
    if (judgeDecodedName(candidate, oauthContext)) return true;
  }
  return false;
}

function judgeDecodedName(name: string, oauthContext: boolean): boolean {
  const whole = normalizeParamName(name);
  if (SECRET_PARAM_NAME_SUBSTRINGS.some((needle) => whole.includes(needle))) return true;
  // Rails-style `user[pass]` and dotted `data.pwd`: each segment is judged on its own.
  const segments = name.split(/[\[\].]+/).filter((segment) => segment !== "").map(normalizeParamName);
  for (const segment of segments.length > 0 ? segments : [whole]) {
    if (SECRET_PARAM_WHOLE_NAMES.has(segment)) return true;
    if (oauthContext && segment === "code") return true;
  }
  return false;
}

/**
 * Does any leaf of a decoded parameter value — a plain string, or one nested
 * in an array/object — look like a credential?
 */
/** A URL with userinfo inside a value (`u=https://admin:SECRET@h/`): the same shape the request-URL path masks. */
const URL_WITH_USERINFO_RE = /[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s\/?#@]+@/;

function valueHasCredentialShape(value: ParamValue | undefined): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return detectCredentialShape(value) !== null || URL_WITH_USERINFO_RE.test(value);
  if (Array.isArray(value)) return value.some(valueHasCredentialShape);
  if (typeof value === "object") return Object.values(value).some(valueHasCredentialShape);
  return false; // number, boolean
}

/**
 * Should this parameter be redacted — by name, or because any reading of its
 * value looks like a credential? Exported as `isSecretParam`: the review masks
 * on screen with the same test redaction uses.
 */
function shouldRedactParam(entry: ParamEntry, oauthContext = false): boolean {
  if (paramNameCarriesCredential(entry)) return true;
  if (isSecretParamName(entry.name, oauthContext)) return true;
  // A bracketed or dotted name is decoded into a tree under its first segment
  // (`user[pass]` becomes `user` -> `pass`), so the entry's own name is just `user`.
  // The wire keys keep the whole path: judge those too.
  if (entry.raw.some((pair) => isSecretParamName(pair.key, oauthContext))) return true;
  if (valueHasCredentialShape(entry.value)) return true;
  if (entry.alternatives.some((alt) => valueHasCredentialShape(alt.value))) return true;
  if (entry.conflict?.some((reading) => valueHasCredentialShape(reading.value))) return true;
  return false;
}

/** `siblings`: the other parameters of the same set, for the OAuth-context rule on `code`. */
/**
 * Does this parameter's **name** carry a credential? A bare JWT used as a name
 * (`password=x&eyJ…`), or a dotted/bracketed name with a credential-shaped
 * segment (`token.<key>`, `user[<key>][password]`). Judged on every wire key,
 * decoded as far as it goes, whole and per segment.
 */
export function paramNameCarriesCredential(entry: ParamEntry): boolean {
  return entry.raw.some((pair) => keyCarriesCredential(pair.key)) || keyCarriesCredential(entry.name);
}

function keyCarriesCredential(key: string): boolean {
  for (const candidate of decodeParamNameForJudging(key).names) {
    if (detectCredentialShape(candidate) !== null) return true;
    if (candidate.split(/[\[\].]+/).some((segment) => segment !== "" && detectCredentialShape(segment) !== null)) return true;
  }
  return false;
}

/** Is any wire key of this entry a path (`a[b]`, `a.b`)? Such a name can carry text of its own. */
function hasPathName(entry: ParamEntry): boolean {
  return entry.raw.some((pair) => decodeParamNameForJudging(pair.key).names.some((n) => /[\[\].]/.test(n)));
}

/** `siblings`: the other parameters of the same set, for the OAuth-context rule on `code`. */
export function isSecretParam(entry: ParamEntry, siblings: readonly ParamEntry[] = []): boolean {
  return shouldRedactParam(entry, hasOauthContext(siblings));
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
function redactParamEntry(entry: ParamEntry, oauthContext = false): ParamEntry {
  // A name that carries a credential, or a path name (`user[K][password]`,
  // `token.K`) on an entry that is secret by name, can hold text of its own that
  // no detector can judge: the whole entry becomes `[REDACTED]=[REDACTED]`. A
  // plain secret name (`password`) is only a label and stays readable.
  if (paramNameCarriesCredential(entry) || (hasPathName(entry) && shouldRedactParam(entry, oauthContext))) {
    // One `[REDACTED]=[REDACTED]` per original wire pair, so the number of masked
    // occurrences in the output equals the number counted.
    const pairs = entry.raw.map(() => ({ key: REDACTED_VALUE, value: REDACTED_VALUE }));
    return pairs.length > 1
      ? {
          name: REDACTED_VALUE,
          raw: pairs,
          conventions: ["plain"],
          alternatives: [],
          conflict: pairs.map(() => ({ convention: "plain" as const, value: REDACTED_VALUE })),
        }
      : {
          name: REDACTED_VALUE,
          raw: pairs.length === 1 ? pairs : [{ key: REDACTED_VALUE, value: REDACTED_VALUE }],
          value: REDACTED_VALUE,
          convention: "plain",
          conventions: ["plain"],
          alternatives: [],
        };
  }
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

/** Per-request accumulator threaded through every param-redacting call so `count` reports honestly — see `redactEntries`. */
interface RedactionTally {
  count: number;
  /**
   * Parameter names already counted for *this request* — `url` and `query`
   * are two representations of the same table (`docs/task-specs/T2.md`: "the
   * table is the truth; the URL is a rendering of it"), so redacting the same
   * name in both must not report two drops for what a user experiences as
   * one. Not shared between the request and the response, and not shared
   * with a body — those are genuinely independent surfaces.
   */
  countedNames: Set<string>;
  /**
   * Whether `countedNames` applies. True for the surfaces that have a twin
   * (`url` and `query`); false for a body, where two parameters with the same
   * name are two values and each is counted (QA6: "every masked value counted").
   */
  dedupeNames: boolean;
}

function freshTally(dedupeNames = true): RedactionTally {
  return { count: 0, countedNames: new Set(), dedupeNames };
}

/** Is this decoded value actually *something* — not the absence of a value, and not an empty string? Redacting either removes nothing, so it must not be counted as a drop. */
function isEmptyParamValue(value: ParamValue | undefined): boolean {
  return value === undefined || value === null || value === "";
}

/**
 * `shouldRedactParam` + `redactParamEntry`, applied across a list of entries —
 * reused by `query`, a form body, and a URL's decoded query string alike.
 * Every entry that matches is still rewritten to `REDACTED_VALUE` (a
 * valueless or empty parameter is redacted the same as any other, so its
 * *shape* on the wire does not change), but `tally.count` only grows for a
 * name that (a) had something in it to remove and (b) has not already been
 * counted for this request — see `RedactionTally`.
 */
function redactEntries(entries: ParamEntry[], tally: RedactionTally): { entries: ParamEntry[]; changed: boolean } {
  let changed = false;
  const oauth = hasOauthContext(entries);
  const result = entries.map((entry) => {
    if (!shouldRedactParam(entry, oauth)) return entry;
    changed = true;
    // Every masked wire pair is a value that was removed: `a[]=1&a[]=x&a[pass]=2`
    // is one decoded entry but three values. A name that also appears in the twin
    // surface (`url` and `query`) is counted once, by the first to see it.
    let values = entry.raw.filter((pair) => pair.value !== null && pair.value !== "").length;
    if (values === 0 && !isEmptyParamValue(entry.value)) values = 1;
    // A credential used as a bare name has no value to count, but it was removed.
    if (values === 0 && (paramNameCarriesCredential(entry) || hasPathName(entry))) values = Math.max(1, entry.raw.length);
    if (values > 0 && !(tally.dedupeNames && tally.countedNames.has(entry.name))) {
      tally.count += values;
      tally.countedNames.add(entry.name);
    }
    return redactParamEntry(entry, oauth);
  });
  return { entries: result, changed };
}

function redactParamSet(params: ParamSet | undefined, tally: RedactionTally): ParamSet | undefined {
  if (!params) return params;
  const { entries, changed } = redactEntries(params.entries, tally);
  return changed ? { entries } : params;
}

/**
 * Split a URL into everything before its query string, the query string
 * itself (no leading `?`), and everything from a `#` fragment onward — so the
 * query and the fragment can each be decoded, redacted and re-encoded
 * without disturbing the origin or path. Not a general URL parser: it only
 * ever looks for the first `?` and the first `#`, which is all `redactUrl`
 * needs.
 */
function splitUrl(url: string): { prefix: string; query: string; fragment: string } {
  const hashAt = url.indexOf("#");
  const withoutFragment = hashAt < 0 ? url : url.slice(0, hashAt);
  const fragment = hashAt < 0 ? "" : url.slice(hashAt + 1); // without the leading `#`
  const queryAt = withoutFragment.indexOf("?");
  if (queryAt < 0) return { prefix: withoutFragment, query: "", fragment };
  return { prefix: withoutFragment.slice(0, queryAt), query: withoutFragment.slice(queryAt + 1), fragment };
}

/**
 * Redact a query-string-shaped piece of a URL (the query itself, or the
 * fragment) through the normal decode/redact/encode pipeline. Returns the
 * original text, byte for byte, when nothing in it needed redacting — an
 * ordinary anchor like `#section` decodes to one harmless valueless
 * parameter and re-encodes to exactly itself, so this never rewrites a
 * fragment that was not carrying parameters at all.
 */
function redactQueryShapedText(text: string, tally: RedactionTally): string {
  if (text === "") return text;
  const { entries, changed } = redactEntries(decodeParams(text).entries, tally);
  if (!changed) return text;
  return encodeParams({ entries });
}

/**
 * Mask a URL's `user[:password]@` prefix — **all of it**, as one counted value
 * (QA6 review B2, then B3).
 *
 * `https://admin:hunter2pass@api.example.com/x` carries a password in the part
 * of the URL that comes *before* the query, which `redactUrl` used to keep
 * verbatim — and the review band does not display it, so nobody could even see
 * it was there. The first fix masked only the password and kept the user name;
 * that leaks exactly the forms where the **user name** is the secret —
 * Stripe's `https://sk_live_…:@api.stripe.com` and GitHub's
 * `https://<token>:x-oauth-basic@github.com`. Deciding whether a user name
 * "looks like a credential" is the same detector gap that caused the bug, so
 * the rule does not depend on it: the whole userinfo becomes
 * `[REDACTED]`, `https://[REDACTED]@host/…`. The cost is that an ordinary user
 * name is hidden too; a reader still sees that one was present.
 * The authority ends at the first `/`, so an `@` in a path never matches. A
 * `mailto:` address is not userinfo. A scheme-less `user:pw@host/x` is treated
 * like a schemed one, because the request form accepts it. A non-hierarchical
 * scheme with an `@` (`sip:alice:secret@host`) is over-redacted to
 * `sip:[REDACTED]@host`-shaped text; harmless, and not what this tool reviews.
 */
function redactUserinfo(prefix: string, tally: RedactionTally): string {
  const schemeEnd = prefix.indexOf("://");
  const start = schemeEnd >= 0 ? schemeEnd + 3 : 0;
  if (schemeEnd < 0 && /^mailto:/i.test(prefix)) return prefix;
  const slash = prefix.indexOf("/", start);
  const authorityEnd = slash < 0 ? prefix.length : slash;
  const authority = prefix.slice(start, authorityEnd);
  const at = authority.lastIndexOf("@");
  if (at <= 0) return prefix; // no userinfo, or an empty one (`https://@host`): nothing to hide
  if (authority.slice(0, at) === REDACTED_VALUE) return prefix; // already redacted: idempotent, not counted twice
  tally.count++;
  return `${prefix.slice(0, start)}${REDACTED_VALUE}${authority.slice(at)}${prefix.slice(authorityEnd)}`;
}

/**
 * Redact credential-shaped parameters from a URL's query string **and its
 * fragment**, rewriting the URL string itself — see this module's header
 * comment for why leaving the original text next to a scrubbed copy would be
 * worse than not scrubbing at all. The fragment matters as much as the query:
 * `#access_token=…` is where the OAuth 2.0 implicit flow returns a bearer
 * token, at least as common a place for a real credential as `?api_key=`,
 * and it is exactly as query-shaped. Also masked: the `user:password@` prefix
 * (`redactUserinfo`). Out of scope: a credential embedded in the URL's path.
 */
function redactUrl(url: string | undefined, tally: RedactionTally): string | undefined {
  if (!url) return url;
  const { prefix: originalPrefix, query, fragment } = splitUrl(url);
  const prefix = redactUserinfo(originalPrefix, tally);
  const redactedQuery = redactQueryShapedText(query, tally);
  const redactedFragment = redactQueryShapedText(fragment, tally);
  if (prefix === originalPrefix && redactedQuery === query && redactedFragment === fragment) return url;

  // `||`, not a plain truthiness check on the redacted text alone: an
  // originally-present-but-now-empty query/fragment (only reachable via a
  // degenerate empty-name valueless entry) must still keep its `?`/`#`
  // marker rather than silently disappearing.
  const queryPart = redactedQuery || query !== "" ? `?${redactedQuery}` : "";
  const fragmentPart = redactedFragment || fragment !== "" ? `#${redactedFragment}` : "";
  return `${prefix}${queryPart}${fragmentPart}`;
}

/**
 * A URL as it may be shown on screen: userinfo and credential-like query or
 * fragment parameters replaced, everything else byte for byte. The same
 * redaction Copy/Download/Share apply, so what is on screen is never more than
 * what could be exported (QA6, gap A).
 */
export function maskUrlForDisplay(url: string): string {
  return redactUrl(url, freshTally()) ?? url;
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
// Bare long hex/base64 runs, at the same length floors `detectCredentialShape`
// uses — a value that function would itself call a credential (a 64-hex
// session id, a long base64 token) must not read as "clean" here just
// because it arrived inside a body instead of a header. Not anchored to a
// word boundary: `+`/`/` in the base64 alphabet are not `\w` characters, so a
// boundary check would be unreliable right at those characters, and a match
// that happens to be a substring of a longer run still correctly says "there
// is credential-shaped text here".
const HEX_ANYWHERE_RE = new RegExp(`[0-9a-fA-F]{${MIN_HEX_LENGTH},}`);
const BASE64_ANYWHERE_RE = new RegExp(`[A-Za-z0-9+/_-]{${MIN_BASE64_LENGTH},}`);

/**
 * Sniff `raw` body text for a credential-shaped substring, without altering
 * it — full redaction of arbitrary body text (JSON, XML, plain text) is a
 * bigger job than this function attempts. Coarser than `detectCredentialShape`
 * on purpose: it matches a pattern *anywhere* in the text rather than
 * requiring the whole string to be one shape, because a body is prose or
 * structured data with a credential embedded in it, not a bare token.
 */
function bodyMightContainCredential(raw: string): boolean {
  if (MULTIPART_RE.test(raw)) return true; // cannot be parsed here: any multipart body is flagged
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    /* not percent-encoded text */
  }
  if (decoded !== raw && bodyMightContainCredential(decoded)) return true;
  return (
    JWT_ANYWHERE_RE.test(raw) ||
    STRIPE_KEY_ANYWHERE_RE.test(raw) ||
    CREDENTIAL_KEY_VALUE_RE.test(raw) ||
    HEX_ANYWHERE_RE.test(raw) ||
    BASE64_ANYWHERE_RE.test(raw)
  );
}

/**
 * Does this body parse **cleanly** as a form — and if so, what are its
 * parameters? The one answer the screen (`renderBodyPart`), the redaction
 * (`redactBodyPart`) and the share dialog's warning all use; two classifiers
 * that disagree are how a value is masked in the share and shown in clear on
 * screen, or the reverse (QA6 review B4, B5).
 *
 * The request form stores a body as `{ raw, contentType }` and nothing else —
 * `BodyPart.form` is never populated — so this reads what is stored. Clean means
 * all of:
 *   - the content type is `application/x-www-form-urlencoded` (any parameters,
 *     any case), or empty, or `text/plain` (people leave it blank; over-redacting
 *     a body that merely looked like a form is safe, under-redacting is not);
 *   - the text does not start with `{ [ " <` **whatever the content type** — a
 *     JSON body labelled as a form is not a form;
 *   - it contains no whitespace and no `;` (so a multi-line or `;`-separated body
 *     is not read as one) and every `&`-separated piece is non-empty and decodes;
 *   - every parameter **name**, once percent-decoded, is only letters, digits
 *     and `_ . - [ ]`. A name containing `{ " : = =` or a space means the text
 *     was not a form (`password%3Dsecret` decodes to one name with an `=` in it),
 *     and treating it as one would hide the secret in a "parameter name";
 *   - outside the declared-form type, each piece has an `=`.
 * Anything else is `other`: never rewritten, and flagged when in doubt.
 */
export type BodyKind = { kind: "form"; params: ParamSet } | { kind: "other" };

const FORM_CONTENT_TYPE_RE = /^\s*application\/x-www-form-urlencoded\s*(?:;|$)/i;
const PLAIN_OR_EMPTY_CONTENT_TYPE_RE = /^\s*(?:text\/plain\s*(?:;.*)?)?$/i;
const JSON_OR_MARKUP_START_RE = /^[{["<]/;
const STRICT_PARAM_NAME_RE = /^[A-Za-z0-9_.\-[\]]+$/;

export function classifyBody(body: BodyPart): BodyKind {
  const text = body.raw.trim();
  if (text === "" || JSON_OR_MARKUP_START_RE.test(text) || /[\s;]/.test(text)) return { kind: "other" };
  const contentType = body.contentType ?? "";
  const declaredForm = FORM_CONTENT_TYPE_RE.test(contentType);
  if (!declaredForm && !PLAIN_OR_EMPTY_CONTENT_TYPE_RE.test(contentType)) return { kind: "other" };

  for (const piece of text.split("&")) {
    if (piece === "") return { kind: "other" };
    const eq = piece.indexOf("=");
    if (eq < 0 && !declaredForm) return { kind: "other" };
    const rawName = eq < 0 ? piece : piece.slice(0, eq);
    let name: string;
    try {
      name = decodeURIComponent(rawName.replace(/\+/g, "%20"));
    } catch {
      return { kind: "other" };
    }
    if (!STRICT_PARAM_NAME_RE.test(name)) return { kind: "other" };
  }
  return { kind: "form", params: decodeParams(text) };
}

/** Is this text a multipart body? Neither redacted nor parsed. */
const MULTIPART_RE = /content-disposition\s*:\s*form-data/i;

/**
 * Is anything credential-like still in a form's parameters *after* redaction?
 * A name that is itself shaped like a credential (`sk_live_…` as a bare name),
 * a secret-looking name that somehow survived, or a remaining pair the coarse
 * body sniffer fires on. Redaction masks the pairs it recognises; this is the
 * check on what it left, so that "rewritten" never means "safe".
 */
function formHasLeftovers(original: ParamEntry[]): boolean {
  // Only what redaction did not touch can be a leftover; a redacted entry is masked.
  // Judged on the **wire text** (`entry.raw`), not the decoded tree: a dotted bare
  // name such as a JWT is split into nested keys by the decoder, which loses it.
  const oauth = hasOauthContext(original);
  return original
    .filter((entry) => !shouldRedactParam(entry, oauth))
    .some((entry) =>
      entry.raw.some(
        (pair) =>
          detectCredentialShape(pair.key) !== null ||
          isSecretParamName(pair.key) ||
          bodyMightContainCredential(pair.value === null ? pair.key : `${pair.key}=${pair.value}`),
      ),
    );
}

/**
 * **Fail closed.** The "this body may contain credentials" warning is
 * suppressed in exactly one case: the body is a **clean form**
 * (`classifyBody`: no `;`, no whitespace, strict parameter names, form-like
 * content type), it went through redaction, and **nothing credential-like is
 * left** in its names or values (`formHasLeftovers`). Every other non-empty
 * body — JSON, text, multipart, an unclean or ambiguous form, a rewritten form
 * with leftovers — warns, whatever its content type and whatever the coarse
 * sniffer says. Over-warning costs a line of text; a silent share is the
 * failure this module exists to prevent (QA6 review B6, S13).
 *
 * A clean form is redacted exactly like `query` — the same `ParamSet` path —
 * and `raw` is **rewritten** from the redacted parameters, so nothing
 * unredacted is left beside them. Anything else is left untouched.
 */
function redactBodyPart(
  body: BodyPart | undefined,
  tally: RedactionTally,
): { body: BodyPart | undefined; mayContainSecret: boolean } {
  if (!body) return { body, mayContainSecret: false };
  if (body.raw.trim() === "") return { body, mayContainSecret: false };

  const classified = classifyBody(body);
  if (classified.kind !== "form") return { body, mayContainSecret: true };

  const { entries, changed } = redactEntries(classified.params.entries, tally);
  const leftovers = formHasLeftovers(classified.params.entries);
  if (!changed) return { body, mayContainSecret: leftovers };
  const redactedForm: ParamSet = { entries };
  return { body: { ...body, raw: encodeParams(redactedForm), form: redactedForm }, mayContainSecret: leftovers };
}

/**
 * Walk an arbitrary value from `OriginMeta` — still T3's opaque placeholder
 * (see `exchange.ts`'s header comment) — redacting a string leaf that is
 * itself credential-shaped, or that sits under a credential-ish key name
 * (`isSecretParamName`, the same substring match a query parameter's name
 * gets: an origin field name is exactly as author-chosen). Nothing writes
 * `origin` today, but T3 is being built against this branch right now, and
 * the natural thing for a cURL/HAR importer to keep there is the source
 * text it parsed — which is exactly where an `Authorization` header would
 * still be sitting.
 *
 * Built on `safeObject()` and rejects `__proto__`/`constructor`/`prototype`
 * exactly as `params.ts` does, for the identical reason: copying an
 * arbitrary object's keys onto a `{}` one at a time is the same
 * prototype-pollution shape, and `origin` is exactly as attacker-controlled
 * as a query string once an importer starts keeping raw source text in it.
 */
function redactUnknown(
  value: unknown,
  keyLooksSecret: boolean,
  tally: RedactionTally,
): { value: unknown; changed: boolean } {
  if (typeof value === "string") {
    if (keyLooksSecret || detectCredentialShape(value) !== null) {
      tally.count++;
      return { value: REDACTED_VALUE, changed: true };
    }
    return { value, changed: false };
  }

  if (Array.isArray(value)) {
    let changed = false;
    const mapped = value.map((item) => {
      const result = redactUnknown(item, keyLooksSecret, tally);
      if (result.changed) changed = true;
      return result.value;
    });
    return changed ? { value: mapped, changed: true } : { value, changed: false };
  }

  if (value !== null && typeof value === "object") {
    let changed = false;
    const out = safeObject<unknown>();
    for (const [key, item] of Object.entries(value)) {
      if (isUnsafeObjectKey(key)) {
        changed = true; // rejected, not copied — see params.ts's "tree building" header
        continue;
      }
      const result = redactUnknown(item, isSecretParamName(key), tally);
      if (result.changed) changed = true;
      out[key] = result.value;
    }
    return changed ? { value: out, changed: true } : { value, changed: false };
  }

  return { value, changed: false }; // number, boolean, null, undefined
}

function redactOrigin(origin: OriginMeta | undefined, tally: RedactionTally): OriginMeta | undefined {
  if (!origin) return origin;
  const result = redactUnknown(origin, false, tally);
  return result.changed ? (result.value as OriginMeta) : origin;
}

/**
 * A copy of `exchange` with every secret-bearing value replaced, a count of
 * how many were, and a flag for the one thing this function detects but
 * cannot safely rewrite. See this module's header comment for the exact
 * scope: headers, cookies, the URL, `query`, `origin`, and a form body are
 * fully redacted (the URL and a form body's `raw` are rewritten, not left
 * stale beside a redacted copy); any other body is flagged, not altered.
 *
 * `count` is tallied per surface, not with one shared counter, because `url`
 * and `query` are two representations of the same table and redacting the
 * same parameter in both must report one drop, not two — see
 * `RedactionTally` — while a request body, a response body, and each side's
 * headers/cookies are independent surfaces whose counts simply add.
 *
 * T2b's Copy/Download and T6's Share call this before writing an `exchange`
 * anywhere that leaves the browser — see this module's header comment for
 * why that has to be possible starting now, not added later.
 */
export function redactExchange(exchange: Exchange): RedactionResult {
  const requestUrlQueryTally = freshTally();
  const requestHeaderCookieTally = freshTally();
  const requestBodyTally = freshTally(false);
  const responseHeaderCookieTally = freshTally();
  const responseBodyTally = freshTally(false);
  const originTally = freshTally();

  const requestBody = redactBodyPart(exchange.request?.body, requestBodyTally);
  const responseBody = redactBodyPart(exchange.response?.body, responseBodyTally);
  const bodyMayContainSecret = requestBody.mayContainSecret || responseBody.mayContainSecret;

  const request = exchange.request
    ? {
        ...exchange.request,
        headers: redactHeaderSet(exchange.request.headers, requestHeaderCookieTally),
        cookies: redactCookieSet(exchange.request.cookies, requestHeaderCookieTally),
        url: redactUrl(exchange.request.url, requestUrlQueryTally),
        query: redactParamSet(exchange.request.query, requestUrlQueryTally),
        body: requestBody.body,
      }
    : exchange.request;

  const response = exchange.response
    ? {
        ...exchange.response,
        headers: redactHeaderSet(exchange.response.headers, responseHeaderCookieTally),
        cookies: redactSetCookieSet(exchange.response.cookies, responseHeaderCookieTally),
        body: responseBody.body,
      }
    : exchange.response;

  const origin = redactOrigin(exchange.origin, originTally);

  const redacted: Exchange = { ...exchange };
  if (request !== undefined) redacted.request = request;
  if (response !== undefined) redacted.response = response;
  if (origin !== undefined) redacted.origin = origin;

  const count =
    requestUrlQueryTally.count +
    requestHeaderCookieTally.count +
    requestBodyTally.count +
    responseHeaderCookieTally.count +
    responseBodyTally.count +
    originTally.count;

  return { exchange: redacted, count, bodyMayContainSecret };
}


/* ------------------------------------------------ canonical export + sweep --- */

/**
 * What leaves the browser is a **canonical exchange**, never the in-memory model.
 *
 * The model holds the same datum several ways — `url` and `query`, `raw` and
 * `form`, `entries[].raw[].key` and the decoded tree — and every extra
 * representation is one more place redaction has to be right. Three leaks in a
 * row had that shape (QA6 blind QA: a credential used as a parameter *name*
 * survived in a derived key while the parsed value was masked). So Copy,
 * Download and the sealed share carry **one** copy of each field: the URL as a
 * string, headers and cookies as name/value, each body as `{ contentType, raw }`,
 * the response status. Derived structures (`query`, `form`, parsed trees) are not
 * sent; the reader re-derives them on load, exactly as for a request typed into
 * the form (`queryOf`, `render-request.ts`). The envelope is unchanged: an old
 * link that still carries `query`/`form` opens as before.
 */
function canonicalBody(body: BodyPart | undefined): BodyPart | undefined {
  if (!body) return undefined;
  const out: BodyPart = { raw: body.raw };
  if (body.contentType !== undefined) out.contentType = body.contentType;
  return out;
}

function canonicalHeaders(headers: HeaderSet | undefined): HeaderSet | undefined {
  return headers ? { entries: headers.entries.map((e) => ({ name: e.name, value: e.value })) } : undefined;
}

export function canonicalExchange(exchange: Exchange): Exchange {
  const out: Exchange = {};
  if (exchange.request) {
    const r = exchange.request;
    const request: RequestPart = {};
    if (r.method !== undefined) request.method = r.method;
    if (r.url !== undefined) request.url = r.url;
    const headers = canonicalHeaders(r.headers);
    if (headers) request.headers = headers;
    if (r.cookies) request.cookies = { entries: r.cookies.entries.map((c) => ({ name: c.name, value: c.value })) };
    const body = canonicalBody(r.body);
    if (body) request.body = body;
    out.request = request;
  }
  if (exchange.response) {
    const r = exchange.response;
    const response: ResponsePart = {};
    if (r.status !== undefined) response.status = r.status;
    if (r.statusText !== undefined) response.statusText = r.statusText;
    if (r.elapsedMs !== undefined) response.elapsedMs = r.elapsedMs;
    const headers = canonicalHeaders(r.headers);
    if (headers) response.headers = headers;
    if (r.cookies) response.cookies = r.cookies; // parsed Set-Cookie readings: the only copy
    const body = canonicalBody(r.body);
    if (body) response.body = body;
    out.response = response;
  }
  if (exchange.origin !== undefined) out.origin = exchange.origin;
  return out;
}

/**
 * The final fail-closed sweep: tokens whose shape is unmistakable, wherever they
 * sit in a string that is not already masked — a JWT, a Stripe key, an AWS key
 * id, `Bearer`/`Basic`/`Token` followed by anything, and a URL's `user:pw@`.
 * Deliberately **not** the generic hex/base64 length rule: applied inside URLs
 * and header values it would mask etags and long path slugs. Returns the text
 * with each hit replaced by `[REDACTED]` and the number of hits.
 */
const SWEEP_RES: Array<[RegExp, string]> = [
  [/\bey[A-Za-z0-9_-]{6,}\.ey[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g, REDACTED_VALUE],
  [/\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9_]{6,}/gi, REDACTED_VALUE],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, REDACTED_VALUE],
  [/\b(?:Bearer|Basic|Token)\s+(?!\[REDACTED\])[^\s,;"']+/gi, REDACTED_VALUE],
];
const SWEEP_USERINFO_RE = /([A-Za-z][A-Za-z0-9+.-]*:\/\/)(?!\[REDACTED\]@)([^\s\/?#@]+)@/g;

function sweepText(text: string, tally: RedactionTally): string {
  let out = text;
  for (const [re, replacement] of SWEEP_RES) {
    out = out.replace(re, () => {
      tally.count++;
      return replacement;
    });
  }
  out = out.replace(SWEEP_USERINFO_RE, (_m, scheme: string) => {
    tally.count++;
    return `${scheme}${REDACTED_VALUE}@`;
  });
  return out;
}

function sweepHeaders(headers: HeaderSet | undefined, tally: RedactionTally): HeaderSet | undefined {
  if (!headers) return headers;
  return {
    entries: headers.entries.map((e) => ({
      name: sweepText(e.name, tally),
      value: e.value === REDACTED_VALUE ? e.value : sweepText(e.value, tally),
    })),
  };
}

/** What Copy, Download and the share send, and how many values were masked to make it. */
export function redactForExport(exchange: Exchange): RedactionResult {
  const base = redactExchange(exchange);
  const canonical = canonicalExchange(base.exchange);
  const sweep = freshTally(false);

  if (canonical.request) {
    const r = canonical.request;
    if (r.method !== undefined) r.method = sweepText(r.method, sweep);
    if (r.url !== undefined) r.url = sweepText(r.url, sweep);
    r.headers = sweepHeaders(r.headers, sweep) ?? r.headers;
    if (r.cookies) r.cookies = { entries: r.cookies.entries.map((c) => ({ name: sweepText(c.name, sweep), value: c.value })) };
    if (r.body && classifyBody(r.body).kind === "form") r.body = { ...r.body, raw: sweepText(r.body.raw, sweep) };
  }
  if (canonical.response) {
    const r = canonical.response;
    if (r.statusText !== undefined) r.statusText = sweepText(r.statusText, sweep);
    r.headers = sweepHeaders(r.headers, sweep) ?? r.headers;
    if (r.body && classifyBody(r.body).kind === "form") r.body = { ...r.body, raw: sweepText(r.body.raw, sweep) };
  }
  return { exchange: canonical, count: base.count + sweep.count, bodyMayContainSecret: base.bodyMayContainSecret };
}
