import { describe, expect, it } from "vitest";

// The shipped markup, pulled in through Vite the same way the sample payloads
// are. Reading it with `node:fs` would drag Node's types into a tsconfig that
// deliberately only has the DOM.
import shippedMarkup from "../index.html?raw";

import { de } from "../src/i18n/de.js";
import { en } from "../src/i18n/en.js";
import { uk } from "../src/i18n/uk.js";
import { LOCALE_NAMES, LOCALES } from "../src/i18n/index.js";
import { localiseStaticDom, STATIC_BINDINGS } from "../src/i18n/static-dom.js";
import { MOD_KEY } from "../src/platform.js";
import { legalDe } from "../src/legal/de.js";
import { legalEn } from "../src/legal/en.js";
import { legalUk } from "../src/legal/uk.js";
import { hasPlaceholders } from "../src/legal/identity.js";
import { renderLegalPage } from "../src/views/legal.js";
import type { LegalPages } from "../src/legal/types.js";
import type { Messages } from "../src/i18n/en.js";

/*
 * Key *parity* between catalogues is a compile-time guarantee: `de` and `uk` are
 * typed as `Messages`, so a missing or renamed key does not build. What the
 * compiler cannot check is whether a translation is actually a translation, or
 * whether the plural rules a language needs are the ones it supplies — which is
 * what most of this file is about.
 */

const CATALOGUES: [name: string, messages: Messages][] = [
  ["de", de],
  ["uk", uk],
];

describe("catalogues", () => {
  it("covers every locale the switcher offers", () => {
    for (const code of LOCALES) {
      expect(LOCALE_NAMES[code], code).toBeTruthy();
    }
  });

  it("names each language in itself, which is the only naming a switcher can use", () => {
    expect(LOCALE_NAMES.de).toBe("Deutsch");
    expect(LOCALE_NAMES.uk).toBe("Українська");
  });

  it.each(CATALOGUES)("%s declares its own language tag", (name, messages) => {
    expect(messages.meta.lang).toBe(name);
  });

  it.each(CATALOGUES)("%s actually translates the running copy", (_name, messages) => {
    // Spot-checks on prose long enough that an untranslated copy-paste would be
    // an obvious mistake rather than a legitimate shared term.
    expect(messages.share.lede).not.toBe(en.share.lede);
    expect(messages.library.emptyHint).not.toBe(en.library.emptyHint);
    expect(messages.parseErrors.dataAndErrors.hint).not.toBe(en.parseErrors.dataAndErrors.hint);
    expect(messages.overview.nullNote).not.toBe(en.overview.nullNote);
  });

  it.each(CATALOGUES)("%s keeps the JSON:API vocabulary in English", (_name, messages) => {
    // `to-one`, `data` and friends are spelled this way in the spec and in the
    // payload on screen. Translating them would break the connection between
    // what the tool says and what the user is looking at.
    expect(messages.relationships.toOne).toBe("to-one");
    expect(messages.overview.shapeNull).toBe("data: null");
    expect(messages.overview.shapeSingle).toBe("data{1}");
  });

  it("offers exactly the share lifetimes the Worker accepts", () => {
    const keys = Object.keys(en.share.lifetimes).sort();
    for (const [name, messages] of CATALOGUES) {
      expect(Object.keys(messages.share.lifetimes).sort(), name).toEqual(keys);
    }
  });
});

describe("plurals", () => {
  it("uses all four Ukrainian forms rather than an n === 1 check", () => {
    // 1 ресурс / 2 ресурси / 5 ресурсів — a two-form language's rule gets the
    // middle case wrong, which is exactly the bug this guards.
    expect(uk.library.resources(1)).toContain("ресурс");
    expect(uk.library.resources(2)).toContain("ресурси");
    expect(uk.library.resources(5)).toContain("ресурсів");

    // …and the rule is modular, not a lookup of small numbers.
    expect(uk.library.resources(21)).toContain("ресурс");
    expect(uk.library.resources(22)).toContain("ресурси");
    expect(uk.library.resources(25)).toContain("ресурсів");

    const forms = new Set([2, 5, 21].map((n) => uk.library.resources(n).replace(/[\d\s ]/g, "")));
    expect(forms.size).toBe(3);
  });

  it("switches the German verb with the count, not just the noun", () => {
    expect(de.dangling.distinct(1)).toContain("zeigt");
    expect(de.dangling.distinct(4)).toContain("zeigen");
  });

  it("agrees with English on the singular/plural boundary", () => {
    expect(en.value.items(1)).toBe("1 item");
    expect(en.value.items(2)).toBe("2 items");
  });
});

describe("number formatting", () => {
  it("groups digits the way each language does, not the way the browser does", () => {
    // Before the catalogues owned this, these all came out as `1,234` because
    // `toLocaleString()` with no argument reads the browser's locale.
    expect(en.num(1234)).toBe("1,234");
    expect(de.num(1234)).toBe("1.234");
    // Ukrainian groups with a space; which space character is up to the ICU
    // build, so the assertion is about the absence of a comma or a full stop.
    expect(uk.num(1234)).not.toContain(",");
    expect(uk.num(1234)).not.toContain(".");
    expect(uk.num(1234).replace(/\D/g, "")).toBe("1234");
  });
});

/*
 * `index.html` ships English copy so the page paints before the module graph
 * has loaded. That makes it a second place the same words live, and the usual
 * fate of such a place is to drift. This asserts it cannot: localising the
 * shipped markup into English has to be a no-op.
 */
