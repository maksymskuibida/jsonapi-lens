#!/usr/bin/env bash
#
# Review preflight — answers the mechanical half of a review deterministically,
# so the reviewer spends its budget on judgement instead of re-deriving facts.
#
# Usage:  scripts/review-preflight.sh <pr-number>
#         scripts/review-preflight.sh            # the current branch vs origin/main
#
# Exit codes:  0 clean · 1 findings · 2 could not determine (fails closed)
#
#
# One note on style, because it is load-bearing rather than taste: every match
# below is `grep -q PATTERN <<<"$VAR"`, never `printf … | grep -q PATTERN`.
#
# Under `set -o pipefail`, `grep -q` exits on its first match and closes the
# pipe; the `printf` still holding unwritten bytes takes SIGPIPE and exits 141,
# and pipefail hands that 141 to the `if`, which then reports that the check
# found NOTHING. It fails open in proportion to how blatant the defect is — the
# earlier the match, the more the writer has left to write. It was found here
# with 13 `innerHTML` hits in a diff and a green "ok" line, ten runs out of ten,
# on the project's highest-severity check.
#
# A herestring is a temporary file, not a pipe: no writer, no SIGPIPE, and the
# status is grep's alone. `deploy.yml` documents the same hazard for the same
# reason.
#
# Fails closed on purpose. A preflight that exits 0 when it cannot resolve the
# base ref turns every CI misconfiguration into a silent pass, and the day a ref
# name changes is the day the check quietly stops existing.

set -uo pipefail

PR="${1:-}"
BASE_REF="origin/main"
findings=0
notes=0

# Findings raised inside a pipeline run in a subshell, so they are accumulated
# through a file and folded back into `findings` afterwards.
FINDINGS_FILE="$(mktemp)"
trap 'rm -f "$FINDINGS_FILE"' EXIT

# Resolve every path before anything changes directory.
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "FATAL: not a git repository" >&2
  exit 2
}
cd "$REPO_ROOT" || exit 2

say()  { printf '\n\033[1m== %s\033[0m\n' "$1"; }
ok()   { printf '  ok      %s\n' "$1"; }
find_() { printf '  FINDING %s\n' "$1"; findings=$((findings + 1)); }
note() { printf '  note    %s\n' "$1"; notes=$((notes + 1)); }

git fetch --quiet origin main 2>/dev/null || note "could not fetch origin/main; comparing against the local ref"
git rev-parse --verify --quiet "$BASE_REF" >/dev/null || {
  echo "FATAL: cannot resolve $BASE_REF — refusing to report a pass" >&2
  exit 2
}

MERGE_BASE="$(git merge-base "$BASE_REF" HEAD 2>/dev/null)" || {
  echo "FATAL: no merge base with $BASE_REF — refusing to report a pass" >&2
  exit 2
}

CHANGED="$(git diff --name-only "$MERGE_BASE"..HEAD)"
DIFF="$(git diff "$MERGE_BASE"..HEAD)"
ADDED="$(printf '%s\n' "$DIFF" | grep '^+' | grep -v '^+++' || true)"

# T9: scripts/attack-preflight.sh plants the exact patterns several checks
# below look for — literal `<<<<<<<`, `.only(`, `innerHTML`, `href:` and
# `scrollY` — because planting them is how it proves each check fires. Any
# diff that touches that file (every branch's diff until T0 merges, and every
# future edit to the suite after that) used to read as unrelated violations
# in application code that do not exist, because the checks below scanned
# `$ADDED` — every added line in the whole diff — rather than the lines the
# invariant is actually about. Two different fixes for two different kinds of
# check (docs/task-specs/T9.md):
#
#   - The CODE INVARIANTS (the innerHTML/insertAdjacentHTML scan and the href
#     note; the network-call, DOM-id and hardcoded-copy scans already read
#     per-file under src/ and were never affected; the jsdom-altitude scan
#     needs the equivalent for test/) are assertions about application code,
#     so they read ADDED_SRC / ADDED_TEST_UNIT below. Both are built with a
#     git pathspec that names what to INCLUDE, not what to exclude — so
#     scoping them can never be widened by accident to cover a file it
#     shouldn't, in scripts/ or anywhere else.
#   - Conflict markers and focused/skipped tests are genuinely about any
#     file — a real conflict marker or a real `.only(` in scripts/ is a real
#     problem — so those two read ADDED_EXCEPT_ATTACK_SUITE, which excludes
#     exactly one path, by its exact name, and nothing else. A glob such as
#     `scripts/attack-*.sh` would risk exempting some future attack-*.sh that
#     is not this suite; excluding the literal path cannot.
#
# Nothing about which patterns are searched changes here, only which lines
# are offered to them.

