/**
 * The prerendered language variants: which file serves which page, in which
 * language.
 *
 * `?lang=de` is advertised as a German URL — by the `hreflang` links in the
 * head, and by every `?lang=` entry in `sitemap.xml`. Until this existed all
 * twelve of those URLs were served the same English file, so a reader that does
 * not run JavaScript — a crawler, or the thing that builds a link preview when
 * somebody pastes the URL into a chat — was handed an English `<title>`,
 * description and Open Graph card for a URL that claims to be in another
 * language. The running app has always corrected the head from the catalogue,
 * but only after its bundle has parsed, which is too late for those readers and
 * visible as a flash to everybody else.
 *
 * So `vite.config.ts` emits each page once per language, and the Worker picks
 * the file that matches `?lang=`. Both go through this module, so the name the
 * build writes and the name the Worker asks for cannot drift apart.
 *
 * Each page therefore has four files, not three. `?lang=en` gets one too: it is
 * listed in `sitemap.xml` and is what the `hreflang="en"` link points at, so it
 * has to declare *itself* canonical, the way the German and Ukrainian files do —
 * which `index.html` cannot, because it is also the file a bare path is served.
 * A bare path is the negotiated entry point that `x-default` names, where the
 * language the visitor actually gets depends on a `localStorage` value the edge
 * cannot see, so it declares no language and no `?lang=` of its own.
 */

import { isLocale } from "./i18n/locales.js";
import type { Locale } from "./i18n/locales.js";
import { IMPRESSUM_PATH, PASTE_PATH, PRIVACY_PATH } from "./paths.js";

/**
 * Every path that has its own prerendered file, and the file's base name.
 *
 * Flat names — `impressum.de.html`, not `impressum/de.html` — for the same
 * reason the English files are flat: Cloudflare's `auto-trailing-slash` handling
 * serves a directory-shaped file by first redirecting to the trailing-slash URL,
 * which is not the URL the canonical on the page names.
 */
export const VARIANT_BASES: Record<string, string> = {
  [PASTE_PATH]: "index",
  [IMPRESSUM_PATH]: "impressum",
  [PRIVACY_PATH]: "privacy",
};

/**
 * The file that serves `path?lang=<locale>`, or `null` if it is not prerendered.
 * This is what the build writes; see `variantAsset` for what the Worker asks
 * for, which is the same file without the extension.
 */
export function variantFile(path: string, locale: Locale): string | null {
  const base = variantBase(path, locale);
  return base === null ? null : `${base}.html`;
}

/**
 * The file that serves the bare `path`, in the language the markup is written
 * in. This is Vite's own `index.html` and the two legal files beside it.
 */
export function entryFile(path: string): string | null {
  const base = VARIANT_BASES[path];
  return base === undefined ? null : `${base}.html`;
}

function variantBase(path: string, locale: Locale): string | null {
  const base = VARIANT_BASES[path];
  return base === undefined ? null : `${base}.${locale}`;
}

/**
 * Which asset a request should be served, given its path and its `?lang=`.
 *
 * `null` means "nothing special here" — an unknown path, no `lang`, or a `lang`
 * that is not a language we speak. The Worker treats all of those the same way:
 * hand the request to the asset router untouched, which serves the entry file.
 *
 * A bare path is deliberately *not* negotiated from `Accept-Language`. The app
 * remembers a chosen language in `localStorage`, which no request carries, so
 * the edge guessing German for a visitor who chose English would replace one
 * wrong first paint with another — and the site promises no cookies, which is
 * the only way the edge could have known.
 */
export function variantAsset(pathname: string, lang: string | null): string | null {
  if (!isLocale(lang)) return null;
  const base = variantBase(pathname, lang);
  // Without the `.html`. Cloudflare's `auto-trailing-slash` handling answers a
  // request for `/index.de.html` with a 307 to `/index.de` — the same rule that
  // serves `/impressum` from `impressum.html` — and a redirect here would move
  // the visitor off the `?lang=` URL that every canonical and `hreflang` names.
  return base === null ? null : `/${base}`;
}
