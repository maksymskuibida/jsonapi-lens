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
      expect(result.evidence).toEqual({
        kind: "ndjson-lines",
        records: 3,
        malformedLine: null,
        skipped: 0,
      });
      expect(result.value).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
    });

    it("tolerates a trailing newline", () => {
      const result = detectShape('{"a":1}\n{"a":2}\n');
      expect(result.shape).toBe("ndjson");
      expect(result.evidence).toEqual({
        kind: "ndjson-lines",
        records: 2,
        malformedLine: null,
        skipped: 0,
      });
    });

    it("tolerates a blank line in the middle", () => {
      const result = detectShape('{"a":1}\n\n{"a":2}\n');
      expect(result.shape).toBe("ndjson");
      expect(result.evidence).toEqual({
        kind: "ndjson-lines",
        records: 2,
        malformedLine: null,
        skipped: 0,
      });
    });

    it("reports a malformed line's number and reads the rest", () => {
      const result = detectShape('{"a":1}\nnot json\n{"a":3}');
      expect(result.shape).toBe("ndjson");
      expect(result.evidence).toEqual({
        kind: "ndjson-lines",
        records: 2,
        malformedLine: 2,
        skipped: 1,
      });
      expect(result.value).toEqual([{ a: 1 }, { a: 3 }]);
    });

    // Round 2 review, blocker (then): the NDJSON fallback tolerated any
    // number of malformed lines, so it could hijack a document that was
    // plainly meant to be read as one whole thing. Fixed then with
    // `records >= 2 && malformedCount <= 1` — which round 3's review showed
    // was the wrong axis: a count cannot tell "a broken document with a few
    // lines that happen to parse alone" from "a genuine stream with a few
    // bad lines," because both can produce the same count. Kept here,
    // unmodified fixtures, now gated on the round-3 rule instead (below):
    // the first non-blank line must parse.

    it("does not hijack a comma-broken JSON:API payload into a false NDJSON reading", () => {
      // The opener `{` on its own line fails to parse alone — that alone is
      // enough to reject this, regardless of how many later lines
      // (`{"type":"a","id":"2"}`, etc.) happen to stand alone as valid JSON.
      const result = detectShape(
        '{\n  "data": [\n    {"type":"a","id":"1"}\n    {"type":"a","id":"2"}\n  ]\n}',
      );
      expect(result.shape).toBe("plain");
      expect(result.evidence).toEqual({ kind: "plain-unparseable" });
      expect(result.value).toBeUndefined();
    });

    it("does not present a truncated array as a one-record stream, silently dropping the rest", () => {
      const result = detectShape("[\n1,\n2");
      expect(result.shape).toBe("plain");
      expect(result.evidence).toEqual({ kind: "plain-unparseable" });
    });

    // Round 3 review, blocker: the round-2 count-based gate
    // (`records >= 2 && malformedCount <= 1`) still let a broken document
    // through whenever enough of its fragments happened to parse alone on
    // their own line — and it introduced a new regression, refusing a large
    // legitimate log stream outright the moment it had more than one bad
    // line. Both are fixed by gating on the first non-blank line alone.

    it("does not read a truncated array with no commas as a multi-record NDJSON stream", () => {
      // `[` fails to parse alone; `1`, `2` and `3` each succeed. The old
      // count-based gate accepted this (3 records, 1 malformed line) even
      // though the document was plainly one truncated array, not a stream —
      // the opener is silently dropped with nothing reported.
      const result = detectShape("[\n1\n2\n3");
      expect(result.shape).toBe("plain");
      expect(result.evidence).toEqual({ kind: "plain-unparseable" });
    });

    it("does not silently drop the first resource of a comma-broken JSON:API array", () => {
      // The opener shares its line with the first resource this time —
      // `{"data":[{"type":"a","id":"1"}` fails to parse alone, but the two
      // resources after it each stand alone. The old gate accepted this as
      // "2 records" with resource "1" simply gone and nothing said about it;
      // gating on the first line catches this shape regardless of where the
      // opener falls relative to the first resource.
      const result = detectShape(
        '{"data":[{"type":"a","id":"1"}\n{"type":"a","id":"2"}\n{"type":"a","id":"3"}',
      );
      expect(result.shape).toBe("plain");
      expect(result.evidence).toEqual({ kind: "plain-unparseable" });
    });

    it("still reads a legitimate log stream with several bad lines, and says how many were dropped", () => {
      // The round-2 gate refused this outright once a second bad line
      // appeared (`malformedCount <= 1`), which is the opposite failure: a
      // real, multi-thousand-line NDJSON export with a couple of truncated
      // lines is the ordinary case, not a reason to refuse reading any of
      // it. The first line is a valid record, so this is accepted, and the
      // total skipped count is carried (not just the first bad line) so the
      // evidence can say how much was dropped.
      const result = detectShape('{"a":1}\nnope\n{"a":2}\nnope again\n{"a":3}');
      expect(result.shape).toBe("ndjson");
      expect(result.evidence).toEqual({
        kind: "ndjson-lines",
        records: 3,
        malformedLine: 2,
        skipped: 2,
      });
      expect(result.value).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
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
