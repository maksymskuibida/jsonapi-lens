/**
 * The raw HTTP response importer — `docs/task-specs/T3.md` importer #3:
 * `HTTP/1.1 200 OK`, headers, a blank line, a body. The fastest path to a
 * *complete* exchange is this importer paired with #2 — status, headers and
 * document in one paste — since `mergeExchange` folds a request-only and a
 * response-only import together regardless of which arrives first.
 */

import type { BodyPart, Exchange } from "../exchange.js";
import { t } from "../i18n/index.js";
import { shouldMaskHeader } from "../secrets.js";
import { safeDecodeParams } from "./shared.js";
import { contentTypeOf, dechunk, isChunked, parseHttpMessage } from "./raw-http.js";
import type { Detection, ImportResult, Importer } from "./types.js";
import { ImportError } from "./types.js";

export const RAW_HTTP_RESPONSE_ID = "raw-http-response";

function firstLine(text: string): string {
  return text.split(/\r\n|\n/)[0] ?? "";
}

const STATUS_LINE = /^HTTP\/(\d(?:\.\d)?)[ \t]+(\d{3})(?:[ \t]+(.*))?$/;

export function detectRawHttpResponse(text: string): Detection | null {
  const match = STATUS_LINE.exec(firstLine(text).trimEnd());
  if (!match) return null;
  return { id: RAW_HTTP_RESPONSE_ID, confidence: 0.9, summary: t().import.rawHttpResponse.summary(Number(match[2])) };
}

export function parseRawHttpResponse(text: string): ImportResult {
  const match = STATUS_LINE.exec(firstLine(text).trimEnd());
  if (!match) {
    throw new ImportError(
      t().import.rawHttpResponse.errors.noStatusLine.headline,
      t().import.rawHttpResponse.errors.noStatusLine.hint,
    );
  }
  const [, , statusCode, reasonPhrase] = match;

  const parsed = parseHttpMessage(text);
  const warnings: string[] = [];
  if (parsed.noBlankLine) warnings.push(t().import.rawHttp.warnings.noBlankLine);

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

  const response: NonNullable<Exchange["response"]> = { status: Number(statusCode) };
  if (reasonPhrase !== undefined && reasonPhrase.length > 0) response.statusText = reasonPhrase;
  if (parsed.headers.entries.length > 0) response.headers = parsed.headers;
  if (body !== undefined) response.body = body;

  const secretCount = parsed.headers.entries.filter((h) => shouldMaskHeader(h.name, h.value)).length;
  if (secretCount > 0) warnings.push(t().import.common.secretsMasked(secretCount));

  const exchange: Partial<Exchange> = { response, origin: { kind: RAW_HTTP_RESPONSE_ID } };
  return { exchanges: [exchange], warnings };
}

export const rawHttpResponseImporter: Importer = {
  id: RAW_HTTP_RESPONSE_ID,
  detect: detectRawHttpResponse,
  parse: parseRawHttpResponse,
};
