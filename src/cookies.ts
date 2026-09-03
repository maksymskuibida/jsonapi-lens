/**
 * Cookie parsing — a request's `Cookie` header and a response's `Set-Cookie`
 * headers, decomposed into the structured rows `docs/task-specs/T2.md` asks
 * for. "A cookie is not a header in the review even though it arrives as
 * one": once a `Cookie`/`Set-Cookie` header's value reaches this module, it
 * stops being a string and becomes name/value pairs (request) or
 * name/value/attributes (response). Moving a header's contents into these
 * rows is the form's job (T2b) — this module only supplies the parse.
 *
 * ## Why `Set-Cookie` is never comma-split
 *
 * The obvious-looking shortcut — one `Set-Cookie` header value, multiple
 * cookies joined by `,` — is wrong, and it is wrong in a way that only shows
 * up on some cookies and not others: `Expires=Wed, 21 Oct 2026 07:28:00 GMT`
 * contains a comma that is not a separator. RFC 6265 deals with this by
 * simply forbidding a server from combining `Set-Cookie` lines at all, which
 * is why `headers.ts#HeaderSet` keeps duplicate headers as separate entries
 * instead of folding them into one comma-joined value. This module trusts
 * that discipline completely: `parseSetCookie` parses exactly **one** header
 * value, and a caller with four `Set-Cookie` entries calls it four times.
 * Splitting a single value on comma to recover multiple cookies is the bug
 * this comment exists to keep out of this file — do not add it.
 *
 * ## Values are kept verbatim
 *
 * RFC 6265 defines `cookie-value` as an opaque token or quoted string, not
 * URL-encoded data — unlike a query parameter, there is no standard that says
 * a `%`-sequence in a cookie value means anything. Percent-decoding it here
 * would be a guess this module has no basis for, so cookie names and values
 * are never decoded, only split out from their surrounding syntax.
 *
 * Pure data and pure functions — no DOM, no `t()`, no network.
 */

export interface Cookie {
  name: string;
  value: string;
}

export interface CookieSet {
  entries: Cookie[];
}

export const EMPTY_COOKIES: CookieSet = { entries: [] };

/** The three tokens RFC 6265bis defines. Anything else is kept as typed rather than rejected. */
export type SameSiteValue = "Strict" | "Lax" | "None";

/**
 * An attribute this parser did not recognise (or recognised but could not
 * make sense of), kept rather than dropped.
 */
export interface UnrecognizedAttribute {
  name: string;
  value?: string;
}

export interface SetCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  /** The `Expires` attribute exactly as written. */
  expires?: string;
  /** `Expires`, parsed to epoch ms — absent when `expires` did not parse as a date. */
  expiresAt?: number;
  maxAge?: number;
  secure?: boolean;
  httpOnly?: boolean;
  /** One of the three known tokens, normalised in case; any other text is kept verbatim rather than dropped. */
  sameSite?: SameSiteValue | string;
  /**
   * Attribute text this parser could not place — "Malformed Set-Cookie" in
   * the spec's edge-case table, kept rather than dropped.
   */
  unrecognized?: UnrecognizedAttribute[];
}

export interface SetCookieSet {
  entries: SetCookie[];
}

export const EMPTY_SET_COOKIES: SetCookieSet = { entries: [] };

/**
 * A request's `Cookie` header: `name1=value1; name2=value2`, no attributes.
 * Never throws — a segment with no `=` becomes a name with an empty value
 * rather than being dropped, since silently discarding wire data is the one
 * thing every parser in this module refuses to do.
 */
export function parseCookieHeader(value: string): Cookie[] {
  return value
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const eq = part.indexOf("=");
      if (eq < 0) return { name: part, value: "" };
      return { name: part.slice(0, eq).trim(), value: part.slice(eq + 1).trim() };
    });
}

const KNOWN_SAME_SITE: Record<string, SameSiteValue> = {
  strict: "Strict",
  lax: "Lax",
  none: "None",
};

function splitAttribute(segment: string): { name: string; value?: string } {
  const eq = segment.indexOf("=");
  if (eq < 0) return { name: segment.trim() };
  return { name: segment.slice(0, eq).trim(), value: segment.slice(eq + 1).trim() };
}

/**
 * One response `Set-Cookie` header value: `name=value; Attr=Val; Flag`.
 *
 * Never throws. The first segment's name and value are always kept, even
 * when it has no `=` at all (the whole segment becomes the name, with an
 * empty value) — "Malformed Set-Cookie: name and value kept" from the spec's
 * edge-case table. Every later segment is matched case-insensitively against
 * the known attributes; anything else — an attribute this build does not
 * know, or one whose value did not parse (a non-numeric `Max-Age`) — is
 * appended to `unrecognized` verbatim instead of being silently dropped.
 */
export function parseSetCookie(raw: string): SetCookie {
  const segments = raw
    .split(";")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  const first = segments[0] ?? "";
  const eq = first.indexOf("=");
  const name = eq < 0 ? first : first.slice(0, eq).trim();
  const value = eq < 0 ? "" : first.slice(eq + 1).trim();

  const cookie: SetCookie = { name, value };
  const unrecognized: UnrecognizedAttribute[] = [];

  for (const segment of segments.slice(1)) {
    const { name: attrName, value: attrValue } = splitAttribute(segment);
    switch (attrName.toLowerCase()) {
      case "domain":
        cookie.domain = attrValue ?? "";
        break;
      case "path":
        cookie.path = attrValue ?? "";
        break;
      case "expires": {
        cookie.expires = attrValue ?? "";
        const parsed = attrValue ? Date.parse(attrValue) : NaN;
        if (!Number.isNaN(parsed)) cookie.expiresAt = parsed;
        break;
      }
      case "max-age": {
        const n = attrValue === undefined ? NaN : Number(attrValue);
        if (attrValue !== undefined && Number.isFinite(n)) cookie.maxAge = n;
        else unrecognized.push({ name: attrName, value: attrValue });
        break;
      }
      case "secure":
        cookie.secure = true;
        break;
      case "httponly":
        cookie.httpOnly = true;
        break;
      case "samesite":
        cookie.sameSite = attrValue === undefined ? "" : (KNOWN_SAME_SITE[attrValue.toLowerCase()] ?? attrValue);
        break;
      default:
        unrecognized.push({ name: attrName, value: attrValue });
    }
  }

  if (unrecognized.length > 0) cookie.unrecognized = unrecognized;
  return cookie;
}

/**
 * `parseSetCookie` over every entry of a `Set-Cookie` `HeaderSet` reading —
 * see this module's header for why each value is parsed independently rather
 * than joined first.
 */
export function parseSetCookies(values: readonly string[]): SetCookieSet {
  return { entries: values.map(parseSetCookie) };
}
