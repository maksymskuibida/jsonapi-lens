import { defineConfig } from "vite";
import type { Plugin } from "vite";
import { JSDOM } from "jsdom";

import { FALLBACK_LOCALE, LOCALES, t } from "./src/i18n/index.js";
import type { Locale } from "./src/i18n/index.js";
import { localiseStaticDom } from "./src/i18n/static-dom.js";
import { IMPRESSUM_PATH, PASTE_PATH, PRIVACY_PATH } from "./src/paths.js";
import type { Route } from "./src/router.js";
import { metaForRoute, OG_LOCALES, SITE_ORIGIN } from "./src/seo.js";
import { entryFile, variantFile } from "./src/variants.js";

export interface PrerenderedPage {
  /** The route this file renders, which is what decides its head. */
  route: Route;
  /** The canonical path it declares, and what `src/variants.ts` names its file from. */
  path: string;
  /**
   * The schema.org type of the page's own graph, or `null` to localise the graph
   * that is already in `index.html`. A `ContactPage` is what an Impressum is.
   */
  schemaType: "ContactPage" | "WebPage" | null;
}

/**
 * The pages that get their own HTML files rather than the SPA fallback.
 *
 * Every one of them is emitted once per language — see `src/variants.ts` for why
 * and how the Worker finds them. Two separate problems are being solved here,
 * and it is worth keeping them apart:
 *
 *  - **The legal pages are not the front page.** Without their own files,
 *    `/impressum` and `/privacy` are served the front page's `<head>`, so both
 *    would claim to be the viewer, both would declare `/` as their canonical URL
 *    and both would carry the front page's `FAQPage` data — the kind of mismatch
 *    a search engine is entitled to distrust.
 *  - **`?lang=de` is not English.** The head, `sitemap.xml` and this table all
 *    advertise a URL per language; a reader that does not run JavaScript has to
 *    be handed that language, not the one the markup happens to be written in.
 *
 * Nothing about how the app works changes: all three paths are still resolved in
 * the browser like every other path, and the app still re-derives the head from
 * the catalogue at boot. These files decide what is true *before* it runs.
 *
 * No copy lives in this table. Titles and descriptions come from
 * `metaForRoute` in `src/seo.ts` — the same function the running app calls — so
 * the shipped `<title>` and the one on screen a moment later are the same string
 * by construction rather than by a test that has to notice.
 */
export const PRERENDERED_PAGES: PrerenderedPage[] = [
  { route: { kind: "paste" }, path: PASTE_PATH, schemaType: null },
  { route: { kind: "legal", page: "impressum" }, path: IMPRESSUM_PATH, schemaType: "ContactPage" },
  { route: { kind: "legal", page: "privacy" }, path: PRIVACY_PATH, schemaType: "WebPage" },
];

/**
 * The modifier key the markup ships, which is not this machine's.
 *
 * `#drop-hint` is the one localisable node whose text depends on the platform
 * rather than the language, and `index.html` ships the Mac spelling — so the
 * prerender has to as well. `MOD_KEY` in `src/platform.ts` asks the running
 * environment, and the running environment here is Node, which would bake "Ctrl"
 * into every file. The app corrects this at boot on the machines it is wrong for.
 */
const SHIPPED_MOD_KEY = "⌘";

/**
 * Every lookup below is required to find something.
 *
 * A silent no-op is the failure mode that matters: the build would keep working,
 * the files would keep being emitted, and their heads would quietly describe the
 * wrong page in the wrong language. Throwing instead means a change to
 * `index.html` that moves one of these nodes is found at build time.
 */
function must<E extends Element>(root: ParentNode, selector: string): E {
  const node = root.querySelector<E>(selector);
  if (!node) throw new Error(`seo-routes: found no ${selector} in the built index.html`);
  return node;
}

function setMeta(
  doc: Document,
  attribute: "name" | "property",
  key: string,
  content: string,
): void {
  must<HTMLMetaElement>(doc.head, `meta[${attribute}="${key}"]`).setAttribute("content", content);
}

