import { describe, expect, it } from "vitest";
import {
  IMPRESSUM_PATH,
  parseRoute,
  PASTE_PATH,
  PRIVACY_PATH,
  shareUrl,
  VIEW_PATH,
} from "../src/router.js";
import { escapeToken, join, parse, resolve, unescapeToken } from "../src/pointer.js";

describe("shareUrl", () => {
  it("puts the key in the fragment, where no browser will transmit it", () => {
    // DECISIONS.md D7: the key must not appear in the path, because the path
    // is what reaches the origin's access log. A `:` here is a security
    // regression, not a formatting change.
    const url = shareUrl(42, "AAAAAAAAAAAAAAAAAAAA");
    expect(new URL(url).pathname).toBe("/d/42");
    expect(new URL(url).hash).toBe("#AAAAAAAAAAAAAAAAAAAA");
    expect(new URL(url).pathname).not.toContain("AAAAAAAAAAAAAAAAAAAA");
  });

  it("mints a link this app can read back", () => {
    const url = new URL(shareUrl(7, "BBBBBBBBBBBBBBBBBBBB"));
    expect(parseRoute(url.pathname, url.hash)).toEqual({
      kind: "share",
      id: 7,
      secret: "BBBBBBBBBBBBBBBBBBBB",
    });
  });
});

