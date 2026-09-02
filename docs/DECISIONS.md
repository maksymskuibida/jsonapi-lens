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
