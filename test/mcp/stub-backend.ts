/**
 * An in-memory stand-in for `src/worker.ts`'s two `/api/shares` routes, used
 * as the injected `fetchImpl` across the mcp/ test suite.
 *
 * Not a mock of individual calls — a small, stateful fake that actually
 * stores what it is `POST`ed and serves it back on `GET`, including 404 for
 * an unknown id and 410 for one whose (synthetic) expiry has passed. Real
 * enough that a round trip through it exercises the same shape of behaviour
 * the real Worker does, without ever reaching a network.
 */
import type { FetchLike, FetchInit, MinimalResponse } from "../../mcp/transport.js";

export interface StubBackend {
  fetchImpl: FetchLike;
  /** Every call this backend received, for asserting call counts (e.g. "no
   * retry") and that nothing was sent before validation ran. */
  readonly calls: ReadonlyArray<{ url: string; init: FetchInit | undefined }>;
  shareCount(): number;
  /** Force a share's expiry into the past, to exercise the 410 path without
   * waiting on a real clock. */
  expire(id: number): void;
}

/** Mirrors `LIFETIMES` in `src/worker.ts` closely enough for a test double:
 * only the durations, not the Worker's own validation of the key (this
 * backend is downstream of `mcp/validate.ts`'s own check in every real call
 * path, so an invalid key never reaches here in practice). */
const LIFETIME_SECONDS: Record<string, number | null> = {
  "15m": 900,
  "6h": 21600,
  "1d": 86400,
  "1w": 604800,
  "1m": 2592000,
  forever: null,
};

function jsonResponse(url: string, status: number, body: unknown): MinimalResponse {
  return {
    url,
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
    async arrayBuffer() {
      return new TextEncoder().encode(JSON.stringify(body)).buffer as ArrayBuffer;
    },
  };
}

function blobResponse(url: string, blob: Uint8Array<ArrayBuffer>): MinimalResponse {
  return {
    url,
    ok: true,
    status: 200,
    async json() {
      throw new Error("this response is a binary blob, not JSON");
    },
    async arrayBuffer() {
      return blob.slice().buffer;
    },
  };
}

export function createStubBackend(origin = "https://stub.example"): StubBackend {
  let nextId = 1;
  const shares = new Map<number, { blob: Uint8Array<ArrayBuffer>; expiresAt: number | null }>();
  const calls: { url: string; init: FetchInit | undefined }[] = [];

  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const parsed = new URL(url);
    if (parsed.origin !== origin) {
      throw new Error(`stub backend received a request for ${parsed.origin}, expected ${origin}`);
    }

    if (parsed.pathname === "/api/shares" && init?.method === "POST") {
      const lifetime = parsed.searchParams.get("lifetime") ?? "1d";
      if (!(lifetime in LIFETIME_SECONDS)) return jsonResponse(url, 400, { error: `Unknown lifetime "${lifetime}".` });
      const body = init.body;
      if (!body || body.byteLength === 0) return jsonResponse(url, 400, { error: "Empty body." });

      const seconds = LIFETIME_SECONDS[lifetime]!;
      const expiresAt = seconds === null ? null : Date.now() + seconds * 1000;
      const id = nextId++;
      shares.set(id, { blob: body, expiresAt });
      return jsonResponse(url, 200, { id, expiresAt, lifetime });
    }

    const match = /^\/api\/shares\/(\d+)$/.exec(parsed.pathname);
    if (match) {
      const id = Number(match[1]);
      const row = shares.get(id);
      if (!row) return jsonResponse(url, 404, { error: "not_found" });
      if (row.expiresAt !== null && row.expiresAt <= Date.now()) {
        shares.delete(id);
        return jsonResponse(url, 410, { error: "expired" });
      }
      return blobResponse(url, row.blob);
    }

    return jsonResponse(url, 404, { error: "Not found." });
  };

  return {
    fetchImpl,
    calls,
    shareCount: () => shares.size,
    expire: (id) => {
      const row = shares.get(id);
      if (row) row.expiresAt = Date.now() - 1;
    },
  };
}
