/**
 * QA5 — accessible names and tooltips come from the catalogue, in every language.
 *
 * The defect: `aria-label` was an English literal on the per-value and
 * per-resource buttons, so a screen reader announced "Copy this value" in a
 * German interface (the visible `title` beside it was translated). These tests
 * render the real controls under each language and compare against the
 * catalogue — and, for `de` and `uk`, against the English string, because a
 * name that merely equals the catalogue would also pass if the catalogue row
 * had been left in English.
 *
 * Each case re-imports the render modules after pinning the stored language,
 * because `locale()` memoises on first use (see `test/format-locale.test.ts`).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEY } from "../src/i18n/index.js";
import { en } from "../src/i18n/en.js";
import type { Messages } from "../src/i18n/en.js";

type Lang = "en" | "de" | "uk";

async function inLanguage(lang: Lang) {
  localStorage.setItem(STORAGE_KEY, lang);
  vi.resetModules();
  const [i18n, parse, value, resource, document_] = await Promise.all([
    import("../src/i18n/index.js"),
    import("../src/parse.js"),
    import("../src/render-value.js"),
    import("../src/render-resource.js"),
    import("../src/render-document.js"),
  ]);
  return { m: i18n.t() as Messages, parse, value, resource, document: document_ };
}

afterEach(() => {
  localStorage.setItem(STORAGE_KEY, "en");
  vi.resetModules();
});

const HOSTILE_TYPE = '"><img src=x onerror=alert(1)>';
const HOSTILE_ID = "<script>alert(1)</script>";

const DOC = {
  data: {
    type: HOSTILE_TYPE,
    id: HOSTILE_ID,
    attributes: { name: "x" },
    relationships: {
      author: { data: { type: HOSTILE_TYPE, id: "missing" } },
    },
  },
};

describe.each(["en", "de", "uk"] as const)("accessible names in %s", (lang) => {
  it("per-value buttons: aria-label equals the tooltip, which is the catalogue's", async () => {
    const { m, value } = await inLanguage(lang);
    const buttons = [...value.rowActions().querySelectorAll("button")];
    expect(buttons).toHaveLength(2);

    expect(buttons[0]!.getAttribute("aria-label")).toBe(m.value.copyPointerTitle);
    expect(buttons[0]!.getAttribute("title")).toBe(m.value.copyPointerTitle);
    expect(buttons[1]!.getAttribute("aria-label")).toBe(m.value.copyValueTitle);
    expect(buttons[1]!.getAttribute("title")).toBe(m.value.copyValueTitle);

    if (lang !== "en") {
      expect(buttons[0]!.getAttribute("aria-label")).not.toBe(en.value.copyPointerTitle);
      expect(buttons[1]!.getAttribute("aria-label")).not.toBe(en.value.copyValueTitle);
    }
  });

  it("per-resource buttons: visible text, tooltip and accessible name all come from the catalogue", async () => {
    const { m, parse, resource } = await inLanguage(lang);
    const index = parse.buildIndex(DOC as never);
    const r = index.groups[0]!.resources[0]!;
    const body = resource.buildResourceBody(r, index);
    const host = document.createElement("div");
    host.append(body);

    const a = m.resource.actions;
    const expected: Record<string, { text: string; title: string }> = {
      raw: { text: a.raw, title: a.rawTitle },
      "copy-object": { text: a.copy, title: a.copyTitle },
      "copy-pointer": { text: a.path, title: a.pathTitle(r.pointer) },
      "copy-link": { text: a.link, title: a.linkTitle },
    };
    const found = [...host.querySelectorAll<HTMLElement>("[data-object-action]")];
    expect(found.map((b) => b.dataset["objectAction"])).toEqual(Object.keys(expected));
    for (const button of found) {
      const want = expected[button.dataset["objectAction"]!]!;
      expect(button.textContent).toBe(want.text);
      expect(button.getAttribute("title")).toBe(want.title);
      expect(button.getAttribute("aria-label")).toBe(want.title);
    }

    if (lang !== "en") {
      for (const button of found) {
        expect(button.getAttribute("aria-label")).not.toMatch(/^Copy |^Show /);
      }
      expect(found[0]!.textContent).not.toBe("raw");
    }
  });

  it("the identity strip and the absent-chip wording are translated, and hostile names stay text", async () => {
    const { m, parse, resource } = await inLanguage(lang);
    const index = parse.buildIndex(DOC as never);
    const r = index.groups[0]!.resources[0]!;
    const host = document.createElement("div");
    host.append(resource.buildResourceBody(r, index));

    const labels = [...host.querySelectorAll(".res__identity-label")].map((n) => n.textContent);
    expect(labels).toEqual([m.resource.identityType, m.resource.identityId, m.resource.identityAt]);

    // The unresolved chip is the DOM path; it carries the hostile type and id
    // both in its title attribute and as text.
    const chip = resource.chip(HOSTILE_TYPE, HOSTILE_ID, false);
    expect(chip.getAttribute("title")).toBe(m.resource.absentChipTitle(HOSTILE_TYPE, HOSTILE_ID));
    expect(chip.querySelector(".chip__absent")!.textContent).toBe(m.resource.notInDocument);
    expect(chip.querySelector("img, script")).toBeNull();
  });

  it("an empty string value reads in the interface language", async () => {
    const { m, value } = await inLanguage(lang);
    const node = value.renderScalar("");
    expect(node.textContent).toBe(m.value.emptyString);
  });
});

describe("escaping on the row path that this change touched", () => {
  it("a hostile type and id are text in the bulk-row HTML, in every language", async () => {
    for (const lang of ["en", "de", "uk"] as const) {
      const { parse, document: doc } = await inLanguage(lang);
      const index = parse.buildIndex(DOC as never);
      const host = document.createElement("div");
      host.innerHTML = doc.groupsHtml(index);
      expect(host.querySelector("img")).toBeNull();
      expect(host.querySelector("script")).toBeNull();
      expect(host.textContent).toContain(HOSTILE_ID);
      expect(host.textContent).toContain(HOSTILE_TYPE);
    }
  });
});
