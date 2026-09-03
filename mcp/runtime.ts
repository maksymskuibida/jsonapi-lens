/**
 * Whether this process can run the share crypto at all.
 *
 * `src/crypto.ts`'s `seal`/`open` need `crypto.subtle` (WebCrypto) and
 * `CompressionStream`/`DecompressionStream`. Both have been in Node since
 * v17-18, and CI runs Node 22 — but this server is a stdio process a user (or
 * their agent host) launches directly, on whatever Node happens to be on
 * their `PATH`. Without this check, a too-old Node fails deep inside `seal`
 * with something like `TypeError: crypto.subtle is undefined`, which names
 * neither the cause nor the fix. This check runs first and names both.
 *
 * A pure function of the three facts that matter, rather than reading
 * `process.version`/`globalThis` directly, so a test can assert every branch
 * — including "too old" — without needing an actually-old Node to run it on.
 */

export const MIN_NODE_MAJOR = 22;

export interface RuntimeFacts {
  /** `process.version`, e.g. `"v22.15.0"`. */
  readonly nodeVersion: string;
  readonly hasSubtleCrypto: boolean;
  readonly hasCompressionStream: boolean;
}

/** The Node major version `process.version` names, or `null` if unparseable. */
function majorVersion(nodeVersion: string): number | null {
  const match = /^v?(\d+)\./.exec(nodeVersion);
  if (!match) return null;
  const major = Number(match[1]);
  return Number.isFinite(major) ? major : null;
}

/**
 * A readable startup error, or `null` if this runtime can seal and open
 * share links.
 */
export function runtimeProblem(facts: RuntimeFacts): string | null {
  const major = majorVersion(facts.nodeVersion);
  const tooOld = major === null || major < MIN_NODE_MAJOR;

  if (tooOld || !facts.hasSubtleCrypto || !facts.hasCompressionStream) {
    const missing: string[] = [];
    if (!facts.hasSubtleCrypto) missing.push("WebCrypto (crypto.subtle)");
    if (!facts.hasCompressionStream) missing.push("CompressionStream");
    const missingNote = missing.length > 0 ? ` Missing: ${missing.join(", ")}.` : "";
    return (
      `jsonapi-lens MCP server needs Node ${MIN_NODE_MAJOR} or newer to encrypt and decrypt ` +
      `share links (found ${facts.nodeVersion}).${missingNote} Upgrade Node and try again.`
    );
  }

  return null;
}
