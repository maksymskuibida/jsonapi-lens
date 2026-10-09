# Decisions

Things settled once, that later work must respect. A change contradicting an entry here amends the
entry in the same pull request, with reasoning — silent divergence is a blocking defect.

---

## D1 · Anchor ids are namespaced, and collision-freedom is proved, not assumed

**Date:** 2026-09-02 · **Settles:** how a second document on the page gets anchors

### Why this is load-bearing

The whole navigation model is that a pointer is `<a href="#…">` and its target is a real element
with that id. Back, Forward, deep links, find-in-page and "copy link address" all work *because*
there is no router — and all of it rests on **element ids being unique**. A duplicate id does not
throw. The browser silently resolves the anchor to the first match, so every link to the second one
lands in the wrong place, and nothing anywhere reports it.

Attaching a request makes this a live risk rather than a theoretical one: a `POST`/`PATCH` request
body is often itself a JSON:API document, so the request and the response will both want
`#r_trips__1`.

### The scheme

Every DOM id the app mints is `<scope><body>`, where:

- **`<scope>` is exactly two characters** — one ASCII letter and `_` — and every scope's letter is
  distinct. The full table lives in `src/ident.ts` and is the only place a scope may be defined.
- **`<body>` is one or more segments** run through `encodeSegment` and joined with `__`.

| Scope | For | Segments |
|---|---|---|
| `r_` | a response resource section | `type`, `id` |
| `g_` | a response type group | `type` |
| `q_` | a request field — a param, a header, a URL part | `kind`, `name` |
| `b_` | a resource in the **request body** document | `type`, `id` |
| `n_` | a node in a plain-JSON **response** | the JSON Pointer |
| `d_` | a node in a plain-JSON **request body** | the JSON Pointer |
| `f_` | a diagnostic finding | `check`, `subject` |

`r_` and `g_` are exactly what the code mints today, so **every existing fragment keeps working**
and no deep link or bookmarked anchor changes meaning. The new scopes are additions.

### Why it cannot collide

Two obligations, and both are discharged by construction rather than by care:

1. **Across scopes.** Every scope prefix is two characters and the first character is unique to that
   scope, so ids from different scopes differ at index 0. There is no input that can make them
   agree, and no need to reason about the bodies at all.
2. **Within a scope.** `encodeSegment` keeps `[A-Za-z0-9]` and maps every other UTF-16 code unit to
   `_` + 4 hex digits — including `_` itself, to `_005f`. So it is injective, and in its output `_`
   is *only ever* followed by a hex digit. The `__` joiner therefore cannot occur inside an encoded
   segment, which makes the joined body unambiguously splittable and the whole id injective in its
   segment tuple. This is the property the module's header comment already claims; the scope table
   extends it rather than replacing it.

### What enforces it

The proof above is worthless if a later scope is added by hand and gets it wrong, so the table is
guarded by tests in `test/ident.test.ts` that must exist:

- every scope prefix is exactly two characters, an ASCII letter followed by `_`;
- all scope first-characters are distinct — this is the assertion that makes obligation 1 true;
- the table is exhaustive over the `AnchorScope` union, so adding a scope to the type without adding
  it to the table fails to typecheck;
- a cross-scope collision attempt over a corpus of hostile `type`/`id`/pointer pairs — values
  containing `_`, `__`, `#`, `/`, emoji, and a `type` deliberately chosen to look like another
  scope's encoded body — produces no two equal ids;
- `parseDomId` recovers the scope and every segment, and returns `null` for a well-formed id in a
  scope it was not asked about, rather than mis-parsing it as its own.

### Rejected alternative

Folding the scope into the body as a leading segment — `r_` + `encodeSegment(scope) + "__" + …` —
is also provably safe and needs no prefix table. It was rejected because it changes every existing
response id from `r_trips__1` to `r_res__trips__1`, which breaks fragments that are already in
people's browser history and in the README, for no gain over a distinct first character.

---

## D2 · `Exchange` is a placeholder module, not an inline opaque type

**Date:** 2026-09-03 · **Settles:** how T5's types reference a model T2 has not built yet ·
**Discharged:** 2026-09-03, by T2a — see "What T2a actually did" below. Kept rather than deleted:
the reasoning for the placeholder is still why `store.ts` and `crypto.ts` (T5) and `mcp/` (T7,
queued) could be built before this module's real design existed, and a later reader asking "why does
this codebase have a decision about a type that no longer looks like this" needs that history, not a
gap where it used to be.

### Why this is load-bearing

