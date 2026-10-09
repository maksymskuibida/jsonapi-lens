/**
 * QA5 — the wording of two toasts, in every language, at the counts where
 * plural rules differ.
 *
 * The catalogues are imported directly rather than through `t()`: each builds
 * its own `Intl` bindings, so no locale switching is needed to read them.
 */
import { describe, expect, it } from "vitest";
import { de } from "../src/i18n/de.js";
import { en } from "../src/i18n/en.js";
import { uk } from "../src/i18n/uk.js";
import { formatBytes } from "../src/format.js";

describe("the exchange-copy toast", () => {
  it("de is a complete sentence — capitalised, with a verb, ending in a full stop", () => {
    expect(de.request.band.copiedExchange(0, 535)).toBe("Request und Response wurden kopiert (535 Zeichen).");
    expect(de.request.band.copiedExchange(1, 535)).toBe(
      "Request und Response wurden kopiert (535 Zeichen); 1 Wert wurde geschwärzt.",
    );
    expect(de.request.band.copiedExchange(2, 535)).toBe(
      "Request und Response wurden kopiert (535 Zeichen); 2 Werte wurden geschwärzt.",
    );
    // The reported fragment began with a lowercase article and had no verb of its own.
    for (const redacted of [0, 1, 2, 12]) {
      const text = de.request.band.copiedExchange(redacted, 1234);
      expect(text).toMatch(/^[A-ZÄÖÜ]/);
      expect(text).toMatch(/\.$/);
      expect(text).not.toMatch(/^den /);
      expect(text).toContain("1.234 Zeichen");
    }
  });

  it("en keeps its wording, and agrees in number for one character", () => {
    expect(en.request.band.copiedExchange(2, 535)).toBe("Copied the exchange — 2 redacted (535 characters)");
    expect(en.request.band.copiedExchange(0, 535)).toBe("Copied the exchange (535 characters)");
    expect(en.request.band.copiedExchange(0, 1)).toBe("Copied the exchange (1 character)");
  });

  it("uk agrees in number for 1, 2, 5 and 21, for both the characters and the redacted values", () => {
    const chars = (n: number): string => uk.request.band.copiedExchange(0, n);
    expect(chars(1)).toBe("Запит і відповідь скопійовано (1 символ).");
    expect(chars(2)).toBe("Запит і відповідь скопійовано (2 символи).");
    expect(chars(5)).toBe("Запит і відповідь скопійовано (5 символів).");
    expect(chars(21)).toBe("Запит і відповідь скопійовано (21 символ).");

    const hidden = (n: number): string => uk.request.band.copiedExchange(n, 535);
    expect(hidden(1)).toBe("Запит і відповідь скопійовано (535 символів); приховано 1 значення.");
    expect(hidden(2)).toBe("Запит і відповідь скопійовано (535 символів); приховано 2 значення.");
    expect(hidden(5)).toBe("Запит і відповідь скопійовано (535 символів); приховано 5 значень.");
    expect(hidden(21)).toBe("Запит і відповідь скопійовано (535 символів); приховано 21 значення.");
  });

  it("every language has a failure sentence of its own", () => {
    for (const m of [en, de, uk]) expect(m.request.band.copyExchangeFailed.length).toBeGreaterThan(10);
    expect(de.request.band.copyExchangeFailed).toMatch(/^Request und Response konnten nicht kopiert werden\./);
  });
});

describe("the import toast", () => {
  it("en: singular and plural", () => {
    expect(en.bundleUi.importedToast(1)).toBe("Imported 1 document into your saved documents.");
    expect(en.bundleUi.importedToast(2)).toBe("Imported 2 documents into your saved documents.");
    expect(en.bundleUi.importedPartialToast(1, 3)).toBe("Imported 1 of 3 documents; the rest could not be saved.");
  });

  it("de: verb and noun both agree", () => {
    expect(de.bundleUi.importedToast(1)).toBe("Es wurde 1 Dokument in Ihre gespeicherten Dokumente importiert.");
    expect(de.bundleUi.importedToast(2)).toBe("Es wurden 2 Dokumente in Ihre gespeicherten Dokumente importiert.");
    expect(de.bundleUi.importedToast(1000)).toContain("1.000 Dokumente");
    expect(de.bundleUi.importedPartialToast(1, 3)).toBe(
      "Es wurde 1 von 3 Dokumenten importiert; der Rest konnte nicht gespeichert werden.",
    );
    expect(de.bundleUi.importedPartialToast(2, 3)).toBe(
      "Es wurden 2 von 3 Dokumenten importiert; der Rest konnte nicht gespeichert werden.",
    );
  });

  it("uk: the four plural classes, at 1, 2, 5 and 21", () => {
    expect(uk.bundleUi.importedToast(1)).toBe("Імпортовано 1 документ до ваших збережених документів.");
    expect(uk.bundleUi.importedToast(2)).toBe("Імпортовано 2 документи до ваших збережених документів.");
    expect(uk.bundleUi.importedToast(5)).toBe("Імпортовано 5 документів до ваших збережених документів.");
    expect(uk.bundleUi.importedToast(21)).toBe("Імпортовано 21 документ до ваших збережених документів.");
    expect(uk.bundleUi.importedToast(22)).toBe("Імпортовано 22 документи до ваших збережених документів.");
  });

  it("uk: 'of N documents' takes the genitive — 1 and 21 are singular, 2 and 5 plural", () => {
    // `з 21 документа`, not `з 21 документів`: the pre-existing `imported` line had a
    // two-way branch that got 21 wrong.
    expect(uk.bundleUi.importedPartialToast(1, 2)).toBe("Імпортовано 1 з 2 документів; решту не вдалося зберегти.");
    expect(uk.bundleUi.importedPartialToast(3, 21)).toBe("Імпортовано 3 з 21 документа; решту не вдалося зберегти.");
    expect(uk.bundleUi.importedPartialToast(3, 5)).toBe("Імпортовано 3 з 5 документів; решту не вдалося зберегти.");
    expect(uk.bundleUi.imported(21, 21)).toBe("Збережено 21 з 21 документа.");
    expect(uk.bundleUi.imported(1, 1)).toBe("Збережено 1 з 1 документа.");
  });
});

describe("formatBytes: the 1024 base carries its IEC label", () => {
  it("labels KiB and MiB, never kB or MB", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1024)).toBe("1.0 KiB");
    expect(formatBytes(7782)).toBe("7.6 KiB");
    expect(formatBytes(1024 * 1024)).toBe("1.00 MiB");
    expect(formatBytes(12 * 1024 * 1024)).toBe("12.00 MiB");
    for (const n of [5, 2048, 3 * 1024 * 1024]) expect(formatBytes(n)).not.toMatch(/kB|MB/);
  });
});
