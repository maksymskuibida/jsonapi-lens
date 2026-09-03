---
profile: local+prod-qa
primary-branch: main
task-ledger: docs/STATUS.md
status-ledger: docs/STATUS.md
forge: github
branch-template: <type>/<task-id>-<slug>
concurrency-cap: 2
verify-command: npx wrangler types && npx tsc --noEmit && npx tsc -p tsconfig.worker.json --noEmit && npm test && npx vite build && scripts/attack-preflight.sh
preflight: scripts/review-preflight.sh
environments: local,prod
qa-surfaces: web
automation: none
skill-version: 2026-09-02
---

# Delivery

How work ships here. The process itself is in [PROCESS.md](PROCESS.md); this file is the
configuration, plus the reasoning behind the choices that are not obvious.

## Profile: `local+prod-qa`

There is no environment between merge and the user: a push to `main` runs the checks and, if they
pass, deploys the Worker and assets to `https://jsonapi.mstool.dev`. So QA cannot run *after* merge
here — merging is what makes a change real. It runs on the branch, before merge.

The reason this project is not at `review` is the third question in the skill's decision list, and
it fires hard: **an agent can drive the real product locally, the way a user would.** `npm run dev`
serves the actual app, and `test/browser/run.mjs` launches headless Chrome, pastes a document
through the app's own paste flow, and asserts real layout behaviour. That harness exists because
this project has already shipped the exact defect a blind QA pass catches and CI does not — a
history restoration that landed on the right pixel while the row underneath it had silently stopped
expanding. `npm test` was green for it. jsdom has no layout, so every browser scenario passes
vacuously there.

**Production verification is now part of a release**, which is what moves this from `local-qa` to
`local+prod-qa`. The two things that had to exist first now do: `docs/qa-checklists/REGRESSION.md`
is the written checklist, and a QA agent may drive `https://jsonapi.mstool.dev` after a deploy.
`test/browser/run.mjs` already accepts `--url`, and `deploy.yml` already smoke-tests the origin, so
the addition is the human-facing pass rather than new machinery.

**There is no test account, because the product has no accounts** — which removes the usual
`local+prod-qa` hazard. The one piece of server state is the share table, so the rule that replaces
it is: a share link created against production during verification uses a **synthetic document and
the shortest lifetime (15m)**, never a real payload. Everything else the app does on production is
local to the browser by construction.

## Roles

| Agent | Model | Note |
|---|---|---|
| `implementer` | `sonnet` | Writes every commit that lands. Also the author for work that looks too small to dispatch — a docs fix, a workflow edit, a one-line correction after review. |
| `reviewer` | `sonnet`, escalated per call | Read-only plus the `gh pr` commands. Escalate to `opus` for anything touching `crypto.ts`/`share.ts`, the IndexedDB schema, the anchor and history model, or an `innerHTML` render path. |
| `qa-web` | `sonnet` | Drives the real app in a real browser, blind to the source. The only QA surface — the product is a web page and has no other. Runs **once per wave locally** before merge, and **once against production** after the release. |

No `qa-api` agent: the only HTTP surface is `/api/shares` and `/api/health`, and it has no published
schema a blind agent could derive cases from. No `qa-device`: there is no native app.

## Commands

| Purpose | Command |
|---|---|
| Install | `npm ci` |
| Verify locally (the order CI runs) | `npx wrangler types && npx tsc --noEmit && npx tsc -p tsconfig.worker.json --noEmit && npm test && npx vite build && scripts/attack-preflight.sh` |
| Run the app | `npm run dev` — port 5178, pinned in `.claude/launch.json` |
| Browser scenarios (local) | `node test/browser/run.mjs` |
| Browser scenarios (deployment) | `node test/browser/run.mjs --url https://jsonapi.mstool.dev` |
| Review preflight | `scripts/review-preflight.sh <pr-number>` |

Toolchain notes that have cost a run elsewhere and apply here:

- `worker-configuration.d.ts` is generated, not committed. `npx tsc -p tsconfig.worker.json` fails
  before it has ever seen your change unless `npx wrangler types` ran first. CI does this in both
  jobs; do it locally too.
- `npm test` is `vitest run` under **jsdom**, which has no layout engine. A green suite says nothing
  about `content-visibility`, scroll restoration, or anything measured in pixels.
- The browser scenarios need a **visible, non-occluded tab of a non-minimised window**. A
  backgrounded tab does not run `requestAnimationFrame`, so the numbers come out wrong rather than
  failing loudly. `test/browser/README.md` has the detail.
- `gh` is authenticated as `maksymskuibida`. Every role acts through that one token, which is why
  the enforcement table in `PROCESS.md` records reviewer-is-not-implementer as discipline.

## Environments

| | |
|---|---|
| **local** | `npm run dev` on `http://localhost:5178`. Vite dev server; `/api/*` is not served, so share links cannot be exercised locally without `wrangler dev`. |
| **prod** | `https://jsonapi.mstool.dev` — Cloudflare Worker + assets, D1 database `jsonapi-lens-shares`. Deployed by `.github/workflows/deploy.yml` on every push to `main`. There is nothing between merge and this. |

