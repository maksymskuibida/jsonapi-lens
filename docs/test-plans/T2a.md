# Test plan — T2a The exchange model and decoders

**What this task changes, in one paragraph.** Five new pure modules — `src/exchange.ts` (filled in
from T5's placeholder, per [D2](../DECISIONS.md)), `src/params.ts`, `src/headers.ts`,
`src/cookies.ts`, `src/secrets.ts` — that together define the `Exchange` model, the single
`mergeExchange` write path, one parameter decoder for query strings and
`application/x-www-form-urlencoded` bodies, header/cookie parsing, and secret detection, JWT
decoding and redaction. No DOM, no `t()`, no network, and nothing wired into `main.ts` or any
render path — this half of T2 has no observable surface. That is T2b's job, on top of this one.

## Scope

- **In scope:** the `Exchange`/`RequestPart`/`ResponsePart`/`BodyPart` types and `mergeExchange`; the
  parameter decoder (`decodeParams`/`encodeParams`) and its JSON:API views (`includeTree`,
  `sortFields`); header lookup (`headers.ts`); cookie and `Set-Cookie` parsing (`cookies.ts`); secret
  detection, `Bearer` JWT decoding, and `redactExchange` (`secrets.ts`).
- **Out of scope, covered elsewhere:** the field-separated form, the three-mode review, the request-
  scoped anchor scopes (`q_`/`b_`/`d_` — already built by T1 per [D1](../DECISIONS.md); T2a mints
  none of them, T2b does), `StoredDocument`/`LibraryEntry`/`SharePayload` persistence (T5, already
  shipped; T2a only changes what `Exchange` itself contains), and every importer (T3). See the split
  note at the top of [T2.md](../task-specs/T2.md).

## Cases

| # | Scenario | Expected | How verified |
|---|---|---|---|
| 1 | Repeated key `a=1&a=2` | `["1","2"]`, convention `repeated-key`, round-trips | automated (vitest) |
| 2 | Bracket list `a[]=1&a[]=2` | `["1","2"]`, convention `bracket-list`, round-trips | automated (vitest) |
| 3 | Indexed `a[0]=1&a[1]=2`, and out of order | `["1","2"]`, convention `indexed`, sorted numerically, round-trips | automated (vitest) |
| 4 | Comma `a=1,2,3` | `["1","2","3"]`, convention `comma`, plain string offered as alternative, round-trips | automated (vitest) |
| 5 | Space delimited `a=1%202` | `["1","2"]`, round-trips | automated (vitest) |
| 6 | Pipe delimited `a=1\|2` | `["1","2"]`, round-trips | automated (vitest) |
| 7 | Bracket object `a[b]=1` and nested `a[b][c]=1` | `{b:"1"}` / `{b:{c:"1"}}`, convention `bracket-object`, round-trips | automated (vitest) |
| 8 | Dot path `a.b=1` | `{b:"1"}`, convention `dot-path`, round-trips (to an equivalent value, via bracket-object wire form) | automated (vitest) |
| 9 | JSON in a value `a={"b":1}` | `{b:1}`, convention `json-value`, plain string offered as alternative, round-trips exactly | automated (vitest) |
| 10 | Base64url JSON `cursor=eyJvIjoyNX0` | `{o:25}`, convention `base64url-json`, plain string offered as alternative, round-trips exactly | automated (vitest) |
| 11 | `a=1&a[]=2` (bare beside bracketed) | Reported as a conflict — two readings, neither chosen | automated (vitest) |
| 12 | `a[0]=1&a[b]=2` (indexed beside object) | Also a conflict, same shape as #11 | automated (vitest) |
| 13 | `a=1&a[]=2&a[b]=3` (three incompatible syntaxes) | All three readings named, not just the first two | automated (vitest) |
| 14 | `a=` vs `a` | `""` (convention `plain`) vs `null` (convention `valueless`) — distinguishable | automated (vitest) |
| 15 | `%20` vs `+` encoding a space | Both decode identically; the raw wire text differs and is kept per-pair | automated (vitest) |
| 16 | `include=legs.station,legs.operator` | Include tree `{legs:{station:{},operator:{}}}` | automated (vitest) |
| 17 | `filter[status][in]=booked,held` | `{status:{in:["booked","held"]}}`; `conventions` names both `bracket-object` and `comma` | automated (vitest) |
| 18 | `fields[articles]=title,body`, `page[number]=2&page[size]=10` | Named fieldset / nested object, no special-casing needed beyond the generic decode | automated (vitest) |
| 19 | `sort=-created,name` | `[{field:"created",direction:"desc"},{field:"name",direction:"asc"}]` | automated (vitest) |
| 20 | `include`/`sort` when the parameter itself conflicts (e.g. `sort=a&sort[]=b`) | `includeTree`/`sortFields` return `undefined`, not an empty result | automated (vitest) |
| 21 | Malformed percent-encoding, an unterminated `[`, a value assigned both directly and more deeply nested under the same key | Never throws; nothing is silently dropped | automated (vitest) |
| 22 | A value that is valid base64url but decodes to a bare JSON scalar, or to non-JSON text | Read as plain, not misdecoded — the object/array-only rule and the length floor exist for exactly this | automated (vitest) |
| 23 | Header lookup by name in any case, with duplicates | First match for `getHeader`, every match in order for `getHeaderAll`, case-insensitive both ways | automated (vitest) |
| 24 | Four `Set-Cookie` values | Four cookies, in order, each with its own attributes | automated (vitest) |
| 25 | A `Set-Cookie` value whose `Expires` attribute contains a comma | Parsed as one cookie, not split into two — the reason `Set-Cookie` values are never comma-joined | automated (vitest) |
| 26 | An unrecognised `Set-Cookie` attribute, or one with a value that does not parse (`Max-Age=not-a-number`) | Name and value kept; the attribute listed verbatim in `unrecognized` rather than dropped | automated (vitest) |
| 27 | An expired JWT (`exp` in the past) vs one not yet expired, judged against an explicit reference time | `expired: true`/`false` correctly, using `referenceTime` when given rather than always `Date.now()` | automated (vitest) |
| 28 | A non-JWT bearer value; a 3-segment value that is not valid base64url JSON; a segment whose length makes base64 padding impossible | `decodeJwt` returns `null` in every case; never throws | automated (vitest) |
| 29 | `redactExchange` on an exchange carrying `Authorization`, request cookies and response `Set-Cookie` values | Every secret-bearing value replaced with `[REDACTED]`; the count matches; the secret does not appear anywhere in `JSON.stringify` of the result | automated (vitest) |
| 30 | `redactExchange` on an exchange with nothing secret | Count `0`; result deep-equals the input | automated (vitest) |
| 31 | `redactExchange` does not mutate its argument | The input is unchanged after the call | automated (vitest) |
| 32 | `mergeExchange` — a field present in the base and absent from the incoming | Survives unchanged | automated (vitest) |
| 33 | `mergeExchange` — associativity, two differently-shaped triples | `(a·b)·c` deep-equals `a·(b·c)` | automated (vitest) |
| 34 | `mergeExchange` with both sides having no request/response at all | Result has no `request`/`response` key at all — not `{}` | automated (vitest) |
| 35 | Hostile values (`<script>`, `"><img src=x onerror=alert(1)>`) as a header name/value, a cookie name/value, and a query parameter name/value | Preserved exactly — recoverable byte for byte from the raw pair, and from `value` or a named `alternative` — never stripped, escaped, or silently discarded | automated (vitest) |
| 36 | `store.ts`/`crypto.ts` (T5) continue to compile and pass against the real `Exchange` type | Unaffected — see "What should NOT have changed" | automated (vitest, pre-existing suite) |

**Altitude note.** Everything above is pure logic with no DOM and no layout, so every case is a
`vitest` case running in milliseconds — there is nothing here for `test/browser/nav-scenarios.js` to
cover, because there is nothing on screen yet. That is expected for this half of the task, not a gap.

**Do not mark a row "automated" unless the test genuinely exists.** Every row above has a
corresponding `it(...)` in `test/{exchange,params,headers,cookies,secrets}.test.ts`.

## Edge cases enumerated

**Parameter ambiguity — the point of this task**

- Every row of the table in `docs/task-specs/T2.md` § Parameters, decoded and round-tripped (cases
  1–10 above).
- Two incompatible key syntaxes for one name, at the top level and one level deep, and with three
  syntaxes at once rather than only two (cases 11–13).
- A comma/space/pipe/JSON/base64url reading always keeps the plain-string alternative attached,
  located by path for a leaf several levels deep (`filter[status][in]`'s comma list, case 17).
- `a=` and `a` (case 14); `%20` and `+` (case 15).
- A value that is valid base64url charset but too short, or decodes to a bare scalar, or to non-JSON
  text — read as plain rather than misfiring (case 22). This is the false-positive risk named in this
  module's own header comment.
- A key with an unterminated `[`, a value assigned both directly and more deeply nested under the
  same key (`a[b]=1` beside `a[b][c]=2`) — kept, not dropped, even though untested by the spec table
  itself (case 21).

**Headers, cookies and secrets**

- Case-insensitive lookup with duplicates preserved in order — the property this feature's masking
  depends on later (case 23).
- Four `Set-Cookie` entries, in order, each independently parsed — never comma-joined (cases 24–25).
- A malformed or unrecognised `Set-Cookie` attribute is listed rather than dropped (case 26).
- An expired JWT, a not-yet-expired one, and judging expiry against an explicit reference time rather
  than only wall-clock `now` — this is how T2b will judge expiry against a response's own `Date`
  header rather than whenever rendering happens to run (case 27).
- Every one of the JWT edge cases the spec names explicitly: not three segments, three segments that
  are not valid base64url JSON, and — found during review, not named in the spec — a segment length
  that makes base64 padding impossible and `atob` itself throw (case 28).
- Redaction removes the secret from the serialised output, not just from a rendered view; counts
  what it removed; touches nothing outside headers and cookies (URL, query parameters and body are
  explicitly out of this function's scope — see `secrets.ts`'s header comment); and never mutates its
  input (cases 29–31).

**The merge contract**

- Non-destructive and associative, the two properties `docs/task-specs/T2.md` requires explicitly,
  each proved by a test that would fail if the property did not hold (cases 32–33) — confirmed by
  deliberately breaking each guard during development and watching the corresponding test fail
  before restoring it.
- The specific historical failure mode this codebase has already shipped once in a different feature
  — an empty value read as present rather than absent (`docs/task-specs/T2.md`'s own framing: "`[]`
  is truthy, so restoration never ran") — has a dedicated regression test: merging two exchanges with
  no request/response anywhere must not manufacture a present-but-empty part (case 34).

**Injection — adapted to this module's altitude**

- This module produces no DOM and no HTML string, so it has no injection surface of its own. What it
  must not do is mangle a hostile value on the way through — case 35 puts `<script>...</script>` and
  `"><img src=x onerror=alert(1)>` through a header, a cookie, and a query parameter (both name and
  value), and confirms each survives byte for byte or is fully recoverable via a named alternative.
  Escaping happens exactly once, downstream, in T2b's render paths.

**What this task does not attempt**

- A body/URL secret scanner. `redactExchange`'s scope is headers and cookies, matching the spec's
  "Headers, cookies, and secrets" section exactly; a secret pasted directly into a URL or a request
  body is not caught, and this is a documented limitation, not an oversight.
- Deep, arbitrary-nesting conflict detection beyond the top level (case 21's fold-into-an-object
  fallback for `a[b]=1` beside `a[b][c]=2`, or an index-like segment beside a key-like one below the
  top level) is a disclosed simplification: the spec's own conflict example, and every JSON:API
  parameter it names, never nest ambiguity that deep.

## What should NOT have changed

- **`store.ts` and `crypto.ts` (T5) behave identically.** `Exchange` moved from an opaque
  `{ [key: string]: unknown }` to the real interface, but neither module reads a field off an
  `Exchange` value or constructs one from a literal with a guessed shape — they only carry it
  forward, exactly as [D2](../DECISIONS.md) intended. The full pre-existing `test/store.test.ts` and
  `test/crypto.test.ts` suites pass unchanged in behaviour; the only edits in this PR are to two
  sample literals in those files that hard-coded fields directly on `exchange` (`{method, url}`)
  rather than nested under `exchange.request`/`exchange.response` — a mechanical fix forced by giving
  `Exchange` its real shape, not a change to what either test verifies. See the PR body for the exact
  lines.
- **`src/ident.ts`'s anchor scope table is untouched.** T2a mints no DOM ids at all — it has no DOM —
  so `q_`/`b_`/`d_`/`n_`/`f_` (already present in `ident.ts` from T1) are exercised by nothing new
  here.
- **Nothing in `main.ts`, any `render-*.ts`, or any i18n catalogue changed**, because nothing in this
  half of the task is wired into the UI. `npx vite build`'s bundle is unaffected in what it serves.
- **No new network call anywhere.** Every function in the five new modules is synchronous and pure;
  `scripts/attack-preflight.sh`'s "no network call added outside the modules allowed one" check
  confirms this mechanically.
