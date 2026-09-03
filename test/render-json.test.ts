import { afterEach, describe, expect, it } from "vitest";
import { nodeDomId } from "../src/ident.js";
import { buildJsonIndex } from "../src/json-index.js";
import { buildIndex } from "../src/parse.js";
import { EAGER_BODY_LIMIT, librarySummary } from "../src/render-document.js";
import { buildAnnotations, renderJsonGroups, renderJsonLeftover } from "../src/render-json.js";
import type { JsonObject, JsonValue } from "../src/types.js";

const doc = (value: unknown): JsonObject => value as JsonObject;

// Anchor ids are deterministic (derived from a pointer alone), so a host left
// in `document.body` by a test that threw before its own cleanup can shadow
// `getElementById` lookups in a later test that happens to reuse the same
// pointer. Cleaning up after every test, pass or fail, is what keeps one
// failure from cascading into confusing failures elsewhere in this file.
afterEach(() => {
  document.body.replaceChildren();
});

function mount(node: Node): HTMLDivElement {
  const host = document.createElement("div");
  host.append(node);
  document.body.append(host);
  return host;
}

describe("plain-JSON rendering — identity links", () => {
  it("renders a resolved reference as an <a> whose target element exists in the DOM", () => {
    const index = buildJsonIndex(
      {
        users: [{ id: 1, name: "Ada" }, { id: 42, name: "Grace" }],
        orders: [{ id: 100, user_id: 42 }, { id: 101, user_id: 7 }],
      } as JsonValue,
      "plain",
      { kind: "plain-object" },
    );
    const annotations = buildAnnotations(index);
    const host = mount(renderJsonGroups(index, annotations));

    const definition = index.definitionAt.get("/users/1")!;
    expect(definition).toBeDefined();

    const link = host.querySelector<HTMLAnchorElement>(`a[href="#${definition.domId}"]`);
    expect(link).not.toBeNull();
    expect(link?.tagName).toBe("A");

    const target = document.getElementById(definition.domId);
    expect(target).not.toBeNull();
    expect(host.contains(target)).toBe(true);
  });

  it("shows a dangling reference as absent text, not a link", () => {
    const index = buildJsonIndex(
      { orders: [{ id: 1, user_id: 999 }, { id: 2, user_id: 1000 }] } as JsonValue,
      "plain",
      { kind: "plain-object" },
    );
    const annotations = buildAnnotations(index);
    const host = mount(renderJsonGroups(index, annotations));

    const danglingSpans = host.querySelectorAll(".v--ref-dangling");
    expect(danglingSpans.length).toBe(2);
    for (const span of danglingSpans) {
      expect(span.tagName).toBe("SPAN");
      expect((span as HTMLElement).hasAttribute("href")).toBe(false);
    }
    expect(host.querySelectorAll("a.v--ref").length).toBe(0);
  });

  it("shows an ambiguous reference as text, never as a link", () => {
    const index = buildJsonIndex(
      {
        users: [{ id: 42, name: "Alice" }, { id: 42, name: "Bob" }],
        logs: [{ user_id: 42 }, { user_id: 43 }],
      } as JsonValue,
      "plain",
      { kind: "plain-object" },
    );
    const annotations = buildAnnotations(index);
    const host = mount(renderJsonGroups(index, annotations));

    const ambiguous = host.querySelectorAll(".v--ref-ambiguous");
    expect(ambiguous.length).toBe(1);
    expect(ambiguous[0]?.tagName).toBe("SPAN");
    expect(ambiguous[0]?.textContent).toBe("42");
    expect(host.querySelectorAll("a.v--ref").length).toBe(0);
  });

  it("anchors a definition that is not itself a collection member, and resolves a reference to it", () => {
    // Round 2 review, mutation-testing gap: every fixture above already had
    // its definition sitting on a collection member, so `memberPointers`
    // alone made it anchorable — the one line in `buildAnnotations` that adds
    // *every* `definitionAt` pointer, not just collection members, was never
    // actually exercised (deleting it left every existing test in this file
    // green). `theme` here is a plain nested object, not an array member of
    // anything, so only that line can anchor it.
    const index = buildJsonIndex(
      { settings: { theme: { id: 4, name: "dark" } }, theme_id: 4 } as JsonValue,
      "plain",
      { kind: "plain-object" },
    );
    const definition = index.definitionAt.get("/settings/theme");
    expect(definition).toBeDefined();
    expect(index.referenceAt.get("/theme_id")).toMatchObject({
      resolution: "resolved",
      targetPointer: "/settings/theme",
    });

    const annotations = buildAnnotations(index);
    const leftover = renderJsonLeftover(index, annotations);
    expect(leftover).not.toBeNull();
    const host = mount(leftover!);

    const link = host.querySelector<HTMLAnchorElement>(`a[href="#${definition!.domId}"]`);
    expect(link).not.toBeNull();
    const target = document.getElementById(definition!.domId);
    expect(target).not.toBeNull();
    expect(host.contains(target)).toBe(true);

    // The DOM precondition the round-2 blocker (a dead anchor at depth ≥ 2)
    // depends on: `AUTO_OPEN_DEPTH` keeps only the first level open, so a
    // definition nested this deep renders inside a *closed* `<details>` —
    // the old `main.ts#resolveHash` only ever opened a `.res` section, so a
    // plain-JSON target like this one stayed closed no matter how the link
    // that pointed at it was reached. `main.ts` has no vitest harness (see
    // `docs/test-plans/T1.md`), so the fix itself — opening every ancestor,
    // not just a `.res` — is verified by hand in `docs/evidence/T1.md`; this
    // asserts the shape the fix has to work with.
    expect(target?.tagName).toBe("DETAILS");
    expect((target as HTMLDetailsElement).open).toBe(false);
  });
});

