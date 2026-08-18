import { locale } from "../i18n/index.js";
import { legalDe } from "./de.js";
import { legalEn } from "./en.js";
import { legalUk } from "./uk.js";
import type { Locale } from "../i18n/index.js";
import type { LegalPages } from "./types.js";

export type { Block, LegalPage, LegalPages, Section } from "./types.js";
export { hasPlaceholders, IDENTITY } from "./identity.js";

const PAGES: Record<Locale, LegalPages> = {
  en: legalEn,
  de: legalDe,
  uk: legalUk,
};

/** The legal pages in the language the rest of the UI is speaking. */
export function legal(): LegalPages {
  return PAGES[locale()];
}
