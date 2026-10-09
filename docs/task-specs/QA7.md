# Task specification — QA7: follow-ups from QA6's reviews

> The contract the implementer builds to, the reviewer checks against, and QA verifies from.
> Source: the QA7 row in `docs/STATUS.md`, which collects what QA6's review rounds and the
> production QA of QA6 (`docs/qa-reports/prod-qa6.md`) deferred. **This spec was written by the
> implementer** (none existed). Six items, each independent of the others.

## Outcome

Copy, Download and Share also mask an unmistakable token in a response `Set-Cookie` name, in a body's
content type and inside any string of the provenance field `origin`; a query parameter and a
form-body parameter with the same name no longer share one DOM id; the hygiene test stops reading
gitignored process documents; a share page's four font requests send no `Referer`; and two
documents (`D8`, `D7`/REGRESSION §7) now say what the code does.

## Interface

- **S19** `secrets.ts#redactForExport` (the one function Copy, Download and Share call) additionally
  runs `sweepText` over: each response cookie's `name`; `body.contentType` of the request and of the
  response (any body kind; `raw` is still swept only for a clean form); every string **value** in
  `origin`, at any depth, including inside arrays. Each hit is replaced by `[REDACTED]` and counted
  in `count`. No new export; the result shape is unchanged.
- **S20** `ident.ts` exports `REQUEST_FIELD_KINDS` and `RequestFieldKind`; `requestFieldDomId` and
  `requestFieldHref` take a `RequestFieldKind`. New kinds `reqBodyParam` (form request body) and
  `resBodyParam` (form-shaped response body); `reqParam` stays the **query** kind with its spelling,
  so existing `#q_reqParam__…` links keep working. `render-request.ts#renderParamTable` takes the kind.
- **S21** `test/hygiene.test.ts` asks `git check-ignore --stdin -z` which of the files it reached are
  ignored and does not scan them. No list of ignored paths exists in the test.
- **P1** `public/_headers`: `/assets/*` detaches the inherited `Referrer-Policy` and sets
  `no-referrer`.
- **P2, P3** documentation only (`docs/DECISIONS.md` D8, D7; `docs/qa-checklists/REGRESSION.md`).

## Behaviour

- **S19 is the same sweep as before, in more places**: it finds a JWT, a Stripe key, an AWS key id,
  `Bearer`/`Basic`/`Token` plus a value, and a URL's `user:pw@`. It does **not** find a secret of no
  recognisable shape, and no document may say it does (README, D8, the share dialog's text are
  unchanged and already say "not complete"). A value already `[REDACTED]` is not counted twice. An
  `origin` object with a `__proto__`/`constructor`/`prototype` key has that key dropped, as before,
  and the sweep never writes to `Object.prototype`. An `origin` with nothing to sweep is returned as
  the same structure with the same values.
- **S20**: the query table mints `q_reqParam__<name>`, a request form-body table
  `q_reqBodyParam__<name>`, a response form-body table `q_resBodyParam__<name>`. A secret-named
  parameter row has no id (unchanged). A repeated name anchors only its first row.
- **S21**: a gitignored file is skipped; a tracked file is scanned even if its path matches an
  ignore pattern (git does not report tracked files as ignored); an untracked, non-ignored file is
  scanned. If `git` cannot be run, everything is scanned.
- **P1**: `/assets/*` responses carry exactly one `Referrer-Policy: no-referrer`. Pages, including
  `/`, `/view`, `/impressum`, `/privacy` and the 404, keep `strict-origin-when-cross-origin`; share
  routes keep the Worker's `no-referrer` (unchanged).
- **P2 (decision)**: D8 is aligned to the shipped behaviour — a clean form body in which nothing looks
  like a credential shows neither a count nor a note, whether or not redaction changed anything.
  **No behaviour change.**
- **P3 (decision)**: the API's `410` (expired, not yet swept) versus `404` (swept, or never existed)
  is accepted. "Indistinguishable" in REGRESSION §7 and D7 now says what is true: swept-expired and
  never-existed are one answer; an unswept expired share is answered `410` and the UI says "has
  expired". **No behaviour change**: the 410 discloses existence only, and ids are not secret.

