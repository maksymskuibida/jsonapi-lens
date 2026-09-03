import { describe, expect, it } from "vitest";
import { decodeParams, encodeParams, findParam, includeTree, sortFields } from "../src/params.js";
import type { ParamEntry } from "../src/params.js";

/** The value/convention of the one entry named `name`, or `undefined` if there isn't one. */
function readOf(wire: string, name: string): ParamEntry | undefined {
  return findParam(decodeParams(wire), name);
}

/** Decode, then re-encode and decode again — the round-trip every table row must satisfy. */
function roundTrips(wire: string, name: string) {
  const first = readOf(wire, name);
  const again = readOf(encodeParams(decodeParams(wire)), name);
  expect(again?.value).toEqual(first?.value);
}

describe("the parameter table — every row decodes to the stated value and round-trips", () => {
  it("repeated key: a=1&a=2 -> [1,2]", () => {
    const entry = readOf("a=1&a=2", "a");
    expect(entry?.value).toEqual(["1", "2"]);
    expect(entry?.convention).toBe("repeated-key");
    roundTrips("a=1&a=2", "a");
  });

  it("bracket list: a[]=1&a[]=2 -> [1,2]", () => {
    const entry = readOf("a[]=1&a[]=2", "a");
    expect(entry?.value).toEqual(["1", "2"]);
    expect(entry?.convention).toBe("bracket-list");
    roundTrips("a[]=1&a[]=2", "a");
  });

  it("indexed: a[0]=1&a[1]=2 -> [1,2]", () => {
    const entry = readOf("a[0]=1&a[1]=2", "a");
    expect(entry?.value).toEqual(["1", "2"]);
    expect(entry?.convention).toBe("indexed");
    roundTrips("a[0]=1&a[1]=2", "a");
  });

  it("indexed out of order still sorts numerically", () => {
    const entry = readOf("a[1]=second&a[0]=first", "a");
    expect(entry?.value).toEqual(["first", "second"]);
  });

  it("comma: a=1,2,3 -> [1,2,3], with the literal string offered as the alternative", () => {
    const entry = readOf("a=1,2,3", "a");
    expect(entry?.value).toEqual(["1", "2", "3"]);
    expect(entry?.convention).toBe("comma");
    expect(entry?.alternatives).toEqual([{ path: [], convention: "plain", value: "1,2,3" }]);
    roundTrips("a=1,2,3", "a");
  });

  it("space delimited: a=1%202 -> [1,2]", () => {
    const entry = readOf("a=1%202", "a");
    expect(entry?.value).toEqual(["1", "2"]);
    expect(entry?.convention).toBe("space-delimited");
    roundTrips("a=1%202", "a");
  });

  it("pipe delimited: a=1|2 -> [1,2]", () => {
    const entry = readOf("a=1|2", "a");
    expect(entry?.value).toEqual(["1", "2"]);
    expect(entry?.convention).toBe("pipe-delimited");
    roundTrips("a=1|2", "a");
  });

  it("bracket object: a[b]=1 -> {b:1}", () => {
    const entry = readOf("a[b]=1", "a");
    expect(entry?.value).toEqual({ b: "1" });
    expect(entry?.convention).toBe("bracket-object");
    roundTrips("a[b]=1", "a");
  });

  it("bracket object, nested: a[b][c]=1 -> {b:{c:1}}", () => {
    const entry = readOf("a[b][c]=1", "a");
    expect(entry?.value).toEqual({ b: { c: "1" } });
    expect(entry?.convention).toBe("bracket-object");
    roundTrips("a[b][c]=1", "a");
  });

  it("dot path: a.b=1 -> {b:1}", () => {
    const entry = readOf("a.b=1", "a");
    expect(entry?.value).toEqual({ b: "1" });
    expect(entry?.convention).toBe("dot-path");
    roundTrips("a.b=1", "a");
  });

  it("JSON in a value: a={\"b\":1} -> {b:1}", () => {
    const entry = readOf('a={"b":1}', "a");
    expect(entry?.value).toEqual({ b: 1 });
    expect(entry?.convention).toBe("json-value");
    expect(entry?.alternatives).toEqual([{ path: [], convention: "plain", value: '{"b":1}' }]);
    roundTrips('a={"b":1}', "a");
  });

  it("base64url JSON: cursor=eyJvIjoyNX0 -> {o:25}", () => {
    const entry = readOf("cursor=eyJvIjoyNX0", "cursor");
    expect(entry?.value).toEqual({ o: 25 });
    expect(entry?.convention).toBe("base64url-json");
    expect(entry?.alternatives).toEqual([{ path: [], convention: "plain", value: "eyJvIjoyNX0" }]);
    roundTrips("cursor=eyJvIjoyNX0", "cursor");
  });
});

