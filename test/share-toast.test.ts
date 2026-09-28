import { describe, expect, it } from "vitest";

import { de } from "../src/i18n/de.js";
import { en } from "../src/i18n/en.js";
import type { Messages } from "../src/i18n/en.js";
import { uk } from "../src/i18n/uk.js";
import { EXPOSED_KEY_TOAST_MS, shareOpenedToast } from "../src/share-toast.js";

/*
 * QA4 item 3. With IndexedDB unavailable `load()` shows `toast.notStored`,
 * and the share toast that follows replaces it. Both share toasts used to say
 * "stored in this browser" unconditionally, so the second contradicted the
 * first. `main.ts` cannot be imported by a test, which is why the choice is a
 * pure function in `share-toast.ts`.
 */

const CATALOGUES: [name: string, messages: Messages, claimsStored: RegExp][] = [
  ["en", en, /now stored in this browser/i],
  ["de", de, /liegt jetzt in diesem Browser/i],
  ["uk", uk, /Тепер він збережений/i],
];

describe.each(CATALOGUES)("shareOpenedToast (%s)", (_name, m, claimsStored) => {
  it("stored, ordinary link: the ordinary copy, info tone, default lifetime", () => {
    expect(shareOpenedToast(m, { keyExposed: false, stored: true })).toEqual({
      text: m.share.opened,
      tone: "info",
    });
  });

  it("stored, exposed key: the QA3 copy, error tone, long lifetime", () => {
    expect(shareOpenedToast(m, { keyExposed: true, stored: true })).toEqual({
      text: m.share.openedKeyExposed,
      tone: "error",
      durationMs: EXPOSED_KEY_TOAST_MS,
    });
  });

  it("not stored, ordinary link: never claims it was stored", () => {
    const toast = shareOpenedToast(m, { keyExposed: false, stored: false });
    expect(toast.text).toBe(m.share.openedNotStored);
    expect(toast.text).not.toMatch(claimsStored);
    // The premise of the whole fix: the copy it replaces is the stored one.
    expect(m.share.opened).toMatch(claimsStored);
    expect(toast.tone).toBe("error");
  });

  it("not stored, exposed key: does not claim storage AND keeps the key warning", () => {
    const toast = shareOpenedToast(m, { keyExposed: true, stored: false });
    expect(toast.text).toBe(m.share.openedKeyExposedNotStored);
    expect(toast.text).not.toMatch(claimsStored);
    // The warning names the rewritten character, which is what makes it this warning.
    expect(toast.text).toContain("%23");
    expect(toast.text).toBe(m.share.openedKeyExposedNotStored);
    expect(toast.tone).toBe("error");
    expect(toast.durationMs).toBe(EXPOSED_KEY_TOAST_MS);
  });

  it("the four copies are four different strings", () => {
    const all = [
      m.share.opened,
      m.share.openedKeyExposed,
      m.share.openedNotStored,
      m.share.openedKeyExposedNotStored,
    ];
    expect(new Set(all).size).toBe(4);
  });
});

describe("the not-stored copies are translated, not copied", () => {
  it("de and uk differ from en", () => {
    for (const m of [de, uk]) {
      expect(m.share.openedNotStored).not.toBe(en.share.openedNotStored);
      expect(m.share.openedKeyExposedNotStored).not.toBe(en.share.openedKeyExposedNotStored);
    }
  });
});
