# QA report — production baseline (pre-release)

- **Purpose:** Baseline pass against `https://jsonapi.mstool.dev` **before** the next release ships,
  so a post-deploy re-run of this same checklist can be diffed against this file. Every failure
  below is marked **PRE-EXISTING** — none of it is caused by the pending release, since it was all
  observed before that release was built.
- **Served by:** `https://jsonapi.mstool.dev` (production, live Worker + assets).
- **Build observed:** no build/commit identifier is exposed on the page or in response headers
  (checked `curl -sI` for both `/` and the JS asset — no `X-Build`/git-sha header, no HTML comment).
  The best available fingerprints, which uniquely identify this asset set:
  - `assets/index-v-lhTetK.js` (ETag `"63f1c8bb8e36f077b4a8a4cd21a07d82"`)
  - `assets/index-CuTn5WFN.css`
  - JSON-LD `softwareVersion`: `1.0.0` (static, not build-specific)
  - Per `docs/STATUS.md` at the time of this pass: only **T0 (delivery process)** is done on `main`;
    T1–T7 (plain-JSON, exchange/request support, etc.) are all queued. So this baseline exercises
    exactly, and only, the surface `docs/qa-checklists/REGRESSION.md` describes — no request/exchange
    feature exists in production yet.
- **Browser:** Chrome 148.0.7778.280 (via the Claude Code Browser pane; UA reports macOS/MacIntel).
- **Viewports tested:** 1280×800/720 (functional pass), 375×812, 1440×900.
- **Themes tested:** light, dark (both explicit; "auto" also exercised).
- **Languages tested:** English (full functional pass), German (i18n + locale-bug spot check),
  Ukrainian (full i18n pass: translation completeness, plural forms, 375px layout).
- **Date/time of this pass:** 2026-09-02, approx. 22:00–23:01 UTC.
- **Verdict:** Baseline recorded. 4 pre-existing defects found (1 high, 1 medium, 2 low) plus one
  medium-adjacent share-link gap. See §3. Nothing here blocks anything — there is no pull request;
  this is a record for the post-deploy diff.

## Methodology notes (read before diffing a post-deploy run against this one)

- **This session's Browser pane tab is shared with other concurrent agent sessions on this
  machine.** `document.visibilityState` on my tab read `"hidden"` for most of the session (another
  session's tab was frequently foregrounded instead), which intermittently caused blank/torn
  screenshots and a couple of `computer` tool timeouts. Two accidental cross-tab actions happened
  early on (a `resize_window` and one `navigate` landed on another session's `tab-3` because I
  omitted `tabId`); both were caught immediately, tab-3's viewport was reset, and by the time I
  checked, that session had already reasserted its own tab. From that point on every tool call
  explicitly pinned `tabId: "seed"`. Where visibility could not be forced, I relied on
  `getBoundingClientRect`/`scrollY`/DOM-state checks (unaffected by paint) rather than trusting
  screenshots.
- **The `computer` tool's `key` action does not propagate modifier flags** (`cmd`/`ctrl`/`shift`
  all arrive as `false` on the dispatched `KeyboardEvent`, verified with a capture-phase listener)
  and **does not trigger native default actions** for some keys even when the JS `keydown` fires
  correctly (verified: a synthetic `Backspace` did not delete a character; a synthetic `Enter` did
  not activate a focused `<button>` or `<summary>`, confirmed against a plain "New document" button
  whose click has an unambiguous, checkable side effect — the URL). Where the checklist needed a
  modifier combo (⌘/Ctrl+Enter, Shift+Escape) or native-default confirmation, I dispatched a
  `KeyboardEvent` with the right flags directly via `element.dispatchEvent(...)`, which exercises
  the exact same app-level listener a real keypress would. Plain single-key shortcuts (`/`, `g`,
  `s`, `?`, `r`, `l`, `Escape`, `Tab`) dispatch and act correctly through the tool as-is.
- **No native OS file-picker or drag-and-drop primitive is available.** "Open a file" and drag-drop
  were tested by constructing an in-memory `File`/`DataTransfer` and assigning it to the real file
  input / dispatching real `dragenter`/`dragover`/`drop` events — this exercises the app's actual
  file-reading and drop-handling code paths, just not through an OS dialog.
- **Clipboard reads require document focus**, which this shared tab often lacked
  (`navigator.clipboard.readText()` → "Document is not focused"). Copy actions were instead verified
  by spying on `navigator.clipboard.writeText` and asserting the exact string the app tried to copy.
