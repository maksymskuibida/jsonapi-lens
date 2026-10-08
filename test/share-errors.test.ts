/**
 * Share failures reach the reader as catalogue copy chosen by HTTP status, never
 * as the Worker's English JSON text or the browser's own network error (QA6,
 * from the QA5 review). The locale is memoised on first use, so each language
 * gets a fresh module graph with its choice already stored.
 */
import { describe, expect, it, vi } from "vitest";

/** Sentences the Worker (src/worker.ts) and browsers produce, all English. */
const SERVER_ENGLISH = [
  "Encrypted document is",
  "Could not record the share",
  "Could not store the document",
  "Unknown lifetime",
  "Empty body",
  "Method not allowed",
  "Not found",
  "Failed to fetch",
  "NetworkError",
];

async function inLanguage(lang: "en" | "de" | "uk") {
  vi.resetModules();
  localStorage.setItem("jsonapi-lens:locale", lang);
  const i18n = await import("../src/i18n/index.js");
  expect(i18n.locale()).toBe(lang);
  return import("../src/share.js");
}

describe("uploadFailure maps each status to translated copy", () => {
  for (const lang of ["en", "de", "uk"] as const) {
    it(`${lang}: 400, 404, 405, 413, 500, 502, 503 and an unlisted status`, async () => {
      try {
        const { uploadFailure } = await inLanguage(lang);
        const statuses = [400, 404, 405, 413, 500, 502, 503, 418];
        const hints = statuses.map((s) => uploadFailure(s).hint);
        // every status has its own sentence, except the 5xx family sharing one shape
        expect(new Set(hints.slice(0, 5)).size).toBe(5);
        for (const [i, hint] of hints.entries()) {
          expect(hint.length, String(statuses[i])).toBeGreaterThan(10);
          if (lang !== "en") for (const english of SERVER_ENGLISH) expect(hint).not.toContain(english);
        }
        // the 413 names the limit, formatted by the app's size helper
        expect(uploadFailure(413).hint).toContain("12");
        // a 5xx says which status it was
        expect(uploadFailure(503).hint).toContain("503");
        expect(uploadFailure(400).headline.length).toBeGreaterThan(5);
      } finally {
        localStorage.setItem("jsonapi-lens:locale", "en");
        vi.resetModules();
      }
    });
  }

  it("de and uk differ from en for every mapped status", async () => {
    const out: Record<string, string[]> = {};
    for (const lang of ["en", "de", "uk"] as const) {
      const { uploadFailure } = await inLanguage(lang);
      out[lang] = [400, 404, 405, 413, 500].map((s) => uploadFailure(s).hint);
    }
    localStorage.setItem("jsonapi-lens:locale", "en");
    vi.resetModules();
    for (let i = 0; i < 5; i++) {
      expect(out["de"]![i]).not.toBe(out["en"]![i]);
      expect(out["uk"]![i]).not.toBe(out["en"]![i]);
    }
  });
});
