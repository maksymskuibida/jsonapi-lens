// @vitest-environment node
/**
 * No tracked file may also be ignored.
 *
 * This exists because the same mistake happened three times while the
 * delivery-loop scaffolding was being removed. The `.gitignore` entry is
 * written once, and every task that merges afterwards adds files it covers —
 * `docs/evidence/T6.md`, `docs/qa-notes/T2a.md`, `docs/test-plans/T10.md` and
 * others each arrived after the ignore rule that names their directory.
 *
 * The result is the one state a `.gitignore` change must not leave behind: the
 * file is still in the repository and still shipped, while every local edit to
 * it is invisible to `git status`. Nothing complains, which is exactly why it
 * kept recurring.
 *
 * `git ls-files --cached --ignored --exclude-standard` is git's own answer to
 * the question, so this asserts on that rather than re-implementing
 * `.gitignore` matching — which is the part that would drift.
 */
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("the repository and .gitignore agree", () => {
  it("has no file that is both tracked and ignored", () => {
    const out = execFileSync(
      "git",
      ["ls-files", "--cached", "--ignored", "--exclude-standard"],
      { encoding: "utf8" },
    ).trim();

    const offenders = out === "" ? [] : out.split("\n");
    expect(
      offenders,
      offenders.length === 0
        ? ""
        : `These files are tracked but match .gitignore. Either 'git rm --cached' them, ` +
          `or narrow the rule that catches them:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });
});
