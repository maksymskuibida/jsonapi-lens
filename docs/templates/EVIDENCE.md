# Evidence — <TASK-ID> <title>

- **Commit:** `<full sha of the code you actually ran — git rev-parse HEAD at the moment of the run>`
- **Ran on:** <browser + version, viewport size, theme, language>
- **Served by:** <`npm run dev` on :5178, or `--url https://jsonapi.mstool.dev`>
- **Date:** <YYYY-MM-DD>

If any file under `src/` or `index.html` changed after that commit, this evidence is stale. Re-run
and re-record rather than editing the SHA — the SHA is the whole point.

## What I did and what I saw

One numbered line per acceptance criterion: **the action, then the observation.** Describe what
appeared on screen. "Verified", "works", "no issues" are assertions, not observations.

1. Pasted the Article feed sample → overview showed `data[2]`, 6 resources, 3 types; the rail listed
   `articles 2`, `people 2`, `comments 2` with proportion bars.
2. Clicked the `people` chip on the first article → landed on `#r_people__9`, the section flashed,
   Back returned the article row to the same place on screen.
3.

## Failure paths I triggered

Not the happy path. What did it do when it went wrong?

1. Pasted `{"data": 1}` → "Not a JSON:API document" with the offer to read it as plain JSON; taking
   the offer rendered one node and no rail.
2.

## Browser scenarios

`node test/browser/run.mjs` — paste the summary line per scenario, and confirm
`document.visibilityState` read `visible`. A backgrounded tab makes every one of these pass
vacuously, so a run you cannot vouch for is worse than none.

```
<output>
```

## NOT OBSERVED

The honest section, and the one a reviewer reads first. Anything the task touches that you did not
exercise, and why. An empty list here on a non-trivial task is itself a finding.

-
