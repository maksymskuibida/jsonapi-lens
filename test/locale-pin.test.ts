// @vitest-environment node
/**
 * The locale pin in `test/setup.ts`, and the hazard it exists for.
 *
 * Without the pin, this suite's result depended on the `LANG`/`LC_ALL` of
 * whoever ran it: `src/crypto.ts` reads its refusals through `t()`, `t()` asks
 * `locale()`, and `locale()` consults `navigator.languages` — which on Node
 * (built-in since v21) reports the *host's* language rather than a browser's.
 * On a German or Ukrainian machine, the two languages this app ships,
 * `test/crypto.test.ts` failed — on assertions that read as claims about the
 * error text and were really claims about the runner's environment.
 *
 * Two things have to be true for the pin to be worth anything, and each gets
 * its own test below, because either one alone can be satisfied vacuously:
 *
 *   - The hazard is real. `LANG` genuinely changes `navigator.language` in a
 *     bare Node process — asserted against a real subprocess rather than
 *     described, so that a future Node which stopped doing this would fail
 *     *here*, loudly, instead of quietly turning every test below into a
 *     tautology. The spawn lives in `locale-probe.mjs`; see that file for why
 *     it is plain JavaScript.
 *   - The pin is what answers it. A German `navigator` resolves to `de` with
 *     the pin lifted and to `en` with it in place, in the same process. The
 *     first half is the control: without it, "resolves to en" would pass on
 *     any English-speaking laptop whether or not `test/setup.ts` existed.
 *
 * The negotiator is re-imported for each case because `locale()` memoises on
 * its first call — a fresh module instance is the only way to ask it twice —
 * which is also why the pin has to be installed by `setupFiles` rather than by
 * any individual test.
 */
import { describe, expect, it, vi } from "vitest";

import { hostLanguageUnder } from "./locale-probe.mjs";
import { en } from "../src/i18n/en.js";
import { STORAGE_KEY } from "../src/i18n/index.js";

/**
 * The pinned value, or null if there is no usable storage at all.
 *
 * Read through the same guard `test/setup.ts` uses, so that a host without a
 * working `localStorage` fails the assertions *about the pin* rather than
 * throwing a `TypeError` out of a helper — which is what a mutation test sees
 * when it removes the pin, and it should see the claim fail, not the harness.
 */
function pinnedLocale(): string | null {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

/**
 * Lift the pin (`null`) or put a value back, through the same guard.
 *
 * Tolerating a host with no usable storage matters for one specific reader:
 * whoever checks that these tests still fail when `test/setup.ts`'s pin is
 * removed. Without the pin the node environment has no `localStorage` at all,
 * and an unguarded `removeItem` here would make the two tests below die inside
 * the harness instead of failing the comparison they exist to make.
 */
function writePin(value: string | null): void {
  try {
    if (value === null) globalThis.localStorage?.removeItem(STORAGE_KEY);
    else globalThis.localStorage?.setItem(STORAGE_KEY, value);
  } catch {
    /* nothing to lift or restore on a host with no usable storage */
  }
}

/**
 * Which language a freshly imported `src/i18n/index.ts` settles on, told that
 * the host speaks `languages` — and, when `pinned` is false, with the pin
 * lifted for the duration so the unguarded behaviour can be observed.
 *
 * Everything that mutates shared state happens inside the `try`, so that a
 * throw anywhere cannot leave the pin lifted for the tests that follow.
 */
async function negotiateUnder(languages: string[], { pinned }: { pinned: boolean }): Promise<string> {
  const saved = pinnedLocale();
  try {
    if (!pinned) writePin(null);
    vi.stubGlobal("navigator", { language: languages[0], languages });
    vi.resetModules();
    const { locale } = await import("../src/i18n/index.js");
    return locale();
  } finally {
    vi.unstubAllGlobals();
    vi.resetModules();
    if (saved !== null) writePin(saved);
  }
}

describe("the suite's locale pin", () => {
  it(
    "positive control: LANG really does drive navigator.language in a bare Node process",
    async () => {
      // If this ever stops being true, every other test in this file passes
      // for the wrong reason — so it is asserted first and on its own.
      expect(await hostLanguageUnder("de_DE.UTF-8")).toBe("de-DE");
      expect(await hostLanguageUnder("uk_UA.UTF-8")).toBe("uk-UA");
    },
    // Two cold `node` starts share this budget; vitest's 5s default is tight
    // for that on a loaded runner, and a timeout here should report the
    // probe's own diagnostic rather than a generic one.
    20_000,
  );

  it("is in place before any test file's modules are loaded", () => {
    expect(pinnedLocale()).toBe("en");
  });

  it.each([
    ["German", ["de-DE", "de"], "de"],
    ["Ukrainian", ["uk-UA", "uk"], "uk"],
  ])("beats a %s host language, which without it would win", async (_name, languages, unpinned) => {
    expect(await negotiateUnder(languages, { pinned: false })).toBe(unpinned);
    expect(await negotiateUnder(languages, { pinned: true })).toBe("en");
  });

  it("keeps src/crypto.ts's refusals in English, whatever the host speaks", async () => {
    // The regression itself, end to end and independent of this machine's own
    // LANG: a blob too short to be a document, refused through `t()`.
    try {
      vi.stubGlobal("navigator", { language: "de-DE", languages: ["de-DE", "de"] });
      vi.resetModules();
      const { open } = await import("../src/crypto.js");
      const tooShort = new Uint8Array(4) as Uint8Array<ArrayBuffer>;

      // Against the catalogue rather than a retyped string, so this cannot go
      // vacuous if the copy is reworded — the assertion is "the English
      // headline", not "some words that happen to be English today".
      await expect(open(tooShort, "whatever12")).rejects.toThrow(
        en.shareErrors.corruptShort.headline,
      );
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });
});
