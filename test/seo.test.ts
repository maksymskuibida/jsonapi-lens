import { describe, expect, it } from "vitest";

// The shipped files, pulled in through Vite the same way `i18n.test.ts` reads
// the markup. Reading them with `node:fs` would drag Node's types into a
// tsconfig that deliberately only has the DOM.
import shippedMarkup from "../index.html?raw";
import robotsTxt from "../public/robots.txt?raw";
import sitemapXml from "../public/sitemap.xml?raw";
import llmsTxt from "../public/llms.txt?raw";
import llmsFullTxt from "../public/llms-full.txt?raw";
import manifestJson from "../public/site.webmanifest?raw";
import headersFile from "../public/_headers?raw";
import redirectsFile from "../public/_redirects?raw";

import wranglerConfig from "../wrangler.jsonc?raw";

import { PRERENDERED_PAGES, render } from "../vite.config.js";
import { de } from "../src/i18n/de.js";
import { en } from "../src/i18n/en.js";
import { uk } from "../src/i18n/uk.js";
import { FALLBACK_LOCALE, LOCALES } from "../src/i18n/index.js";
import { legal } from "../src/legal/index.js";
import { IDENTITY } from "../src/legal/identity.js";
import { IMPRESSUM_PATH, LEGAL_PATHS, PASTE_PATH, PRIVACY_PATH, VIEW_PATH } from "../src/router.js";
import { INDEXABLE, metaForRoute, NOT_INDEXABLE, OG_LOCALES, SITE_ORIGIN } from "../src/seo.js";
import { entryFile, variantAsset, variantFile, VARIANT_BASES } from "../src/variants.js";
import type { PrerenderedPage } from "../vite.config.js";
import type { Locale } from "../src/i18n/index.js";
import type { Messages } from "../src/i18n/en.js";

/*
 * The head, `robots.txt`, `sitemap.xml`, the `llms.txt` pair and the prerender
 * table in `vite.config.ts` all describe the same site to different readers.
 * Nothing stops them describing *different* sites except this file: a path
 * renamed in `src/router.ts` or a question reworded in the catalogue has to
 * reach every one of them, and each assertion below is a place that would
 * otherwise go quietly stale.
 */

/** The shipped markup as a document, so the head can be queried rather than grepped. */
function head(): Document {
  return new DOMParser().parseFromString(shippedMarkup, "text/html");
}

const metaContent = (doc: Document, selector: string): string | null =>
  doc.querySelector<HTMLMetaElement>(selector)?.getAttribute("content") ?? null;

/** Whitespace in markup is formatting; whitespace in a message is not. */
const normalise = (value: string): string => value.replace(/\s+/g, " ").trim();

describe("the indexable head", () => {
  it("does not carry the noindex it was developed behind", () => {
    const robots = metaContent(head(), 'meta[name="robots"]');
    expect(robots).not.toBeNull();
    expect(robots).not.toContain("noindex");
    expect(robots).toBe(INDEXABLE);
  });

  it("declares itself canonical at the origin src/seo.ts uses", () => {
    const canonical = head().querySelector('link[rel="canonical"]')?.getAttribute("href");
    expect(canonical).toBe(`${SITE_ORIGIN}/`);
  });

  it("says the same thing in the title, the Open Graph card and the catalogue", () => {
    const doc = head();
    expect(doc.title).toBe(en.meta.title);
    expect(metaContent(doc, 'meta[name="description"]')).toBe(en.meta.description);
    expect(metaContent(doc, 'meta[property="og:title"]')).toBe(en.meta.title);
    expect(metaContent(doc, 'meta[property="og:description"]')).toBe(en.meta.description);
    expect(metaContent(doc, 'meta[name="twitter:title"]')).toBe(en.meta.title);
    expect(metaContent(doc, 'meta[name="twitter:description"]')).toBe(en.meta.description);
  });

  it("offers a large summary card with the image a crawler needs measured", () => {
    const doc = head();
    expect(metaContent(doc, 'meta[name="twitter:card"]')).toBe("summary_large_image");
    expect(metaContent(doc, 'meta[property="og:image"]')).toBe(`${SITE_ORIGIN}/og.png`);
    // Width and height let a preview reserve space before the bytes arrive, and
    // alt text is the only part of a card a screen reader can use.
    expect(metaContent(doc, 'meta[property="og:image:width"]')).toBe("1200");
    expect(metaContent(doc, 'meta[property="og:image:height"]')).toBe("630");
    expect(metaContent(doc, 'meta[property="og:image:alt"]')).toBeTruthy();
    expect(metaContent(doc, 'meta[name="twitter:image:alt"]')).toBeTruthy();
  });

  it("names every language it speaks, plus an x-default", () => {
    const doc = head();
    for (const code of LOCALES) {
      const href = doc
        .querySelector(`link[rel="alternate"][hreflang="${code}"]`)
        ?.getAttribute("href");
      expect(href, code).toBe(`${SITE_ORIGIN}/?lang=${code}`);
    }
    expect(
      doc.querySelector('link[rel="alternate"][hreflang="x-default"]')?.getAttribute("href"),
    ).toBe(`${SITE_ORIGIN}/`);
  });

  it("gives the browser chrome a colour for each scheme", () => {
    const doc = head();
    const themes = [...doc.querySelectorAll('meta[name="theme-color"]')];
    expect(themes).toHaveLength(2);
    expect(themes.map((node) => node.getAttribute("media"))).toEqual([
      "(prefers-color-scheme: light)",
      "(prefers-color-scheme: dark)",
    ]);
  });

  it("points at the icons and the manifest that are actually in public/", () => {
    const doc = head();
    const hrefs = [...doc.querySelectorAll("link[rel]")].map((node) => node.getAttribute("href"));
    for (const asset of [
      "/favicon.svg",
      "/icon-192.png",
      "/apple-touch-icon.png",
      "/site.webmanifest",
    ]) {
      expect(hrefs, asset).toContain(asset);
    }
  });
});

