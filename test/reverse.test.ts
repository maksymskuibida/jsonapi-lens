import { describe, expect, it } from "vitest";
import { buildIndex, referencesTo } from "../src/parse.js";
import type { JsonObject } from "../src/types.js";

const doc = (value: unknown): JsonObject => value as JsonObject;

const sample = doc({
  data: [
    {
      type: "articles",
      id: "a1",
      relationships: {
        author: { data: { type: "people", id: "p1" } },
        comments: {
          data: [
            { type: "comments", id: "c1" },
            { type: "comments", id: "c2" },
          ],
        },
      },
    },
    {
      type: "articles",
      id: "a2",
      relationships: { author: { data: { type: "people", id: "p1" } } },
    },
  ],
  included: [
    { type: "people", id: "p1" },
    { type: "comments", id: "c1", relationships: { author: { data: { type: "people", id: "p1" } } } },
    { type: "comments", id: "c2", relationships: { author: { data: { type: "people", id: "p2" } } } },
  ],
});

describe("referencesTo", () => {
  it("finds every resource pointing at a target, with the relationship name", () => {
    const index = buildIndex(sample);
    const refs = referencesTo(index, "people", "p1")!;

    expect(refs).toHaveLength(3);
    expect(refs.map((r) => `${r.from.type}:${r.from.id}/${r.relationship}`).sort()).toEqual([
      "articles:a1/author",
      "articles:a2/author",
      "comments:c1/author",
    ]);
  });

  it("returns an empty list for a resource nothing points at", () => {
    const index = buildIndex(sample);
    expect(referencesTo(index, "articles", "a1")).toEqual([]);
  });

  it("also indexes pointers whose target is not in the document", () => {
    // `p2` is referenced but never sent, and asking about it still works.
    const index = buildIndex(sample);
    const refs = referencesTo(index, "people", "p2")!;
    expect(refs.map((r) => r.from.id)).toEqual(["c2"]);
  });

  it("is built once and cached on the index", () => {
    const index = buildIndex(sample);
    expect(index.reverse).toBeNull();
    referencesTo(index, "people", "p1");
    expect(index.reverse).not.toBeNull();
    const first = index.reverse;
    referencesTo(index, "people", "p1");
    expect(index.reverse).toBe(first);
  });

  it("counts one entry per pointer, so a repeated target appears twice", () => {
    const index = buildIndex(
      doc({
        data: {
          type: "articles",
          id: "a1",
          relationships: {
            comments: {
              data: [
                { type: "comments", id: "c1" },
                { type: "comments", id: "c1" },
              ],
            },
          },
        },
      }),
    );
    expect(referencesTo(index, "comments", "c1")).toHaveLength(2);
  });

  it("declines rather than stalling when a document has too many pointers", () => {
    const index = buildIndex(sample);
    // Simulate the cap that `buildIndex` sets for very large documents.
    index.reverseTooLarge = true;
    index.reverse = null;
    expect(referencesTo(index, "people", "p1")).toBeNull();
  });
});

describe("resource provenance", () => {
  it("records a JSON Pointer to where each resource came from", () => {
    const index = buildIndex(sample);
    expect(index.byKey.get("articles:a1")?.pointer).toBe("/data/0");
    expect(index.byKey.get("articles:a2")?.pointer).toBe("/data/1");
    expect(index.byKey.get("people:p1")?.pointer).toBe("/included/0");
    expect(index.byKey.get("comments:c2")?.pointer).toBe("/included/2");
  });

  it("uses /data for a single-resource document", () => {
    const index = buildIndex(doc({ data: { type: "articles", id: "a1" } }));
    expect(index.byKey.get("articles:a1")?.pointer).toBe("/data");
  });

  it("keeps a reference to the original resource object for the raw view", () => {
    const raw = { type: "articles", id: "a1", attributes: { title: "T" } };
    const index = buildIndex(doc({ data: raw }));
    // Identity, not a copy — this is what makes the raw view free.
    expect(index.byKey.get("articles:a1")?.raw).toBe(raw);
  });

  it("keeps the document root so pointers can be resolved later", () => {
    const root = doc({ data: { type: "articles", id: "a1" } });
    expect(buildIndex(root).root).toBe(root);
  });
});
