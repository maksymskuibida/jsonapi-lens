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
import type { Shape, ShapeEvidence } from "./types.js";

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
  shape: Shape,
  evidence: ShapeEvidence,
): void {
  const copy = t().shape;
  // `Shape`, not `string`: `shape.name` is an exhaustive switch with no
  // `default`, so a ninth member becomes a type error — the guard the repo
  // wants. A cast here would keep that guard but let this function take any
  // string at runtime, fall off the end of the switch, and render "This looks
  // like undefined, not JSON:API."
  //
  // Both lines go through `setRichText`, even though no headline carries a
  // marker today: the headline and the hint drifting apart is exactly what
  // this PR's second round was about, and they are one function apart.
  setRichText(headlineEl, copy.offerHeadline(copy.name(shape)));
  setRichText(hintEl, copy.evidence(evidence));
}
