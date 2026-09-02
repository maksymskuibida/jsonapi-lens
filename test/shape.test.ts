import { describe, expect, it } from "vitest";
import { detectShape } from "../src/shape.js";

describe("detectShape", () => {
  it("reads a valid JSON:API document straight through, with no prompt implied", () => {
    const a = detectShape('{"data":{"type":"articles","id":"1"}}');
    expect(a.shape).toBe("jsonapi");
    expect(a.evidence).toEqual({ kind: "jsonapi-member", member: "data" });

    const b = detectShape('{"errors":[{"status":"404"}]}');
    expect(b.shape).toBe("jsonapi");
    expect(b.evidence).toEqual({ kind: "jsonapi-member", member: "errors" });

    const c = detectShape('{"meta":{"total":0}}');
    expect(c.shape).toBe("jsonapi");
    expect(c.evidence).toEqual({ kind: "jsonapi-member", member: "meta" });

    const d = detectShape('{"data":null}');
    expect(d.shape).toBe("jsonapi");

    const e = detectShape('{"data":[{"type":"a","id":"1"},{"type":"a","id":"2"}]}');
    expect(e.shape).toBe("jsonapi");

    const f = detectShape('{"data":[]}');
    expect(f.shape).toBe("jsonapi");
  });

  it("names an empty object plain, not an error", () => {
    const result = detectShape("{}");
    expect(result.shape).toBe("plain");
    expect(result.evidence).toEqual({ kind: "plain-empty-object" });
    expect(result.value).toEqual({});
  });

  it("names a bare array of objects a collection", () => {
    const result = detectShape('[{"id":1},{"id":2}]');
    expect(result.shape).toBe("collection");
    expect(result.evidence).toEqual({ kind: "collection-array", length: 2 });
  });

  it("names a bare array of scalars a collection too", () => {
    const result = detectShape("[1,2,3]");
    expect(result.shape).toBe("collection");
    expect(result.evidence).toEqual({ kind: "collection-array", length: 3 });
  });

  it("reads a bare scalar or null as plain, not an error", () => {
    expect(detectShape("42").shape).toBe("plain");
    expect(detectShape("42").value).toBe(42);
    expect(detectShape("null").shape).toBe("plain");
    expect(detectShape("null").value).toBeNull();
    expect(detectShape('"just text"').shape).toBe("plain");
  });

  it("names `{\"data\": 1}` an envelope rather than letting it through as jsonapi", () => {
    // The motivating bug: `assertJsonApi` accepts this today and `buildIndex`
    // renders zero resources with no explanation. `detectShape` must not
    // call this `jsonapi` at all.
    const result = detectShape('{"data": 1}');
    expect(result.shape).toBe("envelope");
    expect(result.evidence).toEqual({ kind: "envelope-shape" });
  });

  it("names `data` and `errors` together an envelope, still not jsonapi", () => {
    const result = detectShape('{"data": [{"type":"a","id":"1"}], "errors": []}');
    expect(result.shape).toBe("envelope");
    expect(result.evidence).toEqual({ kind: "envelope-conflict" });
  });

  it("recognises HAL by _links or _embedded", () => {
    const links = detectShape('{"_links":{"self":{"href":"https://example.com/x"}}}');
    expect(links.shape).toBe("hal");
    expect(links.evidence).toEqual({ kind: "hal-links" });

    const embedded = detectShape('{"_embedded":{"articles":[{"id":1},{"id":2}]}}');
    expect(embedded.shape).toBe("hal");
    expect(embedded.evidence).toEqual({ kind: "hal-embedded" });
  });

  it("recognises OData by @odata.context", () => {
    const result = detectShape(
      '{"@odata.context":"https://example.com/$metadata#Products","value":[{"id":1}]}',
    );
    expect(result.shape).toBe("odata");
    expect(result.evidence).toEqual({ kind: "odata-context" });
  });

  it("recognises JSON-RPC by the jsonrpc member", () => {
    const result = detectShape('{"jsonrpc":"2.0","result":{"ok":true},"id":1}');
    expect(result.shape).toBe("jsonrpc");
    expect(result.evidence).toEqual({ kind: "jsonrpc-member" });

    const errorResult = detectShape('{"jsonrpc":"2.0","error":{"code":-32600,"message":"bad"},"id":null}');
    expect(errorResult.shape).toBe("jsonrpc");
  });

  it("falls back to plain for an ordinary object with no recognised shape", () => {
    const result = detectShape('{"foo":"bar","baz":[1,2,3]}');
    expect(result.shape).toBe("plain");
    expect(result.evidence).toEqual({ kind: "plain-object" });
  });

  describe("NDJSON / JSON Lines", () => {
    it("reads a stream of JSON Lines as one collection of n records", () => {
      const result = detectShape('{"a":1}\n{"a":2}\n{"a":3}');
      expect(result.shape).toBe("ndjson");
      expect(result.evidence).toEqual({ kind: "ndjson-lines", records: 3, malformedLine: null });
      expect(result.value).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
    });

    it("tolerates a trailing newline", () => {
      const result = detectShape('{"a":1}\n{"a":2}\n');
      expect(result.shape).toBe("ndjson");
      expect(result.evidence).toEqual({ kind: "ndjson-lines", records: 2, malformedLine: null });
    });

    it("tolerates a blank line in the middle", () => {
      const result = detectShape('{"a":1}\n\n{"a":2}\n');
      expect(result.shape).toBe("ndjson");
      expect(result.evidence).toEqual({ kind: "ndjson-lines", records: 2, malformedLine: null });
    });

    it("reports a malformed line's number and reads the rest", () => {
      const result = detectShape('{"a":1}\nnot json\n{"a":3}');
      expect(result.shape).toBe("ndjson");
      expect(result.evidence).toEqual({ kind: "ndjson-lines", records: 2, malformedLine: 2 });
      expect(result.value).toEqual([{ a: 1 }, { a: 3 }]);
    });
  });

  it("never throws, even on unparseable text", () => {
    expect(() => detectShape("this is not json at all {{{")).not.toThrow();
    const result = detectShape("this is not json at all {{{");
    // `undefined`, not `null` — `null` is itself a legitimate parsed value
    // (see the "reads a bare scalar or null" case above), so it cannot also
    // stand for "nothing parsed" without conflating the two.
    expect(result.value).toBeUndefined();
  });

  it("never throws on empty or whitespace-only input", () => {
    expect(() => detectShape("")).not.toThrow();
    expect(() => detectShape("   \n\t  ")).not.toThrow();
    expect(detectShape("").value).toBeUndefined();
  });
});