# Added lines confined to application code. Governs: the innerHTML/
# insertAdjacentHTML scan, the href note.
DIFF_SRC="$(git diff "$MERGE_BASE"..HEAD -- src)"
ADDED_SRC="$(printf '%s\n' "$DIFF_SRC" | grep '^+' | grep -v '^+++' || true)"

# Added lines confined to vitest specs — test/, excluding test/browser/, the
# one place a layout measurement belongs. Governs: the jsdom-altitude scan.
DIFF_TEST_UNIT="$(git diff "$MERGE_BASE"..HEAD -- test ':!test/browser')"
ADDED_TEST_UNIT="$(printf '%s\n' "$DIFF_TEST_UNIT" | grep '^+' | grep -v '^+++' || true)"

# Added lines for the whole diff except the attack suite's own fixtures.
# Governs: the conflict-marker and focused/skipped-test hygiene checks.
DIFF_EXCEPT_ATTACK_SUITE="$(git diff "$MERGE_BASE"..HEAD -- ':!scripts/attack-preflight.sh')"
ADDED_EXCEPT_ATTACK_SUITE="$(printf '%s\n' "$DIFF_EXCEPT_ATTACK_SUITE" | grep '^+' | grep -v '^+++' || true)"

[ -n "$CHANGED" ] || { echo "FATAL: no changes against $BASE_REF — nothing to review" >&2; exit 2; }

changed_matching() { grep -qE "$1" <<<"$CHANGED"; }

# ---------------------------------------------------------------- CI status ---

say "CI"
if [ -n "$PR" ]; then
  if command -v gh >/dev/null 2>&1; then
    state="$(gh pr view "$PR" --json statusCheckRollup \
      --jq '[.statusCheckRollup[]?.conclusion] | if length == 0 then "NONE" else (if any(. == "FAILURE" or . == "CANCELLED" or . == "TIMED_OUT") then "FAILING" else "PASSING" end) end' 2>/dev/null)" || state="UNKNOWN"
    case "$state" in
      PASSING) ok "checks passing on PR #$PR" ;;
      FAILING) find_ "checks FAILING on PR #$PR — do not review a red branch" ;;
      NONE)    find_ "PR #$PR has no checks at all — the check job may not be wired to pull_request" ;;
      *)       note "could not read check status for PR #$PR" ;;
    esac
    labels="$(gh pr view "$PR" --json labels --jq '[.labels[].name] | join(", ")' 2>/dev/null || echo "")"
    [ -n "$labels" ] && note "labels: $labels"
  else
    note "gh not on PATH; skipping CI status"
  fi
else
  note "no PR number given; skipping CI status"
fi

# ------------------------------------------------- the nine required artifacts ---

say "Required artifacts (PROCESS.md §3)"
src_touched=$(changed_matching '^(src/|index\.html)' && echo yes || echo no)

for pair in \
  "docs/task-specs/:task spec" \
  "docs/test-plans/:test plan" \
  "docs/qa-notes/:QA notes" \
  "docs/evidence/:evidence file"
do
  dir="${pair%%:*}"; label="${pair#*:}"
  if changed_matching "^$dir"; then ok "$label touched"
  elif [ "$src_touched" = yes ]; then find_ "no $label in this diff, but src/ changed"
  else note "no $label (no src/ change either)"
  fi
done

if changed_matching '^docs/STATUS\.md$'; then ok "STATUS.md ledger row touched"
else find_ "docs/STATUS.md not touched — every PR that starts or finishes a unit edits one row"
fi

if changed_matching '^src/i18n/en\.ts$'; then
  if changed_matching '^src/i18n/de\.ts$' && changed_matching '^src/i18n/uk\.ts$'; then
    ok "all three catalogues touched"
  else
    find_ "src/i18n/en.ts changed but de.ts and/or uk.ts did not — there are no fallbacks"
  fi
fi

# ---------------------------------------------------------------- hygiene ---

say "Hygiene"
# Both checks below read ADDED_EXCEPT_ATTACK_SUITE, not ADDED: they are
# genuinely about any file, so a real hit anywhere else must still fire — but
# scripts/attack-preflight.sh plants a literal conflict marker and a literal
# `it.only(` as its own fixtures, so it alone is exempt. See the T9 note above
# ADDED_SRC.
if grep -qE '^\+.*(<<<<<<<|>>>>>>>|^\+=======$)' <<<"$ADDED_EXCEPT_ATTACK_SUITE"; then
  find_ "conflict markers in the diff"
else ok "no conflict markers"
fi

