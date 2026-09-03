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
 * Pure data and pure functions — no DOM, no `t()`.
 */

import type { Exchange } from "./exchange.js";
import type { HeaderSet } from "./headers.js";
import type { CookieSet, SetCookieSet } from "./cookies.js";
import type { JsonObject } from "./types.js";
import { base64UrlToBytes } from "./params.js";

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
  /** How many values were replaced — headers and cookies combined, on both sides of the exchange. */
  count: number;
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

/**
 * A copy of `exchange` with every secret-bearing value replaced, plus a count
 * of how many were. "Secret-bearing" here is headers (masked by name via
 * `isSecretHeaderName`, or by value shape via `detectCredentialShape`) and
 * cookie values — request `Cookie` rows and response `Set-Cookie` rows alike
 * — on both the request and the response. Cookie *values* are always
 * replaced regardless of shape: a cookie is exactly the kind of thing the
 * spec's masked-by-default list already calls out by name (`cookie`,
 * `set-cookie`), and unlike a header, a cookie has no legitimate reason to
 * hold a value someone would want to read back off an exported copy. Cookie
 * *names*, *attributes* (`Domain`, `Path`, `Expires`, ...), the URL, query
 * parameters and body text are left untouched — outside what the spec's
 * "Headers, cookies, and secrets" section asks this module to cover, and a
 * body/URL secret scanner is a different, higher-false-positive feature
 * nobody has asked for.
 *
 * T2b's Copy/Download and T6's Share call this before writing an `exchange`
 * anywhere that leaves the browser — see this module's header comment for
 * why that has to be possible starting now, not added later.
 */
export function redactExchange(exchange: Exchange): RedactionResult {
  const tally = { count: 0 };

  const request = exchange.request
    ? {
        ...exchange.request,
        headers: redactHeaderSet(exchange.request.headers, tally),
        cookies: redactCookieSet(exchange.request.cookies, tally),
      }
    : exchange.request;

  const response = exchange.response
    ? {
        ...exchange.response,
        headers: redactHeaderSet(exchange.response.headers, tally),
        cookies: redactSetCookieSet(exchange.response.cookies, tally),
      }
    : exchange.response;

  const redacted: Exchange = { ...exchange };
  if (request !== undefined) redacted.request = request;
  if (response !== undefined) redacted.response = response;

  return { exchange: redacted, count: tally.count };
}
