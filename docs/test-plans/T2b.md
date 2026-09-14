# Test plan — T2b The form and the review

**What this task changes, in one paragraph.** A response stops being the whole story: a new form
(`src/request-form.ts`, a modal) lets you attach the request that produced it — method, URL, query
parameters, headers, cookies, body — plus the response's own status, headers, `Set-Cookie` entries,
elapsed time and body, all independently fillable. A band above the overview (`src/render-request.ts`)
shows a collapsed one-line summary and opens into a three-mode review (Response · Request · Both).
Request-scoped anchors (`q_`/`b_`/`d_`, per [D1](../DECISIONS.md)) are minted for the first time by
this task. Persistence goes through `store.ts`/`crypto.ts` unchanged, carrying `Exchange` end to end.

## Scope

- **In scope:** the form and its URL↔query sync; the band and three-mode review; header/cookie
  masking, click-to-reveal, and JWT decoding *display*; the parameter table's rendering of
  convention/alternatives/conflict; request-body rendering under `b_`/`d_`; redaction wiring for
  Copy and Download with an honest, non-overclaiming count; persistence of `Exchange` through
  `load`/`saveDocument`/`saveToLibrary`/library re-open/share-link re-open; the `q_`/`b_`/`d_`
  anchor scopes actually being minted and proved collision-free against the response in a rendered
  scenario (not just the abstract id-minting functions, which T1 already covers).
- **Out of scope, covered elsewhere:** the model, `mergeExchange`, the parameter decoder, header and
  cookie parsing, secret *detection* and JWT *decoding*, and `redactExchange` itself — all T2a,
  already tested in `test/{exchange,params,headers,cookies,secrets}.test.ts`. Importers (T3),
  request/response cross-checks (T4), and wiring the exchange into the *encrypted share link* — a
  known, flagged gap; see this PR's body and `docs/STATUS.md`'s T2 row for the exact follow-up,
  since `share.ts` is outside this task's assigned files.

## Cases

