/**
 * Localising the markup that ships in `index.html`.
 *
 * The shell and the paste view are written as real HTML rather than built in
 * TypeScript, which is worth keeping: it paints before the module graph has
 * even been fetched, and it stays readable in View Source. The cost is that its
 * copy lives outside the catalogue, so this module puts it back under the
 * catalogue's control at boot.
 *
 * The bindings are a typed table rather than `data-i18n` attributes and a
 * string-path lookup. A dotted path is a runtime failure waiting to happen —
 * rename a key and the page silently renders nothing — whereas every entry
 * below is an ordinary property access the compiler checks. The English text
 * left in the HTML is then a genuine pre-JavaScript fallback rather than a
 * second source of truth, and `test/i18n.test.ts` asserts the two agree.
 */

import { MOD_KEY } from "../platform.js";
import { en } from "./en.js";
import { t } from "./index.js";
import type { Messages } from "./en.js";

type Apply = (node: HTMLElement, m: Messages) => void;

const text =
  (pick: (m: Messages) => string): Apply =>
  (node, m) => {
    node.textContent = pick(m);
  };

/** For copy with emphasis inside it, which the catalogue returns as nodes. */
const rich =
  (pick: (m: Messages) => DocumentFragment): Apply =>
  (node, m) => {
    node.replaceChildren(pick(m));
  };

const attr =
  (name: string, pick: (m: Messages) => string): Apply =>
  (node, m) => {
    node.setAttribute(name, pick(m));
  };

const both =
  (...applies: Apply[]): Apply =>
  (node, m) => {
    for (const apply of applies) apply(node, m);
  };

/**
 * The FAQ, whose length lives in the catalogue rather than here.
 *
 * Six question/answer pairs would be twelve hand-written rows in the table
 * below, and adding a seventh question would mean remembering to add two more.
 * Generating them from the English catalogue's own item count means a new
 * question is written twice — once as copy, once as markup — and nowhere else.
 * A translation with the wrong number of items would silently leave a question
 * in English, so `test/i18n.test.ts` holds every catalogue to this count.
 */
const FAQ_BINDINGS: [selector: string, apply: Apply][] = en.faq.items.flatMap(
  (_, index): [selector: string, apply: Apply][] => [
    [
      `#faq-q${index + 1}`,
      (node, m) => {
        const item = m.faq.items[index];
        if (item) node.textContent = item.q;
      },
    ],
    [
      `#faq-a${index + 1}`,
      (node, m) => {
        const item = m.faq.items[index];
        if (item) node.replaceChildren(item.a());
      },
    ],
  ],
);

/**
 * Every localisable node in `index.html`, by selector.
 *
 * A selector that matches nothing is skipped rather than throwing: the
 * `<noscript>` body, for instance, is not parsed into elements when scripting
 * is on, and a view that has not been rendered yet has no nodes to fill.
 */
export const STATIC_BINDINGS: [selector: string, apply: Apply][] = [
  /* shell */
  [".brand__tag", text((m) => m.topbar.brandTag)],
  ["#library-label", text((m) => m.topbar.saved)],
  ["#open-library", attr("title", (m) => m.topbar.savedTitle)],
  [
    "#shortcuts",
    both(
      attr("title", (m) => m.shortcuts.title),
      attr("aria-label", (m) => m.shortcuts.title),
    ),
  ],
  ["#new-doc-label", text((m) => m.topbar.newDocument)],
  ["#new-doc-rest", text((m) => m.topbar.newDocumentRest)],
  ["#new-doc", attr("title", (m) => m.topbar.newDocumentTitle)],
  ["#language-label", text((m) => m.language.label)],
  ["#language", attr("title", (m) => m.language.title)],
  ["#boot-message", text((m) => m.boot.reading)],

  /* paste view */
  ["#paste-eyebrow", text((m) => m.paste.eyebrow)],
  ["#paste-title", rich((m) => m.paste.title())],
  ["#paste-lede", rich((m) => m.paste.lede())],
  ["#drop-label", rich((m) => m.paste.dropLabel())],
  ["#drop-overlay", text((m) => m.paste.dropOverlay)],
  ["#input", attr("aria-label", (m) => m.paste.inputLabel)],
  ["#parse", text((m) => m.paste.read)],
  ["#open-file", text((m) => m.paste.openFile)],
  // The only binding whose output depends on the machine rather than the
  // language: the markup ships the Mac spelling, and everywhere else it becomes
  // Ctrl. The message owns both the key and the words around it, because in
  // German they do not stay in that order.
  ["#drop-hint", rich((m) => m.paste.readHint(MOD_KEY))],

  /* samples */
  ["#samples-label", text((m) => m.samples.label)],
  ['[data-sample="articles"]', text((m) => m.samples.articles)],
  ['[data-sample="single"]', text((m) => m.samples.single)],
  ['[data-sample="dangling"]', text((m) => m.samples.dangling)],
  ['[data-sample="errors"]', text((m) => m.samples.errors)],
  ['[data-sample="edge"]', text((m) => m.samples.edge)],

  /* legend */
  ["#legend-resolves", rich((m) => m.legend.resolves())],
  ["#legend-absent", rich((m) => m.legend.absent())],
  ["#legend-local", rich((m) => m.legend.local())],
  ["#legend-chip-absent", text((m) => m.legend.notInDocument)],
  ["#legend-chip-type", text((m) => m.legend.localOnlyType)],
  ["#legend-chip-id", text((m) => m.legend.localOnlyId)],

  /* faq */
  ["#faq-title", text((m) => m.faq.heading)],
  ["#faq-lede", text((m) => m.faq.lede)],
  ...FAQ_BINDINGS,

  /* footer */
  ["#footer-tagline", text((m) => m.footer.tagline)],
  ["#footer-impressum", text((m) => m.footer.impressum)],
  ["#footer-privacy", text((m) => m.footer.privacy)],
];

/**
 * `messages` defaults to the negotiated language, which is what the app wants.
 * The prerender in `vite.config.ts` passes a language explicitly, because it
 * renders this markup once per language into a document it supplies itself.
 */
export function localiseStaticDom(
  root: ParentNode = document,
  messages: Messages = t(),
): void {
  for (const [selector, apply] of STATIC_BINDINGS) {
    const node = root.querySelector<HTMLElement>(selector);
    if (node) apply(node, messages);
  }
}
