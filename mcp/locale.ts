/**
 * Pin `src/i18n/index.ts` to English, deterministically, without touching it.
 *
 * `src/crypto.ts` reads every error string through `t()`, and `t()` picks a
 * catalogue by calling `locale()`, which negotiates in this order: `?lang=`
 * (needs `location`, which does not exist on Node), a remembered choice in
 * `localStorage`, then `navigator.languages`, then the English fallback.
 *
 * That third step is the trap. Node has shipped a built-in `navigator` global
 * since v21, and unlike a browser's, its `language`/`languages` reflect the
 * *host's* locale — `LANG=de_DE.UTF-8 node -e "console.log(navigator.language)"`
 * prints `de-DE`. So on a machine (or CI image, or contributor's laptop) whose
 * `LANG`/`LC_ALL` happens to be German or Ukrainian — the two languages this
 * app already ships — `locale()` would silently resolve to that catalogue, and
 * every refusal this server returns to the calling model would come back in
 * the wrong language. `crypto.ts` cannot be changed to avoid this (out of
 * scope for T7, and the coupling costs nothing once pinned), so this module
 * pins the *other* end instead.
 *
 * The mechanism is `stored()` in `src/i18n/index.ts`, which is checked before
 * `navigator` and takes priority the moment it returns a locale. It reads
 * `localStorage.getItem`, so this module's job is to make that call return
 * `"en"` — regardless of whether `localStorage` already exists, regardless of
 * what it already holds, and regardless of whether writing to it actually
 * works.
 *
 * Two gaps, both closed by the same read-back-and-verify shape rather than by
 * reasoning about which failure a given host's `localStorage` might have:
 *
 *   - An earlier version only installed a stand-in when `globalThis
 *     .localStorage` was `undefined`, on the assumption that plain Node never
 *     defines it. That assumption breaks under `--experimental-webstorage`
 *     (real Web Storage, unflagged in a future Node) or any MCP host that
 *     adds its own polyfill before this module runs — the guard skipped
 *     installing anything, and a real `localStorage` already holding, say,
 *     `"de"` from an earlier choice answered `stored()` before this module
 *     ever got a turn.
 *   - Even after making the write unconditional, a `localStorage` whose
 *     `setItem` throws (a quota, a read-only host implementation) or —
 *     harder to notice — silently accepts the call and changes nothing,
 *     both leave the pin unset without this module's own code necessarily
 *     seeing an exception to catch.
 *
 * So this does not attempt to enumerate every way a host's `localStorage`
 * could fail to hold a value. It writes, reads the same key back, and if the
 * two disagree — for any reason, including one no test here anticipated —
 * replaces `globalThis.localStorage` outright with an in-memory
 * implementation this module fully controls, which cannot fail in any of
 * these ways. The property verified is "the pin took effect", not "the write
 * call did not throw".
 *
 * Must be imported before anything that might call `t()` — i.e. first, at the
 * top of `server.ts`, of `build-server.ts` (in case something builds a server
 * without going through `server.ts` — a test does exactly this), and of every
 * test that exercises `src/crypto.ts`'s error text. `locale()` memoises on
 * its first call, so importing this late — after some other path has already
 * resolved a locale — would have no effect; that precondition is inherent to
 * memoisation, not a gap in this module, and is not worth defending against.
 */

const LOCALE_KEY = "jsonapi-lens:locale";

// `globalThis.localStorage` is already declared (as `Storage`) by the "DOM"
// lib `mcp/tsconfig.json` includes — see that file for why a Node-only
// program still carries it. So a stand-in, wherever one is installed below,
// fills in a real `Storage` rather than declaring a narrower type of its
// own, which TypeScript would reject as a conflicting redeclaration of the
// same global.
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

if (typeof globalThis.localStorage === "undefined") {
  globalThis.localStorage = createInMemoryStorage();
}

/** Does `localStorage.getItem(LOCALE_KEY)` actually answer `"en"` right now?
 * Wrapped for the same reason the write below is: a `getItem` that throws is
 * no better a host than a `setItem` that does, and both mean "not pinned". */
function isPinned(): boolean {
  try {
    return globalThis.localStorage.getItem(LOCALE_KEY) === "en";
  } catch {
    return false;
  }
}

try {
  globalThis.localStorage.setItem(LOCALE_KEY, "en");
} catch {
  /* handled by the read-back check below, uniformly with a silent no-op */
}

if (!isPinned()) {
  // Whatever is wrong with the host's localStorage — throws, no-ops, or a
  // failure mode nobody has seen yet — an implementation this module built
  // itself cannot have the same problem. Reassigning `globalThis
  // .localStorage` here, rather than trying to repair the existing one, is
  // deliberate: there is no way to distinguish these failure shapes from the
  // outside, and no need to.
  globalThis.localStorage = createInMemoryStorage();
  globalThis.localStorage.setItem(LOCALE_KEY, "en");
}
