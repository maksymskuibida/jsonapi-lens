/**
 * Shared parsing for a raw HTTP message — importers #2 and #3 of
 * `docs/task-specs/T3.md` (a request and a response are the same grammar
 * after the start line: headers, a blank line, a body). Splitting this out
 * keeps `raw-http-request.ts` and `raw-http-response.ts` about *their own*
 * start line only, rather than each re-implementing blank-line detection and
 * chunk reassembly slightly differently.
 *
 * Pure and dependency-free of the DOM/network.
 */

import type { HeaderSet } from "../headers.js";
import { addHeader, getHeader, headerSet } from "../headers.js";
import { tryUtf8Decode, utf8Encode } from "./shared.js";

/** `\r\n` and bare `\n` are both accepted throughout — devtools, curl -v and a hand-typed paste each favour one or the other. */
const LINE_SPLIT = /\r\n|\n/;
const BLANK_LINE = /\r\n\r\n|\n\n/;

export interface ParsedHttpMessage {
  /** The start line, exactly as written — a request line or a status line, depending on the caller. */
  startLine: string;
  headers: HeaderSet;
  /** `undefined` when there was no blank-line boundary at all — see `noBlankLine`. */
  body: string | undefined;
  /** True when no blank line separated headers from a body — "headers only", per the spec's edge-case table. */
  noBlankLine: boolean;
}

/**
 * Split `text` into a start line, headers, and a body — the structure every
 * raw HTTP message shares. Never throws: a header line with no `:` is kept as
 * a name with an empty value rather than dropped, matching every other
 * parser in this codebase's refusal to silently discard wire data.
 */
export function parseHttpMessage(text: string): ParsedHttpMessage {
  const blankAt = BLANK_LINE.exec(text);
  const headSection = blankAt ? text.slice(0, blankAt.index) : text;
  const body = blankAt ? text.slice(blankAt.index + blankAt[0].length) : undefined;

  const lines = headSection.split(LINE_SPLIT);
  const startLine = lines[0] ?? "";

  let headers = headerSet([]);
  for (const line of lines.slice(1)) {
    if (line.trim() === "") continue;
    const colon = line.indexOf(":");
    if (colon < 0) {
      headers = addHeader(headers, line.trim(), "");
    } else {
      headers = addHeader(headers, line.slice(0, colon).trim(), line.slice(colon + 1).trim());
    }
  }

  return { startLine, headers, body, noBlankLine: blankAt === null };
}

export interface DechunkResult {
  text: string;
  /** False when a chunk-size line did not parse as hex, or the stream ran out before the terminating `0` chunk. */
  clean: boolean;
}

const HEX_LINE = /^[0-9a-fA-F]+/;

/**
 * Reassemble a `Transfer-Encoding: chunked` body: `<hex-size>\r\n<data>\r\n`,
 * repeated, ending at a zero-size chunk. Walked in bytes (via `TextEncoder`/
 * `TextDecoder`), not JS string length, because a chunk size on the wire is a
 * byte count and a pasted body can contain multi-byte UTF-8 characters that a
 * character-count slice would cut in half.
 *
 * Best-effort per `docs/task-specs/T3.md`'s edge-case table: chunk sizes are
 * stripped and whatever was successfully reassembled is returned even when
 * the stream does not end cleanly — `clean: false` is the caller's cue to add
 * a warning, never a reason to throw this away.
 */
export function dechunk(body: string): DechunkResult {
  const bytes = utf8Encode(body);
  const out: number[] = [];
  let i = 0;
  let clean = false;

  while (i < bytes.length) {
    // Find the CRLF/LF ending the size line by scanning bytes (size lines are ASCII hex).
    let lineEnd = i;
    while (lineEnd < bytes.length && bytes[lineEnd] !== 0x0a) lineEnd++;
    if (lineEnd >= bytes.length) break; // no newline left — truncated stream

    let sizeLineEnd = lineEnd;
    if (sizeLineEnd > i && bytes[sizeLineEnd - 1] === 0x0d) sizeLineEnd--;
    const sizeLine = tryUtf8Decode(bytes.slice(i, sizeLineEnd)) ?? "";
    const sizeToken = sizeLine.split(";")[0]?.trim() ?? ""; // chunk extensions after `;` are ignored, not reassembled
    if (!HEX_LINE.test(sizeToken)) break; // not a hex size — reassembly did not stay clean

    const size = parseInt(sizeToken, 16);
    const dataStart = lineEnd + 1;
    if (size === 0) {
      clean = true;
      break;
    }
    if (dataStart + size > bytes.length) break; // truncated — fewer bytes than declared

    for (let k = 0; k < size; k++) out.push(bytes[dataStart + k]!);

    // Skip the chunk's own trailing CRLF/LF before the next size line.
    let next = dataStart + size;
    if (bytes[next] === 0x0d) next++;
    if (bytes[next] === 0x0a) next++;
    i = next;
  }

  return { text: tryUtf8Decode(Uint8Array.from(out)) ?? "", clean };
}

/** `Content-Type`, case-insensitively, when the message declares one — for `BodyPart.contentType`. */
export function contentTypeOf(headers: HeaderSet): string | undefined {
  return getHeader(headers, "content-type");
}

export function isChunked(headers: HeaderSet): boolean {
  const value = getHeader(headers, "transfer-encoding");
  return value !== undefined && /\bchunked\b/i.test(value);
}
