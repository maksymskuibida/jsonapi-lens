/**
 * The bare URL importer — `docs/task-specs/T3.md` importer #4. The common
 * quick case: paste one URL, get a request with its query string already
 * decoded through T2's parameter decoder. No headers, no body, no method —
 * `GET` is HTTP's own default, so it is the one field this importer fills in
 * that the pasted text never stated outright.
 */

import type { Exchange } from "../exchange.js";
import { t } from "../i18n/index.js";
import { isWithinDetectBudget, splitUrl } from "./shared.js";
import type { Detection, ImportResult, Importer } from "./types.js";
import { ImportError } from "./types.js";

export const URL_ID = "url";

/**
 * No real URL is anywhere near this long — even a generously long one with a
 * large query string stays well under it — so a paste past this length is
 * something else entirely (a document, a log dump) and is rejected before
 * any regex or `URL` construction runs over it. This is what keeps `detect`
 * cheap on the spec's 5 MB single-line corpus case.
 */
const MAX_URL_LENGTH = 8000;

/** A scheme already present — `splitUrl` would assume `https://` for anything lacking one, so detection needs its own, narrower host-shape check first. */
const HAS_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;

/** `host[.host]+.tld[:port][/path][?query]` — no scheme, no spaces, at least one dot. Linear, no nested quantifiers, so it stays cheap even on a long non-matching input. */
const HOST_SHAPE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+(?::\d{1,5})?(?:\/\S*)?$/;

function looksLikeUrl(trimmed: string): boolean {
  if (trimmed === "" || /\s/.test(trimmed)) return false;
  if (HAS_SCHEME.test(trimmed)) return /^https?:\/\//i.test(trimmed);
  return HOST_SHAPE.test(trimmed);
}

export function detectUrl(text: string): Detection | null {
  const trimmed = text.trim();
  if (!isWithinDetectBudget(trimmed, MAX_URL_LENGTH)) return null;
  if (!looksLikeUrl(trimmed)) return null;

  const split = splitUrl(trimmed);
  if (!split) return null;

  const confidence = HAS_SCHEME.test(trimmed) ? 0.85 : 0.55;
  return { id: URL_ID, confidence, summary: t().import.url.summary(split.query?.entries.length ?? 0) };
}

export function parseUrl(text: string): ImportResult {
  const trimmed = text.trim();
  const split = splitUrl(trimmed);
  if (!split) {
    throw new ImportError(t().import.url.errors.notAUrl.headline, t().import.url.errors.notAUrl.hint);
  }

  const warnings: string[] = [];
  if (split.assumedScheme) warnings.push(t().import.common.schemeAssumed);
  if (split.queryUndecodable) warnings.push(t().import.common.queryUndecodable);

  const request: NonNullable<Exchange["request"]> = { method: "GET", url: split.base };
  if (split.query !== undefined) request.query = split.query;

  const exchange: Partial<Exchange> = { request, origin: { kind: URL_ID } };
  return { exchanges: [exchange], warnings };
}

export const urlImporter: Importer = { id: URL_ID, detect: detectUrl, parse: parseUrl };