There is no test tenant, because the product has no accounts. The one piece of server state is the
share table. Locally, `/api/*` is not served by the Vite dev server, so share behaviour cannot be
exercised there at all — it is verified **on production, after the deploy**, with a synthetic
document and a 15-minute lifetime. The QA report says which environment each share check ran in.

## Labels

| Label | Applied by | Meaning |
|---|---|---|
| `reviewed:approved` | Reviewer | Review passed; blockers resolved |
| `reviewed:changes-requested` | Reviewer | Blockers outstanding |
| `qa:passed` | QA | Verified in a real browser |
| `qa:failed` | QA | Defect found; bug task opened |

## Deviations from the shared process

- **One ledger, not two.** The skill's spine names a task ledger and a status ledger. This project
  is small enough that two files would drift, so `docs/STATUS.md` is both: the Units table carries
  the queue, the status word and the link to each task spec. If the queue ever outgrows one table,
  split it then.
- **No `scripts/check-evidence.sh` staleness gate in CI yet.** The evidence file and its template
  exist and the implementer writes one per task, but the CI check that fails a build on stale
  evidence is not installed. It is warn-only by hand — the reviewer checks the commit SHA in the
  evidence against the branch head as part of the preflight. Arming it properly is an open ask in
  `STATUS.md` §4. Recording it as absent is the point: a gate that is described but not installed is
  worse than one that is honestly missing.

## Release sequence

Fixed order, and the deploy is gated on the whole of step 3 passing:

1. **Build** every wave locally. Waves run concurrently inside themselves; the waves themselves are
   ordered by `STATUS.md` §1a.
2. **Review** every pull request. Escalate the model for anything touching `crypto.ts`/`share.ts`,
   the IndexedDB schema, the anchor and history model, or an `innerHTML` path.
3. **Verify locally, in full** — `docs/qa-checklists/REGRESSION.md` end to end, **plus** every new
   feature against its own task spec. This is the gate. A failure here is fixed and re-verified; it
   is never deployed and noted.
3a. **Un-stack before merging.** A `pull_request` event evaluates the workflow from its **base**
   branch, so removing the `branches: [main]` filter only gives a stacked pull request CI once the
   fix is present in *its own base*. For a release built as a stack, that means the honest sequence
   is: merge the tooling and foundation PRs to `main` first, then **rebase every remaining PR onto
   `main`** so each one is a PR into `main` and gets checks. Do not treat a reviewer running the
   chain by hand as equivalent — it is a mitigation, not a gate, and it does not survive the next
   push to that branch.

4. **Deploy once**, all of it, by merging to `main`. `deploy.yml` runs `check`, migrates D1, uploads
   the Worker and assets, and smoke-tests the origin.
5. **Verify on production** — the same regression checklist again, because layout is what a build
   changes and a build is what sits between steps 3 and 5, then every new feature again.
6. **Fix forward and re-verify.** There is no staging to roll back to; a re-run of the workflow at an
   earlier commit is the rollback, and it is the last resort rather than the first.

## The deploy needs a human, and that is not negotiable by an agent

**A merge to `main` deploys to production, and the harness requires the maintainer's explicit
approval for it.** An agent cannot perform that merge, and must not look for another route to the
same effect — not the API directly, not the web UI, not a push. The block is correct: a deploy is
outward-facing and irreversible in the sense that matters, and "the maintainer told me to ship it
eventually" is not the same as approval of *this* action *now*.

So an unattended run cannot deploy. What it can do — and what it should aim at — is leave the
release **one approval away**:

1. every task built, reviewed and its blockers closed;
2. everything merged into an **integration branch**, which deploys nothing;
3. the full local pass — regression checklist plus every new feature — run **on that branch**;
4. a single merge for the maintainer to approve, with the evidence to justify approving it.

That is the honest version of "have it ready by morning", and it is strictly better than a run that
stops at the first thing needing a hand.

### What this costs, stated rather than hidden

Because `main` cannot be updated without a deploy, **`main` does not carry the `pull_request`
trigger fix during the release** — and a `pull_request` event reads its workflow from the merge ref,
so no feature pull request in this release gets CI. Three things stand in for it, and none of them
is a platform gate:

- every implementer runs the full chain locally before opening a pull request;
- every reviewer runs it again **independently, from a clean clone** — which has been catching real
  things, including a `npm ci` that had never run in CI at all;
- the full chain is run on the integration branch before the deploy is proposed.

Record which of these actually ran for each task. A mitigation nobody can audit is not a mitigation.

## Running unattended

This project is worked in long autonomous stretches while its maintainer is away, so two rules
exist that would otherwise be judgement calls:

- **No gate may wait on a human.** A gate that cannot be satisfied without the maintainer is either
  satisfied another way or recorded as an open ask in `STATUS.md` §4 and passed over — never waived
  silently, and never blocked on.
- **Broken does not ship, and broken does not stay.** If a feature cannot be made to work, it is
  removed from the release rather than deployed half-working; if it breaks production, it is fixed
  forward or reverted before the run ends. "Deployed and noted as broken" is not an outcome.