describe("plain-JSON rendering — a reference past EAGER_BODY_LIMIT is not a dead link", () => {
  it("renders a reference within the eager limit as a real link, and one past it as inert text", () => {
    // Round 2 review blocker: `renderJsonGroup` only builds a collection's
    // first `EAGER_BODY_LIMIT` members, but `buildJsonIndex` resolves a
    // reference to *any* definition regardless of its member index — so a
    // reference into the truncated tail used to render `<a href="#…">` with
    // no element anywhere in the document carrying that id: a link that
    // silently does nothing, which is exactly what the spec's "a reference …
    // is an `<a>` whose target element exists in the DOM" forbids.
    const total = EAGER_BODY_LIMIT + 20;
    const withinIndex = EAGER_BODY_LIMIT - 5;
    const pastIndex = EAGER_BODY_LIMIT + 10;
    const users = Array.from({ length: total }, (_, i) => ({ id: i, name: `user ${i}` }));
    const index = buildJsonIndex(
      { users, refs: [{ user_id: withinIndex }, { user_id: pastIndex }] } as JsonValue,
      "plain",
      { kind: "plain-object" },
    );

    // The identity graph itself still calls both of these "resolved" — the
    // render-time cap is a presentation seam, not an identity fact. See
    // `render-json.ts#buildAnnotations`'s comment on `targetIsRendered`.
    expect(index.referenceAt.get("/refs/0/user_id")).toMatchObject({
      resolution: "resolved",
      targetPointer: `/users/${withinIndex}`,
    });
    expect(index.referenceAt.get("/refs/1/user_id")).toMatchObject({
      resolution: "resolved",
      targetPointer: `/users/${pastIndex}`,
    });

    const annotations = buildAnnotations(index);
    const host = mount(renderJsonGroups(index, annotations));

    const withinCell = host.querySelector(`dd[data-pointer="/refs/0/user_id"]`);
    expect(withinCell).not.toBeNull();
    const link = withinCell!.querySelector<HTMLAnchorElement>("a.v--ref");
    expect(link).not.toBeNull();
    const targetId = link!.getAttribute("href")!.slice(1);
    expect(document.getElementById(targetId)).not.toBeNull();

    const pastCell = host.querySelector(`dd[data-pointer="/refs/1/user_id"]`);
    expect(pastCell).not.toBeNull();
    expect(pastCell!.querySelector("a")).toBeNull();
    const inert = pastCell!.querySelector(".v--ref-unrendered");
    expect(inert).not.toBeNull();
    expect(inert?.textContent).toBe(String(pastIndex));

    // Not merely "not a link" — genuinely nothing to land on, which is the
    // actual defect: the truncated member's own anchor id has no element in
    // the document at all.
    expect(document.getElementById(nodeDomId(`/users/${pastIndex}`))).toBeNull();
  });

  it("also catches a definition nested inside a truncated member, not only at the member's own pointer", () => {
    // A definition need not sit directly on the member object — it can be
    // several levels inside it (`{orders: [{detail: {sub: {id: …}}}, …]}`
    // defines at `/orders/i/detail/sub`, not at `/orders/i`). The whole
    // member subtree is unrendered together once its own index is past the
    // cut, so the check has to walk up from the *target*'s pointer to find
    // which top-level collection (and which member index) encloses it —
    // not just compare the target against a literal member-pointer string.
    const total = EAGER_BODY_LIMIT + 20;
    const withinIndex = 5;
    const pastIndex = EAGER_BODY_LIMIT + 10;
    const orders = Array.from({ length: total }, (_, i) => ({
      id: i,
      detail: { sub: { id: `s${i}` } },
    }));
    const index = buildJsonIndex(
      {
        orders,
        refs: [{ sub_id: `s${withinIndex}` }, { sub_id: `s${pastIndex}` }],
      } as JsonValue,
      "plain",
      { kind: "plain-object" },
    );

    expect(index.referenceAt.get("/refs/0/sub_id")).toMatchObject({
      resolution: "resolved",
      targetPointer: `/orders/${withinIndex}/detail/sub`,
    });
    expect(index.referenceAt.get("/refs/1/sub_id")).toMatchObject({
      resolution: "resolved",
      targetPointer: `/orders/${pastIndex}/detail/sub`,
    });

    const annotations = buildAnnotations(index);
    const host = mount(renderJsonGroups(index, annotations));

    const withinCell = host.querySelector(`dd[data-pointer="/refs/0/sub_id"]`);
    expect(withinCell!.querySelector("a.v--ref")).not.toBeNull();

    const pastCell = host.querySelector(`dd[data-pointer="/refs/1/sub_id"]`);
    expect(pastCell!.querySelector("a")).toBeNull();
    expect(pastCell!.querySelector(".v--ref-unrendered")).not.toBeNull();
    expect(document.getElementById(nodeDomId(`/orders/${pastIndex}/detail/sub`))).toBeNull();
  });
});

