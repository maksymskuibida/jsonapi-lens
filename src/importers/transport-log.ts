/**
 * The JSON transport-log importer — `docs/task-specs/T3.md` importer #6, and
 * the one the maintainer supplied a real (synthesised) sample of. A record is
 * a serialised Python `logging.LogRecord` (`info`) with HTTP transport fields
 * written alongside it, plus a sibling `context` of ambient request metadata
 * with no fixed schema. `test/fixtures/transport-log-started.json` and
 * `-finished.json` are the worked example this module is built against.
 *
 * ## Correlation, not concatenation
 *
 * Two records describe one call when `context.correlation_id`, `info.url`
 * and `info.http_method` all agree — checked in that combination
 * deliberately, because one `correlation_id` legitimately fans out to
 * several providers in one trace (`bucketByCall`'s key is
 * `correlation_id + method + url`, never `correlation_id` alone). Records
 * with no recognisable `correlation_id` at all still get grouped correctly:
 * each becomes its own singleton group by array position, rather than being
 * merged with an unrelated record that also happens to lack one.
 *
 * Combining a group does **not** go through `exchange.ts#mergeExchange` —
 * that function replaces `origin` as one atomic whole (by design, the same
 * way it replaces `headers`/`cookies`/`body`), which is exactly wrong for
 * folding a *started* and a *finished* record's `origin` contributions
 * together: whichever record's `mergeExchange` saw last would silently
 * discard the other's fields. `combineGroup` below instead combines the two
 * records' fields itself, per field, before ever producing one
 * `Partial<Exchange>` — the associativity `mergeExchange` guarantees is what
 * the *caller* relies on when folding **that** result into an existing
 * draft, which is the write path this importer actually needs.
 *
 * ## `context` stays structured
 *
 * `origin.context` is the parsed `context` object itself, not a
 * `JSON.stringify`'d blob — deliberately, because a redactor that walks the
 * `Exchange` tree looking for an email- or IP-shaped string can only reach
 * values it can see as data. Collapsing `context` into one opaque string
 * would put an actor email and a client IP exactly where nothing could ever
 * find them again. (`secrets.ts#redactExchange` does not walk `origin` as of
 * this branch's merge base — see this task's PR body for what that means for
 * the redaction acceptance criterion.)
 */

import type { BodyPart, Exchange, OriginMeta } from "../exchange.js";
import type { HeaderSet } from "../headers.js";
import { addHeader, getHeader, headerSet } from "../headers.js";
import type { JsonObject, JsonValue } from "../types.js";
import { t } from "../i18n/index.js";
import { shouldMaskHeader } from "../secrets.js";
import { buildParamSetFromObject, isPlainObject, safeDecodeParams, tryParseJson } from "./shared.js";
import type { Detection, ImportResult, Importer } from "./types.js";
import { ImportError } from "./types.js";

export const TRANSPORT_LOG_ID = "transport-log";

/** `true` only for a plain object whose `info` member carries the format's own marker — see this module's header. */
function looksLikeTransportLogRecord(value: unknown): value is JsonObject {
  if (!isPlainObject(value)) return false;
  const info = value["info"];
  if (!isPlainObject(info)) return false;
  if (info["message_type"] === "transport_logging") return true;
  const eventType = info["event_type"];
  return (
    typeof eventType === "string" &&
    eventType.endsWith("_request") &&
    typeof info["url"] === "string" &&
    typeof info["http_method"] === "string"
  );
}

function infoOf(record: JsonObject): JsonObject {
  const info = record["info"];
  return isPlainObject(info) ? info : {};
}

function contextOf(record: JsonObject): JsonObject | undefined {
  const context = record["context"];
  return isPlainObject(context) ? context : undefined;
}

interface ExtractionResult {
  records: JsonObject[];
  /** Candidates that parsed as JSON but did not look like a transport-log record — an ordinary log line mixed into the same paste, say. */
  skippedNonRecord: number;
  /** Lines that did not even parse as JSON, when the whole text had to fall back to one-record-per-line. */
  malformedLines: number;
}

/**
 * One JSON value, an array of them, or one record per line (NDJSON) — shared
 * verbatim between `detect` and `parse` so the two can never disagree about
 * what this paste contains.
 */
