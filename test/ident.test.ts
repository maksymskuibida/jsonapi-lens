import { describe, expect, it } from "vitest";
// Read the same way test/i18n.test.ts reads it, so this has no dependency on
// a Node filesystem API this app's tsconfig deliberately excludes.
import shippedMarkup from "../index.html?raw";
import {
  decodeSegment,
  domId,
  encodeSegment,
  groupDomId,
  groupHref,
  identityFromHash,
  mintAnchorId,
  nodeDomId,
  nodeHref,
  parseAnchorId,
  parseDomId,
  resourceHref,
  resourceSelector,
  scopeTable,
  typeHue,
  typeSigil,
  TYPE_HUES,
} from "../src/ident.js";
import type { AnchorScope } from "../src/ident.js";

/**
 * The ids that break anchors in practice. Every one of these is legal in a
 * JSON:API `type` or `id`, and every one of them is hostile to a URL fragment,
 * an HTML id attribute, or a CSS selector.
 */
const HOSTILE = [
  "simple",
  "with space",
  "with/slash",
  "with#hash",
  "with?query&amp=1",
  "urn:example:person:9",
  "dot.separated.id",
  "100%",
  "percent%20encoded",
  "trailing-",
  "_leading-underscore",
  "0-leading-digit",
  "zürich-city",
  "praha-mesto",
  "Ραδιοφωνικός",
  "Владивосток",
  "🖼-hero",
  "emoji-家-mix-🎫",
  '"quoted"',
  "'single'",
  "<script>alert(1)</script>",
  "back\\slash",
  "new\nline",
  "tab\there",
  "a".repeat(300),
  "--",
  "__",
  "_0000",
];

describe("segment encoding", () => {
  it("round-trips every hostile value", () => {
    for (const value of HOSTILE) {
      expect(decodeSegment(encodeSegment(value)), value).toBe(value);
    }
  });

  it("emits only characters that are safe in a fragment, an id and a selector", () => {
    for (const value of HOSTILE) {
      expect(encodeSegment(value), value).toMatch(/^[A-Za-z0-9_]*$/);
    }
  });

  it("is injective — distinct inputs never collide", () => {
    // `_` escaping is what makes this true: without it, "a_0020b" and "a b"
    // would both encode to the same thing.
    const seen = new Map<string, string>();
    for (const value of [...HOSTILE, "a b", "a_0020b", "x", "x_005f"]) {
      const encoded = encodeSegment(value);
      expect(seen.has(encoded), `${value} collides with ${seen.get(encoded)}`).toBe(false);
      seen.set(encoded, value);
    }
  });

  it("escapes astral characters as fixed-width surrogate pairs", () => {
    // `codePointAt` with a 4-digit pad would produce a 5-digit escape here and
    // make the encoding ambiguous.
    const encoded = encodeSegment("🚆");
    expect(encoded).toBe("_d83d_de86");
    expect(decodeSegment(encoded)).toBe("🚆");
  });

  it("rejects malformed escapes rather than guessing", () => {
    expect(() => decodeSegment("_zz")).toThrow();
    expect(() => decodeSegment("_00")).toThrow();
  });
});

describe("domId", () => {
  it("round-trips type and id together", () => {
    for (const type of HOSTILE) {
      for (const id of HOSTILE) {
        expect(parseDomId(domId(type, id))).toEqual({ type, id });
      }
    }
  });

  it("always starts with an ASCII letter", () => {
    for (const id of HOSTILE) {
      expect(domId("0-numeric-type", id)).toMatch(/^[A-Za-z]/);
    }
  });

  it("keeps type and id unambiguous even when one contains the joiner", () => {
    // A naive `${type}--${id}` scheme splits this in the wrong place.
    expect(parseDomId(domId("a__b", "c"))).toEqual({ type: "a__b", id: "c" });
    expect(parseDomId(domId("a", "b__c"))).toEqual({ type: "a", id: "b__c" });
    expect(parseDomId(domId("a", "b"))).not.toEqual(parseDomId(domId("a__b", "")));
  });

  it("distinguishes identities that differ only in where the separator falls", () => {
    expect(domId("ab", "c")).not.toBe(domId("a", "bc"));
  });

  it("returns null for anything it did not produce", () => {
    expect(parseDomId("overview")).toBeNull();
    expect(parseDomId("r_nojoiner")).toBeNull();
    expect(parseDomId("g_types")).toBeNull();
    // A malformed escape — `_` must be followed by exactly four hex digits.
    expect(parseDomId("r__zzzz__x")).toBeNull();
    // ...but a body with no escapes at all is perfectly decodable.
    expect(parseDomId("r_zz__zz")).toEqual({ type: "zz", id: "zz" });
  });

  it("produces a valid id attribute that getElementById can find", () => {
    for (const id of HOSTILE.slice(0, 12)) {
      const section = document.createElement("section");
      section.id = domId("people", id);
      document.body.append(section);
      expect(document.getElementById(domId("people", id))).toBe(section);
      section.remove();
    }
  });

  it("produces a selector that querySelector accepts", () => {
    for (const id of HOSTILE.slice(0, 12)) {
      const section = document.createElement("section");
      section.id = domId("draft/sections", id);
      document.body.append(section);
      expect(document.querySelector(resourceSelector("draft/sections", id))).toBe(section);
      section.remove();
    }
  });
});

