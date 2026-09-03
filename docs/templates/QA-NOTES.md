# QA notes — <TASK-ID> <title>

Written for someone who **cannot read the code** and has never seen this change. If a behaviour is
not described here, it will not be tested — so an omission here ships untested.

The QA agent receives this file's contents in its prompt, not a path to it. Write it to be read
cold.

## What changed, observably

<In terms a user would see. Not "added a request index"; "a document pasted with a cURL command
above it now shows a one-line band above the overview carrying the method, the URL and the status,
which expands into the full request".>

## Where to exercise it

- **Environment:** `preview_start { name: "jsonapi-lens" }` — the dev server on port 5178.
- **Surface:** <which views, which controls>
- **Note:** `/api/*` is not served by the dev server, so share links cannot be exercised locally.
  Do not test share against production.

## How to exercise it

<Numbered steps concrete enough to follow without asking a question. Name the exact payload to
paste — a built-in sample by its button label, `test/browser/amtrak.json`, or paste the literal JSON
inline here.>

1.
2.

## Test data needed

<The exact payload. Inline it here if it is short. If it is one of the built-in samples, say which
button loads it: Article feed · Single resource · Missing include · Error response · Awkward ids.>

## What should NOT have changed

<Be specific — "the rest of the app" is not checkable. The three that break silently and are worth
naming almost every time:>

- Back and Forward return the content you were looking at to the same place on screen.
- A row that was expanded is still expanded, and still expands when clicked.
- Nothing in the network log carries document content.

## Known limitations

<Anything deliberately not handled in this task, so it is filed as known rather than as a defect.
And anything you did not verify yourself — say so plainly.>