describe("plain-JSON rendering — collections and anchors", () => {
  it("anchors a collection and each of its members", () => {
    const index = buildJsonIndex(
      { users: [{ id: 1, name: "a" }, { id: 2, name: "b" }] } as JsonValue,
      "plain",
      { kind: "plain-object" },
    );
    const annotations = buildAnnotations(index);
    const host = mount(renderJsonGroups(index, annotations));

    const collection = index.collections.find((c) => c.pointer === "/users")!;
    expect(document.getElementById(collection.domId)).not.toBeNull();
    expect(collection.memberPointers).toHaveLength(2);

    // Every member row carries a real, resolvable anchor id of its own.
    const rows = host.querySelectorAll(".node-row");
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const anchored = row.querySelector<HTMLElement>("[id]");
      expect(anchored).not.toBeNull();
      expect(document.getElementById(anchored!.id)).toBe(anchored);
    }
  });

  it("does not render a top-level collection twice when it also appears in the leftover tree", () => {
    const index = buildJsonIndex(
      { data: { users: [{ id: 1, name: "Ada" }, { id: 2, name: "Grace" }] } } as JsonValue,
      "plain",
      { kind: "plain-object" },
    );
    const annotations = buildAnnotations(index);
    const host = mount(document.createElement("div"));
    host.append(renderJsonGroups(index, annotations));
    const leftover = renderJsonLeftover(index, annotations);
    if (leftover) host.append(leftover);

    const collection = index.collections.find((c) => c.pointer === "/data/users")!;
    expect(collection.topLevel).toBe(true);

    // The collection's own anchor id must exist exactly once — a duplicate id
    // would silently break every link to it.
    expect(host.querySelectorAll(`#${collection.domId}`).length).toBe(1);
    // Its members render exactly once too: two rows, not four.
    expect(host.querySelectorAll(".node-row")).toHaveLength(2);
    // The leftover tree shows a cross-reference for `/data/users` rather than
    // expanding it inline a second time.
    expect(host.querySelector(".v--collapsed-ref")).not.toBeNull();
  });
});

