/**
 * Turning identifying data into a DOM id / URL fragment — for every scope that
 * mints one, not only a response resource.
 *
 * JSON:API says nothing about what may appear in `type` and `id`. Real payloads
 * carry slashes, spaces, colons, dots, `#`, and non-ASCII text. None of those
 * survive being dropped into `href="#..."` untouched: `#` truncates the
 * fragment, spaces get percent-encoded inconsistently by different code paths,
 * and `.`/`:`/`/` need escaping before they can appear in a CSS selector.
 *
 * So there is exactly one encoding scheme, defined here, and everything —
 * section ids, hrefs, lookups — goes through it.
 *
 * Scheme: keep `[A-Za-z0-9]`, and replace every other UTF-16 code unit with
 * `_` + 4 lowercase hex digits. `_` itself is escaped (to `_005f`), which is
 * what makes the encoding injective and reversible.
 *
 * Properties that matter:
 *   - Output alphabet is `[A-Za-z0-9_]`, so the result needs no percent-encoding
 *     in a URL fragment and no escaping in a CSS selector.
 *   - Always 4 hex digits per code unit (`charCodeAt`, not `codePointAt`) so
 *     astral characters encode as two fixed-width surrogate escapes rather than
 *     one ambiguous 5-digit escape. Emoji round-trip.
 *   - `_` is only ever followed by a hex digit in encoded output, so the `__`
 *     joiner between segments can never occur inside a segment. That is what
 *     makes a multi-segment body unambiguously splittable.
 *
 * ## The scope table — see DECISIONS.md D1
 *
 * A second document on the page (a request body mirroring the response, a
 * plain-JSON node next to a JSON:API one) means more than one kind of thing
 * wants an anchor, and `r_trips__1` cannot mean two different resources. D1
 * settles this with a **namespace prefix**: every id this module mints is
 * `<scope><body>`, where `<scope>` is exactly two characters — one ASCII
 * letter and `_` — and every scope's letter is distinct from every other
 * scope's. `<body>` is one or more segments, each run through `encodeSegment`
 * and joined with `__`.
 *
 * This is what discharges the two obligations a collision-free scheme has:
 *
 *   1. **Across scopes.** Every prefix's first character is unique to that
 *      scope (enforced by `SCOPE_ORDER`/the distinct-first-character test in
 *      `test/ident.test.ts`), so ids from different scopes differ at index 0
 *      before the bodies are even compared.
 *   2. **Within a scope.** The body is injective in its segment tuple, for the
 *      reason above — so two bodies collide only if their segment tuples are
 *      equal, which is the ordinary "same resource" case.
 *
 * `resource` (`r_`) and `group` (`g_`) are exactly what earlier versions of
 * this module minted by hand — `domId`/`groupDomId` keep their old output byte
 * for byte — so every existing fragment and bookmark keeps working. Every
 * other scope is new. `groupDomId` used to live in `render-document.ts`,
 * concatenating `"g_" + encodeSegment(type)` outside this module; it moved
 * here so that **no id is minted by string concatenation anywhere else** —
 * see the "no id minted outside ident.ts" rule this file's tests enforce.
 */

const SEGMENT_JOINER = "__";
const PREFIX = "r_";

/**
 * Every scope that mints a DOM id, named for what it anchors rather than for
 * its prefix letter — see the table in DECISIONS.md D1 for the letter each
 * one gets and the segments it carries.
 *
 * `Record<AnchorScope, ScopeDef>` below is what makes this exhaustive: adding
 * a member here without a matching row in `SCOPES` fails `tsc`, not a test.
 */
export type AnchorScope =
  | "resource" // r_ — a response resource section
  | "group" // g_ — a response type group
  | "requestField" // q_ — a request field: a param, a header, a URL part
  | "requestResource" // b_ — a resource in the request body document
  | "node" // n_ — a node in a plain-JSON response
  | "requestNode" // d_ — a node in a plain-JSON request body
  | "finding"; // f_ — a diagnostic finding

interface ScopeDef {
  readonly prefix: string;
}

/**
 * The table D1 describes, and the only place a scope's prefix may be defined.
 * `Record<AnchorScope, ScopeDef>` forces every union member to appear as a
 * key — the exhaustiveness D1 asks for is a type error, not a runtime check.
 */
const SCOPES: Record<AnchorScope, ScopeDef> = {
  resource: { prefix: "r_" },
  group: { prefix: "g_" },
  requestField: { prefix: "q_" },
  requestResource: { prefix: "b_" },
  node: { prefix: "n_" },
  requestNode: { prefix: "d_" },
  finding: { prefix: "f_" },
};

/** Every scope's table entry, for tests that must see the whole thing at once. */
export function scopeTable(): ReadonlyMap<AnchorScope, string> {
  return new Map(Object.entries(SCOPES).map(([scope, def]) => [scope as AnchorScope, def.prefix]));
}

export function encodeSegment(segment: string): string {
  let out = "";
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i]!;
    if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || (ch >= "0" && ch <= "9")) {
      out += ch;
    } else {
      out += "_" + segment.charCodeAt(i).toString(16).padStart(4, "0");
    }
  }
  return out;
}

export function decodeSegment(encoded: string): string {
  let out = "";
  for (let i = 0; i < encoded.length; ) {
    if (encoded[i] === "_") {
      const hex = encoded.slice(i + 1, i + 5);
      if (!/^[0-9a-f]{4}$/.test(hex)) {
        throw new Error(`Malformed escape at offset ${i} in ${JSON.stringify(encoded)}`);
      }
      out += String.fromCharCode(parseInt(hex, 16));
      i += 5;
    } else {
      out += encoded[i];
      i += 1;
    }
  }
  return out;
}

