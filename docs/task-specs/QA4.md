# Task specification — QA4: follow-ups from QA3

> The contract the implementer builds to, the reviewer checks against, and QA verifies from.
> Contract level, not line level: say what must be true, never how to write it.

Four independent items, all found while reviewing QA3 (PR #27). Each has its own section below; none
depends on another. This spec was written by the implementer (none existed when the task started).

## Outcome

1. **Logs.** Opening a legacy `/d/<id>:<key>` link or a `%23`-encoded link no longer writes the key
   into Workers Logs. Per-request invocation logs (method + URL + request metadata) are switched
   off; the Worker's own `console.*` output and uncaught exceptions still reach Workers Logs.
2. **Referrer.** The page response for a share route carries `Referrer-Policy: no-referrer`, so the
   page's own subresource requests (module script, stylesheet, icons, manifest), which are issued
   before any app code can strip the key from the address bar, do not carry it in `Referer`.
3. **Toast.** Opening a shared document never says "stored in this browser" when the browser failed
   to store it. The exposed-key warning survives in that case.
4. **Health.** `/api/health` answers `GET` and `HEAD` as before and `405` (with `Allow: GET, HEAD`)
   to every other method.

## Interface

**1. `wrangler.jsonc`** — `observability` becomes
`{ "enabled": true, "head_sampling_rate": 1, "logs": { "invocation_logs": false } }`. Shape taken from
Cloudflare's Workers Logs documentation ("Invocation logs can be disabled in wrangler by adding the
`invocation_logs = false` configuration") and from `node_modules/wrangler/config-schema.json`
(`Observability.logs.invocation_logs: boolean`). `head_sampling_rate` is not touched. `logs.enabled: true`
is stated explicitly: wrangler's upload path sends `config.observability` as written (its
`normalizeObservability` only feeds the local-versus-remote config diff), so an omitted `logs.enabled`
would be left to Cloudflare's API default (review round 1, S3).

**2. `src/router.ts`** — new pure function
`referrerPolicyForRoute(route: Route): "no-referrer" | null`, next to `robotsTagForRoute`:
`"no-referrer"` for `share` and `share-damaged`; `null` (meaning: keep the site-wide policy the shell
inherits from `public/_headers`) for `paste`, `view`, `legal`, `unknown`.
`src/worker.ts#serveShell` applies it with `Headers.set("referrer-policy", …)` — replace, never
append — to (a) the page response and (b) the 405 response (decision below).

**3. `src/share-toast.ts`** (new, pure) — `shareOpenedToast(messages, { keyExposed, stored })`
returning `{ text, tone, durationMs? }`, choosing among four copies:
`share.opened`, `share.openedKeyExposed` (existing) and two new rows `share.openedNotStored`,
`share.openedKeyExposedNotStored`, in all of `en.ts`, `de.ts`, `uk.ts`. A fifth, `share.keyExposedOnly`
(the warning with no "opened" and no "stored"), via `keyExposedOnlyToast`, is for a bundle link and for a
`%23` link whose payload decrypted but did not parse (review round 1, S1 and S2).
`src/main.ts`: `load()` returns a result that says whether persistence succeeded (the
existing boolean is "document parsed"; it keeps that meaning for its other callers), and
`loadSharedDocument` picks the copy from it. The `toast.notStored` toast that `load()` shows stays
(it is the general "a reload will lose it" message) but is immediately replaced on screen by the share
toast that follows, so that toast must not contradict it — and the new not-stored copies therefore
repeat the not-stored fact and its consequence (a reload will lose it) themselves.

**4. `src/worker.ts`** — `/api/health`: `GET`/`HEAD` → `200 {"ok":true}` unchanged; any other method
→ `405`, `Allow: GET, HEAD`, the same JSON headers (`content-type`, `cache-control: no-store`,
`x-content-type-options: nosniff`). `/api/shares` and `/api/shares/<id>` are not touched.

## Behaviour

**1.** Config-level only. `serveShell` and the `/api/*` path log nothing that names a URL, a path, a
`Referer` or a header. The only `console.*` calls in `src/worker.ts` today are the sweep's fixed
strings and a caught error object; a hygiene test pins that no `console.*` call in `worker.ts`
mentions `request.url`, `url.pathname`, `.headers`, or `Referer`. What the operator gives up: the
per-request "GET /path 200" lines, and request metadata in Workers Logs, for **every** path — not only
share paths. Uncaught exceptions and `console.*` output stay. Cloudflare's own edge analytics (not
Workers Logs) are a separate pipeline and are unchanged; DECISIONS D7 says what that leaves.

**2.** Exactly one `Referrer-Policy` header per response. Share and share-damaged page responses
(`GET`, `HEAD`) carry `no-referrer`; `/`, `/view`, `/impressum`, `/privacy`, and unknown-path 404
responses carry `strict-origin-when-cross-origin`. `public/_headers` is unchanged (the site-wide
policy for assets and every non-share page).
*405 decision:* the 405 for a share route also carries `no-referrer`. A 405 has no body, so it issues
no subresource requests and the header is inert in practice; it is applied anyway because "every
response for a share route says no-referrer" is one rule with no exceptions, which is easier to state
and to test than a carve-out, and costs one `Headers.set`. `SECURITY_HEADERS` (the mirror of
`_headers`, guarded by `test/security-headers.test.ts`) is **not** changed and still equals `_headers`
byte for byte; the route-specific override is applied *after* it, so the drift test keeps its meaning:
it guards "the Worker's copy of the site-wide headers", and the override is deliberately outside that
copy.
A side effect worth knowing: the document keeps `no-referrer` for its lifetime, so its own later
`fetch` of `/api/shares/<id>` and any external link clicked from it send no `Referer`.

