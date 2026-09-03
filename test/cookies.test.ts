import { describe, expect, it } from "vitest";
import { parseCookieHeader, parseSetCookie, parseSetCookies } from "../src/cookies.js";

describe("parseCookieHeader — a request's Cookie header", () => {
  it("splits name=value pairs on semicolons", () => {
    expect(parseCookieHeader("a=1; b=2; c=3")).toEqual([
      { name: "a", value: "1" },
      { name: "b", value: "2" },
      { name: "c", value: "3" },
    ]);
  });

  it("keeps a segment with no `=` rather than dropping it", () => {
    expect(parseCookieHeader("flag; a=1")).toEqual([
      { name: "flag", value: "" },
      { name: "a", value: "1" },
    ]);
  });

  it("reads an empty header as no cookies, not an error", () => {
    expect(parseCookieHeader("")).toEqual([]);
    expect(parseCookieHeader("   ")).toEqual([]);
  });

  it("keeps a value verbatim, with no percent-decoding — RFC 6265 values are opaque, not URL-encoded data", () => {
    expect(parseCookieHeader("a=100%25")).toEqual([{ name: "a", value: "100%25" }]);
  });
});

describe("parseSetCookie — one response Set-Cookie value", () => {
  it("reads every known attribute", () => {
    const cookie = parseSetCookie(
      "session=abc123; Domain=example.com; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Max-Age=3600; Secure; HttpOnly; SameSite=Lax",
    );
    expect(cookie.name).toBe("session");
    expect(cookie.value).toBe("abc123");
    expect(cookie.domain).toBe("example.com");
    expect(cookie.path).toBe("/");
    expect(cookie.expires).toBe("Wed, 21 Oct 2026 07:28:00 GMT");
    expect(cookie.expiresAt).toBe(Date.parse("Wed, 21 Oct 2026 07:28:00 GMT"));
    expect(cookie.maxAge).toBe(3600);
    expect(cookie.secure).toBe(true);
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe("Lax");
    expect(cookie.unrecognized).toBeUndefined();
  });

  it("does not split on the comma inside Expires — the reason Set-Cookie values are never comma-joined", () => {
    // If this were naively split on `,` before being handed to parseSetCookie,
    // "21 Oct 2026 07:28:00 GMT" would be sliced off into a second bogus
    // "cookie". One call, one cookie, comma intact.
    const cookie = parseSetCookie("a=1; Expires=Wed, 21 Oct 2026 07:28:00 GMT");
    expect(cookie.name).toBe("a");
    expect(cookie.expires).toBe("Wed, 21 Oct 2026 07:28:00 GMT");
  });

  it("normalises SameSite's case but keeps an unrecognised token verbatim rather than dropping it", () => {
    expect(parseSetCookie("a=1; SameSite=STRICT").sameSite).toBe("Strict");
    expect(parseSetCookie("a=1; SameSite=lax").sameSite).toBe("Lax");
    expect(parseSetCookie("a=1; SameSite=Weird").sameSite).toBe("Weird");
  });

  it("malformed Set-Cookie: name and value are kept, unparseable attributes listed verbatim", () => {
    const cookie = parseSetCookie("session=abc; Max-Age=not-a-number; Frobnicate=42; JustAFlag");
    expect(cookie.name).toBe("session");
    expect(cookie.value).toBe("abc");
    expect(cookie.maxAge).toBeUndefined();
    expect(cookie.unrecognized).toEqual(
      expect.arrayContaining([
        { name: "Max-Age", value: "not-a-number" },
        { name: "Frobnicate", value: "42" },
        { name: "JustAFlag", value: undefined },
      ]),
    );
  });

  it("keeps whatever text precedes the first `;` as the name, with an empty value, when it has no `=` at all", () => {
    const cookie = parseSetCookie("not-even-a-pair; Path=/");
    expect(cookie.name).toBe("not-even-a-pair");
    expect(cookie.value).toBe("");
    expect(cookie.path).toBe("/");
  });

  it("never throws on a garbage Expires value", () => {
    expect(() => parseSetCookie("a=1; Expires=not-a-date")).not.toThrow();
    const cookie = parseSetCookie("a=1; Expires=not-a-date");
    expect(cookie.expires).toBe("not-a-date");
    expect(cookie.expiresAt).toBeUndefined();
  });
});

describe("parseSetCookies — four Set-Cookie values, four cookies, in order", () => {
  it("parses each header value independently, preserving order and every attribute", () => {
    const result = parseSetCookies([
      "a=1; Path=/",
      "b=2; Domain=example.com; Secure",
      "c=3; HttpOnly; SameSite=None",
      "d=4; Max-Age=60",
    ]);
    expect(result.entries).toHaveLength(4);
    expect(result.entries.map((c) => c.name)).toEqual(["a", "b", "c", "d"]);
    expect(result.entries[0]?.path).toBe("/");
    expect(result.entries[1]?.domain).toBe("example.com");
    expect(result.entries[1]?.secure).toBe(true);
    expect(result.entries[2]?.httpOnly).toBe(true);
    expect(result.entries[2]?.sameSite).toBe("None");
    expect(result.entries[3]?.maxAge).toBe(60);
  });
});

describe("hostile values are preserved exactly, never sanitised", () => {
  it("keeps a hostile cookie name/value untouched through parseCookieHeader", () => {
    // `;` is `Cookie`'s own pair separator (RFC 6265), so a hostile payload
    // used as test data here must not contain one — same constraint a real
    // cookie value is under. Everything else survives untouched, including a
    // second `=` inside the value, since only the *first* `=` in a segment
    // is structurally significant.
    const cookies = parseCookieHeader('<script>alert(1)</script>="><img src=x onerror=alert(1)>');
    expect(cookies).toEqual([{ name: "<script>alert(1)</script>", value: '"><img src=x onerror=alert(1)>' }]);
  });

  it("keeps a hostile Set-Cookie name and value untouched", () => {
    // The name portion must not itself contain `=` — that character is what
    // marks the name/value boundary in `name=value`, for this parser exactly
    // as for every cookie parser, so it cannot appear in "the name" any more
    // than it could in a real cookie's name. The value has no such
    // restriction (only `;` is reserved, for attributes) and freely carries
    // one here.
    const cookie = parseSetCookie('<script>alert(1)</script>="><svg onload=alert(1)>');
    expect(cookie.name).toBe("<script>alert(1)</script>");
    expect(cookie.value).toBe('"><svg onload=alert(1)>');
  });
});
