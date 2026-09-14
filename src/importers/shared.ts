/**
 * Small pure helpers shared by two or more importers. Nothing here is a
 * format's own grammar — that stays in each importer's own module — this is
 * only the plumbing that would otherwise be copy-pasted: locating a line
 * number, splitting a URL into the base/query shape every request-bearing
 * importer needs, building a `ParamSet` from a source format that already
 * decoded its own parameters, and the base64 codec `-u`/`--user` and HAR's
 * `content.encoding` both need.
 *
 * Pure and dependency-free of the DOM/network, like `params.ts`/`headers.ts`.
 */

import type { JsonValue } from "../types.js";
import type { ParamEntry, ParamSet, RawParamPair } from "../params.js";
import { decodeParams } from "../params.js";

/** `JSON.parse`, never throwing — `undefined` for anything that is not valid JSON. */
export function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 1-based line number for a 0-based character offset. Mirrors `parse.ts#lineFromSyntaxError`'s counting rule. */
export function lineFromOffset(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

/**
 * Standard (RFC 4648 §4) base64 — `+`/`/` and `=` padding — for
 * `-u`/`--user`'s Basic-auth header. Deliberately not `params.ts`'s
 * `bytesToBase64Url`: that alphabet is base64*url*, wrong for a `Basic`
 * header on the wire, and `atob`/`btoa` are Latin1-only, so the bytes are
 * built by hand via `TextEncoder` rather than passed through them directly.
 */
export function toBase64Standard(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** The decode half — standard base64, for HAR's `content.encoding: "base64"`. Throws on malformed input; callers wrap in `try`/`catch`, matching `params.ts#base64UrlToBytes`'s own convention. */
export function fromBase64Standard(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** UTF-8 bytes of `text` — the encode half of the pair `dechunk` and HAR's base64 bodies need. */
export function utf8Encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** The decode half: `null`, never a throw, for bytes that are not valid UTF-8. */
export function tryUtf8Decode(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** One `ParamEntry`, honestly encoding a value a source format had *already* decoded — see `buildParamSetFromObject`. */
function plainEntry(name: string, value: JsonValue): ParamEntry {
  const rawValue = typeof value === "string" ? value : JSON.stringify(value);
  const raw: RawParamPair[] = [{ key: name, value: rawValue }];
  return { name, raw, value, convention: "plain", conventions: ["plain"], alternatives: [] };
}

/**
 * Build a `ParamSet` from an object a source format has *already* resolved
 * to name/value pairs — a HAR `queryString` array turned into an object, or a
 * transport log's `request_params` when it arrived as JSON rather than a wire
 * string. Per `docs/DECISIONS.md` D5's rule for T3: a format that hands over
 * already-decoded data is encoded as `convention: "plain"` per value, with no
 * invented ambiguity — this module has no wire text to re-derive a comma-list
 * or bracket-object reading from, and guessing one would be exactly the
 * "heuristic that looked right and picked silently" D5 exists to rule out.
 *
 * `raw` has no real wire text to point back to either (the source already
 * decoded it before this tool ever saw it), so it carries a best-effort
 * stand-in — the value itself when it is already a string, else its JSON
 * serialisation — rather than being left empty, so a "view raw" affordance
 * still has *something* to show.
 */
export function buildParamSetFromObject(obj: Record<string, JsonValue>): ParamSet {
  return { entries: Object.keys(obj).map((name) => plainEntry(name, obj[name]!)) };
}

/**
 * `decodeParams`, guarded against a defect flagged in T2a's own review (PR
 * #6, four blockers): despite `params.ts`'s header and `docs/DECISIONS.md`
 * D5 both promising it never throws, a key with several thousand bracket
 * segments overflows its recursive tree-builder and raises a `RangeError`.
 * T2a is fixing the underlying recursion; until that lands (and as a matter
 * of not trusting an upstream "never throws" claim blindly even after it
 * does), every call in this directory goes through here instead of the
 * decoder directly.
 *
 * This is exactly what `docs/task-specs/T3.md`'s own required test asks
 * for — "every `detect` returns `null` rather than throwing" — applied at
 * the one seam where a decoder this module does not own could otherwise take
 * that guarantee down with it. `null` signals "could not be decoded safely",
 * distinct from `decodeParams`'s own `{ entries: [] }` for "decoded to
 * nothing" — a caller that conflated the two would silently show an empty
 * query where the honest answer is "unreadable".
 */
export function safeDecodeParams(wire: string): ParamSet | null {
  try {
    return decodeParams(wire);
  } catch {
    return null;
  }
}

export interface SplitUrlResult {
  /** Origin + pathname — no query string, no fragment. Exactly what stays in `RequestPart.url`; the query lives in `RequestPart.query` instead, per T2's "the table is the truth" rule. */
  base: string;
  /** `undefined` when the URL had no query string at all, or it could not be decoded — distinct from a present-but-empty one. */
  query: ParamSet | undefined;
  /** True when `raw` had no scheme and `https://` was assumed to parse it — see `docs/task-specs/T2.md`'s edge-case table. */
  assumedScheme: boolean;
  /** True when a query string was present but `safeDecodeParams` could not read it — the base URL is still returned rather than discarded over one field. */
  queryUndecodable: boolean;
}

const HAS_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;

/**
 * Split a full URL string (with or without a scheme) into a base and its
 * decoded query — the shape `cURL`, the bare-URL importer, and HAR all need.
 * A path-only target (`raw-http-request.ts`'s case when there is no `Host`
 * header to promote) is not this function's job — see
 * `splitPathAndQuery` below for that narrower case.
 *
 * `null` only when `raw` cannot be read as a URL at all, even after assuming
 * `https://` — kept as literal text by the caller, with a warning, rather
 * than failing the whole import over one field. A URL that parses but whose
 * *query* will not decode still returns its `base` — see `queryUndecodable`.
 */
export function splitUrl(raw: string): SplitUrlResult | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  const assumedScheme = !HAS_SCHEME.test(trimmed);
  const candidate = assumedScheme ? `https://${trimmed}` : trimmed;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  const base = url.origin + url.pathname;
  if (url.search.length === 0) return { base, query: undefined, assumedScheme, queryUndecodable: false };

  const decoded = safeDecodeParams(url.search);
  return { base, query: decoded ?? undefined, assumedScheme, queryUndecodable: decoded === null };
}

/**
 * Split `/path?query` (no scheme, no host) into its path and decoded query —
 * a raw HTTP request line's target when there is no `Host` header to promote
 * it to a full URL.
 */
export function splitPathAndQuery(target: string): { path: string; query: ParamSet | undefined; queryUndecodable: boolean } {
  const mark = target.indexOf("?");
  if (mark < 0) return { path: target, query: undefined, queryUndecodable: false };
  const search = target.slice(mark + 1);
  if (search.length === 0) return { path: target.slice(0, mark), query: undefined, queryUndecodable: false };
  const decoded = safeDecodeParams(search);
  return { path: target.slice(0, mark), query: decoded ?? undefined, queryUndecodable: decoded === null };
}

/** A byte length guard shared by every `detect`, so a pathological paste (the spec's 5 MB single line) is rejected before any regex or JSON.parse runs over it. */
export function isWithinDetectBudget(text: string, maxLength: number): boolean {
  return text.length <= maxLength;
}
