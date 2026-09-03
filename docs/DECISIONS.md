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

**Date:** 2026-09-03 · **Settles:** how T5's types reference a model T2 has not built yet

### Why this is load-bearing

T5 (storage and the share envelope) attaches an optional exchange to four different types —
`StoredDocument`, `LibraryEntry`, `SharePayload`, `BundleEntry` — across the two files it owns that
carry one (`store.ts`, `crypto.ts`). The real shape of a captured HTTP exchange is T2's design, built
in a later wave, and [T5's task spec](task-specs/T5.md) is explicit that T5 must not block on it.

### The choice

`src/exchange.ts` is a new module exporting one interface:

```ts
export interface Exchange {
  readonly [key: string]: unknown;
}
```

Every type that carries an exchange imports `Exchange` from this module, rather than each declaring
its own inline `Record<string, unknown>`.

### Why not the inline alternative

The task spec offered two options: declare the field inline as an opaque, structurally-typed payload
"that T2 narrows", or import the type from a module T5 creates and T2 fills in. An inline
`Record<string, unknown>` repeated at four call sites is equally valid TypeScript, but T2 replacing it
later would mean editing four sites across two files in lockstep, with nothing that fails to compile
if one is missed. A dedicated module means T2 edits **one file** — the body of `exchange.ts` — and
every consumer that only carries the value forward, never reading a field off it, keeps compiling
unchanged.

### What T2 must do

Replace the body of `src/exchange.ts` with the real interface. No other file that imports `Exchange`
needs to change unless it starts reading a specific field off it — none of T5's code does, by design.

### Rejected alternative

Waiting for T2 to land before starting T5 — rejected outright, since it defeats the point of running
T1 and T5 as a wave. `docs/STATUS.md` §1a's dependency graph (`T5 → {T2, T6, T7}`) requires T5 to ship
first, and this module is what makes that possible without T5 guessing at T2's design.

---

## D3 · One function decides version 2 vs version 3, and it is not UI code

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

### A number this entry may not keep

This is the first `D3` on any branch, but `docs/DECISIONS.md` does not exist on `main` yet, and both
T1 and T5 independently created it with their own, different `D2`. Whichever integration merges those
two will have to renumber one of them, and every `D3`-and-later entry — this one included — most
likely shifts to `D4`. Do not renumber pre-emptively on this branch; follow whatever number the
integration assigns once it exists, and update every reference to "D3" in this repository's docs
(`STATUS.md`'s T6 row, this file's own cross-references, anything in a later task's brief) together,
in one change, rather than piecemeal.
