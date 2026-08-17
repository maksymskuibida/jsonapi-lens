/**
 * Turning `{type, id}` into a DOM id / URL fragment.
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
 *     joiner between the two segments can never occur inside a segment. That is
 *     what makes `type`/`id` unambiguously separable.
 *   - The `r_` prefix guarantees the id starts with an ASCII letter, so it is a
 *     valid CSS identifier and a valid HTML id regardless of the input.
 */

const SEGMENT_JOINER = "__";
const PREFIX = "r_";

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
