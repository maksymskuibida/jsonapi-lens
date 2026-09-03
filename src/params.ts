/**
 * The parameter decoder — one decoder for a URL query string and for an
 * `application/x-www-form-urlencoded` body, per `docs/task-specs/T2.md`.
 * Real APIs disagree, silently, about what `a=1,2` or `a[]=1&a[]=2` means,
 * and this module's one job is to never guess between them without saying
 * so. Two defects already shipped in this release from exactly that shape of
 * mistake — a heuristic that looked right and picked silently — so every
 * ambiguous read here keeps its alternative attached as data, for T2b to
 * render and let a person choose. See `docs/DECISIONS.md` D5 for the binding
 * version of this rule — what T3's importers and T4's diagnostics may and may
 * not assume about a decoded parameter.
 *
 * ## The model: two independent axes of ambiguity
 *
 * A wire pair has a **key** (`filter[status][in]`, `a.b`, `a[]`) and a
 * **value** (`booked,held`). Each can be read more than one way, and the two
 * axes are independent:
 *
 *   - **Key shape** says where a pair's value lands in the decoded tree —
 *     a bare name is a scalar (or, repeated, an array); `a[]`/`a[N]` builds
 *     an array; `a[b]`/`a.b` builds an object. Unlike the value axis, this is
 *     never ambiguous for one pair in isolation — the wire text itself says
 *     which syntax was used. It only becomes a **conflict** when two pairs
 *     for the *same* top-level name use key syntaxes that cannot both be
 *     true at once (`a=1` beside `a[]=2` — is `a` a scalar or a list?). A
 *     conflict is reported, with every incompatible reading attached, and
 *     `value`/`convention` are left unset — this is the one case in this
 *     module where "decode" correctly produces no single answer.
 *   - **Value shape** says how a single scalar wire value reads: `1,2,3` is
 *     a list under the JSON:API convention this tool is built for, and
 *     equally validly the literal three-character string `"1,2,3"` under
 *     Express's. This is genuinely ambiguous from the wire text alone, so
 *     the decoder picks the JSON:API-shaped reading as primary (it is what
 *     this tool is for) and keeps the plain-string reading as a named
 *     `alternative`, located by `path` within the parameter's own value so a
 *     leaf several levels deep (`filter[status][in]`'s comma list) can be
 *     flagged without disturbing the rest of the structure.
 *
 * `ParamEntry.conventions` lists every convention actually used while
 * decoding one parameter, outermost first — `filter[status][in]=booked,held`
 * uses **both** `"bracket-object"` (the key nesting) and `"comma"` (the leaf
 * value), and both are named, which is what the spec's own test for that row
 * asks for. `ParamEntry.convention` is simply `conventions[0]`, kept
 * alongside as a quick single-value summary for the common case where there
 * is only one.
 *
 * ## Round-tripping: convention for the outermost shape, shape for the rest
 *
 * `encodeParams` re-serialises a **decoded** `ParamEntry` back to wire text,
 * and the required guarantee is only that decoding the result again yields
 * the same value — not that the bytes match the original wire form. That
 * gap is what keeps the encoder simple: the entry's own recorded top-level
 * convention drives the outermost encoding (so a `"comma"` entry re-encodes
 * as a comma list, not as `a[]=`), but anything **nested** inside an array or
 * object is encoded by a fixed, convention-agnostic scheme — arrays as
 * `name[]=`, objects as `name[key]=` — because decoding either form back
 * always reconstructs the same array or object regardless of which bracket
 * style produced it originally. There is deliberately no attempt to make a
 * *plain string that happens to contain a comma* round-trip back to a plain
 * reading: the wire form for "the list `[1,2]`" and "the string `"1,2"`" is
 * identical by construction (that is the whole reason this convention is
 * ambiguous), so encoding the literal string `"1,2"` as `a=1,2` and decoding
 * it again correctly reads it as a list first, with the original string
 * recovered as its `alternative` — the round trip preserves the *value*,
 * available at one of its two readings, exactly as ambiguous wire data
 * always will.
 *
 * ## JSON:API views
 *
 * `include`, `fields[type]`, `sort`, `page[*]` and `filter[*]` are first
 * class per the spec, but only `include` and `sort` need code of their own
 * (`includeTree`, `sortFields`): `fields[type]` and `filter[*]` are exactly
 * what the generic bracket/comma machinery above already produces —
 * `fields[articles]=title,body` decodes to `{articles: ["title","body"]}`
 * with no special-casing at all, and `page[*]` is a plain bracket-object.
 * `include`'s dots are inside a **comma-list value** (`legs.station`), not in
 * the key, so folding them into a tree is a semantic step this module adds
 * on top of the generic decode rather than a special key convention.
 *
 * Pure data and pure functions — no DOM, no `t()`, no network. See
 * `docs/task-specs/T2.md` and `docs/PROCESS.md` §5.
 */

import type { JsonValue } from "./types.js";

export type ParamValue = JsonValue;

