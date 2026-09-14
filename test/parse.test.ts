import { describe, expect, it } from "vitest";
import { assertJsonApi, buildIndex, DocumentError, parseJson, readAny, readDocument } from "../src/parse.js";
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
    const index = buildIndex(doc({ data: { type: "articles", id: "1" } }));
    expect(index.counts.total).toBe(1);
    expect(index.primary).toEqual([{ type: "articles", id: "1" }]);
    expect(index.primaryIsNull).toBe(false);
    // A single resource is an object, so its pointer has no array index.
    expect(index.byKey.get("articles:1")?.pointer).toBe("/data");
  });

  it("keeps a single resource distinct from a one-element array", () => {
    const single = buildIndex(doc({ data: { type: "articles", id: "1" } }));
    const array = buildIndex(doc({ data: [{ type: "articles", id: "1" }] }));
    expect(single.counts.total).toBe(array.counts.total);
    expect(single.byKey.get("articles:1")?.pointer).toBe("/data");
    expect(array.byKey.get("articles:1")?.pointer).toBe("/data/0");
  });

  it("handles data as an array", () => {
    const index = buildIndex(doc({ data: [{ type: "articles", id: "1" }, { type: "articles", id: "2" }] }));
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
          { type: "articles", id: "1" },
          { type: "articles" },
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
        data: { type: "articles", id: "1" },
        included: [
          { type: "people", id: "s", attributes: { name: "First" } },
          { type: "people", id: "s", attributes: { name: "Second" } },
          { type: "people", id: "s", attributes: { name: "Third" } },
        ],
      }),
    );

    expect(index.counts.total).toBe(2);
    expect(index.counts.duplicates).toBe(2);

    const person = index.byKey.get(resourceKey("people", "s"));
    expect(person?.duplicated).toBe(true);
    // First occurrence wins, so the rendered attributes are predictable.
    expect(person?.attributes).toEqual({ name: "First" });

    const domIds = index.groups.flatMap((g) => g.resources.map((r) => r.domId));
    expect(new Set(domIds).size).toBe(domIds.length);
  });

  it("lets primary data win the origin label when it also appears in included", () => {
    const index = buildIndex(
      doc({
        included: [{ type: "articles", id: "1" }],
        data: { type: "articles", id: "1" },
      }),
    );
    // `data` is ingested first, so this checks the reverse order too.
    expect(index.byKey.get(resourceKey("articles", "1"))?.origin).toBe("data");
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
      type: "articles",
      id: "1",
      relationships: {
        comments: { data: [{ type: "comments", id: "a" }, { type: "comments", id: "missing" }] },
        author: { data: { type: "people", id: "gone" } },
        retraction: { data: null },
        revisions: { links: { related: "https://example.com/revisions" } },
      },
    },
    included: [{ type: "comments", id: "a" }],
  };

  it("distinguishes to-one, to-many, explicit null and absent linkage", () => {
    const index = buildIndex(doc(base));
    const article = index.byKey.get(resourceKey("articles", "1"))!;
    const kinds = Object.fromEntries(article.relationships.map((r) => [r.name, r.kind]));

    expect(kinds).toEqual({
      comments: "to-many",
      author: "to-one",
      retraction: "empty",
      revisions: "no-linkage",
    });
  });

  it("collects pointers that resolve to nothing", () => {
    const index = buildIndex(doc(base));
    expect(index.counts.danglingPointers).toBe(2);
    expect(index.dangling).toEqual([
      { type: "comments", id: "missing" },
      { type: "people", id: "gone" },
    ]);
    expect(index.byKey.get(resourceKey("articles", "1"))?.danglingCount).toBe(2);
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
    expect(index.byKey.get(resourceKey("comments", "a"))).toBeDefined();
    expect(index.byKey.get(resourceKey("comments", "missing"))).toBeUndefined();
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
        data: [{ type: "articles", id: "1" }],
        included: [
          { type: "people", id: "a" },
          { type: "people", id: "b" },
          { type: "people", id: "c" },
          { type: "tags", id: "f" },
        ],
      }),
    );
    expect(index.groups.map((g) => g.type)).toEqual(["articles", "people", "tags"]);
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
    const index = readDocument('{"data":{"type":"articles","id":"1"}}');
    expect(index.counts.total).toBe(1);
  });

  it("surfaces a DocumentError for bad input", () => {
    expect(() => readDocument("{ nope }")).toThrow(DocumentError);
    expect(() => readDocument('{"results":[]}')).toThrow(DocumentError);
  });
});

