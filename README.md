# jsonapi-lens

A single-page viewer for [JSON:API](https://jsonapi.org) documents. Paste a payload and every
relationship becomes a link you can click.

JSON:API documents are deliberately flat: `data` holds resource objects whose `relationships` are
`{type, id}` pointers, and the resources those point at sit in a sibling `included` array.
Following a relationship by hand means Ctrl-F'ing a UUID through a few thousand lines. This renders
every resource in the document onto one page, each with a stable DOM id, so a pointer is just an
`<a href="#type--id">`.

**Everything happens in your browser.** Parsing, indexing and rendering are all client-side, and the
document is stored in local IndexedDB. No request ever carries payload data: the app contains no
`fetch`, no API and no analytics, the fonts are self-hosted, and the only network traffic is the page
loading its own same-origin assets. There is no server to send a payload to, and no upload or share
feature — by design.

## How it works

The whole design follows from one decision: **use the browser's own anchor navigation instead of a
router.**

- Each resource renders as a `<section id="r_…">`. Each relationship pointer renders as a plain
  `<a href="#r_…">`.
- Clicking one lets the browser scroll and push a history entry. Back, Forward, deep links,
  find-in-page and "copy link address" all work with no routing code.

That only holds if the target element is **in the DOM**, which rules out normal list
virtualisation. So instead of removing off-screen nodes:

- every resource stays a real DOM node, and
- each one gets `content-visibility: auto` with `contain-intrinsic-size: auto 35.6px`.

The browser then skips layout and paint for off-screen sections — virtualisation-grade performance
— while anchors, `:target` and browser find keep working. Measurements below.

Relationship resolution goes through a `Map` keyed `` `${type}:${id}` `` built once at parse time
over `data` + `included`, so following a pointer is a map hit, never a scan.

### Things that are easy to get wrong

- **`type` and `id` are not valid fragment identifiers.** They can contain `/`, spaces, `#`, `:`,
  `%`, and non-ASCII. [`src/ident.ts`](src/ident.ts) defines one encoding — keep `[A-Za-z0-9]`,
  replace every other UTF-16 code unit with `_` + four hex digits — which is injective, reversible,
  emits only `[A-Za-z0-9_]`, and always starts with a letter. `__` joins the two segments and
  cannot occur inside either. Covered by tests, including emoji and a type containing the joiner.
- **Reload into a hash is a race.** On load the sections do not exist until the payload has been
  read back from IndexedDB, so the browser's initial scroll-to-fragment hits nothing. The app
  rebuilds first, then resolves `location.hash` itself. (`:target` needs no help — it starts
  matching as soon as an element with that id exists.)
- **Opening a row shifts everything below it**, which stales the scroll offsets the browser saved
  for later history entries. Every hash navigation therefore re-scrolls to its target, so Back and
  Forward land exactly where they should.
- **Duplicate identities.** A document that repeats `type:id` violates the spec, but rendering it
  twice would put a duplicate id in the DOM and silently break every anchor to it. First occurrence
  wins; the row is tagged `duplicated`.
- **Filtering by type hides groups**, and you cannot scroll to a `display: none` element — so
  following a link into a filtered-out type clears the filter and says so.
- **A pointer with no matching resource** renders as an explicit struck-through "not in document"
  marker, and is counted in the summary. That distinction is usually the thing being diagnosed.
- **`scroll-margin-top`** on every anchor target, or the sticky header and sticky group header would
  cover the heading you just jumped to.

## Running it

```bash
npm install
```

```bash
npm run dev
```

Other scripts:

```bash
npm test
```

```bash
npm run build
```

```bash
npm run fixtures
```

`npm test` runs 71 tests over encoding, parsing, indexing and the bulk-render escaping.
`npm run build` typechecks and builds to `dist/`. `npm run fixtures` writes
`fixtures/large-50k.json`; it takes an optional count and path, e.g.
`node scripts/gen-fixture.mjs 50000 fixtures/large-50k.json`.

## Deploying

Live at **https://jsonapi.mskuibida.com**.

Cloudflare Workers static assets. There is deliberately **no Worker script** — no `main` in
[`wrangler.jsonc`](wrangler.jsonc), no API, no bindings. Just `dist/` uploaded as assets, with the
custom domain declared as a route.

```bash
npm run deploy
```

## Measured performance

Chrome 148, Apple Silicon, dev build. Fixture: `npm run fixtures` → **25.7 MB, 56,821 resources**
(6,821 trips in `data` + 50,000 in `included`), 7 types, ~207,000 relationship pointers.

| | |
|---|---|
| `JSON.parse` + build the index | **198–235 ms** |
| Build + insert the DOM | **1.19–1.62 s** |
| Total, paste to interactive | **~1.6 s** |
| DOM | 56,821 sections, **750,727 elements** |
| JS heap after render | **57–83 MB** |
| Jump to a resource 1.9 M pixels down | **147 ms** |
| Reload from IndexedDB and re-render | ~1.6 s |

**What `content-visibility` buys.** Timing a forced full style+layout flush at 56,821 rows:

| | median | notes |
|---|---|---|
| `content-visibility: auto` (shipped) | **76–130 ms** | worst case; ordinary scrolling does not force a full flush |
| skipping disabled | **637 ms** | **8.4× slower** |
| first full layout, skipping disabled | **5.9 s** | what the page would cost without it |

**Scrollbar accuracy.** `contain-intrinsic-size` is the placeholder height used for rows the browser
has not measured yet; if it is wrong, scroll height drifts as you scroll. A real collapsed row is
36.6 px border-box, and the property specifies the *content* box, so the value is 35.6 px. Document
height with skipping on: **2,080,895 px**. True height with every row laid out: **2,080,887 px**. An
8 px error over 2.08 million — the scrollbar does not thrash. (An earlier 37 px guess was 3.8% over,
which is visible as drift.)

**Deliberate degradation above 2,000 resources.** Attribute detail is built when you expand a
resource rather than up front, and the app says so in the document summary. Eager bodies for 56,821
resources would be millions of nodes. Groups larger than 500 rows do not offer "Expand all".

**The honest ceiling.** 56,821 resources / 25.7 MB is comfortable: ~1.6 s to interactive, and
scrolling stays responsive. The binding constraint is **DOM node count**, not payload bytes — 750k
elements is where fixed per-node costs start to show, and a forced full layout at that size is
~100 ms. Scaling is roughly linear, so ~100k resources (~1.3 M nodes) should land near 3 s to
interactive; past that it is the initial render, not scrolling, that degrades. That trade — a large
DOM in exchange for anchors, `:target` and find-in-page working for free — is the whole point of the
architecture, so the ceiling is a deliberate cost rather than an oversight.

Frame-rate during scrolling could not be measured here: the automated browser pane never reports
`document.visibilityState === "visible"`, so `requestAnimationFrame` is paused and frame timings are
unavailable. The layout-flush comparison above is the substitute, and it measures the same
main-thread work.

### Verified behaviour

Driven in a real browser, not asserted:

- A 4-deep relationship chain by clicking: `trips` → `segments` → `stations` → `countries` →
  `carriers`. Each lands with its heading clear of the sticky headers.
- Back ×4 then Forward ×4 reproduce the chain exactly in reverse and then forward order, landing on
  the same position each time.
- Reload while deep-linked re-renders from IndexedDB and scrolls to the right section, with
  `:target` matching.
- Find-in-page locates text in an off-screen `content-visibility: auto` section 1.87 M pixels down,
  selects it and scrolls to it.
- Ids containing `/`, a space, `#`, `%`, `ü`, `í` and an emoji all resolve, match `:target`, and
  round-trip through `location.hash` unchanged.
- Unhappy paths all produce a specific, actionable message: malformed JSON (with a line number),
  valid JSON that is not JSON:API (naming the keys it did find), a bare array, a doubly-encoded
  payload, a Python dict repr, a log line with a prefix, `{}`, and `data` + `errors` together.
- Light and dark mode, and the layout down to 375 px.

One caveat on find-in-page: text that exists **only inside a collapsed `<details>`** is located but
not revealed by the legacy `window.find` API used for testing. Whether a browser's own find bar
auto-expands a closed `<details>` varies, so the reliable route is "Expand all" on a group and then
Ctrl-F. Summary rows — type, id and a summary attribute for every resource — are always reachable.

## Layout

```
src/
  ident.ts            fragment/DOM-id encoding, type hue + sigil
  parse.ts            validation with specific errors, one-pass index build
  types.ts            structural types for the parts of JSON:API this reads
  format.ts           value classification and typed formatting
  store.ts            IndexedDB persistence
  dom.ts              element helper and the single audited HTML-escaping point
  render-value.ts     attributes / meta / links value trees
  render-resource.ts  the identity chip, collapsed rows, expanded detail
  render-document.ts  jump rail, overview, errors, type groups
  main.ts             boot, hash resolution, lazy bodies, filtering
  styles.css          design tokens and all styling
  samples/            the four documents behind the "Or try" buttons
scripts/gen-fixture.mjs
test/
```

Plain TypeScript with direct DOM construction, no framework. Since `content-visibility` does the
work a virtualiser would, a virtual DOM would add a parallel tree and diffing for no benefit —
nothing here re-renders after the initial build. Collapsed rows are built as one HTML string per
type group and parsed in a single pass, which is several times faster than 56,821 rounds of
`createElement`; every interpolated value goes through `escapeHtml`, and a test asserts that a
payload carrying `<script>` cannot inject an element.

Fonts (Martian Mono, Instrument Sans, JetBrains Mono) are self-hosted from `node_modules`, so the
page makes no third-party requests.
