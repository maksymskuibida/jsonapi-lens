#!/usr/bin/env bash
#
# Attack suite for scripts/review-preflight.sh.
#
# A broken gate is invisible: it reports success either way, so an untested one
# is indistinguishable from no gate at all. This suite builds throwaway
# repositories with real commits, plants the defect each check was written for,
# and confirms the check catches *that* defect.
#
# Two rules this suite exists to honour, both learned the expensive way:
#
#   1. Every case asserts WHY the gate fired, not merely that it did. A case
#      that only checks the exit status passes as long as *something* failed —
#      so a case meant to prove the staleness detector works can be passing on
#      a missing task spec instead, and the detector could be deleted outright
#      without this suite noticing.
#
#   2. Two cases assert the gate's CEILING — what it deliberately does not
#      catch: a `fetch` inside `share.ts` is legitimate, and evidence recorded
#      at HEAD is not stale. If either starts failing, the gate has grown a
#      claim it cannot support.
#
# It also runs from `/` on purpose. A relative path inside the gate becomes
# unreachable the moment the harness changes directory, and every case then
# "fails" with exit 127 for a reason unrelated to the gate.
#
# Usage:  scripts/attack-preflight.sh
#
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PREFLIGHT="$REPO_ROOT/scripts/review-preflight.sh"
EVIDENCE_TEMPLATE="$REPO_ROOT/docs/templates/EVIDENCE.md"
[ -f "$PREFLIGHT" ] || { echo "missing $PREFLIGHT"; exit 2; }

WORK="$(mktemp -d)"
pass=0; fail=0

# Run from an unrelated cwd so a relative path in the gate would break loudly.
cd /

fresh_repo() {
  local d="$WORK/$1"; rm -rf "$d"; mkdir -p "$d"
  git -C "$d" init -q -b main
  git -C "$d" config user.email a@b.c; git -C "$d" config user.name t
  mkdir -p "$d/src" "$d/docs/evidence" "$d/docs/task-specs" "$d/docs/test-plans" "$d/docs/qa-notes" "$d/test/browser" "$d/scripts"
  echo "export const x = 1;" > "$d/src/main.ts"
  echo "# status" > "$d/docs/STATUS.md"
  echo "export const en = { a: 'b' };" > "$d/src/i18n-en.ts"
  mkdir -p "$d/src/i18n"; for l in en de uk; do echo "export const $l = {};" > "$d/src/i18n/$l.ts"; done
  cp "$PREFLIGHT" "$d/scripts/review-preflight.sh"; chmod +x "$d/scripts/review-preflight.sh"
  git -C "$d" add -A >/dev/null; git -C "$d" commit -qm base
  # A real base ref to compare against.
  git -C "$d" update-ref refs/remotes/origin/main main
  git -C "$d" checkout -q -b feat/x
  echo "$d"
}

# expect_finding <name> <repo> <expected exit> <regex the output must contain>
expect() {
  local name="$1" d="$2" want_code="$3" want_re="$4"
  local out code
  out="$(cd "$d" && ./scripts/review-preflight.sh 2>&1)"; code=$?
  if [ "$code" != "$want_code" ]; then
    printf 'FAIL  %-42s exit %s, wanted %s\n' "$name" "$code" "$want_code"; fail=$((fail+1)); return
  fi
  if ! printf '%s' "$out" | grep -qE "$want_re"; then
    printf 'FAIL  %-42s exit %s ok but blocked for the wrong reason\n' "$name" "$code"
    printf '        wanted /%s/\n' "$want_re"; fail=$((fail+1)); return
  fi
  printf 'pass  %-42s exit %s, matched\n' "$name" "$code"; pass=$((pass+1))
}