| # | Scenario | Expected | How verified |
|---|---|---|---|
| 1 | No request or response ever entered | The document view is byte-for-byte today's — no band, no segmented control | automated (vitest: `hasExchangeContent`) + QA by hand |
| 2 | Every form field filled by hand, saved | The review renders exactly what was entered; reopening the form pre-fills it | QA by hand (form UI has no automated interaction test — see "What this task does not attempt") |
| 3 | Request only, no response | Mode is `request`, no response section, no segmented control shown | automated (vitest: `effectiveMode`) |
| 4 | Response only (status/headers entered, no request) | Today's document view, plus a status/headers section; mode is `response` | automated (vitest: `effectiveMode`) |
| 5 | Both parts present | Mode defaults to `both`; the segmented control is shown and switches the view | automated (vitest: `effectiveMode`, `renderModeControl`'s output via `renderExchangeBand`) |
| 6 | Typing a query string into the URL field | The query table fills in, percent- and `+`-decoded for display | automated (vitest: `decodeQueryRows`) |
| 7 | Editing a query-table row | The URL field's query string rewrites itself | automated (vitest: `encodeQueryRows` composed with the sync handlers is exercised indirectly; the DOM event wiring itself is QA by hand — see below) |
| 8 | Disabling a query/header/cookie row, then re-enabling it before Save | The row's data survives the toggle; disabled rows are excluded from what is saved | QA by hand + automated (`encodeQueryRows` drops disabled rows, vitest) |
| 9 | Adding a header named `Cookie` (request) or `Set-Cookie` (response) with a value | The row's contents move into the cookie section; the header row disappears | QA by hand (DOM-event-driven; see "What this task does not attempt") |
| 10 | A request body that is JSON:API, sharing every `type`/`id` with the response | Full resource treatment under `b_`; renders and anchors with **no duplicate DOM id** | automated (vitest: D1 collision test in `test/render-request.test.ts`) |
| 11 | A request body that is plain JSON, sharing pointer text with a plain-JSON response | Full collection/identity treatment under `d_`; **no duplicate DOM id**, even from identical pointers | automated (vitest, same file) |
| 12 | A request body declared JSON but not parseable | Shown as text, with the parse error and its line | automated (vitest: `renderBodyPart`) |
| 13 | A request body that is `application/x-www-form-urlencoded` | Decoded and rendered as a parameter table, not attempted as JSON | automated (vitest: `renderBodyPart`) |
| 14 | `Authorization` header on arrival | Masked; a click reveals it; a second value's reveal never affects the first | automated (DOM structure + `REVEAL_ATTR` toggle logic in `render-request.test.ts`); the click itself is QA by hand |
| 15 | A `Bearer` JWT with `exp` in the past, response has a `Date` header | `sub`/`iss`/`scope`/`exp` shown; `exp` relative to the response's `Date`, marked expired | QA by hand (see "What this task does not attempt" — `decodeJwt` itself is T2a-tested; this is the display path) |
| 16 | A JWT that is not three base64url segments | Shown as an opaque masked value, not decoded, no error | QA by hand |
| 17 | Four `Set-Cookie` values on the response | Four cookie rows, each with its own parsed attributes | QA by hand (T2a's `parseSetCookie` is unit-tested; this is the render path) |
| 18 | A parameter with a comma-list reading | Shows the list, names "comma list", offers the plain-string alternative | automated (vitest: `paramRow` behaviour exercised via `renderBodyPart` on a form-urlencoded body) |
| 19 | `a=1&a[]=2` (conflicting encodings) | Both readings shown, named as a conflict, neither silently chosen | covered by T2a for the model; the *render* of a conflict row is QA by hand |
| 20 | An exchange carrying `Authorization`, Copy | Redacted JSON on the clipboard; a count is stated; a caveat about scope is always visible, not only after a redaction | automated (vitest: `redactedExchangeText`'s composition is exercised through `redactExchange`; the actual clipboard write is QA by hand) |
| 21 | Same, Download | Redacted JSON file; same count message | QA by hand (file download cannot be asserted in jsdom) |
| 22 | Same, sealed and reopened (the "must exist" test) | The secret does not appear anywhere in the decrypted, reopened payload | automated (vitest, Node environment: `test/exchange-redaction.test.ts`) |
| 23 | The same round trip **without** redaction | The secret **does** appear — proves case 22 can fail | automated (same file) |
| 24 | Hostile values (`<script>`, `"><img src=x onerror=alert(1)>`, `__proto__`, `constructor`, `prototype`) as a header name/value, a param name/value, a `type`/`id` | Rendered as text everywhere; `Object.prototype` is never polluted | automated (vitest: `test/render-request.test.ts`'s hostile-value suite, `test/request-form.test.ts`'s query-row suite) |
| 25 | `javascript:`/`data:` as the request URL | Never rendered as an `href`; shown as text | automated (vitest) |
| 26 | `http`/`https` as the request URL | Rendered as a real, clickable link; display text is the origin, `href` is the full URL | automated (vitest) |
| 27 | URL with no scheme (`api.example.com/x`) | Accepted, `https` assumed, the assumption shown | automated (vitest: `parseRequestUrl`) |
| 28 | URL that will not parse at all | Kept as text; a note explains why | automated (vitest: `parseRequestUrl`, `renderUrlBlock` via `renderExchangeBand`) |
| 29 | A partial exchange is saved, the page reloads | The exchange reloads from IndexedDB and the band reappears with what was there | QA by hand — `main.ts`'s boot/load paths are not unit-tested in isolation; see "What this task does not attempt" |
| 30 | A saved library entry carrying an exchange is reopened | The exchange comes back with the document | QA by hand |
| 31 | A share link minted before this change (a v2 payload with no `exchange`) | Opens exactly as it did before | covered by T2a/T5's existing suites (`mergeExchange`'s "absent" handling, `crypto.ts`'s version-2 path); unchanged by this task |
| 32 | The `q_`/`b_`/`d_` wrapper functions (`requestFieldDomId`, `requestResourceDomId`, `requestNodeDomId`) | Byte-identical to `mintAnchorId` in their scope; round-trip; never collide with `r_`/`g_`/`n_` | automated (vitest: `test/ident.test.ts`) |
| 33 | Browser: with the band **open**, follow a relationship in the response and press Back | The content returns to the same place on screen; the row that was expanded still expands when clicked | browser scenario (`test/browser/nav-scenarios.js`) |
| 34 | Browser: same, with the band **closed** | Same guarantee — the band's own height must not matter to the restoration | browser scenario |

**Altitude note.** Every id-minting and rendering-safety case above is `vitest`, because none of it
needs real layout. Cases 33–34 are the only ones that do, and they are the browser scenarios per
`docs/PROCESS.md` — `npm test` runs under jsdom, which has no layout engine and would pass a position
assertion vacuously.

**Do not mark a row "automated" unless the test genuinely exists.** Rows 2, 7 (the DOM event itself),
9, 14 (the click), 15–17, 19 (the conflict *render*), 20–21 (actual clipboard/file writes), 29–30 are
marked **QA by hand** deliberately: the underlying logic each depends on is unit-tested (T2a's
decoders, or this task's own pure functions), but the interactive DOM wiring — a `change` event
moving a row, an actual `navigator.clipboard` write, IndexedDB round-tripping through `main.ts`'s
boot sequence — is not exercised by a jsdom unit test in this PR. This is a real gap in automated
coverage, not an oversight to be quiet about; see `docs/qa-notes/T2b.md` for exact steps to exercise
each by hand, and the evidence file for what was actually observed doing so.

## Edge cases enumerated

**The form**

- Every field left blank: the exchange stays absent, not a present-but-empty object (`hasRequest`/
  `hasResponse` in the save handler gate on *added rows*, not on typed content, so opening the form
  and saving with nothing touched submits neither part).
- A field cleared out after having a value (URL, method, body): the group is still "touched" (a row
  or another field in it has content or existed), so the clear is saved as an explicit empty value,
  not silently ignored — `bodyFields`'s `read(force)` exists specifically so a cleared body is not
  indistinguishable from a body nobody ever looked at; see its own comment.
- A repeated header/cookie name in the review: only the first occurrence gets a `q_` anchor, so two
  same-named rows can never mint the same id; every row still renders.
- A query row's name carrying bracket syntax (`a[]`, `filter[status]`): preserved as typed and
  re-encoded verbatim, so the form can emulate any convention `decodeParams` recognises.

**Anchors — the case D1 exists for**

- A request-body JSON:API document and the response sharing every `type`/`id`: proved with a hostile
  corpus, not just a happy-path pair — see `test/render-request.test.ts`.
- A plain-JSON request body and a plain-JSON response sharing identical JSON Pointers: same proof,
  under `d_`/`n_`.
- A `type`/`id` deliberately shaped to look like another scope's own encoded output.

**Injection — every render path this task adds**

- `<script>`, `"><img src=x onerror=alert(1)>` in a URL, a header name, a header value, a param name,
  a param value, a request-body `type`/`id`/attribute value.
- **`__proto__`, `constructor`, `prototype`** in the same positions — the class of hostile value a
  markup-only corpus misses, called out explicitly because this release's decoder already had a live
  prototype-pollution defect of exactly this shape. This task's own code never assigns through an
  untrusted key onto a plain object (`Map`/`Set` throughout for anything keyed by payload data), and
  the test suite proves `Object.prototype` stays clean rather than merely asserting the rendered text
  looks right.
- `javascript:`/`data:` URLs: a scheme allowlist (`http`/`https`/`mailto`), not an escape.

**Redaction**

- The count Copy/Download report is stated as *what was found*, never as a completeness guarantee —
  a caveat about scope (headers/cookies only; body and URL are not scanned) is shown unconditionally
  next to the actions, not only after a redaction fires. This is deliberate: `secrets.ts`'s own
  redaction coverage is being widened in a parallel change, and a UI that only speaks in counts would
  otherwise read a `0` as "nothing to worry about" regardless of what the pass actually covers.
- The redact→seal→open round trip is proven against `crypto.ts`'s real primitives, with a paired test
  proving the same round trip **without** redaction leaks the secret — so the passing case is known
  to be capable of failing.

**Persistence and the privacy promise**

- A v2 IndexedDB record (no `exchange` field at all) opens as a response-only exchange — unchanged
  T5/T2a behaviour, not re-tested here.
- No network request carries exchange content. The only requests remain assets, fonts, and the
  opt-in share upload — which, per the known gap above, does not yet carry the exchange at all.

**Localisation**

- Every new string exists in `en`, `de` and `uk` under the `request` namespace; no English literal in
  a template; no `??` fallback. Ukrainian's four plural forms supplied for every count
  (`summaryParams`/`Headers`/`Cookies`, `redactedCount`, the relative-time `unit`).
- Every `t()` call in `render-request.ts`/`request-form.ts` is inside a function, never captured at
  module scope — checked by inspection, since there is no automated "no module-scope `t()`" gate in
  this codebase yet.

## What should NOT have changed

- **T2a's modules are untouched**: `exchange.ts`, `params.ts`, `headers.ts`, `cookies.ts`,
  `secrets.ts` carry no edits from this PR. `test/{exchange,params,headers,cookies,secrets}.test.ts`
  pass unchanged.
- **The response's own render path is unchanged.** `render-resource.ts` and `parse.ts#buildIndex`
  are not touched; `render-json.ts#buildAnnotations` and `json-index.ts#buildJsonIndex` each gained
  one optional, additive parameter defaulting to their existing behaviour, so every pre-existing
  caller and every pre-existing test (`test/json-index.test.ts`, `test/render-json.test.ts` if
  present, `test/render.test.ts`) is unaffected — confirmed by the full suite passing unchanged.
- **Back/Forward and fold-state restoration for the response's own resources.** The band uses an
  entirely disjoint class namespace (`.xband`, `.xrow`, `.xreqres`, ...) from `.res`/`.group`/
  `.res__d`, so `indexSections`/`openRowIds`/`applyOpenRows`/`applyFilter` — all of which query those
  specific classes — see none of the band's content at all. This is deliberate, not an oversight
  discovered by testing: see `render-request.ts`'s header comment.
- **A v2 share link and a v2 IndexedDB record** still open exactly as they did before this PR.

## What this task does not attempt

- **Automated interaction tests for the form's DOM event wiring** (the URL↔table sync's `input`
  listeners, the Cookie/Set-Cookie auto-move on a `change` event, an actual reveal click). The pure
  logic underneath each (`encodeQueryRows`/`decodeQueryRows`, `parseCookieHeader`/`parseSetCookie`
  already T2a-tested, the `REVEAL_ATTR` toggle) is unit-tested; the event wiring itself is exercised
  by the QA pass in `docs/qa-notes/T2b.md` and recorded in `docs/evidence/T2b.md`. Automating a
  modal's interactive form with vitest+jsdom (simulating focus, `dispatchEvent`, reading back
  rendered state) was judged lower value than the time it would cost relative to a documented,
  reproducible manual pass, given this PR's already large automated surface (86 new/changed test
  cases across four files). Flagged here rather than silently left off the plan.
- **Wiring the exchange into the encrypted Share link.** See the "known gap" note in this PR's body
  and `docs/STATUS.md`'s T2 row.
- **Reconstructing the exact final coverage of `redactExchange`.** T2a's redaction scope is being
  widened in a parallel change (URL fragments, `Set-Cookie` attributes); this task's copy and tests
  are written against `redactExchange`'s contract (a count of what it finds) rather than against
  today's exact coverage, so they do not need to change when that widening lands — only rebase.
