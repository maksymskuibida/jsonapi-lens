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

import { PRERENDERED_PAGES } from "../vite.config.js";
import { de } from "../src/i18n/de.js";
import { en } from "../src/i18n/en.js";
import { uk } from "../src/i18n/uk.js";
import { LOCALES } from "../src/i18n/index.js";
import { legalEn } from "../src/legal/en.js";
import { IDENTITY } from "../src/legal/identity.js";
import {
  IMPRESSUM_PATH,
  LEGAL_PATHS,
  parseRoute,
  PASTE_PATH,
  PRIVACY_PATH,
  robotsTagForRoute,
  statusForRoute,
  VIEW_PATH,
} from "../src/router.js";
import { INDEXABLE, NOT_INDEXABLE, SITE_ORIGIN } from "../src/seo.js";
import type { Messages } from "../src/i18n/en.js";
import type { LegalPage } from "../src/legal/types.js";

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
    expect(llmsTxt).toContain("/d/<id>#<secret>");
    expect(llmsFullTxt).toContain("/d/<id>#<secret>");
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

describe("crawler directives", () => {
  it("sends noindex for the two paths robots.txt only asks about", () => {
    expect(robotsTagForRoute(parseRoute(VIEW_PATH))).toBe("noindex");
    expect(robotsTagForRoute(parseRoute("/d/42:AAAAAAAAAAAA"))).toMatch(/^noindex, nofollow/);
  });

  it("does not archive a share link, whose URL is the decryption key", () => {
    expect(robotsTagForRoute(parseRoute("/d/42:AAAAAAAAAAAA"))).toContain("noarchive");
  });

  it("leaves the pages that have content of their own indexable", () => {
    expect(robotsTagForRoute(parseRoute(PASTE_PATH))).toBeNull();
    expect(robotsTagForRoute(parseRoute(IMPRESSUM_PATH))).toBeNull();
    expect(robotsTagForRoute(parseRoute(PRIVACY_PATH))).toBeNull();
  });

  it("does not index a path that is not a page", () => {
    expect(robotsTagForRoute(parseRoute("/nope"))).toBe("noindex");
  });

  it("no longer keys them off _headers, which never matched a file for them", () => {
    // Directive lines are indented under a path; a `#` line is prose. Nothing
    // sets `X-Robots-Tag` there any more — which also means `/*` cannot
    // accidentally noindex the whole site.
    const directives = headersFile
      .split("\n")
      .filter((line) => /^\s+\S/.test(line) && !line.trim().startsWith("#"));
    expect(directives.join("\n")).not.toMatch(/X-Robots-Tag/i);
  });
});

describe("status for a path", () => {
  it("answers 404 for a path that is not a page", () => {
    expect(statusForRoute(parseRoute("/nope"))).toBe(404);
    expect(statusForRoute(parseRoute("/deep/nope/x"))).toBe(404);
  });

  it("answers 200 for every page", () => {
    for (const path of [PASTE_PATH, VIEW_PATH, IMPRESSUM_PATH, PRIVACY_PATH]) {
      expect(statusForRoute(parseRoute(path))).toBe(200);
    }
  });

  it("answers 200 for a share link as the server receives it — without its key", () => {
    // The browser strips `#<secret>`, so the Worker parses `/d/42` with no
    // hash. That is every valid link, and it must not look dead.
    const onTheWire = parseRoute("/d/42");
    expect(onTheWire.kind).toBe("share-damaged");
    expect(statusForRoute(onTheWire)).toBe(200);
    expect(robotsTagForRoute(onTheWire)).toContain("noarchive");
  });

  it("answers 200 for an old path-form share link, which still opens", () => {
    expect(statusForRoute(parseRoute("/d/42:AAAAAAAAAAAA"))).toBe(200);
  });
});

describe("not-found handling", () => {
  /**
   * `"single-page-application"` answers every unmatched path `200 OK` with
   * `index.html`, which makes `/nope` indistinguishable from `/view` to a
   * crawler, a link checker or `curl -f`. `"none"` sends those requests to the
   * Worker, and `worker.ts#serveShell` picks the status with `parseRoute`.
   *
   * This is asserted because flipping it back is a one-word edit that nothing
   * else would catch: the site would still work, and every 404 would quietly
   * become a 200 again.
   */
  it("leaves unmatched paths to the Worker rather than answering 200 for all of them", () => {
    expect(wranglerConfig).toMatch(/"not_found_handling"\s*:\s*"none"/);
  });

  it("still runs the Worker ahead of asset matching for the share API", () => {
    expect(wranglerConfig).toMatch(/"run_worker_first"\s*:\s*\[\s*"\/api\/\*"\s*\]/);
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

describe("the prerendered legal pages", () => {
  it("covers exactly the two paths that have their own content", () => {
    expect(PRERENDERED_PAGES.map((page) => page.path).sort()).toEqual(
      [IMPRESSUM_PATH, PRIVACY_PATH].sort(),
    );
  });

  /*
   * `/impressum` was briefly emitted as `impressum/index.html`, which Cloudflare's
   * `auto-trailing-slash` handling serves by first sending a 307 to `/impressum/`
   * — a redirect to a URL that disagrees with the canonical on the page itself.
   * A flat file makes `/impressum` the 200 and `/impressum/` the redirect.
   */
  it("names paths that become flat files rather than directories", () => {
    for (const page of PRERENDERED_PAGES) {
      expect(page.path.startsWith("/"), page.path).toBe(true);
      expect(page.path.slice(1), page.path).not.toContain("/");
      expect(page.path.endsWith("/"), page.path).toBe(false);
    }
  });

  it("uses the titles and ledes the pages themselves render", () => {
    const pages: Record<string, LegalPage | undefined> = {
      [IMPRESSUM_PATH]: legalEn.impressum,
      [PRIVACY_PATH]: legalEn.privacy,
    };

    for (const page of PRERENDERED_PAGES) {
      const source = pages[page.path];
      expect(source, page.path).toBeTruthy();
      expect(page.title, page.path).toBe(`${source?.title} — jsonapi-lens`);
      expect(page.description, page.path).toBe(`${source?.lede} ${en.footer.tagline}`);
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
