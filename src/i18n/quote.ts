import type { RichPart } from "../dom.js";

/**
 * Document-derived strings, quoted in the language's own convention, as parts
 * that are never scanned for markers.
 *
 * The keys come out of the document. Interpolating them into a string the
 * renderer then parses is what let a key spelled ``a`b`` display as `ab`, and
 * the quotation marks themselves were English ones baked into `parse.ts` —
 * copy living in code, which this repo does not allow. Each catalogue passes
 * its own pair.
 */
export function quoted(values: readonly string[], open: string, close: string): RichPart[] {
  const parts: RichPart[] = [];
  values.forEach((value, index) => {
    if (index > 0) parts.push(", ");
    parts.push({ verbatim: `${open}${value}${close}` });
  });
  return parts;
}