describe("parseRoute", () => {
  it("maps the app's own paths", () => {
    expect(parseRoute("/")).toEqual({ kind: "paste" });
    expect(parseRoute("")).toEqual({ kind: "paste" });
    expect(parseRoute(VIEW_PATH)).toEqual({ kind: "view" });
    expect(parseRoute(VIEW_PATH + "/")).toEqual({ kind: "view" });
    expect(parseRoute(IMPRESSUM_PATH)).toEqual({ kind: "legal", page: "impressum" });
    expect(parseRoute(PRIVACY_PATH)).toEqual({ kind: "legal", page: "privacy" });
  });

  it("honours the spellings people actually type for the legal pages", () => {
    // These get typed into address bars and pasted out of emails far more than
    // the app's own paths do, so the aliases are worth having.
    for (const path of ["/imprint", "/legal", "/impressum/", "/Impressum"]) {
      expect(parseRoute(path), path).toEqual({ kind: "legal", page: "impressum" });
    }
    for (const path of ["/datenschutz", "/datenschutzerklaerung", "/privacy/", "/Datenschutz"]) {
      expect(parseRoute(path), path).toEqual({ kind: "legal", page: "privacy" });
    }
  });

  it("does not mistake a share link for a legal page", () => {
    expect(parseRoute("/d/1", "#AAAAAAAAAAAAAAAAAAAA").kind).toBe("share");
    expect(parseRoute("/impressum/extra").kind).toBe("unknown");
  });

  it("reads a share link", () => {
    expect(parseRoute("/d/42", "#AAAAAAAAAAAAAAAAAAAA")).toEqual({
      kind: "share",
      id: 42,
      secret: "AAAAAAAAAAAAAAAAAAAA",
    });
  });

  it("still reads the legacy in-path form, because those links are out there", () => {
    // Minted until the key moved to the fragment (DECISIONS.md D7). Nothing
    // produces this any more, and it must never stop being read.
    expect(parseRoute("/d/42:AAAAAAAAAAAAAAAAAAAA")).toEqual({
      kind: "share",
      id: 42,
      secret: "AAAAAAAAAAAAAAAAAAAA",
    });
  });

  it("still reads the legacy in-path form with the `.` separator, forever", () => {
    // SHARE_PATTERN's character class is `[:.]`, and D7 promises both legacy
    // separators keep parsing, not just `:`. Review B1 (round 1): this was
    // the one form nothing in the suite exercised, so deleting the `.` from
    // that class passed every test in the repository. Confirmed by hand:
    // removing the `.` from src/router.ts's SHARE_PATTERN turns this red
    // (kind becomes "share-damaged", falling through to the digit-only
    // fallback rule) while every other test still passes.
    expect(parseRoute("/d/42.AAAAAAAAAAAAAAAAAAAA")).toEqual({
      kind: "share",
      id: 42,
      secret: "AAAAAAAAAAAAAAAAAAAA",
    });
  });

  it("reads a share link whose colon the asset router percent-encoded", () => {
    // Cloudflare 307s `/d/1:KEY` to `/d/1%3AKEY`, so this is the form the app
    // actually sees in `location.pathname` most of the time.
    expect(parseRoute("/d/42%3AAAAAAAAAAAAAAAAAAAAA")).toEqual({
      kind: "share",
      id: 42,
      secret: "AAAAAAAAAAAAAAAAAAAA",
    });
  });

  it("accepts a trailing slash on the id, with the key still in the fragment", () => {
    expect(parseRoute("/d/7/", "#BBBBBBBBBBBBBBBBBBBB")).toEqual({
      kind: "share",
      id: 7,
      secret: "BBBBBBBBBBBBBBBBBBBB",
    });
  });

  it("accepts a 64-character secret — crypto.ts's own maximum, and what the MCP tool mints", () => {
    // Review B1 (round 1): test/mcp/tools.test.ts mints a 64-character
    // secret but only ever asserted the returned *string*, never parsed it
    // back — so lowering SECRET_PATTERN's upper bound (src/router.ts:87)
    // below 64 passed every test in the repository while breaking every
    // MCP-minted link. The honest guard is a round trip through the app's
    // own router, the same shape shareUrl/parseRoute are exercised in
    // "mints a link this app can read back" above, at the boundary length.
    // Confirmed by hand: lowering SECRET_PATTERN's `{8,64}` to `{8,20}`
    // turns this red while the rest of the suite stays green.
    const secret = "a".repeat(64);
    const url = new URL(shareUrl(9001, secret));
    expect(parseRoute(url.pathname, url.hash)).toEqual({ kind: "share", id: 9001, secret });

    // The legacy in-path form must accept the same length.
    expect(parseRoute(`/d/9001:${secret}`)).toEqual({ kind: "share", id: 9001, secret });
  });

  it("calls a share link with no usable key damaged, not missing", () => {
    // The fragment is the part a chat client, shortener or mail scanner eats,
    // so "no page here" would send someone away from the actual problem.
    for (const [path, hash] of [
      ["/d/42", ""],
      ["/d/42", "#short"],
      ["/d/42:short", ""],
      ["/d/42:AAAAAAAAAAAAAAAAAAAA/extra", ""],
    ] as const) {
      expect(parseRoute(path, hash), `${path}${hash}`).toEqual({ kind: "share-damaged" });
    }
  });

  it("rejects a non-numeric share id — that was never a share link", () => {
    // Review B1 (round 1): the test plan's case 12 claims both
    // "/d/notanumber:secret" and bare "/d/notanumber" are covered, but only
    // the `:`-suffixed form was ever asserted. The bare form is the one that
    // actually exercises the new `share-damaged` fallthrough's boundary
    // (`/^\/d\/\d/.test(pathname)`, src/router.ts): it must not fire for a
    // path that never had a digit after `/d/` in the first place. Confirmed
    // by hand: loosening that regex to `/^\/d\//` turns this red (kind
    // becomes "share-damaged") while the rest of the suite stays green.
    expect(parseRoute("/d/abc:AAAAAAAAAAAAAAAAAAAA").kind).toBe("unknown");
    expect(parseRoute("/d/notanumber").kind).toBe("unknown");
    expect(parseRoute("/d/notanumber:AAAAAAAAAAAAAAAAAAAA").kind).toBe("unknown");
  });

  it("reports anything else as unknown, keeping the path for the message", () => {
    expect(parseRoute("/nope")).toEqual({ kind: "unknown", pathname: "/nope" });
  });

  it("survives a pathname that is not valid percent-encoding", () => {
    expect(() => parseRoute("/%zz")).not.toThrow();
    expect(parseRoute("/%zz").kind).toBe("unknown");
  });

  it("exports the paths the app navigates between", () => {
    expect(PASTE_PATH).toBe("/");
    expect(VIEW_PATH).toBe("/view");
  });
});

