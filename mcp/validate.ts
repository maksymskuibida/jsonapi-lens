/**
 * Everything `share`/`read` refuse before doing any crypto work or touching
 * the network — cheap checks first, so a typo in `origin` or an unusable
 * secret fails in microseconds rather than after a 12 MB gzip or a real
 * `fetch`.
 *
 * None of this duplicates `src/crypto.ts`. `assertValidSecret` enforces a
 * *narrower* rule than `crypto.ts`'s own `[MIN_SECRET_CHARS, MAX_SECRET_CHARS]`
 * range (8-64 of `[A-Za-z0-9_-]`) — this module's job is to hold the MCP
 * caller to the one shape this task actually offers (64 lowercase hex, from
 * `openssl rand -hex 32`), not to re-derive what `crypto.ts` already accepts.
 * A secret that passes here always passes there too, by construction (64 hex
 * characters is a subset of `[A-Za-z0-9_-]{8,64}`).
 */

import { MAX_BUNDLE_BYTES } from "../src/crypto.js";
import { formatBytes } from "../src/format.js";

/* ------------------------------------------------------------- secret ---- */

const SECRET_HEX_LENGTH = 64;
const SECRET_PATTERN = /^[0-9a-f]{64}$/;
export const GENERATE_SECRET_COMMAND = "openssl rand -hex 32";

/**
 * 64 lowercase hex characters, exactly — the output shape of
 * `openssl rand -hex 32`. Uppercase is refused rather than normalised: two
 * call sites (`share` and `read`) silently agreeing to lowercase a caller's
 * uppercase input is one more place for the two to drift out of step, and a
 * caller that pastes a secret with different casing than it was generated
 * with almost certainly mistyped or mis-copied it — accepting it either way
 * hides that mistake instead of catching it.
 */
export function assertValidSecret(secret: string): void {
  if (SECRET_PATTERN.test(secret)) return;
  throw new Error(
    `The secret must be exactly ${SECRET_HEX_LENGTH} lowercase hex characters (0-9, a-f) — ` +
      `this one has ${secret.length}. Generate one with: ${GENERATE_SECRET_COMMAND}`,
  );
}

/* ----------------------------------------------------------- lifetime ---- */

/** Mirrors the `LIFETIMES` table in `src/worker.ts` — the Worker's table is
 * the authority on what a lifetime string means, so this module only needs
 * the accepted *keys*, not their durations. Duplicated rather than imported
 * because `worker.ts` runs on workerd and is typechecked against a different
 * global environment (`tsconfig.worker.json`); `src/share.ts` duplicates the
 * same list for the same reason. If the Worker's table ever changes, this
 * must change with it. */
export const LIFETIME_KEYS = ["15m", "6h", "1d", "1w", "1m", "forever"] as const;
export type LifetimeKey = (typeof LIFETIME_KEYS)[number];
export const DEFAULT_LIFETIME: LifetimeKey = "1d";

export function assertValidLifetime(lifetime: string): asserts lifetime is LifetimeKey {
  if ((LIFETIME_KEYS as readonly string[]).includes(lifetime)) return;
  throw new Error(`Unknown lifetime "${lifetime}". Accepted values: ${LIFETIME_KEYS.join(", ")}.`);
}

/* ------------------------------------------------------------- origin ---- */

export const DEFAULT_ORIGIN = "https://jsonapi.mstool.dev";

/**
 * An origin, and nothing more. A path or query is refused rather than
 * stripped — silently normalising `https://host/some/path` down to
 * `https://host` would upload wherever the caller typed, having told them
 * their mistake, which is worse than refusing outright.
 */
export function assertValidOrigin(origin: string): string {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error(`"${origin}" is not a valid URL. Pass an origin only, e.g. "${DEFAULT_ORIGIN}".`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`"${origin}" must use http or https, not "${parsed.protocol.replace(/:$/, "")}".`);
  }
  if (parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "") {
    throw new Error(
      `"${origin}" must be an origin only, with no path, query or fragment. Did you mean "${parsed.origin}"?`,
    );
  }
  return parsed.origin;
}

/* ----------------------------------------------------------- documents --- */

export interface DocumentInput {
  label: string;
  text: string;
  exchange?: Record<string, unknown>;
}

/** Refused before any crypto work — discovering an empty selection after
 * paying for a seal (or an empty document after an upload) is a worse
 * failure than refusing to start. Mirrors `sealBundle`'s own reasoning in
 * `src/crypto.ts`, applied uniformly whether this becomes a single share or
 * a bundle. */
export function assertShareableDocuments(documents: readonly DocumentInput[]): void {
  if (documents.length === 0) {
    throw new Error("Pass at least one document in `documents` — an empty selection is not shareable.");
  }
  for (const doc of documents) {
    if (doc.text.length === 0) {
      throw new Error(`Document "${doc.label}" has empty text — an empty document cannot be shared.`);
    }
  }
}

/**
 * The single-document path calls `seal`, not `sealBundle` — same rule as the
 * browser UI, so the two produce the same bytes — and `seal` has no size
 * check of its own (only `sealBundle` does, because a bundle needs to name
 * *which* document to drop). For exactly one document there is only one
 * candidate to name, so this reimplements the cap check rather than routing
 * a single document through `sealBundle` just to borrow its ranking, which
 * would mean the one document actually uploaded (`seal`'s output) and the
 * one whose size produced the error (`sealBundle`'s, sealed a second time
 * with different framing bytes) were never quite the same blob.
 */
export function assertSingleDocumentWithinCap(blob: Uint8Array, label: string): void {
  if (blob.byteLength <= MAX_BUNDLE_BYTES) return;
  throw new Error(
    `"${label}" is too large to share: encrypted, it is ${formatBytes(blob.byteLength - MAX_BUNDLE_BYTES)} ` +
      `over the ${formatBytes(MAX_BUNDLE_BYTES)} limit.`,
  );
}