describe("structured data", () => {
  /** The single `@graph` in the head, parsed. */
  function graph(): Record<string, unknown>[] {
    const source = head().querySelector('script[type="application/ld+json"]')?.textContent;
    expect(source, "no ld+json block").toBeTruthy();
    const parsed = JSON.parse(source ?? "{}") as { "@graph"?: Record<string, unknown>[] };
    return parsed["@graph"] ?? [];
  }

  const nodeOfType = (type: string): Record<string, unknown> => {
    const found = graph().find((node) => {
      const types = node["@type"];
      return Array.isArray(types) ? types.includes(type) : types === type;
    });
    expect(found, `no ${type} in the graph`).toBeTruthy();
    return found ?? {};
  };

  it("parses, and every node is anchored at this origin", () => {
    for (const node of graph()) {
      expect(String(node["@id"]), String(node["@type"])).toContain(SITE_ORIGIN);
    }
  });

  it("describes the application as free, browser-based and MIT", () => {
    const app = nodeOfType("WebApplication");
    expect(app["applicationCategory"]).toBe("DeveloperApplication");
    expect(app["isAccessibleForFree"]).toBe(true);
    expect(String(app["license"])).toContain("mit");
    expect(Array.isArray(app["featureList"])).toBe(true);
  });

  it("names the same provider as the Impressum, which is the one that has to be true", () => {
    expect(nodeOfType("Person")["name"]).toBe(IDENTITY.name);
  });

  /*
   * The six answers exist three times: in the catalogue, in the shipped markup
   * and in the `FAQPage` data. The markup-versus-catalogue pair is checked by
   * `i18n.test.ts`; this is the third copy, which a search engine may quote
   * without ever rendering the page.
   */
  it("answers exactly the questions the page answers, in the same words", () => {
    const questions = (nodeOfType("FAQPage")["mainEntity"] ?? []) as {
      name: string;
      acceptedAnswer: { text: string };
    }[];

    expect(questions).toHaveLength(en.faq.items.length);

    const host = document.createElement("div");
    en.faq.items.forEach((item, index) => {
      const asked = questions[index];
      expect(asked?.name, item.q).toBe(item.q);

      host.replaceChildren(item.a());
      expect(normalise(asked?.acceptedAnswer.text ?? ""), item.q).toBe(
        normalise(host.textContent ?? ""),
      );
    });
  });
});