describe("plain-JSON rendering — hostile values", () => {
  it("keeps a hostile attribute value as text, never as markup", () => {
    const index = buildJsonIndex(
      {
        items: [
          { id: 1, note: "<img src=x onerror=alert(1)>" },
          { id: 2, note: '"><script>alert(1)</script>' },
        ],
      } as JsonValue,
      "plain",
      { kind: "plain-object" },
    );
    const annotations = buildAnnotations(index);
    const host = mount(renderJsonGroups(index, annotations));

    expect(host.querySelector("script")).toBeNull();
    expect(host.querySelector("img")).toBeNull();
    expect(host.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(host.textContent).toContain('"><script>alert(1)</script>');
  });

  it("keeps a hostile identity value as link text, never breaking out of the <a>", () => {
    const hostile = "<img src=x onerror=alert(1)>";
    const index = buildJsonIndex(
      {
        users: [{ id: hostile, name: "a" }, { id: "b2", name: "b" }],
        refs: [{ user_id: hostile }, { user_id: "b2" }],
      } as JsonValue,
      "plain",
      { kind: "plain-object" },
    );
    const annotations = buildAnnotations(index);
    const host = mount(renderJsonGroups(index, annotations));

    expect(host.querySelector("img")).toBeNull();
    const link = host.querySelector("a.v--ref");
    expect(link).not.toBeNull();
    expect(link?.textContent).toBe(hostile);
  });

  it("never lets a javascript: value become an href, even where a URL would normally be linked", () => {
    // `_links.self.href` is the one place T1's edge-case table names a value
    // that should render as a real <a> — through render-value.ts's existing,
    // unchanged `classify()` gate, which only ever turns `https?://` into a
    // link. A javascript: scheme must fail that gate and render as text.
    const index = buildJsonIndex(
      { _links: { self: { href: "javascript:alert(1)" } } } as JsonValue,
      "hal",
      { kind: "hal-links" },
    );
    const annotations = buildAnnotations(index);
    const leftover = renderJsonLeftover(index, annotations);
    expect(leftover).not.toBeNull();
    const host = mount(leftover!);

    const anchors = [...host.querySelectorAll("a")];
    for (const a of anchors) {
      expect(a.getAttribute("href")?.startsWith("javascript:")).not.toBe(true);
    }
    expect(host.textContent).toContain("javascript:alert(1)");
  });

  it("still links a genuine https URL through the same unchanged path", () => {
    const index = buildJsonIndex(
      { _links: { self: { href: "https://api.example.com/x" } } } as JsonValue,
      "hal",
      { kind: "hal-links" },
    );
    const annotations = buildAnnotations(index);
    const host = mount(renderJsonLeftover(index, annotations)!);

    const link = host.querySelector<HTMLAnchorElement>('a[href="https://api.example.com/x"]');
    expect(link).not.toBeNull();
    expect(link?.rel).toContain("noopener");
  });
});

describe("plain-JSON rendering — no duplicate DOM ids", () => {
  it("mints a unique id for every anchor over a corpus of hostile keys", () => {
    const hostileKeys = ["with_underscore", "with__double", "with#hash", "with/slash", "emoji-🎫-mix"];
    const payload: Record<string, JsonValue> = {};
    for (const key of hostileKeys) {
      payload[key] = [
        { id: 1, name: "a" },
        { id: 2, name: "b" },
      ];
    }
    // A nested collection too, so member anchors at more than one depth are
    // in the same corpus.
    payload["nested"] = [
      { id: 1, "sub#items": [{ id: "x", v: 1 }, { id: "y", v: 2 }] },
      { id: 2, "sub#items": [{ id: "z", v: 3 }, { id: "w", v: 4 }] },
    ];

    const index = buildJsonIndex(payload as JsonValue, "plain", { kind: "plain-object" });
    const annotations = buildAnnotations(index);
    const host = mount(renderJsonGroups(index, annotations));
    const leftover = renderJsonLeftover(index, annotations);
    if (leftover) host.append(leftover);

    const ids = [...host.querySelectorAll("[id]")].map((el) => el.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("librarySummary — the LibraryEntry projection, for either Lens kind", () => {
  // Round 2 review, suggestion: the save/reload acceptance criterion was
  // previously tested only through `parse.test.ts`'s determinism case, which
  // proves re-indexing is stable but says nothing about what a library row
  // actually *shows*. `librarySummary` is pure and moved to
  // `render-document.ts` for exactly this reason (see its own comment) —
  // this tests it directly, rather than through that proxy.

  it("summarises a jsonapi lens's ordinary case: several primary resources", () => {
    const index = buildIndex(
      doc({
        data: [{ type: "articles", id: "1" }, { type: "articles", id: "2" }],
        included: [{ type: "people", id: "9" }],
      }),
    );
    const summary = librarySummary({ kind: "jsonapi", index });
    expect(summary).toEqual({ resources: 3, types: 2, shape: "data[2]" });
  });

  it("summarises a jsonapi lens with a single primary resource, data: null, and an errors document distinctly", () => {
    const single = buildIndex(doc({ data: { type: "articles", id: "1" } }));
    expect(librarySummary({ kind: "jsonapi", index: single }).shape).toBe("data{1}");

    const nullDoc = buildIndex(doc({ data: null }));
    expect(librarySummary({ kind: "jsonapi", index: nullDoc }).shape).toBe("data: null");

    const errors = buildIndex(doc({ errors: [{ status: "404" }, { status: "500" }] }));
    expect(librarySummary({ kind: "jsonapi", index: errors }).shape).toBe("errors[2]");
  });

  it("summarises a json lens by its top-level collections", () => {
    // Each array needs at least two members to qualify as a collection at
    // all (`looksLikeCollection`'s own threshold) — one-element `tags` would
    // silently not count, which is not what this case is testing.
    const index = buildJsonIndex(
      { users: [{ id: 1 }, { id: 2 }, { id: 3 }], tags: [{ id: "a" }, { id: "b" }] } as JsonValue,
      "plain",
      { kind: "plain-object" },
    );
    const summary = librarySummary({ kind: "json", index });
    expect(summary).toEqual({ resources: 5, types: 2, shape: "plain[2]" });
  });

  it("summarises a json lens with no collections at all — no bracket suffix", () => {
    const index = buildJsonIndex(42 as JsonValue, "plain", { kind: "plain-scalar" });
    const summary = librarySummary({ kind: "json", index });
    expect(summary).toEqual({ resources: 0, types: 0, shape: "plain" });
  });
});
