/**
 * The HAR importer — `docs/task-specs/T3.md` importer #5. One HTTP Archive
 * can describe hundreds of calls, so `parse` always returns one
 * `Partial<Exchange>` per `log.entries[]` element — a single entry is simply
 * an array of length one, and the picker-or-not decision belongs to whoever
 * is about to show it, not to this module.
 *
 * ## The `Set-Cookie` trap this module exists to avoid
 *
 * A response can carry several `Set-Cookie` headers, and RFC 6265 forbids a
 * server from ever combining them with a comma — `Expires=Wed, 21 Oct 2026
 * 07:28:00 GMT` contains a comma that is not a separator, so joining values
 * first and splitting later is not a shortcut, it is data corruption. This
 * module never does it: `buildHeaderSet` below adds one `HeaderSet` entry per
 * array element HAR gives it (never joining), and `buildResponseCookies`
 * prefers HAR's own already-separated `response.cookies` array; when it has
 * to fall back to raw headers, it hands `cookies.ts#parseSetCookies` the
 * whole array of values in one call — that function's own contract is to
 * parse each one independently, never to join them first.
 */

import type { BodyPart, Exchange } from "../exchange.js";
import type { HeaderSet } from "../headers.js";
import { addHeader, getHeader, getHeaderAll, headerSet } from "../headers.js";
import type { Cookie, CookieSet, SetCookie, SetCookieSet } from "../cookies.js";
import { parseCookieHeader, parseSetCookies } from "../cookies.js";
import { t } from "../i18n/index.js";
import { shouldMaskHeader } from "../secrets.js";
import { fromBase64Standard, isPlainObject, safeDecodeParams, splitUrl, tryParseJson, tryUtf8Decode } from "./shared.js";
import type { Detection, ImportResult, Importer } from "./types.js";
import { ImportError } from "./types.js";

export const HAR_ID = "har";

function harEntries(parsed: unknown): unknown[] | null {
  if (!isPlainObject(parsed)) return null;
  const log = parsed["log"];
  if (!isPlainObject(log)) return null;
  const entries = log["entries"];
  return Array.isArray(entries) ? entries : null;
}

export function detectHar(text: string): Detection | null {
  const parsed = tryParseJson(text);
  const entries = harEntries(parsed);
  if (entries === null) return null;
  return { id: HAR_ID, confidence: 0.92, summary: t().import.har.summary(entries.length) };
}

/* --------------------------------------------------------------- headers --- */