export type ParamConvention =
  | "plain"
  | "valueless"
  | "repeated-key"
  | "bracket-list"
  | "indexed"
  | "comma"
  | "space-delimited"
  | "pipe-delimited"
  | "bracket-object"
  | "dot-path"
  | "json-value"
  | "base64url-json"
  | "truncated";

/**
 * A recognisable, never-collides-with-real-data marker for a value this
 * module refused to decode further — see `MAX_PARAM_DEPTH`.
 */
export const TRUNCATED_VALUE = "[TRUNCATED]";

/**
 * Maximum bracket/dot nesting this module will build a tree for, on encode or
 * decode. Real JSON:API parameters never nest past two or three levels
 * (`filter[status][in]`); this exists purely as a hard, cheap floor under
 * `decodeParams`/`encodeParams`'s "never throws" promise — unbounded
 * recursion here is a `RangeError` a few thousand bracket segments in,
 * reachable from a single ~15 kB pasted key, and `encodeParams` can be handed
 * a `ParamSet` built by hand (T3, a test) rather than one this module
 * produced itself, so the encode side needs its own bound rather than relying
 * on decode having already capped what it could ever see.
 */
const MAX_PARAM_DEPTH = 32;

/**
 * `__proto__`, `constructor` and `prototype` are never used as an object key
 * anywhere in this module, on purpose — see the "tree building" section
 * header below for why a query string is exactly the kind of untrusted input
 * this has to be defended against unconditionally, not merely detected.
 */
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * A plain object with **no prototype at all** — `obj[key] = value` on one of
 * these is an ordinary own-property write for *any* string `key`, including
 * `__proto__`/`constructor`/`prototype`, because there is no inherited
 * accessor or non-writable built-in property for those names to collide
 * with. Every object this module builds from a dynamic, wire-controlled key
 * uses this instead of a `{}` literal.
 */
function safeObject<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

export interface ParamReading {
  convention: ParamConvention;
  value: ParamValue;
}

/**
 * A reading offered beside the chosen one, located within the parameter's own
 * value — `[]` for the value as a whole.
 */
export interface ParamAlternative extends ParamReading {
  path: (string | number)[];
}

export interface RawParamPair {
  /** Exactly as it appeared before `=`, still wire-encoded (brackets and all). */
  key: string;
  /**
   * `null` for a valueless pair (`a`); the wire-encoded text after `=`
   * otherwise — `""` for `a=`. This is what keeps the two distinguishable.
   */
  value: string | null;
}

export interface ParamEntry {
  /** The decoded top-level name — `a`, `filter`, `fields` — never percent-encoded, never bracketed. */
  name: string;
  /** Every wire pair that contributed to this entry, in encounter order, untouched. */
  raw: RawParamPair[];
  /** The decoded reading, when the wire data resolved to one. Unset exactly when `conflict` is set. */
  value?: ParamValue;
  /** `conventions[0]` — the outermost convention behind `value`. Unset exactly when `conflict` is set. */
  convention?: ParamConvention;
  /** Every convention used anywhere while decoding this entry, outermost first, de-duplicated. */
  conventions: ParamConvention[];
  /** Other readings of an ambiguous value or sub-value, each naming its own convention and location. */
  alternatives: ParamAlternative[];
  /**
   * Set instead of `value`/`convention` when this name's wire pairs used two
   * or more incompatible key syntaxes — a bare key beside a bracketed one
   * (`a=1&a[]=2`), or an indexed/list form beside an object form
   * (`a[0]=1&a[b]=2`). Every reading the conflicting syntaxes imply, none of
   * them picked.
   */
  conflict?: ParamReading[];
  /**
   * `__proto__`/`constructor`/`prototype` segments encountered anywhere in
   * this entry's key path and excluded from `value` rather than used as an
   * object key — present only when at least one was. The wire pair itself is
   * never lost (it is still in `raw`); only its place in the decoded tree is
   * refused. See the "tree building" section header for why these three
   * names are rejected outright rather than merely handled safely.
   */
  unsafeSegments?: string[];
}

export interface ParamSet {
  entries: ParamEntry[];
}

export const EMPTY_PARAMS: ParamSet = { entries: [] };

export function findParam(params: ParamSet, name: string): ParamEntry | undefined {
  // Query parameter names are case-sensitive on the wire (unlike header
  // names) — this is a plain lookup, not the case-folding `headers.ts` does.
  return params.entries.find((entry) => entry.name === name);
}

/* ------------------------------------------------------------ key shape --- */

type KeySegment =
  | { kind: "index" } // a[]
  | { kind: "indexed"; index: number } // a[N]
  | { kind: "key"; key: string; syntax: "bracket" | "dot" }; // a[key] / a.key

interface ParsedKey {
  name: string;
  path: KeySegment[];
}

/** One wire pair, mid-decode: its key already split into name + path, its value still wire-encoded. */
interface ParsedPair {
  rawKey: string;
  rawValue: string | null;
  parsed: ParsedKey;
}

