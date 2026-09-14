import { describe, expect, it, vi } from "vitest";

/**
 * D5 (docs/qa-reports/prod-baseline-2026-09-02.md): the type system already
 * guarantees `de`/`uk` declare every key `en` does — a missing key is a
 * typecheck failure, not a test failure. What it cannot catch is a render
 * path that never asked the catalogue at all (the four resource-action
 * buttons used to be hardcoded English strings) or one that asked for the
 * wrong thing (the value-row `aria-label`s used to be hardcoded English even
 * though the adjacent `title` correctly came from `t()`). Both are only
 * visible by actually rendering with a language other than English, which is
 * why this file exists alongside `i18n.test.ts`'s catalogue-content checks.
 *
 * `src/i18n/index.ts#locale` negotiates through `navigator`/`localStorage`
 * and memoises on first call, so switching languages mid-file the way the
 * real app does (a reload) is not available to a single test file. Mocking
 * `t`/`locale` directly — keeping every other real export via `importOriginal`
 * — reaches the same render paths the app does without fighting that
 * memoisation or spinning up a second module registry per language.
 */
const state = vi.hoisted(() => ({ active: "en" as "en" | "de" | "uk" }));

vi.mock("../src/i18n/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/i18n/index.js")>();
  const { en } = await import("../src/i18n/en.js");
  const { de } = await import("../src/i18n/de.js");
  const { uk } = await import("../src/i18n/uk.js");
  const catalogues = { en, de, uk };
  return {
    ...actual,
    t: () => catalogues[state.active],
    locale: () => state.active,
  };
});

import { de } from "../src/i18n/de.js";
import { en } from "../src/i18n/en.js";
import { uk } from "../src/i18n/uk.js";
import { resourceKey } from "../src/ident.js";
import { buildIndex } from "../src/parse.js";
import { buildResourceBody } from "../src/render-resource.js";
import { rowActions } from "../src/render-value.js";
import type { Messages } from "../src/i18n/en.js";
import type { JsonObject } from "../src/types.js";

const doc = (value: unknown): JsonObject => value as JsonObject;

const CATALOGUES: [name: "en" | "de" | "uk", messages: Messages][] = [
  ["en", en],
  ["de", de],
  ["uk", uk],
];

describe("the four resource-action buttons (raw/copy/path/link)", () => {
  it.each(CATALOGUES)("%s renders translated text with a matching aria-label, not the English literal", (name, messages) => {
    state.active = name;
    const index = buildIndex(doc({ data: { type: "articles", id: "1" } }));
    const resource = index.byKey.get(resourceKey("articles", "1"))!;
    const body = buildResourceBody(resource, index);
    const buttons = [...body.querySelectorAll<HTMLButtonElement>(".res__actions button")];
    expect(buttons, name).toHaveLength(4);

    const m = messages.resource.objectActions;
    const expected: [string, string][] = [
      [m.raw, m.rawTitle],
      [m.copy, m.copyTitle],
      [m.path, m.pathTitle(resource.pointer)],
      [m.link, m.linkTitle],
    ];

    buttons.forEach((button, i) => {
      const [label, title] = expected[i]!;
      expect(button.textContent, `${name} button ${i} text`).toBe(label);
      expect(button.title, `${name} button ${i} title`).toBe(title);
      // The title and the aria-label are the same string by design — see
      // `objectActions` in `src/render-resource.ts`.
      expect(button.getAttribute("aria-label"), `${name} button ${i} aria-label`).toBe(title);
    });
  });

  it("de and uk do not merely repeat the English text", () => {
    state.active = "en";
    const enButtons = [...buildActionButtons()].map((b) => b.textContent);

    for (const locale of ["de", "uk"] as const) {
      state.active = locale;
      const buttons = [...buildActionButtons()].map((b) => b.textContent);
      expect(buttons, locale).not.toEqual(enButtons);
    }
  });

  function buildActionButtons(): NodeListOf<HTMLButtonElement> {
    const index = buildIndex(doc({ data: { type: "articles", id: "1" } }));
    const resource = index.byKey.get(resourceKey("articles", "1"))!;
    return buildResourceBody(resource, index).querySelectorAll<HTMLButtonElement>(".res__actions button");
  }
});

describe("the value-row copy buttons' aria-label", () => {
  it.each(CATALOGUES)("%s's aria-label matches the (already-translated) title, not an English literal", (name, messages) => {
    state.active = name;
    const actions = rowActions();
    const buttons = [...actions.querySelectorAll<HTMLButtonElement>("button")];
    expect(buttons, name).toHaveLength(2);

    expect(buttons[0]!.title).toBe(messages.value.copyPointerTitle);
    expect(buttons[0]!.getAttribute("aria-label"), name).toBe(messages.value.copyPointerTitle);

    expect(buttons[1]!.title).toBe(messages.value.copyValueTitle);
    expect(buttons[1]!.getAttribute("aria-label"), name).toBe(messages.value.copyValueTitle);
  });
});

describe("the 'Included' overview stat label", () => {
  it("translates in German and Ukrainian, unlike the pre-existing defect", () => {
    // Round-tripping through the English literal was the exact bug: both
    // used to say the bare English word "Included".
    expect(de.overview.included).not.toBe(en.overview.included);
    expect(uk.overview.included).not.toBe(en.overview.included);
  });
});
