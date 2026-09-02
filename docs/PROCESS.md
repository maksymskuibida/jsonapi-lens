# Process

How a change gets from a task to production in this repository. The configuration — commands,
branch names, labels, environments — is in [DELIVERY.md](DELIVERY.md). Binding design decisions are
in [DECISIONS.md](DECISIONS.md). What is actually on `main` is in [STATUS.md](STATUS.md).

Profile: **`local-qa`**. Three roles, and QA runs before merge because merging is what deploys.

## 1 · The lifecycle

```
  task in STATUS.md §1
    │
    ▼
  task spec  docs/task-specs/<task-id>.md      written by the implementer, first
    │
    ▼
IMPLEMENTER  branch <type>/<task-id>-<slug>
    │        code + tests + i18n rows + test plan + QA notes + evidence + docs + ledger row
    │  opens PR
    ▼
   CI  typecheck (app + worker) · vitest · build        ✗ → back to implementer
    │ ✓
    ▼
 REVIEWER  the diff against the spec; test-plan completeness; conventions; DECISIONS.md
    │      blockers → fix round → re-review (cap 3 rounds, then report blocked)
    │  applies reviewed:approved                          ← per pull request
    ▼
  ┌─ features accumulate on the wave's stacked branch ─┐
  │                                                     │
  ▼                                                     │
  QA-WEB  ONE pass per wave, over the whole batch, from the QA notes,
    │     blind to the source. Its report carries **one coverage row per
    │     task in the batch** — a batch cannot pass with a feature unrowed.
    │     applies qa:passed / qa:failed to every PR in the batch, or none
    │                                             ✗ → bug task, batch held
    │ ✓
    ▼
implementer squash-merges  ──►  push to main  ──►  CI  ──►  DEPLOY  ──►  PRODUCTION
```

**QA is batched per wave, not run per change.** One browser pass covering several features is
dramatically faster than one per pull request, and on a single-surface app most of what a QA pass
does — the three languages, both themes, 375px, the console and network readers, Back and Forward,
keyboard — is identical work repeated. Batching it does that work once.

**What stops batching from meaning "less verified":** the batch report must carry a coverage row
naming **every task in the batch**, and `qa:passed` goes on all of the batch's pull requests or on
none of them. A row that says "not tested" is a legitimate outcome and holds the batch; a task with
no row at all is a defect in the report. So each feature is still individually verified — what is
shared is the setup, not the coverage.

**There is nothing between merge and the user.** A squash-merge to `main` deploys the Worker, the
assets and any D1 migration to `https://jsonapi.mstool.dev`. Review and QA as though what you pass
is live in three minutes, because it is. Every pull request body says plainly what was **not**
verified.

## 2 · Roles

### Implementer — `.claude/agents/implementer.md`

Writes every commit that lands. Including the ones that look too small to be worth dispatching: a
documentation fix, a workflow edit, a one-line correction after review. Size and genre have nothing
to do with whether an independent eye has seen a diff.

### Reviewer — `.claude/agents/reviewer.md`

Read-only plus the `gh pr` commands. **Never writes implementation code** — a reviewer that has
written part of the diff cannot see the diff any more. Escalated to a stronger model per call for
anything touching `crypto.ts`/`share.ts`, the IndexedDB schema, the anchor and history model, or an
`innerHTML` render path.

### QA (web) — `.claude/agents/qa-web.md`

Drives the real app in a real browser and verifies the documented contract is the delivered
behaviour, **working from documentation alone**. An agent that reads the implementation tests what
the code happens to do; a blind one tests what the contract promises, which is the only thing a
user can rely on.

### Orchestrator — the session driving the loop

Authors nothing that goes into a commit, and never reviews or QAs work it drove. Two exceptions,
both narrow: the process files themselves (`DELIVERY.md`, `PROCESS.md`, the agent files, the
templates — this change), which still go onto a branch and through review like anything else; and
**rescued work**, an agent's uncommitted diff committed verbatim, labelled unverified, and put
through the normal gates. Check the working tree every time an agent stops, whatever its report
said.

There is **no owner grant** in this repository. If you think you need one, that is the repository
owner's decision to record here, not yours to assume.

## 3 · A pull request is not complete without all nine

The reviewer refuses a pull request missing any of these. If you add a tenth, update this list, the
count in this heading, **and** the matching list in `.claude/agents/implementer.md` — a requirement
that lives only here is invisible to the agent that has to satisfy it.

1. **The implementation**, obeying the module boundaries in §5.
2. **Tests at the right altitude** — pure logic in `vitest` where it runs in milliseconds; anything
   measured in pixels in `test/browser/nav-scenarios.js`, because jsdom has no layout engine and
   will pass it vacuously.