T5 (storage and the share envelope) attaches an optional exchange to four different types —
`StoredDocument`, `LibraryEntry`, `SharePayload`, `BundleEntry` — across the two files it owns that
carry one (`store.ts`, `crypto.ts`). The real shape of a captured HTTP exchange is T2's design, built
in a later wave, and [T5's task spec](task-specs/T5.md) is explicit that T5 must not block on it.

### The choice, as it stood until T2a

`src/exchange.ts` was a new module exporting one interface:

```ts
export interface Exchange {
  readonly [key: string]: unknown;
}
```

Every type that carries an exchange imports `Exchange` from this module, rather than each declaring
its own inline `Record<string, unknown>`. This is no longer what the file contains — see below — but
the shape above is what T5, and any code written against T5 before T2a landed, was built against.

### Why not the inline alternative

The task spec offered two options: declare the field inline as an opaque, structurally-typed payload
"that T2 narrows", or import the type from a module T5 creates and T2 fills in. An inline
`Record<string, unknown>` repeated at four call sites is equally valid TypeScript, but T2 replacing it
later would mean editing four sites across two files in lockstep, with nothing that fails to compile
if one is missed. A dedicated module means T2 edits **one file** — the body of `exchange.ts` — and
every consumer that only carries the value forward, never reading a field off it, keeps compiling
unchanged.

### What T2a actually did

Replaced the body of `src/exchange.ts` with the real model: `Exchange { request?: RequestPart,
response?: ResponsePart, origin?: OriginMeta }`, `RequestPart`, `ResponsePart` and `BodyPart` (see
`src/exchange.ts`'s own header comment for the full shape and `mergeExchange`), plus `OriginMeta`
itself carrying forward this decision's own pattern — an opaque `{ [key: string]: unknown }`, this
time as a placeholder for **T3**, which depends on T2a and has not landed yet.

The prediction this entry made held exactly: `store.ts` and `crypto.ts` needed **no changes** to
their own logic, because neither reads a field off an `Exchange` value — both only ever carry one
forward, whole. Two of T5's *tests* did need a mechanical fix (`test/store.test.ts`,
`test/crypto.test.ts`): two sample literals hard-coded fields directly on `exchange` (e.g.
`{ method: "GET", url: "..." }`) rather than nested under `exchange.request`/`exchange.response`,
which only ever typechecked against the opaque placeholder above. That is a consequence of
constructing sample data with a guessed shape, not of reading a field off a real value, so it does
not contradict what this entry predicted — it is the one corner "no other file needs to change"
did not quite reach, and is called out here so the next placeholder-discharging task knows to check
for it too.

### Rejected alternative

Waiting for T2 to land before starting T5 — rejected outright, since it defeats the point of running
T1 and T5 as a wave. `docs/STATUS.md` §1a's dependency graph (`T5 → {T2, T6, T7}`) requires T5 to ship
first, and this module is what makes that possible without T5 guessing at T2's design.

## D3 · Identity inference is scoped by container name, and would rather miss a link than mint a wrong one

**Date:** 2026-09-03 · **Settles:** what makes a repeated value in plain JSON "the same identity",
for `src/json-index.ts` and for any later task that reads or extends it (T2's request-scoped
anchors, T3/T4 reading the model T2 builds on this one)

### Why this is load-bearing

A generic tree view can show that `42` appears in six places; it cannot tell you whether those six
`42`s mean the same thing. JSON:API answers this by declaring `{type, id}` explicitly. Plain JSON
never does, so this tool has to infer it — and an inferred link that is wrong is actively worse than
one that never appears, because a JSON:API-trained eye reads *any* rendered link as a claim the tool
is making, not a guess. The rule that follows exists to keep every rendered link a claim this tool
can actually stand behind.

### The rule

A candidate identifier is a scalar at a **bare** id-like key (`id`, `uuid`, `guid`, `key`, `code`,
`ref`, `slug`, matched case- and separator-insensitively), a scalar at a **compound** key naming a
container (`user_id`, `fooId`, the plural `order_ids`/`barIds` applied to each element of an array),
or any string anywhere shaped like a UUID, ULID or 24-hex-character ObjectId.

- A bare-key occurrence is a **definition**, scoped to the container name of the object it sits on —
  the last non-index segment of *that object's* pointer, not the id field's own pointer. Clicking a
  reference lands on the object, not on its `id` attribute.
- A compound-key occurrence is a **reference**, scoped to the name the key implies. Both a
  definition's and a reference's scope are reduced through the same `canonicalScope` before
  comparison, which is what lets `user_id` find a `users` collection — see that function's own
  comment for the one non-obvious rule it needs (`pages → page` without breaking `boxes → box`) and
  the narrower class it still gets wrong (`house`, `response`).
- A UUID/ULID/ObjectId match **ignores scope entirely** and matches on value alone, because those
  formats are unique by construction. This is the one case where matching is *unconditional* — it
  wins even when a compound key would otherwise imply a different scope, because the format itself
  is already enough evidence.
- **Two or more definitions sharing a scope and value make every reference to them ambiguous.**
  Never resolved by picking the first, the most recently defined, or the one earlier in document
  order — an ambiguous identity is shown, counted, and left unlinked.
- **A reference with no matching definition is dangling**, full stop, regardless of how many times
  it occurs — it feeds the same panel a JSON:API dangling pointer already does.
- A lone, unreferenced value at a bare id-like key is not treated as an identity at all. It is an
  ordinary attribute that happens to be named `id`; nothing about it is inferred.

### Why scoping by container name, and not something looser

A looser rule — any repeated value anywhere is "the same identity" — was considered and rejected: a
bare `1` recurs constantly across unrelated objects in real payloads (page numbers, boolean-ish
flags, the first row of every table), and treating every recurrence as one identity would produce
links between things that have nothing to do with each other. Scoping by container name is what
keeps `orders[].id: 1` and `users[].id: 1` from ever being confused, without needing a person to
disambiguate anything by hand.

### What this means for later tasks

T2's request-scoped anchors (`q_`, `b_`, `d_` in D1, above) sit beside this graph rather than
inside it — a request body's own plain-JSON identities are a
separate `JsonIndex`, not merged into the response's. Cross-document identity (matching an id
between a request and its response, or between two separately pasted documents) is explicitly out
of scope for T1 and is not something this decision authorises; if a later task wants it, that is a
new decision, not an extension of this one read loosely.

