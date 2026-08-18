/**
 * The shape of a legal page.
 *
 * Structured data rather than markup, for the same reason the rest of the app
 * builds DOM instead of assembling HTML strings: three translations of a long
 * document are a lot of places for an unclosed tag to hide, and none of this
 * prose needs anything richer than paragraphs, lists and term/detail pairs.
 *
 * It also means the renderer decides the heading levels and the classes, so all
 * three languages come out with the same structure — including the same
 * document outline, which is what a screen reader navigates by.
 */

export type Block =
  | { kind: "p"; text: string }
  /** Address lines and the like: no bullets, line breaks preserved. */
  | { kind: "lines"; lines: string[] }
  | { kind: "list"; items: string[] }
  /** Term/detail pairs — "Legal basis: Art. 6(1)(f) GDPR". */
  | { kind: "pairs"; rows: [term: string, detail: string][] }
  /** A set-apart aside; used sparingly, for the things people actually ask. */
  | { kind: "note"; text: string }
  | { kind: "link"; text: string; href: string };

export interface Section {
  heading: string;
  blocks: Block[];
}

export interface LegalPage {
  /** Page heading. Carries the German term even in the other languages. */
  title: string;
  /** One line under the title saying what this page is. */
  lede: string;
  sections: Section[];
}

export interface LegalPages {
  impressum: LegalPage;
  privacy: LegalPage;
  /** Shown when `IDENTITY` still contains placeholders. */
  placeholderWarning: string;
  /** Label for the "last updated" line. */
  updated: (date: string) => string;
  /** The date both pages were last revised, ISO-8601. */
  updatedOn: string;
}
