import { el } from "./dom.js";
import { t } from "./i18n/index.js";
import { summaryAttribute, previewValue } from "./format.js";
import { chip } from "./render-resource.js";
import { openModal } from "./ui.js";
import type { DocumentIndex, Resource } from "./types.js";

/** Results shown at once. Enough to choose from, few enough to stay instant. */
const MAX_RESULTS = 40;

/**
 * Go to a resource by typing part of its type or id.
 *
 * The jump rail gets you to a *type*; on a document with fifty thousand
 * resources that still leaves a lot of scrolling. This closes the gap without a
 * search index: a substring scan over `type:id` is a few milliseconds even at
 * that size, and the results are ordinary anchors, so choosing one is the same
 * navigation as clicking a relationship.
 */
export function openJumpModal(index: DocumentIndex): void {
  const all = [...index.byKey.values()];

  const input = el("input", {
    class: "field",
    type: "search",
    placeholder: t().jump.placeholder,
    "aria-label": t().jump.label,
    autocomplete: "off",
    spellcheck: false,
  });
  input.dataset["autofocus"] = "true";

  const count = el("p", { class: "jump__count", role: "status" });
  const results = el("ul", { class: "jump__results" });

  const search = (query: string): Resource[] => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return all.slice(0, MAX_RESULTS);

    const matches: Resource[] = [];
    for (const resource of all) {
      const haystack = `${resource.type} ${resource.id}`.toLowerCase();
      // Every term must appear, so "stations 0098" narrows rather than widens.
      let ok = true;
      for (const term of terms) {
        if (!haystack.includes(term)) {
          ok = false;
          break;
        }
      }
      if (ok) {
        matches.push(resource);
        if (matches.length >= MAX_RESULTS) break;
      }
    }
    return matches;
  };

  let matched: Resource[] = [];

  const render = (query: string): void => {
    matched = search(query);
    results.replaceChildren();

    if (!matched.length) {
      count.textContent = t().jump.noMatch;
      return;
    }

    count.textContent =
      matched.length >= MAX_RESULTS
        ? t().jump.capped(MAX_RESULTS)
        : t().jump.matches(matched.length);

    for (const resource of matched) {
      const summary = summaryAttribute(resource.attributes);
      const link = el(
        "a",
        { class: "jump__result", href: `#${resource.domId}` },
        chip(resource.type, resource.id, true),
        summary
          ? el("span", { class: "jump__summary", text: previewValue(summary.value, 60) })
          : null,
      );
      results.append(el("li", null, link));
    }
  };

  render("");

  const handle = openModal({
    title: t().jump.title,
    subtitle: t().jump.subtitle(index.counts.total),
    body: el("div", { class: "jump" }, input, count, results),
    variant: "tall",
  });

  input.addEventListener("input", () => render(input.value));

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      const first = results.querySelector<HTMLAnchorElement>(".jump__result");
      if (first) {
        handle.close();
        first.click();
      }
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      results.querySelector<HTMLAnchorElement>(".jump__result")?.focus();
    }
  });

  // Choosing a result is a normal anchor navigation; the modal just gets out of
  // the way so the landing is visible.
  results.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest(".jump__result")) handle.close();
  });
}