### Rejected alternative

Matching greedily — any two equal scalars are the same identity regardless of key or scope — needs
no container-name logic at all and would catch more real links. It was rejected for the reason
above: on a real payload it produces enough wrong links (via nothing more than two unrelated `1`s)
that the feature would train people to distrust every link it draws, which defeats the point of
drawing any.

---

## D4 · A decoded parameter is a reading plus its alternatives, never a resolved scalar alone

**Date:** 2026-09-03 · **Settles:** what `params.ts#decodeParams` hands back for one query-string or
form-urlencoded parameter, and what T3's importers and T4's diagnostics may assume about it.

### Why this is load-bearing

`docs/task-specs/T2.md`'s Parameters section exists because this codebase has already shipped two
defects shaped exactly like "a heuristic that looked right and picked silently" — a broken pointer
from treating any `id`-suffixed key as a reference, and a falsy-`[]` check that skipped restoration
entirely. A parameter decoder is the same trap with a wider mouth: `a=1,2` is a list under the
JSON:API convention this tool is built for and the literal three-character string `"1,2"` under
Express's, and the wire text cannot tell you which. Every later diagnostic (T4) and every importer
that writes a `ParamSet` (T3) reads or produces this shape, so what "a decoded parameter" *is*
has to be settled once, here, rather than re-derived differently by each.

### The rule

A `ParamEntry` separates two independent axes of ambiguity, and never collapses either into a single
guessed answer:

- **Key shape** (which convention governs the pair's syntax — bare, `a[]`, `a[N]`, `a[key]`, `a.key`)
  is unambiguous for one pair in isolation, but two pairs for the *same top-level name* can use
  syntaxes that cannot both be true at once (`a=1` beside `a[]=2`). This is a **conflict**:
  `value`/`convention` are left unset, and `conflict` carries every incompatible reading the wire
  data implies — not the first one, not the "most common" one, all of them. Detected by bucketing a
  name's pairs into bare/index-like/key-like and treating more than one non-empty bucket as a
  conflict, at any count (two incompatible syntaxes or three).
- **Value shape** (how one scalar wire value reads — comma list, space/pipe list, a JSON literal,
  base64url-encoded JSON, or plain text) is genuinely ambiguous from the wire text alone. The decoder
  picks the JSON:API-shaped reading as `value`/`convention` (this tool exists to read JSON:API) and
  keeps every other plausible reading in `alternatives`, each located by `path` within the
  parameter's own value — so a leaf several levels deep (`filter[status][in]`'s comma list) can be
  flagged without disturbing the object around it.
- `conventions` lists every convention actually used anywhere while decoding one entry, not just the
  outermost — `filter[status][in]=booked,held` reports both `bracket-object` and `comma`, because
  both are true of how that one parameter was read.
- **Nothing here is guessed away silently, and nothing is thrown either.** A malformed key, an
  unresolvable value, a value that happens to be short/plain — every case in `params.ts` returns a
  value; none of them raise.

### What this means for T3 and T4

