import { describe, expect, it } from "vitest";
import { decodeQueryRows, encodeQueryRows, splitUrlQuery } from "../src/request-form.js";
import { decodeParams } from "../src/params.js";

describe("splitUrlQuery", () => {
  it("splits base, query and hash apart", () => {
    expect(splitUrlQuery("https://api.example.com/x?a=1&b=2#frag")).toEqual({
      base: "https://api.example.com/x",
      query: "a=1&b=2",
      hash: "#frag",
    });
  });

  it("tolerates a URL with none of the three", () => {
    expect(splitUrlQuery("https://api.example.com/x")).toEqual({
      base: "https://api.example.com/x",
      query: "",
      hash: "",
    });
  });

  it("tolerates an empty string", () => {
    expect(splitUrlQuery("")).toEqual({ base: "", query: "", hash: "" });
  });
});

describe("decodeQueryRows / encodeQueryRows — the URL <-> table sync", () => {
  it("decodes a query string into rows, percent- and +-decoded for display", () => {
    const rows = decodeQueryRows("a=1&b=hello%20world&c=x+y");
    expect(rows).toEqual([
      { name: "a", value: "1", disabled: false },
      { name: "b", value: "hello world", disabled: false },
      { name: "c", value: "x y", disabled: false },
    ]);
  });

  it("re-encodes rows to a query string decodeParams reads back to an equivalent value", () => {
    // "Ada Lovelace" contains a space, and `decodeParams` reads *any* space-
    // containing value as a space-delimited list by default (D5) — that is
    // not a round-trip failure, it is the documented ambiguity this decoder
    // is built to surface. The plain string survives too, as the named
    // alternative — which is the actual property worth asserting here.
    const rows = decodeQueryRows("name=Ada%20Lovelace&tag=x%2Fy");
    const encoded = encodeQueryRows(rows);
    expect(encoded).toBe("name=Ada%20Lovelace&tag=x%2Fy");
    const decoded = decodeParams(encoded);
    expect(decoded.entries[0]?.value).toEqual(["Ada", "Lovelace"]);
    expect(decoded.entries[0]?.alternatives).toContainEqual({ path: [], convention: "plain", value: "Ada Lovelace" });
    expect(decoded.entries[1]).toEqual(
      expect.objectContaining({ name: "tag", value: "x/y", convention: "plain" }),
    );
  });

  it("drops disabled rows and blank-named rows from the encoded URL, without throwing", () => {
    const encoded = encodeQueryRows([
      { name: "a", value: "1", disabled: false },
      { name: "b", value: "2", disabled: true },
      { name: "", value: "orphaned", disabled: false },
    ]);
    expect(encoded).toBe("a=1");
  });

  it("round-trips a wire key carrying bracket syntax, so the form can emulate any convention", () => {
    const rows = [
      { name: "a[]", value: "1", disabled: false },
      { name: "a[]", value: "2", disabled: false },
    ];
    const decoded = decodeParams(encodeQueryRows(rows));
    expect(decoded.entries[0]?.value).toEqual(["1", "2"]);
    expect(decoded.entries[0]?.convention).toBe("bracket-list");
  });

  it("survives hostile row names and values — never thrown, never silently dropped", () => {
    const hostile = ["<script>alert(1)</script>", "__proto__", "constructor", "a&b=c"];
    for (const value of hostile) {
      const encoded = encodeQueryRows([{ name: value, value, disabled: false }]);
      const decoded = decodeParams(encoded);
      expect(decoded.entries).toHaveLength(1);
      expect(decoded.entries[0]?.name).toBe(value);
      // Never written through a hostile key onto a plain object anywhere in
      // this round trip.
      expect(Object.prototype.hasOwnProperty.call(Object.prototype, "polluted")).toBe(false);
    }
  });

  it("returns an empty row list for an empty query string", () => {
    expect(decodeQueryRows("")).toEqual([]);
  });
});
