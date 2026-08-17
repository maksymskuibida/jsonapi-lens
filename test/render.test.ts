import { describe, expect, it } from "vitest";
import { escapeHtml } from "../src/dom.js";
import { classify, previewValue, summaryAttribute } from "../src/format.js";
import { domId } from "../src/ident.js";
import { buildIndex } from "../src/parse.js";
import { groupsHtml } from "../src/render-document.js";
import { chip } from "../src/render-resource.js";
import type { JsonObject } from "../src/types.js";

const doc = (value: unknown): JsonObject => value as JsonObject;

describe("escapeHtml", () => {
  it("neutralises markup in both text and attribute position", () => {
    expect(escapeHtml("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
    expect(escapeHtml('" onmouseover="x')).toBe("&quot; onmouseover=&quot;x");
    expect(escapeHtml("' onload='x")).toBe("&#39; onload=&#39;x");
    expect(escapeHtml("a & b")).toBe("a &amp; b");
  });
});

describe("bulk row rendering", () => {
  /**
   * The row path builds HTML as a string for speed, so a payload carrying markup
   * must not be able to inject an element. This is the test that keeps that
   * trade-off honest.
   */
  it("does not let payload text become markup", () => {
    const index = buildIndex(
      doc({
        data: {
          type: "<img src=x onerror=alert(1)>",
          id: '"><script>alert(1)</script>',
          attributes: { name: "<b>bold</b>" },
        },
      }),
    );

    const host = document.createElement("div");
    host.innerHTML = groupsHtml(index);

    expect(host.querySelector("script")).toBeNull();
    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector("b.injected")).toBeNull();
    // The text is still shown, just as text.
    expect(host.textContent).toContain("<b>bold</b>");
  });

  it("gives every resource a section with the encoded id", () => {
    const index = buildIndex(
      doc({
        data: { type: "draft/sections", id: "2026-09-14/Section 3#1" },
        included: [{ type: "people", id: "zürich-city" }],
      }),
    );

    const host = document.createElement("div");
    host.innerHTML = groupsHtml(index);
    document.body.append(host);

    expect(document.getElementById(domId("draft/sections", "2026-09-14/Section 3#1"))).not.toBeNull();
    expect(document.getElementById(domId("people", "zürich-city"))).not.toBeNull();
    host.remove();
  });

  it("emits exactly one section per resource, with unique ids", () => {
    const index = buildIndex(
      doc({
        data: [{ type: "a", id: "1" }, { type: "a", id: "2" }],
        included: [{ type: "a", id: "1" }, { type: "b", id: "1" }],
      }),
    );

    const host = document.createElement("div");
    host.innerHTML = groupsHtml(index);

    const sections = [...host.querySelectorAll(".res")];
    expect(sections).toHaveLength(3);
    expect(new Set(sections.map((s) => s.id)).size).toBe(3);
  });

  it("marks the summary row as a details disclosure so find-in-page can open it", () => {
    const index = buildIndex(doc({ data: { type: "a", id: "1" } }));
    const host = document.createElement("div");
    host.innerHTML = groupsHtml(index);
    expect(host.querySelector(".res > details.res__d > summary.res__row")).not.toBeNull();
  });

  it("flags a resource whose pointers do not resolve", () => {
    const index = buildIndex(
      doc({
        data: { type: "a", id: "1", relationships: { r: { data: { type: "z", id: "gone" } } } },
      }),
    );
    const host = document.createElement("div");
    host.innerHTML = groupsHtml(index);
    expect(host.querySelector(".tag--absent")?.textContent).toBe("1 unresolved");
  });

  it("omits Expand all for a group too large to expand at once", () => {
    const many = Array.from({ length: 600 }, (_, i) => ({ type: "a", id: String(i) }));
    const index = buildIndex(doc({ data: many }));
    const host = document.createElement("div");
    host.innerHTML = groupsHtml(index);
    expect(host.querySelector(".group__toggle")).toBeNull();
    expect(host.querySelector(".group__toggle-note")?.textContent).toBe("600 rows");
  });
});

describe("chip", () => {
  it("renders a resolved pointer as a link to the target section", () => {
    const node = chip("people", "zürich-city", true);
    expect(node.tagName).toBe("A");
    expect(node.getAttribute("href")).toBe("#" + domId("people", "zürich-city"));
    expect(node.querySelector(".chip__absent")).toBeNull();
  });

  it("renders an unresolved pointer as a non-link that says so", () => {
    const node = chip("people", "gone", false);
    expect(node.tagName).toBe("SPAN");
    expect(node.hasAttribute("href")).toBe(false);
    expect(node.querySelector(".chip__absent")?.textContent).toBe("not in document");
    expect(node.getAttribute("title")).toContain("appears in this document");
  });

  it("keeps payload text as text", () => {
    const node = chip("<b>t</b>", "<i>i</i>", true);
    expect(node.querySelector("b.chip__sigil")).not.toBeNull();
    expect(node.querySelector(".chip__type")?.textContent).toBe("<b>t</b>");
    expect(node.querySelector(".chip__type i")).toBeNull();
  });
});

describe("value classification", () => {
  it("recognises the shapes that matter when reading a payload", () => {
    expect(classify(null)).toBe("null");
    expect(classify("")).toBe("empty-string");
    expect(classify(true)).toBe("boolean");
    expect(classify(42)).toBe("number");
    expect(classify("2026-09-14")).toBe("date");
    expect(classify("2026-09-14T07:34:00+02:00")).toBe("date");
    expect(classify("2026-09-14T07:34:00Z")).toBe("date");
    expect(classify("0f8b21c4-6d3a-4e19-9c77-2b5ea41f8d60")).toBe("uuid");
    expect(classify("https://example.com/x")).toBe("url");
    expect(classify("just text")).toBe("string");
    expect(classify([])).toBe("array");
    expect(classify({})).toBe("object");
  });

  it("does not mistake a version string for a date", () => {
    expect(classify("1.1")).toBe("string");
    expect(classify("2026")).toBe("string");
  });
});

describe("summary attribute", () => {
  it("prefers a human-meaningful key", () => {
    expect(summaryAttribute({ id_hash: "x", name: "Ada Lovelace" })?.key).toBe("name");
    expect(summaryAttribute({ z: 1, title: "T" })?.key).toBe("title");
  });

  it("falls back to the first usable scalar", () => {
    expect(summaryAttribute({ handle: "11", extra: null })?.key).toBe("handle");
  });

  it("prefers an identifying string over a number that happens to come first", () => {
    // A comment summarised as "score 2" tells you nothing; its headline does.
    expect(summaryAttribute({ score: 2, headline: "Section 3" })?.key).toBe(
      "headline",
    );
  });

  it("still uses a number when there is no string at all", () => {
    expect(summaryAttribute({ score: 2, word_count: 141.2 })?.key).toBe("score");
  });

  it("skips nulls, empty strings and nested values", () => {
    expect(summaryAttribute({ name: null, title: "", nested: { a: 1 }, code: "EC" })?.key).toBe(
      "code",
    );
  });

  it("returns null when there is nothing worth showing", () => {
    expect(summaryAttribute(undefined)).toBeNull();
    expect(summaryAttribute({})).toBeNull();
    expect(summaryAttribute({ a: null, b: {} })).toBeNull();
  });
});

describe("value preview", () => {
  it("summarises nested structures on one line", () => {
    expect(previewValue({ a: 1, b: "x" })).toBe("{a: 1, b: x}");
    expect(previewValue([1, 2, 3])).toBe("[1, 2, 3]");
    expect(previewValue({})).toBe("{}");
    expect(previewValue([])).toBe("[]");
  });

  it("stays within its budget", () => {
    const long = previewValue({ note: "x".repeat(500) }, 40);
    expect(long.length).toBeLessThanOrEqual(40);
    expect(long.endsWith("…")).toBe(true);
  });
});