- **T3's importers** produce `Partial<Exchange>` values that merge through `mergeExchange`
  (`docs/task-specs/T3.md`'s own Interface section). Any importer that builds a `query`/`form`
  `ParamSet` by hand (rather than by calling `decodeParams` on wire text it already has) must produce
  entries shaped this way — in particular, it may not resolve an ambiguous value to a bare scalar and
  drop the alternative, and it may not paper over a genuine key-syntax conflict by picking one
  reading. If an importer's source format has its own unambiguous notion of a parameter (a HAR
  entry's already-parsed query array, say), the honest encoding is still `convention: "plain"` per
  value with no invented ambiguity — never a convention the source format did not actually use.
- **T4's diagnostics** may read `entry.value`/`entry.convention` as this decoder's best single answer,
  but a check that depends on knowing whether a value was genuinely ambiguous must look at
  `alternatives`/`conflict` rather than assume `value` is the only defensible reading. A cross-check
  that silently prefers `value` over a live `conflict` reproduces the exact failure mode this
  decision exists to prevent, one layer up.

### Rejected alternative

Picking one reading and exposing the rest only as a debug/verbose field — the shape most decoders
default to — was rejected because it reintroduces the choice this task exists to remove: a "debug"
field nobody reads by default is functionally the same as not having the alternative at all, and this
release has already shipped two defects that were exactly one unread edge case away from being
caught. Making `alternatives`/`conflict` first-class, typed members of `ParamEntry` — not an optional
afterthought — is what makes it possible for T2b to render "read as a list, click to read as text"
as a normal interaction rather than a debugging feature, and for T4 to check them at all.

## D5 · One function decides version 2 vs version 3, and it is not UI code

**Date:** 2026-09-03 · **Settles:** where the "one document seals as a plain share, several seal as a
bundle" decision lives, for every future caller

### Why this is load-bearing

T6 needed this decision in exactly one place: `openLibraryModal`'s selection mode must never mint a
bundle for a single tick (an acceptance criterion, tested on the sealed bytes' version byte, not a
variable). T7's task spec asks for the identical decision — `share` takes a document list and seals
"one document or a bundle" — from a caller that never touches the DOM at all.

### The choice

`mintShareEnvelope(documents: BundleEntry[], secret: string)`, in `src/bundle.ts`, is the one place
that branches on count: exactly one document calls `seal` (T5's version-2 path, unchanged), anything
else — including zero — calls `sealBundle` (which already refuses zero, correctly, at version 3's own
layer). Nothing else in the client makes this decision; `share.ts`'s `openShareModal` and
`openBundleShareModal` are both thin wrappers that build a `BundleEntry[]` and call this function.

### What T7 should do

Import `mintShareEnvelope` from `src/bundle.ts` rather than re-deriving the one-vs-many rule against
`seal`/`sealBundle` directly. It takes no DOM, no `i18n` rendering dependency beyond `crypto.ts`'s own
error catalogue (already required for `seal`/`sealBundle` to run at all), and no store dependency — it
is safe to call from a module with no UI. If T7's document list needs a different shape than
`BundleEntry`, either satisfies it structurally (as `LibraryEntry` already does, being a superset) or
the two task's needs have diverged enough that this decision should be revisited here, not solved
twice.

### Rejected alternative

Leaving the decision inline in each caller (`openShareModal` checking `if (documents.length === 1)`
itself, `openBundleShareModal` never receiving fewer than two by convention) — rejected because
"by convention" is exactly the kind of invariant that survives until the second caller, and T7 is
already a known second caller before this entry was written.

### A warning for T2, left here because this is where the wiring already reaches the network

`mintShareEnvelope` seals whatever `Exchange` a `LibraryEntry`/`BundleEntry` carries, unredacted, and
`panels.ts`'s selection flow hands whole library rows to it — so the moment something writes a real
`Exchange` onto a saved document, sharing it (singly or in a bundle) uploads that `Exchange` as-is.
Today this is inert: nothing in this codebase writes an `Exchange` yet, T6's own review confirmed it
by inspection, and building a redaction gate is explicitly T2's task, not T6's. **T2: redaction has
to run before a document's `Exchange` reaches `mintShareEnvelope`, on both the single-document and
the bundle path, since both go through the same function** (see the header of this entry). The
sealing code itself carries the same warning inline, at the two points `exchange` is read
(`src/bundle.ts`, `mintShareEnvelope`).

### The number this entry ended up with

The renumbering this entry once warned about has happened, and this records the
outcome so nobody re-derives it: **D3** is T1's identity scoping, **D4** is
T2a's parameter model, and this entry is **D5**. Every reference was moved in
one change — `src/bundle.ts`, `STATUS.md`'s T6 row, and `docs/evidence/T6.md`.

---

## D6 · The review shows the response body as a summary and a jump link, never a second full render

**Date:** 2026-09-03 · **Settles:** what "each body as its own lens" (`docs/task-specs/T2.md`'s
review section) means for the *response* body specifically, for `src/render-request.ts` and any
later task that touches the band.

### Why this is load-bearing

The spec's review section says the open band shows "the parameter table, headers, cookies, and each
body as its own lens" — read literally and applied evenly to both sides, that would mean re-running
the full JSON:API/plain-JSON resource tree a second time for the response body, immediately above the
exact same tree already rendered as "the document" below it.

### The choice

For the **response** body only, the review shows a one-line summary (shape, resource/type or item
count, byte size) and a link that jumps to the existing document view below — the same content,
never duplicated. For the **request** body, this does not apply: there is no other rendering of it
anywhere on the page, so it gets the full anchored treatment (`b_`/`d_`-scoped resources or tree) the
spec asks for, unabridged.

### Why not render it twice

Three reasons, any one of which would be enough on its own:

- **Anchors.** The response's resource tree already mints every `r_`/`n_` id it needs. Rendering the
  same document a second time inside the band would need either a *third* anchor scope for "the
  response, rendered again" — which D1 does not define and nothing needs — or silently duplicate ids,
  which is the exact failure D1 exists to prevent.
- **Cost.** `render-resource.ts`'s own header explains why the response path builds HTML strings
  rather than DOM nodes: at 50,000 resources, per-node creation is measurably too slow. A response
  that size would pay that cost twice for a band whose whole premise is a **collapsed-by-default
  summary** — the opposite of what a full tree is for.
- **There is nowhere for it to disagree.** The document below is already the authoritative, complete
  rendering of the response body; a second copy inside the band cannot show anything the first does
  not, so duplicating it buys nothing a link does not already give for free.

### What this means for later tasks

T4's cross-checks (request vs. response) do not need a second set of response anchors to link
findings to — they link to the ones the document already has. A future task that wants the response
body *editable* from within the review (there is no such requirement today) would need to revisit
this decision explicitly rather than assume the summary can simply grow into a tree.

### Rejected alternative

Rendering the response body's tree inside the band too, gated behind a size threshold (full tree
under some resource count, summary above it) — rejected for being two behaviours where one is
simpler and neither loses anything a user needs: below the threshold the "second tree" is small
enough to be cheap but is still a duplicate of what is already on screen one scroll away, so the
threshold buys safety at large sizes without buying anything at small ones.

---

## D7 · The share key travels in the fragment, and never in the path

**Date:** 2026-09-21 · **Settles:** the shape of a share link, for `src/router.ts`, `mcp/`, and
every document that describes what the server can see

### Why this is load-bearing

Two sentences in the product — the share dialog's lede ("the server stores an opaque blob it cannot
read") and `/privacy` ("the server receives ciphertext it cannot read") — are claims about what
reaches the origin. Until this entry, the key reached it: a link was `/d/<id>:<secret>`, so opening
one issued `GET /d/27%3AAaMYMLyMlq` and the key landed in the request line, in `Referer`, and from
there in Cloudflare's access log, whose own retention `/privacy` documents under *Hosting and server
log data*. Anyone holding those log lines held both halves of the encryption, and the two sentences
above were false. This was found by the production QA pass of 2026-09-20 (finding F3).

### The rule

**A share link is `<origin>/d/<id>#<secret>`.** The key is a URL fragment, which a browser strips
before building the request and never sends in `Referer` — so it is absent from the origin, from
every proxy and CDN in between, and from anything either of them logs. `shareUrl` in
`src/router.ts` is the only place a link is minted in the app, and `mcp/build-server.ts` the only
other place in the repository; both produce this form and nothing produces the old one.

`/d/<id>:<secret>` and `/d/<id>.<secret>` are still **parsed**, forever, because links already sent
to people have to keep opening. Parsing them is not an endorsement: those links put their key in a
log the first time anyone opens them, and that cannot be undone from here.

A path under `/d/<digits>` with no usable key is `{ kind: "share-damaged" }` — a broken share link,
not a missing page. The most likely cause is now something along the way eating the fragment, so
the message names that rather than claiming the page does not exist. It is decided from the URL
alone and never asks the server whether the id exists, so it introduces no oracle.

### What this does not buy, and must not be claimed

The origin still serves the JavaScript that holds the key, so anyone able to change what `/d/*`
serves can exfiltrate it. Browser-delivered end-to-end encryption is always trust in the origin.
What the fragment guarantees is **passive**: the key is not in what the server receives, stores or
logs. `/privacy` says exactly that and no more, and a later change that makes it say more is wrong
even if the code has not changed.

### What enforces it

`test/router.test.ts` asserts that `shareUrl` emits a `#` and that the colon form still parses;
`test/mcp/tools.test.ts` asserts the same for the MCP `share` tool's `url`. A change putting the
key back in the path contradicts this entry and must amend it in the same pull request — and must
also correct the two sentences above, which would become false again.

### Amendment (N3, 2026-09-28) · an encoded fragment is accepted, because the exposure already happened

The 2026-09-28 production QA pass (finding N3) found a link whose `#` had been rewritten to
`%23` by something between sender and recipient — a URL sanitiser, a wiki or Markdown renderer.
Cloudflare's asset router normalises that path first, so it reaches `parseRoute` still
percent-encoded, and `parseRoute` already `decodeURIComponent`s the pathname before matching
anything (it has to, for the legacy `:`-form's own `%3A`). Decoded, `/d/30%23e4iDnHELrg` becomes
`/d/30#e4iDnHELrg` — a literal `#` sitting inside the *pathname*, which cannot happen for a real
URL any other way: an *unencoded* `#` always starts the fragment before a pathname is ever built,
so nothing that went through a browser or a `fetch` could hand this function a genuine `#` there
unless it started life percent-encoded.

Before this amendment, `parseRoute` treated that shape as `share-damaged` — "this link is missing
its key" — which was false and actively harmful: the key was not missing, it had already been sent
to the origin, in the request line, before the page's own JavaScript ever ran. The damaged-link
message pointed the visitor at the wrong problem (a cut-off link) and hid the real one (a link that
needs to be treated as burned).

**The rule, extended:** `parseRoute` recognises `/d/<id>#<key>` inside the decoded pathname itself
and opens the document, exactly as it would the ordinary fragment form — refusing protects nothing
against the one exposure that has *already* happened by the time this function runs: the browser's
own request for the page at `/d/<id>%23<key>`, sent before any of this app's JavaScript exists to
refuse anything. The route carries `keyExposed: true` (`src/router.ts`'s `Route` type) so the
caller can say so, and `main.ts`'s `loadSharedDocument` does: it shows a distinct toast naming the
link as exposed instead of the ordinary "opened a shared document" one, for both a single document
and a bundle.

This does not weaken what the entry above promises. The promise was always about the *ordinary*
minted form (`shareUrl` still only ever produces `#`, never `%23`); this amendment is about how the
app responds to a link that was already damaged in transit by something outside the app's control,
and "pretend it was never opened" does not un-send the request that already went out. A
double-encoded key (`%2523…`) decodes once to the literal text `%23`, not to a `#` character, so it
does **not** match this branch and still reaches `share-damaged`, same as before.

#### Which channels this closes, and which it does not (review round 1, S1 — PR #27's implementer draft got this wrong)

The first draft of this entry said the exposure "has already occurred" and left it there, as though
nothing after that point could still leak the key. That was too strong, and the round-1 review
(escalated, `crypto.ts`/`share.ts`-adjacent) caught the gap: there are **three separate requests**
that can carry a path-borne key to this origin, not one, and this amendment only ever closed one of
them.

1. **The page request** — the browser's `GET /d/<id>%23<key>` (or, for a legacy link,
   `GET /d/<id>:<key>`) that loads the app in the first place. Nothing client-side can touch this;
   it is sent before a single line of this app's JavaScript runs. It reaches `worker.ts`, which
   this Worker's `wrangler.jsonc` configures with `observability.enabled: true` and
   `head_sampling_rate: 1` — every request is logged, retained, and readable in the operator's
   dashboard, not merely "on the wire and gone". **This channel is not closed, and cannot be, by
   anything in this repository's client code.** It is a configuration question for the repository
   owner — a lower sampling rate, `observability.logs.invocation_logs: false`, or moving `/d/*` off
   the Worker entirely — tracked as an open ask in `STATUS.md` §4, not fixed by this task.
2. **This app's own follow-up request**, `fetch("/api/shares/<id>")` in `share.ts`'s `fetchShare`,
   which decrypts the document once the ciphertext arrives. Before round 1, `loadSharedDocument`
   called `navigate(VIEW_PATH, { replace: true })` — the line that drops the key from the visible
   URL — *after* `await fetchShare(...)`, so at the moment that `fetch` fired, `location` was still
   `/d/<id>%23<key>` (or the legacy `:key` path). This page's referrer policy is
   `strict-origin-when-cross-origin`; for a same-origin request that sends the *full* current URL as
   `Referer`, path and all — so this app was handing its own key to the same origin a second time,
   through a header not even involved in the document's own contents, and that Worker's request
   logging would have kept that copy too. **This channel is what round 1 actually fixed**:
   `navigate` now runs *before* `fetchShare`, so by the time that request fires `location` is
   already `/view`, key-free, and `Referer` carries no key for either the `%23` form or the legacy
   `:`/`.` form. An ordinary `#`-fragment link was never exposed here in the first place — the
   Referrer Policy spec strips the fragment from a `Referer` value unconditionally, for every
   policy, before this app ever had a chance to — so this fix changes nothing for that case.
3. **The page's own subresource requests** — the module script, the stylesheet, and the small
   assets `index.html` links (`favicon.svg`, `icon-192.png`, `apple-touch-icon.png`,
   `site.webmanifest`). The browser issues these while parsing the shell, before `main.ts` has run a
   single line, so — same as request 2 was before round 1 — each one's `Referer` is still
   `/d/<id>%23<key>` (or the legacy `:key` path) under this page's `strict-origin-when-cross-origin`
   policy. Found in review round 2 (S3, PR #27), after round 1 had already fixed request 2 and
   named request 1. **What is and is not known about this channel:** every one of these paths is a
   real file, and `wrangler.jsonc`'s `run_worker_first` names only `/api/*` — so, as far as static
   reading of the config shows, the asset router answers all of them directly and none reaches
   `worker.ts` or its `observability` config at all. That reading was **not verified against a
   running Worker** — nobody has confirmed by observation that a subresource request for a share
   route never invokes the script. Recorded here as what is believed and why, not as a settled fact,
   because the difference matters: if it turns out these *do* reach the Worker, this channel joins
   channel 1 (a configuration question, not something this repository's client code can fix); if
   they genuinely never do, this channel is arguably already closed by Cloudflare's own asset
   routing, and the only open question is the `Referer` header itself still leaving the browser
   toward *this* origin — lower-stakes than channel 1's logged-and-retained case, but not nothing.
   **Left unclosed by this task.** A `Referrer-Policy: no-referrer` (or `strict-origin`) set on the
   shell response for `share` routes in `serveShell` would close it — and channel 2 as a second,
   redundant layer alongside the S1 reordering — but that is a behaviour change to a document
   already reviewed and approved once, so it is deliberately left as a follow-up rather than folded
   into this round; see `STATUS.md` §4.

So: **the page-request channel (1) stays open, is a deployment decision, and is out of this entry's
control. The follow-up-request channel (2) is closed, for both link forms that can carry a
path-borne key. The subresource channel (3) is believed, but not confirmed, to already avoid the
Worker's own logging — and is left open as a `Referer`-header question regardless, tracked as a
follow-up.** Saying "the exposure has already occurred" without this distinction let a fixable leak
look like an already-lost cause; it was not, and channel 3 shows the distinction has to be redrawn
carefully rather than assumed complete once redrawn once.

#### QA4 (2026-09-28): channels 1 and 3 are now closed at the configuration level

**Channel 1, the page request's Workers Logs entry — closed.** `wrangler.jsonc` now has
`observability.logs.invocation_logs: false` (with `enabled: true` and `head_sampling_rate: 1`
untouched). Per Cloudflare's Workers Logs documentation, each Fetch invocation otherwise produces one
invocation log whose message is the request method and URL, with request metadata and headers,
retained for 7 days; since #26 every page path invokes the Worker, so a legacy or `%23` link's key
would have been written there. With invocation logs off that entry is not produced. The Worker's own
`console.*` output and uncaught exceptions still reach Workers Logs, and `test/worker.test.ts` fails
if a `console.*` call in `worker.ts` ever mentions a URL, path, header or `Referer`. An ordinary `#`
link was never affected (the fragment never reaches the server).

*What the operator gives up:* the per-request "GET /path — 200" line, the request metadata and the
per-invocation status/CPU/wall-time record in Workers Logs, **for every path, not only share paths**
(the log cannot tell a key-bearing path from any other, and there is no redaction). Diagnosing "did
this request arrive, and what did it get?" now needs `wrangler tail` live, or Cloudflare's separate
edge analytics, rather than a retained search. A cost was accepted deliberately over a lower sampling
rate, which would only have made the leak sparser. **Not closed by this:** Cloudflare's own edge/HTTP
request logs, a different pipeline that this repository cannot configure and `/privacy` already
documents under *Hosting and server log data*; that is the residue D7's main text describes for
legacy links. **One thing the setting is not known to cover:** Cloudflare documents that Workers Logs include
"errors, and uncaught exceptions", and that the request metadata and headers are captured into the same
per-invocation trace object; its documentation does not say whether that metadata (the request URL)
is still attached to an exception entry when invocation logs are off. If it is, an uncaught exception
thrown while serving a legacy or `%23` link (for example an `env.ASSETS.fetch` rejection in `serveShell`)
could still write the key. Nothing in this Worker is expected to throw there, and no `console.*` call
mentions the request, but "exceptions still land in Workers Logs" must not be read as "harmlessly".
Check it in the dashboard once (STATUS §4) and amend this entry with what is found. Whether the production Workers Logs pipeline honours the setting was not observable
from a local `wrangler dev` (see `docs/evidence/QA4.md`); it rests on Cloudflare's documented
behaviour and should be confirmed once in the dashboard after the first deploy.

**Channel 3, the subresource `Referer` — closed.** `referrerPolicyForRoute` (`src/router.ts`) makes
`serveShell` send `Referrer-Policy: no-referrer` on the page response for `share` and `share-damaged`
routes, replacing (`Headers.set`, exactly one header) the `strict-origin-when-cross-origin` the shell
inherits from `public/_headers`. The policy governs every request the document makes, including the
module script, stylesheet, icons and manifest issued before any app code runs, so none of them carries
the path-borne key in `Referer`. Every other route keeps the site-wide policy. The 405 for a share
route carries it too, though it is inert there (no body, so no subresources): one rule with no
exception is easier to state and to test. `SECURITY_HEADERS` still mirrors `public/_headers` exactly;
the override is applied on top of it, outside that mirror. Side effect: that document sends no
`Referer` for its whole lifetime, including on its own `/api/shares/<id>` request (channel 2, now
doubly closed) and on external links clicked from it. Channel 3's former uncertainty about whether
subresources reach the Worker is moot: either way they now carry no key.

#### Why the legacy `:`/`.` in-path forms never get `keyExposed` (review round 1, N1)

Only the new `%23` branch sets `keyExposed: true`. `SHARE_PATTERN` (the `:`/`.` legacy match) runs
*before* it in `parseRoute` and returns first, so a legacy link never reaches the `%23` branch at
all — and this is deliberate, not an oversight the pattern order happens to produce. `keyExposed` is
meant to flag something that happened to *this specific link*, in transit, after it left whoever
minted it: a `#` a renderer rewrote. A legacy `:`-path link's key was in the path from the moment it
was minted — under the model this repository used before D7's original 2026-09-21 entry — so there
is nothing "newly exposed" to report about one; every legacy link has carried this exposure since it
was created, and saying so on every single legacy link a visitor happens to open would be noise
repeating a fact D7's main text (above) already states plainly: those links "put their key in a log
the first time anyone opens them, and that cannot be undone from here." `keyExposed` is about a
link's *transit*, not its *vintage*.

### Rejected alternatives

- **A password or passphrase on the link** — rejected: it solves the same problem by making every
  recipient do work, for a tool whose whole premise is paste-and-read.
- **Deriving the fetch id from the key** (`id = H(secret)`, so the server never sees an independent
  identifier) — rejected as strictly worse: it turns the logged id into a fast hash of a 60-bit
  secret, brute-forceable offline in days, where `crypto.ts`'s PBKDF2 stretching currently puts
  that at millions of GPU-years.
- **Scrubbing the key out of the logs instead** — not available. Logpush, the only customer-facing
  HTTP log pipeline, is Enterprise-only, and its filters drop whole records rather than redacting a
  field. The reachable mitigation for already-logged keys is to delete the shares they open, not to
  edit the log.

---

## D8 · Every share carries the attached request, redacted in one place; a masked value is absent from the DOM, not hidden

**Date:** 2026-10-08 · **Settles:** what a share contains, and where a secret may exist in the page,
for `src/share.ts`, `src/bundle.ts`, `src/render-request.ts` and `src/main.ts`

### Why this is load-bearing

PROCESS §4 says masking that can be walked around by exporting or sharing is not masking. Until QA6
the app had two Share buttons that disagreed: Library → Share sealed the request (redacted) and
stated the count, while the overview's own Share silently dropped it. And a "masked" header or
cookie value was still in the document as text, hidden only by `display:none`.

### The rules

1. **Every share path seals the request, and `mintShareEnvelope` (`bundle.ts`) is the only place that
   masks it.** Both dialogs are one function, `openShareModal`/`runShareModal`, and both state the
   count (and the unredacted-body note) through one function, `inspectExchangeForShare`. A caller
   that forgets to redact cannot leak, because redaction is below the callers, not in them. Adding a
   share entry point means passing the exchange to `mintShareEnvelope`, never a second masker.
2. **A secret-shaped value is not in the DOM until revealed.** The cell holds a mask, a button and a
   *locator* (`data-x-secret="req.header.2"`: side, table, position). Reveal resolves the locator
   against the live exchange and inserts the text; hide removes it. Nothing, including attributes
   and `title`s, carries the value. This is the "pointer, not copy" rule of PROCESS §6 applied to
   secrets, and `display:none` is not an implementation of it.
3. **A library entry follows its open document's request** only when the document was saved or
   opened *as* that entry: `libraryId`, carried on the stored current-document record so it survives
   a reload (an optional field, no schema change). **There is no same-text fallback** — an opened
   share link or a fresh paste can match a saved entry's text without being it, and writing its
   request over the entry destroys the saved one. The read and the write are one transaction
   (`setExchangeInLibrary`).
4. **An assumed `https://` needs something that could be a host** (`canBeHost`, defined in
   `docs/task-specs/QA6.md`). `host:digits` is a host and a port.

### What this does not buy

**A share is redacted as far as the detector can recognise, not completely.** `redactExchange` rewrites
header and cookie values, the URL's userinfo, query and fragment, the value of `Location`, `Referer`,
`Content-Location` and `Origin` (through the same URL redaction), `query`, a clean form body and the
provenance field `origin`.

**A form body is recognised from what is stored, by one function.** `classifyBody` (`secrets.ts`) is called
by the screen, the redaction and the share dialog's warning: content type `application/x-www-form-urlencoded`,
empty or `text/plain`; text not starting with `{ [ " <` **whatever the content type**; no whitespace and no `;`;
every parameter name, once percent-decoded, only letters, digits and `_ . - [ ]`. This exists because
`BodyPart.form` is never populated by the app, and redacting only when it was is what shipped broken until the
blind QA of 2026-10-09. **Redaction tests must use the shape the real UI produces** (`test/form-redaction.test.ts`
drives the real request form).

**A name that will not decode** (`user%5Bpa%ZZss%5D`) is judged on its raw text and makes a form body **not clean**, so it
warns. **The count is the number of masked values**, wire pair by wire pair: `a[]=1&a[]=x&a[pass]=2` is three.

**Fail closed.** The "this body may contain credentials" warning is suppressed only for a body that is a clean
form, was redacted, and has no credential-like name or value left. **Every other non-empty body warns**, whatever
its content type and whatever the sniffer says — JSON (benign included), text, multipart, an unclean form, a
rewritten form with leftovers. Over-warning is safe; a silent share is not. A body that is not a clean form is
never rewritten and never called safe. The count only counts values actually masked.

**Secret parameter names** are matched in a query or a form body, **percent-decoded first** (as far as they decode: a
browser submits `user[pass]` as `user%5Bpass%5D`; `%5b` and a double-encoded `%255B` too), per bracket/dot segment (`user[pass]`,
`data.pwd`): the substrings `token secret signature sig apikey password passwd pwd authorization credential
privatekey clientassertion codeverifier passphrase passcode`, and the **whole** names `pass auth session
sessionid sid bearer cookie otp` (whole names only, so `passport`, `bypass`, `compass`, `author`, `authority`
and `sessionization` stay readable). `key` and `pin` are deliberately not listed (a sort key, a map pin).
**`code` is masked only when the same parameter set carries OAuth context** (`grant_type`, `redirect_uri`,
`client_id`, `code_verifier`, **or a `state`** — the standard callback is `?code=…&state=…` with no `client_id`): OAuth's
authorization code is a credential, but `code=US` and `code_style` are ordinary, and a name-only rule would mask both. The
`state` rule's accepted cost: an address-like `code=US&state=CA` is masked too (a click to reveal, against a login code left
in a `Referer`). A bare `code=4f2a9c` with no OAuth sibling is therefore not masked
(listed below).

**The userinfo rule.** The *whole* `user[:password]@` prefix is masked as one counted value
(`https://[REDACTED]@host/…`), never just the password and never conditionally on the user name "looking like a
credential". Stripe (`https://sk_live_…:@<api host>`) and GitHub (`https://<token>:x-oauth-basic@<git host>`) put
the secret in the **user name**, and deciding by shape is the detector gap this rule exists to avoid. Cost: an
ordinary user name is hidden too. (`sip:alice:secret@host` over-redacts to `sip:[REDACTED]@host`; harmless, not
what this tool reviews.)

**It does not catch** (and nothing in this entry or the UI may claim more than this):
- a secret under a name the detector does not list, with a value of no recognisable shape — `X-Session: s3cr3t`
  as a header, or `mykey=abc123` in a clean form or a query (the name is not on the list and the value is short and
  shapeless). A clean form with such a pair is **not** warned about, because nothing credential-like is left in
  it by any test this module has;
- a bare `code=…` with no OAuth sibling;
- any URL-valued header other than `Location`, `Referer`, `Content-Location` and `Origin`;
- a token inside a URL **path** segment;
- a credential inside a JSON, text or multipart body, or in a form body the strict rules reject (`;`-separated,
  multi-line, a name with `{ " : =`, spaces in a value): these bodies are **flagged**, never parsed or rewritten, and
  go into the share as they are.
Dropping every flagged body was rejected: it would drop most response bodies. The decoded-JWT claims panel under a
masked `Authorization` header is unchanged and shows claims, never the token.

### On-screen masking

The same rule applies to the request URL's userinfo and credential-like query parameters, to
credential-like query/form-body parameters, and to the value of `Location`, `Referer`, `Content-Location`
and `Origin`: only a mask (or the URL shown redacted, with no `href`) is in the DOM until revealed. The
screen decides with the same functions the share uses (`classifyBody`, `maskUrlForDisplay`,
`isSecretParam`), including for URL text that does not parse (`admin:pw@host/x`, `not a url?api_key=…`).
A JSON/text/multipart request body is shown as text.

### Rejected alternatives

- **Keep omitting the request from the document's Share and say so** — rejected: the two buttons
  would still disagree, and the request is most of what a recipient needs.
- **Hide the value with CSS, as before** — rejected: not hidden from scripts or extensions.
- **Reveal by re-rendering the band with the value** — rejected: it would lose scroll and fold state
  that the in-place toggle keeps; the toggle edits one cell.
- **Update every library entry with the same text** — rejected: overwrites a request the user attached
  to a different saved copy.
