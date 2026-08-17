import { domId, resourceKey, typeHue, typeSigil } from "./ident.js";
import type {
  DocumentIndex,
  JsonApiError,
  JsonObject,
  JsonValue,
  RelationshipEntry,
  Resource,
  ResourceIdentifier,
  TypeGroup,
} from "./types.js";

/** A validation failure the paste view can show verbatim. */
export class DocumentError extends Error {
  /** Short headline. */
  readonly headline: string;
  /** What to do about it. */
  readonly hint: string;
  /** 1-based line number, when the failure has a location in the source text. */
  readonly line?: number;

  constructor(headline: string, hint: string, line?: number) {
    super(`${headline} ${hint}`);
    this.name = "DocumentError";
    this.headline = headline;
    this.hint = hint;
    this.line = line;
  }
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Recover a line number from the byte offset in a V8/JSC `JSON.parse` message. */
function lineFromSyntaxError(message: string, source: string): number | undefined {
  const match = /position (\d+)/i.exec(message);
  if (!match) return undefined;
  const position = Number(match[1]);
  if (!Number.isFinite(position)) return undefined;
  let line = 1;
  for (let i = 0; i < position && i < source.length; i++) {
    if (source.charCodeAt(i) === 10) line++;
  }
  return line;
}

/**
 * `JSON.parse` with an error message a human can act on.
 *
 * The common paste mistakes are worth naming precisely: a wrapped log line, a
 * Python `dict` repr, a doubly-encoded string.
 */
export function parseJson(text: string): JsonValue {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new DocumentError("Nothing to parse.", "Paste a JSON:API document into the box above.");
  }

  try {
    return JSON.parse(trimmed) as JsonValue;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const line = lineFromSyntaxError(message, trimmed);

    if (/^'/.test(trimmed) || /'\s*:\s*/.test(trimmed.slice(0, 400))) {
      throw new DocumentError(
        "That looks like a Python dict, not JSON.",
        "Single-quoted keys and `None`/`True` are not valid JSON. Re-dump it with `json.dumps(...)`.",
        line,
      );
    }
    if (/^\s*[A-Za-z]{3,}\s/.test(trimmed) && !trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      throw new DocumentError(
        "That does not start like JSON.",
        "A JSON:API document starts with `{`. If you copied a log line, trim the prefix before the first `{`.",
        line,
      );
    }
    throw new DocumentError(
      "That is not valid JSON.",
      `The parser stopped here: ${message.replace(/^JSON\.parse:\s*/, "")}`,
      line,
    );
  }
}

/**
 * Check the parsed value is a JSON:API document.
 *
 * Per the spec a document must contain at least one of `data`, `errors` or
 * `meta`. `data` may legitimately be `null`, so presence is tested with `in`
 * rather than truthiness.
 */
export function assertJsonApi(value: JsonValue): JsonObject {
  if (Array.isArray(value)) {
    throw new DocumentError(
      "This is a bare JSON array, not a JSON:API document.",
      "A JSON:API document is an object with a top-level `data` key. Wrap the array: `{ \"data\": [...] }`.",
    );
  }
  if (typeof value === "string") {
    throw new DocumentError(
      "This is a JSON string containing JSON.",
      "The payload has been encoded twice. Unwrap the outer string, then paste the inner document.",
    );
  }
  if (!isPlainObject(value)) {
    throw new DocumentError(
      `This is a JSON ${value === null ? "null" : typeof value}, not a JSON:API document.`,
      "Paste the whole response body — an object with a top-level `data`, `errors` or `meta` key.",
    );
  }

  const hasData = "data" in value;
  const hasErrors = "errors" in value;
  const hasMeta = "meta" in value;

  if (!hasData && !hasErrors && !hasMeta) {
    const keys = Object.keys(value);
    const preview = keys.slice(0, 6).map((k) => `\`${k}\``).join(", ");
    throw new DocumentError(
      "This is valid JSON, but not a JSON:API document.",
      keys.length
        ? `It has no \`data\`, \`errors\` or \`meta\` at the top level — only ${preview}${keys.length > 6 ? ", …" : ""}. If the document is nested inside one of those, paste that part.`
        : "The object is empty. A JSON:API document needs at least one of `data`, `errors` or `meta`.",
    );
  }

  if (hasData && hasErrors) {
    throw new DocumentError(
      "This document has both `data` and `errors`.",
      "The spec forbids that combination. Showing it anyway would misrepresent the response — check which one the server actually meant to send.",
    );
  }

  return value;
}

/** Pull `{type, id}` out of a resource-identifier-shaped value. */
function readIdentifier(value: JsonValue): ResourceIdentifier | null {
  if (!isPlainObject(value)) return null;
  const { type, id } = value;
  if (typeof type !== "string" || typeof id !== "string") return null;
  return { type, id };
}

function readRelationships(raw: JsonValue | undefined): RelationshipEntry[] {
  if (!isPlainObject(raw)) return [];
  const out: RelationshipEntry[] = [];

  for (const name of Object.keys(raw)) {
    const body = raw[name];
    if (!isPlainObject(body)) continue;

    const links = isPlainObject(body["links"]) ? body["links"] : undefined;
    const meta = isPlainObject(body["meta"]) ? body["meta"] : undefined;

    // `data` absent entirely is different from `data: null`. The first means the
    // server did not tell us; the second means "related to nothing". Both are
    // things the user may be diagnosing, so keep them distinct.
    if (!("data" in body)) {
      out.push({ name, kind: "no-linkage", targets: [], links, meta });
      continue;
    }

    const data = body["data"];
    if (data === null) {
      out.push({ name, kind: "empty", targets: [], links, meta });
      continue;
    }
    if (Array.isArray(data)) {
      const targets = data.map(readIdentifier).filter((x): x is ResourceIdentifier => x !== null);
      out.push({ name, kind: "to-many", targets, links, meta });
      continue;
    }
    const one = readIdentifier(data);
    out.push(
      one
        ? { name, kind: "to-one", targets: [one], links, meta }
        : { name, kind: "no-linkage", targets: [], links, meta },
    );
  }

  return out;
}