if grep -qE '\b(it|test|describe)\.(only|skip)\b|\bxit\(|\bxdescribe\(' <<<"$ADDED_EXCEPT_ATTACK_SUITE"; then
  find_ "focused or skipped test added — \`.only\` hides the rest of the suite, \`.skip\` hides the case"
else ok "no focused or skipped tests"
fi

if grep -qE '@ts-(ignore|expect-error|nocheck)|\bas any\b|eslint-disable' <<<"$ADDED"; then
  note "a cast or disable comment was added — each one is a question the implementer must answer"
fi

# ------------------------------------------------------- project invariants ---

say "Project invariants"

# XSS: an innerHTML assignment, or a template literal building a tag, in the
# diff. Reads ADDED_SRC, not ADDED — this is an assertion about application
# code, and scripts/attack-preflight.sh plants the literal string `innerHTML`
# as its own fixture (see the T9 note above ADDED_SRC).
if grep -qE 'innerHTML|insertAdjacentHTML|outerHTML' <<<"$ADDED_SRC"; then
  find_ "an innerHTML/insertAdjacentHTML path is in the diff — trace one hostile payload value by hand through it (PROCESS.md §4)"
else ok "no raw HTML assignment added"
fi

# A URL rendered as an href needs a scheme allowlist, not an escape. Also
# scoped to ADDED_SRC for the same reason. Unlike the other invariants this
# one is advisory (a note, not a finding) — but it still gets a real `ok`
# line for the quiet case, not just silence, because an absence-only
# assertion passes against a gate stubbed dead as readily as against a
# working one (see the attack suite's expect_ok).
if grep -qE 'href:|href="\$\{|"href",' <<<"$ADDED_SRC"; then
  note "an href is built in the diff — javascript: and data: survive HTML escaping; check for a scheme allowlist"
else ok "no href built in the diff"
fi

# fetch outside the three modules allowed one.
offenders="$(printf '%s\n' "$CHANGED" \
  | grep -E '^src/' \
  | grep -vE '^src/(store|share|crypto|worker)\.ts$' \
  | while read -r f; do
      [ -f "$f" ] || continue
      added_f="$(git diff "$MERGE_BASE"..HEAD -- "$f" | grep '^+' || true)"
      grep -qE '\bfetch\(|XMLHttpRequest|navigator\.sendBeacon|new WebSocket' <<<"$added_f" && echo "$f"
    done)"
if [ -n "$offenders" ]; then
  find_ "a network call was added outside store/share/crypto/worker: $(printf '%s' "$offenders" | tr '\n' ' ') — see PROCESS.md §5"
else ok "no network call added outside the modules allowed one"
fi

# DOM ids minted outside ident.ts.
idoffenders="$(printf '%s\n' "$CHANGED" \
  | grep -E '^src/' | grep -vE '^src/ident\.ts$' \
  | while read -r f; do
      [ -f "$f" ] || continue
      added_f="$(git diff "$MERGE_BASE"..HEAD -- "$f" | grep '^+' || true)"
      grep -qE '\bid: *[`"'"'"']\w+_|"#" *\+|href: *[`"'"'"']#' <<<"$added_f" && echo "$f"
    done)"
if [ -n "$idoffenders" ]; then
  note "a DOM id or fragment may be built outside ident.ts: $(printf '%s' "$idoffenders" | tr '\n' ' ') — see DECISIONS.md D1"
else ok "no id minted outside ident.ts"
fi

# Hardcoded English: a multi-word capitalised string literal in src/, outside i18n and legal.
copyoffenders="$(printf '%s\n' "$CHANGED" \
  | grep -E '^src/' | grep -vE '^src/(i18n|legal|samples)/' \
  | while read -r f; do
      [ -f "$f" ] || continue
      # Several spellings, because the first version of this check caught one
      # (`text: "Two words"`) and missed single quotes, `title:`, `label:`,
      # `placeholder:`, `aria-label`, `textContent =` and template literals —
      # every one of which is how user-facing copy actually gets hardcoded.
      added_f="$(git diff "$MERGE_BASE"..HEAD -- "$f" | grep '^+' || true)"
      code_f="$(grep -vE "^\\+\\s*(//|\\*|/\\*)" <<<"$added_f" || true)"
      grep -qE "(text|title|label|placeholder|summary|headline|hint|\"aria-label\"|'aria-label')\\s*:\\s*[\"'\`][A-Z][A-Za-z]* [a-z]|textContent\\s*=\\s*[\"'\`][A-Z][A-Za-z]* [a-z]|\\?\\?\\s*[\"'\`][A-Z]" <<<"$code_f" && echo "$f"
    done)"
if [ -n "$copyoffenders" ]; then
  find_ "possible hardcoded user-facing copy outside the catalogues: $(printf '%s' "$copyoffenders" | tr '\n' ' ')"