function safeDecodeComponent(raw: string): string {
  const plusDecoded = raw.replace(/\+/g, " ");
  try {
    return decodeURIComponent(plusDecoded);
  } catch {
    // Malformed percent-encoding — keep the best-effort text rather than
    // throwing. Every function in this module promises never to throw.
    return plusDecoded;
  }
}

/**
 * Split a wire key into its top-level name and the bracket/dot path after
 * it — `filter[status][in]` -> `{ name: "filter", path: [key status, key in] }`,
 * `a.b` -> `{ name: "a", path: [key b (dot)] }`, `a` -> `{ name: "a", path: [] }`.
 * Never throws: an unterminated `[` is kept as a literal trailing key segment
 * rather than rejected.
 */
function parseParamKey(rawKey: string): ParsedKey {
  const decoded = safeDecodeComponent(rawKey);
  let i = 0;
  let name = "";
  while (i < decoded.length && decoded[i] !== "[" && decoded[i] !== ".") {
    name += decoded[i];
    i++;
  }

  const path: KeySegment[] = [];
  while (i < decoded.length) {
    const ch = decoded[i];
    if (ch === "[") {
      const close = decoded.indexOf("]", i);
      if (close < 0) {
        path.push({ kind: "key", key: decoded.slice(i + 1), syntax: "bracket" });
        break;
      }
      const content = decoded.slice(i + 1, close);
      if (content === "") path.push({ kind: "index" });
      else if (/^\d+$/.test(content)) path.push({ kind: "indexed", index: Number(content) });
      else path.push({ kind: "key", key: content, syntax: "bracket" });
      i = close + 1;
    } else if (ch === ".") {
      i++;
      let seg = "";
      while (i < decoded.length && decoded[i] !== "." && decoded[i] !== "[") {
        seg += decoded[i];
        i++;
      }
      path.push({ kind: "key", key: seg, syntax: "dot" });
    } else {
      // Unreachable given the loop above always stops at `[`/`.`/name-start,
      // but keep the cursor moving rather than looping forever if it is.
      i++;
    }
  }

  return { name, path };
}

/* ---------------------------------------------------------- value shape --- */

interface LeafReading {
  convention: ParamConvention;
  value: ParamValue;
  alternatives: ParamReading[];
}

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Base64url codec, shared with `secrets.ts#decodeJwt` (a JWT's three segments
 * are base64url too). Not imported from `crypto.ts`, which has its own
 * `toBase64Url`/`fromBase64Url` — deliberately: `crypto.ts` is one of the
 * four modules allowed to touch the network and owns AES-GCM/PBKDF2, and this
 * module has no business depending on it just to reuse six lines. `atob`
 * and `btoa` are available in both the browser and the Worker runtime, so
 * this needs nothing beyond what `decodeParams`/`encodeParams` already run in.
 */
export function base64UrlToBytes(text: string): Uint8Array {
  const padded = text + "=".repeat((4 - (text.length % 4)) % 4);
  const standard = padded.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(standard);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Decode base64url text to a JSON *object or array* — never a bare scalar.
 * The object/array restriction, plus a minimum length, is deliberate defence
 * against false positives: a short numeric-looking token (`"12345678"`) is
 * valid base64url and might even decode to bytes that happen to be valid
 * UTF-8, but requiring the result to be a JSON container rather than a lone
 * number/string/boolean cuts the false-positive rate to something the
 * `alternative` reading can safely absorb rather than something that
 * misfires on ordinary ids and tokens.
 */
function tryBase64UrlJson(text: string): JsonValue | undefined {
  if (text.length < 8 || !BASE64URL_RE.test(text)) return undefined;
  try {
    const bytes = base64UrlToBytes(text);
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const parsed: unknown = JSON.parse(decoded);
    if (parsed !== null && typeof parsed === "object") return parsed as JsonValue;
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Decode one already-percent-decoded scalar wire value. Priority, each
 * chosen only when the one before it does not apply: an object/array JSON
 * literal, a comma list, a pipe list, a space list, a base64url-encoded JSON
 * object/array, and finally the value taken as plain text. The delimited
 * conventions and the JSON/base64url conventions never actually compete for
 * the same input — `,`, `|` and a space are all outside the base64url
 * alphabet and outside JSON's leading `{`/`[`, so the ordering below is for
 * readability and cost (cheapest checks first), not for resolving overlap
 * that does not exist.
 */
function decodeLeaf(text: string): LeafReading {
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed !== null && typeof parsed === "object") {
        return {
          convention: "json-value",
          value: parsed as JsonValue,
          alternatives: [{ convention: "plain", value: text }],
        };
      }
    } catch {
      /* not valid JSON after all — fall through */
    }
  }

  if (text.includes(",")) {
    return { convention: "comma", value: text.split(","), alternatives: [{ convention: "plain", value: text }] };
  }

  if (text.includes("|")) {
    return {
      convention: "pipe-delimited",
      value: text.split("|"),
      alternatives: [{ convention: "plain", value: text }],
    };
  }

  if (text.includes(" ")) {
    const parts = text.split(/ +/).filter((part) => part.length > 0);
    if (parts.length > 1) {
      return { convention: "space-delimited", value: parts, alternatives: [{ convention: "plain", value: text }] };
    }
  }

  const base64Json = tryBase64UrlJson(text);
  if (base64Json !== undefined) {
    return { convention: "base64url-json", value: base64Json, alternatives: [{ convention: "plain", value: text }] };
  }

  return { convention: "plain", value: text, alternatives: [] };
}