# A ceiling case asserts what the gate deliberately does NOT flag. Asserting
# only the absence of a message is worthless — a gate stubbed to `exit 2`
# produces no messages at all and every such case "passes". So require the
# check's own positive line, which a dead gate cannot emit.
expect_ok() {
  local name="$1" d="$2" want_ok="$3" want_absent="$4"
  local out
  out="$(cd "$d" && ./scripts/review-preflight.sh 2>&1)"
  if ! printf '%s' "$out" | grep -qE "^  ok .*$want_ok"; then
    printf 'FAIL  %-42s gate never reported ok for this check\n' "$name"
    printf '        wanted an ok line matching /%s/\n' "$want_ok"; fail=$((fail+1)); return
  fi
  if printf '%s' "$out" | grep -qE "$want_absent"; then
    printf 'FAIL  %-42s gate over-reached and flagged it\n' "$name"; fail=$((fail+1)); return
  fi
  printf 'pass  %-42s ok reported, not flagged\n' "$name"; pass=$((pass+1))
}

# fresh_repo_with_attack_suite <name> — like fresh_repo, but ADDS a
# scripts/attack-preflight.sh on feat/x (so it lands in the diff under test,
# the same way T0's real commit adding the attack suite lands in every
# branch's diff until T0 merges — see docs/task-specs/T9.md). Its body is a
# minimal stand-in, not a copy of the real 270-line suite: it plants exactly
# the substrings the real one plants as fixtures for other checks — a
# conflict marker, `.only(`, `innerHTML`, `href:`, `scrollY` — so a case
# built on this helper exercises T9's fix without coupling to the real
# suite's unrelated content ever drifting out from under it.
fresh_repo_with_attack_suite() {
  local d
  d="$(fresh_repo "$1")"
  cat > "$d/scripts/attack-preflight.sh" <<'ATTACK'
#!/usr/bin/env bash
# Stand-in for the real attack suite's own planted defects (T9).
printf 'node.innerHTML = payload;\n'
printf 'href: "${url}"\n'
printf 'expect(window.scrollY).toBe(0);\n'
printf 'it.only("x", () => {});\n'
printf '<<<<<<< HEAD\n'
ATTACK
  git -C "$d" add -A >/dev/null; git -C "$d" commit -qm "add attack suite fixture"
  echo "$d"
}

# --- 1. fails closed when there is nothing to compare -----------------------
d=$(fresh_repo nochange)
expect "fails closed: no changes vs base" "$d" 2 "no changes against"

# --- 2. fails closed when the base ref cannot resolve -----------------------
d=$(fresh_repo nobase)
git -C "$d" update-ref -d refs/remotes/origin/main
echo "y" >> "$d/src/main.ts"; git -C "$d" commit -qam x
expect "fails closed: base ref missing" "$d" 2 "cannot resolve origin/main"

# --- 3. src touched, no spec / plan / notes / evidence ----------------------
d=$(fresh_repo missingartifacts)
echo "// change" >> "$d/src/main.ts"; git -C "$d" commit -qam x
expect "src changed, no task spec" "$d" 1 "no task spec in this diff, but src/ changed"
expect "src changed, no evidence file" "$d" 1 "no evidence file in this diff, but src/ changed"

# --- 4. STATUS.md untouched -------------------------------------------------
expect "STATUS.md ledger row untouched" "$d" 1 "docs/STATUS\.md not touched"

# --- 5. en.ts without de/uk ------------------------------------------------
d=$(fresh_repo i18n)
echo "// x" >> "$d/src/i18n/en.ts"; git -C "$d" commit -qam x
expect "en.ts changed alone" "$d" 1 "de\.ts and/or uk\.ts did not"

# --- 6. focused test ------------------------------------------------------
d=$(fresh_repo onlytest)
mkdir -p "$d/test"; printf 'it.only("x", () => {});\n' > "$d/test/a.test.ts"
git -C "$d" add -A >/dev/null; git -C "$d" commit -qam x
expect "it.only added" "$d" 1 "focused or skipped test added"

# --- 7. innerHTML in the diff --------------------------------------------
d=$(fresh_repo innerhtml)
printf 'node.innerHTML = payload;\n' >> "$d/src/main.ts"; git -C "$d" commit -qam x
expect "innerHTML path added" "$d" 1 "innerHTML/insertAdjacentHTML path is in the diff"

