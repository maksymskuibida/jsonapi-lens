/**
 * Production QA of QA5, findings 2 and 3 (folded into QA7): the word "click" in the shortcuts dialog and the title of
 * a multi-document share dialog both come from the catalogues, in every language. (Finding 1, the recipient's count, is
 * `share-recount.test.ts`.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { de } from "../src/i18n/de.js";
import { en } from "../src/i18n/en.js";
import { uk } from "../src/i18n/uk.js";
import { LOCALES, STORAGE_KEY } from "../src/i18n/index.js";
import type { BundleEntry } from "../src/crypto.js";

/** Load the app modules fresh under one language (the catalogue is chosen when `i18n` first runs). */
async function inLanguage(lang: (typeof LOCALES)[number]) {
  localStorage.setItem(STORAGE_KEY, lang);
  vi.resetModules();
  const [panels, share] = await Promise.all([import("../src/panels.js"), import("../src/share.js")]);
  return { openShortcutsModal: panels.openShortcutsModal, openShareModal: share.openShareModal, openBundleShareModal: share.openBundleShareModal };
}

afterEach(() => {
  localStorage.setItem(STORAGE_KEY, "en");
  vi.resetModules();
});

beforeEach(() => {
  const root = document.createElement("div");
  root.id = "modal-root";
  const toastEl = document.createElement("div");
  toastEl.id = "toast";
  document.body.replaceChildren(root, toastEl);
  vi.stubGlobal("fetch", vi.fn());
  localStorage.clear();
});

const docs = (n: number): BundleEntry[] => Array.from({ length: n }, (_, i) => ({ label: `d${i}.json`, text: "{}" }));

describe("finding 2: the word in `⌘ + click` is a catalogue string", () => {
  it("has a translation that differs from English in de and uk", () => {
    expect(en.shortcuts.clickWord).toBe("click");
    expect(de.shortcuts.clickWord).toBe("Klick");
    expect(uk.shortcuts.clickWord).toBe("клік");
  });

  for (const [lang, word] of [["en", "click"], ["de", "Klick"], ["uk", "клік"]] as const) {
    it(`the shortcuts dialog in ${lang} shows ${word}, never a leftover placeholder or the English word in de/uk`, async () => {
      const { openShortcutsModal } = await inLanguage(lang);
      openShortcutsModal();
      const text = document.querySelector(".modal")!.textContent ?? "";
      expect(text).toMatch(new RegExp(`(⌘|Ctrl)\\s*\\+?\\s*${word}`));
      expect(text).not.toContain("{click}");
      if (lang !== "en") expect(text).not.toMatch(/click/i);
      // key names stay as they are
      expect(text).toMatch(/Shift\s*\+?\s*Esc/);
    });
  }
});

describe("finding 3: a multi-document share dialog has its own pluralised title", () => {
  it("the catalogue strings, at the counts where plural rules differ", () => {
    expect(en.bundleUi.shareTitle(2)).toBe("Share 2 documents");
    expect(de.bundleUi.shareTitle(2)).toBe("2 Dokumente teilen");
    expect(uk.bundleUi.shareTitle(2)).toBe("Поділитися 2 документами");
    expect(uk.bundleUi.shareTitle(5)).toBe("Поділитися 5 документами");
    expect(uk.bundleUi.shareTitle(21)).toBe("Поділитися 21 документом");
  });

  for (const lang of LOCALES) {
    it(`in ${lang}: two documents are not titled with the single-document string; one document still is`, async () => {
      const { openShareModal, openBundleShareModal } = await inLanguage(lang);
      const single = { en, de, uk }[lang].share.title;
      openBundleShareModal(docs(2));
      const title = document.querySelector(".modal__title")!.textContent;
      expect(title).not.toBe(single);
      expect(title).toContain("2");
      document.getElementById("modal-root")!.replaceChildren();
      openShareModal("{}", "a.json");
      expect(document.querySelector(".modal__title")!.textContent).toBe(single);
    });
  }
});