/* -------------------------------------------------------- tree building --- */

/**
 * Every object below is built from a **wire-controlled key** — one straight
 * out of a pasted URL or form body — and JavaScript has three property names
 * that turn an ordinary `obj[key] = value` write into something else
 * entirely: `__proto__` is an accessor that reassigns the object's own
 * prototype instead of creating a property, and `constructor`/`prototype`
 * chain into the real, non-writable `Object.prototype`/`Function.prototype`
 * and throw under strict mode (which every ES module runs under, including
 * this one). `include=__proto__.polluted` and `a[__proto__][x]=1` are both
 * reachable from a single pasted query string, and the first one pollutes
 * `Object.prototype` process-wide with no error and no visibly wrong output.
 *
 * The fix is structural, not a list of three strings to special-case: every
 * function below builds its tree on `safeObject()` — `Object.create(null)`,
 * which has no inherited accessor and no non-writable property for any key
 * to collide with, so `obj[key] = value` is an ordinary write for *any*
 * `key` at all. `UNSAFE_KEYS` is rejected outright on top of that, as an
 * independent second layer: a caller reading `entry.value` should not have
 * to know which internal representation produced it, and data that
 * originated here may still end up copied by some *other* module's naive
 * `for…in`/spread loop onto a normal-prototype object — refusing to let
 * these three names become a key at all is what keeps that downstream copy
 * safe too, not just this module's own reads.
 */

interface InternalPair {
  rawValue: string | null;
  remaining: KeySegment[];
}

interface BuiltNode {
  value: ParamValue;
  /** Outermost first, de-duplicated by the caller. */
  usedConventions: ParamConvention[];
  alternatives: ParamAlternative[];
  /**
   * `__proto__`/`constructor`/`prototype` segments rejected anywhere in this
   * subtree — see `ParamEntry.unsafeSegments`.
   */
  rejected: string[];
}

function isIndexLike(segment: KeySegment): boolean {
  return segment.kind === "index" || segment.kind === "indexed";
}

/**
 * `null` for a valueless pair; the full `decodeLeaf` reading otherwise —
 * computed once and reused by every caller.
 */
function decodeOnePair(rawValue: string | null): LeafReading | null {
  if (rawValue === null) return null;
  return decodeLeaf(safeDecodeComponent(rawValue));
}

/** One or more pairs whose path is now empty — a scalar, or (repeated) an array built purely from repetition. */
function buildLeafNode(pairs: InternalPair[]): BuiltNode {
  if (pairs.length === 0) return { value: null, usedConventions: [], alternatives: [], rejected: [] };

  if (pairs.length === 1) {
    const decoded = decodeOnePair(pairs[0]!.rawValue);
    if (decoded === null) return { value: null, usedConventions: ["valueless"], alternatives: [], rejected: [] };
    return {
      value: decoded.value,
      usedConventions: [decoded.convention],
      alternatives: decoded.alternatives.map((alt) => ({ path: [], ...alt })),
      rejected: [],
    };
  }

  const decoded = pairs.map((pair) => decodeOnePair(pair.rawValue));
  const alternatives: ParamAlternative[] = [];
  // Each repetition keeps its own reading's convention — a plain
  // `usedConventions: ["repeated-key"]` here would silently drop "comma" from
  // `a=1,2&a=3`, which is exactly the D5 violation this line exists to avoid.
  const usedConventions = new Set<ParamConvention>(["repeated-key"]);
  decoded.forEach((d, i) => {
    if (d) {
      usedConventions.add(d.convention);
      for (const alt of d.alternatives) alternatives.push({ path: [i], ...alt });
    }
  });
  return {
    value: decoded.map((d) => (d ? d.value : null)),
    usedConventions: [...usedConventions],
    alternatives,
    rejected: [],
  };
}

interface ArrayGroup {
  kind: "indexed" | "appended";
  index?: number;
  firstSeenAt: number;
  items: InternalPair[];
}

/** Build an array's `value` (and merged conventions/alternatives/rejected) from one fixed ordering of its groups. */
function buildArrayFromGroups(groups: ArrayGroup[], depth: number): BuiltNode {
  const usedConventions = new Set<ParamConvention>();
  const alternatives: ParamAlternative[] = [];
  const rejected: string[] = [];
  const value = groups.map((group, i) => {
    const child = buildNode(group.items, depth + 1);
    for (const c of child.usedConventions) usedConventions.add(c);
    for (const alt of child.alternatives) alternatives.push({ ...alt, path: [i, ...alt.path] });
    rejected.push(...child.rejected);
    return child.value;
  });
  return { value, usedConventions: [...usedConventions], alternatives, rejected };
}

