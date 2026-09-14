/**
 * The `Intl` bindings each catalogue — and anything else in `src/` that
 * formats a locale-dependent value — needs, built once per language.
 *
 * Everything locale-dependent that is *not* a translated string lives here:
 * plural selection, digit grouping, dates. Before this existed the app called
 * `toLocaleString()` with no locale, which reads the browser's setting — so a
 * German UI on an American browser rendered `1,234 Ressourcen`. Numbers now
 * follow the language the user chose, like the words around them.
 *
 * That fix originally only reached the three catalogues (`en`/`de`/`uk`),
 * which format the app's own chrome — counts, labels, plurals. `src/format.ts`
 * formats *document values* (a resource attribute, a `meta` field) and used to
 * do it separately, with its own `toLocaleDateString(undefined, …)` and a
 * module-scope `new Intl.NumberFormat(undefined, …)` — so a document's dates
 * and numbers still followed the browser, not the language the app was set
 * to, no matter what this file did. `formatDate`/`formatNumber` now call
 * `intlFor` too, through `valueNumber`/`valueDateTime`/`valueDateOnly` below,
 * which is why this header no longer says "each catalogue" alone: every
 * locale-dependent rendering in the app, chrome and document values both, now
 * goes through the one factory in this file. See `docs/DECISIONS.md` and
 * `docs/qa-reports/prod-baseline-2026-09-02.md` D1 for the defect this closes.
 *
 * `intlFor` is memoised **by this module**, not by its callers: `en.ts` and
 * `format.ts` can each call `intlFor("en")` without either knowing the other
 * exists, and still share one set of `Intl` objects rather than building two.
 * The cache is populated lazily, on first call, rather than at module scope —
 * nothing here runs a single `new Intl.…` until something asks for a locale,
 * which is what keeps this file itself free of the module-scope construction
 * this fix exists to remove.
 */

export type PluralForms = {
  other: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  zero?: string;
};

/** Everything a catalogue — or `format.ts` — needs from `Intl`, bound to its own language. */
export interface Intlish {
  /**
   * Pick a plural form.
   *
   * English and German need two; Ukrainian needs four, and which one applies is
   * not something an `n === 1` check can decide — 2 ресурси, 5 ресурсів,
   * 21 ресурс. Forms are keyed by CLDR category, so supplying a category the
   * language never selects is harmless, and omitting one it *does* select falls
   * back to `other` rather than rendering `undefined`.
   */
  plural: (n: number, forms: PluralForms) => string;
  /** A count with digit grouping — `1,234`, `1.234`, `1 234`. */
  n: (value: number) => string;
  /**
   * A number read out of a document rather than counted by the UI — up to 6
   * fraction digits, matching the cap `src/format.ts`'s `NUMBER_FORMAT` used
   * to apply on its own. `n` above has no such cap and is for the app's own
   * round counts, which never carry a fractional part worth rendering.
   */
  valueNumber: (value: number) => string;
  /** Date and time, for a share expiry or a save timestamp. */
  dateTime: (epochMs: number) => string;
  /** Date alone, for a library row older than a month. */
  date: (epochMs: number) => string;
  /**
   * A document value that carries both a date and a time — medium date,
   * medium time, in the reader's own timezone. Distinct from `dateTime`
   * above (short time): that one is this app's own chrome, this one is
   * somebody else's payload.
   */
  valueDateTime: (epochMs: number) => string;
  /**
   * A document value that carries a date and no time — medium date, pinned
   * to UTC. A date-only value has no timezone of its own; rendering it in
   * the reader's local zone would silently shift it to the wrong calendar
   * day for anyone west of Greenwich, which would be a worse bug than the
   * one `valueNumber`/`valueDateTime` exist to fix. This pin is the one
   * thing about the old `formatDate` that must survive unchanged.
   */
  valueDateOnly: (epochMs: number) => string;
}

const cache = new Map<string, Intlish>();

export function intlFor(locale: string): Intlish {
  const cached = cache.get(locale);
  if (cached) return cached;

  // These are not free to construct and some render once per resource group
  // (or once per document value), so each language builds its set once and
  // every caller shares it — see the cache above and this module's header.
  const rules = new Intl.PluralRules(locale);
  const number = new Intl.NumberFormat(locale);
  const valueNumberFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 6 });
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  const valueDateTimeFormat = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "medium",
  });
  const valueDateOnlyFormat = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: "UTC",
  });

  const built: Intlish = {
    plural: (n, forms) => forms[rules.select(n)] ?? forms.other,
    n: (value) => number.format(value),
    valueNumber: (value) => valueNumberFormat.format(value),
    dateTime: (epochMs) => dateTime.format(epochMs),
    date: (epochMs) => date.format(epochMs),
    valueDateTime: (epochMs) => valueDateTimeFormat.format(epochMs),
    valueDateOnly: (epochMs) => valueDateOnlyFormat.format(epochMs),
  };
  cache.set(locale, built);
  return built;
}