function extractRecords(text: string): ExtractionResult {
  const whole = tryParseJson(text);
  if (whole !== undefined) {
    const candidates = Array.isArray(whole) ? whole : [whole];
    const records = candidates.filter(looksLikeTransportLogRecord);
    return { records, skippedNonRecord: candidates.length - records.length, malformedLines: 0 };
  }

  const records: JsonObject[] = [];
  let skippedNonRecord = 0;
  let malformedLines = 0;
  for (const line of text.split(/\r\n|\n/)) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const value = tryParseJson(trimmed);
    if (value === undefined) {
      malformedLines++;
    } else if (looksLikeTransportLogRecord(value)) {
      records.push(value);
    } else {
      skippedNonRecord++;
    }
  }
  return { records, skippedNonRecord, malformedLines };
}

/**
 * `(correlation_id, method, url)` per the spec — a shared `correlation_id`
 * with a different url/method is a different call in the same trace, not the
 * same group. The key is a `JSON.stringify`d tuple rather than a hand-joined
 * string: a real `correlation_id`, method or URL can contain any character a
 * hand-picked delimiter might collide with, and array structure removes the
 * question rather than betting on one that will not appear in practice.
 */
function groupKeyFor(info: JsonObject, context: JsonObject | undefined, index: number): string {
  const url = info["url"];
  const method = info["http_method"];
  if (typeof url === "string" && typeof method === "string") {
    const correlationId = context?.["correlation_id"];
    if (typeof correlationId === "string" && correlationId.length > 0) {
      return JSON.stringify(["id", correlationId, method, url]);
    }
    return JSON.stringify(["no-correlation", index]);
  }
  return JSON.stringify(["no-url-or-method", index]);
}

/** Insertion order is call order, which `Map` preserves — no separate ordering array needed. */
function bucketByCall(records: JsonObject[]): Map<string, JsonObject[]> {
  const groups = new Map<string, JsonObject[]>();
  records.forEach((record, index) => {
    const key = groupKeyFor(infoOf(record), contextOf(record), index);
    const bucket = groups.get(key);
    if (bucket) bucket.push(record);
    else groups.set(key, [record]);
  });
  return groups;
}

type RecordKind = "started" | "finished" | "unknown";

function endsWithCI(value: unknown, suffix: string): boolean {
  return typeof value === "string" && value.toLowerCase().endsWith(suffix);
}

/** Finished is checked first: `response_status_code`'s presence is a stronger, structural signal than a fuzzy `msg` match, and a record cannot honestly be both. */
function classifyRecord(info: JsonObject): RecordKind {
  const isFinished =
    info["funcName"] === "_log_response" ||
    endsWithCI(info["msg"], "request finished") ||
    endsWithCI(info["message"], "request finished") ||
    "response_status_code" in info;
  if (isFinished) return "finished";

  const isStarted =
    info["funcName"] === "log_start" ||
    endsWithCI(info["msg"], "request started") ||
    endsWithCI(info["message"], "request started") ||
    "request_headers" in info;
  if (isStarted) return "started";

  return "unknown";
}

interface FieldLookup {
  present: boolean;
  value: unknown;
}

/**
 * The last (in `infos`' own order) record whose `info` carries `key` as an
 * *own property* — checked with `in`, not by truthiness, so an explicit
 * `null` is "present with value null", never confused with "not sent at
 * all". Both meanings matter here: `request_params: null` must read as an
 * absent query, but only because the key was present and null — a record
 * that never mentions `request_params` at all is the same absence for a
 * different reason and is handled identically by the caller, which is
 * exactly why this function does not try to tell them apart.
 */
function lastInfoValue(infos: JsonObject[], key: string): FieldLookup {
  let present = false;
  let value: unknown;
  for (const info of infos) {
    if (key in info) {
      present = true;
      value = info[key];
    }
  }
  return { present, value };
}

/** `request_headers`/`response_headers` are plain `{name: value}` objects in this format, not HAR's array-of-pairs. */
function buildHeadersFromObject(value: unknown): HeaderSet {
  let headers = headerSet([]);
  if (!isPlainObject(value)) return headers;
  for (const name of Object.keys(value)) {
    const raw = value[name];
    headers = addHeader(headers, name, typeof raw === "string" ? raw : JSON.stringify(raw));
  }
  return headers;
}

/**
 * `info.request_params`: `null` (absent — a query the server explicitly did
 * not receive), an already-decoded object (encoded `convention: "plain"` per
 * `docs/DECISIONS.md` D5, since there is no wire text left to re-derive an
 * ambiguous reading from), or a wire query string (through the real
 * decoder). Never a value error — see `shared.ts#safeDecodeParams` for why a
 * string form is guarded rather than called directly.
 */
function decodeRequestParams(value: unknown, warnings: string[]) {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") {
    const decoded = safeDecodeParams(value);
    if (decoded === null) {
      warnings.push(t().import.common.queryUndecodable);
      return undefined;
    }
    return decoded;
  }
  if (isPlainObject(value)) return buildParamSetFromObject(value as Record<string, JsonValue>);
  warnings.push(t().import.transportLog.warnings.requestParamsUnexpectedShape);
  return undefined;
}

