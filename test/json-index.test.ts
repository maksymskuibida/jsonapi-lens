import { describe, expect, it } from "vitest";
import { buildJsonIndex, GLOBAL_IDENTITY_SCOPE, IDENTITY_NODE_LIMIT } from "../src/json-index.js";
import type { JsonValue } from "../src/types.js";

function collectionAt(pointer: string, index: ReturnType<typeof buildJsonIndex>) {
  return index.collections.find((c) => c.pointer === pointer);
}

describe("buildJsonIndex — collections", () => {
  it("finds an array of objects sharing a majority of their key names", () => {
    const index = buildJsonIndex(
      { users: [{ id: 1, name: "Ada" }, { id: 2, name: "Bob" }] } as JsonValue,
      "plain",
      { kind: "plain-object" },
    );
    const users = collectionAt("/users", index);
    expect(users).toBeDefined();
    expect(users?.topLevel).toBe(true);
    expect(users?.memberPointers).toEqual(["/users/0", "/users/1"]);
    expect(users?.label).toBe("users");
  });

  it("still counts a bare top-level array of scalars as one collection", () => {
    const index = buildJsonIndex([1, 2, 3] as JsonValue, "collection", {
      kind: "collection-array",
      length: 3,
    });
    expect(index.collections).toHaveLength(1);
    expect(index.collections[0]?.pointer).toBe("");
    expect(index.collections[0]?.memberPointers).toEqual(["/0", "/1", "/2"]);
    // "no identities" — nothing here matches an id-like key or a global shape.
    expect(index.identities).toEqual([]);
  });

  it("does not treat a two-element array of unrelated objects as a collection", () => {
    const index = buildJsonIndex(
      { pair: [{ a: 1, b: 2, c: 3 }, { x: "no", y: "shared", z: "keys" }] } as JsonValue,
      "plain",
      { kind: "plain-object" },
    );
    expect(collectionAt("/pair", index)).toBeUndefined();
  });

  it("does not promote a collection nested inside another collection's member to its own rail entry", () => {
    const index = buildJsonIndex(
      {
        orders: [
          { id: 1, items: [{ sku: "a", qty: 1 }, { sku: "b", qty: 2 }] },
          { id: 2, items: [{ sku: "c", qty: 3 }, { sku: "d", qty: 4 }] },
        ],
      } as JsonValue,
      "plain",
      { kind: "plain-object" },
    );
    const orders = collectionAt("/orders", index);
    expect(orders?.topLevel).toBe(true);
    const items0 = collectionAt("/orders/0/items", index);
    expect(items0).toBeDefined();
    expect(items0?.topLevel).toBe(false);

    const topLevelPointers = index.collections.filter((c) => c.topLevel).map((c) => c.pointer);
    expect(topLevelPointers).toEqual(["/orders"]);
  });
});