/**
 * Mint an id in any scope, from one or more segments.
 *
 * This is what every scope-specific helper below is a thin wrapper over —
 * `domId`/`groupDomId`/`nodeDomId` all just fix the scope and the segment
 * count. A caller outside this module should reach for one of those, or for a
 * future scope's own wrapper, rather than this directly: the point of naming
 * scopes is that a call site says which kind of thing it is anchoring.
 */
export function mintAnchorId(scope: AnchorScope, segments: readonly string[]): string {
  return SCOPES[scope].prefix + segments.map(encodeSegment).join(SEGMENT_JOINER);
}

/**
 * Inverse of `mintAnchorId`, asked about one specific scope.
 *
 * Deliberately not "guess the scope from the string": D1 asks for a function
 * that "returns `null` for a well-formed id in a scope it was not asked
 * about, rather than mis-parsing it as its own" — which is a statement about
 * the caller supplying the scope it expects, so a `group` id handed to a
 * `resource` lookup is rejected on the prefix check below rather than
 * decoded as a `resource` with a strange body.
 */
export function parseAnchorId(scope: AnchorScope, value: string): string[] | null {
  const prefix = SCOPES[scope].prefix;
  if (!value.startsWith(prefix)) return null;
  const body = value.slice(prefix.length);
  try {
    return body.split(SEGMENT_JOINER).map(decodeSegment);
  } catch {
    return null;
  }
}

/** The `type:id` map key. Not URL-safe — for `Map` lookups only. */
export function resourceKey(type: string, id: string): string {
  return `${type}:${id}`;
}

/** The DOM id and URL fragment for a resource section. */
export function domId(type: string, id: string): string {
  return PREFIX + encodeSegment(type) + SEGMENT_JOINER + encodeSegment(id);
}

/** `href` value pointing at a resource section. */
export function resourceHref(type: string, id: string): string {
  return "#" + domId(type, id);
}

/**
 * The DOM id for a response type group. Moved here from `render-document.ts`,
 * which used to concatenate `"g_" + encodeSegment(type)` by hand — see this
 * module's header.
 */
export function groupDomId(type: string): string {
  return mintAnchorId("group", [type]);
}

/** `href` value pointing at a type group. */
export function groupHref(type: string): string {
  return "#" + groupDomId(type);
}

/**
 * The DOM id for a node in a plain-JSON document, addressed by its JSON
 * Pointer — a collection, or one of its members, or the object that defines
 * an inferred identity. One segment: the whole pointer string is run through
 * `encodeSegment` as a unit, so `/` inside it is escaped like any other
 * non-alphanumeric character rather than treated as a body separator.
 */
export function nodeDomId(pointer: string): string {
  return mintAnchorId("node", [pointer]);
}

/** `href` value pointing at a plain-JSON node. */
export function nodeHref(pointer: string): string {
  return "#" + nodeDomId(pointer);
}

/** Inverse of `domId`. Returns `null` for anything this module did not produce. */
export function parseDomId(value: string): { type: string; id: string } | null {
  if (!value.startsWith(PREFIX)) return null;
  const body = value.slice(PREFIX.length);
  const at = body.indexOf(SEGMENT_JOINER);
  if (at < 0) return null;
  try {
    return {
      type: decodeSegment(body.slice(0, at)),
      id: decodeSegment(body.slice(at + SEGMENT_JOINER.length)),
    };
  } catch {
    return null;
  }
}

/**
 * A CSS selector for a resource section.
 *
 * `domId` output is already a valid CSS identifier, so `CSS.escape` is a no-op
 * here by construction. It stays because the guarantee lives in one function
 * and a selector built by hand elsewhere should not have to re-derive it.
 * On the hot path, prefer `getElementById`, which needs no escaping at all.
 */
export function resourceSelector(type: string, id: string): string {
  return "#" + CSS.escape(domId(type, id));
}

/**
 * Read a resource identity out of `location.hash`.
 *
 * Browsers may hand back a percent-encoded hash even though our own fragments
 * never need encoding, so decode defensively before parsing.
 */
export function identityFromHash(hash: string): { type: string; id: string } | null {
  if (!hash || hash === "#") return null;
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  let candidate = raw;
  try {
    candidate = decodeURIComponent(raw);
  } catch {
    /* keep raw when the hash is not valid percent-encoding */
  }
  return parseDomId(candidate);
}

/**
 * Curated hue ring for per-type colour. A hash picks the index, so a given type
 * keeps the same colour everywhere in a document — but the palette is
 * hand-picked rather than computed, so it can never land on a garish hue.
 */
export const TYPE_HUES = 10;

export function typeHue(type: string): number {
  // FNV-1a. Deterministic across reloads, which is the whole point.
  let h = 0x811c9dc5;
  for (let i = 0; i < type.length; i++) {
    h ^= type.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % TYPE_HUES;
}

/**
 * Two- or three-character monogram for a type, used as the sigil on identity
 * chips. Prefers word initials (`payment_methods` -> `PM`) and falls back to
 * leading characters.
 */
export function typeSigil(type: string): string {
  const words = type.split(/[^A-Za-z0-9]+/u).filter(Boolean);
  if (words.length >= 2) {
    return (words[0]![0]! + words[1]![0]!).toUpperCase();
  }
  // No alphanumerics at all — slicing the raw type would just yield punctuation.
  const word = words[0];
  if (!word) return "?";
  return word.slice(0, 2).toUpperCase();
}
