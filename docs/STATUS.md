# Build status

**What's built, as of `main`, and what is queued.** The design proposal says what we *intend*; this
file says what actually exists, so a session does not have to re-derive it from `git log`. When the
two disagree about scope, the proposal wins; when they disagree about *status*, this file wins.

This is both ledgers — the queue and the build state. `docs/DELIVERY.md` records why it is one file
and not two.

**Keeping it current is part of shipping.** Every pull request that starts or finishes a unit edits
one row here.

Status: **✅ done** (on `main`) · **🔨 in flight** (branch or open PR) · **⛔ blocked** (named
blocker) · **🔒 not built** (deliberate — reason in §3) · **📋 queued**

---

## 1 · Units

| Unit | Status | Spec | Notes |
|---|---|---|---|
| T0 · Delivery process | 🔨 | — | This change. `DELIVERY.md`, `PROCESS.md`, three agents, templates, preflight + attack suite, labels, the `pull_request` CI trigger that was missing, and the fixes from the T0 review. |
| T1 · Plain JSON | 📋 | [T1](task-specs/T1.md) | Shape detection, the branch out of `assertJsonApi`, an **inferred identity graph** — a repeated identifier becomes a link, the way a `{type, id}` pointer already does — and the [D1](DECISIONS.md) anchor scope table. |
| T5 · Storage + share envelope | 📋 | [T5](task-specs/T5.md) | An optional exchange on stored documents and share payloads, IndexedDB v3, and a **bundle** payload at envelope version 3. No UI, so T2/T6/T7 can build on it in parallel. |
| T2a · Exchange model + decoders | 📋 | [T2](task-specs/T2.md) | **Pure logic, no UI**: the `Exchange` model, `mergeExchange`, the parameter decoder (every list and object encoding), header and cookie parsing, masking, JWT decode. Where the correctness risk lives, and where tests are cheapest. |
| T2b · Form and review | 📋 | [T2](task-specs/T2.md) | The `Exchange` model (every part optional and mergeable), the **field-separated form**, and the request/response/both review: params through one decoder, headers, cookies, bodies as nested lenses, request-scoped anchors, masking and redaction. |
| T6 · Share a bundle | 📋 | [T6](task-specs/T6.md) | In the saved list: a Share button puts a checkbox on each row and swaps the buttons for Cancel and Create link. Disabled with nothing selected; one selection makes a document link, several make a bundle. Opening a bundle offers its documents for import — all, a selection, or cancel. |
| T7 · MCP server | 📋 | [T7](task-specs/T7.md) | `share` takes a document list and an AI-supplied `openssl rand -hex 32` secret, seals one document or a bundle, returns the id, and documents how to build the URL. `read` takes an id and a secret and returns the document. |
| T3 · Importers | 📋 | [T3](task-specs/T3.md) | cURL, raw HTTP request, raw HTTP response, bare URL, HAR, and **JSON transport logs** — a serialised Python `logging` record with HTTP transport fields, where two records correlate on a shared id and merge in either order. |
| T8 · Pre-existing defects | 📋 | [T8](task-specs/T8.md) | Five defects the production baseline found, live on prod today and none of them ours: value formatting ignoring the app's language (**high**), a malformed share link reported as a missing page, `/view`'s title falling back whenever there is a hash, a stale saved-count on delete, and five untranslated string groups. |
| T10 · Combination defects | 📋 | [T10](task-specs/T10.md) | **The most severe defect of the release**: a secret attached through the MCP `share` tool is sealed and uploaded unredacted, because `redactExchange` is called nowhere and T7 reaches `seal` directly — bypassing the one comment that warned about it. Plus the release branch not typechecking, and T7 re-deriving D3. All three exist only in the combination. |
| T4 · Diagnostics | 📋 | [T4](task-specs/T4.md) | The request-vs-response cross-checks, linked at both ends and surfaced inline on the rows they explain. |

## 1a · Waves

QA is batched per wave — see [PROCESS.md](PROCESS.md) §1. Tasks inside a wave run concurrently and
are assigned **disjoint file sets**, because the alternative is two agents rebasing each other.

| Wave | Tasks | Owns |
|---|---|---|
| 1 | **T1** ‖ **T5** | T1: `parse.ts`, `ident.ts`, the new JSON index, the rail, **all of `main.ts`**, i18n `shape`/`identity`. T5: `store.ts`, `crypto.ts`, `share.ts`, i18n `bundle`. See the note below — the first draft of this split was wrong. |
| 2 | **T2** ‖ **T6** ‖ **T7** ‖ **T8** | T2: the new request modules, `main.ts`, `render-document.ts`, `types.ts`, `styles.css`. T6: `panels.ts` + the bundle route. T7: a new `mcp/` tree only. T8: `format.ts`, `i18n/intl.ts`, `router.ts`, `seo.ts`, `render-resource.ts`. T2 and T6 both touch `main.ts` in different regions; second to land rebases. **T8 runs after T1 merges** — it edits files T1 owns. D4 goes to whichever of T6/T8 gets there first; see T8's ownership note. |
| 3 | **T2b** ‖ **T3** ‖ **T8** | T2b: the form, the review, the request anchors. T3: the importer modules. T8: `format.ts`, `i18n/intl.ts`, `router.ts`, `seo.ts`, `render-resource.ts`. All three need only T2a, not each other. |
| 4 | **T4** | The checks module. Reads T2a's model and T2b's anchors; owns neither. |

