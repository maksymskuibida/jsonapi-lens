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

---

## D4 · Identity inference is scoped by container name, and would rather miss a link than mint a wrong one

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

## D5 · A decoded parameter is a reading plus its alternatives, never a resolved scalar alone

> **Numbering note:** assigned as the next free slot as of this PR (D3 is reserved by T6's
> not-yet-merged branch; D4 is T1's, already on `integration/wave1`). Confirm this does not collide
> before merging — see the T2a pull request body.

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
