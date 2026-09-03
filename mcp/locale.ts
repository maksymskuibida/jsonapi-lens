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
 * `"en"` — regardless of whether `localStorage` already exists.
 *
 * That "regardless" used to be a gap: an earlier version of this file only
 * installed a stand-in when `globalThis.localStorage` was `undefined`, on the
 * assumption that plain Node never defines it. That assumption breaks under
 * `--experimental-webstorage` (real Web Storage, unflagged in a future Node)
 * or any MCP host that adds its own polyfill before this module runs — the
 * guard would then skip installing anything, `stored()` would ask the *real*
 * `localStorage` for a key nobody ever wrote, get `null`, and fall through to
 * `navigator` exactly as if this module did not exist. So the fix is not to
 * guard more carefully; it is to stop treating "does a storage already exist"
 * and "is our key set in it" as the same question. A stand-in is installed
 * only when there is truly nothing there, but the write — `setItem` with our
 * own key — always happens, into whatever `localStorage` turns out to be.
 *
 * Must be imported before anything that might call `t()` — i.e. first, at the
 * top of `server.ts`, of `build-server.ts` (in case something builds a server
 * without going through `server.ts` — a test does exactly this), and of every
 * test that exercises `src/crypto.ts`'s error text. `locale()` memoises on
 * its first call, so importing this late — after some other path has already
 * resolved a locale — would have no effect.
 */

// `globalThis.localStorage` is already declared (as `Storage`) by the "DOM"
// lib `mcp/tsconfig.json` includes — see that file for why a Node-only
// program still carries it. So a stand-in, when one is needed, fills in a
// real `Storage` rather than declaring a narrower type of its own, which
// TypeScript would reject as a conflicting redeclaration of the same global.
if (typeof globalThis.localStorage === "undefined") {
  const values = new Map<string, string>();
  const storage: Storage = {
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
  globalThis.localStorage = storage;
}

// Unconditional — this is the fix for the gap the header comment describes.
// Wrapped in a try/catch for the same reason `src/i18n/index.ts`'s own
// `stored()` wraps its read: a `localStorage` that exists but throws on
// write (a quota, a read-only host implementation) is a real possibility
// this module cannot control, and `stored()` already tolerates that by
// falling through to `navigator`/English — the same fallback this module
// exists to preempt, so there is nothing further to do here if it happens.
try {
  globalThis.localStorage.setItem("jsonapi-lens:locale", "en");
} catch {
  /* see comment above */
}
