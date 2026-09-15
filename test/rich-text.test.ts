/**
 * `setRichText` — the catalogues write member names in backticks, and several
 * of those strings were assigned straight to `textContent`, so the backticks
 * reached the screen as literal characters in all three languages.
 */
import { describe, expect, it } from "vitest";
import { setRichText } from "../src/dom.js";
import type { RichPart } from "../src/dom.js";
import { DocumentError, readAny, readDocument } from "../src/parse.js";
import { renderJsonOverview } from "../src/render-document.js";
import { renderErrorCard, renderShapeOffer } from "../src/render-error.js";
import { t } from "../src/i18n/index.js";
import type { ShapeEvidence } from "../src/types.js";


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

describe("document text is passed as a value, never scanned as a marker", () => {
  /**
   * The defect the parts API exists for. V8's JSON error message quotes a
   * slice of the payload verbatim, so a document containing a backtick made
   * the message render as `Unexpected token ''` — the message's entire job is
   * to name that character — with fragments of the payload styled as member
   * names. A pasted log line, a JS snippet or a template literal is enough.
   */
  it("keeps a backtick from the parser's own message on screen", () => {
    let hint: string | RichPart[] = "";
    try {
      readDocument('{"a": `x` , "b`c": 1}');
    } catch (error) {
      hint = (error as DocumentError).hint;
    }

    const p = host();
    setRichText(p, hint);
    expect(p.textContent).toContain("`");
    // Nothing out of the document may be styled as a member name.
    expect([...p.querySelectorAll("code")]).toHaveLength(0);
  });

  it("shows a document key containing a backtick exactly as spelled", () => {
    let hint: string | RichPart[] = "";
    try {
      readDocument('{"a`b": 1}');
    } catch (error) {
      hint = (error as DocumentError).hint;
    }

    const p = host();
    setRichText(p, hint);
    expect(p.textContent).toContain("a`b");
    // The catalogue's own member names are still styled.
    expect([...p.querySelectorAll("code")].map((c) => c.textContent)).toContain("data");
  });
});

describe("the sinks render, not just the helper", () => {
  /**
   * The previous version asserted only that `setRichText` behaves. That let
   * both round-one fixes be reverted with the suite still green: the bug was
   * never in the helper, it was in the sinks that bypassed it.
   */
  it("renders the overview note through the real render path, for every shape", () => {
    // Renders `renderJsonOverview` rather than calling the helper — the bug
    // was never in the helper, it was in a sink that bypassed it, so a test
    // that calls `setRichText` itself cannot see it. Reverting that sink must
    // turn this red.
    let checked = 0;
    for (const [text, kind] of [
      ['{"_links":{"self":{"href":"/x"}}}', "hal"],
      ['{"value":[],"@odata.context":"x"}', "odata"],
      ['{"jsonrpc":"2.0","result":{},"id":1}', "jsonrpc"],
      ['{"a":{"b":1}}', "plain"],
    ] as const) {
      const lens = readAny(text);
      if (lens.kind !== "json") continue;
      const overview = renderJsonOverview(lens.index, { bytes: 40, parseMs: 1 });
      const note = overview.querySelector(".overview__note");
      expect(note, kind).not.toBeNull();
      expect(note!.textContent, kind).not.toContain("`");
      checked += 1;
    }
    // Without this the `continue` above is a silent escape hatch: a shape
    // reclassification would skip every fixture and report green.
    expect(checked).toBe(4);
  });

  it("every shape-detection sentence renders with code spans and no literal backtick", () => {
    // Driven off `ShapeEvidence`'s own union rather than a guessed argument
    // shape — these are the strings behind the reported defect, and the
    // previous sweep reached none of them because a walk over values cannot
    // see a function.
    const every: ShapeEvidence[] = [
      { kind: "jsonapi-member", member: "data" },
      { kind: "jsonapi-member", member: "errors" },
      { kind: "jsonapi-member", member: "meta" },
      { kind: "hal-links" },
      { kind: "hal-embedded" },
      { kind: "odata-context" },
      { kind: "jsonrpc-member" },
      { kind: "envelope-shape" },
      { kind: "envelope-conflict" },
      { kind: "collection-array", length: 2 },
      { kind: "ndjson-lines", records: 3, malformedLine: null, skipped: 0 },
      { kind: "ndjson-lines", records: 3, malformedLine: 2, skipped: 1 },
      { kind: "plain-empty-object" },
      { kind: "plain-scalar" },
      { kind: "plain-object" },
      { kind: "plain-unparseable" },
    ];

    let sawACodeSpan = false;
    for (const evidence of every) {
      const p = host();
      setRichText(p, t().shape.evidence(evidence));
      expect(p.textContent, `evidence ${evidence.kind}`).not.toContain("`");
      if (p.querySelector("code")) sawACodeSpan = true;
    }
    // If none of them carries a member name, this has stopped testing anything.
    expect(sawACodeSpan).toBe(true);
  });

  it("the real error-card sink fills both elements, for an error whose hint is parts", () => {
    // Calls `renderErrorCard`, not `setRichText`. With `hint` widened to
    // `string | RichPart[]`, a sink that mishandles the union renders nothing
    // at all — a headline with no hint under it — for exactly the two errors
    // this PR is about.
    for (const text of ['{"a": `x` , "b`c": 1}', '{"results":[],"page":1}']) {
      let thrown: DocumentError | null = null;
      try {
        readDocument(text);
      } catch (error) {
        thrown = error as DocumentError;
      }
      expect(thrown, text).not.toBeNull();

      const headline = host();
      const hint = host();
      const where = host();
      renderErrorCard(headline, hint, where, thrown!);

      expect(headline.textContent!.length, text).toBeGreaterThan(0);
      // The half that goes empty when the union is mishandled.
      expect(hint.textContent!.length, text).toBeGreaterThan(0);
      expect(hint.textContent, text).not.toContain("undefined");
      expect(hint.textContent, text).not.toContain("[object Object]");
    }
  });

  it("the real shape-offer sink fills both elements", () => {
    const headline = host();
    const hint = host();
    renderShapeOffer(headline, hint, "hal", { kind: "hal-links" });

    expect(headline.textContent!.length).toBeGreaterThan(0);
    expect(hint.textContent).not.toContain("`");
    expect(hint.querySelector("code")!.textContent).toBe("_links");
  });


  it("every static catalogue string carrying a marker is balanced and renders, in all three languages", async () => {
    // All three: an unpaired marker is most likely to arrive in a translation
    // and least likely to be noticed, because it is deleted rather than shown.
    const { en } = await import("../src/i18n/en.js");
    const { de } = await import("../src/i18n/de.js");
    const { uk } = await import("../src/i18n/uk.js");
    const found: string[] = [];
    const walk = (node: unknown): void => {
      if (typeof node === "string") {
        if (node.includes("`")) found.push(node);
        return;
      }
      if (node && typeof node === "object") Object.values(node).forEach(walk);
    };
    [en, de, uk].forEach(walk);

    expect(found.length).toBeGreaterThan(15);
    for (const message of found) {
      // An unpaired backtick is deleted rather than displayed, which
      // `not.toContain` alone cannot see — so assert the parity too.
      expect((message.match(/`/g) ?? []).length % 2, `unbalanced backticks in: ${message}`).toBe(0);
      const p = host();
      setRichText(p, message);
      expect(p.textContent).not.toContain("`");
      expect(p.querySelector("code")).not.toBeNull();
    }
  });
});
