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
 * `test/crypto.test.ts` is where it bit, because it is the one file that runs
 * under `@vitest-environment node`, where `navigator` is Node's own; under
 * jsdom it is jsdom's, which is always `en-US` whatever the host speaks. That
 * makes this a property of the *environment* rather than of those assertions,
 * so it is fixed once here rather than per assertion: a test written tomorrow
 * cannot forget to opt in, and none of them has to spell out which language it
 * expects.
 *
 * The mechanism is `stored()` in `src/i18n/index.ts`, which is consulted before
 * `navigator` and wins the moment it returns a locale. It reads
 * `localStorage.getItem`, so this block's whole job is to make that call answer
 * `"en"` — under jsdom, where a real `localStorage` exists, and under Node,
 * where it does not.
 *
 * Ordering is the precondition, not a detail: `locale()` memoises on its first
 * call, so a pin installed after some path had already resolved a language
 * would do nothing at all. `setupFiles` is what guarantees the order — vitest
 * runs this before the test file's module graph loads — and no module in `src/`
 * resolves a catalogue at import time, because `t()` is called at render time,
 * a rule this codebase already keeps so that a string cannot freeze in whichever
 * language was active when its module first loaded.
 *
 * What follows writes, reads the same key back, and installs a storage of its
 * own if the two disagree. That shape, rather than a `typeof localStorage`
 * check, is deliberate: the property worth holding is "the pin took effect",
 * and neither environment's storage is guaranteed to be the one this file
 * expects — Node grows a real `localStorage` under `--experimental-webstorage`,
 * jsdom can be configured without one, and a storage that throws on write and
 * one that silently accepts it and keeps nothing are indistinguishable from the
 * outside. Reading the value back answers all of them at once.
 */

const LOCALE_KEY = "jsonapi-lens:locale";

function createInMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
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

/** Does `localStorage` answer `"en"` for the locale key right now? A `getItem`
 * that throws is no better a host than a `setItem` that does, so it is asked
 * the same guarded way. */
function isPinned(): boolean {
  try {
    return globalThis.localStorage.getItem(LOCALE_KEY) === "en";
  } catch {
    return false;
  }
}

if (typeof globalThis.localStorage === "undefined") {
  globalThis.localStorage = createInMemoryStorage();
}

try {
  globalThis.localStorage.setItem(LOCALE_KEY, "en");
} catch {
  /* handled by the read-back below, uniformly with a silent no-op */
}

if (!isPinned()) {
  globalThis.localStorage = createInMemoryStorage();
  globalThis.localStorage.setItem(LOCALE_KEY, "en");
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
