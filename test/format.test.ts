import { describe, expect, it } from "vitest";
import { formatDate, formatNumber } from "../src/format.js";

/*
 * D1 (docs/qa-reports/prod-baseline-2026-09-02.md): `formatDate`/
 * `formatNumber` used to call `toLocaleDateString`/`toLocaleString`/
 * `Intl.NumberFormat` with no locale, which reads the browser's own setting —
 * so a German UI on a Ukrainian-language machine rendered dates and numbers
 * in Ukrainian regardless of what language the app was actually showing.
 * Every expectation below is a plain string or a pattern, computed once by
 * hand and checked in literally — a test that built its expectation by
 * calling `toLocaleString()`/`Intl.NumberFormat()` itself, the same API the
 * code under test calls, could not fail no matter which locale leaked
 * through.
 */
describe("formatDate", () => {
  const WITH_TIME = "2026-09-14T07:34:00Z";
  const DATE_ONLY = "2026-09-14";

  it("renders a date-time value in each language's own convention, not the machine's", () => {
    // `valueDateTime` (src/i18n/intl.ts) deliberately carries no `timeZone`
    // override — it is meant to read in the reader's own local time, unlike
    // the date-only case below. That means the exact hour this machine
    // renders depends on its own timezone, so this checks each
    // language's punctuation and script rather than one pinned instant. A
    // ±14h offset can shift the calendar day by at most one either way,
    // which is why the day is a wildcard but the month and year are not.
    const en = formatDate(WITH_TIME, "en")?.display;
    const de = formatDate(WITH_TIME, "de")?.display;
    const uk = formatDate(WITH_TIME, "uk")?.display;

    // English: "Sep 14, 2026, 7:34:00 AM" — month name, comma, 12-hour clock with AM/PM.
    expect(en).toMatch(/^Sep \d{1,2}, 2026, \d{1,2}:\d{2}:\d{2}\s?(AM|PM)$/);
    // German: "14.09.2026, 07:34:00" — dotted day-first date, 24-hour clock, no AM/PM.
    expect(de).toMatch(/^\d{2}\.09\.2026, \d{2}:\d{2}:\d{2}$/);
    expect(de).not.toMatch(/AM|PM/i);
    // Ukrainian: Cyrillic month abbreviation, a "р." year marker, 24-hour clock.
    expect(uk).toMatch(/^\d{1,2} вер\. 2026 р\., \d{2}:\d{2}:\d{2}$/);
    expect(uk).not.toMatch(/[A-Za-z]/);
  });

  it("keeps a date-only value pinned to UTC in every language — the one thing that must not change", () => {
    // This is the sharp edge the task spec calls out by name: losing the
    // existing `timeZone: "UTC"` pin while fixing the locale would shift
    // every date-only value by a day for a reader on either side of
    // Greenwich — silently, and worse than the bug being fixed.
    expect(formatDate(DATE_ONLY, "en")?.display).toBe("Sep 14, 2026");
    expect(formatDate(DATE_ONLY, "de")?.display).toBe("14.09.2026");
    expect(formatDate(DATE_ONLY, "uk")?.display).toBe("14 вер. 2026 р.");
  });

  it("still carries the raw value and the ISO instant in the title, unaffected by locale", () => {
    const withTime = formatDate(WITH_TIME, "de");
    expect(withTime?.title).toBe(`${WITH_TIME}  ·  ${new Date(WITH_TIME).toISOString()}`);

    const dateOnly = formatDate(DATE_ONLY, "uk");
    expect(dateOnly?.title).toBe(DATE_ONLY);
  });

  it('renders an invalid date string as null, so the caller falls back to plain text — never "Invalid Date"', () => {
    expect(formatDate("not a date", "en")).toBeNull();
    expect(formatDate("2026-13-99", "en")).toBeNull();
    expect(formatDate("", "de")).toBeNull();
  });
});

