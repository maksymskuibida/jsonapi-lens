import { defineConfig } from "vite";
import type { Plugin } from "vite";

/** Where the site lives. Kept in step with `src/seo.ts` by `test/seo.test.ts`. */
const SITE_ORIGIN = "https://jsonapi.mstool.dev";

const TAGLINE = "A JSON:API document viewer. Runs in your browser.";

export interface PrerenderedPage {
  /** Emitted at `<path>/index.html`, and the canonical path it declares. */
  path: string;
  /** The full `<title>`, matching what the app puts there at runtime. */
  title: string;
  description: string;
  /** schema.org type for this page. A `ContactPage` is what an Impressum is. */
  schemaType: "ContactPage" | "WebPage";
}

/**
 * The paths that get their own HTML file rather than the SPA fallback.
 *
 * Both are resolved in the browser like every other path, so this changes
 * nothing about how the app works. What it changes is what a crawler that does
 * not run JavaScript is handed: without it, `/impressum` and `/privacy` are
 * served the front page's `<head>`, so both would claim to be the viewer, both
 * would declare `/` as their canonical URL, and both would carry the front
 * page's `FAQPage` data — which is the kind of mismatch a search engine is
 * entitled to distrust.
 *
 * The strings are English because that is what the shipped markup is; the
 * running app replaces them from the catalogue in whichever language it
 * negotiates. `test/seo.test.ts` asserts they match `src/legal/en.ts`, so this
 * table cannot drift from the pages it describes.
 */
export const PRERENDERED_PAGES: PrerenderedPage[] = [
  {
    path: "/impressum",
    title: "Legal Notice (Impressum) — jsonapi-lens",
    description: `Provider information under § 5 DDG (Digitale-Dienste-Gesetz). ${TAGLINE}`,
    schemaType: "ContactPage",
  },
  {
    path: "/privacy",
    title: "Privacy Policy (Datenschutzerklärung) — jsonapi-lens",
    description: `How this site handles personal data, under Articles 13 and 14 GDPR. ${TAGLINE}`,
    schemaType: "WebPage",
  },
];

/** Language variants the head advertises, matching `LOCALES` in `src/i18n`. */
const LOCALES = ["en", "de", "uk"];

/**
 * Every replacement below is required to match.
 *
 * A silent no-op is the failure mode that matters here: the build would keep
 * working, the files would keep being emitted, and their heads would quietly
 * describe the wrong page. Failing the build instead means a change to
 * `index.html` that breaks a pattern is found immediately.
 */
function replace(html: string, pattern: RegExp, replacement: string, what: string): string {
  if (!pattern.test(html)) {
    throw new Error(`seo-routes: found no ${what} in the built index.html`);
  }
  return html.replace(pattern, () => replacement);
}

function meta(attribute: "name" | "property", key: string): RegExp {
  return new RegExp(`<meta\\s+${attribute}="${key}"\\s+content="[^"]*"\\s*/>`);
}

function headFor(html: string, page: PrerenderedPage): string {
  const url = `${SITE_ORIGIN}${page.path}`;
  const escaped = page.description.replace(/"/g, "&quot;");

  let out = replace(html, /<title>[^<]*<\/title>/, `<title>${page.title}</title>`, "<title>");

  for (const [attribute, key, value] of [
    ["name", "description", escaped],
    ["property", "og:title", page.title],
    ["property", "og:description", escaped],
    ["property", "og:url", url],
    ["name", "twitter:title", page.title],
    ["name", "twitter:description", escaped],
  ] as [attribute: "name" | "property", key: string, value: string][]) {
    out = replace(
      out,
      meta(attribute, key),
      `<meta ${attribute}="${key}" content="${value}" />`,
      `${attribute}="${key}"`,
    );
  }

  out = replace(
    out,
    /<link rel="canonical" href="[^"]*" \/>/,
    `<link rel="canonical" href="${url}" />`,
    "canonical link",
  );

  for (const code of [...LOCALES, "x-default"]) {
    const href = code === "x-default" ? url : `${url}?lang=${code}`;
    out = replace(
      out,
      new RegExp(`<link rel="alternate" hreflang="${code}" href="[^"]*" />`),
      `<link rel="alternate" hreflang="${code}" href="${href}" />`,
      `hreflang="${code}" link`,
    );
  }

  // The front page's graph describes the application and answers six questions
  // about it. Neither is true of a legal page, so it gets its own, smaller one.
  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": page.schemaType,
        "@id": `${url}#page`,
        url,
        name: page.title,
        description: page.description,
        inLanguage: LOCALES,
        isPartOf: { "@id": `${SITE_ORIGIN}/#website` },
        about: { "@id": `${SITE_ORIGIN}/#app` },
        publisher: { "@id": `${SITE_ORIGIN}/#author` },
      },
    ],
  };

  return replace(
    out,
    /<script type="application\/ld\+json">[\s\S]*?<\/script>/,
    `<script type="application/ld+json">\n${JSON.stringify(graph, null, 2)}\n    </script>`,
    "ld+json block",
  );
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

      for (const page of PRERENDERED_PAGES) {
        this.emitFile({
          type: "asset",
          fileName: `${page.path.replace(/^\//, "")}/index.html`,
          source: headFor(html, page),
        });
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