describe("the FAQ", () => {
  const CATALOGUES: [name: string, messages: Messages][] = [
    ["de", de],
    ["uk", uk],
  ];

  it("has a question and answer node in the markup for every item", () => {
    const doc = head();
    en.faq.items.forEach((_, index) => {
      expect(doc.querySelector(`#faq-q${index + 1}`), `#faq-q${index + 1}`).toBeTruthy();
      expect(doc.querySelector(`#faq-a${index + 1}`), `#faq-a${index + 1}`).toBeTruthy();
    });
  });

  it.each(CATALOGUES)("%s answers all of them, in its own words", (name, messages) => {
    // A short catalogue would leave the missing questions in English, because
    // the bindings are generated from the English item count.
    expect(messages.faq.items, name).toHaveLength(en.faq.items.length);

    const host = document.createElement("div");
    messages.faq.items.forEach((item, index) => {
      expect(item.q, `${name} q${index + 1}`).not.toBe(en.faq.items[index]?.q);
      host.replaceChildren(item.a());
      expect(normalise(host.textContent ?? ""), `${name} a${index + 1}`).not.toBe("");
    });
  });
});

describe("robots.txt", () => {
  it("lets the whole site be crawled apart from the paths with no content", () => {
    expect(robotsTxt).toMatch(/^User-agent: \*$/m);
    expect(robotsTxt).toMatch(/^Allow: \/$/m);
    for (const path of [VIEW_PATH, "/d/", "/api/"]) {
      expect(robotsTxt, path).toContain(`Disallow: ${path}`);
    }
  });

  it("names the assistants explicitly rather than leaving them to the wildcard", () => {
    // Several read a missing group as a refusal, and the two "-Extended" agents
    // are the documented way to allow use in answers rather than only indexing.
    for (const agent of [
      "GPTBot",
      "OAI-SearchBot",
      "ClaudeBot",
      "Claude-SearchBot",
      "PerplexityBot",
      "Google-Extended",
      "Applebot-Extended",
      "Bingbot",
    ]) {
      expect(robotsTxt, agent).toContain(`User-agent: ${agent}`);
    }
  });

  it("gives every named group the same exclusions, since a group replaces the wildcard", () => {
    const groups = robotsTxt
      .split(/\n\s*\n/)
      .filter((block) => /^User-agent:/m.test(block.replace(/^#.*$/gm, "").trim()));

    expect(groups.length).toBeGreaterThanOrEqual(2);
    for (const group of groups) {
      for (const path of [VIEW_PATH, "/d/", "/api/"]) {
        expect(group, path).toContain(`Disallow: ${path}`);
      }
    }
  });

  it("points at the sitemap by absolute URL, as the format requires", () => {
    expect(robotsTxt).toContain(`Sitemap: ${SITE_ORIGIN}/sitemap.xml`);
  });
});

describe("sitemap.xml", () => {
  const locs = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);

  it("lists every indexable path once per language, and nothing else", () => {
    const paths = [PASTE_PATH, IMPRESSUM_PATH, PRIVACY_PATH];
    const expected = paths.flatMap((path) => [
      `${SITE_ORIGIN}${path}`,
      ...LOCALES.map((code) => `${SITE_ORIGIN}${path}?lang=${code}`),
    ]);

    expect([...locs].sort()).toEqual([...expected].sort());
  });

  it("leaves out the two paths that must never be indexed", () => {
    for (const loc of locs) {
      expect(loc).not.toContain(VIEW_PATH);
      expect(loc).not.toContain("/d/");
    }
  });

  it("cross-links the languages of each URL with hreflang alternates", () => {
    for (const code of [...LOCALES, "x-default"]) {
      expect(sitemapXml, code).toContain(`hreflang="${code}"`);
    }
    // Three paths × (three languages + x-default), on four URLs each.
    expect(sitemapXml.match(/xhtml:link/g)?.length).toBe(locs.length * (LOCALES.length + 1));
  });

  it("declares the namespace the alternates live in", () => {
    expect(sitemapXml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
  });
});

describe("llms.txt", () => {
  it("opens the way the convention expects: one heading, one blockquote summary", () => {
    expect(llmsTxt.startsWith("# jsonapi-lens")).toBe(true);
    expect(llmsTxt).toMatch(/\n> /);
  });

  it("links the pages a reader would go to next, by absolute URL", () => {
    for (const path of [PASTE_PATH, IMPRESSUM_PATH, PRIVACY_PATH]) {
      expect(llmsTxt, path).toContain(`${SITE_ORIGIN}${path}`);
    }
  });

  it("asks not to be sent to the share links, whose keys are in the URL", () => {
    expect(llmsTxt).toContain("/d/<id>:<secret>");
    expect(llmsFullTxt).toContain("/d/<id>:<secret>");
  });

  it("repeats the answers, so an assistant that reads only this file has them", () => {
    for (const item of en.faq.items) {
      expect(llmsFullTxt, item.q).toContain(item.q.replace(/[“”]/g, '"'));
    }
  });
});

describe("site.webmanifest", () => {
  const manifest = JSON.parse(manifestJson) as {
    name: string;
    description: string;
    icons: { src: string }[];
    screenshots: { src: string; sizes: string }[];
    theme_color: string;
  };

  it("describes the app in the same words as the head", () => {
    expect(manifest.name).toContain("jsonapi-lens");
    expect(manifest.description).toBe(en.meta.description);
  });

  it("ships the icons and the screenshot the head also references", () => {
    expect(manifest.icons.map((icon) => icon.src)).toEqual([
      "/favicon.svg",
      "/icon-192.png",
      "/icon-512.png",
    ]);
    expect(manifest.screenshots[0]?.src).toBe("/og.png");
    expect(manifest.screenshots[0]?.sizes).toBe("1200x630");
  });

  it("uses the dark background the page paints, so a launch does not flash white", () => {
    expect(manifest.theme_color).toBe(
      metaContent(head(), 'meta[name="theme-color"][media="(prefers-color-scheme: dark)"]'),
    );
  });
});

describe("_headers", () => {
  it("sends noindex for the two paths robots.txt only asks about", () => {
    expect(headersFile).toContain("/d/*");
    expect(headersFile).toMatch(/X-Robots-Tag: noindex, nofollow/);
    expect(headersFile).toContain(VIEW_PATH);
    // Whatever else it says, it must not accidentally noindex the whole site.
    expect(headersFile).not.toMatch(/^\/\*\n(\s+.*\n)*\s+X-Robots-Tag/m);
  });
});

describe("_redirects", () => {
  /** `<from> <to> <status>`, ignoring comments and blank lines. */
  const rules = redirectsFile
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => line.split(/\s+/));

  it("sends every alias to the page src/router.ts says it means", () => {
    const canonical: Record<string, string> = {
      impressum: IMPRESSUM_PATH,
      privacy: PRIVACY_PATH,
    };
    const aliases = Object.entries(LEGAL_PATHS).filter(
      ([path, page]) => path !== canonical[page],
    );

    expect(rules).toHaveLength(aliases.length);
    for (const [path, page] of aliases) {
      const rule = rules.find(([from]) => from === path);
      expect(rule, path).toBeTruthy();
      expect(rule?.[1], path).toBe(canonical[page]);
      // 301, not 302: the alias is not coming back as a separate page.
      expect(rule?.[2], path).toBe("301");
    }
  });

  it("never redirects a canonical path, which would be a loop", () => {
    for (const [from] of rules) {
      expect([IMPRESSUM_PATH, PRIVACY_PATH, PASTE_PATH]).not.toContain(from);
    }
  });
});

describe("the prerendered pages", () => {
  it("covers exactly the paths that have a file of their own", () => {
    expect(PRERENDERED_PAGES.map((page) => page.path).sort()).toEqual(
      [PASTE_PATH, IMPRESSUM_PATH, PRIVACY_PATH].sort(),
    );
  });

  it("gives the front page the graph that is already in the markup", () => {
    // `null` means "localise index.html's own graph". The legal pages get their
    // own instead, because neither is an application with an FAQ.
    const front = PRERENDERED_PAGES.find((page) => page.path === PASTE_PATH);
    expect(front?.schemaType).toBeNull();
    for (const page of PRERENDERED_PAGES.filter((p) => p.path !== PASTE_PATH)) {
      expect(page.schemaType, page.path).not.toBeNull();
    }
  });

  /*
   * `/impressum` was briefly emitted as `impressum/index.html`, which Cloudflare's
   * `auto-trailing-slash` handling serves by first sending a 307 to `/impressum/`
   * — a redirect to a URL that disagrees with the canonical on the page itself.
   * A flat file makes `/impressum` the 200 and `/impressum/` the redirect, and the
   * language variants have to stay flat for the same reason.
   */
  it("emits flat files rather than directories, in every language", () => {
    for (const page of PRERENDERED_PAGES) {
      for (const locale of LOCALES) {
        const file = variantFile(page.path, locale);
        expect(file, `${page.path} ${locale}`).toBeTruthy();
        expect(file, `${page.path} ${locale}`).not.toContain("/");
        expect(file?.endsWith(".html"), `${page.path} ${locale}`).toBe(true);
      }
    }
  });

  it("says the same thing as the app, in each language", () => {
    // The prerender calls `metaForRoute`, so this is not checking a copy of the
    // strings — it is checking that the function it and the app both call answers
    // in the language it is asked about, rather than the one it negotiated.
    for (const locale of LOCALES) {
      const pages = legal(locale);
      const m: Messages = { en, de, uk }[locale];

      expect(metaForRoute({ kind: "paste" }, locale).title).toBe(m.meta.title);
      expect(metaForRoute({ kind: "paste" }, locale).description).toBe(m.meta.description);

      for (const [page, source] of [
        ["impressum", pages.impressum],
        ["privacy", pages.privacy],
      ] as const) {
        const meta = metaForRoute({ kind: "legal", page }, locale);
        expect(meta.title, `${locale} ${page}`).toBe(`${source.title} — jsonapi-lens`);
        expect(meta.description, `${locale} ${page}`).toBe(`${source.lede} ${m.footer.tagline}`);
      }
    }
  });
});

describe("the prerendered files themselves", () => {
  /*
   * What a reader that never runs JavaScript is handed. Every `?lang=` URL is
   * advertised as its own language — by the `hreflang` links in the head and by
   * twelve entries in `sitemap.xml` — and for a crawler, or whatever builds a
   * link preview when the URL is pasted into a chat, this file is the only
   * answer it will ever see. The app correcting the head at boot is too late.
   */
  const emitted = (path: string, locale: Locale): Document => {
    const page = PRERENDERED_PAGES.find((candidate) => candidate.path === path);
    expect(page, path).toBeTruthy();
    return new DOMParser().parseFromString(
      render(shippedMarkup, page as PrerenderedPage, locale),
      "text/html",
    );
  };

  const CASES: [locale: Locale, messages: Messages][] = [
    ["en", en],
    ["de", de],
    ["uk", uk],
  ];

  it.each(CASES)("titles the front page in %s", (locale, m) => {
    const doc = emitted(PASTE_PATH, locale);

    expect(doc.title).toBe(m.meta.title);
    expect(doc.documentElement.getAttribute("lang")).toBe(m.meta.lang);
    expect(metaContent(doc, 'meta[property="og:title"]')).toBe(m.meta.title);
    expect(metaContent(doc, 'meta[name="twitter:title"]')).toBe(m.meta.title);
    expect(metaContent(doc, 'meta[name="description"]')).toBe(m.meta.description);
  });

  it.each(CASES)("titles both legal pages in %s", (locale) => {
    for (const path of [IMPRESSUM_PATH, PRIVACY_PATH]) {
      const doc = emitted(path, locale);
      const page = PRERENDERED_PAGES.find((candidate) => candidate.path === path);
      const expected = metaForRoute((page as PrerenderedPage).route, locale);

      expect(doc.title, `${path} ${locale}`).toBe(expected.title);
      expect(metaContent(doc, 'meta[name="description"]'), path).toBe(expected.description);
      // The word survives translation, because it is the word the law uses.
      if (path === IMPRESSUM_PATH) expect(doc.title, locale).toContain("Impressum");
    }
  });

  it.each(CASES)("localises the copy, not just the head, in %s", (locale, m) => {
    const doc = emitted(PASTE_PATH, locale);

    expect(doc.querySelector("#footer-tagline")?.textContent).toBe(m.footer.tagline);
    expect(doc.querySelector("#faq-q1")?.textContent).toBe(m.faq.items[0]?.q);
    expect(normalise(doc.querySelector("#paste-title")?.textContent ?? "")).not.toBe("");
    // `<html lang>` describes the text under it; a German head over English copy
    // would be a different lie from the one this plugin exists to fix.
    expect(doc.documentElement.getAttribute("lang")).toBe(m.meta.lang);
  });

  it("keeps the Mac spelling of the modifier key, as the markup does", () => {
    // The one binding whose output depends on the machine and not the language.
    // Node is not a Mac, so left alone it would bake "Ctrl" into every file.
    for (const locale of LOCALES) {
      const hint = emitted(PASTE_PATH, locale).querySelector("#drop-hint");
      expect(hint?.textContent, locale).toContain("⌘");
      expect(hint?.textContent, locale).not.toContain("Ctrl");
    }
  });

  it.each(CASES)("declares the %s URL canonical, and the others as alternates", (locale) => {
    const doc = emitted(IMPRESSUM_PATH, locale);
    const url = `${SITE_ORIGIN}${IMPRESSUM_PATH}`;
    // Self-referential, in every language including English: this URL is listed
    // in the sitemap and is what its own `hreflang` link points at, so a
    // canonical naming the bare path instead would take it out of the cluster.
    const expected = `${url}?lang=${locale}`;

    expect(doc.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(expected);
    expect(metaContent(doc, 'meta[property="og:url"]')).toBe(expected);
    expect(metaContent(doc, 'meta[name="robots"]')).toBe(INDEXABLE);

    for (const code of LOCALES) {
      const alternate = doc.querySelector(`link[rel="alternate"][hreflang="${code}"]`);
      expect(alternate?.getAttribute("href"), code).toBe(`${url}?lang=${code}`);
    }
    expect(
      doc.querySelector('link[rel="alternate"][hreflang="x-default"]')?.getAttribute("href"),
    ).toBe(url);
  });

  it("leaves the bare path claiming no language of its own", () => {
    // The x-default: whichever of the three the visitor's browser asks for. It
    // cannot name one in its canonical without contradicting two thirds of its
    // own visitors, and it is the file `?lang=` variants are *not*.
    for (const page of PRERENDERED_PAGES) {
      const doc = new DOMParser().parseFromString(
        render(shippedMarkup, page, FALLBACK_LOCALE, "bare path"),
        "text/html",
      );
      const url = `${SITE_ORIGIN}${page.path}`;

      expect(doc.querySelector('link[rel="canonical"]')?.getAttribute("href"), page.path).toBe(url);
      expect(metaContent(doc, 'meta[property="og:url"]'), page.path).toBe(url);
      expect(
        doc.querySelector('link[rel="alternate"][hreflang="x-default"]')?.getAttribute("href"),
        page.path,
      ).toBe(url);
      // The markup is English, so that is what it says it is — the app replaces
      // both the moment it boots.
      expect(doc.documentElement.getAttribute("lang"), page.path).toBe(en.meta.lang);
      expect(doc.title, page.path).toBe(metaForRoute(page.route, FALLBACK_LOCALE).title);
    }
  });

  it.each(CASES)("names the %s Open Graph locale, with the other two as alternates", (locale) => {
    const doc = emitted(PASTE_PATH, locale);
    const alternates = [...doc.querySelectorAll('meta[property="og:locale:alternate"]')].map(
      (node) => node.getAttribute("content"),
    );

    expect(metaContent(doc, 'meta[property="og:locale"]')).toBe(OG_LOCALES[locale]);
    expect(alternates).toHaveLength(LOCALES.length - 1);
    expect(alternates).not.toContain(OG_LOCALES[locale]);
    for (const code of LOCALES.filter((other) => other !== locale)) {
      expect(alternates, code).toContain(OG_LOCALES[code]);
    }
  });

  it.each(CASES)("answers the FAQ in %s in the structured data too", (locale, m) => {
    const doc = emitted(PASTE_PATH, locale);
    const graph = JSON.parse(
      doc.querySelector('script[type="application/ld+json"]')?.textContent ?? "{}",
    ) as { "@graph": Record<string, unknown>[] };

    const faq = graph["@graph"].find((node) => node["@type"] === "FAQPage");
    const questions = faq?.["mainEntity"] as { name: string; acceptedAnswer: { text: string } }[];

    expect(faq?.["inLanguage"]).toBe(locale);
    expect(questions).toHaveLength(m.faq.items.length);
    m.faq.items.forEach((item, index) => {
      expect(questions[index]?.name, `q${index + 1}`).toBe(item.q);
      // Read back out of the localised markup, so a search result and the page
      // cannot answer the same question differently.
      const rendered = normalise(doc.querySelector(`#faq-a${index + 1}`)?.textContent ?? "");
      expect(questions[index]?.acceptedAnswer.text, `a${index + 1}`).toBe(rendered);
    });

    for (const type of ["WebSite", "FAQPage"]) {
      expect(graph["@graph"].some((node) => node["@type"] === type), type).toBe(true);
    }
    const app = graph["@graph"].find((node) => Array.isArray(node["@type"]));
    expect(app?.["description"]).toBe(m.meta.description);
  });

  it.each(CASES)("gives a legal page its own graph, in %s", (locale) => {
    const doc = emitted(IMPRESSUM_PATH, locale);
    const graph = JSON.parse(
      doc.querySelector('script[type="application/ld+json"]')?.textContent ?? "{}",
    ) as { "@graph": Record<string, unknown>[] };

    expect(graph["@graph"]).toHaveLength(1);
    const page = graph["@graph"][0];
    expect(page?.["@type"]).toBe("ContactPage");
    expect(page?.["name"]).toBe(metaForRoute({ kind: "legal", page: "impressum" }, locale).title);
    // An FAQ about the viewer is not a fact about the Impressum.
    expect(JSON.stringify(graph)).not.toContain("FAQPage");
  });
});

describe("the language variants", () => {
  it("has one prerendered page per path the router serves its own file for", () => {
    expect(Object.keys(VARIANT_BASES).sort()).toEqual(
      PRERENDERED_PAGES.map((page) => page.path).sort(),
    );
  });

  it("keeps the bare path's own file, which is the x-default", () => {
    // The entry file is the one Vite emits and the one the asset router finds on
    // its own; the language files sit beside it and are never the same file.
    for (const path of Object.keys(VARIANT_BASES)) {
      const entry = entryFile(path);
      expect(entry, path).toBeTruthy();
      for (const locale of LOCALES) {
        expect(variantFile(path, locale), `${path} ${locale}`).not.toBe(entry);
      }
    }
    expect(entryFile(PASTE_PATH)).toBe("index.html");
    expect(entryFile(IMPRESSUM_PATH)).toBe("impressum.html");
  });

  it("serves ?lang=en from its own file too, not the bare path's", () => {
    // `/?lang=en` is in the sitemap and is the `hreflang="en"` target, so it has
    // to declare itself canonical — which `index.html` cannot, being also the
    // answer for `/`. Same English markup, different canonical.
    expect(variantAsset(PASTE_PATH, FALLBACK_LOCALE)).toBe("/index.en");
    expect(variantFile(PASTE_PATH, FALLBACK_LOCALE)).toBe("index.en.html");
  });

  it("asks the asset router for the variant without its extension", () => {
    /*
     * The `.html` matters: `auto-trailing-slash` answers `/index.de.html` with a
     * 307 to `/index.de`, and a redirect would take the visitor off the `?lang=`
     * URL that the canonical, the `hreflang` links and the sitemap all name. The
     * Worker therefore asks for the path, and the build writes the file.
     */
    expect(variantAsset(PASTE_PATH, "de")).toBe("/index.de");
    expect(variantFile(PASTE_PATH, "de")).toBe("index.de.html");
    expect(variantAsset(IMPRESSUM_PATH, "uk")).toBe("/impressum.uk");
    expect(variantFile(IMPRESSUM_PATH, "uk")).toBe("impressum.uk.html");
  });

  it("has nothing to say about a path or a language it does not know", () => {
    for (const path of [VIEW_PATH, "/d/1:secret", "/nope", "/impressum/"]) {
      expect(variantAsset(path, "de"), path).toBeNull();
    }
    for (const lang of [null, "", "fr", "de-AT", "DE", "../index"]) {
      expect(variantAsset(PASTE_PATH, lang), String(lang)).toBeNull();
    }
  });

  it("is reachable, because the Worker runs first on every path that has one", () => {
    // A page added to the table above but not here would be served the English
    // file for every language, silently: the asset router cannot see `?lang=`.
    const config = JSON.parse(
      wranglerConfig.replace(/^\s*\/\/.*$/gm, ""),
    ) as { assets: { run_worker_first: string[] } };

    for (const path of Object.keys(VARIANT_BASES)) {
      expect(config.assets.run_worker_first, path).toContain(path);
    }
  });
});

describe("src/seo.ts", () => {
  it("agrees with the shipped head about what indexable means", () => {
    expect(metaContent(head(), 'meta[name="robots"]')).toBe(INDEXABLE);
    expect(NOT_INDEXABLE).toContain("noindex");
  });

  it("uses the origin the sitemap and robots.txt were written against", () => {
    expect(sitemapXml).toContain(SITE_ORIGIN);
    expect(robotsTxt).toContain(SITE_ORIGIN);
    expect(shippedMarkup).toContain(SITE_ORIGIN);
  });
});