describe("buildJsonIndex — identity: the container-name rule", () => {
  it("links user_id: 42 to the users member that defines id: 42", () => {
    const index = buildJsonIndex(
      {
        users: [{ id: 1, name: "Ada" }, { id: 42, name: "Grace" }],
        orders: [{ id: 100, user_id: 42 }, { id: 101, user_id: 999 }],
      } as JsonValue,
      "plain",
      { kind: "plain-object" },
    );

    const resolved = index.referenceAt.get("/orders/0/user_id");
    expect(resolved).toEqual({
      resolution: "resolved",
      targetPointer: "/users/1",
      targetDomId: expect.stringMatching(/^n_/),
    });

    // The unmatched one is dangling, not silently ignored.
    expect(index.referenceAt.get("/orders/1/user_id")).toEqual({ resolution: "dangling" });
    expect(index.dangling).toContainEqual({ scope: "user", value: "999", count: 1 });
  });

  it("does not link user_id: 42 when the only id: 42 is in an orders collection", () => {
    const index = buildJsonIndex(
      {
        orders: [{ id: 42, total: 9.99 }, { id: 43, total: 5 }],
        shipments: [{ id: 1, user_id: 42 }, { id: 2, user_id: 43 }],
      } as JsonValue,
      "plain",
      { kind: "plain-object" },
    );

    // "42" is defined, just in the wrong scope — a wrong link is worse than
    // none, so this must be dangling rather than landing on /orders/0.
    expect(index.referenceAt.get("/shipments/0/user_id")).toEqual({ resolution: "dangling" });
    expect(index.referenceAt.get("/shipments/1/user_id")).toEqual({ resolution: "dangling" });
  });

  it("matches singular and plural container names", () => {
    const index = buildJsonIndex(
      { user: [{ id: 7, name: "solo" }], refs: [{ user_id: 7 }] } as JsonValue,
      "plain",
      { kind: "plain-object" },
    );
    expect(index.referenceAt.get("/refs/0/user_id")).toMatchObject({ resolution: "resolved" });
  });

  it("treats every bare id-like key as a definition, case- and separator-insensitively", () => {
    // Each of these objects defines its own identity at a *different* bare
    // key; a compound key elsewhere should still find each one by container
    // name alone, proving the bare-key set is `id, uuid, guid, key, code,
    // ref, slug` — not just `id` — regardless of case or a leading `_`.
    const index = buildJsonIndex(
      {
        widgets: [{ Uuid: "w-1", name: "a" }, { Uuid: "w-2", name: "b" }],
        gadgets: [{ _id: "g-1", name: "a" }, { _id: "g-2", name: "b" }],
        tools: [{ GUID: "t-1", name: "a" }, { GUID: "t-2", name: "b" }],
        parts: [{ CODE: "p-1", name: "a" }, { CODE: "p-2", name: "b" }],
        marks: [{ ref: "m-1", name: "a" }, { ref: "m-2", name: "b" }],
        pages: [{ slug: "s-1", name: "a" }, { slug: "s-2", name: "b" }],
        refs: [
          { widget_id: "w-1" },
          { gadget_id: "g-1" },
          { tool_id: "t-1" },
          { part_id: "p-1" },
          { mark_id: "m-1" },
          { page_id: "s-1" },
        ],
      } as JsonValue,
      "plain",
      { kind: "plain-object" },
    );

    expect(index.referenceAt.get("/refs/0/widget_id")).toMatchObject({ targetPointer: "/widgets/0" });
    expect(index.referenceAt.get("/refs/1/gadget_id")).toMatchObject({ targetPointer: "/gadgets/0" });
    expect(index.referenceAt.get("/refs/2/tool_id")).toMatchObject({ targetPointer: "/tools/0" });
    expect(index.referenceAt.get("/refs/3/part_id")).toMatchObject({ targetPointer: "/parts/0" });
    expect(index.referenceAt.get("/refs/4/mark_id")).toMatchObject({ targetPointer: "/marks/0" });
    expect(index.referenceAt.get("/refs/5/page_id")).toMatchObject({ targetPointer: "/pages/0" });
  });

  it("matches the plural *_ids / *Ids compound form", () => {
    const index = buildJsonIndex(
      {
        tags: [{ id: 1, name: "red" }, { id: 2, name: "blue" }],
        posts: [{ tag_ids: [1, 2] }],
      } as JsonValue,
      "plain",
      { kind: "plain-object" },
    );
    expect(index.referenceAt.get("/posts/0/tag_ids/0")).toMatchObject({ targetPointer: "/tags/0" });
    expect(index.referenceAt.get("/posts/0/tag_ids/1")).toMatchObject({ targetPointer: "/tags/1" });
  });
});

