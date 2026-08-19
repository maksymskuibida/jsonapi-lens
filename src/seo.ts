/**
 * What the page tells a crawler about itself.
 *
 * A single-page app has one `<head>` and several things it can be showing, so
 * the head has to move with the route. Left alone it would claim that a share
 * link, a loaded document and the front page are all the same indexable URL —
 * which is how a site ends up with its own empty document view competing with
 * its landing page in a search index.
 *
 * Two rules do the work:
 *
 *  - **A route either has a canonical path or must not be indexed.** `/view` and
 *    `/d/<id>:<secret>` have no content of their own — one renders whatever is
 *    in the visitor's IndexedDB, the other carries a decryption key in the URL —
 *    so they get `noindex` and no canonical. `robots.txt` and `_headers` say the
 *    same thing for readers that never run this code.
 *  - **The canonical URL carries `?lang=` exactly when the language was asked
 *    for.** `/?lang=de` really does render German, so it is its own indexable
 *    URL; `/` negotiates from the browser, which is what `x-default` describes.
 *    Anything else would have three languages fighting over one URL, or a
 *    German page telling Google to index the English one instead.
 *
 * The origin is a constant rather than `location.origin` on purpose: a preview
 * deployment should point search engines at production, not at itself.
 */

import { legal } from "./legal/index.js";
import { locale, localeWasRequested, LOCALES, t } from "./i18n/index.js";
import type { Locale } from "./i18n/index.js";
import { IMPRESSUM_PATH, PASTE_PATH, PRIVACY_PATH } from "./router.js";
import type { Route } from "./router.js";

/** Where this site lives, and the only origin it ever claims to be. */
export const SITE_ORIGIN = "https://jsonapi.mstool.dev";

/** Directives for a page that should be indexed, as generously as possible. */
export const INDEXABLE =
  "index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1";

/** …and for one that should not. */
export const NOT_INDEXABLE = "noindex, nofollow";

/** Open Graph wants a language *and* a region, unlike `<html lang>`. */
export const OG_LOCALES: Record<Locale, string> = {
  en: "en_GB",
  de: "de_DE",
  uk: "uk_UA",
};

export interface PageMeta {
  /** `<title>`, and the Open Graph and Twitter title. */
  title: string;
  description: string;
  /**
   * The path this page declares as canonical — no query, no fragment — or `null`
   * for a page that must not be indexed.
   */
  path: string | null;
}

/** The canonical path of each legal page, by route. */
const LEGAL_PATHS = { impressum: IMPRESSUM_PATH, privacy: PRIVACY_PATH } as const;

/**
 * What the head should say for a given route.
 *
 * A loaded document is not a route — the same `/view` shows a different document
 * per visitor — so its title comes from `documentMeta` below instead.
 *
 * `at` names the language, and defaults to the one on screen. The prerender in
 * `vite.config.ts` calls this for each language in turn, so the `<title>` a
 * crawler is handed and the one the running app sets come out of this function
 * either way and cannot say different things.
 */
export function metaForRoute(route: Route, at: Locale = locale()): PageMeta {
  const m = t(at);

  if (route.kind === "legal") {
    const pages = legal(at);
    const page = route.page === "impressum" ? pages.impressum : pages.privacy;
    return {
      title: `${page.title} — jsonapi-lens`,
      // The lede alone is one clause; a search result wants to know what site it
      // is a clause from.
      description: `${page.lede} ${m.footer.tagline}`,
      path: LEGAL_PATHS[route.page],
    };
  }

  // Both of these render somebody's own document, or nothing at all.
  if (route.kind === "view" || route.kind === "share") {
    return { title: m.meta.title, description: m.meta.description, path: null };
  }

  return { title: m.meta.title, description: m.meta.description, path: PASTE_PATH };
}

/** The head for a document that is open, which is never indexable. */
export function documentMeta(label: string): PageMeta {
  const m = t();
  return { title: m.meta.documentTitle(label), description: m.meta.description, path: null };
}

function meta(attribute: "name" | "property", key: string, content: string): void {
  let node = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
  if (!node) {
    node = document.createElement("meta");
    node.setAttribute(attribute, key);
    document.head.append(node);
  }
  node.setAttribute("content", content);
}

function link(rel: string, href: string, hreflang?: string): void {
  const selector = hreflang ? `link[rel="${rel}"][hreflang="${hreflang}"]` : `link[rel="${rel}"]`;
  let node = document.head.querySelector<HTMLLinkElement>(selector);
  if (!node) {
    node = document.createElement("link");
    node.rel = rel;
    if (hreflang) node.hreflang = hreflang;
    document.head.append(node);
  }
  node.href = href;
}

/**
 * The canonical URL for a path in the language currently on screen.
 *
 * `?lang=` survives into the canonical only when the visitor (or a crawler
 * following an `hreflang` link) actually asked for that language, which is the
 * one case where the URL and the rendered language are guaranteed to agree.
 */
export function canonicalUrl(path: string): string {
  const query = localeWasRequested() ? `?lang=${locale()}` : "";
  return `${SITE_ORIGIN}${path}${query}`;
}

/** Put a resolved `PageMeta` on the document. */
export function applyPageMeta(page: PageMeta): void {
  document.title = page.title;

  meta("name", "description", page.description);
  meta("property", "og:title", page.title);
  meta("property", "og:description", page.description);
  meta("name", "twitter:title", page.title);
  meta("name", "twitter:description", page.description);
  meta("property", "og:locale", OG_LOCALES[locale()]);

  if (page.path === null) {
    meta("name", "robots", NOT_INDEXABLE);
    // A canonical pointing anywhere would be a lie: there is no public URL for
    // the document in this tab. Removing the element says nothing instead.
    document.head.querySelector('link[rel="canonical"]')?.remove();
    for (const code of LOCALES) {
      document.head.querySelector(`link[rel="alternate"][hreflang="${code}"]`)?.remove();
    }
    document.head.querySelector('link[rel="alternate"][hreflang="x-default"]')?.remove();
    return;
  }

  meta("name", "robots", INDEXABLE);
  link("canonical", canonicalUrl(page.path));
  meta("property", "og:url", canonicalUrl(page.path));

  // Each language variant of *this* page, so the alternates follow the route
  // rather than staying on the front page they were written for.
  for (const code of LOCALES) {
    link("alternate", `${SITE_ORIGIN}${page.path}?lang=${code}`, code);
  }
  link("alternate", `${SITE_ORIGIN}${page.path}`, "x-default");
}

/** The usual case: describe whatever route is on screen. */
export function applyRouteMeta(route: Route): void {
  applyPageMeta(metaForRoute(route));
}
