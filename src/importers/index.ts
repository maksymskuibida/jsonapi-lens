/**
 * The importer registry — every `Importer` in this directory, and the
 * "run every `detect`, take the highest confidence" policy
 * `docs/task-specs/T3.md`'s Behaviour section describes: "Pasting runs every
 * `detect` and takes the highest confidence... Two importers both matching:
 * higher confidence wins; the offer names which and lets the other be
 * chosen." `detectAll` returns every match, highest confidence first, so a
 * paste view can do exactly that — default to the top one, and still offer
 * the rest.
 *
 * This module renders nothing — see `./types.ts`'s header. Deciding *what
 * the user sees* when more than one importer matches, or when an importer
 * yields more than one exchange, is T2b's half of this feature.
 */

import { curlImporter } from "./curl.js";
import { rawHttpRequestImporter } from "./raw-http-request.js";
import { rawHttpResponseImporter } from "./raw-http-response.js";
import { urlImporter } from "./url.js";
import { harImporter } from "./har.js";
import { transportLogImporter } from "./transport-log.js";
import type { Detection, Importer } from "./types.js";

export type { Detection, ImportResult, Importer } from "./types.js";
export { ImportError } from "./types.js";
export { curlImporter, CURL_ID } from "./curl.js";
export { rawHttpRequestImporter, RAW_HTTP_REQUEST_ID } from "./raw-http-request.js";
export { rawHttpResponseImporter, RAW_HTTP_RESPONSE_ID } from "./raw-http-response.js";
export { urlImporter, URL_ID } from "./url.js";
export { harImporter, HAR_ID } from "./har.js";
export { transportLogImporter, TRANSPORT_LOG_ID } from "./transport-log.js";

/**
 * Registration order, not preference order — `detectAll` sorts by
 * confidence, so where a tied pair falls back to array order is the only
 * thing this order actually decides (see that function's own note).
 */
export const IMPORTERS: readonly Importer[] = [
  curlImporter,
  rawHttpRequestImporter,
  rawHttpResponseImporter,
  urlImporter,
  harImporter,
  transportLogImporter,
];

export interface DetectionMatch {
  importer: Importer;
  detection: Detection;
}

/**
 * Every importer that recognises `text`, highest confidence first. Stable on
 * a tie: `Array.prototype.sort` is guaranteed stable since ES2019, so two
 * importers reporting equal confidence keep `IMPORTERS`' own registration
 * order relative to each other, rather than an unspecified one that could
 * differ between runs of the identical input.
 *
 * Never throws — every `detect` in `IMPORTERS` is contractually total (see
 * `./types.ts`'s header and the corpus test in `test/importers/detect-safety.test.ts`),
 * so nothing here needs its own `try`/`catch` to uphold that.
 */
export function detectAll(text: string): DetectionMatch[] {
  const matches: DetectionMatch[] = [];
  for (const importer of IMPORTERS) {
    const detection = importer.detect(text);
    if (detection !== null) matches.push({ importer, detection });
  }
  return matches.sort((a, b) => b.detection.confidence - a.detection.confidence);
}

/** The single best match, or `null` when nothing recognised `text` at all — the "fall through to T1's plain-JSON reading" case from the spec's edge-case table. */
export function detectBest(text: string): DetectionMatch | null {
  return detectAll(text)[0] ?? null;
}
