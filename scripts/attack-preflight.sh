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

printf '\n%s passed, %s failed\n' "$pass" "$fail"
rm -rf "$WORK"
[ "$fail" -eq 0 ]