/**
 * Pairs whose next path segment is `index` (`[]`) or `indexed` (`[N]`) —
 * builds an array. Two cases:
 *
 *   - **Pure `[N]`, or pure `[]`.** Unambiguous: `[N]` positions are
 *     explicit and sorted numerically regardless of wire order
 *     (`a[3]=x&a[1]=y` -> `[y, x]`, per the spec's table), and `[]` has no
 *     position to sort by other than the order it arrived in.
 *   - **`[]` and `[N]` mixed for the same array** (`a[]=1&a[0]=2`) is
 *     genuinely ambiguous — PHP and `qs` give the indices priority; this
 *     module gives wire order priority, as its most literal,
 *     least-surprising reading — but *either* choice made silently, with the
 *     other simply discarded, is the exact "guessed away" failure D5
 *     forbids. So wire order is `value`, and the indices-first ordering is
 *     attached as a `[]`-pathed `alternative` whenever it would actually
 *     read differently.
 */
function buildArray(pairs: InternalPair[], depth: number): BuiltNode {
  const byIndex = new Map<number, ArrayGroup>();
  const groups: ArrayGroup[] = []; // wire order: each group appended exactly once, at its first occurrence

  pairs.forEach((pair, position) => {
    const segment = pair.remaining[0]!;
    const rest: InternalPair = { rawValue: pair.rawValue, remaining: pair.remaining.slice(1) };
    if (segment.kind === "indexed") {
      let group = byIndex.get(segment.index);
      if (!group) {
        group = { kind: "indexed", index: segment.index, firstSeenAt: position, items: [] };
        byIndex.set(segment.index, group);
        groups.push(group);
      }
      group.items.push(rest);
    } else {
      // Each `[]` occurrence is its own array element — a bracket-list of
      // objects (`a[][x]=1&a[][y]=2` pairing up into one element) is a PHP-ism
      // outside the spec's table and is not attempted here.
      groups.push({ kind: "appended", firstSeenAt: position, items: [rest] });
    }
  });

  const hasIndexed = groups.some((g) => g.kind === "indexed");
  const hasAppended = groups.some((g) => g.kind === "appended");

  // Indices first (sorted numerically), appended after (in wire order) — the
  // only ordering for a *pure* form of either, and one of the two candidate
  // readings when mixed.
  const indexedThenAppended = [...groups].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "indexed" ? -1 : 1;
    return a.kind === "indexed" ? (a.index ?? 0) - (b.index ?? 0) : a.firstSeenAt - b.firstSeenAt;
  });

  // Only when genuinely mixed does wire order (`groups`, unsorted) differ
  // from — and take priority over — the indexed-first reading.
  const mixed = hasIndexed && hasAppended;
  const primary = buildArrayFromGroups(mixed ? groups : indexedThenAppended, depth);
  if (hasIndexed) primary.usedConventions = dedupe(["indexed", ...primary.usedConventions]);
  if (hasAppended) primary.usedConventions = dedupe(["bracket-list", ...primary.usedConventions]);

  if (mixed) {
    const alternate = buildArrayFromGroups(indexedThenAppended, depth);
    if (JSON.stringify(alternate.value) !== JSON.stringify(primary.value)) {
      primary.alternatives = [
        ...primary.alternatives,
        { path: [], convention: "indexed", value: alternate.value },
      ];
    }
  }

  return primary;
}

/**
 * Pairs whose next path segment is a named key (`[key]` or `.key`) — builds
 * an object. `stringifyIndexKeys` is only ever passed by `buildNode`, for the
 * one situation an object build has to tolerate an index-like segment
 * alongside key-like ones (see that function's comment).
 */
function buildObject(pairs: InternalPair[], depth: number, stringifyIndexKeys = false): BuiltNode {
  const slots = new Map<string, InternalPair[]>();
  const order: string[] = [];
  const usedConventions = new Set<ParamConvention>();
  const rejected: string[] = [];

  for (const pair of pairs) {
    const segment = pair.remaining[0]!;
    let key: string;
    if (segment.kind === "key") {
      key = segment.key;
      usedConventions.add(segment.syntax === "dot" ? "dot-path" : "bracket-object");
    } else if (stringifyIndexKeys) {
      key = segment.kind === "indexed" ? String(segment.index) : "";
      usedConventions.add("bracket-object");
    } else {
      // Only reachable if a caller passes a non-key-like pair without
      // `stringifyIndexKeys` — defensive, not expected to run.
      key = "";
    }

    if (UNSAFE_KEYS.has(key)) {
      // Never becomes an own key of `value` below — see the "tree building"
      // section header. The wire pair is still in `raw` on the entry; only
      // its place in the decoded tree is refused.
      rejected.push(key);
      continue;
    }

    const rest: InternalPair = { rawValue: pair.rawValue, remaining: pair.remaining.slice(1) };
    const bucket = slots.get(key);
    if (bucket) bucket.push(rest);
    else {
      slots.set(key, [rest]);
      order.push(key);
    }
  }

  const alternatives: ParamAlternative[] = [];
  const value = safeObject<ParamValue>();
  for (const key of order) {
    const child = buildNode(slots.get(key)!, depth + 1);
    for (const c of child.usedConventions) usedConventions.add(c);
    for (const alt of child.alternatives) alternatives.push({ ...alt, path: [key, ...alt.path] });
    rejected.push(...child.rejected);
    value[key] = child.value;
  }

  return { value, usedConventions: [...usedConventions], alternatives, rejected };
}

