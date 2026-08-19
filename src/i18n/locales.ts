/**
 * Which languages exist, with nothing else attached.
 *
 * This is split out of `./index.ts` because two readers need the list and can
 * afford none of the rest of it: the Worker, which resolves a `?lang=` to a
 * prerendered file and is typechecked without the DOM lib, and the prerender in
 * `vite.config.ts`. Importing the catalogues to learn that "de" is a language
 * would pull three message files and the DOM helpers they build nodes with into
 * a bundle that renders no messages at all.
 */

export const LOCALES = ["en", "de", "uk"] as const;
export type Locale = (typeof LOCALES)[number];

/**
 * The language the shipped markup is written in.
 *
 * It is the fallback when nothing else answers, and it is also why the
 * prerendered variants only exist for the other two: `index.html` already *is*
 * the English file. See `src/variants.ts`.
 */
export const FALLBACK_LOCALE: Locale = "en";

export function isLocale(value: string | null | undefined): value is Locale {
  return value !== null && value !== undefined && (LOCALES as readonly string[]).includes(value);
}
