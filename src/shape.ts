/**
 * What kind of JSON a pasted document is, decided without throwing.
 *
 * `assertJsonApi` in `parse.ts` is a hard gate: one of `data`/`errors`/`meta`
 * or refusal. That refusal used to be the end of the story for anything else
 * a person pastes — a bare array, `{"data": 1}`, a HAL response, a stream of
 * JSON Lines — all of it was simply wrong. `detectShape` is the branch point
 * instead: it names what the text actually looks like, with the evidence that
 * decided it, and never throws. `parse.ts#readAny` is what turns that into a
 * `Lens` — this module only classifies.
 *
 * Pure and dependency-free, like `ident.ts`/`pointer.ts`/`format.ts`: no `t()`,
 * no DOM. `ShapeEvidence` is data, not a sentence, so a locale is never baked
 * into a classification decided once per document. The rendering layer turns
 * one of these into words via `t().shape.evidence`.
 *
 * ## Why this takes text, not a parsed value
 *
 * Every shape but `ndjson` is a structural fact about one parsed JSON value,
 * and could be decided from that value alone. `ndjson` cannot: a stream of
 * JSON Lines is not valid JSON as a whole document (`JSON.parse` sees more
 * than one top-level value and throws), so the only way to recognise it is to
 * still be holding the original text once the ordinary parse has failed. So
 * this function owns both the parse attempt and the classification, and hands
 * back whichever value it managed to read — `readAny` builds the index from
 * that value rather than parsing the text a second time.
 *
 * ## Order of the structural checks
 *
 * `jsonapi` is checked first and requires more than key presence: `data`
 * present with a shape that is not `null` and not resource-or-array-of-
 * resource-identifiers (`{"data": 1}`, the motivating example) is **not**
 * `jsonapi` — it is `envelope`, because today `assertJsonApi` lets it through
 * and renders nothing useful. `data` and `errors` together is the same
 * `envelope` outcome for the same reason: syntactically data-shaped, invalid
 * per spec, worth naming rather than silently downgrading to `plain`.
 * `hal`/`odata`/`jsonrpc` are checked next because their marker keys
 * (`_links`/`_embedded`, `@odata.context`, `jsonrpc`) do not collide with any
 * JSON:API reserved member, so order between them and `jsonapi` only matters
 * for documents malformed enough to carry both — an edge case not worth
 * optimising for. `collection` (a bare array) and `plain` (everything else,
 * including a bare scalar or `null`) are the fallbacks.
 */

import type { JsonValue, Shape, ShapeDetection, ShapeEvidence } from "./types.js";

function isPlainObject(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A `{type, id}`-shaped resource identifier — deliberately the same test `parse.ts#readIdentifier` uses. */
function looksLikeResourceIdentifier(value: JsonValue): boolean {
  return (
    isPlainObject(value) &&
    typeof (value as { type?: unknown }).type === "string" &&
    typeof (value as { id?: unknown }).id === "string"
  );
}

/**
 * Whether a `data` member is shaped the way real JSON:API data is: absent,
 * `null`, one resource identifier, or an array of them (empty included). This
 * is what `{"data": 1}` fails — `1` is none of those — which is what makes it
 * `envelope` rather than `jsonapi` even though `assertJsonApi` accepts it.
 */
function looksLikeJsonApiData(data: JsonValue | undefined): boolean {
  if (data === undefined || data === null) return true;
  if (Array.isArray(data)) return data.every(looksLikeResourceIdentifier);
  return looksLikeResourceIdentifier(data);
}

function detectStructural(value: JsonValue): { shape: Shape; evidence: ShapeEvidence } {
  if (Array.isArray(value)) {
    return { shape: "collection", evidence: { kind: "collection-array", length: value.length } };
  }

  if (!isPlainObject(value)) {
    return { shape: "plain", evidence: { kind: "plain-scalar" } };
  }

  const hasData = "data" in value;
  const hasErrors = "errors" in value;
  const hasMeta = "meta" in value;
  const dataOk = looksLikeJsonApiData(value["data"]);

  if ((hasData || hasErrors || hasMeta) && !(hasData && hasErrors) && dataOk) {
    const member = hasData ? "data" : hasErrors ? "errors" : "meta";
    return { shape: "jsonapi", evidence: { kind: "jsonapi-member", member } };
  }

  if (isPlainObject(value["_links"])) return { shape: "hal", evidence: { kind: "hal-links" } };
  if (isPlainObject(value["_embedded"])) return { shape: "hal", evidence: { kind: "hal-embedded" } };

  if (typeof value["@odata.context"] === "string") {
    return { shape: "odata", evidence: { kind: "odata-context" } };
  }

  if (typeof value["jsonrpc"] === "string") {
    return { shape: "jsonrpc", evidence: { kind: "jsonrpc-member" } };
  }

  if (hasData) {
    // Reaches here only because the jsonapi check above rejected it: either
    // `data` is not resource-shaped (`{"data": 1}`), or it is but `errors` is
    // also present, which the spec forbids regardless of `data`'s shape.
    return {
      shape: "envelope",
      evidence: dataOk ? { kind: "envelope-conflict" } : { kind: "envelope-shape" },
    };
  }

  if (Object.keys(value).length === 0) {
    return { shape: "plain", evidence: { kind: "plain-empty-object" } };
  }

  return { shape: "plain", evidence: { kind: "plain-object" } };
}

/**
 * Split into lines and parse each one as JSON, tolerating blank lines
 * (including a trailing one) and reporting the first line that does not
 * parse rather than giving up at it — "one malformed line reports its line
 * number and reads the rest."
 */
function parseNdjsonLines(text: string): { records: JsonValue[]; malformedLine: number | null } {
  const lines = text.split(/\r\n|\r|\n/);
  const records: JsonValue[] = [];
  let malformedLine: number | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === "") continue;
    try {
      records.push(JSON.parse(line) as JsonValue);
    } catch {
      if (malformedLine === null) malformedLine = i + 1;
    }
  }

  return { records, malformedLine };
}

/**
 * Classify `text` without throwing. See the header for why text rather than a
 * parsed value, and for the order the structural checks run in.
 */
export function detectShape(text: string): ShapeDetection {
  const trimmed = text.trim();

  let value: JsonValue | undefined;
  try {
    value = trimmed === "" ? undefined : (JSON.parse(trimmed) as JsonValue);
  } catch {
    value = undefined;
  }

  if (value !== undefined) {
    const { shape, evidence } = detectStructural(value);
    return { shape, evidence, value };
  }

  const ndjson = parseNdjsonLines(trimmed);
  if (ndjson.records.length > 0) {
    return {
      shape: "ndjson",
      evidence: { kind: "ndjson-lines", records: ndjson.records.length, malformedLine: ndjson.malformedLine },
      value: ndjson.records,
    };
  }

  return { shape: "plain", evidence: { kind: "plain-unparseable" }, value: undefined };
}