function contentTypeFrom(headers: HeaderSet | undefined): string | undefined {
  return headers ? getHeader(headers, "content-type") : undefined;
}

/** `info.request_data`: `null` (absent), a string (kept verbatim — this format's normal case for a non-JSON body), or an already-parsed object (re-serialised, since there is no original wire text to show instead). */
function buildRequestDataBody(value: unknown, headers: HeaderSet | undefined): BodyPart | undefined {
  if (value === null || value === undefined) return undefined;
  const contentType = contentTypeFrom(headers);
  const raw = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const body: BodyPart = { raw };
  if (contentType !== undefined) body.contentType = contentType;
  return body;
}

/**
 * `info.response_data`: `null` (absent), the ordinary case of an
 * already-parsed object (`response_data` is very often exactly the
 * JSON:API document this tool exists to read), or — the edge case the spec
 * names explicitly — a **string that is itself JSON**, i.e. a value that was
 * serialised twice before this tool ever saw it. That case is parsed one
 * level and the double encoding is named in `warnings`, rather than shown as
 * an opaque escaped string or silently "fixed" without comment.
 */
function buildResponseDataBody(value: unknown, headers: HeaderSet | undefined, warnings: string[]): BodyPart | undefined {
  if (value === null || value === undefined) return undefined;
  const contentType = contentTypeFrom(headers);

  if (typeof value === "string") {
    const inner = tryParseJson(value);
    if (isPlainObject(inner) || Array.isArray(inner)) {
      warnings.push(t().import.transportLog.warnings.doubleEncodedResponse);
      const body: BodyPart = { raw: JSON.stringify(inner, null, 2) };
      if (contentType !== undefined) body.contentType = contentType;
      return body;
    }
    const body: BodyPart = { raw: value };
    if (contentType !== undefined) body.contentType = contentType;
    return body;
  }

  const body: BodyPart = { raw: JSON.stringify(value, null, 2) };
  if (contentType !== undefined) body.contentType = contentType;
  return body;
}

/** The five named `info` fields, `created`/`asctime`, `exc_*`, and `context` — see this module's header for why `context` is kept as real structured data. */
function buildOrigin(infos: JsonObject[], contexts: (JsonObject | undefined)[]): OriginMeta {
  const origin: Record<string, unknown> = { kind: TRANSPORT_LOG_ID };

  const provider = lastInfoValue(infos, "provider");
  if (typeof provider.value === "string") origin.provider = provider.value;

  const providerMethod = lastInfoValue(infos, "provider_method");
  if (typeof providerMethod.value === "string") origin.providerMethod = providerMethod.value;

  const levelname = lastInfoValue(infos, "levelname");
  if (typeof levelname.value === "string") origin.levelname = levelname.value;

  const instanceName = lastInfoValue(infos, "instance_name");
  if (typeof instanceName.value === "string") origin.instanceName = instanceName.value;

  const applevel = lastInfoValue(infos, "applevel");
  if (typeof applevel.value === "string") origin.applevel = applevel.value;

  const created = lastInfoValue(infos, "created");
  if (typeof created.value === "string" || typeof created.value === "number") {
    origin.timestamp = created.value;
  } else {
    const asctime = lastInfoValue(infos, "asctime");
    if (typeof asctime.value === "string") origin.timestamp = asctime.value;
  }

  const excInfo = lastInfoValue(infos, "exc_info");
  if (excInfo.present && excInfo.value !== null) origin.excInfo = excInfo.value;

  const excText = lastInfoValue(infos, "exc_text");
  if (typeof excText.value === "string" && excText.value.length > 0) origin.excText = excText.value;

  const stackInfo = lastInfoValue(infos, "stack_info");
  if (stackInfo.present && stackInfo.value !== null) origin.stackInfo = stackInfo.value;

  const lastContext = contexts.filter((c): c is JsonObject => c !== undefined).pop();
  if (lastContext !== undefined) origin.context = lastContext;

  return origin;
}

/**
 * Fold one call's records into one `Partial<Exchange>` — see this module's
 * header for why this is bespoke rather than a ride on `mergeExchange`.
 * Order within `ordered` is precedence, not paste order: a *finished*
 * record's value wins over a *started* record's for a field both happen to
 * carry (they are expected to agree; when a source disagrees with itself,
 * the chronologically-last record is the more complete answer), and either
 * beats an unclassified record's guess.
 */