# --- 8. fetch outside the allowed modules --------------------------------
d=$(fresh_repo fetch)
printf 'await fetch("https://evil.example");\n' >> "$d/src/main.ts"; git -C "$d" commit -qam x
expect "fetch added in src/main.ts" "$d" 1 "network call was added outside store/share/crypto/worker"

# --- 8b. fetch INSIDE an allowed module must NOT fire (the ceiling) ------
d=$(fresh_repo fetchok)
printf 'export const s = 1;\nawait fetch("/api/shares");\n' > "$d/src/share.ts"
git -C "$d" add -A >/dev/null; git -C "$d" commit -qam x
expect_ok "ceiling: fetch in share.ts allowed" "$d" \
  "no network call added outside the modules allowed one" "network call was added outside"

# --- 9. layout assertion under jsdom ------------------------------------
d=$(fresh_repo altitude)
mkdir -p "$d/test"; printf 'expect(window.scrollY).toBe(0);\n' > "$d/test/scroll.test.ts"
git -C "$d" add -A >/dev/null; git -C "$d" commit -qam x
expect "layout assertion in a vitest test" "$d" 1 "jsdom has no layout engine"

# --- 10. evidence staleness — the one that catches ran-it-then-changed-it
d=$(fresh_repo stale)
echo "// first" >> "$d/src/main.ts"; git -C "$d" commit -qam first
SHA="$(git -C "$d" rev-parse HEAD)"
printf -- '- **Commit:** `%s`\n' "$SHA" > "$d/docs/evidence/T1.md"
git -C "$d" add -A >/dev/null; git -C "$d" commit -qm evidence
echo "// AFTER the run" >> "$d/src/main.ts"; git -C "$d" commit -qam after
expect "evidence stale after a later src change" "$d" 1 "is STALE: shipped files changed after"

# --- 10b. evidence recorded at HEAD must NOT be reported stale -----------
d=$(fresh_repo fresh)
echo "// only" >> "$d/src/main.ts"; git -C "$d" commit -qam only
SHA="$(git -C "$d" rev-parse HEAD)"
printf -- '- **Commit:** `%s`\n' "$SHA" > "$d/docs/evidence/T1.md"
git -C "$d" add -A >/dev/null; git -C "$d" commit -qm evidence
expect_ok "ceiling: fresh evidence accepted" "$d" \
  "still covers every shipped file" "is STALE"

# --- 10c. TWO evidence files, only one stale — the `head -1` bug ---------
d=$(fresh_repo twoevidence)
echo "// one" >> "$d/src/main.ts"; git -C "$d" commit -qam one
OLD="$(git -C "$d" rev-parse HEAD)"
printf -- '- **Commit:** `%s`\n' "$OLD" > "$d/docs/evidence/T1.md"
printf -- '- **Commit:** `%s`\n' "$OLD" > "$d/docs/evidence/T2.md"
git -C "$d" add -A >/dev/null; git -C "$d" commit -qm ev
echo "// AFTER the run" >> "$d/src/main.ts"; git -C "$d" commit -qam after
NEW="$(git -C "$d" rev-parse HEAD)"
# T1 is re-recorded at the new head; T2 is left behind. A gate that reads only
# the first evidence file reports a clean pass here.
printf -- '- **Commit:** `%s`\n' "$NEW" > "$d/docs/evidence/T1.md"
git -C "$d" add -A >/dev/null; git -C "$d" commit -qm refresh
expect "second evidence file stale, first fresh" "$d" 1 "docs/evidence/T2\.md is STALE"

# --- 10d. a file that exists but is git-ignored --------------------------
d=$(fresh_repo ignoredfile)
printf 'fixtures/\n' > "$d/.gitignore"
mkdir -p "$d/test/fixtures"; echo '{}' > "$d/test/fixtures/data.json"
echo "// x" >> "$d/src/main.ts"
git -C "$d" add -A >/dev/null; git -C "$d" commit -qam x
expect "test data silently excluded by .gitignore" "$d" 1 "ignored by \.gitignore but present"