3. **Every user-facing string in all three catalogues** — `src/i18n/en.ts`, `de.ts`, `uk.ts`. `en`
   is the schema: the `Messages` type is derived from it, so a missing `de`/`uk` row is a
   typecheck failure. There are **no fallbacks** and no English in a template literal.
4. **A test plan** at `docs/test-plans/<task-id>.md`. The point of it is the edge cases; a plan
   listing the happy path and one error is the defect the review gate exists to catch.
5. **QA notes** at `docs/qa-notes/<task-id>.md`, written for someone who cannot read the code.
   A behaviour not described here will not be tested, so an omission ships untested. The *notes*
   are per task even though the QA *report* is per wave — the notes are your description of your
   own change, and the batch report is one row per set of notes.
6. **An evidence file** at `docs/evidence/<task-id>.md`, recording the commit SHA the browser run
   was performed at, what was observed, and an honest NOT OBSERVED section.
7. **Documentation** — the README where a user-visible capability appeared or changed, and the
   header comment of any file whose design rationale moved.
8. **A `DECISIONS.md` entry** if the task settled something future work must respect. If it
   contradicts an existing decision, amend that decision in the same PR with reasoning.
9. **The `STATUS.md` row** for this unit, updated in the same PR.

## 4 · The highest-severity failure mode: a payload that executes

Named, because "check security" is not a check.

**Everything in a document is untrusted input.** Type names, ids, attribute keys, attribute values,
`meta`, `links`, error strings — all of it comes from a payload someone pasted, and several render
paths build HTML strings and assign them to `innerHTML` (`groupsHtml`, `groupRowsHtml`, `chipHtml`,
`tagsHtml`, `rowHtml`) because per-node creation is too slow at 50k resources. Every interpolation
on those paths goes through `escapeHtml`. **A single unescaped interpolation is a stored XSS in a
tool people paste production payloads into**, and it is checked on every review whether or not the
task sounds related.

Attaching a request widens the surface, and the new inputs are worse than the old ones: a URL, a
header name and value, a parameter name and value. A URL is rendered as a link, so `javascript:`
and `data:` schemes are a second, separate hazard — a scheme allowlist, not an escape.

Second, and specific to the request feature: **secrets.** Once the app holds an `Authorization`
header, "nothing leaves your browser" has to survive the one feature that uploads. Masking that can
be walked around by exporting or sharing is not masking. Redaction is verified on both paths or the
feature is not done.

## 5 · Module boundaries

Stated concretely so "layering" is checkable:

- `ident.ts`, `pointer.ts`, `format.ts` are pure and depend on nothing in the app. They are the
  layer that must be unit-testable in milliseconds, and logic that belongs here must not end up in
  a render module where it cannot be reached.
- `parse.ts` builds the index. It touches no DOM.
- `render-*.ts` produce nodes or HTML strings from an index. They read `t()` and the DOM helpers,
  and they hold no state.
- `main.ts` owns state, wiring and history. It is the only module that reads `location` or
  `history`, apart from `router.ts`.
- `store.ts`, `share.ts`, `crypto.ts` own persistence and the one client network path, and
  `worker.ts` is the server — `env.ASSETS.fetch(request)` at `src/worker.ts:161` is how it serves
  the static assets, so it is a fetch by definition. Those four, and **no other module
  may open a network connection.** The app's central promise is that reading a document is local;
  a `fetch` anywhere else is a design violation, not an optimisation.
- This rule is about `src/` — the browser app's promise that reading a document never leaves the
  tab. `mcp/` is a separate program a user runs deliberately, over stdio, to talk to the same public
  API `share.ts` already does; it may open a network connection (`mcp/transport.ts` is where it
  does), and doing so does not weaken the promise above, because nothing in `src/` gained a new
  network path — the browser app is exactly as local as it was.

## 6 · The rules this codebase is most likely to lose

Each with its consequence, because a rule without one gets applied only to the case it names.

- **Element ids must be unique.** See [D1](DECISIONS.md). A duplicate id silently resolves every
  anchor to the first match; nothing reports it.
- **`t()` at render time, never at module scope.** A catalogue value captured in a module-level
  constant freezes whichever language happened to be active when the module first ran. `samples()`
  in `main.ts` is a function for exactly this reason.
- **No per-row event listeners.** Rows are delegated: a single handler reads `data-copy` and walks
  up to the nearest `data-pointer`. Two closures per row is the difference between free and a
  memory problem at 50k resources.
- **Values are not copied into the DOM.** A row carries a JSON Pointer and resolves against the
  parsed root on demand. Duplicating values doubles the memory cost of a large document.
- **`content-visibility: auto` means an off-screen row has no measured height.** Anything that
  changes document offsets — a new band above the overview, a taller header — can break Back and
  Forward restoration, and `npm test` cannot see it. Run `node test/browser/run.mjs`, in a visible
  tab, and after a deploy run it again with `--url`.