## Error and edge cases

| Case | Expected |
|---|---|
| Response cookie named with a JWT | name becomes `[REDACTED]`, cookie row kept, count includes it |
| `body.contentType` = `application/json; token=Bearer abc` | `application/json; token=[REDACTED]`, `raw` of a JSON body untouched |
| Body with no `contentType` | no `contentType` key appears in the export |
| `origin` with `{ "text": "curl -H 'Authorization: Bearer abc' …", "n": 3, "ok": true, "x": null }` | only the string is rewritten; `3`, `true`, `null` stay |
| `origin` nested arrays of strings | each string swept |
| `origin` carrying `__proto__` | key dropped, `Object.prototype` unchanged |
| `?page=1` and body `page=2` together | ids `q_reqParam__page` and `q_reqBodyParam__page`; no duplicate `[id]` in the band |
| A name that looks like another kind's id (`reqBodyParam__page` under the query) | still distinct (`q_reqParam__reqBodyParam_005f_005fpage`) |
| Credential-named parameter | row has no id and no name text (unchanged) |
| A gitignored file under `docs/` containing an address or IP literal | not reported |
| The same text in a tracked docs file, or in `test/` | reported |
| `git` unavailable | every file scanned |
| `/assets/<css>`, `/assets/<font>.woff2` | one `Referrer-Policy: no-referrer` |
| `/`, `/view`, `/privacy` | `strict-origin-when-cross-origin`, unchanged |

## Out of scope

- A secret of no recognisable shape in any field; a token inside a URL path; JSON/text/multipart
  bodies (flagged, never parsed). All stay listed in D8's "does not catch".
- Sweeping `origin` **keys**, `unrecognized` Set-Cookie attribute names, or `elapsedMs`/numbers.
- Renaming `reqParam`. Changing the 410/404 behaviour. Changing the clean-form warning behaviour.
- The font `Referer` on any production host other than what `_headers` governs.

## Acceptance criteria

- [ ] `redactForExport` masks and counts a token embedded in a response cookie name, in a request and a
      response `body.contentType`, and in `origin` string values at depth, per `test/export-sweep-leaves.test.ts`.
- [ ] `requestFieldDomId("reqParam","page") !== requestFieldDomId("reqBodyParam","page")`, all
      `REQUEST_FIELD_KINDS` are distinct, and the rendered band for `?page=1` + `page=2` has unique ids.
- [ ] D1 states the closed `kind` set and extends its proof; the README/D8 do not claim more than the code.
- [ ] `test/hygiene.test.ts` does not scan a file `git check-ignore` reports, derives that from git, and
      has a fixture proving both directions.
- [ ] `public/_headers` `/assets/*` has `! Referrer-Policy` then `Referrer-Policy: no-referrer`; on
      `wrangler dev` the CSS and a font answer exactly one `Referrer-Policy: no-referrer`.
- [ ] D8's fail-closed paragraph agrees with `test/form-redaction.test.ts` (clean `a=1&b=2`: no note).
- [ ] D7 and REGRESSION §7 say what "indistinguishable" covers and why the 410 is accepted.
- [ ] No new user-facing string; `en`/`de`/`uk` untouched.

## Tests that must exist

- [ ] `test/export-sweep-leaves.test.ts`: Set-Cookie name, content type (and ordinary one untouched), origin at depth, same-reference/no-op, `__proto__`.
- [ ] `test/ident.test.ts`: kinds distinct, distinct ids over the hostile corpus, the query kind's spelling.
- [ ] `test/render-request.test.ts`: the colliding case through the real form, plus a response body.
- [ ] `test/hygiene.test.ts`: ignored fixtures skipped, tracked/untracked still scanned, git-unavailable scans all.
- [ ] `test/security-headers.test.ts`: the `/assets/*` block detaches then sets, one value, keeps the cache rule; `/*` unchanged.
- [ ] Negative (highest-severity concern): every sweep test asserts on `JSON.stringify` of the whole export, and no test paints a value through `innerHTML`; this task renders nothing new (the ids are attributes set through `el()`).
