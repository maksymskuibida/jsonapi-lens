# jsonapi-lens

A single-page viewer for [JSON:API](https://jsonapi.org) documents. Paste a payload and every
relationship becomes a link you can click.

Live at **https://jsonapi.mstool.dev**.

JSON:API documents are deliberately flat: `data` holds resource objects whose `relationships` are
`{type, id}` pointers, and the resources those point at sit in a sibling `included` array.
Following a relationship by hand means Ctrl-F'ing a UUID through a few thousand lines. This renders
every resource in the document onto one page, each with a stable DOM id, so a pointer is just an
`<a href="#type--id">`.

**Reading a document is entirely local.** Parsing, indexing and rendering happen in the browser, the
document is kept in IndexedDB, and nothing is uploaded. The one exception is opt-in: a **share link**
encrypts the document in your tab before it is stored, and the server only ever holds ciphertext it
cannot read. Details under [Share links](#share-links).

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

### Paths

Three, parsed by hand in [`src/router.ts`](src/router.ts) — no router library:

| Path | |
|---|---|
| `/` | the paste view |
| `/view` | the document view; relationship anchors are fragments on this path |
| `/d/<id>:<secret>` | a share link, which loads and then replaces itself with `/view` |

The server returns `index.html` for every path except `/api/*`, so all of this is resolved in the
browser.

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
- **Cloudflare's asset router percent-encodes the colon** in `/d/1:KEY`, 307-ing to `/d/1%3AKEY`, so
  the router decodes the pathname before matching.
- **Duplicate identities.** A document that repeats `type:id` violates the spec, but rendering it
  twice would put a duplicate id in the DOM and silently break every anchor to it. First occurrence
  wins; the row is tagged `duplicated`.
- **Filtering by type hides groups**, and you cannot scroll to a `display: none` element — so
  following a link into a filtered-out type clears the filter and says so.
- **A pointer with no matching resource** renders as an explicit struck-through "not in document"
  marker, and is counted in the summary. That distinction is usually the thing being diagnosed.
- **`scroll-margin-top`** on every anchor target, or the sticky header and sticky group header would
  cover the heading you just jumped to.
- **Author `display` beats the UA `[hidden]` rule**, so `[hidden]` is enforced once in the reset.
  Without it the view-switching mechanism leaks every view at once.

## What it does

**Reading**
- Every resource from `data` and `included`, deduped by identity, grouped by type, collapsed by
  default with a summary attribute on each row.
- Typed value formatting: dates show both your locale and the raw ISO string, numbers are
  tabular, `null` and `""` are distinguishable, nested objects are trees.
- **Referenced by** — the reverse index. JSON:API only encodes pointers one way, so "what points at
  this resource?" is otherwise a manual scan. Built on first use and cached.
- Jump rail with per-type counts and a proportion bar, filter-to-one-type, and a `:target` flash so
  it is obvious where you landed.

**Getting things out**
- `path` and `value` on every row copy an [RFC 6901](https://www.rfc-editor.org/rfc/rfc6901) JSON
  Pointer or the value itself. Pointers are the same syntax JSON:API errors use in
  `source.pointer`, so one pastes straight into a bug report.
- `raw`, `copy`, `path` and `link` on every resource: raw JSON in a modal, the resource as JSON, its
  pointer, or a deep link to it.
- Whole-document **Raw**, **Copy**, **Export** (downloads a file), **Save** and **Share link**.

**Keeping things**
- **Saved documents** live in IndexedDB, with rename and delete. Nothing is uploaded.
- The last document you opened is restored on reload; `/` offers a way back into it.

**Keyboard** — `?` lists them all. `g` jumps to a resource by type or id, `/` focuses the type
filter, `s` saves, `r` raw, `e` exports, `l` opens saved documents, `Shift+Esc` leaves the document,
`Esc` closes a dialog.

## Share links

Opt-in, and the only thing that touches a server.

1. The document is gzipped and encrypted **in the browser** with AES-256-GCM.
2. The ciphertext is uploaded. The key is not — it goes in the link.
3. You get `https://jsonapi.mstool.dev/d/<id>:<secret>` and a lifetime of your choosing
   (15 minutes, 6 hours, 1 day, 1 week, 1 month, or no expiry — remembered for next time).

The Worker stores an opaque blob, a byte count and an expiry. No label, no type names, no filename —
those are all inside the ciphertext. An expired link is deleted the moment anyone asks for it, so it
stops working on time regardless; a sweep for blobs nobody returns to runs opportunistically on a
small fraction of writes, off the response path. (It is not a cron trigger because the account is at
Cloudflare's free-plan limit of five.)

**The secret is 10 characters, and that is deliberate.** A written-out 256-bit key is 43 characters
and makes a link that wraps across lines. Ten base64url characters is 60 bits, which on its own
would not be enough — share ids are sequential, so anyone can fetch the blobs and brute-force
offline. So the secret is not the key: it is stretched into one with PBKDF2-HMAC-SHA256 over
1,000,000 iterations, with a random per-share salt stored in the blob. That costs about 200 ms once
when a link is created or opened, and the same *per guess* for an attacker:

| | half of a 60-bit space |
|---|---|
| one high-end GPU | ~3.3 million years |
| 10,000 GPUs | ~330 years |
| no KDF (secret used directly as a key) | well under a day |

`SECRET_CHARS` in [`src/crypto.ts`](src/crypto.ts) is the one number to change. Six characters
(36 bits) would fall in days and is deliberately not offered.

**Two things to know before sending one.** Anyone with the link can read the document, so treat the
link like the payload. And the key sits in the URL *path*, which means it reaches browser history and
anything else that handles the link — unlike a `#fragment`, which browsers never send. The app
strips the secret from the address bar as soon as a link opens, and accepts `/d/<id>#<secret>` if you
prefer the fragment form, but links are minted in the path form.

## Running it

```bash
npm install
```

```bash
npm run dev
```

`npm run dev` is Vite, which serves `/` and `/view` but not `/api/*` — the share feature needs the
Worker, so use `npx wrangler dev` for that (it runs local D1 and R2 simulations).

```bash
npm test
```

```bash
npm run build
```

```bash
npm run fixtures
```

`npm test` runs 109 tests over encoding, parsing, indexing, pointers, routing, the reverse index,
the encryption round trip and the bulk-render escaping. `npm run build` typechecks app and Worker
separately (they have incompatible globals) and builds to `dist/`. `npm run fixtures` writes
`fixtures/large-50k.json`; it takes an optional count and path.

## Deploying

Pushing to `main` deploys, via
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml): typecheck, test, build, apply D1
migrations, `wrangler deploy`, then smoke-test the live URL. It needs two repository secrets,
`CLOUDFLARE_API_TOKEN` (Workers Scripts + R2 + D1 edit, and Workers Routes on the zone) and
`CLOUDFLARE_ACCOUNT_ID`.

By hand:

```bash
npm run deploy
```

Cloudflare Workers static assets, plus one small Worker for the share API. `run_worker_first` is
scoped to `/api/*` so everything else is served straight from assets with an SPA fallback.

## Measured performance

Chrome 148, Apple Silicon. Fixture: `npm run fixtures` → **25.7 MB, 56,821 resources**, 7 types,
~207,000 relationship pointers.

| | |
|---|---|
| `JSON.parse` + build the index | **198–235 ms** |
| Build + insert the DOM | **1.19–1.62 s** |
| Total, paste to interactive | **~1.6 s** |
| DOM | 56,821 sections, **750,727 elements** |
| JS heap after render | **57–83 MB** |
| Jump to a resource 1.9 M pixels down | **147 ms** |
| Reload from IndexedDB and re-render | ~1.6 s |
| Create a share link (7.6 kB document) | **~1.0 s**, of which ~200 ms is the KDF |

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
resource rather than up front, and the app says so in the document summary. Groups larger than 500
rows do not offer "Expand all". The reverse index is skipped past 400,000 pointers rather than
stalling.

**The honest ceiling.** 56,821 resources / 25.7 MB is comfortable: ~1.6 s to interactive, and
scrolling stays responsive. The binding constraint is **DOM node count**, not payload bytes — 750k
elements is where fixed per-node costs start to show. Scaling is roughly linear, so ~100k resources
(~1.3 M nodes) should land near 3 s to interactive; past that it is the initial render, not
scrolling, that degrades. That trade — a large DOM in exchange for anchors, `:target` and
find-in-page working for free — is the whole point of the architecture, so the ceiling is a
deliberate cost rather than an oversight.

Frame-rate during scrolling could not be measured in the automated browser used for testing: it
never reports `document.visibilityState === "visible"`, so `requestAnimationFrame` is paused. The
layout-flush comparison above is the substitute, and it measures the same main-thread work.

### Verified behaviour

Driven in a real browser, not asserted:

- A 4-deep relationship chain by clicking: `articles` → `comments` → `people` → `organizations` →
  `countries`. Each lands with its heading clear of the sticky headers.
- Back ×4 then Forward ×4 reproduce the chain exactly in reverse and then forward order, landing on
  the same position each time.
- Reload while deep-linked re-renders from IndexedDB and scrolls to the right section.
- Find-in-page locates text in an off-screen `content-visibility: auto` section 1.87 M pixels down,
  selects it and scrolls to it.
- Ids containing `/`, a space, `#`, `%`, `ü`, `í` and an emoji all resolve, match `:target`, and
  round-trip through `location.hash` unchanged.
- A share link created in one browser state, then opened with IndexedDB wiped, decrypts and renders;
  the secret is stripped from the URL; a single altered character in the key is rejected with a
  specific message.
- Copy actions resolve their JSON Pointer against the parsed document, and report clearly when the
  clipboard is unavailable rather than failing silently.
- Unhappy paths all produce a specific, actionable message: malformed JSON (with a line number),
  valid JSON that is not JSON:API (naming the keys it did find), a bare array, a doubly-encoded
  payload, a Python dict repr, a log line with a prefix, `{}`, and `data` + `errors` together.
- Light and dark mode, and every viewport from 320 px to 3440 px: no horizontal overflow at any
  width, the topbar keeps all four controls by shrinking their labels, the rail becomes a card below
  60rem, and past 100rem the column is capped and centred rather than stretched — a resource row
  spread across 1,800 px puts a hand's width between an id and the tags describing it.

One caveat on find-in-page: text that exists **only inside a collapsed `<details>`** is located but
not revealed by the legacy `window.find` API used for testing. Whether a browser's own find bar
auto-expands a closed `<details>` varies, so the reliable route is "Expand all" on a group and then
Ctrl-F. Summary rows — type, id and a summary attribute for every resource — are always reachable.

## Layout

```
src/
  ident.ts            fragment/DOM-id encoding, type hue + sigil
  pointer.ts          RFC 6901 pointers: escape, join, parse, resolve
  router.ts           the three paths, parsed by hand
  parse.ts            validation with specific errors, one-pass index, reverse index
  types.ts            structural types for the parts of JSON:API this reads
  format.ts           value classification and typed formatting
  crypto.ts           gzip + AES-GCM + PBKDF2 for share links
  share.ts            share API client and its modal
  store.ts            IndexedDB: current document and saved library
  clipboard.ts        copy and download
  ui.ts               toast and modal
  panels.ts           raw view, saved documents, save, shortcuts
  jump.ts             go-to-resource palette
  dom.ts              element helper and the single audited HTML-escaping point
  render-value.ts     value trees with copy affordances
  render-resource.ts  the identity chip, collapsed rows, expanded detail
  render-document.ts  jump rail, overview, errors, type groups
  main.ts             boot, routing, hash resolution, lazy bodies, shortcuts
  styles.css          design tokens and all styling
  samples/            the four documents behind the "Or try" buttons
  worker.ts           the share API (the only server-side code)
migrations/           D1 schema
scripts/gen-fixture.mjs
test/
```

Plain TypeScript with direct DOM construction, no framework and no router. Since
`content-visibility` does the work a virtualiser would, a virtual DOM would add a parallel tree and
diffing for no benefit — nothing here re-renders after the initial build. Collapsed rows are built
as one HTML string per type group and parsed in a single pass, which is several times faster than
56,821 rounds of `createElement`; every interpolated value goes through `escapeHtml`, and a test
asserts that a payload carrying `<script>` cannot inject an element.

The tens of thousands of copy buttons carry **no event listeners**: one delegated handler reads their
data attributes, and values are resolved from the parsed document by JSON Pointer rather than
duplicated into the DOM.

Fonts (Martian Mono, Instrument Sans, JetBrains Mono) are self-hosted, so the page makes no
third-party requests.

The sample documents are an invented article feed. They exercise deep relationship chains, unresolved
pointers, duplicate identities and hostile identifiers, and contain no real-world data.