describe("ambiguity is shown, never guessed away", () => {
  it("a=1&a[]=2 reports a conflict rather than picking one", () => {
    const entry = readOf("a=1&a[]=2", "a");
    expect(entry?.value).toBeUndefined();
    expect(entry?.convention).toBeUndefined();
    expect(entry?.conflict).toEqual(
      expect.arrayContaining([
        { convention: "plain", value: "1" },
        { convention: "bracket-list", value: ["2"] },
      ]),
    );
    expect(entry?.conflict).toHaveLength(2);
  });

  it("an index-like and a key-like bracket for the same name also conflict — a[0]=1&a[b]=2", () => {
    const entry = readOf("a[0]=1&a[b]=2", "a");
    expect(entry?.value).toBeUndefined();
    expect(entry?.conflict).toHaveLength(2);
    expect(entry?.conflict).toEqual(
      expect.arrayContaining([
        { convention: "indexed", value: ["1"] },
        { convention: "bracket-object", value: { b: "2" } },
      ]),
    );
  });

  it("three incompatible key syntaxes for one name still name every reading, not just the first two", () => {
    const entry = readOf("a=1&a[]=2&a[b]=3", "a");
    expect(entry?.value).toBeUndefined();
    expect(entry?.conflict).toHaveLength(3);
    expect(entry?.conflict).toEqual(
      expect.arrayContaining([
        { convention: "plain", value: "1" },
        { convention: "bracket-list", value: ["2"] },
        { convention: "bracket-object", value: { b: "3" } },
      ]),
    );
  });

  it("a= and a decode to distinguishable values", () => {
    const present = readOf("a=", "a");
    const valueless = readOf("a", "a");
    expect(present?.value).toBe("");
    expect(present?.convention).toBe("plain");
    expect(valueless?.value).toBeNull();
    expect(valueless?.convention).toBe("valueless");
    expect(present?.value).not.toEqual(valueless?.value);
  });

  it("percent-encoded and +-encoded spaces both decode the same way, with the raw wire value kept one row away", () => {
    const percent = readOf("a=1%202", "a");
    const plus = readOf("a=1+2", "a");
    expect(percent?.value).toEqual(["1", "2"]);
    expect(plus?.value).toEqual(["1", "2"]);
    expect(percent?.raw).toEqual([{ key: "a", value: "1%202" }]);
    expect(plus?.raw).toEqual([{ key: "a", value: "1+2" }]);
  });

  it("keeps the raw wire pair even for a resolved, unambiguous value", () => {
    const entry = readOf("a=hello", "a");
    expect(entry?.raw).toEqual([{ key: "a", value: "hello" }]);
  });
});

describe("JSON:API parameters are first class", () => {
  it("include=legs.station,legs.operator produces the include tree legs -> {station, operator}", () => {
    const tree = includeTree(decodeParams("include=legs.station,legs.operator"));
    expect(tree).toEqual({ legs: { station: {}, operator: {} } });
  });

  it("a document with no include parameter has no include tree", () => {
    expect(includeTree(decodeParams("a=1"))).toBeUndefined();
  });

  it("filter[status][in]=booked,held decodes to {status:{in:[booked,held]}}, naming both conventions", () => {
    const entry = readOf("filter[status][in]=booked,held", "filter");
    expect(entry?.value).toEqual({ status: { in: ["booked", "held"] } });
    expect(entry?.conventions).toEqual(expect.arrayContaining(["bracket-object", "comma"]));
  });

  it("fields[type] reads as a named fieldset with no special-casing needed", () => {
    const entry = readOf("fields[articles]=title,body", "fields");
    expect(entry?.value).toEqual({ articles: ["title", "body"] });
  });

  it("page[*] reads as a plain nested object", () => {
    const entry = readOf("page[number]=2&page[size]=10", "page");
    expect(entry?.value).toEqual({ number: "2", size: "10" });
  });

  it("sort=-created,name reads direction per field", () => {
    const fields = sortFields(decodeParams("sort=-created,name"));
    expect(fields).toEqual([
      { field: "created", direction: "desc" },
      { field: "name", direction: "asc" },
    ]);
  });

  it("a single sort field with no leading - is ascending", () => {
    expect(sortFields(decodeParams("sort=name"))).toEqual([{ field: "name", direction: "asc" }]);
  });

  it("an unresolvable include or sort is left undefined, not silently treated as empty", () => {
    // `include=a&include[]=b` is a key-syntax conflict like `a=1&a[]=2` above.
    expect(includeTree(decodeParams("include=a&include[]=b"))).toBeUndefined();
    expect(sortFields(decodeParams("sort=a&sort[]=b"))).toBeUndefined();
  });
});

