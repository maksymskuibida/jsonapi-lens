/**
 * The Impressum and privacy pages.
 *
 * These are the only pages in the app whose content is prose rather than a
 * rendering of the user's own data, so they get a plain reading column instead
 * of the document view's rail-and-groups layout.
 *
 * Rendered from the structured content in `src/legal/`, which means all three
 * languages come out with the same heading levels, the same landmarks and the
 * same ordering — a translation can change the words but not the outline.
 */

import { el, frag } from "../dom.js";
import { hasPlaceholders, legal } from "../legal/index.js";
import type { Block, LegalPage } from "../legal/index.js";

function renderBlock(block: Block): Node {
  switch (block.kind) {
    case "p":
      return el("p", { class: "legal__p", text: block.text });

    case "lines": {
      // An address is not a list and not a paragraph: the line breaks carry
      // meaning, so it gets an element that preserves them.
      const lines: (Node | string)[] = [];
      for (const line of block.lines) {
        if (lines.length) lines.push(el("br"));
        lines.push(line);
      }
      return el("p", { class: "legal__lines" }, frag(...lines));
    }

    case "list": {
      const list = el("ul", { class: "legal__list" });
      for (const item of block.items) list.append(el("li", { text: item }));
      return list;
    }

    case "pairs": {
      const pairs = el("dl", { class: "legal__pairs" });
      for (const [term, detail] of block.rows) {
        pairs.append(
          el("dt", { class: "legal__term", text: term }),
          el("dd", { class: "legal__detail", text: detail }),
        );
      }
      return pairs;
    }

    case "note":
      return el("p", { class: "legal__note", text: block.text });

    case "link":
      return el("p", { class: "legal__p" }, linkTo(block.href, block.text));
  }
}

/**
 * `rel=noreferrer` for the same reason the value renderer uses it: following a
 * link out of this app should not tell the destination where you came from.
 */
function linkTo(href: string, text: string): HTMLAnchorElement {
  return el("a", {
    class: "legal__link",
    href,
    target: "_blank",
    rel: "noopener noreferrer",
    text,
  });
}

export function renderLegalPage(page: LegalPage): HTMLElement {
  const pages = legal();

  const article = el("article", { class: "legal" });

  const header = el(
    "header",
    { class: "legal__head" },
    el("h1", { class: "legal__title", text: page.title }),
    el("p", { class: "legal__lede", text: page.lede }),
  );

  // Loud on purpose. A legal notice that still says [CITY] reads as compliance
  // to a crawler and as nothing at all to a court, so it should be impossible
  // to deploy without noticing.
  if (hasPlaceholders()) {
    header.append(
      el("p", { class: "legal__warning", role: "alert", text: pages.placeholderWarning }),
    );
  }

  article.append(header);

  for (const section of page.sections) {
    const node = el(
      "section",
      { class: "legal__section" },
      el("h2", { class: "legal__heading", text: section.heading }),
    );
    for (const block of section.blocks) node.append(renderBlock(block));
    article.append(node);
  }

  article.append(
    el("footer", { class: "legal__foot" }, el("p", { text: pages.updated(pages.updatedOn) })),
  );

  // The pages cross-reference each other: whoever came looking for one is
  // usually the sort of visitor who wants the other.
  const other =
    page === pages.impressum
      ? el("a", { class: "legal__crosslink", href: "/privacy", text: pages.privacy.title })
      : el("a", { class: "legal__crosslink", href: "/impressum", text: pages.impressum.title });
  article.append(el("nav", { class: "legal__nav" }, other));

  return article;
}