describe("formatNumber", () => {
  it("groups digits the way each language does, not the way the browser does", () => {
    expect(formatNumber(18420, "en")).toBe("18,420");
    expect(formatNumber(18420, "de")).toBe("18.420");
    // Which space character Ukrainian's grouping uses is up to the ICU
    // build (see `test/i18n.test.ts`'s own number-formatting test for the
    // same caveat), so this checks for the absence of a comma or a full
    // stop rather than a specific byte.
    const uk = formatNumber(18420, "uk");
    expect(uk).not.toContain(",");
    expect(uk).not.toContain(".");
    expect(uk.replace(/\D/g, "")).toBe("18420");
  });

  it("caps a fractional value at 6 digits, the same as before this task", () => {
    expect(formatNumber(1234.123456789, "en")).toBe("1,234.123457");
    expect(formatNumber(1234.123456789, "de")).toBe("1.234,123457");
    const uk = formatNumber(1234.123456789, "uk");
    expect(uk).toContain("123457");
    expect(uk.replace(/\D/g, "")).toBe("1234123457");
  });

  it("leaves a non-finite number exactly as String() would, in every language", () => {
    expect(formatNumber(Infinity, "en")).toBe("Infinity");
    expect(formatNumber(-Infinity, "de")).toBe("-Infinity");
    expect(formatNumber(NaN, "uk")).toBe("NaN");
  });

  it("renders a very large finite number without switching to exponential notation", () => {
    const big = 123_456_789_012_345;
    for (const locale of ["en", "de", "uk"]) {
      const out = formatNumber(big, locale);
      expect(out, locale).not.toMatch(/e\+?\d/i);
      expect(out.replace(/\D/g, ""), locale).toBe(String(big));
    }
  });
});

/*
 * Files are collected with Vite's `import.meta.glob`, the same mechanism
 * `test/hygiene.test.ts` uses and for the same reason: it is typed by
 * `vite/client`, needs no `node:fs` (which this project's narrow, DOM-only
 * `tsconfig.json` deliberately excludes), and yields root-relative paths.
 */
const SRC_FILES: Record<string, string> = import.meta.glob("/src/**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});

/** A `new Intl.X(...)` construction, wherever it sits in the file. */
const NEW_INTL = /\bnew\s+Intl\s*\./;

describe("Intl construction stays behind one factory", () => {
  it("scans a non-trivial number of files, so a passing run means something", () => {
    expect(Object.keys(SRC_FILES).length).toBeGreaterThan(15);
    expect(SRC_FILES["/src/format.ts"]).toBeTruthy();
    expect(SRC_FILES["/src/i18n/intl.ts"]).toBeTruthy();
  });

  /**
   * `intlFor` in `src/i18n/intl.ts` is the one sanctioned place a `new
   * Intl.…` may appear anywhere in `src/` — see that module's header and
   * `docs/DECISIONS.md`. This is deliberately not scoped to "at module
   * scope": `src/format.ts`'s old `NUMBER_FORMAT` was a module-scope
   * offender, but the underlying defect (a formatter built with no locale,
   * so it read the browser's own setting instead of the app's chosen
   * language) would have been exactly as real inside a function. The
   * property worth guarding is that there is nowhere else for a `new
   * Intl.…` to hide at all — see D1 in
   * `docs/qa-reports/prod-baseline-2026-09-02.md`.
   */
  it("is the only file in src/ that constructs an Intl object", () => {
    const offenders = Object.entries(SRC_FILES)
      .filter(([path]) => path !== "/src/i18n/intl.ts")
      .filter(([, text]) => NEW_INTL.test(text))
      .map(([path]) => path);

    expect(offenders).toEqual([]);
  });

  it("the rule can actually fail — planting the old defect trips it", () => {
    expect(NEW_INTL.test("const NUMBER_FORMAT = new Intl.NumberFormat(undefined);")).toBe(true);
    expect(NEW_INTL.test('import { intlFor } from "./i18n/intl.js";')).toBe(false);
  });
});
