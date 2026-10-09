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
 * Beyond the property's own literal it reads the whole value expression, so
 * `x ?? "Fallback"` and `cond ? "Yes" : "No"` are caught; it also catches a
 * computed key (`["aria-label"]: …`), a string child of `el(...)`/`append(...)`,
 * words between tags in a markup string, and any helper whose name looks like
 * a button (`\w*Button`, `btn`) that it has not been told about.
 *
 * What it does **not** catch — said plainly, because a scan is not a proof:
 * a literal assigned to a variable first and passed on later; copy built by
 * concatenation; a literal inside a nested call's arguments to a catalogue
 * function; a literal inside a template's `${}` hole; a position this list does
 * not name. The list is the place to
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
    file: "src/render-request.ts",
    literal: "[REDACTED]",
    reason: "the redaction marker is a data token written into the exchange itself (D8) and is identical in every language; the mask cell shows what the share sends",
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
  refreshEditRequestButton: [{ file: "src/main.ts", args: [] }], // syncs a button's label; takes no copy
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

/** The expression that starts at `from`, up to the next top-level `,` or closing bracket. */
function valueExpression(source: string, from: number): string {
  let depth = 0;
  for (let i = from; i < source.length; i++) {
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
      if (depth === 0) return source.slice(from, i);
      depth--;
    } else if ((ch === "," || ch === ";") && depth === 0) return source.slice(from, i);
  }
  return source.slice(from);
}

/**
 * Every string or template literal at the top level of an expression: not
 * those inside a nested call, array or object (a nested `el(...)` is scanned as
 * a call of its own), and not those inside a template's `${}` holes.
 */
function literalsIn(expression: string): string[] {
  const found: string[] = [];
  let depth = 0;
  for (let i = 0; i < expression.length; i++) {
    const ch = expression[i]!;
    if (ch === '"' || ch === "'" || ch === "`") {
      const lit = readLiteral(expression.slice(i));
      if (lit) {
        // A literal on either side of a comparison is a value being tested
        // (`typeof x === "string"`), not words shown to anyone.
        const compared =
          /[!=]==?\s*$/.test(expression.slice(0, i)) || /^\s*[!=]==?/.test(expression.slice(i + lit.length));
        if (depth === 0 && !compared) found.push(lit);
        i += lit.length - 1;
      }
    } else if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
  }
  return found;
}