describe("buildJsonIndex — identity: a compound reference key needs a real boundary", () => {
  // Round 2 review, blocker: `referenceContainerName` used to normalise the
  // key (stripping `_`/`-`) *before* testing the `id` suffix, which destroys
  // the only evidence that tells `user_id` apart from an ordinary word that
  // happens to end in the letters "id". `valid`, `is_valid`, `paid`, `grid`,
  // `void`, `android`, `hybrid`, `fluid`, `rapid` and `solid` are all real
  // payload keys this must never treat as a reference.

  it("does not read an ordinary key ending in the letters id as a val_id-shaped reference", () => {
    const index = buildJsonIndex(
      { valid: 1, vals: [{ id: 1, x: 1 }, { id: 2, x: 2 }] } as JsonValue,
      "plain",
      { kind: "plain-object" },
    );
    // The old bug linked `/valid` straight to `/vals/0` — a wrong link, not
    // merely a miss, which is exactly what the spec calls worse than none.
    expect(index.referenceAt.get("/valid")).toBeUndefined();
    expect(index.dangling).toEqual([]);
  });

  it("does not turn is_valid into a dangling reference with a mangled scope", () => {
    const index = buildJsonIndex({ is_valid: 1, other: 1 } as JsonValue, "plain", {
      kind: "plain-object",
    });
    // The old bug put a phantom `isval` chip in the unresolved-pointers
    // panel for this ordinary, reference-free document.
    expect(index.referenceAt.size).toBe(0);
    expect(index.dangling).toEqual([]);
  });

  it("still recognises user_id, user-id, userId and userIDs as compound references", () => {
    const index = buildJsonIndex(
      {
        users: [{ id: 1, name: "a" }],
        a: [{ user_id: 1 }],
        b: [{ "user-id": 1 }],
        c: [{ userId: 1 }],
        d: [{ userIDs: [1] }],
      } as JsonValue,
      "plain",
      { kind: "plain-object" },
    );
    expect(index.referenceAt.get("/a/0/user_id")).toMatchObject({ resolution: "resolved" });
    expect(index.referenceAt.get("/b/0/user-id")).toMatchObject({ resolution: "resolved" });
    expect(index.referenceAt.get("/c/0/userId")).toMatchObject({ resolution: "resolved" });
    expect(index.referenceAt.get("/d/0/userIDs/0")).toMatchObject({ resolution: "resolved" });
  });

  it("still resolves a bare id-like key regardless of separator or case, unaffected by the boundary check", () => {
    // The boundary check only changes *compound*-key detection; a bare key
    // is intercepted earlier by `isBareIdKey` and must keep working exactly
    // as it always did.
    const index = buildJsonIndex(
      { widgets: [{ _id: "w-1" }], refs: [{ widget_id: "w-1" }] } as JsonValue,
      "plain",
      { kind: "plain-object" },
    );
    expect(index.referenceAt.get("/refs/0/widget_id")).toMatchObject({ targetPointer: "/widgets/0" });
  });
});

describe("buildJsonIndex — identity: no references means no identity, however many definitions", () => {
  // Round 2 review, blocker: the "a lone, unreferenced id is not an
  // identity" rule only fired when there was *exactly one* unreferenced
  // definition — two or more fell through to the ambiguity branch, so an
  // ordinary repeated value with nothing pointing at it anywhere (three
  // products all coded "USD") was reported as an ambiguous identity.

  it("does not report ambiguous for a repeated bare id-like value with zero references anywhere", () => {
    const index = buildJsonIndex(
      {
        products: [
          { code: "USD", price: 1 },
          { code: "USD", price: 2 },
          { code: "USD", price: 3 },
        ],
      } as JsonValue,
      "plain",
      { kind: "plain-object" },
    );
    expect(index.identities).toEqual([]);
    expect(index.counts.ambiguous).toBe(0);
    expect(index.definitionAt.size).toBe(0);
  });

  it("still reports ambiguous once something actually references the repeated value", () => {
    const index = buildJsonIndex(
      {
        products: [{ id: "USD", price: 1 }, { id: "USD", price: 2 }],
        orders: [{ product_id: "USD" }],
      } as JsonValue,
      "plain",
      { kind: "plain-object" },
    );
    expect(index.counts.ambiguous).toBe(1);
    expect(index.referenceAt.get("/orders/0/product_id")).toEqual({
      resolution: "ambiguous",
      candidates: 2,
    });
  });
});