# --- 10e. ceiling: node_modules being ignored is not a finding -----------
d=$(fresh_repo ignoredok)
printf 'node_modules/\n' > "$d/.gitignore"
mkdir -p "$d/src/node_modules"; echo 'x' > "$d/src/node_modules/pkg.js"
echo "// x" >> "$d/src/main.ts"
git -C "$d" add -A >/dev/null; git -C "$d" commit -qam x
expect_ok "ceiling: node_modules is not test data" "$d" \
  "nothing under test/, docs/ or src/ is silently ignored" "ignored by \.gitignore but present"

# --- 11. unreadable SHA in the evidence file ----------------------------
d=$(fresh_repo badsha)
echo "// x" >> "$d/src/main.ts"; git -C "$d" commit -qam x
printf -- '- **Commit:** `<full sha of the code you actually ran>`\n' > "$d/docs/evidence/T1.md"
git -C "$d" add -A >/dev/null; git -C "$d" commit -qm ev
expect "template placeholder left in Commit:" "$d" 1 "no readable \*\*Commit:\*\* sha"

# --- 11b. hardcoded copy, in each spelling the first version missed -----
i=0
for spelling in \
  'el("p", { text: "Save changes" });' \
  "el('p', { title: 'Save changes' });" \
  'el("p", { placeholder: "Search resources" });' \
  'node.textContent = "Not found";' \
  'const s = label ?? "Untitled document";'
do
  i=$((i+1))
  d=$(fresh_repo "copy$i")
  printf '%s\n' "$spelling" >> "$d/src/main.ts"; git -C "$d" commit -qam x
  expect "hardcoded copy spelling $i" "$d" 1 "possible hardcoded user-facing copy"
done

# --- 11c. ceiling: a comment and a non-copy string must NOT fire --------
d=$(fresh_repo copyok)
printf '// Save changes when the user asks\nconst k = "en";\nconst p = "/data/0";\n' >> "$d/src/main.ts"
git -C "$d" commit -qam x
expect_ok "ceiling: comments and keys are not copy" "$d" \
  "no hardcoded copy detected" "possible hardcoded user-facing copy"

# --- 11d. A LARGE diff. The suite was structurally blind to this ---------
#
# Every other case here produces a diff of a few dozen bytes, which fits
# entirely in the kernel's pipe buffer — so a writer never blocks, never takes
# SIGPIPE, and a `printf | grep -q` check appears to work. On a real diff it
# does not: `grep -q` exits at its first match, the writer dies of SIGPIPE, and
# `pipefail` turns that into "the check found nothing".
#
# That defect sat in the `innerHTML` check — the project's highest-severity one
# — reporting `ok` over 13 real hits, ten runs out of ten, while this suite
# reported 24/24. So this case exists to make the suite able to see the class of
# bug at all: a diff far larger than any pipe buffer, with the match near the
# top so the writer has the most left to write.
d=$(fresh_repo bigdiff)
printf 'node.innerHTML = payload;\n' >> "$d/src/main.ts"
# ~400 KB of added lines, well past the 64 KB pipe buffer.
awk 'BEGIN { for (i = 0; i < 8000; i++) print "export const pad" i " = \"" i "\";" }' \
  > "$d/src/pad.ts"
git -C "$d" add -A >/dev/null; git -C "$d" commit -qam x
expect "large diff: innerHTML still detected" "$d" 1 "innerHTML/insertAdjacentHTML path is in the diff"

# The same large diff must not break the other string checks either.
d=$(fresh_repo bigdiff2)
printf 'it.only("x", () => {});\n' > "$d/test/a.test.ts"
awk 'BEGIN { for (i = 0; i < 8000; i++) print "export const pad" i " = \"" i "\";" }' \
  > "$d/src/pad.ts"
