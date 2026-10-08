/**
 * No user-facing copy outside the catalogues.
 *
 * `en.ts` is the schema and `de.ts`/`uk.ts` must match it, but nothing stops a
 * template from skipping the catalogue altogether — which is exactly how six
 * accessible names shipped in English (QA5): the *visible* label beside each
 * was translated, the `aria-label` was a string literal, and a screen reader
 * announced "Copy this value" in a German interface. Typecheck cannot see it, a
 * missing catalogue row cannot see it, and a reviewer reading a diff of
 * `"aria-label": title` sees nothing wrong.
 *
 * So this is a source scan, in the spirit of `test/hygiene.test.ts`: it reads
 * every file under `src/` except the catalogues and the legal pages (which *are*
 * copy) and fails on a string literal in a position that reaches the user —
 * `aria-label`, `title`, `placeholder`, `alt`, a `text:` property, a
 * `textContent` assignment, a toast, an error constructor, or an argument to
 * the button helpers. A template literal counts as a literal when anything
 * outside its `${...}` holes is a letter; `${a} · ${b}` is plumbing and passes.
 *
 * What it does **not** catch — said plainly, because a scan is not a proof:
 * a literal assigned to a variable first and passed on later; copy built by
 * concatenation; a position this list does not name. The list is the place to
 * extend, and `EXEMPT` below is the place to justify a deliberate exception.
 */
import { describe, expect, it } from "vitest";

const SOURCES: Record<string, string> = import.meta.glob("/src/**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});

/** Deliberate literals, each with the reason it is not copy. Matched on file and on the literal's own text. */
const EXEMPT: { file: string; literal: string; reason: string }[] = [
  {
    file: "src/render-value.ts",
    literal: "null",
    reason: "the JSON keyword `null`, shown as written in the payload; it is data syntax, not language",
  },
  {
    file: "src/seo.ts",
    literal: " — jsonapi-lens",
    reason: "the product's own name as a document-title suffix; a proper noun",
  },
];

/**
 * Which arguments of a helper are copy. A helper not listed here that the scan
 * finds being called fails the test, so adding `button(...)`-shaped helper is a
 * decision someone has to make here rather than a literal nobody looks at.
 */
const HELPER_COPY_ARGS: Record<string, { file?: string; args: number[] }[]> = {
  actionButton: [{ args: [0, 1] }], // (label, title, onClick, extraClass)
  button: [
    { file: "src/render-resource.ts", args: [1, 2] }, // (action, label, title, extra)
    { file: "src/main.ts", args: [0, 1] }, // (label, title, onClick, primary, id)
  ],
};

/**
 * The string or template literal at the start of `s`, or null. A template is
 * scanned with its `${...}` holes balanced and any literal inside them skipped,
 * so a nested template (`${x ? `a` : ""}`) does not end the outer one early.
 */
function readLiteral(s: string): string | null {
  const quote = s[0];
  if (quote !== '"' && quote !== "'" && quote !== "`") return null;
  for (let i = 1; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === quote) return s.slice(0, i + 1);
    if (quote !== "`" && ch === "\n") return null;
    if (quote === "`" && ch === "$" && s[i + 1] === "{") {
      let depth = 1;
      i += 2;
      for (; i < s.length && depth > 0; i++) {
        const inner = s[i]!;
        if (inner === '"' || inner === "'" || inner === "`") {
          const nested = readLiteral(s.slice(i));
          if (nested) {
            i += nested.length - 1;
            continue;
          }
        }
        if (inner === "{") depth++;
        else if (inner === "}") depth--;
      }
      i--;
    }
  }
  return null;
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

/** The text of a literal with `${...}` holes removed, quotes dropped. */
function literalText(literal: string): string {
  let body = literal.slice(1, -1);
  // Innermost holes first, so nested braces and templates peel off from the inside.
  for (let guard = 0; guard < 16 && body.includes("${"); guard++) body = body.replace(/\$\{[^{}]*\}/g, "");
  return body.replace(/[`"']/g, "");
}

const hasLetters = (text: string): boolean => /\p{L}/u.test(text);

/** Split the argument list of the call whose `(` is at `open`, at top-level commas. Strings and brackets are respected. */
function callArguments(source: string, open: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open; i < source.length; i++) {
    const ch = source[i]!;
    if (ch === '"' || ch === "'" || ch === "`") {
      const lit = readLiteral(source.slice(i));
      if (lit) {
        i += lit.length - 1;
        continue;
      }
    }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) {
        args.push(source.slice(start, i).trim());
        return args;
      }
    } else if (ch === "," && depth === 1) {
      args.push(source.slice(start, i).trim());
      start = i + 1;
    }
  }
  return args;
}