describe("buildJsonIndex — identity: global (UUID/ULID/ObjectId) matching", () => {
  const UUID_A = "550e8400-e29b-41d4-a716-446655440000";
  const UUID_B = "660e8400-e29b-41d4-a716-446655440001";

  it("links a UUID referenced from an unrelated key, because it matches on value alone", () => {
    const index = buildJsonIndex(
      {
        widgets: [{ id: UUID_A, name: "Foo" }, { id: UUID_B, name: "Bar" }],
        logs: [{ note: "processed", reference: UUID_A }],
      } as JsonValue,
      "plain",
      { kind: "plain-object" },
    );

    const resolved = index.referenceAt.get("/logs/0/reference");
    expect(resolved).toMatchObject({ resolution: "resolved", targetPointer: "/widgets/0" });

    const definition = index.definitionAt.get("/widgets/0");
    expect(definition?.ambiguous).toBe(false);
  });

  it("uses the global scope, not a container name, for a UUID match", () => {
    // `mentioned_by` is deliberately neither a bare id-like key nor a
    // compound `*_id` one, so this occurrence is unambiguously a reference —
    // it is the UUID *shape* of the value, not the key, doing the matching.
    const index = buildJsonIndex(
      { things: [{ id: UUID_A, kind: "a" }], elsewhere: [{ mentioned_by: UUID_A }] } as JsonValue,
      "plain",
      { kind: "plain-object" },
    );
    const cluster = index.identities.find((i) => i.value === UUID_A);
    expect(cluster?.scope).toBe(GLOBAL_IDENTITY_SCOPE);
    expect(cluster?.resolution).toBe("resolved");
  });

  it("recognises a ULID and a 24-hex ObjectId, not only RFC 4122 UUIDs", () => {
    const ulid = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
    const objectId = "507f1f77bcf86cd799439011";
    const index = buildJsonIndex(
      {
        a: [{ id: ulid, x: 1 }],
        b: [{ mentioned_by: ulid }],
        c: [{ id: objectId, x: 1 }],
        d: [{ mentioned_by: objectId }],
      } as JsonValue,
      "plain",
      { kind: "plain-object" },
    );
    expect(index.referenceAt.get("/b/0/mentioned_by")).toMatchObject({ resolution: "resolved" });
    expect(index.referenceAt.get("/d/0/mentioned_by")).toMatchObject({ resolution: "resolved" });
  });
});