else ok "no hardcoded copy detected"
fi

# jsdom-altitude: a layout assertion in a vitest test cannot fail. The gate
# condition still checks $CHANGED for any test/ file outside test/browser/,
# but the pattern match reads ADDED_TEST_UNIT — lines added inside that file
# set only — because scripts/attack-preflight.sh plants the literal string
# `scrollY` as its own fixture and is not a vitest spec (see the T9 note
# above ADDED_SRC).
if grep -qE '^test/[^b]' <<<"$CHANGED"; then
  if grep -qE 'scrollY|scrollTop|getBoundingClientRect|offsetHeight|offsetTop|clientHeight' <<<"$ADDED_TEST_UNIT"; then
    find_ "a layout measurement is asserted in a vitest test — jsdom has no layout engine, so that assertion cannot fail; it belongs in test/browser/nav-scenarios.js"
  else ok "no layout assertion under jsdom"
  fi
fi

# ------------------------------------------------------- evidence staleness ---

# A file present on disk but excluded by .gitignore never reaches CI. It passes
# locally (the tooling reads the disk) and then fails, or silently ships
# nothing. A bare `fixtures/` rule swallowing `test/fixtures/` is exactly how
# this was found.
say "Files that exist but would never be committed"
ignored="$(git status --porcelain --ignored=matching -- test docs src 2>/dev/null \
  | awk '/^!! /{print $2}' | grep -vE '(^|/)(node_modules|dist|\.wrangler)/|\.DS_Store$|worker-configuration\.d\.ts$' || true)"
if [ -n "$ignored" ]; then
  find_ "ignored by .gitignore but present under test/, docs/ or src/: $(printf '%s' "$ignored" | tr '\n' ' ')"
else
  ok "nothing under test/, docs/ or src/ is silently ignored"
fi

say "Evidence staleness (by hand — no CI gate yet, see PROCESS.md §8)"

# EVERY evidence file in the diff, not just one. `head -1` here used to mean a
# diff carrying a fresh T1 and a stale T2 reported "ok" and said nothing about
# T2 — a silent false negative in the check that stands in for the absent CI
# gate, which is worse than the gate being absent.
ev_files="$(printf '%s\n' "$CHANGED" | grep -E '^docs/evidence/.*\.md$' || true)"
if [ -z "$ev_files" ]; then
  note "no evidence file in this diff"
else
  printf '%s\n' "$ev_files" | while IFS= read -r ev; do
    [ -n "$ev" ] || continue
    if [ ! -f "$ev" ]; then
      printf '  note    evidence file %s was deleted\n' "$ev"
      continue
    fi
    sha="$(grep -oE '\*\*Commit:\*\* *`?[0-9a-f]{7,40}' "$ev" | grep -oE '[0-9a-f]{7,40}' | head -1)"
    if [ -z "$sha" ]; then
      printf '  FINDING %s has no readable **Commit:** sha — the sha is the whole point of the file\n' "$ev"
      echo x >> "$FINDINGS_FILE"
    elif ! git cat-file -e "$sha^{commit}" 2>/dev/null; then
      printf '  FINDING %s records commit %s, which is not in this repository\n' "$ev" "$sha"
      echo x >> "$FINDINGS_FILE"
    else
      shipped_since="$(git diff --name-only "$sha"..HEAD -- src index.html 2>/dev/null)"
      if [ -n "$shipped_since" ]; then
        printf '  FINDING %s is STALE: shipped files changed after %s — %s\n' \
          "$ev" "$sha" "$(printf '%s' "$shipped_since" | tr '\n' ' ')"
        echo x >> "$FINDINGS_FILE"
      else
        printf '  ok      %s: sha %s still covers every shipped file\n' "$ev" "$sha"
      fi
    fi
  done
fi
# The loop above runs in a subshell (it is fed by a pipe), so its findings are
# counted through a file rather than the shell variable, which would not survive.
findings=$((findings + $(wc -l < "$FINDINGS_FILE" | tr -d ' ')))

# -------------------------------------------------------------------- done ---

printf '\n\033[1m== Summary\033[0m\n'
printf '  files changed: %s\n' "$(printf '%s\n' "$CHANGED" | grep -c . || true)"
printf '  findings: %s   notes: %s\n' "$findings" "$notes"
printf '\n  Findings are mechanical facts, not verdicts. Judge them, then spend the\n'
printf '  rest of the review on what a script cannot see: PROCESS.md §4 injection,\n'
printf '  correctness traced by hand, and the edge case the test plan omits.\n\n'

[ "$findings" -eq 0 ] || exit 1