mkdir -p "$d/test"; git -C "$d" add -A >/dev/null; git -C "$d" commit -qam x
expect "large diff: focused test still detected" "$d" 1 "focused or skipped test added"

# --- 12. THE TEMPLATE ITSELF must be parseable by the gate --------------
# A gate that cannot read the artifact its own template produces is inert.
d=$(fresh_repo template)
echo "// x" >> "$d/src/main.ts"; git -C "$d" commit -qam x
SHA="$(git -C "$d" rev-parse HEAD)"
sed "s|<full sha of the code you actually ran — git rev-parse HEAD at the moment of the run>|$SHA|" \
  "$EVIDENCE_TEMPLATE" > "$d/docs/evidence/T1.md"
git -C "$d" add -A >/dev/null; git -C "$d" commit -qm ev
out="$(cd "$d" && ./scripts/review-preflight.sh 2>&1)"
if printf '%s' "$out" | grep -qE "^  ok .*still covers every shipped file"; then
  printf 'pass  %-42s gate parses its own template\n' "template round-trip"; pass=$((pass+1))
else
  printf 'FAIL  %-42s gate cannot read its own template output\n' "template round-trip"
  printf '%s\n' "$out" | grep -i evidence; fail=$((fail+1))
fi

# --- 13. T9: a diff touching only the attack suite reads clean ----------
#
# scripts/attack-preflight.sh plants a literal conflict marker, `.only(`,
# `innerHTML`, `href:` and `scrollY` as ITS OWN fixtures. Before T9, a diff
# that so much as touched this file read as a conflict marker, a focused
# test and an innerHTML violation that do not exist, because those checks
# scanned every added line in the whole diff rather than the files each
# invariant actually governs. Assert the ABSENCE of each finding message
# together with the PRESENCE of the check's own `ok` line for every code
# invariant that can fire here — never the exit status alone, and never
# absence alone: a gate stubbed dead (see the dead-gate run in the PR body)
# emits neither ok nor finding, so an absence-only assertion would pass
# against it just as happily as against a working gate.
d=$(fresh_repo_with_attack_suite t9only)
expect_ok "T9: attack-suite only — conflict markers silent" "$d" \
  "no conflict markers" "conflict markers in the diff"
expect_ok "T9: attack-suite only — focused/skipped silent" "$d" \
  "no focused or skipped tests" "focused or skipped test added"
expect_ok "T9: attack-suite only — innerHTML silent" "$d" \
  "no raw HTML assignment added" "innerHTML/insertAdjacentHTML path is in the diff"
expect_ok "T9: attack-suite only — network call silent" "$d" \
  "no network call added outside the modules allowed one" "network call was added outside"
expect_ok "T9: attack-suite only — DOM id silent" "$d" \
  "no id minted outside ident.ts" "id or fragment may be built outside ident.ts"
expect_ok "T9: attack-suite only — hardcoded copy silent" "$d" \
  "no hardcoded copy detected" "possible hardcoded user-facing copy"
# The href check used to be a bare `note`, with no positive line at all even
# on a clean diff — which meant this case could only assert its ABSENCE, and
# an absence-only assertion is exactly what this suite exists to rule out
# (it passes against a gate stubbed dead as readily as a working one). Fixed
# by giving the check a real `ok` branch alongside the note, in the same
# T9 change, so expect_ok can hold it to the same standard as every other
# invariant here.
expect_ok "T9: attack-suite only — href note silent" "$d" \
  "no href built in the diff" "an href is built in the diff"

# --- 14. T9: jsdom-altitude must not fire on the suite's scrollY fixture -
#
# The altitude check only runs at all once a real test/ file (outside
# test/browser/) is in the diff — exactly T1's actual bug report: a real
# test file plus T0's attack-suite commit landing in the same diff. Case 13
# above can't exercise this one, because its diff never opens that gate.
d=$(fresh_repo_with_attack_suite t9altitude)
mkdir -p "$d/test"
printf 'import { it, expect } from "vitest";\nit("adds", () => { expect(1 + 1).toBe(2); });\n' \
  > "$d/test/real.test.ts"
