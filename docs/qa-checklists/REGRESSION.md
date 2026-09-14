# Regression checklist

**Everything the app already did before this line of work started.** Run it in full twice per
release: once locally against the release candidate, and once against
`https://jsonapi.mstool.dev` after the deploy. Layout is the thing a build changes, and a build is
exactly what sits between those two runs.

Derived from `README.md`, the routes in `src/router.ts`, and the surfaces in `index.html`. **This
file grows: every defect that ever reached production earns a permanent row.**

Record results in the wave's QA report (`docs/qa-reports/wave-<n>.md`), not here.

---

## 1 · Getting a document in

- [ ] Paste a JSON:API document into the textarea → `Read document` renders it.
- [ ] `⌘/Ctrl + Enter` in the textarea does the same.
- [ ] The character count under the label updates as you type, and clears when emptied.
- [ ] Each of the five samples loads and renders: **Article feed · Single resource · Missing include · Error response · Awkward ids**.
- [ ] `Open a file` accepts a `.json` file.
- [ ] Dragging a file onto the drop zone loads it; the overlay appears on drag-enter and clears on drag-leave.
- [ ] Dropping a file **outside** the drop zone does not navigate the browser away from the app.

## 2 · Parse errors say something useful

Each must produce a readable headline and a hint — never a stack trace, never silence.

- [ ] Empty input.
- [ ] A Python `dict` repr (single quotes).
- [ ] A doubly-encoded document (a JSON string containing JSON).
- [ ] A bare array.
- [ ] A log line with JSON in the middle of it.
- [ ] Truncated JSON → the error names a line number.
- [ ] `{"data": {...}, "errors": [...]}` → refused as invalid JSON:API.

## 3 · The thing the tool exists for

- [ ] A relationship chip that resolves is a link; clicking it scrolls to that resource.
- [ ] A chip that resolves to nothing says **not in document**, in amber.
- [ ] `Back` returns **the content you were looking at, to the same place on screen.** Assert the content, not the offset — after a correct restoration the offset is often deliberately different because the layout underneath changed.
- [ ] `Forward` does the same in the other direction.
- [ ] A row that was expanded is still expanded after `Back` — **and still expands when clicked.** A pixel-perfect landing over a row that has stopped expanding has shipped here before.
- [ ] Copy a chip's link address, reload the page at that URL → it lands on the right section.
- [ ] Find-in-page (`⌘/Ctrl + F`) reaches text inside a collapsed resource.
- [ ] The `:target` flash fires on the landed section.

## 4 · Orientation

- [ ] Overview stats: shape, resources, types, included, relationships, size, index time.
- [ ] `data: null` → the null note appears.
- [ ] A meta-only document → the empty note appears.
- [ ] A document over 2 000 resources → the lazy-bodies note appears.
- [ ] Duplicate `type:id` → the duplicates stat appears, and only one section carries that DOM id.
- [ ] Rail: one row per type, with count and proportion bar; primary types lead.
- [ ] Rail `Only` filters to that type; `Show all types` clears it.
- [ ] With more than eight types, the rail's narrow-by-name box appears and filters.
- [ ] Unresolved-pointers panel lists each distinct missing identity once.
- [ ] Errors panel renders `status`, `code`, `title`, `detail`, `source.pointer`.
- [ ] Top-level `meta`, `links`, `jsonapi` render.
- [ ] `Referenced by` on an expanded resource lists what points at it.
- [ ] Group `Expand all` / `Collapse all` toggles every row in that group.

## 5 · Values

- [ ] Typed rendering is right for: `null`, empty string, boolean, number, ISO date, UUID, URL, plain string.
- [ ] A URL value is a link with `rel="noopener noreferrer"` and opens in a new tab.
- [ ] A nested object/array is a disclosure with a one-line preview and a key/item count.
- [ ] An empty object and an empty array say so.
- [ ] Humanised keys show the raw key alongside when they differ.
- [ ] `Copy path` yields the RFC 6901 pointer; `Copy value` yields the value.
- [ ] Copy on a whole object yields formatted JSON.

## 6 · Panels and shortcuts

- [ ] Raw view: `Copy JSON` and `Download`, and the size is shown.
- [ ] Jump modal via `/` and via `g`; typing filters; Enter navigates.
- [ ] `?` opens the shortcuts modal, with the right modifier key for the platform.
- [ ] `s` opens save; `Shift + Escape` leaves the document from anywhere, including out of a dialog.
- [ ] `Escape` closes a modal and returns focus sensibly.
- [ ] Library: save, list, open, rename, delete. The badge count is right.
- [ ] `New document` clears the current document and the textarea.
- [ ] `/` with a document open offers **Back to the document** rather than making you paste again.

## 7 · Share

- [ ] Create a link with a lifetime; the copy button works; the chosen lifetime is remembered.
- [ ] Opening the link loads the document **and replaces the history entry so the secret is not left in it.**
- [ ] A wrong or truncated secret → a readable failure, not an unhandled rejection.
- [ ] An expired link → the expired message. A never-existed id → the gone message. **The two are indistinguishable to the client, and must stay so.**
- [ ] **On production only:** use a synthetic document and the shortest lifetime. Never a real payload.

## 8 · Chrome, i18n, routes

- [ ] Theme toggle switches light/dark and survives a reload.
- [ ] Language switch to **Deutsch** and **Українська**: every visible string translated, plurals right, nothing clipped at 375 px.
- [ ] `?lang=de` selects the language; a stored choice survives a reload.
- [ ] `/impressum` and `/privacy` render; `/imprint`, `/legal`, `/datenschutz`, `/datenschutzerklaerung` reach the right page.
- [ ] `/` , `/view`, an unknown path, and a share path all resolve client-side with no server 404.
- [ ] `<title>`, canonical and robots are right per route, and the document view stops claiming to be indexable.
- [ ] `/api/health` returns `{"ok":true}`.

## 9 · Scale, storage, privacy

- [ ] Reload with a document open restores it from IndexedDB.
- [ ] A private window (storage blocked) still works — it just does not remember, and says so once.
- [ ] A document just over 2 000 resources: rows build on expand, and expanding is not visibly slow.
- [ ] **The network log carries no document content.** The only requests are the app's own assets, fonts, and an explicit share upload. Anything else is a critical finding.
- [ ] `node test/browser/run.mjs` (locally) and `--url https://jsonapi.mstool.dev` (after deploy) — every scenario passes, in a **visible, non-minimised, non-occluded tab**. A backgrounded tab makes all of them pass vacuously; confirm `document.visibilityState` reads `visible` first.

## 10 · Responsive and a11y

- [ ] 375 × 812 and 1440 wide, in both themes: no unreadable text, no overlap, and the page body never scrolls sideways.
- [ ] Wide content — tables, code, the raw view — scrolls inside its own container.
- [ ] Tab through the paste view and the document view: every interactive element reachable, with a visible focus ring.
- [ ] The console carries no unhandled error, and the network log no failed request, on any of the above.
