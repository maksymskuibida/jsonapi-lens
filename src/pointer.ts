/**
 * RFC 6901 JSON Pointers.
 *
 * Worth being exact about, because JSON:API error objects identify their source
 * with exactly this syntax (`"source": { "pointer": "/data/attributes/name" }`).
 * A pointer copied out of this viewer can be pasted straight into a bug report,
 * a test fixture, or a `jq`-adjacent tool and mean the same thing.
 */

/** `~` and `/` are the only characters that need escaping, and order matters. */
export function escapeToken(token: string): string {
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}

export function unescapeToken(token: string): string {
  return token.replace(/~1/g, "/").replace(/~0/g, "~");
}

/** Append tokens to a pointer. `join("/data/0", "attributes", "a/b")` → `/data/0/attributes/a~1b`. */
export function join(base: string, ...tokens: (string | number)[]): string {
  let out = base;
  for (const token of tokens) out += "/" + escapeToken(String(token));
  return out;
}

export function parse(pointer: string): string[] {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) throw new Error(`Not a JSON Pointer: ${pointer}`);
  return pointer.slice(1).split("/").map(unescapeToken);
}

/**
 * Follow a pointer into a parsed document.
 *
 * Returns `undefined` when the pointer does not resolve, which is a normal
 * outcome — a pointer copied from an older version of a document may no longer
 * lead anywhere.
 */
export function resolve(root: unknown, pointer: string): unknown {
  let current: unknown = root;
  for (const token of parse(pointer)) {
    if (current === null || typeof current !== "object") return undefined;
    if (Array.isArray(current)) {
      const index = Number(token);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return undefined;
      current = current[index];
    } else {
      // `in` would walk the prototype chain, so `/constructor` and
      // `/__proto__` would "resolve" to things that are not in the document.
      // A JSON Pointer only ever addresses own properties.
      if (!Object.prototype.hasOwnProperty.call(current, token)) return undefined;
      current = (current as Record<string, unknown>)[token];
    }
  }
  return current;
}