/** The source with every `${...}` hole emptied, so markup scans see only what is literal. */
function stripHoles(source: string): string {
  let out = source;
  for (let guard = 0; guard < 16 && out.includes("${"); guard++) out = out.replace(/\$\{[^{}]*\}/g, "");
  return out;
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
    if (EXEMPT.some((e) => e.file === file && text === e.literal)) return;
    found.push({ file, rule, literal });
  };

  // Property or attribute whose value *expression* carries a literal:
  // { title: "…" }, { ["aria-label"]: `…` }, { title: x ?? "Fallback" }, { title: c ? "Yes" : "No" }.
  const PROP =
    /\[?["']?\b(aria-label|aria-description|aria-roledescription|aria-placeholder|aria-valuetext|title|placeholder|alt|text)\b["']?\]?\s*:\s*/g;
  for (let m; (m = PROP.exec(source)); ) {
    for (const lit of literalsIn(valueExpression(source, m.index + m[0].length))) report(`${m[1]}: <literal>`, lit);
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

  // Words between tags in a markup string: <span class="x">Not in document</span>.
  const TEXT_BETWEEN = /<[a-z][a-z0-9-]*(?:\s[^<>]*)?>([^<>]*\p{L}[^<>]*)<\/[a-z]/giu;
  const holeless = stripHoles(source);
  for (let m; (m = TEXT_BETWEEN.exec(holeless)); ) report("text between tags in markup", `"${m[1]}"`);

  // A string child of el(...), or handed to append()/prepend()/replaceChildren().
  const CHILDREN = /\b(el|frag|append|prepend|replaceChildren)\(/g;
  for (let m; (m = CHILDREN.exec(source)); ) {
    const before = source.slice(Math.max(0, m.index - 10), m.index);
    if (/function\s+$/.test(before)) continue;
    const args = callArguments(source, m.index + m[0].length - 1);
    args.forEach((arg, index) => {
      if (m![1] === "el" && index < 2) return; // the tag and the props
      if (arg.startsWith("{")) return;
      for (const lit of literalsIn(arg)) report(`${m![1]}() string child`, lit);
    });
  }

  // Callers that put a string straight in front of the person.
  const SINKS = /\b(toast|DocumentError|ShareError)\(\s*/g;
  for (let m; (m = SINKS.exec(source)); ) {
    const lit = readLiteral(source.slice(m.index + m[0].length));
    if (lit) report(`${m[1]}(<literal>)`, lit);
  }

  // Any button-shaped helper, by argument position. The name is matched by
  // shape (`button`, `iconButton`, `makeButton`, `btn`), so a new one is caught
  // before anyone remembers to list it.
  const HELPERS = /\b(\w*[Bb]utton|btn)\(/g;
  for (let m; (m = HELPERS.exec(source)); ) {
    // A declaration (`function actionButton(`) is not a call.
    const before = source.slice(Math.max(0, m.index - 12), m.index);
    if (/function\s+$/.test(before)) continue;
    const table = HELPER_COPY_ARGS[m[1]!] ?? [];
    const entry = table.find((e) => e.file === undefined || e.file === file);
    const args = callArguments(source, m.index + m[0].length - 1);
    if (!entry) {
      found.push({ file, rule: `unclassified call to ${m[1]}()`, literal: args.join(", ") });
      continue;
    }
    for (const index of entry.args) {
      const arg = args[index];
      if (arg) for (const lit of literalsIn(arg)) report(`${m[1]}() argument ${index}`, lit);
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
    expect(flagged("const h = `<a title=\"No resource\">${x}</a>`")).toEqual(['title="…" in markup']);
    expect(flagged(`toast("Saved")`)).toEqual(["toast(<literal>)"]);
    expect(flagged(`throw new DocumentError("Bad", "Really bad")`)).toEqual(["DocumentError(<literal>)"]);
    expect(flagged(`actionButton("x y", t().a, f)`)).toEqual(["actionButton() argument 0"]);
  });

  it("flags the walk-arounds a reviewer found (QA5 review, S4): fallbacks, ternaries, computed keys, string children, markup text, any button-shaped helper", () => {
    expect(flagged(`({ title: x ?? "Fallback" })`)).toEqual(["title: <literal>"]);
    expect(flagged(`({ title: cond ? "Yes" : "No" })`)).toEqual(["title: <literal>", "title: <literal>"]);
    expect(flagged(`({ ["aria-label"]: "Close" })`)).toEqual(["aria-label: <literal>"]);
    expect(flagged(`({ "aria-label": t().a || "Close" })`)).toEqual(["aria-label: <literal>"]);
    expect(flagged(`el("p", { class: "x" }, "Some text")`)).toEqual(["el() string child"]);
    expect(flagged(`el("p", {}, a, cond ? "Some" : t().b)`)).toEqual(["el() string child"]);
    expect(flagged(`node.append("Hello", el("b", {}, t().x))`)).toEqual(["append() string child"]);
    expect(flagged("const h = `<span class=\"x\">Not in document</span>`")).toEqual(["text between tags in markup"]);
    expect(flagged(`iconButton("a", "b")`)).toEqual(["unclassified call to iconButton()"]);
    expect(flagged(`btn("a")`)).toEqual(["unclassified call to btn()"]);
  });

  it("does not flag comparisons, class names, symbols or nested catalogue calls", () => {
    expect(flagged(`if (typeof value === "string" || kind !== "function") {}`)).toEqual([]);
    expect(flagged(`el("p", { class: "a b" }, a, "·", b)`)).toEqual([]);
    expect(flagged("const h = `<span class=\"x\">${escapeHtml(t().a)}</span>`")).toEqual([]);
    expect(flagged(`({ title: t().a.b("x") })`)).toEqual([]);
  });

  it("an exemption matches the exact word only, not anything containing it", () => {
    expect(flagged(`el("span", { text: "Value is null" })`, "src/render-value.ts")).toEqual(["text: <literal>"]);
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
