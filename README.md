# jsonapi-lens

A single-page viewer for [JSON:API](https://jsonapi.org) documents. Paste a payload and every
relationship becomes a link you can click.

Live at **https://jsonapi.mstool.dev**.

![Paste a JSON:API document, click through the graph: a chain of relationship pointers, the last of
them missing from the document.](public/og.png)

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

Five, parsed by hand in [`src/router.ts`](src/router.ts) — no router library:

| Path | |
|---|---|
| `/` | the paste view |
| `/view` | the document view; relationship anchors are fragments on this path |
| `/d/<id>:<secret>` | a share link, which loads and then replaces itself with `/view` |
| `/impressum` | provider information under § 5 DDG |
| `/privacy` | the privacy policy |

The server returns `index.html` for every path except `/api/*`, so all of this is resolved in the
browser.

`/impressum` keeps the German word in every language: § 5 DDG requires the provider information to
be *leicht erkennbar*, and the case law is built around that term, so it is what a German visitor
scans a footer for. `/privacy` has no such constraint — no law says what a privacy policy link is
called — so it matches the rest of the UI. `/imprint`, `/legal`, `/datenschutz` and
`/datenschutzerklaerung` all resolve to the right one, because these are paths people type by hand.

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
- **A history entry cannot remember a scroll offset, and `content-visibility` is the reason.** A
  row that has never been on screen has no measured height — the browser uses the
  `contain-intrinsic-size` estimate — so the page is only as accurate as the parts of it you have
  visited. Walk into a region for the first time and every row there grows from 35.6px to its real
  height, permanently. If that happened *above* where you were standing, the offset you left behind
  now points at different content. Measured on a 131-resource document: **342–1,215px of drift**,
  most of a screen, and worst of all on a reload, where nothing has been measured yet.

  So an entry remembers a **place, not a number**: which resource section the viewport was resting
  against, and how far that section's top was from the top of the viewport. On the way back that
  section is put back at that offset — and then re-measured over several frames, because the act of
  scrolling is what renders the rows around it and therefore changes their heights. It converges in
  two or three passes; heights only ever resolve from estimate to real, never back. `y` is still
  recorded, as the fallback for when the section is no longer in the document at all.

  Finding the section is a binary search over an array rebuilt with the type filter — 0.01ms at
  61,487 rows, against 10.4ms for a `querySelectorAll` on every `scrollend`. Filtered-out groups are
  excluded from that array, because a `display: none` group reports a zero rect wherever it sits and
  would break the ordering the search depends on.

- **The set of open rows travels with the position**, because folding is the other thing that moves
  content, and it is re-applied *before* anything scrolls. A restored shape is also authoritative:
  the fragment's own row is only auto-opened when there was no shape to apply. Otherwise returning to
  an entry where you had *collapsed* the row you originally landed on would re-open it, and
  everything below would move. The browser's own `scrollRestoration` is off, because it cannot know
  any of this. Positions are captured on `scrollend`, on a debounce, on a capture-phase click on any
  in-page anchor, and on `pagehide` — and never while a restore is still converging, or the entry
  would be overwritten with a half-finished position. Above 2,000 open rows the fold state is dropped
  rather than risking the browser's `history.state` size limit; the position is still kept.
- **A traversal has to be recorded, not inferred from `history.state`.** Reading the state back looks
  like a tidy way to make a second settle pass harmless — during a traversal it already holds the
  entry being returned to. It is wrong, and the symptom is nowhere near the cause: the entry a
  fragment navigation pushes starts out stateless, but anything that fires a scroll before the
  fragment is resolved writes a position into it first, and closing the jump dialog does exactly
  that. That state then reads as a restored fold shape, a restored shape deliberately leaves rows as
  they were, and so the row you had just navigated to stayed shut. `popstate` records the traversal
  instead, the next forward navigation clears it, and it is deliberately *not* cleared once used —
  that is what makes a repeat pass idempotent. It is stored with the fragment it was captured for,
  because editing the fragment in the address bar makes a new entry that a pending restore must not
  be applied to.
- **Do not reach for the Navigation API's `navigate` event** to catch the last few milliseconds
  before a Back. It fires *during* the traversal, when `history.state` already refers to the entry
  being restored, so writing the outgoing position there overwrites exactly what is about to be read
  and Back stops working. Found by testing; `scrollend` closes the same gap safely.
- **Cloudflare's asset router percent-encodes the colon** in `/d/1:KEY`, 307-ing to `/d/1%3AKEY`, so
  the router decodes the pathname before matching.
- **Duplicate identities.** A document that repeats `type:id` violates the spec, but rendering it
  twice would put a duplicate id in the DOM and silently break every anchor to it. First occurrence
  wins; the row is tagged `duplicated`.
- **Filtering by type hides groups**, and you cannot scroll to a `display: none` element — so
  following a link into a filtered-out type clears the filter and says so.
- **`boot()` reads IndexedDB behind an `await`**, and a document loaded during that await is already
  rendered and already owns the view by the time the read returns. Falling through to `showView`
  would put the paste view back over the top of it, which looks exactly like the paste having been
  ignored. A person cannot paste and click inside that window, but a test can, so both `boot` and
  `applyRoute` check for it rather than being accidentally right.
- **A pointer with no matching resource** renders as an explicit struck-through "not in document"
  marker, and is counted in the summary. That distinction is usually the thing being diagnosed.
- **`scroll-margin-top`** on every anchor target, or the sticky header and sticky group header would
  cover the heading you just jumped to.
- **Author `display` beats the UA `[hidden]` rule**, so `[hidden]` is enforced once in the reset.
  Without it the view-switching mechanism leaks every view at once.

## Languages

English, German and Ukrainian, negotiated from `?lang=` → `localStorage` → `navigator.languages` →
English, and switchable from the topbar.

[`src/i18n/en.ts`](src/i18n/en.ts) is the source of truth: `Messages` is derived from it with
`typeof`, and `de` and `uk` are typed as `Messages`. A key that one catalogue has and another does
not, or a message whose arguments have drifted, does not compile — so a translation cannot silently
fall behind the app.

Two conventions do most of the work:

- **Messages that take values are functions**, not templates with `{holes}`. There is no
  interpolation engine, the compiler checks every call site, and a language that wants the number
  somewhere else can put it there. Counts go through `Intl.PluralRules`, because Ukrainian needs
  four forms and `n === 1` gets 2 ресурси wrong.
- **Messages with emphasis inside them return DOM**, not HTML strings. German and Ukrainian move the
  stressed word, so `<em>` cannot live in the markup around a message — and building nodes keeps the
  catalogues out of `innerHTML`.

Numbers and dates are formatted in the chosen language rather than the browser's, which is what
`toLocaleString()` with no argument had been doing.

The copy in `index.html` — the shell and the paste view, which paint before the module graph loads —
is bound to the catalogue by a typed table in [`src/i18n/static-dom.ts`](src/i18n/static-dom.ts).
The English text left in the markup is a genuine pre-JavaScript fallback rather than a second source
of truth: a test asserts that localising the shipped markup into English is a no-op.

Switching language reloads the page. The document is in IndexedDB, the scroll position is in
`history.state` and the fragment is in the URL, so a reload restores everything visible — re-running
every render path by hand would buy a few hundred milliseconds on an action taken about once per
visitor.

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
- Back and Forward return you to the exact point you left — the same content in the same place on
  screen, not the same pixel offset, which is a different and much weaker promise on a page whose
  rows are measured lazily. Which rows were expanded is restored with it.

**Keyboard** — `?` lists them all. `/` or `g` finds a resource by type or id, `s` saves, `r` raw,
`e` exports, `l` opens saved documents, `Shift+Esc` leaves the document, `Esc` closes a dialog.

That list only contains bindings this app actually implements. Tab order, Enter/Space on a focused
row and the browser's own find all work, but they work because the markup is ordinary HTML — listing
them made the app look like it had done something and buried the real bindings.

**Back and Forward are the exception**, and get their own section in the same dialog. They are the
browser's keys rather than this app's, but they are how you climb back out of a relationship chain —
the most useful key here — and hardly anyone knows them, because the spelling depends on the OS:

| | macOS | Windows and Linux |
| --- | --- | --- |
| Back | `⌘ + [` or `⌘ + ←` | `Alt + ←` |
| Forward | `⌘ + ]` or `⌘ + →` | `Alt + →` |
| Relationship in a new tab | `⌘ + click` | `Ctrl + click` |

The dialog shows the row for the platform it detects, names it ("From your browser — Mac keys"), and
still prints the other platform's spelling underneath — the question usually gets asked over someone
else's shoulder. It also mentions the trackpad swipe and mouse side buttons, which are the easier
sell. Platform detection is `navigator.userAgentData.platform`, falling back to `navigator.platform`
and then the UA string, in [`src/platform.ts`](src/platform.ts); the same value picks `⌘` or `Ctrl`
for the `⌘ + Enter` hint on the paste view.

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

## Findability

The site is one HTML file and one bundle, which means everything a crawler is told has to be told
deliberately. Four surfaces do it, and each has a test holding it to the others:

| | |
|---|---|
| [`index.html`](index.html) head | canonical, `robots`, keywords, `hreflang` for all three languages, Open Graph and Twitter cards, and a JSON-LD `@graph`: `WebSite`, `WebApplication`, `Person` and the `FAQPage` mirroring the six questions on the page |
| [`src/seo.ts`](src/seo.ts) | keeps that head in step with the route and the language at runtime |
| [`public/robots.txt`](public/robots.txt), [`sitemap.xml`](public/sitemap.xml), [`_headers`](public/_headers) | what to crawl, every indexable URL once per language, and `X-Robots-Tag` for the two paths that must never be indexed |
| [`public/llms.txt`](public/llms.txt), [`llms-full.txt`](public/llms-full.txt) | the same description in prose, for assistants and answer engines that never parse a `<head>` |

Two rules run through all of it:

- **A route either has a canonical URL or is `noindex`.** `/view` renders a document from the
  visitor's own IndexedDB, so for anyone else it is an empty page; `/d/<id>:<secret>` carries a
  decryption key in the URL, so a crawler that runs JavaScript could render a document meant for one
  recipient. Both are excluded in `robots.txt`, sent `X-Robots-Tag: noindex` by `_headers`, and given
  no canonical by `src/seo.ts` — three layers because a `Disallow` is a request and a header is not.
- **The canonical URL carries `?lang=` exactly when the language was asked for.** `/?lang=de` really
  does render German, so it is its own indexable URL; a bare `/` negotiates from the browser, which
  is what `x-default` describes.

`/impressum` and `/privacy` are also written out as real files at build time by the `seo-routes`
plugin in [`vite.config.ts`](vite.config.ts), so a crawler that does not run JavaScript gets their
titles, descriptions, canonicals and structured data rather than the front page's. Every replacement
in that plugin is asserted, so an edit to `index.html` that breaks one fails the build instead of
quietly emitting a page that describes the wrong thing. They are flat files — `impressum.html`, not
`impressum/index.html` — because Cloudflare's `auto-trailing-slash` handling serves the directory
shape by first redirecting `/impressum` to `/impressum/`, which is a redirect to a URL that
disagrees with the canonical on the page. The alias paths (`/imprint`, `/legal`, `/datenschutz`,
`/datenschutzerklaerung`) 301 to the real one via [`public/_redirects`](public/_redirects), generated
from the same table in `src/router.ts` that resolves them, so one page never has four indexable URLs.

The link preview is [`public/og.svg`](public/og.svg), drawn in the app's own palette and typeface and
rasterised to `og.png` by [`scripts/render-og.sh`](scripts/render-og.sh) (`npm run og`). It is a
script rather than a build step because it changes about once a year and needs a browser to read the
woff2 faces.

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

`npm test` runs 117 tests over encoding, parsing, indexing, pointers, routing, the reverse index,
the encryption round trip and the bulk-render escaping.

History restoration is deliberately *not* among them. What it promises — Back puts the same content
back in the same place on screen — depends on `content-visibility` and on real layout, and jsdom has
neither, so those tests would pass vacuously. They live in
[`test/browser/`](test/browser/README.md) instead, and run in headless Chrome:

```bash
node test/browser/run.mjs
```

22 journeys through a real payload plus a reload check, each reporting how far the watched content
moved in pixels; ±2px is the bar and the runner exits non-zero if anything drifts further. `--width`
runs the whole suite at a narrow layout. It needs `npm run dev` up,
because it fetches the scenarios from that origin, and it drives Chrome over CDP directly — Node has
had a global `WebSocket` since 22, so that is about sixty lines and no new dependency.

Headless rather than a real window on purpose. A headed tab only renders while it is the visible,
non-occluded tab of a non-minimised window; anywhere else it stops running `requestAnimationFrame`
and stops updating `content-visibility`, and the measurements come out quietly wrong rather than
failing. Headless always renders, needs nobody's screen, and several copies can run at once. `npm run build` typechecks app and Worker
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
| Find the section a position is anchored to | **0.01 ms** (binary search, warm; 3.7 ms cold) |
| Index those sections, once per render or filter | **29 ms** |

The two restoration figures were measured on a re-generated fixture of 61,487 resources rather than
the 56,821 above; `npm run fixtures` does not produce an identical document twice.
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
- Back three times through a four-deep chain returns to each entry's exact scroll position (200,
  2137, 3351 px), and Forward does the same.
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
  router.ts           the five paths, parsed by hand
  seo.ts              the head: canonical, robots, hreflang and cards per route
  parse.ts            validation with specific errors, one-pass index, reverse index
  types.ts            structural types for the parts of JSON:API this reads
  format.ts           value classification and typed formatting
  crypto.ts           gzip + AES-GCM + PBKDF2 for the share envelope — one document or a bundle
  share.ts            share API client and its modal
  store.ts            IndexedDB: current document and saved library
  exchange.ts         placeholder for T2's captured-request model
  clipboard.ts        copy and download
  ui.ts               toast and modal
  panels.ts           raw view, saved documents, save, shortcuts
  platform.ts         ⌘ vs Ctrl, and the browser's own history keys per OS
  jump.ts             go-to-resource palette
  dom.ts              element helper and the single audited HTML-escaping point
  render-value.ts     value trees with copy affordances
  render-resource.ts  the identity chip, collapsed rows, expanded detail
  render-document.ts  jump rail, overview, errors, type groups
  main.ts             boot, routing, hash resolution, lazy bodies, shortcuts
  styles.css          design tokens and all styling
  samples/            the five documents behind the "Or try" buttons
  i18n/               three catalogues, the typed binding table for the shipped markup
  legal/              Impressum and privacy policy as data, in three languages
  views/legal.ts      the renderer both legal pages share
  worker.ts           the share API (the only server-side code)
public/
  robots.txt          what to crawl; search and AI agents named explicitly
  sitemap.xml         every indexable URL, once per language
  llms.txt            the short description, for assistants
  llms-full.txt       the long one: features, limits, privacy model, questions
  og.svg → og.png     the link preview, drawn and then rasterised
  site.webmanifest    name, icons, theme colour
  _headers            X-Robots-Tag for /view and /d/*, plus two safety headers
  _redirects          the legal aliases, 301'd to the one URL each page has
migrations/           D1 schema
scripts/
  gen-fixture.mjs     the 25.7 MB performance fixture
  render-og.sh        rasterises og.svg with headless Chrome
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
