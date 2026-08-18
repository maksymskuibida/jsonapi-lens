/**
 * The `Intl` bindings each catalogue needs, built once per language.
 *
 * Everything locale-dependent that is *not* a translated string lives here:
 * plural selection, digit grouping, dates. Before this existed the app called
 * `toLocaleString()` with no locale, which reads the browser's setting — so a
 * German UI on an American browser rendered `1,234 Ressourcen`. Numbers now
 * follow the language the user chose, like the words around them.
 */

export type PluralForms = {
  other: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  zero?: string;
};

/** Everything a catalogue needs from `Intl`, bound to its own language. */
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
  /** Date and time, for a share expiry or a save timestamp. */
  dateTime: (epochMs: number) => string;
  /** Date alone, for a library row older than a month. */
  date: (epochMs: number) => string;
}

export function intlFor(locale: string): Intlish {
  // These are not free to construct and the count lines render once per
  // resource group, so each catalogue builds its set once and keeps it.
  const rules = new Intl.PluralRules(locale);
  const number = new Intl.NumberFormat(locale);
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });

  return {
    plural: (n, forms) => forms[rules.select(n)] ?? forms.other,
    n: (value) => number.format(value),
    dateTime: (epochMs) => dateTime.format(epochMs),
    date: (epochMs) => date.format(epochMs),
  };
}
