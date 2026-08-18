/**
 * Which language the app speaks, and how it gets chosen.
 *
 * All three catalogues are in the bundle. Splitting them behind a dynamic
 * import would save a few kilobytes and cost a round trip on first paint, in an
 * app whose whole design is about not waiting for the network — so they are
 * static imports, and the language switch below is a reload rather than a
 * re-render.
 *
 * That reload is not a shortcut around re-rendering: the document lives in
 * IndexedDB, the scroll position lives in `history.state`, and the fragment
 * lives in the URL, so a reload restores everything the user could see. Doing
 * it by hand would mean re-running every render path, re-opening whatever
 * modal was up, and re-deriving the filter state, to save a few hundred
 * milliseconds on an action taken roughly once per user.
 */

import { de } from "./de.js";
import { en } from "./en.js";
import { uk } from "./uk.js";
import type { Messages } from "./en.js";

export type { Messages } from "./en.js";

export const LOCALES = ["en", "de", "uk"] as const;
export type Locale = (typeof LOCALES)[number];

/** Each language named in itself, which is the only naming a switcher can use. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  de: "Deutsch",
  uk: "Українська",
};

/**
 * Short forms, for when the top bar has no room for the full name.
 *
 * The bar is the tightest constraint in the layout — a brand plus four controls
 * does not fit a phone — and "Українська" is the widest control on it. Below the
 * breakpoint the switcher shows the language's tag instead, the same trade the
 * buttons make when they drop their `btn__wide` words.
 */
export const LOCALE_CODES: Record<Locale, string> = {
  en: "EN",
  de: "DE",
  uk: "UK",
};

const CATALOGUES: Record<Locale, Messages> = { en, de, uk };

const STORAGE_KEY = "jsonapi-lens:locale";
const QUERY_KEY = "lang";
const FALLBACK: Locale = "en";

function isLocale(value: string | null | undefined): value is Locale {
  return value !== null && value !== undefined && (LOCALES as readonly string[]).includes(value);
}

/**
 * `de-AT` and `uk-UA` should both find a catalogue, so match on the primary
 * subtag. `navigator.languages` is already in the user's preference order, so
 * the first tag that maps to a catalogue wins.
 */
function fromNavigator(): Locale | null {
  if (typeof navigator === "undefined") return null;
  const tags = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of tags) {
    const primary = tag.toLowerCase().split("-")[0];
    if (isLocale(primary)) return primary;
  }
  return null;
}

function stored(): Locale | null {
  try {
    const value = globalThis.localStorage?.getItem(STORAGE_KEY);
    return isLocale(value) ? value : null;
  } catch {
    // Storage can be blocked entirely; falling through to the browser's own
    // languages is a better answer than failing to start.
    return null;
  }
}

/**
 * `?lang=de` wins over everything and is sticky.
 *
 * It exists so a link can be sent in a particular language — the legal pages
 * especially, where "read my Datenschutzerklärung" is a link somebody sends to
 * a German speaker. Choosing it also stores it, so the param is needed once
 * rather than on every subsequent link.
 */
function fromQuery(): Locale | null {
  if (typeof location === "undefined") return null;
  const value = new URLSearchParams(location.search).get(QUERY_KEY);
  return isLocale(value) ? value : null;
}

/**
 * Was the active language asked for by URL, rather than remembered or guessed?
 *
 * `src/seo.ts` needs this to decide whether the canonical URL carries `?lang=`:
 * a page that was asked for in German is its own indexable URL, whereas `/`
 * serves whichever language the visitor's browser prefers and cannot claim to be
 * any one of them. It is recorded at negotiation time because the param is
 * stripped from the address bar immediately afterwards, so asking `location`
 * later would always answer no.
 */
let requested = false;

function negotiate(): Locale {
  const asked = fromQuery();
  if (asked !== null) {
    requested = true;
    return asked;
  }
  return stored() ?? fromNavigator() ?? FALLBACK;
}

/**
 * Resolved on first use rather than at import.
 *
 * `crypto.ts` reaches the catalogue for its error messages and is unit-tested
 * in a plain Node environment, where `location` and `navigator` do not exist.
 * Negotiating lazily — and treating every source as optional — keeps importing
 * this module free of assumptions about the host, which is the same reason the
 * three lookups above are each guarded.
 */
let current: Locale | null = null;

export function locale(): Locale {
  if (current === null) current = negotiate();
  return current;
}

/** See `requested` above. Resolves the language first, since that sets it. */
export function localeWasRequested(): boolean {
  locale();
  return requested;
}

/** The active catalogue. Called at every use site, so a swap cannot go stale. */
export function t(): Messages {
  return CATALOGUES[locale()];
}

function persist(next: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* the choice just will not survive this session */
  }
}

/**
 * Switch language.
 *
 * The query param is dropped on the way out: it has done its job once the
 * choice is stored, and leaving it behind would pin every later navigation —
 * including a share link copied from the address bar — to that language.
 */
export function setLocale(next: Locale): void {
  if (next === locale()) return;
  persist(next);
  const url = new URL(location.href);
  url.searchParams.delete(QUERY_KEY);
  location.replace(url.toString());
}

/**
 * Put the chosen language on the document itself.
 *
 * `lang` is what tells a screen reader which voice to use and the browser which
 * hyphenation and quotation rules apply, so it has to track the catalogue
 * rather than stay at the `en` baked into `index.html`.
 *
 * The title and the description are deliberately not set here: they depend on
 * which page is showing as well as which language it is in, so `src/seo.ts`
 * owns them and is called on every route change.
 */
export function applyDocumentLanguage(): void {
  document.documentElement.lang = t().meta.lang;

  // A `?lang=` that has been honoured and stored should not stay in the URL,
  // for the same reason `setLocale` strips it.
  if (fromQuery() !== null) {
    persist(locale());
    const url = new URL(location.href);
    url.searchParams.delete(QUERY_KEY);
    history.replaceState(history.state, "", url.pathname + url.search + url.hash);
  }
}