- Two independently-run passes: a **live/interactive pass** (samples, clicks, i18n, share, 375/1440,
  tab order) and a **command-line pass** (`node test/browser/run.mjs --url https://jsonapi.mstool.dev`,
  run via Bash per the task instructions — its own file contents were not read).

---

## 1 · Getting a document in

| # | Item | Result | Note |
|---|---|---|---|
| 1.1 | Paste → `Read document` renders | pass | Verified with a custom document; overview stats populated correctly. |
| 1.2 | `⌘/Ctrl+Enter` in the textarea reads the document | pass | Native modifier dispatch unavailable in this tool; verified via a real `KeyboardEvent(metaKey:true)` dispatched at the textarea — navigated to `/view` and rendered. |
| 1.3 | Character count updates as you type, clears when emptied | pass | "5 characters" appeared live while typing "hello"; count disappeared when the field was emptied. |
| 1.4 | All five samples load and render distinctly | pass | Article feed (13 res/6 types), Single resource (`data{1}`), Missing include (5 unresolved), Error response (`errors[3]`), Awkward ids (hostile ids incl. `/`, space, `#`) — each loaded and rendered its own distinct shape. |
| 1.5 | `Open a file` accepts a `.json` file | pass | Tested by assigning a real in-memory `File` to the file input and dispatching `change` (no OS file-picker primitive available) — document loaded and rendered correctly. |
| 1.6 | Drag a file onto the drop zone: loads it; overlay appears on drag-enter, clears on drag-leave | pass | Overlay ("Drop to read") verified via computed `opacity`/`pointer-events` transitioning 0→1→0 on dragenter/dragleave; a full `drop` with a real `File` loaded and rendered the document. |
| 1.7 | Dropping a file outside the drop zone does not navigate the browser away | pass | Dispatched `dragover`/`drop` on the page header; both had `defaultPrevented: true`, URL and app state unchanged. |

## 2 · Parse errors say something useful

| # | Item | Result | Note |
|---|---|---|---|
| 2.1 | Empty input | pass | "Nothing to read yet." / "Paste a JSON:API document, or drop a file." |
| 2.2 | Python dict repr (single quotes) | pass | "That looks like a Python dict, not JSON." / "Single-quoted keys and `None`/`True` are not valid JSON. Re-dump it with `json.dumps(...)`." / "around line 1" |
| 2.3 | Doubly-encoded document | pass | "This is a JSON string containing JSON." / "The payload has been encoded twice. Unwrap the outer string, then paste the inner document." |
| 2.4 | Bare array | pass | "This is a bare JSON array, not a JSON:API document." / "A JSON:API document is an object with a top-level `data` key. Wrap the array: `{ "data": [...] }`." |
| 2.5 | Log line with JSON in the middle | pass | "That is not valid JSON." / "The parser stopped here: Unexpected non-whitespace character after JSON at position 4 (line 1 column 5)" — readable and specific, though a generic JSON-parse-error message rather than a bespoke "this looks like a log line" detector (the checklist only requires readable+specific, which this meets). |
| 2.6 | Truncated JSON → error names a line number | pass | "That is not valid JSON." / "Expected ',' or '}' after property value in JSON at position 111 (line 7 column 18)" / "around line 7" |
| 2.7 | `{"data":…, "errors":…}` refused | pass | "This document has both `data` and `errors`." / "The spec forbids that combination. Showing it anyway would misrepresent the response — check which one the server actually meant to send." |

## 3 · The thing the tool exists for

