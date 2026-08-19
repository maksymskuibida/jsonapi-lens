# Browser tests — history restoration

These are run by hand, in a real browser, and they are not part of `npm test`.

They have to be. What they check is that Back and Forward put the same content back in the same
place on screen, and the bug they exist to catch comes from `content-visibility: auto` — a row that
has never been on screen has no measured height, so the page grows as you explore it. jsdom has no
layout at all, so it cannot see any of this; every one of these scenarios passes vacuously there.

Two things follow from that, and both will silently invalidate a run:

- **The tab must be the visible, non-occluded tab of a non-minimised window.** A backgrounded or
  fully covered tab does not run `requestAnimationFrame` and does not update `content-visibility`,
  so the numbers come out wrong rather than failing loudly. Check `document.visibilityState`
  reads `visible` before believing anything.
- **Measure where the content is, not what `scrollY` is.** After the fix the restored offset is
  often deliberately *different* from the saved one, because the layout underneath it changed. The
  offset moving is correct; the content moving is the bug.

## Running them

```bash
npm run dev
node test/browser/run.mjs
```

Or against a deployment, which is worth doing after a release — the fix these
scenarios cover is about layout, and layout is the sort of thing a build can change:

```bash
node test/browser/run.mjs --url https://jsonapi.mstool.dev
```

That launches its own headless Chrome, pastes the document through the app's own paste flow, and runs
every scenario. The harness is injected from disk rather than fetched, so any origin serving the app
will do, printing one line each and exiting non-zero if any drifted. Options:

| | |
|---|---|
| `--only s02,s08` | just those scenarios |
| `--extra path.js` | also load your own scenarios (attach them to the global `SCEN`) |
| `--width 390 --height 844` | a narrow layout |
| `--url`, `--doc` | a different origin or document |
| `CHROME_PATH=…` | a different Chrome |

Headless rather than a real window, because a headed tab only renders while it is the visible,
non-occluded tab of a non-minimised window. Anywhere else it stops running `requestAnimationFrame`
and stops updating `content-visibility`, and the numbers come out quietly wrong instead of failing.
Headless always renders, needs nobody's screen, and several copies can run at once — though not many
more than the machine has cores, or they starve each other and a run appears to hang.

The viewport comes from `Emulation.setDeviceMetricsOverride`, not `--window-size`: headless Chrome
will not make a window narrower than about 500px, so `--window-size=390` silently gave you 500 and
the narrow-layout scenarios were not testing a narrow layout. The runner now asserts it got the width
it asked for.

Each scenario returns `{ name, ok, driftPx, detail }`. **`driftPx` is the number that matters**: how
far the watched element moved across the traversal. Anything above ±2px (sub-pixel rounding) is the
bug returning. `detail` is only printed for failures, so while writing one, return `ok: false` to see
it.

`nav-harness.js` is the vocabulary — `fresh`, `open`, `close`, `expandGroup`, `click`, `center`,
`scrollToFraction`, `back`, `forward`, `railFilter`, `topmostVisible`, `top`. A scenario is a short
script in it; see `follow()` for the common shape. `nav-scenarios.js` expects `amtrak.json` beside it, the
payload its `ID` map was written against — 131 resources over 14 types, and the default for `--doc`.
It is committed for that reason: the suite is worth nothing if it cannot be run from a clone. Point
`--doc` at another document and the scenarios will report that they could not find their anchors,
which is the honest outcome.

If you write your own, two rules matter more than the rest:

- **Watch something on screen.** If `NAV.top(watch)` is outside `0..innerHeight`, the scenario proves
  nothing, whatever it prints.
- **Never assert on `scrollY`.** After the fix the restored offset is routinely and correctly
  *different* from the saved one — that is the mechanism working. Only the content's screen position
  must match.

## What is covered

24 scenarios run entirely in the page: single relationship hops in both directions, a four-deep chain
unwound one Back at a time, Back-then-Forward, rapid double Backs, Back/Forward hammering, returning
to the very top and the very bottom, a type filter active, "Expand all" on a 36-row group, a position
deep inside a tall expanded row, a reverse pointer out of "Referenced by", the jump modal, collapsing
the row you landed on before leaving, "Expand all" reading the rows rather than its own memory, and arriving at a resource opening it by
every route there is.

That last one is worth its own note. Every scenario that follows a relationship also asserts the row
it landed on is open, because a position-only assertion cannot see that failing — the landing is in
exactly the right place whether or not the row expanded, and a regression there is unmissable in use
and invisible in the numbers.

Every one of them runs at whatever `--width` is given, so narrow layouts are the same 22 scenarios
rather than a separate list. 390, 768 and 1512 are the widths worth trying; fractional row heights at
390 are what caught the rounding fault.

Two more the runner does itself, around the scenarios, because both need a page load:

- **Reload restores the same place** — the case the old absolute-offset restoration got most wrong,
  at -1215px, because a fresh load has measured nothing and is therefore at its shortest.
- **The document is still rendered a second after it first appeared.** `boot()` reads IndexedDB behind
  an `await` and used to call `showView("paste")` regardless of what had happened meanwhile, so a
  document pasted before that read finished was replaced by the paste view a moment later. Rendering
  once is not proof.

Two are still by hand, both needing a second page load mid-scenario: Back *after* a reload-restored
position, and a cold deep link followed out and then back. Drive them from the console in two steps,
carrying the expectation across the load in `sessionStorage`.