describe("JSON Pointer", () => {
  it("escapes the two characters that need it, in the right order", () => {
    expect(escapeToken("a/b")).toBe("a~1b");
    expect(escapeToken("a~b")).toBe("a~0b");
    // `~1` must not be re-escaped into `~01`.
    expect(escapeToken("a~1b")).toBe("a~01b");
    expect(unescapeToken(escapeToken("a~1b"))).toBe("a~1b");
  });

  it("round-trips awkward keys", () => {
    for (const token of ["plain", "with/slash", "with~tilde", "~1", "~0", "", "🖼"]) {
      expect(unescapeToken(escapeToken(token))).toBe(token);
    }
  });

  it("builds pointers that match the JSON:API error syntax", () => {
    expect(join("/data", 0, "attributes", "title")).toBe("/data/0/attributes/title");
    expect(join("/included", 12, "relationships", "author")).toBe(
      "/included/12/relationships/author",
    );
    expect(join("/data", "attributes", "a/b")).toBe("/data/attributes/a~1b");
  });

  it("parses a pointer back into tokens", () => {
    expect(parse("")).toEqual([]);
    expect(parse("/data/0/attributes")).toEqual(["data", "0", "attributes"]);
    expect(parse("/data/attributes/a~1b")).toEqual(["data", "attributes", "a/b"]);
    expect(() => parse("data/0")).toThrow();
  });

  it("resolves a pointer against a document", () => {
    const root = {
      data: [{ type: "articles", id: "1", attributes: { title: "T", "a/b": 9, deep: { x: [1, 2] } } }],
      meta: { total: 3, nothing: null },
    };
    expect(resolve(root, "/data/0/attributes/title")).toBe("T");
    expect(resolve(root, "/data/0/attributes/a~1b")).toBe(9);
    expect(resolve(root, "/data/0/attributes/deep/x/1")).toBe(2);
    expect(resolve(root, "/meta/total")).toBe(3);
    expect(resolve(root, "")).toBe(root);
  });

  it("distinguishes a null value from a pointer that does not resolve", () => {
    const root = { meta: { nothing: null } };
    expect(resolve(root, "/meta/nothing")).toBeNull();
    expect(resolve(root, "/meta/missing")).toBeUndefined();
    expect(resolve(root, "/meta/nothing/deeper")).toBeUndefined();
  });

  it("does not walk off the end of an array or into a prototype", () => {
    const root = { data: [{ id: "1" }] };
    expect(resolve(root, "/data/5")).toBeUndefined();
    expect(resolve(root, "/data/-1")).toBeUndefined();
    expect(resolve(root, "/data/x")).toBeUndefined();
    expect(resolve(root, "/constructor")).toBeUndefined();
    expect(resolve(root, "/data/0/__proto__")).toBeUndefined();
  });
});

describe("history entry state", () => {
  /**
   * These mirror the shape written into `history.state`. The restore logic
   * itself lives in main.ts against a real document, but the contract — an
   * offset is only valid together with the fold it was measured against — is
   * worth pinning down.
   */
  it("treats an offset without a fold state as incomplete", () => {
    const entry: { y?: number; open?: string[] } = { y: 1200 };
    expect(entry.y).toBe(1200);
    expect(entry.open).toBeUndefined();
  });

  it("round-trips through JSON, which is what structured clone must accept", () => {
    const entry = { y: 2400, open: ["r_articles__art_002d1", "r_people__per_002dada"] };
    expect(JSON.parse(JSON.stringify(entry))).toEqual(entry);
  });
});