describe("hrefs and hashes", () => {
  it("builds a fragment that needs no percent-encoding", () => {
    const href = resourceHref("draft/sections", "2026-09-14/Section 3#1");
    expect(href).toBe("#" + domId("draft/sections", "2026-09-14/Section 3#1"));
    // A raw `#` in the id would truncate the fragment; a raw space would be
    // re-encoded inconsistently. Neither survives encoding.
    expect(href.slice(1)).not.toContain("#");
    expect(href).not.toContain(" ");
    expect(encodeURIComponent(href.slice(1))).toBe(href.slice(1));
  });

  it("reads an identity back out of location.hash", () => {
    const hash = resourceHref("people", "zürich-city");
    expect(identityFromHash(hash)).toEqual({ type: "people", id: "zürich-city" });
  });

  it("tolerates a hash the browser has percent-encoded", () => {
    const fragment = domId("people", "zürich-city");
    expect(identityFromHash("#" + encodeURIComponent(fragment))).toEqual({
      type: "people",
      id: "zürich-city",
    });
  });

  it("survives a hash that is not valid percent-encoding", () => {
    expect(identityFromHash("#%zz")).toBeNull();
    expect(identityFromHash("")).toBeNull();
    expect(identityFromHash("#")).toBeNull();
  });
});

describe("type hue and sigil", () => {
  it("assigns a stable hue inside the ring", () => {
    for (const type of ["articles", "people", "draft/sections", "🚆", ""]) {
      const hue = typeHue(type);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(TYPE_HUES);
      expect(typeHue(type)).toBe(hue);
    }
  });

  it("builds a monogram from word initials where there are words", () => {
    expect(typeSigil("payment_methods")).toBe("PM");
    expect(typeSigil("draft/sections")).toBe("DS");
    expect(typeSigil("people")).toBe("PE");
    expect(typeSigil("a")).toBe("A");
  });

  it("does not throw on a type with no alphanumerics", () => {
    expect(typeSigil("///")).toBe("?");
    expect(typeSigil("")).toBe("?");
  });
});

/**
 * DECISIONS.md D1 — the anchor scope table. `resource` (`r_`) and `group`
 * (`g_`) are exactly what `domId`/`groupDomId` minted before this table
 * existed; the tests above already hold those two to their exact byte-for-
 * byte output. What follows is what the table itself has to prove to make
 * the cross-scope guarantee true rather than merely asserted.
 */