function combineGroup(
  members: { info: JsonObject; context: JsonObject | undefined; kind: RecordKind }[],
  warnings: string[],
): Partial<Exchange> {
  const byKind = (kind: RecordKind) => members.filter((m) => m.kind === kind);
  const ordered = [...byKind("unknown"), ...byKind("started"), ...byKind("finished")];
  const infos = ordered.map((m) => m.info);
  const contexts = ordered.map((m) => m.context);

  const request: NonNullable<Exchange["request"]> = {};
  const method = lastInfoValue(infos, "http_method");
  if (typeof method.value === "string") request.method = method.value;
  const url = lastInfoValue(infos, "url");
  if (typeof url.value === "string") request.url = url.value;

  const requestHeadersField = lastInfoValue(infos, "request_headers");
  const requestHeaders = requestHeadersField.present ? buildHeadersFromObject(requestHeadersField.value) : undefined;
  if (requestHeaders !== undefined && requestHeaders.entries.length > 0) request.headers = requestHeaders;

  const paramsField = lastInfoValue(infos, "request_params");
  if (paramsField.present) {
    const query = decodeRequestParams(paramsField.value, warnings);
    if (query !== undefined) request.query = query;
  }

  const dataField = lastInfoValue(infos, "request_data");
  if (dataField.present) {
    const body = buildRequestDataBody(dataField.value, requestHeaders);
    if (body !== undefined) request.body = body;
  }

  const response: NonNullable<Exchange["response"]> = {};
  const status = lastInfoValue(infos, "response_status_code");
  if (typeof status.value === "number") response.status = status.value;

  const responseHeadersField = lastInfoValue(infos, "response_headers");
  const responseHeaders = responseHeadersField.present ? buildHeadersFromObject(responseHeadersField.value) : undefined;
  if (responseHeaders !== undefined && responseHeaders.entries.length > 0) response.headers = responseHeaders;

  const responseDataField = lastInfoValue(infos, "response_data");
  if (responseDataField.present) {
    const body = buildResponseDataBody(responseDataField.value, responseHeaders, warnings);
    if (body !== undefined) response.body = body;
  }

  const elapsed = lastInfoValue(infos, "elapsed_time");
  if (typeof elapsed.value === "number" && Number.isFinite(elapsed.value)) {
    response.elapsedMs = elapsed.value * 1000;
  }

  const exchange: Partial<Exchange> = { origin: buildOrigin(infos, contexts) };
  if (Object.keys(request).length > 0) exchange.request = request;
  if (Object.keys(response).length > 0) exchange.response = response;
  return exchange;
}

export function detectTransportLog(text: string): Detection | null {
  const { records } = extractRecords(text);
  if (records.length === 0) return null;
  const groupCount = bucketByCall(records).size;
  return {
    id: TRANSPORT_LOG_ID,
    confidence: 0.9,
    summary: t().import.transportLog.summary(records.length, groupCount),
  };
}

export function parseTransportLog(text: string): ImportResult {
  const extraction = extractRecords(text);
  if (extraction.records.length === 0) {
    throw new ImportError(
      t().import.transportLog.errors.notATransportLog.headline,
      t().import.transportLog.errors.notATransportLog.hint,
    );
  }

  const warnings: string[] = [];
  if (extraction.skippedNonRecord > 0) warnings.push(t().import.transportLog.warnings.recordsSkipped(extraction.skippedNonRecord));
  if (extraction.malformedLines > 0) warnings.push(t().import.transportLog.warnings.malformedLines(extraction.malformedLines));

  const groups = bucketByCall(extraction.records);
  const exchanges: Partial<Exchange>[] = [];
  let secretCount = 0;
  let ambiguousCount = 0;

  for (const records of groups.values()) {
    const classified = records.map((record) => ({
      info: infoOf(record),
      context: contextOf(record),
      kind: classifyRecord(infoOf(record)),
    }));
    ambiguousCount += classified.filter((m) => m.kind === "unknown").length;

    const exchange = combineGroup(classified, warnings);
    exchanges.push(exchange);

    for (const headers of [exchange.request?.headers, exchange.response?.headers]) {
      if (headers) secretCount += headers.entries.filter((h) => shouldMaskHeader(h.name, h.value)).length;
    }
  }

  if (ambiguousCount > 0) warnings.push(t().import.transportLog.warnings.ambiguousKind(ambiguousCount));
  if (secretCount > 0) warnings.push(t().import.common.secretsMasked(secretCount));

  return { exchanges, warnings };
}

export const transportLogImporter: Importer = {
  id: TRANSPORT_LOG_ID,
  detect: detectTransportLog,
  parse: parseTransportLog,
};
