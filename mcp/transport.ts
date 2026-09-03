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
  redirect?: "error" | "follow" | "manual";
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
 *
 * Every call below also passes `redirect: "error"`, which on a real `fetch`
 * makes a redirect anywhere — same host or not — reject before a response
 * ever exists to inspect. That makes the property this function polices true
 * by the request's own stated intent rather than by an accident of how
 * `undici` currently happens to fail a cross-origin `POST` redirect. This
 * function stays regardless: a hand-built test double, or any future
 * `fetchImpl` that is not `fetch` itself, is not bound by `redirect` at all.
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

/**
 * A thrown `fetch` failure, made readable. Node's real `fetch` (undici) wraps
 * the actual reason in `.cause` behind a generic outer message — every one of
 * a refused redirect, a refused connection, and a DNS failure surfaces as the
 * identical `TypeError: fetch failed`, with `unexpected redirect`,
 * `bad port`/`ECONNREFUSED`, or `getaddrinfo ENOTFOUND …` respectively sitting
 * one level down in `.cause`. Without unwrapping it, adding `redirect:
 * "error"` made the security property durable at the cost of making its own
 * failure indistinguishable from an unrelated outage — exactly the kind of
 * message this project's own rules call a `TypeError` about `undefined` in
 * spirit: technically thrown, practically undiagnosable.
 */
function describeFetchFailure(cause: unknown): string {
  if (!(cause instanceof Error)) return String(cause);
  const inner = (cause as { cause?: unknown }).cause;
  const innerMessage =
    inner instanceof Error ? inner.message : typeof inner === "string" ? inner : null;
  return innerMessage ? `${cause.message} (${innerMessage})` : cause.message;
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
      redirect: "error",
    });
  } catch (cause) {
    throw new Error(
      `Could not reach ${origin}: ${describeFetchFailure(cause)}`,
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
export async function fetchShareBlob(
  fetchImpl: FetchLike,
  origin: string,
  id: number,
): Promise<Uint8Array<ArrayBuffer>> {
  let response: MinimalResponse;
  try {
    response = await fetchImpl(`${origin}/api/shares/${id}`, { redirect: "error" });
  } catch (cause) {
    throw new Error(
      `Could not reach ${origin}: ${describeFetchFailure(cause)}`,
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
