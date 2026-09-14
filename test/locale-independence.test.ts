import { describe, expect, it } from "vitest";

/**
 * D6 (docs/qa-reports/prod-baseline-2026-09-02.md): `npm test` must not
 * depend on the machine's own locale. It used to — `LANG=de_DE.UTF-8 npx
 * vitest run test/crypto.test.ts` failed 5 assertions, all of them regexes
 * matching English prose against a `ShareError` message built through `t()`.
 *
 * The app was not broken: it localised correctly. The tests were, because
 * Node has shipped a real `navigator` since v21, and unlike a browser's, its
 * `language`/`languages` mirror the *host's* locale rather than a fixed
 * value — `src/i18n/index.ts#locale` negotiates through exactly that
 * property when nothing more specific is present, which is always true in a
 * test. `test/setup.ts` now pins both properties to English for every test
 * file, node-environment ones (`crypto.test.ts`) included. This file guards
 * that pin directly, and stands in for having actually re-run the suite
 * under `LANG=C`, `de_DE.UTF-8` and `uk_UA.UTF-8` — which this task's
 * evidence also records doing by hand, since a single process cannot change
 * its own `LANG` mid-run to prove the point end to end.
 */
describe("the test suite's own locale", () => {
  it("navigator.language/languages are pinned to English regardless of the host's LANG", () => {
    expect(navigator.language).toBe("en-US");
    expect(navigator.languages).toEqual(["en-US"]);
  });
});
