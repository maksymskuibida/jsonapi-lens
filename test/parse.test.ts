import { describe, expect, it } from "vitest";
import { assertJsonApi, buildIndex, DocumentError, parseJson, readDocument } from "../src/parse.js";
import { resourceKey } from "../src/ident.js";
import type { JsonObject } from "../src/types.js";

const doc = (value: unknown): JsonObject => value as JsonObject;

describe("parseJson", () => {
  it("names an empty paste rather than throwing a syntax error", () => {
    expect(() => parseJson("   ")).toThrow(DocumentError);
    expect(() => parseJson("")).toThrow(/Nothing to parse/);
  });

  it("recognises a Python dict repr", () => {
    expect(() => parseJson("{'data': None}")).toThrow(/Python dict/);
  });

  it("recognises a log line pasted with its prefix", () => {
    expect(() => parseJson('INFO provider response {"data": []}')).toThrow(/does not start like JSON/);
  });

  it("reports a line number for a syntax error", () => {
    let caught: DocumentError | undefined;
    try {
      parseJson('{\n  "data": [\n    { "type": "a" ,, }\n  ]\n}');
    } catch (error) {
      caught = error as DocumentError;
    }
    expect(caught).toBeInstanceOf(DocumentError);
    expect(caught?.line).toBeGreaterThan(1);
  });

  it("parses a valid document", () => {
    expect(parseJson('{"data":null}')).toEqual({ data: null });
  });
});

describe("assertJsonApi", () => {
  it("accepts data, errors or meta alone", () => {
    expect(assertJsonApi({ data: null })).toBeTruthy();
    expect(assertJsonApi({ errors: [] })).toBeTruthy();
    expect(assertJsonApi({ meta: {} })).toBeTruthy();
  });

  it("accepts data that is explicitly null", () => {
    // Presence must be tested with `in`, not truthiness.
    expect(() => assertJsonApi({ data: null })).not.toThrow();
  });

  it("rejects a bare array with a fix", () => {
    expect(() => assertJsonApi([] as never)).toThrow(/bare JSON array/);
  });

  it("rejects a doubly-encoded payload", () => {
    expect(() => assertJsonApi('{"data":[]}' as never)).toThrow(/encoded twice/);
  });

  it("rejects valid JSON that is not JSON:API, naming the keys it did find", () => {
    let message = "";
    try {
      assertJsonApi({ results: [], page: 1 });
    } catch (error) {
      message = (error as DocumentError).hint;
    }
    expect(message).toContain("`results`");
    expect(message).toContain("`page`");
  });

  it("rejects data and errors together", () => {
    expect(() => assertJsonApi({ data: [], errors: [] })).toThrow(/both `data` and `errors`/);
  });

  it("names an empty object", () => {
    expect(() => assertJsonApi({})).toThrow(/object is empty/);
  });
});

describe("buildIndex — document shapes", () => {
  it("handles data as a single resource", () => {
    const index = buildIndex(doc({ data: { type: "trips", id: "1" } }));
    expect(index.counts.total).toBe(1);
    expect(index.primary).toEqual([{ type: "trips", id: "1" }]);
    expect(index.primaryIsNull).toBe(false);
  });

  it("handles data as an array", () => {
    const index = buildIndex(doc({ data: [{ type: "trips", id: "1" }, { type: "trips", id: "2" }] }));
    expect(index.counts.total).toBe(2);
    expect(index.primary).toHaveLength(2);
  });

  it("handles data as null", () => {
    const index = buildIndex(doc({ data: null }));
    expect(index.counts.total).toBe(0);
    expect(index.primaryIsNull).toBe(true);
    expect(index.primary).toEqual([]);
  });

  it("handles an errors-only document", () => {
    const index = buildIndex(doc({ errors: [{ status: "422", title: "Nope" }] }));
    expect(index.errors).toHaveLength(1);
    expect(index.counts.total).toBe(0);
    expect(index.groups).toEqual([]);
  });

  it("handles a meta-only document", () => {
    const index = buildIndex(doc({ meta: { total: 0 } }));
    expect(index.meta).toEqual({ total: 0 });
    expect(index.counts.total).toBe(0);
  });

  it("ignores malformed entries instead of failing the whole document", () => {
    const index = buildIndex(
      doc({
        data: [
          { type: "trips", id: "1" },
          { type: "trips" },
          { id: "no-type" },
          null,
          "string",
          42,
        ],
      }),
    );
    expect(index.counts.total).toBe(1);
  });

  it("ignores a non-array included", () => {
    const index = buildIndex(doc({ data: [], included: { type: "x", id: "1" } }));
    expect(index.counts.total).toBe(0);
  });
});

