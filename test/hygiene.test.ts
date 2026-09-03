/**
 * Test data hygiene.
 *
 * This repository is public — the site, the code, and the test data. A fixture
 * carrying a real address or a real hostname cannot be un-published by a later
 * commit, so this is a gate rather than a note in a document.
 *
 * It checks structure, deliberately, and **not** a list of names. A denylist of
 * organisations, products or internal hostnames would have to contain those
 * names to match them — committing the very strings it exists to keep out. So
 * the rules here are shape-based, and the judgement call ("is this traceable to
 * a real organisation?") stays with the reviewer, where it belongs.
 *
 * The synthetic conventions these enforce are written up in
 * `test/fixtures/README.md`.
 */

import { describe, expect, it } from "vitest";

/*
 * Files are collected with Vite's own `import.meta.glob` rather than `node:fs`.
 * `tsconfig.json` sets `types: ["vite/client"]` deliberately narrowly, so a
 * `node:fs` import fails the app typecheck, and adding `@types/node` to widen
 * it for one test is a poor trade. The glob is typed by `vite/client`, is
 * resolved at transform time, and yields root-relative paths — which is also
 * what makes the "did it scan anything?" assertion below meaningful.
 *
 * Extensions are listed rather than globbed as `*` because `?raw` on a `.woff2`
 * or a `.png` is meaningless, and one binary file would take the whole suite
 * out. `.har` is in the list because T3 imports that format, so a real HAR is
 * exactly the kind of thing that would otherwise get committed as a fixture.
 *
 * Two ceilings, stated rather than discovered later:
 *
 *  - **Dotfiles are not reached.** `import.meta.glob` skips them, so a record
 *    saved as `test/.scratch.json` is invisible here. Nothing should live
 *    there, and the preflight's git-ignored-file check covers the overlapping
 *    case, but this is not airtight.
 *  - **An extension not in the list is not reached.** Adding a fixture in a new
 *    format means adding its extension here, in the same change.
 */
const FILES: Record<string, string> = {
  ...import.meta.glob(
    "/test/**/*.{ts,js,mjs,cjs,json,jsonc,md,txt,html,css,csv,tsv,har,yml,yaml,log,xml}",
    { query: "?raw", import: "default", eager: true },
  ),
  ...import.meta.glob("/docs/**/*.{md,json,jsonc,txt,yml,yaml,csv,har,log}", {
    query: "?raw",
    import: "default",
    eager: true,
  }),
  // `src/samples/*.json` ships as sample payloads and is user-visible test
  // data in everything but directory name, so it is held to the same rule.
  ...import.meta.glob("/src/samples/**/*.json", {
    query: "?raw",
    import: "default",
    eager: true,
  }),
};

/**
 * This file is exempt from its own scan: the self-tests below have to construct
 * violating strings, and a file that must contain a counter-example cannot also
 * be held to the rule. Every other file the glob reaches is checked.
 */
const EXEMPT = new Set(["/test/hygiene.test.ts"]);