describe("decodeParams never throws", () => {
  it("survives malformed percent-encoding", () => {
    expect(() => decodeParams("a=%")).not.toThrow();
    expect(() => decodeParams("a=%zz")).not.toThrow();
  });

  it("reads an empty string, and a bare '?', as no parameters", () => {
    expect(decodeParams("").entries).toEqual([]);
    expect(decodeParams("?").entries).toEqual([]);
  });

  it("strips a single leading '?', for convenience with location.search", () => {
    expect(decodeParams("?a=1").entries).toEqual(decodeParams("a=1").entries);
  });

  it("survives an unterminated bracket", () => {
    expect(() => decodeParams("a[b=1")).not.toThrow();
  });

  it("a value assigned both directly and more deeply nested under the same key is kept, not dropped", () => {
    // `a[b]=1` beside `a[b][c]=2` — outside the spec's table; folded into an
    // object under a synthetic key rather than silently choosing one.
    expect(() => decodeParams("a[b]=1&a[b][c]=2")).not.toThrow();
    const entry = readOf("a[b]=1&a[b][c]=2", "a");
    expect(entry?.value).toEqual({ b: { "": "1", c: "2" } });
  });
});

describe("base64url-json does not misfire on ordinary short or non-JSON tokens", () => {
  it("a short numeric-looking value is read as plain text, not decoded", () => {
    const entry = readOf("a=12345", "a");
    expect(entry?.convention).toBe("plain");
    expect(entry?.value).toBe("12345");
  });

  it("an opaque token that happens to be valid base64url but not valid JSON stays plain", () => {
    const entry = readOf("token=dGVzdHRva2Vu", "token"); // decodes to the ASCII text "testtoken", not JSON
    expect(entry?.convention).toBe("plain");
  });
});

describe("hostile values are preserved exactly, never sanitised", () => {
  // This module produces no DOM and no HTML string, so it has no injection
  // surface of its own — but T2b will render whatever it hands back. The one
  // thing this decoder must never do is mangle a hostile value on the way
  // through; escaping happens exactly once, downstream, in T2b.
  it("keeps a hostile parameter name and a delimiter-free hostile value untouched, byte for byte", () => {
    const name = "<script>alert(1)</script>";
    const value = '"><img/src=x/onerror=alert(1)>'; // no comma, pipe or space -- nothing here is ambiguous
    const wire = `${encodeURIComponent(name)}=${encodeURIComponent(value)}`;
    const entry = findParam(decodeParams(wire), name);
    expect(entry?.value).toBe(value);
    expect(entry?.convention).toBe("plain");
    expect(entry?.name).toBe(name);
  });

  it("a hostile value containing spaces is still fully recoverable, even though it is read as space-delimited", () => {
    // A realistic multi-attribute XSS payload contains spaces, which this
    // decoder's own documented convention (`a=1%202` -> [1,2]) reads as a
    // delimiter — exactly as it would for a benign space-delimited list. The
    // guarantee this test is really after is narrower than "always plain":
    // nothing is ever silently discarded. The original string is always
    // findable, either as the chosen value or as a named alternative, and the
    // exact wire bytes are always available besides.
    const value = '"><img src=x onerror=alert(1)>';
    const wire = `a=${encodeURIComponent(value)}`;
    const entry = readOf(wire, "a");
    const everyReadingValue = [entry?.value, ...(entry?.alternatives.map((alt) => alt.value) ?? [])];
    expect(everyReadingValue).toContainEqual(value);
    expect(entry?.raw).toEqual([{ key: "a", value: encodeURIComponent(value) }]);
  });

  it("a javascript: URL as a value is kept as plain text — an href allowlist is T2b's job, not this module's to guess at", () => {
    const entry = readOf(`a=${encodeURIComponent("javascript:alert(1)")}`, "a");
    expect(entry?.value).toBe("javascript:alert(1)");
    expect(entry?.convention).toBe("plain");
  });
});

