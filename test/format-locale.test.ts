/**
 * Values out of the document are formatted in the language the **app** is
 * running in, not the one the **browser** is set to.
 *
 * `Intl` with an `undefined` locale follows `navigator.language`. That shipped:
 * on a Ukrainian machine with the interface switched to German, `42.5`
 * rendered as `42,5` and an ISO date as `30 лист. 2027 р.` — Ukrainian months
 * inside a German interface, and a printed number that differed from the
 * payload it came from.
 *
 * Each case re-imports `format.ts` through `vi.resetModules()` after pinning
 * the stored language, because `locale()` memoises on first call — the same
 * reason the formatters themselves are built lazily.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEY } from "../src/i18n/index.js";

/** Pretend the host is Ukrainian, whatever the app is set to. */
function hostSpeaksUkrainian(): void {
  Object.defineProperty(navigator, "language", { value: "uk", configurable: true });
  Object.defineProperty(navigator, "languages", { value: ["uk", "uk-UA"], configurable: true });
}

async function formatIn(lang: "en" | "de" | "uk"): Promise<typeof import("../src/format.js")> {
  localStorage.setItem(STORAGE_KEY, lang);
  vi.resetModules();
  return import("../src/format.js");
}

beforeEach(() => {
  hostSpeaksUkrainian();
});

describe("values are formatted in the app's language, not the browser's", () => {
  it("formats a number by the app's language even when the browser disagrees", async () => {
    expect(navigator.language).toBe("uk");

    const en = await formatIn("en");
    expect(en.formatNumber(42.5)).toBe("42.5");
    expect(en.formatNumber(1500)).toBe("1,500");

    const de = await formatIn("de");
    expect(de.formatNumber(42.5)).toBe("42,5");
    expect(de.formatNumber(1500)).toBe("1.500");
  });

  it("formats a date by the app's language even when the browser disagrees", async () => {
    const en = await formatIn("en");
    const englishDate = en.formatDate("2027-11-30")!.display;
    // The exact wording is ICU's; what matters is that it is not the host's.
    expect(englishDate).toMatch(/Nov/);
    expect(englishDate).not.toMatch(/лист/);

    // German `medium` is numeric (30.11.2027), English is not — the point is
    // that neither is the host's Ukrainian, and the two differ from each other.
    const de = await formatIn("de");
    const germanDate = de.formatDate("2027-11-30")!.display;
    expect(germanDate).toBe("30.11.2027");
    expect(germanDate).not.toMatch(/лист/);
    expect(germanDate).not.toBe(englishDate);

    const uk = await formatIn("uk");
    expect(uk.formatDate("2027-11-30")!.display).toMatch(/лист/);
  });

  it("still keeps the raw value alongside, so the payload is never in doubt", async () => {
    const de = await formatIn("de");
    expect(de.formatDate("2027-11-30")!.title).toContain("2027-11-30");
  });

  it("uses one separator convention across stat lines and values alike", async () => {
    // The stat chips go through the catalogue's `f.n`; values go through
    // `formatNumber`. Before this, one followed the app and the other the
    // browser, so a single English page showed both `2,100` and `1 500`.
    const en = await formatIn("en");
    const { t } = await import("../src/i18n/index.js");
    expect(en.formatNumber(2100)).toBe("2,100");
    expect(t().library.resources(2100)).toContain("2,100");
  });

  it("a non-finite number is passed through untouched", async () => {
    const en = await formatIn("en");
    expect(en.formatNumber(Number.NaN)).toBe("NaN");
    expect(en.formatNumber(Number.POSITIVE_INFINITY)).toBe("Infinity");
  });
});
