# Test plan — <TASK-ID> <title>

**What this task changes, in one paragraph.** Written so the rest of the plan has a subject.

## Scope

- **In scope:** <the behaviours this plan covers>
- **Out of scope:** <what it deliberately does not, and where that is covered instead>

## Cases

The point of this document is the **edge cases**, not the happy path. A plan listing the happy path
and one error case is the defect the review gate exists to catch.

| # | Scenario | Expected | How verified |
|---|---|---|---|
| 1 | | | automated (vitest) |
| 2 | | | automated (browser scenario) |
| 3 | | | QA by hand — <why it cannot be automated> |

**Altitude matters more than count here.** `npm test` runs under jsdom, which has **no layout
engine**: a test that asserts a scroll position, an offset, a height, or whether a
`content-visibility` row was measured *cannot fail there*. Those belong in
`test/browser/nav-scenarios.js`. Marking such a row "automated (vitest)" is a blocker, not a nit.

**Do not mark a row "automated" unless the test genuinely exists.** A row claiming automation whose
test is absent is the single most common review blocker. Where you are unsure, mark it "QA by hand"
and say why.

## Edge cases enumerated

Work through these honestly and delete the ones that genuinely do not apply — deleting a line is a
claim, and the reviewer will check it.

**Payload shape**

- Empty input; whitespace only; `{}`; a bare array; a bare string (a doubly-encoded document); a
  Python `dict` repr; a log line with JSON in the middle; a truncated document.
- `data` absent · `data: null` · `data` as one object · `data` as an array · `data` as something
  that is not resource-shaped at all.
- `errors` present · `errors` and `data` together (invalid) · `meta` only.
- `included` present with nothing referencing it · a relationship with no `data` member at all
  versus `data: null` — **these two mean different things and the distinction is usually what the
  user is diagnosing.**
- A duplicate `type:id` — first occurrence wins, the rest fold in, and no duplicate DOM id is
  emitted.
- A dangling pointer: a relationship target that is in no `data` and no `included`.

**Identity and anchors**

- A `type` or `id` containing `_`, `__`, `#`, `/`, `.`, `:`, a space, a quote, a newline, or emoji.
  All of these appear in real payloads and none survive a naive `href="#…"`.
- A `type` deliberately shaped to look like another anchor scope's encoded body — see
  [D1](../DECISIONS.md). No two scopes may ever mint the same id.
- An `id` that is the empty string.
- Round-tripping: `parseDomId(domId(t, i))` returns exactly `t` and `i`.

**Injection — on every task that renders anything**

- A hostile value painted through each render path the task touches: `<img src=x onerror=alert(1)>`,
  `"><script>alert(1)</script>`, `'"--><svg onload=alert(1)>`, placed in a `type`, an `id`, an
  attribute key, an attribute value, a `meta` string, an error `detail`, and — where the task
  touches the request feature — a URL, a header name and a header value. It must appear as **text**.
- A URL whose scheme is `javascript:`, `data:` or `vbscript:`. HTML escaping does not help; only a
  scheme allowlist does.

**Scale and layout**

- A document above `EAGER_BODY_LIMIT` (2000 resources), where bodies build on expand rather than up
  front, and one below it.
- Back and Forward after following a relationship: **the content returns to the same place on
  screen.** Assert the content, not the offset — after a correct restoration the offset is often
  deliberately different, because the layout underneath changed.
- A row that was expanded is still expanded after Back, **and still expands when clicked.**
- Find-in-page reaches text inside a collapsed resource.
- A deep link reloaded from cold lands on the right section.

**Localisation**

- Every new string present in `en`, `de` and `uk`; no English literal in a template; no `??`
  fallback. Plurals in each language. Nothing clipped at 375px wide.
- Any string built at module scope rather than inside a function — that captures whichever language
  was active when the module first ran.

**Persistence and the privacy promise**

- Reload with a document open: it comes back from IndexedDB.
- Storage blocked or unavailable (private window): the app still works, it just does not remember.
- **No network request carries payload content.** The only requests are assets, fonts, and the
  opt-in share upload.
- Where the task touches the request feature: a masked secret stays masked (or is redacted with a
  visible count) through Copy, Download **and** a share link.

## What should NOT have changed

<The behaviours a reviewer or QA should confirm are untouched. This is what catches the regression
the diff does not look like it could cause — most often the anchor model, the restoration
behaviour, or the offsets of everything below whatever was inserted above the fold.>