git -C "$d" add -A >/dev/null; git -C "$d" commit -qm "add an unrelated real vitest test"
expect_ok "T9: real test + attack suite — altitude silent" "$d" \
  "no layout assertion under jsdom" "jsdom has no layout engine"

# --- 15. T9: a REAL src/ violation is still found beside the suite ------
d=$(fresh_repo_with_attack_suite t9realplusattack)
printf 'node.innerHTML = payload;\n' >> "$d/src/main.ts"
git -C "$d" add -A >/dev/null; git -C "$d" commit -qm "a real innerHTML violation, alongside the attack suite"
expect "T9: real src/ innerHTML still found beside the suite" "$d" 1 \
  "innerHTML/insertAdjacentHTML path is in the diff"

# --- 16. T9: a conflict marker elsewhere is still found beside the suite -
d=$(fresh_repo_with_attack_suite t9conflictelsewhere)
printf 'echo hi\n<<<<<<< HEAD\necho conflicted\n=======\necho other\n>>>>>>> branch\n' \
  > "$d/scripts/other-tool.sh"
git -C "$d" add -A >/dev/null; git -C "$d" commit -qm "a real conflict marker in a different script"
expect "T9: conflict marker elsewhere still found beside the suite" "$d" 1 \
  "conflict markers in the diff"

# --- 17. T9 ceiling: only the exact suite path is exempt ----------------
# A similarly-named but different script must NOT be exempted — the
# exclusion is one literal path, not a `scripts/attack-*.sh` glob, so it
# cannot swallow a future script that merely starts the same way.
d=$(fresh_repo t9notexempt)
printf 'echo hi\n<<<<<<< HEAD\n' > "$d/scripts/attack-other.sh"
git -C "$d" add -A >/dev/null; git -C "$d" commit -qm "conflict marker in a similarly named, non-suite script"
expect "T9 ceiling: a similarly named script is not exempt" "$d" 1 \
  "conflict markers in the diff"

# --- 18. T9: innerHTML mentioned as prose in a doc file must not fire ---
#
# The bug outlives the attack suite. PROCESS.md and the agent briefs discuss
# these very invariants in prose (an innerHTML assignment, for instance), so
# scoping the code invariants to application code has to keep them quiet on
# a doc-only diff too — otherwise every future edit to that paragraph would
# misreport a real violation, forever, long after T0 merges. No attack-suite
# fixture is involved here at all; this is the plain fresh_repo.
d=$(fresh_repo t9docprose)
mkdir -p "$d/docs"
cat > "$d/docs/PROCESS.md" <<'DOC'
# Process

Every interpolation on an innerHTML path goes through escapeHtml.
DOC
git -C "$d" add -A >/dev/null; git -C "$d" commit -qm "document the innerHTML rule in prose"
expect_ok "T9: innerHTML mentioned in a doc file — invariant silent" "$d" \
  "no raw HTML assignment added" "innerHTML/insertAdjacentHTML path is in the diff"

# --- 19. T9: the PR's own base wins over a stale origin/main ------------
#
# This repository's real implementer branches fork from a shared integration
# branch rather than from main directly, so main can lag behind by an entire
# unmerged commit's worth of unrelated changes — this is the deeper cause
# behind why the attack suite's fixtures reach every branch's diff in the
# first place. Simulated here: an "integration" commit lands on top of the
# shared base and adds a real (if contrived) innerHTML hit that origin/main
# does not have; feat/x is then rebuilt ON TOP of integration, the way this
# repo's branches actually are, adding one small, unrelated change of its
# own. If the gate fell back to stale origin/main it would report the
# integration commit's innerHTML as part of THIS diff. Resolving the PR's
# real base instead excludes it. `gh` is stubbed on PATH so this does not
# depend on network access or a real PR.
d=$(fresh_repo t9prbase)
git -C "$d" checkout -q -b integration
printf 'node.innerHTML = integrationNoise;\n' > "$d/src/other.ts"
git -C "$d" add -A >/dev/null; git -C "$d" commit -qm "integration commit origin/main does not have yet"
git -C "$d" update-ref refs/remotes/origin/integration integration
git -C "$d" checkout -q -B feat/x integration
echo "// the actual feature change" >> "$d/src/main.ts"
git -C "$d" commit -qam "the actual feature commit"

