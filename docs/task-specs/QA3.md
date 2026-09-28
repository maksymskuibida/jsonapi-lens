# Task specification — QA3: encoded-fragment share links, and method 405s on page paths

> The contract the implementer builds to, the reviewer checks against, and QA verifies from.
> Contract level, not line level: say what must be true, never how to write it.

Two unrelated findings from the third production QA pass (2026-09-28, build `3a3679a`), grouped into
one task because both are small, both are routing-adjacent, and both touch `src/router.ts`.

## Outcome

**N3.** A share link whose `#` was rewritten to a percent-encoded `%23` before it reached the app —
by a URL sanitiser, a wiki renderer, a Markdown renderer, anything between sender and recipient —
now opens the document normally instead of being told "that share link is missing its key". The
visitor is told instead that this particular link's key already travelled in the open and should be
treated as compromised.

**N2.** A `POST`, `PUT`, `PATCH`, `DELETE` or `OPTIONS` request to `/view` or `/d/<id>` (or any page
path the Worker serves) now gets `405 Method Not Allowed` with `Allow: GET, HEAD`, instead of the
full page under `200`. The site no longer disagrees with itself about whether a page answers a
write method — every asset-backed path (`/`, `/impressum`, every file) already answered `405`; now
every page path does too.

## Interface

**N3** — `src/router.ts`:

- `Route`'s `share` variant gains an optional field: `keyExposed?: true`. Present and `true` only
  when the key was recovered from the pathname (the `%23` form below); absent — not `false`, not
  present at all — for every other share route, including the ordinary `#`-fragment form and both
  legacy in-path forms (`:`, `.`).
- `parseRoute` recognises a fourth shape for `/d/<digits>`, checked after the existing legacy-colon
  and fragment forms and before the `share-damaged` fallback: the **decoded pathname** itself
  containing `/d/<id>#<key>`, where `<key>` matches the same shape `SECRET_PATTERN` already
  requires (`[A-Za-z0-9_-]{8,64}`). A trailing slash is tolerated, matching every other `/d/<id>`
  form. On a match, returns `{ kind: "share", id, secret, keyExposed: true }`.

**N3** — `src/main.ts`:

- `loadSharedDocument` reads `route.keyExposed`. When true, it shows `t().share.openedKeyExposed`
  (a new toast, tone `"error"`) instead of the ordinary `t().share.opened`, for both a single
  document and a bundle payload. The existing behaviour that strips the key from the address bar
  (`navigate(VIEW_PATH, { replace: true })`) is unchanged and unconditional — it already runs before
  either payload kind is handled, and runs the same way regardless of `keyExposed`.

**N3** — `src/i18n/{en,de,uk}.ts`: a new `share.openedKeyExposed` string in all three catalogues.

**N2** — `src/router.ts`:

- A new pure function, `methodStatusForRoute(route: Route, method: string): 200 | 404 | 405`,
  alongside the existing `statusForRoute(route: Route): 200 | 404`. For `GET`/`HEAD` (any case), it
  returns exactly what `statusForRoute` would. For any other method, it returns `404` when
  `route.kind === "unknown"` and `405` for every other route kind.

**N2** — `src/security-headers.ts` (new file):

- Exports `SECURITY_HEADERS: ReadonlyArray<readonly [name: string, value: string]>` — the same
  `Referrer-Policy`, `X-Content-Type-Options`, `Content-Security-Policy` and `X-Frame-Options`
  values `public/_headers`' `/*` block sets, lower-cased header names.

**N2** — `src/worker.ts`:

- `serveShell` computes `methodStatusForRoute(route, request.method)`. When it is `405`, returns a
  `Response` with `status: 405`, no body, `Allow: GET, HEAD`, `Content-Length: 0`, and every header
  in `SECURITY_HEADERS`. Otherwise, behaviour is unchanged from before this task (the shell is
  fetched from `env.ASSETS.fetch` and re-wrapped under the status `methodStatusForRoute` — which for
  `GET`/`HEAD` is identical to the old `statusForRoute` — returns).
