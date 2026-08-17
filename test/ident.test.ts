import { describe, expect, it } from "vitest";
import {
  decodeSegment,
  domId,
  encodeSegment,
  identityFromHash,
  parseDomId,
  resourceHref,
  resourceSelector,
  typeHue,
  typeSigil,
  TYPE_HUES,
} from "../src/ident.js";

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
  "urn:example:trip:9",
  "dot.separated.id",
  "100%",
  "percent%20encoded",
  "trailing-",
  "_leading-underscore",
  "0-leading-digit",
  "zürich-hbf",
  "praha-hlavní",
  "Ραδιοφωνικός",
  "Владивосток",
  "🚆-express",
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
      section.id = domId("stations", id);
      document.body.append(section);
      expect(document.getElementById(domId("stations", id))).toBe(section);
      section.remove();
    }
  });

  it("produces a selector that querySelector accepts", () => {
    for (const id of HOSTILE.slice(0, 12)) {
      const section = document.createElement("section");
      section.id = domId("trip/legs", id);
      document.body.append(section);
      expect(document.querySelector(resourceSelector("trip/legs", id))).toBe(section);
      section.remove();
    }
  });
});

describe("hrefs and hashes", () => {
  it("builds a fragment that needs no percent-encoding", () => {
    const href = resourceHref("trip/legs", "2026-09-14/EC 173#1");
    expect(href).toBe("#" + domId("trip/legs", "2026-09-14/EC 173#1"));
    // A raw `#` in the id would truncate the fragment; a raw space would be
    // re-encoded inconsistently. Neither survives encoding.
    expect(href.slice(1)).not.toContain("#");
    expect(href).not.toContain(" ");
    expect(encodeURIComponent(href.slice(1))).toBe(href.slice(1));
  });

  it("reads an identity back out of location.hash", () => {
    const hash = resourceHref("stations", "zürich-hbf");
    expect(identityFromHash(hash)).toEqual({ type: "stations", id: "zürich-hbf" });
  });

  it("tolerates a hash the browser has percent-encoded", () => {
    const fragment = domId("stations", "zürich-hbf");
    expect(identityFromHash("#" + encodeURIComponent(fragment))).toEqual({
      type: "stations",
      id: "zürich-hbf",
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
    for (const type of ["trips", "stations", "trip/legs", "🚆", ""]) {
      const hue = typeHue(type);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(TYPE_HUES);
      expect(typeHue(type)).toBe(hue);
    }
  });

  it("builds a monogram from word initials where there are words", () => {
    expect(typeSigil("payment_methods")).toBe("PM");
    expect(typeSigil("trip/legs")).toBe("TL");
    expect(typeSigil("stations")).toBe("ST");
    expect(typeSigil("a")).toBe("A");
  });

  it("does not throw on a type with no alphanumerics", () => {
    expect(typeSigil("///")).toBe("?");
    expect(typeSigil("")).toBe("?");
  });
});
