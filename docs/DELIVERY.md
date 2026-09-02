---
profile: local-qa
primary-branch: main
task-ledger: docs/STATUS.md
status-ledger: docs/STATUS.md
forge: github
branch-template: <type>/<task-id>-<slug>
concurrency-cap: 2
verify-command: npx wrangler types && npx tsc --noEmit && npx tsc -p tsconfig.worker.json --noEmit && npx tsc -p mcp/tsconfig.json --noEmit && npm test && npx vite build && scripts/attack-preflight.sh
preflight: scripts/review-preflight.sh
environments: local,prod
qa-surfaces: web
automation: none
skill-version: 2026-09-02
---

# Delivery

How work ships here. The process itself is in [PROCESS.md](PROCESS.md); this file is the
configuration, plus the reasoning behind the choices that are not obvious.

## Profile: `local-qa`

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

`local+prod-qa` is the target above this, and it is a short step rather than a rewrite: the deploy
workflow already runs a post-deploy smoke test against the live origin, and `test/browser/run.mjs`
already accepts `--url`. What has to exist first is a written regression checklist and the decision
that a QA agent may drive the public origin. Until then, production verification is the smoke test
in `deploy.yml` and nothing more, and `PROCESS.md` says so.

## Roles

| Agent | Model | Note |
|---|---|---|
| `implementer` | `sonnet` | Writes every commit that lands. Also the author for work that looks too small to dispatch — a docs fix, a workflow edit, a one-line correction after review. |
| `reviewer` | `sonnet`, escalated per call | Read-only plus the `gh pr` commands. Escalate to `opus` for anything touching `crypto.ts`/`share.ts`, the IndexedDB schema, the anchor and history model, or an `innerHTML` render path. |
| `qa-web` | `sonnet` | Drives the real app in a real browser, blind to the source. This is the only QA surface — the product is a web page and has no other. |

No `qa-api` agent: the only HTTP surface is `/api/shares` and `/api/health`, and it has no published
schema a blind agent could derive cases from. No `qa-device`: there is no native app.

## Commands

| Purpose | Command |
|---|---|
| Install | `npm ci` |
| Verify locally (the order CI runs) | `npx wrangler types && npx tsc --noEmit && npx tsc -p tsconfig.worker.json --noEmit && npx tsc -p mcp/tsconfig.json --noEmit && npm test && npx vite build && scripts/attack-preflight.sh` |
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
share table, and a QA agent must not create share links against production — sharing uploads
ciphertext to a real D1 database with a real lifetime. Share behaviour is verified locally under
`wrangler dev`, or not at all, and the QA report says which.

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