export interface Finding {
  file: string;
  rule: string;
  literal: string;
}

export function findHardcodedCopy(file: string, rawSource: string): Finding[] {
  const source = stripComments(rawSource);
  const found: Finding[] = [];

  const report = (rule: string, literal: string): void => {
    const text = literalText(literal);
    if (!hasLetters(text)) return;
    if (EXEMPT.some((e) => e.file === file && text.includes(e.literal))) return;
    found.push({ file, rule, literal });
  };

  // Property or attribute whose value is a literal: { title: "…" }, { "aria-label": `…` }.
  const PROP =
    /["']?\b(aria-label|aria-description|aria-roledescription|aria-placeholder|aria-valuetext|title|placeholder|alt|text)\b["']?\s*:\s*/g;
  for (let m; (m = PROP.exec(source)); ) {
    const lit = readLiteral(source.slice(m.index + m[0].length));
    if (lit) report(`${m[1]}: <literal>`, lit);
  }

  // Assignment: node.textContent = "…", node.title = "…".
  const ASSIGN = /\.(textContent|innerText|title|placeholder|ariaLabel)\s*=\s*/g;
  for (let m; (m = ASSIGN.exec(source)); ) {
    const lit = readLiteral(source.slice(m.index + m[0].length));
    if (lit) report(`.${m[1]} = <literal>`, lit);
  }

  // setAttribute("aria-label", "…")
  const SETATTR = /setAttribute\(\s*["'](aria-[a-z]+|title|placeholder|alt)["']\s*,\s*/g;
  for (let m; (m = SETATTR.exec(source)); ) {
    const lit = readLiteral(source.slice(m.index + m[0].length));
    if (lit) report(`setAttribute(${m[1]}, <literal>)`, lit);
  }

  // Markup inside a template string: title="…", aria-label="…".
  const MARKUP = /\b(aria-label|title|alt|placeholder|aria-description)=\\?"([^"]*)"/g;
  for (let m; (m = MARKUP.exec(source)); ) report(`${m[1]}="…" in markup`, `"${m[2]}"`);

  // Callers that put a string straight in front of the person.
  const SINKS = /\b(toast|DocumentError|ShareError)\(\s*/g;
  for (let m; (m = SINKS.exec(source)); ) {
    const lit = readLiteral(source.slice(m.index + m[0].length));
    if (lit) report(`${m[1]}(<literal>)`, lit);
  }

  // The button helpers, by argument position.
  const HELPERS = /\b(actionButton|button)\(/g;
  for (let m; (m = HELPERS.exec(source)); ) {
    // A declaration (`const button = (…) =>` / `function actionButton(`) is not a call.
    const before = source.slice(Math.max(0, m.index - 12), m.index);
    if (/function\s+$/.test(before)) continue;
    const table = HELPER_COPY_ARGS[m[1]!]!;
    const entry = table.find((e) => e.file === undefined || e.file === file);
    const args = callArguments(source, m.index + m[0].length - 1);
    if (!entry) {
      found.push({ file, rule: `unclassified call to ${m[1]}()`, literal: args.join(", ") });
      continue;
    }
    for (const index of entry.args) {
      const arg = args[index];
      if (arg && readLiteral(arg) !== null) report(`${m[1]}() argument ${index}`, arg);
    }
  }

  return found;
}

describe("findHardcodedCopy — the scan itself can fail", () => {
  const flagged = (source: string, file = "src/x.ts"): string[] =>
    findHardcodedCopy(file, source).map((f) => f.rule);

  it("flags the exact shapes that shipped in English (QA5)", () => {
    expect(flagged(`el("button", { "aria-label": "Copy this value", text: t().value.x })`)).toEqual([
      "aria-label: <literal>",
    ]);
    expect(flagged(`el("button", { title: "Copy this resource as JSON" })`)).toEqual(["title: <literal>"]);
    expect(
      flagged(`button("copy-pointer", "path", \`Copy the JSON Pointer (\${resource.pointer})\`)`, "src/render-resource.ts"),
    ).toContain("button() argument 2");
    expect(flagged(`button("raw", "raw", t().x)`, "src/render-resource.ts")).toEqual(["button() argument 1"]);
    expect(flagged(`el("span", { class: "chip__absent", text: "not in document" })`)).toEqual(["text: <literal>"]);
  });

  it("flags the other positions a literal can reach the person from", () => {
    expect(flagged(`node.textContent = "Loading"`)).toEqual([".textContent = <literal>"]);
    expect(flagged(`node.setAttribute("aria-label", "Close")`)).toEqual(["setAttribute(aria-label, <literal>)"]);
    expect(flagged("const h = `<a title=\"No resource\">x</a>`")).toEqual(['title="…" in markup']);
    expect(flagged(`toast("Saved")`)).toEqual(["toast(<literal>)"]);
    expect(flagged(`throw new DocumentError("Bad", "Really bad")`)).toEqual(["DocumentError(<literal>)"]);
    expect(flagged(`actionButton("x y", t().a, f)`)).toEqual(["actionButton() argument 0"]);
  });

  it("flags a template literal with words outside its holes, and passes one that is only holes", () => {
    expect(flagged("({ title: `Copy ${what}` })")).toEqual(["title: <literal>"]);
    expect(flagged("({ title: `${a} · ${b}` })")).toEqual([]);
    expect(flagged("({ text: `${n}` })")).toEqual([]);
  });

  it("does not flag catalogue lookups, symbols, comments or class names", () => {
    expect(flagged(`el("button", { "aria-label": t().value.copyValueTitle, title: m.x, text: "✕" })`)).toEqual([]);
    expect(flagged(`el("span", { class: "chip__absent", text: "•" })`)).toEqual([]);
    expect(flagged(`// { title: "Copy this value" }\n/* text: "Hello" */`)).toEqual([]);
    expect(flagged(`el("div", { class: "res__actions", "aria-hidden": "true" })`)).toEqual([]);
  });

  it("makes an unlisted button-shaped helper a decision rather than an oversight", () => {
    expect(flagged(`button("a", "b")`, "src/some-new-file.ts")).toEqual(["unclassified call to button()"]);
  });

  it("honours a documented exemption only for its own file", () => {
    expect(flagged(`el("span", { text: "null" })`, "src/render-value.ts")).toEqual([]);
    expect(flagged(`el("span", { text: "null" })`, "src/other.ts")).toEqual(["text: <literal>"]);
  });
});

describe("src/ has no user-facing literal outside the catalogues", () => {
  const files = Object.entries(SOURCES)
    .map(([path, text]) => ({ file: path.replace(/^\//, ""), text }))
    .filter(({ file }) => !file.startsWith("src/i18n/") && !file.startsWith("src/legal/"));

  it("scanned something", () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((f) => f.file === "src/render-resource.ts")).toBe(true);
    expect(files.some((f) => f.file === "src/i18n/en.ts")).toBe(false);
  });

  it("finds none", () => {
    const findings = files.flatMap(({ file, text }) => findHardcodedCopy(file, text));
    expect(findings.map((f) => `${f.file}: ${f.rule} ${f.literal}`)).toEqual([]);
  });

  it("every exemption still matches something, so the list cannot rot", () => {
    for (const exempt of EXEMPT) {
      const source = files.find((f) => f.file === exempt.file)?.text ?? "";
      expect(source, `${exempt.file} should contain ${exempt.literal}`).toContain(exempt.literal);
    }
  });
});