/**
 * Differential test against the platform's own `URLSearchParams` — the
 * cheapest high-value check available, since every T4 diagnostic is computed
 * from what this module decodes. Two halves, both asserted for a reason:
 * agreement on the cases where there is no genuine ambiguity (repeated keys,
 * ordinary percent-decoding), so a future change cannot silently break the
 * boring 90% of inputs; and *deliberate* disagreement on the cases this
 * module exists to read differently (comma/space/pipe lists, bracket
 * notation, base64url JSON, and the valueless/empty distinction), so a future
 * change that accidentally makes this module agree with `URLSearchParams` on
 * one of those fails loudly rather than looking like an improvement.
 */
describe("differential test against URLSearchParams", () => {
  it("agrees on repeated keys", () => {
    const wire = "a=1&a=2&a=3";
    expect(readOf(wire, "a")?.value).toEqual(new URLSearchParams(wire).getAll("a"));
  });

  it("agrees on ordinary percent-decoding, when the decoded value has nothing this module treats specially", () => {
    const wire = "a=caf%C3%A9"; // "café" -- no comma, pipe, space, brace or base64url shape
    expect(readOf(wire, "a")?.value).toBe(new URLSearchParams(wire).get("a"));
  });

  it("agrees on a literal percent-encoded delimiter-like character once it is not the actual delimiter", () => {
    const wire = "a=100%25"; // "100%" -- a literal percent sign, nothing to split on
    expect(readOf(wire, "a")?.value).toBe(new URLSearchParams(wire).get("a"));
  });

  it("agrees that a leading '?' is stripped", () => {
    const wire = "?a=1";
    expect(readOf(wire, "a")?.value).toBe(new URLSearchParams(wire).get("a"));
  });

  it("deliberately disagrees on a comma list -- the platform never splits, this module's alternative recovers its reading", () => {
    const wire = "a=1,2,3";
    const native = new URLSearchParams(wire).get("a");
    const entry = readOf(wire, "a");
    expect(entry?.value).not.toEqual(native);
    expect(entry?.alternatives.map((alt) => alt.value)).toContainEqual(native);
  });

  it("deliberately disagrees on a pipe/space list the same way", () => {
    for (const wire of ["a=1|2", "a=1+2"]) {
      const native = new URLSearchParams(wire).get("a");
      const entry = readOf(wire, "a");
      expect(entry?.value).not.toEqual(native);
      expect(entry?.alternatives.map((alt) => alt.value)).toContainEqual(native);
    }
  });

  it("deliberately disagrees on JSON-in-a-value and base64url JSON the same way", () => {
    for (const wire of ['a={"b":1}', "cursor=eyJvIjoyNX0"]) {
      const name = wire.startsWith("cursor") ? "cursor" : "a";
      const native = new URLSearchParams(wire).get(name);
      const entry = readOf(wire, name);
      expect(entry?.value).not.toEqual(native);
      expect(entry?.alternatives.map((alt) => alt.value)).toContainEqual(native);
    }
  });

  it("deliberately disagrees on bracket notation -- the platform treats it as one opaque literal key", () => {
    const wire = "a[b]=1";
    const native = new URLSearchParams(wire);
    expect(native.get("a[b]")).toBe("1"); // the platform's whole key is the literal text "a[b]"
    expect(native.get("a")).toBeNull(); // it has no notion of "a" as a structured container
    expect(readOf(wire, "a")?.value).toEqual({ b: "1" }); // this module reads the same text as {a: {b: "1"}}
    expect(findParam(decodeParams(wire), "a[b]")).toBeUndefined(); // and never produces a literal "a[b]" name
  });

  it("deliberately disagrees on valueless vs empty -- the platform collapses both to an empty string", () => {
    const empty = new URLSearchParams("a=");
    const valueless = new URLSearchParams("a");
    expect(empty.get("a")).toBe("");
    expect(valueless.get("a")).toBe(""); // indistinguishable on the platform -- both "" and both .has() === true
    expect(empty.has("a")).toBe(true);
    expect(valueless.has("a")).toBe(true);

    // This module keeps the distinction the spec explicitly asks for.
    expect(readOf("a=", "a")?.value).toBe("");
    expect(readOf("a", "a")?.value).toBeNull();
  });
});