/** Whitespace in markup is formatting; whitespace in a message is not. */
const normalise = (value: string): string => value.replace(/\s+/g, " ").trim();

/**
 * The graph a legal page carries.
 *
 * The front page's describes an application and answers six questions about it.
 * Neither is true of an Impressum, so it gets its own, smaller one.
 */
function legalGraph(
  page: PrerenderedPage,
  locale: Locale,
  url: string,
  addressed: Addressed,
): unknown {
  const { title, description } = metaForRoute(page.route, locale);
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": page.schemaType,
        "@id": `${url}#page`,
        url,
        name: title,
        description,
        // The bare path serves whichever language the visitor negotiates; a
        // `?lang=` URL is only ever the one.
        inLanguage: addressed === "bare path" ? LOCALES : locale,
        isPartOf: { "@id": `${SITE_ORIGIN}/#website` },
        about: { "@id": `${SITE_ORIGIN}/#app` },
        publisher: { "@id": `${SITE_ORIGIN}/#author` },
      },
    ],
  };
}

/**
 * Which of a page's two kinds of URL a file answers.
 *
 * A `?lang=` URL is one language and declares itself canonical in it. The bare
 * path negotiates from the visitor's browser, so it is the `x-default`: it
 * claims no language, and its canonical carries no `?lang=`. The markup it is
 * written in is English either way, which is why the two English files differ
 * only in what they declare.
 */
type Addressed = "bare path" | "?lang=";

/**
 * The front page's own graph, in another language.
 *
 * It is localised rather than rebuilt: most of it — the licence, the feature
 * list, the offer, the `@id` graph it stitches together — is not language at all,
 * and rewriting it here would mean a second copy of it to keep in step. Only the
 * parts a search result actually shows are translated, and the FAQ answers are
 * read back out of the localised markup, so the structured data and the visible
 * copy are the same sentences.
 */
function localiseGraph(raw: string, doc: Document, locale: Locale): string {
  const m = t(locale);
  const graph = JSON.parse(raw) as { "@graph": Record<string, unknown>[] };

  for (const node of graph["@graph"]) {
    const type = node["@type"];
    const types: unknown[] = Array.isArray(type) ? type : [type];

    // The two nodes that describe the app in a sentence. Everything else in the
    // graph is an identifier, a URL or a fact that reads the same in any language.
    if (types.includes("WebSite") || types.includes("SoftwareApplication")) {
      node["description"] = m.meta.description;
    }

    if (types.includes("FAQPage")) {
      node["inLanguage"] = locale;
      const questions = node["mainEntity"];
      if (!Array.isArray(questions)) {
        throw new Error("seo-routes: the FAQPage in index.html has no mainEntity array");
      }
      questions.forEach((question: Record<string, unknown>, index: number) => {
        const item = m.faq.items[index];
        const answer = must(doc, `#faq-a${index + 1}`);
        if (!item) throw new Error(`seo-routes: ${locale} has no FAQ item ${index + 1}`);
        question["name"] = item.q;
        question["acceptedAnswer"] = {
          "@type": "Answer",
          text: normalise(answer.textContent ?? ""),
        };
      });
    }
  }

  return JSON.stringify(graph, null, 2);
}

/**
 * One page, in one language, as a complete HTML file.
 *
 * Exported for `test/seo.test.ts`, which runs it over the repository's own
 * `index.html`: the emitted files are the whole point of this plugin, and the
 * alternative is a test that can only check the table that feeds it.
 */