describe("readAny — the branch out of assertJsonApi", () => {
  it("reads a valid JSON:API document exactly as readDocument would — same index, no regression", () => {
    const text = '{"data":{"type":"articles","id":"1"},"included":[{"type":"people","id":"9"}]}';
    const lens = readAny(text);
    expect(lens.kind).toBe("jsonapi");
    if (lens.kind !== "jsonapi") throw new Error("unreachable");
    expect(lens.index).toEqual(readDocument(text));
  });

  it("reads {\"data\": 1} as plain JSON rather than a mostly-empty JSON:API document", () => {
    const lens = readAny('{"data": 1}');
    expect(lens.kind).toBe("json");
    if (lens.kind !== "json") throw new Error("unreachable");
    expect(lens.index.shape).toBe("envelope");
    // `root` is the whole document, not just its `data` member — same as
    // `DocumentIndex.root` for the JSON:API path.
    expect(lens.index.root).toEqual({ data: 1 });
  });

  it("reads a bare array as plain JSON rather than throwing", () => {
    const lens = readAny('[{"type":"a"},{"type":"b"}]');
    expect(lens.kind).toBe("json");
    if (lens.kind !== "json") throw new Error("unreachable");
    expect(lens.index.shape).toBe("collection");
  });

  it("reads an NDJSON stream as plain JSON rather than throwing", () => {
    const lens = readAny('{"a":1}\n{"a":2}\n{"a":3}\n');
    expect(lens.kind).toBe("json");
    if (lens.kind !== "json") throw new Error("unreachable");
    expect(lens.index.shape).toBe("ndjson");
    expect(lens.index.root).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
  });

  it("still refuses data and errors together as jsonapi, but reads it as plain JSON", () => {
    const lens = readAny('{"data": {"type":"a","id":"1"}, "errors": []}');
    expect(lens.kind).toBe("json");
    if (lens.kind !== "json") throw new Error("unreachable");
    expect(lens.index.shape).toBe("envelope");
    // The strict path still rejects it exactly as before — the escape hatch
    // ("Read as JSON:API anyway") reproduces that rejection rather than
    // silently accepting it.
    expect(() => readDocument('{"data": {"type":"a","id":"1"}, "errors": []}')).toThrow(
      /both `data` and `errors`/,
    );
  });

  it("surfaces the same DocumentError as parseJson for genuinely unparseable text", () => {
    expect(() => readAny("{ nope }")).toThrow(DocumentError);
    expect(() => readAny("not json at all {{{")).toThrow(DocumentError);
  });

  it("reads a bare scalar or null without throwing", () => {
    expect(readAny("42").kind).toBe("json");
    expect(readAny("null").kind).toBe("json");
    const nullLens = readAny("null");
    if (nullLens.kind !== "json") throw new Error("unreachable");
    expect(nullLens.index.root).toBeNull();
  });

  it("is deterministic — the same text produces an equivalent index every time", () => {
    // This is the property the "saved and reopened" round trip actually
    // depends on: store.ts persists the raw text and reindexes on load (see
    // its own header comment), so a plain-JSON document surviving a reload is
    // exactly this, re-run.
    const text = '{"users":[{"id":1,"name":"Ada"},{"id":2,"name":"Grace"}],"posts":[{"id":10,"user_id":2}]}';
    const first = readAny(text);
    const second = readAny(text);
    expect(first.kind).toBe("json");
    expect(second.kind).toBe("json");
    if (first.kind !== "json" || second.kind !== "json") throw new Error("unreachable");
    expect(second.index.shape).toBe(first.index.shape);
    expect(second.index.counts).toEqual(first.index.counts);
    expect(second.index.collections.map((c) => c.pointer)).toEqual(
      first.index.collections.map((c) => c.pointer),
    );
    expect([...second.index.referenceAt.entries()]).toEqual([...first.index.referenceAt.entries()]);
  });
});
