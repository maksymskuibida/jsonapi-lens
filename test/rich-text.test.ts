/**
 * `setRichText` — the catalogues write member names in backticks, and several
 * of those strings were assigned straight to `textContent`, so the backticks
 * reached the screen as literal characters in all three languages.
 */
import { describe, expect, it } from "vitest";
import { setRichText } from "../src/dom.js";


const host = (): HTMLElement => document.createElement("p");

describe("setRichText", () => {
  it("turns a backticked span into a code element and leaves no backticks behind", () => {
    const p = host();
    setRichText(p, "Detected as HAL: the document has a top-level `_links` member.");
    expect(p.textContent).toBe("Detected as HAL: the document has a top-level _links member.");
    expect(p.textContent).not.toContain("`");
    expect([...p.querySelectorAll("code")].map((c) => c.textContent)).toEqual(["_links"]);
  });

  it("handles several spans, and a string with none", () => {
    const many = host();
    setRichText(many, "`data`, `errors` or `meta`");
    expect([...many.querySelectorAll("code")].map((c) => c.textContent)).toEqual(["data", "errors", "meta"]);

    const none = host();
    setRichText(none, "That is not valid JSON.");
    expect(none.querySelector("code")).toBeNull();
    expect(none.textContent).toBe("That is not valid JSON.");
  });

  it("leaves an unpaired backtick as text rather than opening a code span that never closes", () => {
    const p = host();
    setRichText(p, "a `b` and a stray ` here");
    expect([...p.querySelectorAll("code")].map((c) => c.textContent)).toEqual(["b"]);
    expect(p.textContent).toBe("a b and a stray  here");
  });

  it("never parses its input as markup — these strings interpolate the document under inspection", () => {
    const p = host();
    setRichText(p, '<img src=x onerror=alert(1)> and `<script>alert(1)</script>`');
    expect(p.querySelector("img")).toBeNull();
    expect(p.querySelector("script")).toBeNull();
    expect(p.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(p.querySelector("code")!.textContent).toBe("<script>alert(1)</script>");
  });

  it("replaces previous content rather than appending to it", () => {
    const p = host();
    setRichText(p, "first `a`");
    setRichText(p, "second `b`");
    expect(p.textContent).toBe("second b");
    expect(p.querySelectorAll("code")).toHaveLength(1);
  });
});

describe("no sink renders a catalogue string's backticks literally", () => {
  /**
   * The defect was not that one sink formatted badly — it was that two views
   * of the *same sentence* disagreed. The paste-view offer rendered `code`
   * spans while the overview note, where most people actually read it, showed
   * raw backticks; and the error headline showed raw backticks directly above
   * a hint that did not. So this asserts the property across every string that
   * carries the marker, rather than spot-checking one call site.
   */
  it("every backticked catalogue string survives setRichText with no backtick left", async () => {
    const { en } = await import("../src/i18n/en.js");
    const withBackticks: string[] = [];
    const walk = (node: unknown): void => {
      if (typeof node === "string") {
        if (node.includes("`")) withBackticks.push(node);
        return;
      }
      if (node && typeof node === "object") Object.values(node).forEach(walk);
    };
    walk(en);

    // If this ever finds nothing, the sweep has stopped sweeping.
    expect(withBackticks.length).toBeGreaterThan(5);

    for (const message of withBackticks) {
      const p = document.createElement("p");
      setRichText(p, message);
      expect(p.textContent).not.toContain("`");
      expect(p.querySelector("code")).not.toBeNull();
    }
  });
});
