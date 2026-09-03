/**
 * Everything `share`/`read` refuse before doing any crypto work or touching
 * the network — cheap checks first, so a typo in `origin` or an unusable
 * secret fails in microseconds rather than after a 12 MB gzip or a real
 * `fetch`.
 *
 * None of this duplicates `src/crypto.ts`'s crypto. It duplicates one of its
 * *policy* decisions on purpose, split in two, because `share` and `read` are
 * answering different questions about a secret:
 *
 *   - `share` **mints** a link. It gets to be picky about what it accepts,
 *     because it controls what comes out the other end — `assertShareSecret`
 *     insists on exactly 64 lowercase hex, the output of
 *     `openssl rand -hex 32`, which is a real strengthening over what
 *     `crypto.ts` would otherwise allow.
 *   - `read` **opens** a link somebody else already made — most often the
 *     browser, whose `generateSecret()` (`src/crypto.ts`) produces 10
 *     *mixed-case* base64url characters, nothing like 64 lowercase hex. A
 *     `read` that enforced `share`'s minting policy would refuse every link
 *     the product has ever produced. So `assertReadSecret` accepts anything
 *     the wire format itself can produce — `crypto.ts`'s own
 *     `[MIN_SECRET_CHARS, MAX_SECRET_CHARS]` of `[A-Za-z0-9_-]`, the same
 *     range `SHARE_PATTERN` in `router.ts` parses out of a URL — and refuses,
 *     never normalises, anything outside it.
 *
 * A secret `assertShareSecret` accepts always passes `assertReadSecret` too,
 * by construction (64 lowercase hex is a subset of `[A-Za-z0-9_-]{8,64}`),
 * so `share` immediately followed by `read` on the same secret can never
 * disagree with itself.
 */

import { MAX_BUNDLE_BYTES, MAX_SECRET_CHARS, MIN_SECRET_CHARS } from "../src/crypto.js";
import { formatBytes } from "../src/format.js";

/* ------------------------------------------------------------- secret ---- */

const SHARE_SECRET_HEX_LENGTH = 64;
const SHARE_SECRET_PATTERN = /^[0-9a-f]{64}$/;
export const GENERATE_SECRET_COMMAND = "openssl rand -hex 32";

/**
 * What `share` will mint under: 64 lowercase hex characters, exactly — the
 * output shape of `openssl rand -hex 32`. Uppercase is refused rather than
 * normalised: two call sites silently agreeing to lowercase a caller's
 * uppercase input is one more place to drift out of step, and a caller that
 * pastes a secret with different casing than it generated it with almost
 * certainly mistyped or mis-copied it — accepting it either way hides that
 * mistake instead of catching it. This message's advice ("generate one with
 * openssl") is specific to minting; `assertReadSecret` below never gives it,
 * because a `read` caller does not get to choose the secret.
 */
export function assertShareSecret(secret: string): void {
  if (SHARE_SECRET_PATTERN.test(secret)) return;
  throw new Error(
    `The secret must be exactly ${SHARE_SECRET_HEX_LENGTH} lowercase hex characters (0-9, a-f) — ` +
      `this one has ${secret.length}. Generate one with: ${GENERATE_SECRET_COMMAND}`,
  );
}

const READ_SECRET_PATTERN = new RegExp(`^[A-Za-z0-9_-]{${MIN_SECRET_CHARS},${MAX_SECRET_CHARS}}$`);

/**
 * What `read` will open: anything the envelope format itself accepts —
 * `crypto.ts`'s own secret length range, case-sensitive, never normalised
 * (case matters to the key derivation; silently folding it would open the
 * wrong document or, more likely, nothing at all). Covers a real
 * `generateSecret()` output, a hand-typed `/d/<id>#<secret>` secret, and a
 * `share`-minted 64-hex secret all at once — the invariant that actually
 * holds and is worth stating: everything `assertShareSecret` accepts,
 * `assertReadSecret` accepts too.
 *
 * The reverse is *not* true, on purpose: `crypto.ts` itself checks only
 * length (`assertSecretLength`), so `seal`/`open` would happily accept a
 * secret containing a space or `!`, or actual Unicode — this function
 * refuses all of those, stricter than `crypto.ts`. That is correct rather
 * than a gap: `SHARE_PATTERN` in `router.ts` could never have parsed such a
 * secret out of a URL in the first place, so no real link can carry one, and
 * refusing it here is refusing something that was never a link to begin
 * with — not a browser-minted secret this module might otherwise reject.
 */
export function assertReadSecret(secret: string): void {
  if (READ_SECRET_PATTERN.test(secret)) return;
  const badCharset = /[^A-Za-z0-9_-]/.test(secret)
    ? ` and uses a character outside A-Z, a-z, 0-9, "-" or "_"`
    : "";
  throw new Error(
    `That secret looks malformed or truncated: a share secret is ${MIN_SECRET_CHARS} to ` +
      `${MAX_SECRET_CHARS} characters of A-Z, a-z, 0-9, "-" or "_" — this one has ${secret.length} ` +
      `character${secret.length === 1 ? "" : "s"}${badCharset}. Check that the link was copied in full.`,
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
 * An origin, and nothing more. A path, a query, or a userinfo is refused
 * rather than stripped or normalised — the whole point of this being a
 * refusal is that `https://host/some/path` and `https://host` are different
 * places, and silently rewriting one to the other, having told nobody, would
 * be exactly the mistake this function exists to catch.
 *
 * Userinfo is the sharpest version of that mistake: `new URL(origin).origin`
 * silently discards it, so `https://jsonapi.mstool.dev@evil.example.com` reads
 * — to a human, or to a model that only skimmed the string — as
 * `jsonapi.mstool.dev`, but `.origin` on that value is `https://evil.example.com`.
 * This is the one function in the whole server that decides which host a
 * document gets uploaded to, so it is the one place a plausible-looking
 * wrong host actually matters.
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
  if (parsed.username !== "" || parsed.password !== "") {
    throw new Error(
      `"${origin}" carries a "user@" (or "user:pass@") before the host. That part is not the host — ` +
        `this would actually upload to "${parsed.origin}", not what the rest of the string suggests. ` +
        `Pass an origin only, e.g. "${DEFAULT_ORIGIN}".`,
    );
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
