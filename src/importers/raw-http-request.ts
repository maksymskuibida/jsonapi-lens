/**
 * The raw HTTP request importer — `docs/task-specs/T3.md` importer #2:
 * request line, headers, a blank line, a body.
 *
 * The one piece of derived data this importer computes rather than copies
 * verbatim is the URL's origin: a request line almost always carries only a
 * path (`GET /v2/widgets?active=true HTTP/1.1`), and the scheme+host live in
 * the `Host` header instead — "`Host` promotes to the URL's origin when the
 * request line is a path", per the spec. Absent a `Host` header entirely,
 * `request.url` stays a bare path rather than a guess at a host, which is
 * still useful data (the query decodes either way) and does not invent an
 * origin this text never stated.
 */

import type { BodyPart, Exchange } from "../exchange.js";
import { getHeader } from "../headers.js";
import { t } from "../i18n/index.js";
import { shouldMaskHeader } from "../secrets.js";
import { safeDecodeParams, splitPathAndQuery, splitUrl } from "./shared.js";
import { contentTypeOf, dechunk, isChunked, parseHttpMessage } from "./raw-http.js";
import type { Detection, ImportResult, Importer } from "./types.js";
import { ImportError } from "./types.js";

export const RAW_HTTP_REQUEST_ID = "raw-http-request";

function firstLine(text: string): string {
  return text.split(/\r\n|\n/)[0] ?? "";
}

const REQUEST_LINE = /^(\S+)[ \t]+(\S+)[ \t]+HTTP\/(\d(?:\.\d)?)\s*$/;

export function detectRawHttpRequest(text: string): Detection | null {
  const match = REQUEST_LINE.exec(firstLine(text));
  if (!match) return null;
  const [, method] = match;
  return { id: RAW_HTTP_REQUEST_ID, confidence: 0.9, summary: t().import.rawHttpRequest.summary(method!) };
}

export function parseRawHttpRequest(text: string): ImportResult {
  const match = REQUEST_LINE.exec(firstLine(text));
  if (!match) {
    throw new ImportError(t().import.rawHttpRequest.errors.noRequestLine.headline, t().import.rawHttpRequest.errors.noRequestLine.hint);
  }
  const [, method, target] = match;

  const parsed = parseHttpMessage(text);
  const warnings: string[] = [];
  if (parsed.noBlankLine) warnings.push(t().import.rawHttp.warnings.noBlankLine);

  let url: string | undefined;
  let query;
  const isAbsoluteForm = /^https?:\/\//i.test(target!);

  if (isAbsoluteForm) {
    const split = splitUrl(target!);
    if (split) {
      url = split.base;
      query = split.query;
      if (split.queryUndecodable) warnings.push(t().import.common.queryUndecodable);
    } else {
      url = target;
      warnings.push(t().import.common.urlUnparseable(target!));
    }
  } else {
    const host = getHeader(parsed.headers, "host");
    const { path, query: pathQuery, queryUndecodable } = splitPathAndQuery(target!);
    query = pathQuery;
    if (queryUndecodable) warnings.push(t().import.common.queryUndecodable);
    if (host !== undefined) {
      const scheme = /:80$/.test(host) ? "http" : "https";
      url = `${scheme}://${host}${path}`;
      if (scheme === "https") warnings.push(t().import.common.schemeAssumed);
    } else {
      url = path;
    }
  }

  let body: BodyPart | undefined;
  if (parsed.body !== undefined && parsed.body.length > 0) {
    let raw = parsed.body;
    if (isChunked(parsed.headers)) {
      const dechunked = dechunk(raw);
      raw = dechunked.text;
      if (!dechunked.clean) warnings.push(t().import.rawHttp.warnings.chunkedNotClean);
    }
    const contentType = contentTypeOf(parsed.headers);
    body = { raw, ...(contentType !== undefined ? { contentType } : {}) };
    if (contentType !== undefined && /application\/x-www-form-urlencoded/i.test(contentType)) {
      const decodedForm = safeDecodeParams(raw);
      if (decodedForm !== null) body.form = decodedForm;
      else warnings.push(t().import.common.queryUndecodable);
    }
  }

  const request: NonNullable<Exchange["request"]> = { method };
  if (url !== undefined) request.url = url;
  if (query !== undefined) request.query = query;
  if (parsed.headers.entries.length > 0) request.headers = parsed.headers;
  if (body !== undefined) request.body = body;

  const secretCount = parsed.headers.entries.filter((h) => shouldMaskHeader(h.name, h.value)).length;
  if (secretCount > 0) warnings.push(t().import.common.secretsMasked(secretCount));

  const exchange: Partial<Exchange> = { request, origin: { kind: RAW_HTTP_REQUEST_ID } };
  return { exchanges: [exchange], warnings };
}

export const rawHttpRequestImporter: Importer = {
  id: RAW_HTTP_REQUEST_ID,
  detect: detectRawHttpRequest,
  parse: parseRawHttpRequest,
};