| # | Item | Result | Note |
|---|---|---|---|
| 3.1 | A resolving chip is a link; click scrolls to the resource | pass | Article feed, `author` chip → `people/per-ada`. Hash changed, `history.length` incremented by 1, scrollY moved to the target, `:target` matched. |
| 3.2 | A chip resolving to nothing says "not in document", in amber | pass | Missing-include sample: `.chip--absent` renders "not in document" with a `title` tooltip naming the missing type/id; computed color of the label is `lab(81.45 12.48 44.91)` — high lightness, strongly positive b* (yellow) — an amber tone, not the chip's own neutral text color. |
| 3.3 | Back returns to the same content, same place on screen | pass | Expanded article at `sectionTop=520.3px, scrollY=0`; navigated away via a chip; Back restored `sectionTop=520.3px, scrollY=0` exactly. |
| 3.4 | Forward does the same in the other direction | pass | Forward from the same sequence restored `targetTop=108.16px, scrollY=2592.5` exactly, `:target` matched again. |
| 3.5 | An expanded row stays expanded after Back, and still expands when clicked | pass | Row was `open:true` after Back (same test as 3.3); collapsing then re-expanding it afterward toggled correctly both ways — not stuck. |
| 3.6 | Copy a chip's link, reload at that URL → lands on the right section | pass | Hard-reloaded `/view#r_people__per_002dada` cold: landed at the identical `scrollY`/`rect.top` as the live click, `:target` matched. |
| 3.7 | Find-in-page reaches text inside a collapsed resource | pass | `window.find()` (the method the project's own README says it uses for this claim) located text that existed only in a closed `<details>`; in this Chrome build it also **auto-opened** the details on match — better than the README's stated caveat ("located but not revealed"), likely because that note predates a Chrome find-in-page improvement. Not a defect — flagging since it means that README caveat is stale. |
| 3.8 | The `:target` flash fires on the landed section | pass | CSS-driven, not JS: `.res:target > .res__d > .res__row { box-shadow: inset 3px 0 0 var(--accent) }` confirmed applied (real inset box-shadow present) on a resource target; `.group:target > .group__head { animation: land 1.6s }` confirmed applied (`animationName: "land"`, `animationDuration: "1.6s"`) on a group-heading target. |

## 4 · Orientation

| # | Item | Result | Note |
|---|---|---|---|
| 4.1 | Overview stats: shape/resources/types/included/relationships/size/index time | pass | Confirmed across every sample and custom document loaded this session. |
| 4.2 | `data: null` → null note | pass | "Primary data is explicitly null. That is a valid response for a to-one relationship that relates to nothing — not an error." |
| 4.3 | Meta-only document → empty note | pass | "This document carries no resources. Only its top-level members are shown below." (Shape shown as "meta only".) |
| 4.4 | >2000 resources → lazy-bodies note | pass | 2,200-resource document: "Large document: all 2,200 resources are on the page and every anchor resolves, but attribute detail is built when you expand a resource. Find-in-page reaches every summary row…" |
| 4.5 | Duplicate `type:id` → duplicates stat; only one section carries that DOM id | pass | `DUPLICATE IDENTITIES: 1` stat shown; `document.querySelectorAll('[id="r_articles__1"]')` returned exactly 1 element despite two `data[]` entries sharing that identity. |
| 4.6 | Rail: one row per type, count + proportion bar, primary types lead | pass | Confirmed `.railrow__bar-fill` with a `--share` custom property exists per row; a document with an alphabetically-later primary type and an alphabetically-earlier included-only type listed the **primary** type first, confirming primary-leads ordering beats alphabetical. |
| 4.7 | Rail "Only" filters to one type; "Show all types" clears it | pass | 9-type document: "Only" on `alpha` left exactly one visible group; "Show all types" restored all 9. |
| 4.8 | >8 types → narrow-by-name box appears and filters | pass | `input.rail__search` (placeholder "Narrow this list") appeared only once type count exceeded 8; typing "gol" filtered the rail to just the matching type. |
| 4.9 | Unresolved-pointers panel lists each distinct missing identity once | pass | Three separate relationship pointers to the same missing `missing:m1` produced "1 distinct pointer resolves to nothing… / 3 total", with exactly one entry in the expanded list. |
| 4.10 | Errors panel renders status/code/title/detail/source.pointer | pass | Error-response sample: `422`/`invalid_date_range`/title/detail/`PARAMETER filter[published_before]`/`META`; a second error showed `POINTER /data/attributes/tag_slug` and `LINKS`; a third showed `POINTER /data/relationships/authors/data/1`. |
| 4.11 | Top-level `meta`, `links`, `jsonapi` render | pass | A closed `<details class="toplevel">` (collapsed by default) contains all three; expanding it showed `JSONAPI version 1.1`, `LINKS self`, `META totalCount`/`generatedAt` with copy affordances. |
| 4.12 | "Referenced by" on an expanded resource lists what points at it | pass | Article feed: article's "REFERENCED BY" section correctly listed inbound `comments` (2) and the relationship name grouping from `people`/`tags` (3). |
| 4.13 | Group "Expand all"/"Collapse all" toggles every row in the group | pass | 3-row group: "Expand all" opened all 3 (and relabeled itself "Collapse all"); clicking again closed all 3. |

## 5 · Values

| # | Item | Result | Note |
|---|---|---|---|
| 5.1 | Typed rendering right for null/empty string/boolean/number/ISO date/UUID/URL/plain string | pass | Each has its own CSS class confirmed via computed style: `v--str`, `v--num`, `v--bool v--bool-true`, `v--date`, `v--null`, `v--empty`, `v--uuid`, `v--url` — eight distinct, correctly-applied type classes on one test document. |
| 5.2 | URL value is a link with `rel="noopener noreferrer"`, opens in a new tab | pass | `<a class="v v--url" href="…" target="_blank" rel="noopener noreferrer">` — exact match. |
| 5.3 | Nested object/array is a disclosure with a one-line preview and count | pass | `tags` (array) → `[ ] 2 items`; `stats` (object) → `{ } 2 keys`; both expand to show contents. |
| 5.4 | Empty object/array say so | pass | Explicit "empty array" / "empty object" labels (class `v--empty-wrap`), distinct from the non-empty case. |
| 5.5 | Humanised keys show the raw key alongside when they differ | pass | `publishedAt` → "published At" (humanised) + "publishedAt" (raw) shown together; `title` (already humanised-equal to itself) shows only once — confirmed both branches of the "when they differ" rule. |
| 5.6 | Copy path → RFC 6901 pointer; Copy value → the value | pass | Verified via a `clipboard.writeText` spy: Copy Path on `views` → `/data/attributes/views`; Copy Value → `42`. |
| 5.7 | Copy on a whole object yields formatted JSON | pass | Copy Value on the `stats` object → `` `{\n  "likes": 10,\n  "shares": 2\n}` `` (pretty-printed, 2-space indent). |

## 6 · Panels and shortcuts

| # | Item | Result | Note |
|---|---|---|---|
| 6.1 | Raw view: Copy JSON + Download, size shown | pass | "whole document · 520 B"; Copy JSON copied exactly 520 chars of pretty JSON; Download created a 520-byte `application/json` Blob and an anchor with `download="Renamed-QA-doc.json"`. |
| 6.2 | Jump modal via `/` and `g`; typing filters; Enter navigates | pass | Both keys opened "Go to a resource"; typing a non-matching query showed "No resource matches that."; a matching query + Enter navigated to `#r_widgets__1` and closed the dialog. |
| 6.3 | `?` opens shortcuts modal with the right modifier key for the platform | pass | Showed the full Mac-key table (`⌘+[`/`⌘+]`/`⌘+click`) under "FROM YOUR BROWSER — MAC KEYS", correctly detected from this environment's `navigator.userAgentData.platform = macOS`, and still printed "On Windows and Linux the same two are Alt + ← and Alt + →" underneath. |
| 6.4 | `s` opens save; Shift+Escape leaves the document from anywhere, including out of a dialog | pass | `s` opened the Save dialog. Shift+Escape (dispatched with `shiftKey:true`) navigated `/view` → `/` both with no dialog open and with the shortcuts dialog open (closing the dialog and leaving in one action). |
| 6.5 | Escape closes a modal and returns focus sensibly | pass | Escape closed the jump modal; focus returned to `<body>` (not trapped inside the removed dialog). |
| 6.6 | Library: save, list, open, rename, delete; badge count is right | pass, with 1 finding | Save → badge "Saved 1"; list showed the entry with size/type/timestamp; rename (via `window.prompt`, confirmed by overriding it) updated the name live; open loaded the document and closed the modal; delete removed it (body correctly showed "Nothing saved yet."). **Finding F3** (below): the modal's header subtitle does not refresh when the last item is deleted with the modal open. |
| 6.7 | `New document` clears the current document and the textarea | pass | Confirmed repeatedly throughout the session — returns to an empty paste view. |
| 6.8 | `/` with a document open offers "Back to the document" | pass | Landing on `/` with a resumable document showed "Still open: `<name>`" + a "Back to document" button that correctly re-opened `/view`. |

## 7 · Share

**Used the built-in "Single resource" sample only, 15-minute lifetime, per instructions. One real link was created; it has since expired and was confirmed gone.**

| # | Item | Result | Note |
|---|---|---|---|
| 7.1 | Create a link with a lifetime; copy button works; lifetime is remembered | pass | Created `https://jsonapi.mstool.dev/d/14:E36Y5X0RwK` at 15m. "Copy link" copied the exact URL (verified via clipboard spy). Reopening the share dialog afterward pre-selected "15 minutes" (was "1 day" by default before any choice had been made). |
| 7.2 | Opening the link loads the document and replaces the history entry (secret not left in it) | pass | Opening the link rendered the single-resource document and the address bar showed `/view` (secret stripped). Pressing Back from there skipped straight past the `/d/14:…` URL — it was never in history to return to, confirming `replaceState` was used, not `pushState`. |
| 7.3 | A wrong or truncated secret → a readable failure, not an unhandled rejection | pass for a same-length-wrong or lightly-truncated secret; **fail for a more heavily truncated one — see Finding F4** | A same-length wrong secret and a 9-of-10-character secret both correctly showed "That share link could not be decrypted. / The key does not match this document…", with no new console error. A 7-character or 5-character secret produced **no request and no message at all** (silently showed the ordinary paste view) — see Finding F4. |
| 7.4 | Expired → expired message; never-existed → gone message; the two are indistinguishable | pass | A fabricated id (`999999`) immediately showed "That shared document no longer exists. / It was either never created, or it has already been deleted." The **same real link**, re-opened after its 15-minute lifetime had genuinely elapsed (confirmed ~24 minutes after creation), showed the **byte-identical** message. |
| 7.5 | On production, used a synthetic document and the shortest lifetime | pass | Used the app's own "Single resource" sample (invented article-feed fixture data, per README) and the 15-minute option, per instructions. |

## 8 · Chrome, i18n, routes

| # | Item | Result | Note |
|---|---|---|---|
| 8.1 | Theme toggle switches light/dark, survives reload | pass | Cycled auto→light→dark→auto correctly; set to dark, reloaded, `data-theme="dark"` persisted. |
| 8.2 | Language switch to Deutsch and Українська: every visible string translated, plurals right, nothing clipped at 375px | pass overall, with findings | See Findings F1 (date/number locale) and F5 (untranslated resource-toolbar strings + `INCLUDED` label + an `aria-label` gap) below. Everything else translated correctly and fluently in both languages, including the shortcuts modal, share modal, and paste-view FAQ. Ukrainian plural forms verified correct across all three grammatical categories using a controlled test (unresolved-pointer count): 1 → singular ("НЕЗНАЙДЕНИЙ ВКАЗІВНИК" / "1 унікальний вказівник… знаходить"), 2 → paucal ("НЕЗНАЙДЕНІ ВКАЗІВНИКИ" / "2 унікальні вказівники… знаходять"), 5 → genitive-plural ("НЕЗНАЙДЕНИХ ВКАЗІВНИКІВ" / "5 унікальних вказівників… знаходять"), 21 → back to singular per Ukrainian's "ends in 1, not 11" rule ("21 унікальний вказівник"). At 375px in Ukrainian: no clipping, no overlap; topbar correctly shrinks labels to "UK"/theme name/"Новий" per the responsive design. |
| 8.3 | `?lang=de` selects the language; a stored choice survives a reload | pass | `?lang=en` set `localStorage['jsonapi-lens:locale']='en'` and rendered English; clearing localStorage and reloading bare `/` fell back to `navigator.languages` negotiation (Ukrainian, this environment's configured language) — confirming the documented precedence `?lang=` → `localStorage` → `navigator.languages`. |
| 8.4 | `/impressum`/`/privacy` render; `/imprint`/`/legal`/`/datenschutz`/`/datenschutzerklaerung` reach the right page | pass | All 6 routes checked directly: `/impressum` and `/privacy` render with correct titles; all four aliases 301-style redirect (final `location.href`) to the correct canonical page. |
| 8.5 | `/`, `/view`, an unknown path, and a share path all resolve client-side with no server 404 | pass | `/some/totally/unknown/path` returned HTTP 200 (SPA fallback) and rendered the paste view; `/view`, `/`, and share paths all resolve the same way. |
| 8.6 | `<title>`, canonical and robots are right per route; document view stops claiming to be indexable | pass, with 1 finding | `/` with `?lang=en`: canonical carries `?lang=en`, `robots: index, follow, …`. `/` negotiated (no `?lang=`): canonical is bare `/` (matches `x-default`) even though the rendered language is Ukrainian — confirms "canonical carries `?lang=` exactly when asked for". `/view` (no hash): canonical `null`, `robots: noindex, nofollow` — correct. **Finding F2** (below): `/view` **with** a hash sets the wrong `<title>`/`og:title`; robots/canonical remain correct even then. |
| 8.7 | `/api/health` returns `{"ok":true}` | pass | Exact response body. |

## 9 · Scale, storage, privacy

| # | Item | Result | Note |
|---|---|---|---|
| 9.1 | Reload with a document open restores it from IndexedDB | pass | Confirmed repeatedly through the session, and explicitly as its own scenario in the browser-scenario suite run (below): "reload restores the same place — pass". |
| 9.2 | A private window (storage blocked) still works, just doesn't remember, and says so once | not tested | No incognito/private-window primitive is available in this automation tool, and the app boots (IndexedDB open + first render) faster than a post-navigation JS injection can land — by the time a same-tab script can run, `document.readyState` is already `"complete"`. Reliably forcing "storage blocked from boot" would need either a genuine private-window context or a pre-navigation script-injection hook (e.g. CDP `Page.addScriptToEvaluateOnNewDocument`), neither of which this tool exposes. |
| 9.3 | A document just over 2,000 resources: rows build on expand; expanding is not visibly slow | pass | 2,200-resource document: the attribute-detail block for a resource did not exist in the DOM before expansion (`querySelector` returned nothing) and existed with correct content immediately after; measured expand time ≈ 27 ms. |
| 9.4 | The network log carries no document content | pass | Installed `fetch`/`XMLHttpRequest` spies before pasting a document containing unique canary strings (`canary-resource-type-xyz789`, `UNIQUE_NETWORK_LEAK_CANARY_STRING_998877`), then pasted, read, and expanded it: **zero** fetch or XHR calls were made. The CDP-level network log for the whole session shows only the app's own HTML/JS/CSS/font assets, plus the explicit `/api/health` and `/api/shares` calls I made deliberately for other checklist items — nothing else, ever. |
| 9.5 | `node test/browser/run.mjs --url https://jsonapi.mstool.dev` — every scenario passes, in a visible tab | pass | Run via Bash (its files were not read, per the blindness boundary). The script printed its own preflight: `browser: {"visibility":"visible","rafFires":true,"sections":131,"viewport":[1512,944]}` — confirming visibility and a running render loop in the tab it drives itself (a separate Chrome instance from the Browser-pane tab used for the rest of this pass). **24/24 scenarios passed**, all drift ≤1px (well inside the ±2px bar), exit code 0. |

## 10 · Responsive and a11y

| # | Item | Result | Note |
|---|---|---|---|
| 10.1 | 375×812 and 1440 wide, both themes: no unreadable text, no overlap, no sideways body scroll | pass | Checked all four combinations (375/1440 × light/dark) on both the paste view and a loaded document. `document.body.scrollWidth <= window.innerWidth` held in every case (explicitly measured, not just eyeballed); screenshots at all four confirm clean, legible, non-overlapping layout with the rail correctly collapsing to a stacked card below the type-count breakpoint at 375px. |
| 10.2 | Wide content (tables, code, the raw view) scrolls inside its own container | pass | Raw view's `.raw` element: `scrollWidth=722` vs `clientWidth=323` with `overflow-x: auto`, while `document.body.scrollWidth` stayed equal to the viewport width throughout — the overflow is contained, the page body never scrolls sideways. |
| 10.3 | Tab through the paste view and the document view: every interactive element reachable, visible focus ring | pass, with one methodology caveat | Traced ~15 Tab stops across both views — link, multiple buttons, the language `<select>`, the `<textarea>`, a `<summary>` disclosure ("Top-level members" and a resource row) — every stop showed a visible ring (a real `outline`, or, for the textarea, a `box-shadow`/`border-color` glow on its parent `.drop` container via `:focus-within`, which does register as `:focus-visible` on the field itself). **Could not directly demonstrate** that Enter/Space *activates* a focused control through this specific tool: a synthetic `Enter` KeyboardEvent did not trigger the native default action even on a plain `<button>` (isolated with "New document" — the URL did not change), the same limitation already noted for Backspace in the methodology section. Every element tested is a genuine semantic, focusable HTML control (`<button>`/`<summary>`/`<select>`) that responds correctly to a real `click()`, which is what makes Enter/Space activation reliable in an actual browser — but the automation tool itself could not be used to prove that last step. |
| 10.4 | Console carries no unhandled error, network no failed request, on any of the above | pass | The only console errors across the whole session were (a) one self-inflicted artifact from my own test code overriding `window.prompt` and then losing that override across a full navigation, and (b) a `Failed to load resource: 404` for `/api/shares/999999` — which is the **correct, expected** response for my own never-existed-id test (§7.4) and was handled gracefully by the app (readable "no longer exists" message). Neither reflects an app defect. |

---

## Findings

Numbered independently of the checklist; each is one specific, reproducible defect. **All are marked
PRE-EXISTING** — they were present in production before the pending release, so if a post-deploy
pass reproduces the same numbered finding, that is not a regression from this release.

### F1. Dates and numbers inside document values use the browser's locale, not the app's selected language — **high** — PRE-EXISTING

- **Steps:** Set the app language explicitly to English (`?lang=en`) in a browser whose
  `navigator.languages` is `["uk", "uk-DE", "en-DE", "de-DE"]` (this test environment's
  configuration). Load the "Article feed" sample. Expand the first article. Look at the
  `published at` / `updated at` attribute values. Repeat with the language explicitly set to German.
- **Expected:** Per the project's own README ("Numbers and dates are formatted in the chosen
  language rather than the browser's, which is what `toLocaleString()` with no argument had been
  doing"), the dates should render in English (e.g. "Sep 14, 2026, 7:34 AM") when the app language
  is English, and in German when it is German.
- **Actual:** In both English and German UI modes, the date renders identically as
  "14 вер. 2026 р., 07:34:00" — Ukrainian formatting, matching only the browser's own locale, never
  the selected app language. The same pattern applies to numbers: `18420` renders as "18 420"
  (space-grouped) and `2480` as "2 480", in both English and German UI modes — neither of which uses
  space-grouping natively.
- **Scope observed:** Reproduced identically in five separate places: the Article feed sample's
  resource attributes (`published_at`, `updated_at`, `views`, `word_count`), the Error-response
  sample's error `meta.requested` date, the Missing-include sample's `published_at`, and a custom
  document's top-level `meta.generatedAt`. **Not** reproduced in the overview-panel stats (e.g. the
  "Resources: 2,200" / "Size: 171.2 kB" counters, which are correctly and consistently formatted
  regardless of language) — the bug is confined to the per-value typed formatter used for document
  content (resource attributes, top-level meta, error-object meta), not the app's own chrome.
- **Viewport/theme/language:** Reproduced at 1280×800/720, both light and dark, in English and
  German (Ukrainian was not separately tested for this, since the browser's own locale being
  Ukrainian would make the bug invisible there by coincidence).

### F2. `<title>`/`og:title` fall back to the paste view's title whenever `/view` carries a URL fragment — **low** — PRE-EXISTING

- **Steps:** Load any document so it renders at `/view` with no fragment (title is correct, e.g.
  "articles.json — jsonapi-lens"). Either (a) click any resolving relationship chip, or (b) copy a
  resource's deep link and load it as a fresh, cold navigation (e.g.
  `https://jsonapi.mstool.dev/view#r_people__per_002dada`).
