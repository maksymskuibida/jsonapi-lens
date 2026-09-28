/**
 * Which toast an opened share link gets (QA4, 2026-09-28).
 *
 * This is a function of two facts and nothing else, kept out of `main.ts`
 * (which cannot be imported by a test — it wires the whole page at load) so
 * the choice can be unit-tested:
 *
 *  - `keyExposed` — the link's `#` was rewritten to `%23` in transit, so its
 *    key reached the server in the path (`router.ts#parseRoute`, DECISIONS D7).
 *  - `stored` — the document was written to this browser's storage. `load()`
 *    reports that; with IndexedDB blocked it is `false`.
 *
 * Before QA4 both toasts said "It is now stored in this browser"
 * unconditionally, so with storage blocked the share toast *replaced* the
 * general "could not be stored" one (`toast.notStored`) with its opposite.
 * The two not-stored rows exist so that replacing it is safe: each says the
 * document was not stored and what that costs, and the exposed-key variant
 * keeps the whole key warning — losing the warning because storage also
 * failed would be a worse bug than the one this fixes.
 *
 * The tone and duration of the exposed-key variants are fixed here
 * (`EXPOSED_KEY_TOAST_MS`, below): how long a ~250-character notice needs is a
 * display concern, and every place that shows one wants the same answer.
 */

import type { Messages } from "./i18n/en.js";

export interface ShareOpenedToast {
  text: string;
  tone: "info" | "error";
  /** Absent means the toast's default lifetime. */
  durationMs?: number;
}

/**
 * How long the "this link's key was exposed" toast stays up. Review round 1
 * (S2, PR #27): the ordinary toast's default lifetime (`DEFAULT_TOAST_MS` in
 * `ui.ts`) was written for a one-line confirmation, not a ~250-character
 * security notice — most readers would not finish it in time.
 */
export const EXPOSED_KEY_TOAST_MS = 9000;

export function shareOpenedToast(
  m: Messages,
  facts: { keyExposed: boolean; stored: boolean },
): ShareOpenedToast {
  const { keyExposed, stored } = facts;
  if (keyExposed) {
    return {
      text: stored ? m.share.openedKeyExposed : m.share.openedKeyExposedNotStored,
      tone: "error",
      durationMs: EXPOSED_KEY_TOAST_MS,
    };
  }
  // A plain not-stored open is not a security event, but it is the one the
  // person cannot recover from by reloading, so it is an error-toned notice.
  return stored
    ? { text: m.share.opened, tone: "info" }
    : { text: m.share.openedNotStored, tone: "error" };
}

/**
 * The exposed-key warning with no "opened" and no "stored" in it (QA4 review,
 * S1 and S2). For the two places that must warn about a `%23` link but cannot
 * truthfully say a document was opened and stored: a bundle link, whose
 * import view is still open with nothing saved, and a link whose payload
 * decrypted but did not parse, where the error card is on screen. The key was
 * correct in both — the link is exposed just the same.
 */
export function keyExposedOnlyToast(m: Messages): ShareOpenedToast {
  return { text: m.share.keyExposedOnly, tone: "error", durationMs: EXPOSED_KEY_TOAST_MS };
}
