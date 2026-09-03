/**
 * HTTP header storage for a captured request or response — T2's model, used
 * by both `RequestPart.headers` and `ResponsePart.headers` in `exchange.ts`.
 *
 * Two properties the rest of the request feature depends on, both from
 * `docs/task-specs/T2.md`:
 *
 *   - **Lookup is case-insensitive.** `Content-Type`, `content-type` and
 *     `CONTENT-TYPE` name the same header on the wire, and a payload pasted
 *     from a real tool will not agree with itself on casing.
 *   - **Duplicates are preserved, in order, rather than merged.** A repeated
 *     `Set-Cookie` is normal HTTP — one header line per cookie, and RFC 6265
 *     forbids combining them with a comma because `Expires` values contain
 *     commas themselves. A repeated `Content-Length` is instead a finding
 *     (T4's job to say so), but this module cannot tell the two apart and
 *     must not try: it keeps every entry, in the order it arrived, and lets
 *     the reader decide what repetition means for a given name.
 *
 * Deliberately just an ordered list rather than a `Map`: a `Map` keyed by
 * lower-cased name would silently lose exactly the duplicates this module
 * exists to keep.
 *
 * Pure data and pure functions — no DOM, no `t()`, no network. See
 * `docs/task-specs/T2.md` and `docs/PROCESS.md` §5.
 */

export interface HeaderEntry {
  /** Exactly as typed or received — never normalised, so what you pasted is what you see. */
  name: string;
  value: string;
}

export interface HeaderSet {
  entries: HeaderEntry[];
}

/** The empty set, for a request or response with no headers at all. */
export const EMPTY_HEADERS: HeaderSet = { entries: [] };

export function headerSet(entries: readonly HeaderEntry[] = []): HeaderSet {
  return { entries: entries.map((entry) => ({ ...entry })) };
}

/** Append one header, keeping every entry already there — this is how a duplicate is made, not an accident. */
export function addHeader(set: HeaderSet, name: string, value: string): HeaderSet {
  return { entries: [...set.entries, { name, value }] };
}

/**
 * The first value for a case-insensitively matched name, or `undefined` when
 * the header is absent. For a header that may legitimately repeat, use
 * `getHeaderAll` instead — this picks the first only because most headers
 * (`Content-Type`, `Authorization`, ...) are meant to appear once, and a
 * caller asking for "the" value has already made that assumption.
 */
export function getHeader(set: HeaderSet, name: string): string | undefined {
  const target = name.toLowerCase();
  for (const entry of set.entries) {
    if (entry.name.toLowerCase() === target) return entry.value;
  }
  return undefined;
}

/** Every value for a case-insensitively matched name, in wire order. */
export function getHeaderAll(set: HeaderSet, name: string): string[] {
  const target = name.toLowerCase();
  const out: string[] = [];
  for (const entry of set.entries) {
    if (entry.name.toLowerCase() === target) out.push(entry.value);
  }
  return out;
}

export function hasHeader(set: HeaderSet, name: string): boolean {
  const target = name.toLowerCase();
  return set.entries.some((entry) => entry.name.toLowerCase() === target);
}

/** How many times a name appears, case-insensitively — what a "repeated header" finding is counting. */
export function countHeader(set: HeaderSet, name: string): number {
  return getHeaderAll(set, name).length;
}