describe("buildJsonIndex — identity: ambiguity and skips", () => {
  it("marks two definitions of one identifier ambiguous, with no resolved target", () => {
    const index = buildJsonIndex(
      {
        users: [{ id: 42, name: "Alice" }, { id: 42, name: "Bob" }],
        logs: [{ user_id: 42 }],
      } as JsonValue,
      "plain",
      { kind: "plain-object" },
    );

    expect(index.referenceAt.get("/logs/0/user_id")).toEqual({ resolution: "ambiguous", candidates: 2 });
    expect(index.counts.ambiguous).toBe(1);
    const cluster = index.identities.find((i) => i.value === "42" && i.scope === "user");
    expect(cluster?.resolution).toBe("ambiguous");
    expect(cluster?.definitionPointers.sort()).toEqual(["/users/0", "/users/1"]);
  });

  it("does not treat a duplicate id/code pair on the same object as two definitions", () => {
    // One object offering two id-like views of itself is not the same thing
    // as two different objects claiming the same identity.
    const index = buildJsonIndex(
      {
        users: [{ id: 5, code: 5, name: "Ada" }],
        refs: [{ user_id: 5 }],
      } as JsonValue,
      "plain",
      { kind: "plain-object" },
    );
    expect(index.referenceAt.get("/refs/0/user_id")).toEqual({
      resolution: "resolved",
      targetPointer: "/users/0",
      targetDomId: expect.any(String),
    });
  });

  it("does not treat a lone, unreferenced id as an identity at all", () => {
    const index = buildJsonIndex({ users: [{ id: 1, name: "solo" }, { id: 2, name: "also" }] } as JsonValue, "plain", {
      kind: "plain-object",
    });
    expect(index.identities).toEqual([]);
    expect(index.dangling).toEqual([]);
  });

  it("does not treat an id whose value is an object or array as a candidate", () => {
    const index = buildJsonIndex(
      {
        a: [{ id: { nested: true }, name: "x" }, { id: [1, 2], name: "y" }],
        refs: [{ a_id: 1 }],
      } as JsonValue,
      "plain",
      { kind: "plain-object" },
    );
    // Nothing to resolve against — the object/array `id`s were never candidates.
    expect(index.referenceAt.get("/refs/0/a_id")).toEqual({ resolution: "dangling" });
  });

  it("keeps a numeric id separate from the same digits as a string", () => {
    const index = buildJsonIndex(
      { users: [{ id: 42, name: "number" }], strs: [{ id: "42", name: "string" }], refs: [{ user_id: 42 }] } as JsonValue,
      "plain",
      { kind: "plain-object" },
    );
    // Only the numeric 42 in `users` should resolve; a string "42" elsewhere
    // must not be conflated with it.
    expect(index.referenceAt.get("/refs/0/user_id")).toMatchObject({ targetPointer: "/users/0" });
  });
});

describe("buildJsonIndex — counts", () => {
  it("reports total and collections from top-level collections only", () => {
    const index = buildJsonIndex(
      { users: [{ id: 1 }, { id: 2 }, { id: 3 }], tags: [{ id: "a" }, { id: "b" }] } as JsonValue,
      "plain",
      { kind: "plain-object" },
    );
    expect(index.counts.total).toBe(5);
    expect(index.counts.collections).toBe(2);
  });

  it("counts dangling occurrences, not just distinct dangling values", () => {
    const index = buildJsonIndex(
      { refs: [{ user_id: 1 }, { user_id: 1 }, { user_id: 2 }] } as JsonValue,
      "plain",
      { kind: "plain-object" },
    );
    expect(index.counts.danglingDistinct).toBe(2);
    expect(index.counts.danglingTotal).toBe(3);
  });
});

describe("buildJsonIndex — scale and depth", () => {
  it("indexes a document 50,000 levels deep without a stack overflow", () => {
    // Round 2 review, suggestion: 250 levels does not discriminate an
    // iterative walk from a recursive one — a recursive implementation
    // clears 250 easily, so the test was not guarding the property it
    // exists for. 50,000 does not fit any JS engine's call stack, so this
    // only passes if the walk is genuinely a loop over an explicit stack,
    // not the call stack. Built as a JS object graph via a loop, never
    // through `JSON.stringify`/`JSON.parse` — `JSON.stringify` is itself
    // recursive and throws well before 50,000 levels, which would make this
    // test fail for a reason that has nothing to do with `buildJsonIndex`.
    let value: JsonValue = { id: 1, marker: "bottom" };
    for (let i = 0; i < 50_000; i++) value = { child: value };

    expect(() => buildJsonIndex(value, "plain", { kind: "plain-object" })).not.toThrow();
  });

  it("respects a node budget: over it, identity inference is skipped rather than stalling", () => {
    // A flat array of scalars is cheap to build and to walk — each element is
    // exactly one node, so this is comfortably over IDENTITY_NODE_LIMIT.
    const length = IDENTITY_NODE_LIMIT + 50_000;
    const big: JsonValue = Array.from({ length }, (_, i) => i);

    const index = buildJsonIndex(big, "collection", { kind: "collection-array", length });

    expect(index.identitySkipped).toBe(true);
    expect(index.identities).toEqual([]);
    expect(index.referenceAt.size).toBe(0);
    expect(index.definitionAt.size).toBe(0);
  });
});