/** Order types so primary-data types lead, then by descending count, then name. */
function orderGroups(groups: Map<string, Resource[]>, primaryTypes: Set<string>): TypeGroup[] {
  return [...groups.entries()]
    .map(([type, resources]) => ({
      type,
      resources,
      hue: typeHue(type),
      sigil: typeSigil(type),
    }))
    .sort((a, b) => {
      const aPrimary = primaryTypes.has(a.type) ? 0 : 1;
      const bPrimary = primaryTypes.has(b.type) ? 0 : 1;
      if (aPrimary !== bPrimary) return aPrimary - bPrimary;
      if (a.resources.length !== b.resources.length) return b.resources.length - a.resources.length;
      return a.type.localeCompare(b.type);
    });
}

/**
 * Build the index over `data` + `included` in a single pass.
 *
 * Everything downstream resolves relationships through `byKey`, so following a
 * pointer is a map hit rather than a scan of `included`. On a 50k-resource
 * document the difference is the whole ballgame.
 */
export function buildIndex(doc: JsonObject): DocumentIndex {
  const byKey = new Map<string, Resource>();
  const groups = new Map<string, Resource[]>();
  const primary: ResourceIdentifier[] = [];
  const primaryTypes = new Set<string>();

  let duplicates = 0;
  let fromData = 0;
  let fromIncluded = 0;

  const ingest = (raw: JsonValue, origin: "data" | "included"): Resource | null => {
    if (!isPlainObject(raw)) return null;
    const identity = readIdentifier(raw);
    if (!identity) return null;

    const { type, id } = identity;
    const key = resourceKey(type, id);

    // Defensive dedupe. A document that repeats `type:id` violates the spec, but
    // rendering it twice would put a duplicate id in the DOM and silently break
    // every anchor to it — so first occurrence wins and the rest are folded in.
    const existing = byKey.get(key);
    if (existing) {
      duplicates++;
      existing.duplicated = true;
      // Primary data is the document's subject; let it win the origin label.
      if (origin === "data") existing.origin = "data";
      return existing;
    }

    const resource: Resource = {
      type,
      id,
      key,
      domId: domId(type, id),
      origin,
      attributes: isPlainObject(raw["attributes"]) ? raw["attributes"] : undefined,
      relationships: readRelationships(raw["relationships"]),
      links: isPlainObject(raw["links"]) ? raw["links"] : undefined,
      meta: isPlainObject(raw["meta"]) ? raw["meta"] : undefined,
      duplicated: false,
      danglingCount: 0,
    };

    byKey.set(key, resource);
    const bucket = groups.get(type);
    if (bucket) bucket.push(resource);
    else groups.set(type, [resource]);

    if (origin === "data") fromData++;
    else fromIncluded++;

    return resource;
  };

  // `data` is a single resource, an array, `null`, or absent.
  const data = "data" in doc ? doc["data"] : undefined;
  const primaryIsNull = "data" in doc && data === null;

  if (Array.isArray(data)) {
    for (const item of data) {
      const resource = ingest(item, "data");
      if (resource) {
        primary.push({ type: resource.type, id: resource.id });
        primaryTypes.add(resource.type);
      }
    }
  } else if (isPlainObject(data)) {
    const resource = ingest(data, "data");
    if (resource) {
      primary.push({ type: resource.type, id: resource.id });
      primaryTypes.add(resource.type);
    }
  }

  const included = doc["included"];
  if (Array.isArray(included)) {
    for (const item of included) ingest(item, "included");
  }

  // Count relationships and collect pointers that resolve to nothing. Doing it
  // here means the orientation panel is free at render time.
  let relationships = 0;
  let danglingPointers = 0;
  const danglingSeen = new Set<string>();
  const dangling: ResourceIdentifier[] = [];

  for (const resource of byKey.values()) {
    for (const rel of resource.relationships) {
      relationships++;
      for (const target of rel.targets) {
        const key = resourceKey(target.type, target.id);
        if (byKey.has(key)) continue;
        danglingPointers++;
        resource.danglingCount++;
        if (!danglingSeen.has(key)) {
          danglingSeen.add(key);
          dangling.push(target);
        }
      }
    }
  }

  const errorsRaw = doc["errors"];
  const errors: JsonApiError[] = Array.isArray(errorsRaw)
    ? errorsRaw.filter(isPlainObject).map((e) => e as JsonApiError)
    : [];

  return {
    byKey,
    groups: orderGroups(groups, primaryTypes),
    primary,
    primaryIsNull,
    errors,
    meta: isPlainObject(doc["meta"]) ? doc["meta"] : undefined,
    links: isPlainObject(doc["links"]) ? doc["links"] : undefined,
    jsonapi: isPlainObject(doc["jsonapi"]) ? doc["jsonapi"] : undefined,
    counts: {
      total: byKey.size,
      fromData,
      fromIncluded,
      duplicates,
      relationships,
      danglingPointers,
    },
    dangling,
  };
}

/** Text in, validated index out. Throws `DocumentError` with something readable. */
export function readDocument(text: string): DocumentIndex {
  return buildIndex(assertJsonApi(parseJson(text)));
}