describe("buildIndex — identity", () => {
  it("dedupes repeated type:id so DOM ids stay unique", () => {
    const index = buildIndex(
      doc({
        data: { type: "trips", id: "1" },
        included: [
          { type: "stations", id: "s", attributes: { name: "First" } },
          { type: "stations", id: "s", attributes: { name: "Second" } },
          { type: "stations", id: "s", attributes: { name: "Third" } },
        ],
      }),
    );

    expect(index.counts.total).toBe(2);
    expect(index.counts.duplicates).toBe(2);

    const station = index.byKey.get(resourceKey("stations", "s"));
    expect(station?.duplicated).toBe(true);
    // First occurrence wins, so the rendered attributes are predictable.
    expect(station?.attributes).toEqual({ name: "First" });

    const domIds = index.groups.flatMap((g) => g.resources.map((r) => r.domId));
    expect(new Set(domIds).size).toBe(domIds.length);
  });

  it("lets primary data win the origin label when it also appears in included", () => {
    const index = buildIndex(
      doc({
        included: [{ type: "trips", id: "1" }],
        data: { type: "trips", id: "1" },
      }),
    );
    // `data` is ingested first, so this checks the reverse order too.
    expect(index.byKey.get(resourceKey("trips", "1"))?.origin).toBe("data");
  });

  it("treats identical ids under different types as distinct", () => {
    const index = buildIndex(
      doc({ data: [{ type: "a", id: "1" }, { type: "b", id: "1" }] }),
    );
    expect(index.counts.total).toBe(2);
    expect(index.counts.duplicates).toBe(0);
  });
});

describe("buildIndex — relationships", () => {
  const base = {
    data: {
      type: "trips",
      id: "1",
      relationships: {
        segments: { data: [{ type: "segments", id: "a" }, { type: "segments", id: "missing" }] },
        carrier: { data: { type: "carriers", id: "gone" } },
        booking: { data: null },
        seat_map: { links: { related: "https://example.com/seat-map" } },
      },
    },
    included: [{ type: "segments", id: "a" }],
  };

  it("distinguishes to-one, to-many, explicit null and absent linkage", () => {
    const index = buildIndex(doc(base));
    const trip = index.byKey.get(resourceKey("trips", "1"))!;
    const kinds = Object.fromEntries(trip.relationships.map((r) => [r.name, r.kind]));

    expect(kinds).toEqual({
      segments: "to-many",
      carrier: "to-one",
      booking: "empty",
      seat_map: "no-linkage",
    });
  });

  it("collects pointers that resolve to nothing", () => {
    const index = buildIndex(doc(base));
    expect(index.counts.danglingPointers).toBe(2);
    expect(index.dangling).toEqual([
      { type: "segments", id: "missing" },
      { type: "carriers", id: "gone" },
    ]);
    expect(index.byKey.get(resourceKey("trips", "1"))?.danglingCount).toBe(2);
  });

  it("counts a repeated dangling pointer once in the distinct list", () => {
    const index = buildIndex(
      doc({
        data: [
          { type: "a", id: "1", relationships: { x: { data: { type: "z", id: "gone" } } } },
          { type: "a", id: "2", relationships: { x: { data: { type: "z", id: "gone" } } } },
        ],
      }),
    );
    expect(index.counts.danglingPointers).toBe(2);
    expect(index.dangling).toHaveLength(1);
  });

  it("resolves relationships in O(1) through byKey", () => {
    const index = buildIndex(doc(base));
    expect(index.byKey.get(resourceKey("segments", "a"))).toBeDefined();
    expect(index.byKey.get(resourceKey("segments", "missing"))).toBeUndefined();
  });

  it("keeps relationship links and meta", () => {
    const index = buildIndex(
      doc({
        data: {
          type: "a",
          id: "1",
          relationships: {
            r: { data: [], links: { related: "https://example.com" }, meta: { count: 0 } },
          },
        },
      }),
    );
    const rel = index.byKey.get(resourceKey("a", "1"))!.relationships[0]!;
    expect(rel.links).toEqual({ related: "https://example.com" });
    expect(rel.meta).toEqual({ count: 0 });
  });

  it("ignores a relationships member that is not an object", () => {
    const index = buildIndex(doc({ data: { type: "a", id: "1", relationships: "nope" } }));
    expect(index.byKey.get(resourceKey("a", "1"))?.relationships).toEqual([]);
  });
});

describe("buildIndex — grouping", () => {
  it("puts primary-data types first, then orders by count", () => {
    const index = buildIndex(
      doc({
        data: [{ type: "trips", id: "1" }],
        included: [
          { type: "stations", id: "a" },
          { type: "stations", id: "b" },
          { type: "stations", id: "c" },
          { type: "fares", id: "f" },
        ],
      }),
    );
    expect(index.groups.map((g) => g.type)).toEqual(["trips", "stations", "fares"]);
  });

  it("keeps document order within a group", () => {
    const index = buildIndex(
      doc({ included: [{ type: "a", id: "3" }, { type: "a", id: "1" }, { type: "a", id: "2" }] }),
    );
    expect(index.groups[0]!.resources.map((r) => r.id)).toEqual(["3", "1", "2"]);
  });
});

describe("readDocument", () => {
  it("goes from text to index", () => {
    const index = readDocument('{"data":{"type":"trips","id":"1"}}');
    expect(index.counts.total).toBe(1);
  });

  it("surfaces a DocumentError for bad input", () => {
    expect(() => readDocument("{ nope }")).toThrow(DocumentError);
    expect(() => readDocument('{"results":[]}')).toThrow(DocumentError);
  });
});