/** One `HeaderSet` entry per array element — never joined. See this file's header. */
function buildHeaderSet(rawHeaders: unknown): HeaderSet {
  let headers = headerSet([]);
  if (!Array.isArray(rawHeaders)) return headers;
  for (const entry of rawHeaders) {
    if (isPlainObject(entry) && typeof entry["name"] === "string" && typeof entry["value"] === "string") {
      headers = addHeader(headers, entry["name"], entry["value"]);
    }
  }
  return headers;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function buildRequestCookies(rawCookies: unknown, requestHeaders: HeaderSet): CookieSet | undefined {
  if (Array.isArray(rawCookies) && rawCookies.length > 0) {
    const entries: Cookie[] = rawCookies
      .filter(isPlainObject)
      .map((c) => ({ name: asString(c["name"]), value: asString(c["value"]) }));
    if (entries.length > 0) return { entries };
  }
  const cookieHeader = getHeader(requestHeaders, "cookie");
  return cookieHeader !== undefined ? { entries: parseCookieHeader(cookieHeader) } : undefined;
}

/** Prefers HAR's own structured `response.cookies`; falls back to `Set-Cookie` headers parsed one value at a time — never comma-joined. */
function buildResponseCookies(rawCookies: unknown, responseHeaders: HeaderSet): SetCookieSet | undefined {
  if (Array.isArray(rawCookies) && rawCookies.length > 0) {
    const entries: SetCookie[] = rawCookies.filter(isPlainObject).map((c) => {
      const cookie: SetCookie = { name: asString(c["name"]), value: asString(c["value"]) };
      if (typeof c["domain"] === "string") cookie.domain = c["domain"];
      if (typeof c["path"] === "string") cookie.path = c["path"];
      if (typeof c["expires"] === "string" && c["expires"].length > 0) {
        cookie.expires = c["expires"];
        const parsedDate = Date.parse(c["expires"]);
        if (!Number.isNaN(parsedDate)) cookie.expiresAt = parsedDate;
      }
      if (c["httpOnly"] === true) cookie.httpOnly = true;
      if (c["secure"] === true) cookie.secure = true;
      if (typeof c["sameSite"] === "string") cookie.sameSite = c["sameSite"];
      return cookie;
    });
    if (entries.length > 0) return { entries };
  }
  const setCookieValues = getHeaderAll(responseHeaders, "set-cookie");
  return setCookieValues.length > 0 ? parseSetCookies(setCookieValues) : undefined;
}

/* ------------------------------------------------------------------ body --- */

function buildRequestBody(postData: unknown): BodyPart | undefined {
  if (!isPlainObject(postData) || typeof postData["text"] !== "string") return undefined;
  const text: string = postData["text"];
  const mimeType = postData["mimeType"];
  const contentType = typeof mimeType === "string" && mimeType.length > 0 ? mimeType : undefined;
  const body: BodyPart = { raw: text };
  if (contentType !== undefined) body.contentType = contentType;
  if (contentType !== undefined && /application\/x-www-form-urlencoded/i.test(contentType)) {
    const decoded = safeDecodeParams(text);
    if (decoded !== null) body.form = decoded;
  }
  return body;
}

/**
 * A response `content` block: `{ size, mimeType, text?, encoding? }`. Binary
 * `base64` content that does not decode as UTF-8 text is shown as a size, per
 * the spec's edge-case table, rather than as mangled text or dropped
 * silently — `onBinary` lets the caller attribute the resulting warning to
 * the right entry.
 */
function buildResponseBody(content: unknown, onBinary: () => void): BodyPart | undefined {
  if (!isPlainObject(content) || typeof content["text"] !== "string") return undefined;
  const mimeType = content["mimeType"];
  const contentType = typeof mimeType === "string" && mimeType.length > 0 ? mimeType : undefined;
  const text = content["text"];

  if (content["encoding"] === "base64") {
    let bytes: Uint8Array;
    try {
      bytes = fromBase64Standard(text);
    } catch {
      const body: BodyPart = { raw: text };
      if (contentType !== undefined) body.contentType = contentType;
      return body;
    }
    const decoded = tryUtf8Decode(bytes);
    if (decoded === null) {
      onBinary();
      const body: BodyPart = { raw: t().import.har.bodyPlaceholderBinary(bytes.length) };
      if (contentType !== undefined) body.contentType = contentType;
      return body;
    }
    const body: BodyPart = { raw: decoded };
    if (contentType !== undefined) body.contentType = contentType;
    return body;
  }

  const body: BodyPart = { raw: text };
  if (contentType !== undefined) body.contentType = contentType;
  return body;
}

/* --------------------------------------------------------------- one entry --- */

function buildExchangeFromEntry(
  entry: Record<string, unknown>,
  index: number,
  warnings: string[],
): Partial<Exchange> | null {
  const req = entry["request"];
  if (!isPlainObject(req) || typeof req["method"] !== "string" || typeof req["url"] !== "string") {
    warnings.push(t().import.har.warnings.entrySkipped(index));
    return null;
  }
  // Captured into typed locals right away rather than re-indexing `req` (typed
  // `Record<string, unknown>`) throughout — narrowing an indexed-access
  // expression is not something to lean on across many following statements.
  const method: string = req["method"];
  const rawUrl: string = req["url"];

  const requestHeaders = buildHeaderSet(req["headers"]);
  const split = splitUrl(rawUrl);
  if (split === null) {
    warnings.push(t().import.har.warnings.entryUrlUnparseable(index, rawUrl));
  } else if (split.queryUndecodable) {
    warnings.push(t().import.har.warnings.entryQueryUndecodable(index));
  }

  const request: NonNullable<Exchange["request"]> = { method, url: split?.base ?? rawUrl };
  if (split?.query !== undefined) request.query = split.query;
  if (requestHeaders.entries.length > 0) request.headers = requestHeaders;
  const requestCookies = buildRequestCookies(req["cookies"], requestHeaders);
  if (requestCookies !== undefined) request.cookies = requestCookies;
  const requestBody = buildRequestBody(req["postData"]);
  if (requestBody !== undefined) request.body = requestBody;

  const exchange: Partial<Exchange> = { request, origin: { kind: HAR_ID } };

  const res = entry["response"];
  if (isPlainObject(res) && typeof res["status"] === "number") {
    const status: number = res["status"];
    const responseHeaders = buildHeaderSet(res["headers"]);
    const response: NonNullable<Exchange["response"]> = { status };
    if (typeof res["statusText"] === "string" && res["statusText"].length > 0) {
      response.statusText = res["statusText"];
    }
    if (responseHeaders.entries.length > 0) response.headers = responseHeaders;
    const responseCookies = buildResponseCookies(res["cookies"], responseHeaders);
    if (responseCookies !== undefined) response.cookies = responseCookies;
    const responseBody = buildResponseBody(res["content"], () => warnings.push(t().import.har.warnings.binaryBody(index)));
    if (responseBody !== undefined) response.body = responseBody;
    const time = entry["time"];
    if (typeof time === "number" && Number.isFinite(time)) response.elapsedMs = time;
    exchange.response = response;
  }

  return exchange;
}

export function parseHar(text: string): ImportResult {
  const parsed = tryParseJson(text);
  const entries = harEntries(parsed);
  if (entries === null) {
    throw new ImportError(t().import.har.errors.notHar.headline, t().import.har.errors.notHar.hint);
  }

  const warnings: string[] = [];
  const exchanges: Partial<Exchange>[] = [];
  let secretCount = 0;

  entries.forEach((entry, index) => {
    if (!isPlainObject(entry)) {
      warnings.push(t().import.har.warnings.entrySkipped(index));
      return;
    }
    const built = buildExchangeFromEntry(entry, index, warnings);
    if (built === null) return;
    exchanges.push(built);
    const headerSets = [built.request?.headers, built.response?.headers].filter(
      (h): h is HeaderSet => h !== undefined,
    );
    for (const set of headerSets) {
      secretCount += set.entries.filter((h) => shouldMaskHeader(h.name, h.value)).length;
    }
  });

  if (entries.length === 0) warnings.push(t().import.har.warnings.empty);
  if (secretCount > 0) warnings.push(t().import.common.secretsMasked(secretCount));

  return { exchanges, warnings };
}

export const harImporter: Importer = { id: HAR_ID, detect: detectHar, parse: parseHar };
