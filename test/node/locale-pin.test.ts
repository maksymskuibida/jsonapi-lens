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
 *     tautology.
 *   - The pin is what answers it. A German `navigator` resolves to `de` with
 *     the pin lifted and to `en` with it in place, in the same process. The
 *     first half is the control: without it, "resolves to en" would pass on
 *     any English-speaking laptop whether or not `test/setup.ts` existed.
 *
 * The negotiator is re-imported for each case because `locale()` memoises on
 * its first call — a fresh module instance is the only way to ask it twice —
 * which is also why the pin has to be installed by `setupFiles` rather than by
 * any individual test.
 *
 * This file runs on plain Node and spawns a subprocess, so it is typechecked
 * by `test/node/tsconfig.json` rather than by the root program; see that file.
 */
import { spawn } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

const LOCALE_KEY = "jsonapi-lens:locale";

/** What `navigator.language` reports in a bare Node process run under `lang`. */
function bareNodeLanguage(lang: string): Promise<string> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, ["-e", "process.stdout.write(navigator.language)"], {
      env: { ...process.env, LANG: lang, LC_ALL: lang },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));

    const timer = setTimeout(() => {
      child.kill();
      rejectRun(new Error(`the ${lang} probe timed out. stderr so far:\n${stderr}`));
    }, 15_000);

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) rejectRun(new Error(`the ${lang} probe exited ${code}. stderr:\n${stderr}`));
      else resolveRun(stdout);
    });
  });
}

/**
 * Which language a freshly imported `src/i18n/index.ts` settles on, told that
 * the host speaks `languages` — and, when `pinned` is false, with the pin
 * lifted for the duration so the unguarded behaviour can be observed.
 */
async function negotiateUnder(languages: string[], { pinned }: { pinned: boolean }): Promise<string> {
  const saved = globalThis.localStorage.getItem(LOCALE_KEY);
  if (!pinned) globalThis.localStorage.removeItem(LOCALE_KEY);
  vi.stubGlobal("navigator", { language: languages[0], languages });

  try {
    vi.resetModules();
    const { locale } = await import("../../src/i18n/index.js");
    return locale();
  } finally {
    vi.unstubAllGlobals();
    vi.resetModules();
    if (saved !== null) globalThis.localStorage.setItem(LOCALE_KEY, saved);
  }
}

describe("the suite's locale pin", () => {
  it("positive control: LANG really does drive navigator.language in a bare Node process", async () => {
    // If this ever stops being true, every other test in this file passes for
    // the wrong reason — so it is asserted first and on its own.
    expect(await bareNodeLanguage("de_DE.UTF-8")).toBe("de-DE");
    expect(await bareNodeLanguage("uk_UA.UTF-8")).toBe("uk-UA");
  });

  it("is in place before any test file's modules are loaded", () => {
    expect(globalThis.localStorage.getItem(LOCALE_KEY)).toBe("en");
  });

  it("beats a German host language, which without it would win", async () => {
    expect(await negotiateUnder(["de-DE", "de"], { pinned: false })).toBe("de");
    expect(await negotiateUnder(["de-DE", "de"], { pinned: true })).toBe("en");
  });

  it("beats a Ukrainian host language, which without it would win", async () => {
    expect(await negotiateUnder(["uk-UA", "uk"], { pinned: false })).toBe("uk");
    expect(await negotiateUnder(["uk-UA", "uk"], { pinned: true })).toBe("en");
  });

  it("keeps src/crypto.ts's refusals in English, whatever the host speaks", async () => {
    // The regression itself, end to end and independent of this machine's own
    // LANG: a blob too short to be a document, refused through `t()`.
    vi.stubGlobal("navigator", { language: "de-DE", languages: ["de-DE", "de"] });

    try {
      vi.resetModules();
      const { open } = await import("../../src/crypto.js");
      const tooShort = new Uint8Array(4) as Uint8Array<ArrayBuffer>;

      await expect(open(tooShort, "whatever12")).rejects.toThrow(/corrupt/i);
      // …and not merely "does not say corrupt in German": `beschädigt` is the
      // word this exact message uses in `de.ts`.
      await expect(open(tooShort, "whatever12")).rejects.not.toThrow(/beschädigt/i);
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });
});