/**
 * Recurse into one node of the tree — used for every array element and
 * object value once the top-level key syntax has already been settled by
 * `buildEntry`. A node can have pairs that terminate here (a leaf value) and
 * pairs that continue deeper (`a[b]=1` beside `a[b][c]=2`) — a real but
 * spec-untested ambiguity; rather than pick one or drop the other, the leaf
 * value is folded in under a synthetic `""` key so both survive, visibly.
 * The same fold handles an index-like segment turning up beside key-like
 * ones below the top level (`a[b][0]=1` beside `a[b][c]=2`) — the spec's
 * conflict handling for that shape only covers the top-level name (see
 * `buildEntry`); deeper than that, this module would rather keep both readings
 * inside one object than silently choose a shape for the whole parameter.
 */
function buildNode(pairs: InternalPair[], depth: number): BuiltNode {
  if (depth > MAX_PARAM_DEPTH) {
    // A ~15 kB key of nested brackets is pasteable text, and unbounded
    // recursion here is a `RangeError` a few thousand levels in — see
    // `MAX_PARAM_DEPTH`. Stop, rather than throw: the entry as a whole still
    // decodes to *something*, with `"truncated"` in its `conventions` saying
    // so, instead of taking down whichever caller did not wrap this in a
    // `try`/`catch` because this module promises it never needs one.
    return { value: TRUNCATED_VALUE, usedConventions: ["truncated"], alternatives: [], rejected: [] };
  }

  const leaves = pairs.filter((pair) => pair.remaining.length === 0);
  const deeper = pairs.filter((pair) => pair.remaining.length > 0);

  if (deeper.length === 0) return buildLeafNode(leaves);

  if (leaves.length > 0) {
    const foldedLeaves: InternalPair[] = leaves.map((pair) => ({
      rawValue: pair.rawValue,
      remaining: [{ kind: "key", key: "", syntax: "bracket" } as KeySegment],
    }));
    return buildObject([...deeper, ...foldedLeaves], depth, true);
  }

  const firsts = deeper.map((pair) => pair.remaining[0]!);
  if (firsts.every(isIndexLike)) return buildArray(deeper, depth);
  if (firsts.every((segment) => segment.kind === "key")) return buildObject(deeper, depth);
  return buildObject(deeper, depth, true);
}

function dedupe<T>(values: T[]): T[] {
  return [...new Set(values)];
}

/**
 * Decode every wire pair sharing one top-level name into a `ParamEntry`.
 * Pairs are split into three buckets by their first path segment — bare (no
 * path at all), index-like (`[]`/`[N]`), key-like (`[key]`/`.key`) — and more
 * than one non-empty bucket is exactly the "two incompatible key syntaxes for
 * the same name" conflict the spec's `a=1&a[]=2` example asks for. With
 * exactly one bucket, that bucket's own reading becomes the entry.
 */
function buildEntry(name: string, pairs: ParsedPair[]): ParamEntry {
  const raw: RawParamPair[] = pairs.map((pair) => ({ key: pair.rawKey, value: pair.rawValue }));

  const toInternal = (subset: ParsedPair[]): InternalPair[] =>
    subset.map((pair) => ({ rawValue: pair.rawValue, remaining: pair.parsed.path }));

  const barePairs = pairs.filter((pair) => pair.parsed.path.length === 0);
  const indexLikePairs = pairs.filter((pair) => pair.parsed.path.length > 0 && isIndexLike(pair.parsed.path[0]!));
  const keyLikePairs = pairs.filter((pair) => pair.parsed.path.length > 0 && pair.parsed.path[0]!.kind === "key");

  const buckets: { build: () => BuiltNode }[] = [];
  if (barePairs.length > 0) buckets.push({ build: () => buildLeafNode(toInternal(barePairs)) });
  if (indexLikePairs.length > 0) buckets.push({ build: () => buildArray(toInternal(indexLikePairs), 1) });
  if (keyLikePairs.length > 0) buckets.push({ build: () => buildObject(toInternal(keyLikePairs), 1) });

  if (buckets.length > 1) {
    const built = buckets.map((bucket) => bucket.build());
    const conflict: ParamReading[] = built.map((node) => ({
      convention: node.usedConventions[0] ?? "plain",
      value: node.value,
    }));
    const unsafeSegments = dedupe(built.flatMap((node) => node.rejected));
    return {
      name,
      raw,
      conventions: dedupe(built.flatMap((node) => node.usedConventions)),
      alternatives: [],
      conflict,
      ...(unsafeSegments.length > 0 ? { unsafeSegments } : {}),
    };
  }

  if (buckets.length === 0) {
    // No pairs at all — `decodeParams` never calls this with an empty group, kept total regardless.
    return { name, raw, value: null, convention: "valueless", conventions: ["valueless"], alternatives: [] };
  }

  const node = buckets[0]!.build();
  const conventions = dedupe(node.usedConventions);
  const unsafeSegments = dedupe(node.rejected);
  return {
    name,
    raw,
    value: node.value,
    convention: conventions[0] ?? "plain",
    conventions,
    alternatives: node.alternatives,
    ...(unsafeSegments.length > 0 ? { unsafeSegments } : {}),
  };
}

