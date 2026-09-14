/**
 * Pin the catalogue to English for the whole suite, before anything can call
 * `t()`.
 *
 * `src/i18n/index.ts` negotiates a language in this order: `?lang=` (needs
 * `location`), a remembered choice in `localStorage`, then
 * `navigator.languages`, then the English fallback. The third step is the trap.
 * Node has shipped a built-in `navigator` global since v21, and unlike a
 * browser's, its `language`/`languages` reflect the *host's* locale —
 * `LANG=de_DE.UTF-8 node -e "process.stdout.write(navigator.language)"` prints
 * `de-DE`. So on a machine, a CI image or a contributor's laptop whose
 * `LANG`/`LC_ALL` happens to be German or Ukrainian — the two languages this
 * app already ships — every assertion about English error text failed, and what
 * the suite reported depended on who ran it.
 *
 * It bit the test files that run under `@vitest-environment node`, where
 * `navigator` is Node's own; under jsdom it is jsdom's, which is hardcoded to
 * `en-US` whatever the host speaks. That makes this a property of the
 * *environment* rather than of the assertions it broke, so it is fixed once
 * here rather than per assertion: a test written tomorrow cannot forget to opt
 * in, and none of them has to spell out which language it expects.
 *
 * The mechanism is `stored()` in `src/i18n/index.ts`, which is consulted before
 * `navigator` and wins the moment it returns a locale. It reads
 * `localStorage.getItem(STORAGE_KEY)`, so this block's whole job is to make that
 * call answer `"en"` — under jsdom, where a real `localStorage` exists, and
 * under Node, where it does not.
 *
 * Ordering is the precondition, not a detail: `locale()` memoises on its first
 * call, so a pin installed after some path had already resolved a language
 * would do nothing at all. `setupFiles` is what guarantees the order — vitest
 * runs this before the test file's module graph loads. (Note that being *first*
 * is what does the work, not any promise that importing `src/` is side-effect
 * free: `src/main.ts` calls `applyDocumentLanguage()` at module scope, so
 * importing it would resolve a language immediately. No test imports it today,
 * and one that did would still be safe, because this has already run.)
 *
 * **To exercise another language in a test**, lift the pin rather than stubbing
 * `navigator` — `stored()` is consulted first, so a stub alone will silently
 * still answer English. `localStorage.removeItem(STORAGE_KEY)`, then
 * `vi.resetModules()` and re-import `src/i18n/index.js` to get past the memo;
 * `test/locale-pin.test.ts` does exactly this and is the worked example.
 */

import { STORAGE_KEY } from "../src/i18n/index.js";

/**
 * A `Storage` this file fully controls, for hosts that supply none.
 *
 * Keys and values are coerced with `String()` because the real thing does, and
 * a stand-in that stores a number where `Storage` would store `"1"` is a
 * difference tests could trip over. The one part of the interface not
 * implemented is the `[name: string]: any` index signature — real storage
 * answers `storage.foo` and `delete storage.foo` — because that needs a
 * `Proxy`, and nothing in `src/` or `test/` reaches a key that way.
 */
function createInMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(String(key)) ?? null,
    setItem: (key, value) => {
      values.set(String(key), String(value));
    },
    removeItem: (key) => {
      values.delete(String(key));
    },
    clear: () => {
      values.clear();
    },
    key: (index) => Array.from(values.keys())[index] ?? null,
    get length() {
      return values.size;
    },
  };
}

/**
 * Write the pin, then read it back — and say whether it took.
 *
 * Every access to `globalThis.localStorage` here is guarded, including the
 * existence check, because on some hosts the *accessor itself* throws — and
 * `typeof globalThis.localStorage` is enough to invoke it.
 * `node --experimental-webstorage` with no `--localstorage-file` is the
 * reachable case: the getter raises a `TypeError`, and an unguarded check here
 * took down every test file in the suite before a single test loaded, which is
 * the opposite of what a defensive pin is for.
 *
 * jsdom on an opaque origin (`about:blank`, a `file://` URL) throws a
 * `SecurityError` from the same accessor, but that one is beyond this file's
 * reach: vitest reads `window.localStorage` while assembling the environment's
 * globals, so the worker fails to start and nothing here runs. Under that
 * configuration only the two `@vitest-environment node` files survive at all.
 *
 * Read-back, rather than trusting the write, is the other half: a storage that
 * throws on `setItem` and one that silently accepts it and keeps nothing are
 * indistinguishable from the outside, and both mean "not pinned".
 */
function pinTook(): boolean {
  try {
    const storage: Storage | undefined = globalThis.localStorage;
    if (storage === undefined || storage === null) return false;
    storage.setItem(STORAGE_KEY, "en");
    return storage.getItem(STORAGE_KEY) === "en";
  } catch {
    return false;
  }
}

if (!pinTook()) {
  // Whatever is wrong with this host's storage — absent, throwing, or quietly
  // keeping nothing — one built here cannot have the same problem. Installed
  // with `defineProperty` rather than assignment, the same way the `CSS`
  // stand-in below is, because the property may already exist as a getter with
  // no setter, which a plain assignment would throw on in a module's strict
  // mode.
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: createInMemoryStorage(),
  });
  globalThis.localStorage.setItem(STORAGE_KEY, "en");
}

/**
 * jsdom does not expose `CSS.escape`, which `resourceSelector` uses. Rather
 * than weakening the production code with a fallback that would never run in a
 * browser, the spec algorithm is supplied here so the tests exercise the real
 * path.
 *
 * https://drafts.csswg.org/cssom/#serialize-an-identifier
 */
function escapeIdentifier(value: string): string {
  const string = String(value);
  let result = "";

  for (let i = 0; i < string.length; i++) {
    const code = string.charCodeAt(i);

    if (code === 0x0000) {
      result += "�";
      continue;
    }

    if (
      (code >= 0x0001 && code <= 0x001f) ||
      code === 0x007f ||
      (i === 0 && code >= 0x0030 && code <= 0x0039) ||
      (i === 1 && code >= 0x0030 && code <= 0x0039 && string.charCodeAt(0) === 0x002d)
    ) {
      result += "\\" + code.toString(16) + " ";
      continue;
    }

    if (i === 0 && code === 0x002d && string.length === 1) {
      result += "\\" + string.charAt(i);
      continue;
    }

    if (
      code >= 0x0080 ||
      code === 0x002d ||
      code === 0x005f ||
      (code >= 0x0030 && code <= 0x0039) ||
      (code >= 0x0041 && code <= 0x005a) ||
      (code >= 0x0061 && code <= 0x007a)
    ) {
      result += string.charAt(i);
      continue;
    }

    result += "\\" + string.charAt(i);
  }

  return result;
}

const existing = (globalThis as { CSS?: { escape?: (value: string) => string } }).CSS;

if (!existing?.escape) {
  Object.defineProperty(globalThis, "CSS", {
    configurable: true,
    writable: true,
    value: { ...existing, escape: escapeIdentifier },
  });
}