**3.** Copy chosen from `{keyExposed, stored}`: stored → existing two strings. Not stored → the
new "opened, but could not be stored here" copy; with `keyExposed`, the key warning is kept in full.
Tone stays `error` for exposed-key variants (longer duration as today). The share toast is shown after
`load()` resolves, so it replaces the `notStored` toast; the new copy therefore has to stand on its
own and say the document is *not* stored.

**4.** Method compared upper-case-insensitively (`Request.method` is already normalised for standard
methods). `HEAD` gets the same 200 headers with no body per the runtime.

## Error and edge cases

| Case | Expected |
|---|---|
| `GET /d/42`, `GET /d/42:AAAAAAAAAAAA`, `HEAD` of either | 200, one `Referrer-Policy: no-referrer` |
| `GET /d/42%23AAAAAAAAAAAA` (`%23` link) | 200, `no-referrer`; toast behaviour of QA3 unchanged |
| `GET /d/notanumber` (unknown → 404) | 404, `strict-origin-when-cross-origin` (not a share route) |
| `GET /`, `/view`, `/impressum` | `strict-origin-when-cross-origin`, unchanged |
| `POST /d/42` | 405, `Allow: GET, HEAD`, `no-referrer`, security headers, no body |
| `POST /view` | 405 as before, site-wide referrer policy |
| Share opened, IndexedDB unavailable, ordinary link | not-stored copy; never says "stored in this browser" |
| Share opened, IndexedDB unavailable, `%23` link | not-stored copy **plus** the exposed-key warning |
| Share opened, storage fine | exactly the QA3 copies |
| Share opened with a bundle payload, `%23` link | bundle import view; the `keyExposedOnly` warning (no "stored" claim: nothing is stored yet). A non-exposed bundle link shows no toast, as before |
| `%23` link, payload decrypts but does not parse | error card, plus the `keyExposedOnly` warning; no "opened"/"stored" claim |
| Ordinary link, payload decrypts but does not parse | error card only, as before |
| `POST/PUT/DELETE/PATCH/OPTIONS /api/health` | 405, `Allow: GET, HEAD`, JSON headers, body `{"error":"Method not allowed."}` |
| `GET`/`HEAD /api/health` | 200 `{"ok":true}`, as before (deploy smoke test) |
| `/api/shares`, `/api/shares/<id>` any method | exactly as before |
| `/api/nope` | 404 `{"error":"Not found."}`, as before |

## Out of scope

- Redacting or filtering Cloudflare's edge/HTTP logs (Logpush is Enterprise; D7 rejects it).
- Changing `head_sampling_rate`, or turning observability off entirely.
- Moving the key out of the path for legacy links; deleting exposed shares.
- A `Referrer-Policy` change on any non-share route, or in `public/_headers`.
- Any change to `/api/shares*` method handling.

## Acceptance criteria

- [ ] `wrangler.jsonc` sets `observability.logs.invocation_logs` to `false`, keeps `enabled: true` and `head_sampling_rate: 1`, and `wrangler deploy --dry-run` parses it.
- [ ] A test fails if a `console.*` call in `src/worker.ts` mentions `request.url`, `url.pathname`, `headers` or `Referer`, and a test fails if `wrangler.jsonc` loses `invocation_logs: false`.
- [ ] `referrerPolicyForRoute` returns `no-referrer` for `share`, `share-damaged`, and `null` for every other kind.
- [ ] Under `wrangler dev`, `curl -sD -` of `/d/42` and `/d/42:AAAAAAAAAAAA` shows exactly one `referrer-policy: no-referrer`; `/view` and `/` show exactly one `referrer-policy: strict-origin-when-cross-origin`.
- [ ] `test/security-headers.test.ts` passes unmodified in meaning.
- [ ] The bundle-link `%23` toast and the decrypted-but-unparseable `%23` toast use `share.keyExposedOnly`, in en/de/uk.
- [ ] `shareOpenedToast` returns a not-stored copy when `stored` is false, in en/de/uk, and the exposed-key copy still contains the `%23` warning when not stored.
- [ ] `en.ts`, `de.ts`, `uk.ts` each carry both new rows; typecheck passes.
- [ ] `POST /api/health` is 405 with `Allow: GET, HEAD`; `GET`/`HEAD` 200; deploy smoke test's check (`"ok":true` in `GET` body) still holds.
- [ ] `DECISIONS.md` D7's amendment records the logging channel as closed at config level and what the operator gives up.

## Tests that must exist

- [ ] `referrerPolicyForRoute` across every `Route` kind, including `/d/42%23KEY` (a `share` with `keyExposed`).
- [ ] A test that the Worker's page response for share routes has exactly one `Referrer-Policy` (drives `worker.ts` with a stub `ASSETS`), and that `/view` keeps the site-wide value.
- [ ] `shareOpenedToast` for all four `{keyExposed, stored}` combinations, in all three languages, including a negative assertion that not-stored copy does not contain the catalogue's "stored" claim.
- [ ] `/api/health` method matrix via the Worker `fetch` handler.
- [ ] Worker hygiene: no `console.*` in `worker.ts` interpolates URL, path, header or `Referer`; `wrangler.jsonc` has `invocation_logs: false`.
- [ ] Escaping test: the new toast copy is rendered through the existing toast path (text, not markup); the new strings contain no interpolation of payload data.