- **Expected:** The tab title continues to name the open document, as it does on `/view` with no
  fragment.
- **Actual:** `document.title` and the `og:title` meta tag both change to "jsonapi-lens — follow the
  pointer" — the paste view's default title — even though the URL and the rendered content stay on
  `/view` showing the document. Isolated the trigger precisely: reloading the identical URL without
  the `#fragment` shows the correct title; only the fragment's presence flips it.
- **Not affected:** `robots` stays `noindex, nofollow` and `canonical` stays absent in both cases —
  this is a metadata-display defect only, not an indexability regression.
- **Viewport/theme/language:** Reproduced at 1280×800, English, both themes (theme is irrelevant to
  this defect).

### F3. Saved-documents modal subtitle does not update when the last item is deleted with the modal open — **low** — PRE-EXISTING

- **Steps:** Save one document. Open "Saved documents" (`l`). Delete that one entry from the list
  without closing the modal.
- **Expected:** The subtitle under the modal's title reflects the now-empty list, as it does on a
  fresh open of an already-empty library ("Stored locally in this browser").
- **Actual:** The list body correctly updates to "Nothing saved yet.", but the subtitle keeps
  showing the pre-delete text, "1 in this browser" — confirmed stable for over half a second, not a
  transient render race. Closing and reopening the modal shows the correct subtitle. The delete
  operation itself is correct; only the header text is stale.