- `/api/*` is untouched: it has its own method handling (`request.method === "POST"` /
  `"GET"` checks in the `fetch` handler) and this task does not touch it.

## Behaviour

**N3.**

- The router only validates the **shape** of a key recovered from the pathname, exactly as it
  already does for the ordinary fragment and both legacy forms. Whether the key actually decrypts
  anything is decided later, by `fetchShare`/`crypto.ts`, down the same "could not be decrypted"
  path a normal share link's wrong key already reaches — `parseRoute` does not gain a new way to
  distinguish a wrong key from a right one, and must not try to.
- A double-encoded key (`%2523…`) decodes once (this function's existing single
  `decodeURIComponent` call, unchanged) to the literal text `%23`, not to a `#` character. It does
  not match the new branch and reaches `share-damaged`, the same as before this task.
- The toast in `main.ts` replaces, rather than supplements, the ordinary "opened" toast — the app
  shows one toast per share-open, as it always has; `keyExposed` changes which one.
- The `share-damaged` route and its message are unchanged for every genuinely keyless case: bare
  `/d/<id>`, `/d/<id>%23` with nothing after it, and `/d/<id>%23` followed by something that is not
  a valid key shape (too short, invalid characters).

**N2.**

- Only the Worker's **own** page-path responses are affected. A path with a real static asset
  (`/`, `/impressum`, `/privacy`, every file under `/assets`) never reaches `serveShell` for any
  method — the asset router answers those directly, including its own `405` for a non-GET/HEAD
  request, and that is unchanged by this task.
- `unknown` routes (`/nope` and similar) stay `404` for every method, not `405`. A path that names
  no page does not become "a page that merely disagrees with this verb" by trying a different verb
  on it — see Error and edge cases below for the reasoning spelled out as a case.
- The `405` response carries no body (`null`), `Content-Length: 0`, and `Allow: GET, HEAD` — nothing
  richer, matching the reference capture in the QA finding and the asset router's own empty-bodied
  `405`.
- `X-Robots-Tag` is not set on the `405` response — that header is only meaningful on a response a
  crawler might index, and a `405` is never one.

## Error and edge cases

| Case | Expected |
|---|---|
| `GET`/`HEAD` `/view`, `/d/<id>#<key>` | Unchanged: `200`, full shell (N2 does not touch this path). |
| `POST`/`PUT`/`PATCH`/`DELETE`/`OPTIONS` `/view` | `405`, `Allow: GET, HEAD`, empty body, all four security headers. |
| `POST`/`PUT`/`PATCH`/`DELETE`/`OPTIONS` `/d/42` (any key shape, even a damaged one) | `405` — the method check happens before key validity is even relevant. |
| Any non-GET/HEAD method on `/nope` (unknown path) | `404`, unchanged from today. |
| Any non-GET/HEAD method on `/api/shares` or `/api/shares/<id>` | Unchanged — `/api/*`'s own handling, untouched by this task. |
| `/d/30%23e4iDnHELrg` (valid key shape) | Opens the document. `keyExposed: true`. Key leaves the address bar exactly as an ordinary share link's does. |
| `/d/30%23e4iDnHELrg/` (trailing slash) | Same as above. |
| `/d/30%23` (nothing after) | `share-damaged`, ordinary "missing its key" message. |
| `/d/30%23short` (too short to be a real key) | `share-damaged`. |
| `/d/30%2523e4iDnHELrg` (double-encoded) | `share-damaged` — decodes once to a literal `%23`, not a `#`. |
| `/d/30%23AAAAAAAAAAAAAAAAAAAA` where the key is well-formed but wrong | Opens as `share`, `keyExposed: true`; downstream decrypt fails and the visitor reaches the existing "could not be decrypted" error, not the damaged-link one. |
| `/d/30` (bare, no key at all, no `%23`) | Unchanged: `share-damaged`. |
| `/d/30:AAAAAAAAAAAAAAAAAAAA` or `/d/30.AAAAAAAAAAAAAAAAAAAA` (legacy forms) | Unchanged: `share`, no `keyExposed` field at all. |
| A bundle payload opened via the `%23` form | Same `keyExposed` toast as a single document; the bundle import view renders normally underneath it. |

