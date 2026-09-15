/**
 * The error card and the shape offer, as functions a test can call.
 *
 * These were two lines each inside `main.ts`, which no test imports — it wires
 * itself to the real document at module scope. So the sinks that actually put
 * these messages on screen were unreachable from the suite, and both could be
 * reverted to `textContent` with everything still green. That is how the
 * defect they exist to fix shipped in the first place.
 *
 * It matters more now than it did before `RichPart`. `DocumentError.hint` is
 * `string | RichPart[]`, so a sink that mishandles the union renders **nothing
 * at all** for exactly the two errors this path is about — `invalidJson` and
 * `notJsonApi` both return parts — leaving a headline with no hint under it.
 * The union makes the contract load-bearing in a way the type system cannot
 * enforce, which is precisely when it needs a test.
 */
import { setRichText } from "./dom.js";
import type { DocumentError } from "./parse.js";
import { t } from "./i18n/index.js";
import type { ShapeEvidence } from "./types.js";

/** Fill the error card. Returns nothing; the elements are the output. */
export function renderErrorCard(
  headlineEl: HTMLElement,
  hintEl: HTMLElement,
  whereEl: HTMLElement,
  error: DocumentError,
): void {
  setRichText(headlineEl, error.headline);
  setRichText(hintEl, error.hint);

  if (error.line !== undefined) {
    whereEl.textContent = t().paste.errorWhere(error.line);
    whereEl.hidden = false;
  } else {
    whereEl.hidden = true;
  }
}

/** Fill the shape-detection offer's headline and evidence line. */
export function renderShapeOffer(
  headlineEl: HTMLElement,
  hintEl: HTMLElement,
  shape: string,
  evidence: ShapeEvidence,
): void {
  const copy = t().shape;
  headlineEl.textContent = copy.offerHeadline(copy.name(shape as never));
  setRichText(hintEl, copy.evidence(evidence));
}
