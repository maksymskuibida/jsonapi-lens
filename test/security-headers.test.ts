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
function parseGlobalHeaderBlock(text: string): Map<string, string> {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.trim() === "/*");
  if (start === -1) throw new Error("public/_headers has no `/*` (all-paths) rule block");

  const headers = new Map<string, string>();
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "") break; // the block ends at the first blank line
    const match = /^\s+([^:]+):\s*(.+)$/.exec(line);
    if (!match) continue;
    headers.set(match[1]!.trim().toLowerCase(), match[2]!.trim());
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