- **Header comments are design rationale, not decoration.** A change that contradicts one is either
  wrong or needs the comment updated in the same diff.
- **A gate is never weakened to get green.** A skipped test, a widened exclusion, a cast past a
  type error at a boundary: blocking defects, not fixes.

## 7 · Failure paths

| What happened | What happens next |
|---|---|
| CI red on the branch | Back to the implementer. Never merge past a red check. |
| Reviewer finds blockers | Fix round on the same branch, then re-review. Cap at three rounds, then report blocked with what is unresolved. |
| QA finds a defect | `qa:failed`, a bug task in `STATUS.md` carrying the report, full lifecycle. The feature does not merge. |
| QA cannot tell what correct looks like | A **specification gap** filed against the implementer, not a bug — and not permission to go and read the source. |
| An agent dies mid-task | Check its worktree. Commit what is there verbatim, labelled rescued and unverified, and put it through the gates. |
| Something breaks in production | Fix forward — the deploy is a single `wrangler deploy` and a re-run of the workflow on an earlier commit is the rollback. Then a regression row in the test plan, permanently. |

## 8 · What is actually enforced

The single source of truth on what is real. **Nothing else in this repository may contradict this
table**, and most of these are agent discipline rather than platform enforcement. Writing that down
is what keeps a label from being mistaken for a guarantee.

| Gate | Held by | To make it real |
|---|---|---|
| CI must pass before **deploy** | **Platform ✅** — `deploy` declares `needs: check`, and `workflow_dispatch` enters the same job graph, so there is no trigger that skips it | — |
| CI **runs** on a pull request | **Platform ✅** — the `check` job now triggers on `pull_request`. Before this change the workflow fired only on push to `main`, so a pull request got **no checks at all** | — |
| CI must **pass** before merge | **Nothing** — the check runs, but nothing requires it to be green, and `main` is unprotected so the merge cannot be blocked. Running is not enforcing | Protect the branch and make `check` a required status context |
| No direct push to `main` | **Nothing** — `main` is unprotected (`GET /branches/main/protection` → 404) | Protect the branch: require a PR, require the `check` context. Free on a public repo; the repository owner has to do it |
| Deploy requires a human | **Nothing** — the `production` environment exists but has `protection_rules: []` | Add a required reviewer to the environment. Deliberately not done: this is a single-maintainer project and a self-approved deploy gate is theatre |
| Production is reachable after deploy | **Script in CI ✅** — the smoke step polls `/api/health` and asserts `/` and `/view` serve a document | — |
| Reviewer ≠ implementer | **Nothing** — every role acts through one `gh` token, so `reviewed:approved` is a label, not an approval | A second bot account. Until then: `git log` names an author per commit, so an audit can ask whether each came from an agent run |
| QA cannot read the source | **Tool removal + prompt delivery** — `Read`, `Grep`, `Glob` are absent from `qa-web`'s tool list, and the contract is pasted into its prompt so it never needs one. `Bash` remains. **Discipline, not a sandbox** — see §9 | A separate account with a source-free checkout |
| Orchestrator authors nothing | **Nothing** — prose | Separate identities per role. Until then, commit authorship is auditable per PR |
| Evidence is not stale | **Nothing yet** — the file and template exist; the CI staleness check does not. Checked by hand at preflight | Install `scripts/check-evidence.sh` and wire it into the `check` job. Open ask in `STATUS.md` §4 |

## 9 · The QA blindfold, and its holes

The boundary is real but it is **not a sandbox**, so here is its actual shape rather than a claim.

**What holds it.** `qa-web` has no `Read`, `Grep` or `Glob` tool. More importantly, it never needs
one: the orchestrator pastes the task spec and the QA notes into its prompt, so the contract arrives
without a file read. An agent with nothing to gain from reading source is a stronger design than one
told not to.

**What is open.** `qa-web` keeps `Bash`, so `cat src/main.ts` is one command away. Project-wide deny
rules for the file-reading commands — `cat`, `head`, `sed`, `grep`, `find`, `git diff`, `git log -p`,
`gh pr diff`, `node -e`, `python3 -c`, `curl file://` — were considered and **deliberately not
installed**, because Claude Code permissions are per project rather than per subagent: every one of
those rules would also take the command from the reviewer, whose entire job is reading a diff. That
trade is not worth making on a repository with one maintainer.

So this gate sits on the role-separation rung and no higher. The honest version of the claim is: a
QA agent that wants to read the source can, and the pass is worth its cost because the agent
understands why it should not. Moving it up needs a second account with a source-free checkout, and
that is the entry in §8's last column.

## 10 · Retro-fit policy

This process applies to tasks opened **after 2026-09-02**. Existing history is not back-filled and
is not in violation. The task-spec, test-plan, QA-notes and evidence requirements start with the
first task in `STATUS.md`.