describe("static markup", () => {
  /** Whitespace in the markup is formatting; whitespace in a message is not. */
  const normalise = (value: string): string => value.replace(/\s+/g, " ").trim();

  /*
   * One binding depends on the machine rather than the language: the markup
   * ships the Mac spelling of the modifier and everywhere else it becomes Ctrl,
   * so on a non-Apple test runner it is *supposed* to differ. It gets its own
   * assertion below instead of being quietly excused here.
   */
  const PLATFORM_DEPENDENT = new Set(["#drop-hint"]);

  function loadShippedMarkup(): void {
    const parsed = new DOMParser().parseFromString(shippedMarkup, "text/html");
    document.documentElement.replaceChildren(...parsed.documentElement.childNodes);
  }

  it("matches the English catalogue exactly", () => {
    loadShippedMarkup();

    const before = new Map<string, string>();
    for (const [selector] of STATIC_BINDINGS) {
      const node = document.querySelector(selector);
      if (node) before.set(selector, normalise(node.textContent ?? ""));
    }

    // Every selector in the table should find something; one that does not is a
    // binding that silently stopped applying.
    const missing = STATIC_BINDINGS.map(([selector]) => selector).filter(
      (selector) => !before.has(selector),
    );
    expect(missing).toEqual([]);

    localiseStaticDom();

    for (const [selector] of STATIC_BINDINGS) {
      if (PLATFORM_DEPENDENT.has(selector)) continue;
      const node = document.querySelector(selector);
      expect(normalise(node?.textContent ?? ""), selector).toBe(before.get(selector));
    }
  });

  it("prints the modifier this machine actually uses", () => {
    loadShippedMarkup();
    localiseStaticDom();

    const hint = normalise(document.querySelector("#drop-hint")?.textContent ?? "");
    expect(hint).toBe(`${MOD_KEY} ↵ to read`);

    // Both spellings are reachable from the message, whichever machine runs this.
    expect(normalise(spread(en.paste.readHint("⌘")))).toBe("⌘ ↵ to read");
    expect(normalise(spread(en.paste.readHint("Ctrl")))).toBe("Ctrl ↵ to read");
  });

  /** A fragment's text, without attaching it to the document. */
  function spread(fragment: DocumentFragment): string {
    const host = document.createElement("div");
    host.append(fragment);
    return host.textContent ?? "";
  }

  it("keeps the emphasis inside translated copy, not around it", () => {
    loadShippedMarkup();
    localiseStaticDom();

    // German moves the stressed word, so `<em>` cannot live in the markup; the
    // message has to be able to place it. This checks the mechanism survives.
    const title = document.querySelector("#paste-title");
    expect(title?.querySelector("em")?.textContent).toBe("pointer");

    const lede = document.querySelector("#paste-lede");
    expect(lede?.querySelector("code")?.textContent).toBe("included");
  });
});

describe("legal pages", () => {
  const PAGES: [name: string, pages: LegalPages][] = [
    ["en", legalEn],
    ["de", legalDe],
    ["uk", legalUk],
  ];

  it.each(PAGES)("%s keeps the word Impressum in the title", (_name, pages) => {
    // § 5 DDG wants the provider information to be *leicht erkennbar*, and the
    // case law is built around that word — so it survives translation.
    expect(pages.impressum.title).toContain("Impressum");
  });

  it.each(PAGES)("%s names Datenschutz on the privacy page", (_name, pages) => {
    expect(pages.privacy.title).toContain("Datenschutz");
  });

  it.each(PAGES)("%s links no dead ODR platform", (_name, pages) => {
    // Regulation (EU) 524/2013 was repealed and the platform shut down on
    // 20 July 2025. Most Impressum templates still carry the link.
    const text = JSON.stringify(pages);
    expect(text).not.toContain("ec.europa.eu/consumers/odr");
    expect(text).not.toContain("webgate.ec.europa.eu/odr");
  });

  it.each(PAGES)("%s states a legal basis wherever it describes processing", (_name, pages) => {
    const headings = pages.privacy.sections.map((section) => section.heading);
    expect(headings.length).toBeGreaterThan(6);

    const pairs = pages.privacy.sections
      .flatMap((section) => section.blocks)
      .filter((block) => block.kind === "pairs");
    expect(pairs.length).toBeGreaterThan(0);
  });

  it("renders every block kind without reaching for innerHTML", () => {
    const article = renderLegalPage(legalEn.privacy);

    expect(article.querySelector(".legal__title")?.textContent).toBe(legalEn.privacy.title);
    expect(article.querySelectorAll(".legal__section").length).toBe(
      legalEn.privacy.sections.length,
    );
    expect(article.querySelector(".legal__lines")?.querySelectorAll("br").length).toBeGreaterThan(0);
    expect(article.querySelector(".legal__pairs dt")).not.toBeNull();
    expect(article.querySelector(".legal__list li")).not.toBeNull();

    // Links out of the app leak no referrer, same as in the value renderer.
    const link = article.querySelector<HTMLAnchorElement>(".legal__link");
    expect(link?.rel).toContain("noreferrer");
  });

  it("warns on the page itself while the provider details are placeholders", () => {
    // The warning is the whole safety net: an Impressum that still says [CITY]
    // reads as compliance to a crawler and as nothing at all to a court. When
    // the real details land, `hasPlaceholders` goes false and this flips to
    // asserting the banner is gone.
    const article = renderLegalPage(legalEn.impressum);
    const warning = article.querySelector(".legal__warning");

    if (hasPlaceholders()) {
      expect(warning?.textContent).toBe(legalEn.placeholderWarning);
    } else {
      expect(warning).toBeNull();
    }
  });
});