function scannedFiles(): { path: string; text: string }[] {
  return Object.entries(FILES)
    .filter(([path]) => !EXEMPT.has(path))
    .map(([path, text]) => ({ path: path.replace(/^\//, ""), text }));
}

/* ------------------------------------------------------------------ rules --- */

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

/** Reserved for documentation and examples — RFC 2606, RFC 6761. */
const ALLOWED_EMAIL_DOMAIN = /@(?:[A-Za-z0-9-]+\.)*(?:example\.(?:com|org|net)|test|invalid|localhost)$/;

const IPV4 = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d{1,2})\.){3}(?:25[0-5]|2[0-4]\d|1?\d{1,2})\b/g;

/**
 * A four-part version number is not an IP address, and browser user-agent
 * strings are full of them — `Chrome/151.0.0.0` matches `IPV4` exactly. The
 * distinguishing feature is the `Name/` prefix: a letter immediately before the
 * slash. `http://10.79.20.9/` is *not* excluded by this, because the character
 * before that slash is another slash — which is the whole point, since an IP in
 * a URL is exactly what must still be caught.
 */
function isVersionToken(text: string, index: number): boolean {
  return /[A-Za-z]\/$/.test(text.slice(Math.max(0, index - 2), index));
}

/**
 * RFC 5737 documentation ranges, plus loopback and the unspecified address —
 * `127.0.0.1` and `0.0.0.0` name a local machine, never somebody's network.
 */
function ipAllowed(ip: string): boolean {
  return (
    ip.startsWith("192.0.2.") ||
    ip.startsWith("198.51.100.") ||
    ip.startsWith("203.0.113.") ||
    ip === "127.0.0.1" ||
    ip === "0.0.0.0" ||
    ip === "255.255.255.255"
  );
}

/** Everything in a file that breaks a rule, with enough context to find it. */
function violations(text: string): string[] {
  const found: string[] = [];

  for (const match of text.match(EMAIL) ?? []) {
    // A version string like `1.24.67+283e66b` is not an address, and neither is
    // a `name@version` package spec.
    if (!ALLOWED_EMAIL_DOMAIN.test(match)) found.push(`address ${match}`);
  }

  for (const match of text.matchAll(IPV4)) {
    const ip = match[0];
    const at = match.index ?? 0;
    if (isVersionToken(text, at)) continue;
    if (!ipAllowed(ip)) found.push(`IP literal ${ip}`);
  }

  return [...new Set(found)];
}

/* ------------------------------------------------------------------ tests --- */

describe("test data hygiene", () => {
  it("scans a non-trivial number of files, so a passing run means something", () => {
    // A walk that silently matches nothing is the classic way a hygiene gate
    // becomes decorative. Assert it found the tree it thinks it is scanning.
    const files = scannedFiles();
    expect(files.length).toBeGreaterThan(15);
    expect(files.map((f) => f.path)).toContain("test/fixtures/transport-log-started.json");
    expect(files.map((f) => f.path)).toContain("docs/task-specs/T1.md");
  });

  it("contains no email address outside the reserved example domains", () => {
    const offenders = scannedFiles()
      .map((f) => ({ path: f.path, found: violations(f.text).filter((v) => v.startsWith("address")) }))
      .filter((f) => f.found.length > 0);

    expect(
      offenders.map((o) => `${o.path}: ${o.found.join(", ")}`),
      "use an @example.com address — this repository is public",
    ).toEqual([]);
  });

  it("contains no IP literal outside the documentation ranges", () => {
    const offenders = scannedFiles()
      .map((f) => ({ path: f.path, found: violations(f.text).filter((v) => v.startsWith("IP")) }))
      .filter((f) => f.found.length > 0);

    expect(
      offenders.map((o) => `${o.path}: ${o.found.join(", ")}`),
      "use an RFC 5737 documentation range: 192.0.2.x, 198.51.100.x, 203.0.113.x",
    ).toEqual([]);
  });

  /*
   * The gate has to be able to fail, and for the right reason. Both cases below
   * plant the defect the rule was written for and assert the rule catches
   * *that* one — a case that only checked "some violation was found" would pass
   * while the other rule did the work.
   */
  describe("the rules can actually fail", () => {
    it("catches a real-looking address, and does not confuse it with a version string", () => {
      const planted = ["contact ", "someone", "@", "corp-mail", ".", "net"].join("");
      expect(violations(planted)).toEqual([`address ${["someone", "@", "corp-mail", ".", "net"].join("")}`]);
      expect(violations("agent@example.com")).toEqual([]);
      expect(violations("api_version: 1.24.67+283e66b")).toEqual([]);
      expect(violations("@fontsource-variable/martian-mono")).toEqual([]);
    });

    it("catches a private-range IP, and allows the documentation ranges", () => {
      expect(violations(["10", ".79", ".20", ".9"].join(""))).toEqual([
        `IP literal ${["10", ".79", ".20", ".9"].join("")}`,
      ]);
      expect(violations("customer_ip: 192.0.2.24")).toEqual([]);
      expect(violations("http://127.0.0.1:5178")).toEqual([]);
      // A version and a timestamp are full of dot-separated digits.
      expect(violations("v1.24.67 at 2026-09-02 11:39:58.835")).toEqual([]);
      // A four-part version in a user agent is not an address...
      expect(violations("AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36")).toEqual([]);
      // ...but the version-token exemption must not swallow an IP in a URL,
      // which is the obvious way to hide one from a check like this.
      const inUrl = ["10", ".79", ".20", ".9"].join("");
      expect(violations(`http://${inUrl}/health`)).toEqual([`IP literal ${inUrl}`]);
    });
  });
});
