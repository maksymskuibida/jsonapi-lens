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
 * `localStorage`, which plain Node does not have at all — so providing a
 * minimal stand-in whose `getItem` answers `"en"` makes `locale()` resolve to
 * English on its first call, before `navigator` is ever consulted. This is not
 * exploiting an implementation detail: `stored()` is the module's own,
 * documented "a choice was remembered" path, and this is a Node-side value for
 * exactly that value 's browser equivalent.
 *
 * Must be imported before anything that might call `t()` — i.e. first, at the
 * top of `server.ts` and of every test that exercises `src/crypto.ts`'s error
 * text. `locale()` memoises on its first call, so importing this late (after
 * some other path has already resolved a locale) would have no effect.
 */

// `globalThis.localStorage` is already declared (as `Storage`) by the "DOM"
// lib `mcp/tsconfig.json` includes — see that file for why a Node-only
// program still carries it. So this fills in a real `Storage`, rather than
// declaring a narrower type of its own, which TypeScript would reject as a
// conflicting redeclaration of the same global.
if (typeof globalThis.localStorage === "undefined") {
  const values = new Map<string, string>([["jsonapi-lens:locale", "en"]]);
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
