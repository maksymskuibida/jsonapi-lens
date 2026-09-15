# QA notes — T2a: the exchange model and decoders

**Coverage row for the wave QA report: not applicable — no observable surface. T2b covers it.**

`PROCESS.md` §3's mechanical exception is "touches neither `src/` nor `index.html`", and T2a does
touch `src/`. This file exists so §1's "one coverage row per task" has something to point at rather
than a gap, and so the exception is recorded as a judgement someone made rather than a step someone
skipped.

## Why there is nothing for a browser pass to do

T2a is five pure modules — `exchange.ts`, `params.ts`, `headers.ts`, `cookies.ts`, `secrets.ts` —
plus the types they export. None of them is imported by `main.ts`, none renders, none is reachable
from any control in the app. A QA agent driving the deployed site cannot distinguish this branch
from `main` by any action available to it, because there is no entry point: the field-separated
form and the request/response review that *use* these modules are **T2b**, and that is where this
task's user-visible behaviour is verified.

Confirmed rather than assumed: `grep -rn "from \"./\(params\|secrets\|headers\|cookies\|exchange\)"
src/main.ts` finds nothing, and `src/main.ts` on this branch is byte-identical to `main`.

## What was verified instead, and how

Everything in `docs/test-plans/T2a.md`, under vitest — 464 tests, typecheck clean. The security
properties are additionally **mutation-checked**, because a passing test beside a fix is not
evidence the test guards the fix:

| Guard removed | Result |
|---|---|
| Fragment redaction in `redactUrl` (`redactedFragment = fragment`) | case 34a goes red |
| `attributeLooksUnsafe` stubbed to `false` | case 26a goes red |
| `UNSAFE_KEYS` emptied | 7 `params.test.ts` cases go red |
| `mergeExchange`'s absent-beats-empty guard removed | 3 `exchange.test.ts` cases go red |

## Known gap, disclosed rather than left to be discovered

`redactOrigin` has no direct test (reviewer's suggestion 2). It is unreachable from any UI today —
`OriginMeta` is a placeholder for **T3** — but it is exported surface, and T3 is being built against
this branch now. It should get coverage in T3 or in a follow-up, and until it does, nothing pins
its credential-shape and unsafe-key handling.