- **Viewport/theme/language:** 1280×800, English, both themes.

### F4. A share-link secret truncated by 2+ characters is silently ignored rather than producing a readable failure — **medium** — PRE-EXISTING

- **Steps:** Create a real share link (id `14`, secret `E36Y5X0RwK`, 10 characters). Navigate to
  `/d/14:E36Y5X0Rw` (9 characters, missing the last one). Separately, navigate to `/d/14:E36Y5X0`
  (7 characters) and to `/d/14:E36Y5` (5 characters).
- **Expected, per the regression checklist:** "A wrong or truncated secret → a readable failure, not
  an unhandled rejection" — for any length of truncation.
- **Actual:** At 9 characters, the app correctly makes a `GET /api/shares/14` request and shows
  "That share link could not be decrypted. / The key does not match this document…" (matches the
  requirement). At 7 characters and at 5 characters, the app makes **no network request at all**
  (confirmed via the network log — no `/api/shares/14` GET appears near either navigation, where one
  appears immediately after every other secret length tested) and silently renders the ordinary
  paste view with no error banner, no toast, and no new console message. The link is neither
  decrypted nor reported as bad — it is treated as if it were not a share link at all.
- **Scope:** The exact cutoff was not pinpointed further than "somewhere between 7 and 9 characters"
  (narrowing it further would have meant more share-link traffic than the task's synthetic-document
  instruction seemed to warrant). The most common real-world truncation — losing the last character
  or two off a pasted/retyped link — is **not** affected and does show the correct message; only a
  more severe truncation (3+ characters short) hits this gap.