## Out of scope

- Changing what `shareUrl` mints. It still only ever produces the `#`-fragment form; `%23` is
  something this app tolerates on the way in, never produces.
- `/api/*` method handling — already correct, untouched.
- Backfilling the `STATUS.md`/task-spec gap between F3 and this task (PRs #22–#26). Noted as a
  pre-existing gap, not fixed here.
- A CI-enforced staleness check tying `SECURITY_HEADERS` to `public/_headers` at build time. The
  test suite catches drift; nothing generates one file from the other. If `public/_headers` grows a
  new security header later, `test/security-headers.test.ts`'s count assertion fails until
  `SECURITY_HEADERS` is updated to match — that is the intended mechanism, not a gap.

## Acceptance criteria

- [ ] `/d/<id>%23<key>` (valid key shape) opens the document; `/view` is in the address bar with no
      key anywhere in it, in the URL bar and in `history.state`'s serialised form.
- [ ] The visitor sees a distinct "this link's key was exposed" message for a `%23`-form open, in
      whichever of the three languages is active, and not the ordinary "opened a shared document"
      toast.
- [ ] `/d/<id>%23` (nothing after), `/d/<id>%23short`, `/d/<id>%2523<key>` and bare `/d/<id>` all
      still show the ordinary "missing its key" damaged-link message.
- [ ] `/d/<id>%23<well-formed-but-wrong-key>` reaches the existing "could not be decrypted" error.
- [ ] A non-GET/HEAD request to `/view` or `/d/<id>` (any form) returns `405`, `Allow: GET, HEAD`,
      empty body, and all four of `Content-Security-Policy`, `X-Content-Type-Options`,
      `X-Frame-Options`, `Referrer-Policy`, matching `public/_headers`' values exactly.
- [ ] The same non-GET/HEAD request to `/nope` still returns `404`.
- [ ] `GET`/`HEAD` behaviour on every path, and every `/api/*` method, is unchanged from before this
      task.
- [ ] `test/security-headers.test.ts` fails if `SECURITY_HEADERS` and `public/_headers`' `/*` block
      disagree on any name or value.

## Tests that must exist

- [ ] `parseRoute` accepts `/d/<id>%23<key>` (decoded to a literal `#` in the pathname) as `share`
      with `keyExposed: true`, including a trailing slash.
- [ ] `parseRoute` rejects the same shape with no key, a too-short key, and a double-encoded
      (`%2523`) key — all three still `share-damaged`.
- [ ] `parseRoute` never sets `keyExposed` on the ordinary `#`-fragment form or either legacy
      in-path form (a regression guard — this is the property N3 must not weaken).
- [ ] `methodStatusForRoute` agrees with `statusForRoute` for `GET` and `HEAD`, across every route
      kind, including case-insensitivity of the method string.
- [ ] `methodStatusForRoute` returns `405` for every non-GET/HEAD method on every route kind except
      `unknown`, which stays `404` under every method.
- [ ] `SECURITY_HEADERS` matches `public/_headers`' all-paths block byte for byte, both in the
      values present and in there being no extra or missing header.
- [ ] Manual (`wrangler dev --local`, not the Vite dev server — `/api/*` and the Worker are not
      served by `npm run dev`): a method table across `/`, `/view`, `/d/42`, `/nope` and
      `/api/health` confirming the `405`/`Allow`/security-header behaviour, and a real local share
      created and opened via its `%23` form.
