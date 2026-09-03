# QA report — wave <n> · <tasks in the batch>

- **Tasks in this batch:** <T1, T2, …> — every one needs a row in §1. A task with no row is a
  defect in this report, not a task that passed.
- **Served by:** <`npm run dev` on :5178 — or `--url https://jsonapi.mstool.dev` after a release>
- **Commit:** `<sha of the branch you actually drove>`
- **Browser:** <name + version> · **Viewports:** <375×812, 1440×…> · **Themes:** <light, dark>
- **Languages:** <en, de, uk>
- **Date:** <YYYY-MM-DD>
- **Verdict:** `qa:passed` | `qa:failed`

QA is batched per wave — see `docs/PROCESS.md` §1. What is shared across the batch is the *setup*,
never the coverage: each task is verified on its own terms below.

## 1 · Per-task coverage

One row per task in the batch. `partial` and `not tested` are legitimate outcomes and hold the
batch; silence is not an outcome.

| Task | Cases from its QA notes | Result | Note |
|---|---|---|---|
| T<n> | <n of m> | pass / fail / partial / not tested | |

## 2 · Coverage that applies to the whole app

Run once for the batch. Every one of these has caught something here before.

| Area | Result | Note |
|---|---|---|
| **Nothing leaves the browser** — network log after pasting carries no document content | | |
| **Secrets** — masked on screen, and still masked or redacted in Copy, Download and Share | | |
| **Back / Forward** — the content you were looking at returns to the same place on screen | | |
| **A row that was expanded still expands** after Back — not merely that the landing looked right | | |
| **Find-in-page** reaches text inside a collapsed resource | | |
| **A deep link** reloaded from cold lands on the right section | | |
| Empty and malformed input — nothing, `{}`, a bare array, single-quoted JSON, a Python dict, a truncated document | | |
| All three languages — no untranslated English, no empty label, no clipped control, plurals correct | | |
| Both themes, and 375px wide — no unreadable text, no overlap, no sideways body scroll | | |
| Console and network readers — an unhandled error or failed request is a finding even when the screen looks right | | |
| Keyboard — every interactive element reachable, visible focus ring, `Escape` closes what opened | | |
| IndexedDB — reload restores the document; a blocked-storage browser still works, just does not remember | | |

## 3 · Findings

### <n>. <one-line title> — **critical | high | medium | low** — task T<n>

- **Steps:** <exact reproduction, including the payload used, viewport, language and theme>
- **Expected:** <what the QA notes or the task spec say>
- **Actual:** <what happened on screen>

Observable terms only. *"Pasted the Article feed sample, clicked the `people` chip on the first
article, pressed Back — the page returned to the trips group but scrolled to the top rather than to
the article I came from"* — never *"the restoration code forgets to hold the section offset"*. You
cannot see the code, and a guessed cause sends the implementer down the wrong path.

**Severity here:** **critical** = payload content leaves the browser, a secret or personal datum is
exposed, the app is unusable, or a stored document is lost · **high** = documented behaviour broken
with no workaround · **medium** = broken with a workaround · **low** = cosmetic.

## 4 · Specification gaps

Where the documentation did not say what correct looks like. These are findings against the
implementer, not bugs — and they are the reason the blind boundary is worth its cost. Filing one is
always right; going to read the source instead is the one thing this role must not do.

## 5 · Not tested

Anything you could not exercise, and why. A report that silently omits an area reads as coverage.

Two that are expected to appear here:

- **Share links** — `/api/*` is not served by the Vite dev server, and a share against production
  uploads real ciphertext to a real database. Say so rather than testing it.
- Anything needing a payload you could not construct from the built-in samples or the fixtures.
