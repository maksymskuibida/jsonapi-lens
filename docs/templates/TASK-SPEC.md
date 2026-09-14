# Task specification — <task id>: <title>

> The contract the implementer builds to, the reviewer checks against, and QA verifies from.
> Contract level, not line level: say what must be true, never how to write it.

## Outcome

<One paragraph. What a user or caller can do after this that they could not before.>

## Interface

<The shape of what is exposed: endpoints and methods, request and response schemas, or the public
signature of the module. Field names, types, and which are optional.>

## Behaviour

<The rules. Ordering, defaults, idempotency, what happens on a repeat call, what is persisted and
when. Anything a caller could reasonably assume either way.>

## Error and edge cases

Every failure mode with its expected result. The empty case, the boundary, the concurrent case, the
already-exists case, the not-yours case. **An unlisted case is an unspecified case** — the
implementer will fill it by guessing, and will guess differently next time.

| Case | Expected |
|---|---|
|  |  |

## Out of scope

<What this task deliberately does not do, so review does not ask for it and QA does not test it.>

## Acceptance criteria

Checkable statements — each true or false by inspection or by a test. Never "works correctly".

- [ ]

## Tests that must exist

Named behaviours, not counts or percentages. Include the negative tests for this project's
highest-severity concern.

- [ ]