FAKEBIN="$(mktemp -d)"
cat > "$FAKEBIN/gh" <<'FAKEGH'
#!/usr/bin/env bash
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  echo "integration"
  exit 0
fi
exit 1
FAKEGH
chmod +x "$FAKEBIN/gh"
out="$(cd "$d" && PATH="$FAKEBIN:$PATH" ./scripts/review-preflight.sh 42 2>&1)"
rm -rf "$FAKEBIN"

if printf '%s' "$out" | grep -qE 'comparing against the base branch of PR #42 \(origin/integration\)' \
   && printf '%s' "$out" | grep -qE '^  ok .*no raw HTML assignment added' \
   && ! printf '%s' "$out" | grep -qE 'innerHTML/insertAdjacentHTML path is in the diff'; then
  printf 'pass  %-42s used the PR base, not stale origin/main\n' "T9: PR base-ref wins over stale origin/main"
  pass=$((pass+1))
else
  printf 'FAIL  %-42s did not resolve or use the PR base correctly\n' "T9: PR base-ref wins over stale origin/main"
  printf '%s\n' "$out"
  fail=$((fail+1))
fi

# --- 20. T9: exhausting every base-ref candidate still fails closed -----
d=$(fresh_repo t9baseexhausted)
git -C "$d" update-ref -d refs/remotes/origin/main
echo "y" >> "$d/src/main.ts"; git -C "$d" commit -qam x
# A PR number is given, but this throwaway repo has no real GitHub remote,
# so even the most-trusted source resolves to nothing — real gh fails fast
# and cleanly against a repo like this (verified by hand: "no git remotes
# found", exit 1, no network round trip, no prompt — and if gh is not
# installed at all, the resolver skips straight past it). The chain must
# still fall through the unconfigured upstream to origin/main, find that
# missing too, and fail closed rather than silently reporting a pass.
out="$(cd "$d" && ./scripts/review-preflight.sh 999999 2>&1)"; code=$?
if [ "$code" = 2 ] && printf '%s' "$out" | grep -qE "cannot resolve origin/main"; then
  printf 'pass  %-42s exhausted chain still fails closed\n' "T9: base-ref chain exhausted, even with a PR"
  pass=$((pass+1))
else
  printf 'FAIL  %-42s exit %s — wanted 2 with cannot resolve origin/main\n' \
    "T9: base-ref chain exhausted, even with a PR" "$code"
  fail=$((fail+1))
fi

# --- 21. T9 ceiling: a same-named upstream is not mistaken for a base ---
#
# `git push -u origin <branch>` is how a branch in this repository actually
# reaches the remote — including this one — and it sets @{u} to that same
# branch's own copy of itself, not to whatever it was forked from. Found
# empirically: running this exact resolver, on this exact branch, right
# after pushing it, silently reported "no changes against
# origin/fix/T9-preflight-self-fixtures" instead of the real diff, because
# @{u} was trusted without checking what it actually pointed at. This case
# reproduces that shape (a real `origin` remote is needed for
# --set-upstream-to to accept a tracking ref; fresh_repo does not configure
# one, so it is added just for this case) and asserts the resolver falls
# through to origin/main instead of trusting a same-named upstream.
d=$(fresh_repo t9selfupstream)
git -C "$d" remote add origin /nonexistent/dummy.git
git -C "$d" update-ref refs/remotes/origin/feat/x feat/x
git -C "$d" branch --set-upstream-to=origin/feat/x feat/x >/dev/null
echo "// a real change" >> "$d/src/main.ts"; git -C "$d" commit -qam x
out="$(cd "$d" && ./scripts/review-preflight.sh 2>&1)"
if printf '%s' "$out" | grep -qE 'comparing against origin/main' \
   && ! printf '%s' "$out" | grep -qE "comparing against this branch's upstream"; then
  printf 'pass  %-42s same-named upstream discarded, fell through\n' "T9 ceiling: same-named upstream is not a base"
  pass=$((pass+1))
