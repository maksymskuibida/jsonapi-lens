/**
 * The one place in `mcp/` that calls `fetch`.
 *
 * `docs/PROCESS.md` §5 restricts client network access inside `src/` to
 * `store.ts`/`share.ts`/`crypto.ts` — that rule is about the browser app's
 * promise that *reading a document is local*, and `mcp/` is a separate
 * program a user runs deliberately to talk to the same API `share.ts` and
 * `main.ts` already do, over HTTP rather than from a tab. It still earns the
 * same discipline for the same reason: one seam, not `fetch` calls scattered
 * through the tool handlers, so every test that must not touch the real
 * deployment has exactly one thing to inject a stub for. Everything this
 * module sends and receives is described in `POST /api/shares` and
 * `GET /api/shares/<id>` in `src/worker.ts` — no new endpoint, no credential.
 *
 * `fetchImpl` is a required parameter everywhere in this module, with no
 * default. That is deliberate: it makes it a type error, not a discipline
 * problem, to construct a share/read handler without deciding what it talks
 * to — a test cannot forget to stub it, because omitting it does not compile.
 * `mcp/server.ts` is the one place that passes the real `fetch`.
 *
 * The dependency is a minimal structural interface, not the ambient
 * `Response`/`RequestInit` types — the narrowest surface this module actually
 * reads, so a test double is a plain object literal with no framework and no
 * cast.
 */

export interface MinimalResponse {
  readonly url: string;
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * `body` is pinned to a real-`ArrayBuffer`-backed `Uint8Array`, not the bare
 * `Uint8Array` (generic over `ArrayBufferLike`, which also covers
 * `SharedArrayBuffer`) — the same distinction `src/crypto.ts`'s own `Bytes`
 * alias exists for for the same reason: only the pinned form is assignable
 * to `BodyInit`.
 */
export interface FetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: Uint8Array<ArrayBuffer>;
}

export type FetchLike = (url: string, init?: FetchInit) => Promise<MinimalResponse>;

export interface CreatedShare {
  id: number;
  expiresAt: number | null;
}

/**
 * Refuse a response that arrived from a different host than the one asked
 * for. A malicious or misconfigured `origin` could redirect `/api/shares` (or
 * the read path) somewhere else entirely, and the default `fetch` behaviour
 * is to follow a redirect anywhere and hand back that response as if it were
 * the one requested. Checked before `.ok`/`.status`/the body are trusted at
 * all — a same-status, same-shape response from the wrong host is exactly
 * what a convincing redirect would produce. A response whose `url` is empty
 * (never true of Node's real `fetch`, only possible from a hand-built test
 * double) is passed through rather than treated as a mismatch.
 */
function assertSameOrigin(response: MinimalResponse, expectedOrigin: string): void {
  if (!response.url) return;
  const actualOrigin = new URL(response.url).origin;
  if (actualOrigin !== expectedOrigin) {
    throw new Error(
      `The request to ${expectedOrigin} was redirected to ${actualOrigin} — refusing to follow a ` +
        `redirect to a different host.`,
    );
  }
}

async function readErrorDetail(response: MinimalResponse): Promise<string | null> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === "string" ? body.error : null;
  } catch {
    return null;
  }
}

export async function uploadShare(
  fetchImpl: FetchLike,
  origin: string,
  blob: Uint8Array<ArrayBuffer>,
  lifetime: string,
): Promise<CreatedShare> {
  let response: MinimalResponse;
  try {
    response = await fetchImpl(`${origin}/api/shares?lifetime=${encodeURIComponent(lifetime)}`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: blob,
    });
  } catch (cause) {
    throw new Error(
      `Could not reach ${origin}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  assertSameOrigin(response, origin);

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(
      `The share could not be created (HTTP ${response.status})${detail ? `: ${detail}` : "."}`,
    );
  }

  const body = (await response.json()) as { id?: unknown; expiresAt?: unknown };
  if (typeof body.id !== "number") {
    throw new Error("The server accepted the upload but did not return an id.");
  }
  return { id: body.id, expiresAt: typeof body.expiresAt === "number" ? body.expiresAt : null };
}

/**
 * The two failure messages below are deliberately distinct from each other —
 * "gone or never existed" vs. "expired" — but each is deliberately the *same*
 * message regardless of which of its two causes applies (a 404 never existed,
 * or a 404 because the lazy-expiry sweep in `readShare` already deleted it):
 * the Worker's own response cannot tell those two apart, so naming one over
 * the other here would be a guess dressed as a fact.
 */
export async function fetchShareBlob(fetchImpl: FetchLike, origin: string, id: number): Promise<Uint8Array> {
  let response: MinimalResponse;
  try {
    response = await fetchImpl(`${origin}/api/shares/${id}`);
  } catch (cause) {
    throw new Error(
      `Could not reach ${origin}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  assertSameOrigin(response, origin);

  if (response.status === 404) {
    throw new Error(
      "That share is gone or never existed — it was either never created, or it has already been " +
        "deleted (including by its own expiry).",
    );
  }
  if (response.status === 410) {
    throw new Error(
      "That share link has expired. Share links are deleted once their lifetime runs out.",
    );
  }
  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(
      `The share could not be fetched (HTTP ${response.status})${detail ? `: ${detail}` : "."}`,
    );
  }

  return new Uint8Array(await response.arrayBuffer());
}
