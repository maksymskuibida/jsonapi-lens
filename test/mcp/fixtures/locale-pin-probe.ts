/**
 * A tiny standalone program, run as a real subprocess by
 * `test/mcp/locale-pin.test.ts`, never imported directly by anything else.
 *
 * It exists because the locale pin (`mcp/locale.ts`) is a property of
 * *process-level* global state (`globalThis.localStorage`) and Node's own
 * `navigator.language`, which reflects the real `LANG`/`LC_ALL` the process
 * was started with. Neither of those can be varied per test case within one
 * running vitest process — `navigator.language` is fixed when Node's ICU
 * initialises at startup, not re-read later — so the only faithful way to
 * test "does a hostile host environment still get pinned to English" is to
 * actually start a fresh process with that environment.
 *
 * Deliberately imports `../../../mcp/build-server.js` and nothing from
 * `mcp/locale.js` directly, mirroring the exact gap the review found: a
 * caller that builds a server without going through `mcp/server.ts` must
 * still get the pin, because `build-server.ts` now imports `locale.js`
 * itself.
 *
 * Usage: `tsx locale-pin-probe.ts [flag]`, at most one of:
 *
 *   --pre-existing-storage       a working, empty `localStorage`, installed
 *                                before anything else is imported — a host
 *                                that already defines Web Storage, which the
 *                                pin used to skip entirely because it only
 *                                ever checked whether one existed at all.
 *   --pre-existing-de-storage    the same, but already holding `"de"` for
 *                                the locale key — the sharper version: this
 *                                one must be *overwritten*, not merely
 *                                tolerated.
 *   --throwing-storage           a `localStorage` whose `setItem` always
 *                                throws (a quota, a read-only host).
 *   --noop-storage               a `localStorage` whose `setItem` silently
 *                                accepts the call and changes nothing — no
 *                                exception for this module to catch at all.
 */

function workingStorage(initial?: Record<string, string>): Storage {
  const values = new Map<string, string>(Object.entries(initial ?? {}));
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

if (process.argv.includes("--pre-existing-storage")) {
  globalThis.localStorage = workingStorage();
} else if (process.argv.includes("--pre-existing-de-storage")) {
  globalThis.localStorage = workingStorage({ "jsonapi-lens:locale": "de" });
} else if (process.argv.includes("--throwing-storage")) {
  globalThis.localStorage = {
    ...workingStorage(),
    setItem: () => {
      throw new Error("quota exceeded (simulated)");
    },
  };
} else if (process.argv.includes("--noop-storage")) {
  globalThis.localStorage = {
    ...workingStorage(),
    setItem: () => {
      /* accepts the call, writes nothing — no exception to catch */
    },
  };
}

const { createMcpServer } = await import("../../../mcp/build-server.js");
const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");

// A too-short blob makes `open()` throw its own t()-backed "corrupt, too
// short" message directly — no real network, no valid ciphertext needed.
const fetchImpl = async (url: string) => ({
  url,
  ok: true,
  status: 200,
  json: async () => ({}),
  arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
});

const server = createMcpServer({ fetchImpl, defaultOrigin: "http://127.0.0.1:1" });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: "locale-pin-probe", version: "0.0.0" });
await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

const result = await client.callTool({ name: "read", arguments: { id: 1, secret: "a".repeat(64) } });
process.stdout.write(JSON.stringify(result));
await client.close();