else
  printf 'FAIL  %-42s trusted a same-named upstream as a base\n' "T9 ceiling: same-named upstream is not a base"
  printf '%s\n' "$out"
  fail=$((fail+1))
fi

# --- 22. T9: a real innerHTML in index.html is still found beside the ---
#          suite (review B1) ------------------------------------------
#
# index.html ships as the actual document — vite build's output — with real
# hrefs, real DOM ids and an inline <script>. B1 in review: DIFF_SRC read
# only `src`, so an innerHTML assignment or an href added inside index.html
# went uncaught, a real regression on the project's highest-severity check.
d=$(fresh_repo_with_attack_suite t9indexhtml)
cat > "$d/index.html" <<'EOF'
<!doctype html>
<script>node.innerHTML = payload;</script>
EOF
git -C "$d" add -A >/dev/null; git -C "$d" commit -qm "a real innerHTML in index.html, alongside the attack suite"
expect "T9: innerHTML in index.html still found beside the suite" "$d" 1 \
  "innerHTML/insertAdjacentHTML path is in the diff"

# --- 23. T9: a layout assertion in test/bundle.test.ts is caught --------
#          (review B2) --------------------------------------------------
#
# B2 in review: the gate condition `^test/[^b]` excluded every test file
# whose name BEGINS WITH "b" — bundle.test.ts, base64.test.ts — not
# test/browser/, so a layout assertion in one of those files was silently
# never scanned. T6 is literally "share bundle".
d=$(fresh_repo t9bundletest)
mkdir -p "$d/test"
printf 'expect(window.scrollY).toBe(0);\n' > "$d/test/bundle.test.ts"
git -C "$d" add -A >/dev/null; git -C "$d" commit -qm x
expect "T9: layout assertion in test/bundle.test.ts caught" "$d" 1 \
  "jsdom has no layout engine"

# --- 24. T9 ceiling: a differently-named upstream containing HEAD is ----
#         still not mistaken for a base (review S1) ---------------------
#
# The same-named-upstream fix (case 21) compares NAMES, so it does not
# cover checking this exact branch out locally under a DIFFERENT name
# (`git checkout -b review-4 origin/<branch>`) — reproduced live, on this
# exact PR branch, during review: @{u} still names the original upstream,
# under its original name, and HEAD is byte-identical to it. The condition
# that actually matters is identity, not naming: does the candidate already
# contain HEAD. Built here without a rename by pointing a differently-named
# ref at HEAD's own commit, which is the same relationship.
d=$(fresh_repo t9renamedupstream)
git -C "$d" remote add origin /nonexistent/dummy.git
echo "// a real change" >> "$d/src/main.ts"; git -C "$d" commit -qam x
git -C "$d" update-ref refs/remotes/origin/upstream-branch feat/x
git -C "$d" branch --set-upstream-to=origin/upstream-branch feat/x >/dev/null
out="$(cd "$d" && ./scripts/review-preflight.sh 2>&1)"
if printf '%s' "$out" | grep -qE 'comparing against origin/main' \
   && ! printf '%s' "$out" | grep -qE "comparing against this branch's upstream"; then
  printf 'pass  %-42s renamed-upstream identity discarded, fell through\n' "T9 ceiling: differently-named upstream is not a base"
  pass=$((pass+1))
else
  printf 'FAIL  %-42s trusted a differently-named upstream that already contains HEAD\n' "T9 ceiling: differently-named upstream is not a base"
  printf '%s\n' "$out"
  fail=$((fail+1))
fi

printf '\n%s passed, %s failed\n' "$pass" "$fail"
rm -rf "$WORK"
[ "$fail" -eq 0 ]