/**
 * Decode a query string or an `application/x-www-form-urlencoded` body — the
 * same grammar either way, so one function serves both per the spec. A
 * leading `?` is stripped for convenience when passed `location.search`
 * directly; splitting is on `&` only (the historical `;` separator is not
 * revived). Never throws.
 */
export function decodeParams(wire: string): ParamSet {
  const text = wire.startsWith("?") ? wire.slice(1) : wire;
  const order: string[] = [];
  const groups = new Map<string, ParsedPair[]>();

  if (text.length > 0) {
    for (const part of text.split("&")) {
      if (part === "") continue;
      const eq = part.indexOf("=");
      const rawKey = eq < 0 ? part : part.slice(0, eq);
      const rawValue = eq < 0 ? null : part.slice(eq + 1);
      const parsed = parseParamKey(rawKey);
      const entry = { rawKey, rawValue, parsed };
      const bucket = groups.get(parsed.name);
      if (bucket) bucket.push(entry);
      else {
        groups.set(parsed.name, [entry]);
        order.push(parsed.name);
      }
    }
  }

  return { entries: order.map((name) => buildEntry(name, groups.get(name)!)) };
}

/* ------------------------------------------------------------- encoding --- */

function stringifyLeaf(value: ParamValue): string {
  if (value === null) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/**
 * Encode one nested value inside an array or object using a fixed,
 * shape-driven scheme — see the module header for why this does not need to
 * know which bracket convention originally produced the value.
 *
 * An empty-string object key is encoded with a trailing **dot**
 * (`name.` — dot-path syntax for an empty segment) rather than `name[]`,
 * which this module's own `parseParamKey` would read back as an
 * array-append token, not an object key: three different decode paths can
 * legitimately produce an object with a `""` key (`a[=1`'s unterminated
 * bracket, `a..b=1`'s empty dot segment, and `buildNode`'s own synthetic fold
 * for a value that is both a leaf and nested deeper), so this has to hold
 * for all of them, not just the one in whatever example prompted it. `name.`
 * decoded through `parseParamKey` produces exactly one segment, `{key: "",
 * syntax: "dot"}` — an object, never an array — so the round trip holds
 * regardless of which of the three paths produced the original key.
 *
 * `depth` bounds recursion independently of whatever produced `value` — see
 * `MAX_PARAM_DEPTH`'s comment for why the encode side cannot assume its
 * input came from this module's own (already-capped) decoder.
 */
function encodeChild(name: string, value: ParamValue, depth = 0): string[] {
  if (depth > MAX_PARAM_DEPTH) return [`${encodeURIComponent(name)}=${encodeURIComponent(TRUNCATED_VALUE)}`];
  if (value === null) return [encodeURIComponent(name)];
  if (Array.isArray(value)) return value.flatMap((v) => encodeChild(`${name}[]`, v, depth + 1));
  if (typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) =>
      encodeChild(k === "" ? `${name}.` : `${name}[${k}]`, v, depth + 1),
    );
  }
  return [`${encodeURIComponent(name)}=${encodeURIComponent(stringifyLeaf(value))}`];
}

function asArray(value: ParamValue): ParamValue[] {
  return Array.isArray(value) ? value : [value];
}