Dependencies: **T1 → T2 → {T3, T4}**, **T5 → {T2, T6, T7}**, and **T1 → T8**. Everything else is parallel.

**The wave-1 split needed correcting mid-flight, and the reason generalises.** `src/main.ts`
builds a `LibraryEntry` out of `resources`, `types` and `shape` — three fields that only existed on
a `DocumentIndex`. T1's plain-JSON reading breaks that block, and the obvious repair is to widen
`LibraryEntry` in `src/store.ts`, which T5 owns and is concurrently taking to `DB_VERSION` 3. Two
branches each bumping `DB_VERSION` to 3 with different shapes is a data-integrity hazard, not a
merge conflict. Resolution: **T5 alone touches `store.ts` and `DB_VERSION`**, widening those three
fields to tolerate a non-JSON:API document; T1 computes them in `main.ts` from whichever lens it
has. The lesson for later waves: a file split is only disjoint if you have checked what the *types*
force, not just which files each task obviously edits.

## 2 · What T0 actually contains

| Piece | Status |
|---|---|
| `docs/DELIVERY.md`, `docs/PROCESS.md`, `docs/DECISIONS.md` | ✅ |
| `.claude/agents/` — implementer, reviewer, qa-web | ✅ |
| `docs/templates/` — task spec, test plan, QA notes, QA report, evidence | ✅ |
| `scripts/review-preflight.sh` | ✅ |
| Forge labels — `reviewed:*`, `qa:*` | ✅ |
| `deploy.yml` — `check` job also runs on `pull_request` | ✅ |
| Project `CLAUDE.md` pointing at the flow | ✅ |
| Task specs T1–T7 | ✅ |
| `test/hygiene.test.ts` + synthesised fixtures | ✅ |
| Fixes from the T0 review — 3 blockers, the copy check, the ceiling cases | ✅ |
| `scripts/check-evidence.sh` staleness gate in CI | 🔒 — §4 |

## 3 · Not built — and why

| Unit | Status | Why |
|---|---|---|
| `qa-api` agent | 🔒 | The only HTTP surface is `/api/shares` and `/api/health`, with no published schema a blind agent could derive cases from. Revisit if the share API grows a documented contract. |
| `qa-device` agent | 🔒 | There is no native app. |
| Required-reviewer on the `production` environment | 🔒 | Single maintainer. A self-approved deploy gate is theatre, and a gate that gets waived on its first use never comes back. |
| — | — | *(Production QA is no longer deferred: the profile is `local+prod-qa`, `docs/qa-checklists/REGRESSION.md` is the checklist, and the release sequence is in `DELIVERY.md`.)* |

## 3a · Production baseline

`docs/qa-reports/prod-baseline-2026-09-02.md` records the state of production **before** this
release: 70 of 71 checklist lines passing, the browser scenario suite 24/24 against the live origin,
zero network requests carrying document content, and five pre-existing defects now specified as
**T8**. The one untested line is private-window/storage-blocked behaviour, for which the automation
harness has no incognito primitive.

It exists so the post-deploy pass is a **diff** rather than a fresh opinion. Without it, every
failure found after the release would be ambiguous between "we broke it" and "it was always like
that" — and five of them would have been misattributed.

## 4 · Open asks — not ours to close

| Ask | Owner | Blocks |
|---|---|---|
| **PR #3 must be squashed with a HAND-WRITTEN `--body`** | whoever merges | `6eb817b`'s commit **message body** contains a literal share secret. GitHub's default squash body concatenates commit messages, so a default squash puts it into `main`'s permanent history. The value is inert — both share ids return `410 Gone` — so history was deliberately not rewritten; the cost of that decision is this requirement. **Why everyone missed it:** a worktree grep cannot see commit messages. Add `git log -S<value> --all` to the habit. |
| **Approve the merge to `main`** — `gh pr merge <n> --merge` | @maksymskuibida | **The deploy, and therefore the whole release.** The harness requires explicit approval for a merge to `main` because it deploys to production; an agent cannot do it and must not route around the block. Everything else can be finished without it, so the release is driven to *one approval away* rather than stalled. |
| Protect `main` — require a pull request and the `check` status context | @maksymskuibida (repo admin) | Nothing is enforced today: `main` is unprotected, so a direct push bypasses review, QA and CI-before-merge in one step. Free on a public repo. **Deliberately not done by an agent** — it is a repository setting, not a code change, and changing account settings unasked is out of bounds. Passed over rather than blocked on, per `DELIVERY.md` *Running unattended*. |
| Cover the "create a store during an upgrade" branch in `store.ts` | whichever task first adds an object store | **Demonstrated, not suspected**: PR #1's reviewer made `library` creation conditional on `oldVersion === 0` and **all 230 tests still passed.** The v2→v3 test covers the *guarded* path, so a destructive migration is caught; the *creating* path (v1→v3, or any store a later task adds) has none. Harmless while no task adds a store — a trap the moment one does. |
| Give the preflight's "task spec touched" check a freshness notion | next session | It greps changed **path names**, so a spec that has gone stale reads `ok`. T7's spec contradicted its shipped code for the PR's entire life with the gate green. T9 fixed the second cause (a hardcoded base ref made the range span a whole stack, matching seven specs T7 never touched); this half is open. |
| Arm the evidence staleness gate | next session | The "ran it, then changed the code" failure. `scripts/check-evidence.sh` is not installed; the SHA is checked by hand at preflight, which catches carelessness but not drift. |
