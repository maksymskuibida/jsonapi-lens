/**
 * The only server-side code in this project.
 *
 * It exists for one optional feature — share links — and it is deliberately
 * incapable of reading what it stores. The browser gzips the document, encrypts
 * it with a key it generates locally, and uploads the ciphertext. The key never
 * appears in a request body. This Worker sees an opaque blob, a byte count and
 * an expiry, and nothing else: no label, no type names, no filename.
 *
 * It also answers for paths that match no asset, which is every page this app
 * has apart from `/`. `not_found_handling` is `"none"` so those fall through
 * to this script rather than being answered `200 OK` with `index.html`
 * whatever they were: a single-page app still has a finite set of paths, and
 * `/nope` is not one of them. `parseRoute` — the same function the client
 * routes with — decides which, and the shell goes back under `200` or `404`
 * accordingly.
 *
 * `methodStatusForRoute` (`router.ts`) decides the method half of the same
 * question, for the same reason `parseRoute` is shared rather than
 * reimplemented: `POST`/`PUT`/`PATCH`/`DELETE`/`OPTIONS` on a page path get a
 * `405` (see `methodNotAllowed`), matching what the asset router already
 * does for every file-backed path on its own (N2, 2026-09-28).
 *
 * `referrerPolicyForRoute` (`router.ts`) is the same kind of shared decision for
 * the `Referrer-Policy` header: share routes get `no-referrer` in place of the
 * site-wide value, because a path-borne key would otherwise ride out in the
 * `Referer` of the page's own subresource requests (QA4). Nothing in this file
 * may log a URL, path, header or `Referer` — `wrangler.jsonc` turns Workers
 * Logs' invocation logs off for the same reason, and `test/worker.test.ts`
 * fails if a `console.*` call here starts to mention one.
 */

import {
  methodStatusForRoute,
  parseRoute,
  referrerPolicyForRoute,
  robotsTagForRoute,
} from "./router.js";
import { SECURITY_HEADERS } from "./security-headers.js";

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
  // `public/_headers` covers the static assets; nothing there reaches a
  // response this Worker builds itself, so these set their own.
  "x-content-type-options": "nosniff",
};

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
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
        error: `Encrypted document is ${(body.byteLength / 1048576).toFixed(1)} MiB, over the ${MAX_BYTES / 1048576} MiB share limit.`,
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
      "x-content-type-options": "nosniff",
      // `no-store`, matching every other `/api/` response and the promise
      // `robots.txt` already makes about this path.
      //
      // This used to be `private, max-age=60, must-revalidate`, on the
      // reasoning that ciphertext for a given id never changes. It does not
      // change, but it does get *deleted* — and the lazy expiry a few lines
      // above is what this file calls the thing that "actually guarantees an
      // expired link stops working on time". A minute of the visitor's own
      // cache is a minute in which a link that has expired, or been swept,
      // still opens. The guarantee is worth more than one avoided round trip
      // on the rare second open of the same link.
      "cache-control": "no-store",
      "content-length": String(object.size),
    },
  });
}

/**
 * Delete shares whose expiry has passed.
 *
 * This is only a storage tidy-up: `readShare` already deletes an expired share
 * the moment anyone asks for it, so a link stops working on time whether or not
 * this ever runs. It exists so blobs nobody returns to do not accumulate.
 *
 * It runs opportunistically on a small fraction of writes rather than on a cron
 * trigger, because the account is at Cloudflare's free-plan limit of five cron
 * triggers. `waitUntil` keeps it off the response path.
 */
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

/** Roughly one in every twenty-five share creations also sweeps. */
const SWEEP_PROBABILITY = 0.04;

/**
 * The `405` this Worker gives a non-GET/HEAD request for a page path (N2,
 * 2026-09-28). Every file-backed path (`/`, `/impressum`, every asset)
 * already answers this the same way, from the asset router itself, before
 * the request ever reaches this script — this is only for the paths that
 * have no file: `/view`, `/d/<id>`, and anything `unknown` would otherwise
 * (see `methodStatusForRoute`, `src/router.ts`, for why `unknown` never
 * reaches this function at all).
 *
 * `env.ASSETS.fetch`'s own `405` carries `public/_headers`' security headers
 * for free; this one builds its own response, so it has to set them by hand.
 * `SECURITY_HEADERS` (`src/security-headers.ts`) is what keeps those values
 * from being retyped here and drifting from `_headers` unnoticed.
 */
