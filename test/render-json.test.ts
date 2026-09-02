import { afterEach, describe, expect, it } from "vitest";
import { buildJsonIndex } from "../src/json-index.js";
import { buildAnnotations, renderJsonGroups, renderJsonLeftover } from "../src/render-json.js";
import type { JsonValue } from "../src/types.js";

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
    const doc: Record<string, JsonValue> = {};
    for (const key of hostileKeys) {
      doc[key] = [
        { id: 1, name: "a" },
        { id: 2, name: "b" },
      ];
    }
    // A nested collection too, so member anchors at more than one depth are
    // in the same corpus.
    doc["nested"] = [
      { id: 1, "sub#items": [{ id: "x", v: 1 }, { id: "y", v: 2 }] },
      { id: 2, "sub#items": [{ id: "z", v: 3 }, { id: "w", v: 4 }] },
    ];

    const index = buildJsonIndex(doc as JsonValue, "plain", { kind: "plain-object" });
    const annotations = buildAnnotations(index);
    const host = mount(renderJsonGroups(index, annotations));
    const leftover = renderJsonLeftover(index, annotations);
    if (leftover) host.append(leftover);

    const ids = [...host.querySelectorAll("[id]")].map((el) => el.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