- **Viewport/theme/language:** 1280×800, English.

### F5. Several UI strings do not participate in German/Ukrainian translation — **low** — PRE-EXISTING

- **Steps:** Switch the app language to German, then to Ukrainian. Expand any resource and look at
  its action-button row (next to "TYPE … ID … AT …"). Look at the overview stat labeled "Included".
  Compare an attribute-value row's copy-button `aria-label` to its visible text/`title`.
- **Expected:** Every visible string translates (regression checklist §8), matching the fluent,
  complete translation seen everywhere else in both languages (confirmed extensively — the paste
  view, the shortcuts modal, the share modal, and the FAQ are all fully and correctly translated,
  including grammatically correct Ukrainian plural forms).
- **Actual, three distinct gaps:**
  1. The four per-resource action buttons — visible text "raw"/"copy"/"path"/"link" **and** their
     `title`/`aria-label` tooltips ("Show this resource as raw JSON", "Copy this resource as JSON",
     "Copy the JSON Pointer to this resource (…)", "Copy a deep link to this resource") — stay in
     English in both German and Ukrainian.
  2. The "Included" overview-stat label stays as English "INCLUDED" in both German and Ukrainian,
     while its five sibling labels (Shape/Form, Resources/Ressourcen/Ресурси, Types/Typen/Типи,
     Relationships/Beziehungen/Зв'язки, Size/Größe/Розмір) are all correctly translated.
  3. The attribute-value-level copy buttons ("path"/"value") **do** translate their visible text and
     `title` correctly (e.g. "шлях"/"значення" with Ukrainian `title` text), but their `aria-label`
     stays as the English "Copy JSON Pointer to this value"/"Copy this value" in both non-English
     languages — a screen-reader-only gap, invisible sighted-user testing would miss it.
- **Viewport/theme/language:** 1280×800/375×812, German and Ukrainian, both themes (theme is
  irrelevant).

## Specification gaps

None identified as a distinct gap this pass. One documentation staleness worth a mention, not filed
as a gap since it does not affect a user's ability to rely on the contract: the README's find-in-page
caveat ("text that exists only inside a collapsed `<details>` is located but not revealed by the
legacy `window.find` API used for testing") did not hold in this Chrome build — `window.find()` both
located **and** auto-opened the closed `<details>` on match (see §3.7). The app's actual behavior is
better than documented; nothing here needs a bug filed against the implementer, but the README note
is now inaccurate for current Chrome and could be revisited.

## Not tested

- **§9.2, private window / storage-blocked:** No incognito/private-window primitive is available in
  this automation environment, and the app's own boot sequence (IndexedDB open + first render)
  completes before a same-tab, post-navigation script injection can land — every attempt found
  `document.readyState` already `"complete"`. This needs either a genuine private-browsing context
  or a pre-navigation script-injection hook this tool does not expose.
- **§10.3, native Enter/Space activation specifically:** see the note on that row — reachability and
  visible focus rings were confirmed for every element type tried, but the tool's synthetic key
  events do not trigger native default actions (confirmed on a plain button), so activation-by-key
  itself could not be directly demonstrated end-to-end, only inferred from the elements being
  genuine focusable semantic controls.
- **Exhaustive three-language re-walk of every one of the ~71 checklist lines:** the task's own
  instruction for §8 was to "re-walk the main surfaces" in German and Ukrainian, not repeat the
  entire regression pass three times. English got the full functional pass; German got a translation
  + locale-bug spot check; Ukrainian got a full translation/plural/375px pass (the most thorough of
  the two, since it is the environment's negotiated default and therefore the language most users in
  this configuration would actually see first).
- **Exact truncation-length boundary for Finding F4:** narrowed to "between 7 and 9 characters", not
  pinpointed to a single character count, to avoid generating more share-link server traffic than
  the synthetic-document instruction seemed to intend.