describe("D1 — the anchor scope table", () => {
  const ALL_SCOPES: AnchorScope[] = [
    "resource",
    "group",
    "requestField",
    "requestResource",
    "node",
    "requestNode",
    "finding",
  ];

  it("is exhaustive over the AnchorScope union", () => {
    // `Record<AnchorScope, ScopeDef>` in ident.ts is what makes a scope added
    // to the type without a table entry a `tsc` failure, not a runtime one —
    // this is the runtime half of that guarantee, over the same literal list
    // the type declares.
    const table = scopeTable();
    expect([...table.keys()].sort()).toEqual([...ALL_SCOPES].sort());
  });

  it("gives every scope a prefix that is exactly one ASCII letter and an underscore", () => {
    const table = scopeTable();
    for (const scope of ALL_SCOPES) {
      const prefix = table.get(scope)!;
      expect(prefix, scope).toMatch(/^[A-Za-z]_$/);
    }
  });

  it("gives every scope a first character distinct from every other scope's", () => {
    // This is the assertion that makes obligation 1 in D1 true: ids from two
    // scopes differ at index 0, with no need to reason about the bodies.
    const table = scopeTable();
    const firstChars = [...table.values()].map((prefix) => prefix[0]);
    expect(new Set(firstChars).size).toBe(firstChars.length);
  });

  it("matches exactly the letters D1 documents", () => {
    const table = scopeTable();
    expect(Object.fromEntries(table)).toEqual({
      resource: "r_",
      group: "g_",
      requestField: "q_",
      requestResource: "b_",
      node: "n_",
      requestNode: "d_",
      finding: "f_",
    });
  });

  describe("mintAnchorId / parseAnchorId", () => {
    it("round-trips an arbitrary number of segments in every scope", () => {
      for (const scope of ALL_SCOPES) {
        for (const segments of [["a"], ["a", "b"], ["a", "b", "c"]]) {
          expect(parseAnchorId(scope, mintAnchorId(scope, segments))).toEqual(segments);
        }
      }
    });

    it("round-trips every hostile value in every scope", () => {
      for (const scope of ALL_SCOPES) {
        for (const value of HOSTILE) {
          expect(parseAnchorId(scope, mintAnchorId(scope, [value, value]))).toEqual([value, value]);
        }
      }
    });

    it("returns null for a well-formed id from a different scope, rather than mis-parsing it", () => {
      const resourceId = mintAnchorId("resource", ["articles", "1"]);
      for (const scope of ALL_SCOPES) {
        if (scope === "resource") continue;
        expect(parseAnchorId(scope, resourceId), scope).toBeNull();
      }
      // And the reverse: a `group` id asked about as a `resource`.
      const groupId = mintAnchorId("group", ["articles"]);
      expect(parseAnchorId("resource", groupId)).toBeNull();
    });

    it("keeps parseDomId itself scoped to `resource` only — g_ ids stay unrecognised", () => {
      // Existing, byte-for-byte behaviour `parseDomId`'s own tests already
      // hold: restated here because it is the concrete case the scope table
      // exists to keep true as more scopes are added beside it.
      expect(parseDomId(mintAnchorId("group", ["articles"]))).toBeNull();
      expect(parseDomId(mintAnchorId("node", ["/data/0"]))).toBeNull();
    });
  });

  describe("cross-scope collision freedom", () => {
    /** A `type` chosen to look like another scope's own encoded body. */
    const SCOPE_LOOKALIKES = [
      "r_articles__1",
      "g_articles",
      "n__002fdata__002f0",
      "b_trips__1",
      "q_header__Authorization",
      "d__002fdata",
      "f_dangling__x",
    ];

    it("produces no two equal ids across every scope, over a corpus including scope lookalikes", () => {
      // De-duplicated: `HOSTILE` already carries a couple of these values
      // (`__`, `_0000`), and the point of this corpus is distinct segment
      // pairs, not a literal repeat of the same pair reproducing the same id.
      const corpus = [...new Set([...HOSTILE, ...SCOPE_LOOKALIKES, "🚆", ""])];
      const seen = new Map<string, string>();

      for (const scope of ALL_SCOPES) {
        for (const a of corpus) {
          for (const b of corpus.slice(0, 6)) {
            const id = mintAnchorId(scope, [a, b]);
            const label = `${scope}:${JSON.stringify([a, b])}`;
            expect(seen.has(id), `${label} collides with ${seen.get(id)}`).toBe(false);
            seen.set(id, label);
          }
        }
      }
    });

    it("keeps group and node ids distinguishable from resource ids built from the same raw text", () => {
      const raw = "trips__1";
      expect(mintAnchorId("group", [raw])).not.toBe(mintAnchorId("resource", [raw, ""]));
      expect(mintAnchorId("node", [raw])).not.toBe(mintAnchorId("resource", [raw, ""]));
      expect(mintAnchorId("group", [raw])[0]).not.toBe(mintAnchorId("resource", [raw, ""])[0]);
    });
  });

  describe("groupDomId / groupHref / nodeDomId / nodeHref", () => {
    it("groupDomId matches the g_ scope directly", () => {
      for (const type of HOSTILE) {
        expect(groupDomId(type)).toBe(mintAnchorId("group", [type]));
        expect(groupHref(type)).toBe("#" + groupDomId(type));
      }
    });

    it("nodeDomId matches the n_ scope directly, keyed by the whole pointer as one segment", () => {
      for (const pointer of ["/data/users/0", "/a~1b/0", ""]) {
        expect(nodeDomId(pointer)).toBe(mintAnchorId("node", [pointer]));
        expect(nodeHref(pointer)).toBe("#" + nodeDomId(pointer));
      }
    });

    it("never collides with a resource id even when type and pointer are the same text", () => {
      const text = "articles/1";
      expect(groupDomId(text)).not.toBe(domId(text, ""));
      expect(nodeDomId(text)).not.toBe(domId(text, ""));
      expect(groupDomId(text)).not.toBe(nodeDomId(text));
    });
  });
});

/**
 * The flank the cross-scope proof does not cover by itself: a static id
 * shipped in `index.html`, or one minted anywhere outside `ident.ts`, could
 * still shadow a real anchor even though every id `ident.ts` mints is
 * provably collision-free with every other. See DECISIONS.md D1.
 */
describe("D1 — no static or hand-minted id may shadow a scope", () => {
  it("has no id in index.html beginning with a scope letter and an underscore", () => {
    const doc = new DOMParser().parseFromString(shippedMarkup, "text/html");

    const scopeFirstChars = new Set(
      [...scopeTable().values()].map((prefix) => prefix[0]),
    );

    const offenders: string[] = [];
    for (const el of doc.querySelectorAll("[id]")) {
      const id = el.id;
      if (id.length >= 2 && id[1] === "_" && scopeFirstChars.has(id[0]!)) offenders.push(id);
    }
    expect(offenders).toEqual([]);
  });
});
