/**
 * The only server-side code in this project.
 *
 * It exists for one optional feature — share links — and it is deliberately
 * incapable of reading what it stores. The browser gzips the document, encrypts
 * it with a key it generates locally, and uploads the ciphertext. The key never
 * appears in a request body. This Worker sees an opaque blob, a byte count and
 * an expiry, and nothing else: no label, no type names, no filename.
 *
 * Everything else on the site is served straight from static assets; only
 * `/api/*` reaches this script (see `run_worker_first` in wrangler.jsonc).
 */

// `Env` is generated from the bindings in wrangler.jsonc by `wrangler types`,
// so it cannot drift from the config.

/** Lifetimes the UI offers, in seconds. `null` means no expiry. */
const LIFETIMES: Record<string, number | null> = {
  "15m": 900,
  "6h": 21600,
  "1d": 86400,
  "1w": 604800,
  "1m": 2592000,
  forever: null,
};

/**
 * Ciphertext size cap. Documents are gzipped before encryption, so this is a
 * lot of JSON — roughly 100 MB of typical payload. It is here to keep a stray
 * upload from filling the bucket, not to constrain real use.
 */
const MAX_BYTES = 12 * 1024 * 1024;

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function blobKey(id: number): string {
  return `shares/${id}`;
}

async function createShare(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const lifetime = url.searchParams.get("lifetime") ?? "1d";

  if (!(lifetime in LIFETIMES)) {
    return json({ error: `Unknown lifetime "${lifetime}".` }, 400);
  }

  const body = await request.arrayBuffer();
  if (body.byteLength === 0) return json({ error: "Empty body." }, 400);
  if (body.byteLength > MAX_BYTES) {
    return json(
      {
        error: `Encrypted document is ${(body.byteLength / 1048576).toFixed(1)} MB, over the ${MAX_BYTES / 1048576} MB share limit.`,
      },
      413,
    );
  }

  const now = Date.now();
  const seconds = LIFETIMES[lifetime] ?? null;
  const expiresAt = seconds === null ? null : now + seconds * 1000;

  // Insert first so the id comes from the database rather than being guessed,
  // then write the blob under that id.
  const row = await env.DB.prepare(
    "INSERT INTO shares (created_at, expires_at, bytes) VALUES (?, ?, ?) RETURNING id",
  )
    .bind(now, expiresAt, body.byteLength)
    .first<{ id: number }>();

  if (!row) return json({ error: "Could not record the share." }, 500);

  try {
    await env.BLOBS.put(blobKey(row.id), body);
  } catch (cause) {
    // Do not leave a row pointing at a blob that is not there.
    await env.DB.prepare("DELETE FROM shares WHERE id = ?").bind(row.id).run();
    return json({ error: `Could not store the document: ${String(cause)}` }, 502);
  }

  return json({ id: row.id, expiresAt, lifetime });
}

async function readShare(id: number, env: Env): Promise<Response> {
  const row = await env.DB.prepare(
    "SELECT id, expires_at FROM shares WHERE id = ?",
  )
    .bind(id)
    .first<{ id: number; expires_at: number | null }>();

  if (!row) return json({ error: "not_found" }, 404);

  // Lazy expiry. The cron sweep is a backstop for shares nobody returns to;
  // this is what actually guarantees an expired link stops working on time.
  if (row.expires_at !== null && row.expires_at <= Date.now()) {
    await env.BLOBS.delete(blobKey(id));
    await env.DB.prepare("DELETE FROM shares WHERE id = ?").bind(id).run();
    return json({ error: "expired" }, 410);
  }

  const object = await env.BLOBS.get(blobKey(id));
  if (!object) return json({ error: "not_found" }, 404);

  return new Response(object.body, {
    headers: {
      "content-type": "application/octet-stream",
      // Ciphertext for a given id never changes, but it can be deleted, so let
      // the browser cache it briefly and revalidate.
      "cache-control": "private, max-age=60, must-revalidate",
      "content-length": String(object.size),
    },
  });
}

/** Delete shares whose expiry has passed. */
async function sweep(env: Env): Promise<number> {
  const { results } = await env.DB.prepare(
    "SELECT id FROM shares WHERE expires_at IS NOT NULL AND expires_at <= ? LIMIT 1000",
  )
    .bind(Date.now())
    .all<{ id: number }>();

  const ids = (results ?? []).map((r) => r.id);
  if (!ids.length) return 0;

  await env.BLOBS.delete(ids.map(blobKey));
  await env.DB.prepare(
    `DELETE FROM shares WHERE id IN (${ids.map(() => "?").join(",")})`,
  )
    .bind(...ids)
    .run();

  return ids.length;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Only `/api/*` is routed here; anything else means the config drifted.
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    if (url.pathname === "/api/shares" && request.method === "POST") {
      return createShare(request, env);
    }

    const match = /^\/api\/shares\/(\d{1,18})$/.exec(url.pathname);
    if (match && request.method === "GET") {
      return readShare(Number(match[1]), env);
    }

    if (url.pathname === "/api/health") {
      return json({ ok: true });
    }

    return json({ error: "Not found." }, 404);
  },

  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const deleted = await sweep(env);
    console.info(`[jsonapi-lens] swept ${deleted} expired share(s)`);
  },
};