export function render(
  html: string,
  page: PrerenderedPage,
  locale: Locale,
  addressed: Addressed = "?lang=",
): string {
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const { title, description } = metaForRoute(page.route, locale);
  const url = `${SITE_ORIGIN}${page.path}`;
  const canonical = addressed === "bare path" ? url : `${url}?lang=${locale}`;

  /*
   * The catalogues build DOM nodes for copy with emphasis inside it, using the
   * ambient `document`. Node has none, so this document stands in for one while
   * the markup is localised. Restored afterwards rather than left behind: Vite
   * runs this config in the same process as everything else it does.
   */
  const hadDocument = "document" in globalThis;
  const previous = (globalThis as { document?: Document }).document;
  (globalThis as { document?: Document }).document = doc;
  try {
    const m = t(locale);
    doc.documentElement.lang = m.meta.lang;
    localiseStaticDom(doc, m);
    // See SHIPPED_MOD_KEY: the binding above just wrote Node's idea of it.
    must(doc, "#drop-hint").replaceChildren(m.paste.readHint(SHIPPED_MOD_KEY));

    const graph = must(doc, 'script[type="application/ld+json"]');
    graph.textContent =
      page.schemaType === null
        ? localiseGraph(graph.textContent ?? "", doc, locale)
        : JSON.stringify(legalGraph(page, locale, url, addressed), null, 2);
  } finally {
    if (hadDocument) (globalThis as { document?: Document }).document = previous;
    else delete (globalThis as { document?: Document }).document;
  }

  must<HTMLTitleElement>(doc.head, "title").textContent = title;
  setMeta(doc, "name", "description", description);
  setMeta(doc, "property", "og:title", title);
  setMeta(doc, "property", "og:description", description);
  setMeta(doc, "property", "og:url", canonical);
  setMeta(doc, "name", "twitter:title", title);
  setMeta(doc, "name", "twitter:description", description);

  // Open Graph wants the page's own locale first and the others as alternates,
  // so the three `<meta>` elements move rather than stay as written.
  setMeta(doc, "property", "og:locale", OG_LOCALES[locale]);
  const alternates = doc.head.querySelectorAll<HTMLMetaElement>(
    'meta[property="og:locale:alternate"]',
  );
  const others = LOCALES.filter((code) => code !== locale);
  if (alternates.length !== others.length) {
    throw new Error("seo-routes: index.html has one og:locale:alternate per other language");
  }
  alternates.forEach((node, index) => {
    node.setAttribute("content", OG_LOCALES[others[index] as Locale]);
  });

  must<HTMLLinkElement>(doc.head, 'link[rel="canonical"]').setAttribute("href", canonical);

  // Each language variant of *this* page, so the alternates follow the route
  // rather than staying on the front page they were written for.
  for (const code of LOCALES) {
    must<HTMLLinkElement>(doc.head, `link[rel="alternate"][hreflang="${code}"]`).setAttribute(
      "href",
      `${url}?lang=${code}`,
    );
  }
  must<HTMLLinkElement>(doc.head, 'link[rel="alternate"][hreflang="x-default"]').setAttribute(
    "href",
    url,
  );

  return dom.serialize();
}

function seoRoutes(): Plugin {
  return {
    name: "seo-routes",
    apply: "build",
    // After the HTML has been through Vite's own transforms, so the emitted
    // copies carry the hashed asset URLs rather than `/src/main.ts`.
    enforce: "post",
    generateBundle(_options, bundle) {
      const index = bundle["index.html"];
      if (!index || index.type !== "asset") {
        throw new Error("seo-routes: index.html is not in the bundle");
      }
      const html = String(index.source);

      const emit = (fileName: string | null, where: string, source: string): void => {
        if (fileName === null) {
          throw new Error(`seo-routes: ${where} has no file name in src/variants.ts`);
        }
        // `index.html` is Vite's own output and the front page's entry file at
        // once, so it is rewritten in place. Everything else is a new file.
        if (fileName === "index.html") index.source = source;
        else this.emitFile({ type: "asset", fileName, source });
      };

      for (const page of PRERENDERED_PAGES) {
        emit(
          entryFile(page.path),
          page.path,
          render(html, page, FALLBACK_LOCALE, "bare path"),
        );
        for (const locale of LOCALES) {
          emit(
            variantFile(page.path, locale),
            `${page.path}?lang=${locale}`,
            render(html, page, locale, "?lang="),
          );
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [seoRoutes()],
  build: {
    target: "es2022",
    // Fonts are self-hosted so the page makes zero third-party requests.
    assetsInlineLimit: 0,
  },
});