function methodNotAllowed(referrerPolicy: string | null): Response {
  const headers = new Headers();
  for (const [name, value] of SECURITY_HEADERS) headers.set(name, value);
  // QA4: a share route's response says `no-referrer`, whatever the status.
  // A 405 has no body and so issues no subresource request — the header is
  // inert here — but "every response for a share route carries it" is one
  // rule without an exception. Applied after `SECURITY_HEADERS`, which stays
  // a byte-for-byte mirror of `_headers` (`test/security-headers.test.ts`).
  if (referrerPolicy) headers.set("referrer-policy", referrerPolicy);
  headers.set("allow", "GET, HEAD");
  headers.set("content-length", "0");
  return new Response(null, { status: 405, headers });
}

/**
 * Serve the single page, under the status the path and method deserve.
 *
 * The asset router has already decided there is no file at this path, so the
 * shell is fetched by its own URL and re-wrapped. A `404` still carries the
 * whole app: the client reads the path, says which page does not exist and
 * offers the paste view, which is a better answer than a dead end — but it
 * says so under a status code that is true, so a crawler, a link checker and
 * `curl -f` are all told what a visitor can already see. A `405` (anything
 * but GET/HEAD, on a path that names a real page) carries no body at all —
 * see `methodNotAllowed`.
 */
async function serveShell(request: Request, env: Env): Promise<Response> {
  const route = parseRoute(new URL(request.url).pathname);
  const status = methodStatusForRoute(route, request.method);

  // `null` means "keep the site-wide policy the shell inherits" (QA4).
  const referrerPolicy = referrerPolicyForRoute(route);

  if (status === 405) return methodNotAllowed(referrerPolicy);

  // `/`, not `/index.html`: `html_handling` defaults to `auto-trailing-slash`,
  // which answers the explicit filename with a redirect to the directory form.
  const shell = await env.ASSETS.fetch(new URL("/", request.url));

  // If the shell itself could not be served there is nothing better to send;
  // pass the asset router's own answer through untouched.
  if (!shell.ok) return shell;

  const headers = new Headers(shell.headers);
  const robots = robotsTagForRoute(route);
  if (robots) headers.set("x-robots-tag", robots);
  // `set`, not `append`: the shell already carries `_headers`' policy, and
  // exactly one `Referrer-Policy` must leave this Worker (QA4).
  if (referrerPolicy) headers.set("referrer-policy", referrerPolicy);

  return new Response(shell.body, {
    status,
    headers,
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Anything that is not the share API reached this script because no asset
    // matched it, so it is a page path — or meant to be one.
    if (!url.pathname.startsWith("/api/")) return serveShell(request, env);

    if (url.pathname === "/api/shares" && request.method === "POST") {
      const response = await createShare(request, env);
      if (Math.random() < SWEEP_PROBABILITY) {
        ctx.waitUntil(
          sweep(env)
            .then((n) => n && console.info(`[jsonapi-lens] swept ${n} expired share(s)`))
            .catch((cause) => console.error("[jsonapi-lens] sweep failed", cause)),
        );
      }
      return response;
    }

    const match = /^\/api\/shares\/(\d{1,18})$/.exec(url.pathname);
    if (match && request.method === "GET") {
      return readShare(Number(match[1]), env);
    }

    if (url.pathname === "/api/health") {
      // QA4: answered every method with 200 before. GET is what the deploy
      // smoke test sends; HEAD is what an uptime probe may send.
      if (request.method === "GET" || request.method === "HEAD") return json({ ok: true });
      return json({ error: "Method not allowed." }, 405, { allow: "GET, HEAD" });
    }

    return json({ error: "Not found." }, 404);
  },

};
