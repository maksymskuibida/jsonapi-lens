/**
 * The importer contract — `docs/task-specs/T3.md`'s Interface section, verbatim.
 *
 * Six modules in this directory (`curl.ts`, `raw-http-request.ts`,
 * `raw-http-response.ts`, `url.ts`, `har.ts`, `transport-log.ts`) each export
 * one `Importer`. Every one of them is **text in, `Partial<Exchange>` out** —
 * there is exactly one write path into an `Exchange`
 * (`exchange.ts#mergeExchange`), and an importer's whole job stops at
 * producing a value that can be folded through it. None of these modules
 * render anything: no DOM, no HTML string, no `innerHTML`. `t()` is called
 * freely (a `Detection.summary` and every `ImportResult.warnings` entry are
 * user-facing text, so they are localised like any other string this app
 * shows), but always inside a function body — never captured at module
 * scope — for the same reason `main.ts#samples()` is a function and not a
 * constant.
 *
 * Pure and dependency-free of the DOM: no network, no `store.ts`, no
 * `share.ts`. See `docs/PROCESS.md` §5.
 *
 * ## Why `detect` and `parse` are separate calls
 *
 * The paste view runs every importer's `detect` on every keystroke-ish paste
 * event to decide what to *offer*; only the one the user accepts (or the
 * highest-confidence one, by default) gets `parse`d. Splitting the two means
 * the cheap, must-never-throw structural sniff (`detect`) never does the
 * expensive or fallible work (`parse`) that only matters once an importer has
 * actually been chosen.
 *
 * ## Why `detect` returning `null` is load-bearing
 *
 * `docs/task-specs/T3.md` requires a test over "empty string, binary bytes, a
 * 5 MB single line, and a deeply nested object" — a corpus chosen because a
 * paste view calls every importer's `detect` on *anything* a user drops into
 * the box, including things that are not remotely HTTP-shaped. A `detect`
 * that throws on hostile input takes the whole paste view down with it; `null`
 * is the only failure mode this interface allows.
 */

import type { Exchange } from "../exchange.js";

/** What one importer found, before anything is imported. */
export interface Detection {
  /** Matches the `Importer.id` that produced this detection. */
  id: string;
  /**
   * How confident this importer is that the pasted text is its format, from
   * `0` (not at all) to `1` (unambiguous). The paste view runs every
   * importer's `detect` and offers the highest-confidence result first —
   * see `detectAll`/`detectBest` in `./index.ts`.
   */
  confidence: number;
  /**
   * One line naming what was found, e.g. `"cURL · GET · 3 headers · 6
   * params"` — already localised, ready to show as-is.
   */
  summary: string;
}

/** What one importer produced, ready to fold into the current draft. */
export interface ImportResult {
  /**
   * Almost always one entry. More than one means this paste describes
   * several calls (a HAR with several entries, a transport-log stream
   * spanning several correlated calls) — the paste view offers a picker
   * rather than merging all of them at once, per
   * `docs/task-specs/T3.md`'s Behaviour section.
   */
  exchanges: Partial<Exchange>[];
  /**
   * Already-localised, user-facing notices about what could not be
   * imported faithfully — a skipped cURL flag, a chunked body that did not
   * reassemble cleanly, records that were not recognised. Empty when
   * nothing was lost. Never a reason to throw on its own: a warning is for
   * something *understood but imperfectly represented*; an `ImportError` is
   * for text this importer cannot make sense of at all.
   */
  warnings: string[];
}

/** One importer. No privileges beyond this shape — see this file's header. */
export interface Importer {
  /** Stable identifier — also used as `Exchange.origin.kind` by every importer in this directory. */
  id: string;
  /** Never throws. See this file's header for why that is load-bearing. */
  detect(text: string): Detection | null;
  /** May throw `ImportError`. Only called after `detect` has already said yes. */
  parse(text: string): ImportResult;
}

/**
 * A paste this importer recognised in outline but could not make sense of —
 * unbalanced cURL quoting, a raw HTTP message with no request line, JSON that
 * is not shaped like a transport-log record after all. Mirrors
 * `parse.ts#DocumentError` deliberately: same shape, same reason — a headline
 * and a hint the paste view can show verbatim, plus an optional 1-based line
 * number when the failure has a location in the source text.
 *
 * Never thrown for something merely *imperfect* — that is what `warnings` is
 * for. Thrown only when the input was plainly meant to be this format and
 * still could not be read, so the paste box keeps the text rather than
 * silently discarding part of it — see `docs/task-specs/T3.md`'s note on the
 * NDJSON defect this release already shipped once, from choosing a lenient
 * reading over naming a paste mistake.
 */
export class ImportError extends Error {
  readonly headline: string;
  readonly hint: string;
  readonly line?: number;

  constructor(headline: string, hint: string, line?: number) {
    super(`${headline} ${hint}`);
    this.name = "ImportError";
    this.headline = headline;
    this.hint = hint;
    this.line = line;
  }
}