function encodeEntry(name: string, value: ParamValue, convention: ParamConvention): string[] {
  const encodedName = encodeURIComponent(name);
  switch (convention) {
    case "valueless":
      return [encodedName];
    case "repeated-key":
      return asArray(value).map((v) => `${encodedName}=${encodeURIComponent(stringifyLeaf(v))}`);
    case "bracket-list":
      return asArray(value).flatMap((v) => encodeChild(`${name}[]`, v));
    case "indexed":
      return asArray(value).flatMap((v, i) => encodeChild(`${name}[${i}]`, v));
    case "comma":
      return [`${encodedName}=${asArray(value).map((v) => encodeURIComponent(stringifyLeaf(v))).join(",")}`];
    case "space-delimited":
      return [`${encodedName}=${encodeURIComponent(asArray(value).map(stringifyLeaf).join(" "))}`];
    case "pipe-delimited":
      return [`${encodedName}=${encodeURIComponent(asArray(value).map(stringifyLeaf).join("|"))}`];
    case "bracket-object":
    case "dot-path": {
      const obj = value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
      // See encodeChild's header for why an empty-string key uses `name.`, not `name[]`.
      return Object.entries(obj).flatMap(([k, v]) => encodeChild(k === "" ? `${name}.` : `${name}[${k}]`, v));
    }
    case "json-value":
      return [`${encodedName}=${encodeURIComponent(JSON.stringify(value))}`];
    case "base64url-json":
      return [`${encodedName}=${bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)))}`];
    case "plain":
    default:
      return [`${encodedName}=${encodeURIComponent(stringifyLeaf(value))}`];
  }
}

function encodeRawPair(pair: RawParamPair): string {
  // Verbatim passthrough — `pair.key`/`pair.value` are already wire text, so
  // re-encoding them here would risk double-encoding a value that was never
  // decoded in the first place.
  return pair.value === null ? pair.key : `${pair.key}=${pair.value}`;
}

/**
 * Re-serialise a `ParamSet` to a query string. For a resolved entry, decoding
 * the result again reproduces the same `value` (see the module header for
 * exactly what that guarantee does and does not cover). A conflicted entry —
 * no resolved `value` to encode — re-emits its original wire pairs unchanged,
 * which trivially round-trips because nothing about it was altered.
 */
export function encodeParams(set: ParamSet): string {
  const parts: string[] = [];
  for (const entry of set.entries) {
    if (entry.conflict) {
      for (const pair of entry.raw) parts.push(encodeRawPair(pair));
      continue;
    }
    parts.push(...encodeEntry(entry.name, entry.value ?? null, entry.convention ?? "plain"));
  }
  return parts.join("&");
}

/* --------------------------------------------------------- JSON:API views --- */

/** `include=legs.station,legs.operator` -> `{ legs: { station: {}, operator: {} } }`. */
export interface IncludeTree {
  [relationship: string]: IncludeTree;
}

function stringListValue(value: ParamValue | undefined): string[] {
  if (Array.isArray(value)) return value.map((v) => (typeof v === "string" ? v : JSON.stringify(v)));
  if (typeof value === "string") return value === "" ? [] : [value];
  return [];
}

/**
 * The `include` parameter's dot-paths, folded into a tree — `undefined` when
 * there is no `include` parameter at all, or when it could not be resolved
 * to a single reading (`entry.conflict`). Left unresolved rather than
 * treated as empty, the same "shown, not guessed away" rule the rest of this
 * module follows: an empty tree would otherwise be indistinguishable from
 * "no `include` was sent" for the one case where something was sent but this
 * module could not make sense of it.
 *
 * Builds on `safeObject()` and skips a `__proto__`/`constructor`/`prototype`
 * segment rather than descending into it — `include=__proto__.polluted` is a
 * value an attacker controls completely, split on `.` with no relation to
 * `parseParamKey`'s own key parsing, so it needs this module's prototype-
 * pollution defence independently rather than inheriting `buildObject`'s.
 * `hasOwnProperty` is checked explicitly on descent, rather than `??`,
 * so existence is decided from the object's own properties alone — see the
 * "tree building" section header for why that pattern is load-bearing here
 * specifically, on data one step further from this module's own key parser.
 */
export function includeTree(params: ParamSet): IncludeTree | undefined {
  const entry = findParam(params, "include");
  if (!entry || entry.conflict) return undefined;

  const tree: IncludeTree = safeObject();
  for (const path of stringListValue(entry.value)) {
    if (path === "") continue;
    let node = tree;
    for (const segment of path.split(".")) {
      if (segment === "" || UNSAFE_KEYS.has(segment)) break;
      if (!Object.prototype.hasOwnProperty.call(node, segment)) node[segment] = safeObject();
      node = node[segment] as IncludeTree;
    }
  }
  return tree;
}

export interface SortField {
  field: string;
  direction: "asc" | "desc";
}

/**
 * `sort=-created,name` -> `[{field:"created",direction:"desc"},{field:"name",direction:"asc"}]`.
 * `undefined` when there is no `sort` parameter, or it did not resolve to a
 * single reading — see `includeTree`'s comment for why a conflict is not
 * treated as empty.
 */
export function sortFields(params: ParamSet): SortField[] | undefined {
  const entry = findParam(params, "sort");
  if (!entry || entry.conflict) return undefined;

  const toField = (token: string): SortField =>
    token.startsWith("-")
      ? { field: token.slice(1), direction: "desc" }
      : { field: token, direction: "asc" };

  return stringListValue(entry.value)
    .filter((token) => token !== "")
    .map(toField);
}
