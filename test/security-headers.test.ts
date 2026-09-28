import { describe, expect, it } from "vitest";

// `?raw`, the same loader `seo.test.ts` reads the shipped files through —
// see that file's own comment on why (`node:fs` would drag Node's types
// into a browser-only tsconfig).
import headersFile from "../public/_headers?raw";

import { SECURITY_HEADERS } from "../src/security-headers.js";

/**
 * `src/security-headers.ts` explains why this has to be a second copy of
 * `public/_headers`' values rather than an import of that file: `worker.ts`
 * is built for `workerd`, not by Vite, and cannot use `?raw`. This test is
 * the thing that stands in for the import — it parses `_headers`' own `/*`
 * block (the rule that applies to every path) and asserts every header
 * `SECURITY_HEADERS` carries agrees with it byte for byte, so an edit to one
 * that forgets the other fails here instead of drifting silently into a
 * `405` response with a stale CSP.
 */
/**
 * Review round 1 (N3): the first draft of this parser stopped at the first
 * blank line, but a blank line does not end a Cloudflare `_headers` rule —
 * only the next pattern line (unindented, not a comment) does. Blank lines
 * and comment lines, indented or not, are just formatting and are skipped;
 * they were never terminators. `public/_headers`' own `/*` block happens to
 * hit a blank line right after its four headers today, so the old parser's
 * bug was invisible against the current file — it would only have shown up
 * the day someone added a fifth header below a blank explanatory line, which
 * is exactly the shape this file's own header comment uses elsewhere
 * (compare the blank-line-separated paragraphs above the CSP explanation).
 * The two tests below pin the corrected behaviour down with synthetic input,
 * independent of whatever `public/_headers` happens to contain right now.
 */
function parseGlobalHeaderBlock(text: string): Map<string, string> {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.trim() === "/*");
  if (start === -1) throw new Error("public/_headers has no `/*` (all-paths) rule block");

  const headers = new Map<string, string>();
  for (const line of lines.slice(start + 1)) {
    const trimmed = line.trim();
    if (trimmed === "") continue; // a blank line does not end a _headers rule
    if (trimmed.startsWith("#")) continue; // nor does a comment, indented or not
    if (!/^\s/.test(line)) break; // the next un-indented, non-comment line starts the next rule
    const match = /^\s+([^:]+):\s*(.+)$/.exec(line);
    if (match) headers.set(match[1]!.trim().toLowerCase(), match[2]!.trim());
  }
  return headers;
}

describe("SECURITY_HEADERS matches public/_headers", () => {
  const fromHeadersFile = parseGlobalHeaderBlock(headersFile);

  it("public/_headers' all-paths block is non-empty, so this test cannot pass vacuously", () => {
    expect(fromHeadersFile.size).toBeGreaterThan(0);
  });

  it("carries the exact same name/value pairs, byte for byte", () => {
    for (const [name, value] of SECURITY_HEADERS) {
      expect(fromHeadersFile.get(name.toLowerCase()), `_headers is missing "${name}"`).toBe(value);
    }
  });

  it("does not fall behind if _headers grows a security header this list does not know about", () => {
    // `Cache-Control` etc. live in path-specific blocks below the `/*` block
    // and are intentionally not part of SECURITY_HEADERS, so only compare
    // the names this module actually claims to mirror.
    expect(fromHeadersFile.size).toBe(SECURITY_HEADERS.length);
  });
});

describe("parseGlobalHeaderBlock — N3 regression guards, on synthetic input", () => {
  it("does not stop at the first blank line — a blank line does not end a _headers rule", () => {
    const synthetic = [
      "/*",
      "  Referrer-Policy: strict-origin-when-cross-origin",
      "",
      "# a header explained in its own paragraph, separated by a blank line",
      "  X-Content-Type-Options: nosniff",
      "",
      "/assets/*",
      "  Cache-Control: public, max-age=31536000, immutable",
    ].join("\n");
    expect(parseGlobalHeaderBlock(synthetic)).toEqual(
      new Map([
        ["referrer-policy", "strict-origin-when-cross-origin"],
        ["x-content-type-options", "nosniff"],
      ]),
    );
  });

  it("stops at the next rule's pattern line — not one line early (a comment) or late (past it)", () => {
    const synthetic = ["/*", "  X-Frame-Options: DENY", "/assets/*", "  Cache-Control: public"].join(
      "\n",
    );
    expect(parseGlobalHeaderBlock(synthetic)).toEqual(new Map([["x-frame-options", "DENY"]]));
  });

  it("skips a comment even when it is indented, and never mistakes it for a header", () => {
    const synthetic = [
      "/*",
      "  # not a header, just an indented note",
      "  X-Content-Type-Options: nosniff",
    ].join("\n");
    const parsed = parseGlobalHeaderBlock(synthetic);
    expect(parsed.size).toBe(1);
    expect(parsed.get("x-content-type-options")).toBe("nosniff");
  });
});
