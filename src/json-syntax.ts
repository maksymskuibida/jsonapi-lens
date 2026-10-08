/**
 * Where, and in what way, a piece of text stops being JSON.
 *
 * `JSON.parse` already knows — and tells us, in English, in a wording that
 * differs between V8, SpiderMonkey and JavaScriptCore ("Unexpected token 'Q',
 * "QA synthet"... is not valid JSON", "unexpected character at line 1 column
 * 1", "Unexpected identifier "QA""). That message used to be pasted into the
 * parse-error hint, which put an engine's English inside a German or Ukrainian
 * sentence, echoed the first characters of the input, and — because only the
 * older V8 wording carries "position N" — usually could not say *where*.
 *
 * So the message is not used for anything. This module is a small validator
 * that runs **only after `JSON.parse` has already failed**, finds the first
 * offending offset itself, and returns a *kind* the catalogues can word in
 * their own language, plus a line and column. The browser, the language and
 * the engine version no longer change what the person sees.
 *
 * It is iterative, with an explicit stack, rather than recursive: the input is
 * a pasted production payload, and a deeply nested document that is also
 * malformed must not turn a readable error into a "Maximum call stack size
 * exceeded".
 *
 * Pure: no DOM, no `t()`, nothing from the rest of the app. The caller words
 * the result.
 */

/** Why the text is not JSON, at the first place it stops being so. */
export type SyntaxProblem =
  /** A character that cannot appear here. `char` is the code point, as written. */
  | { readonly kind: "unexpected-char"; readonly char: string }
  /** The text ended inside a value, or with a container still open. */
  | { readonly kind: "unexpected-end" }
  /** `,` directly before a closing `}` or `]`. */
  | { readonly kind: "trailing-comma" }
  /** A raw line break or other control character inside a string. */
  | { readonly kind: "control-in-string" }
  /** A backslash followed by something JSON does not define, or a short `\u` escape. */
  | { readonly kind: "bad-escape" }
  /** A complete value, then more text. `char` is the first character of the extra text. */
  | { readonly kind: "extra-content"; readonly char: string };

export interface SyntaxLocation {
  readonly problem: SyntaxProblem;
  /** UTF-16 offset into the text that was scanned. */
  readonly offset: number;
}

/** Position in text a person can find: both 1-based, columns counted in characters. */
export interface LineColumn {
  readonly line: number;
  readonly column: number;
}

/** JSON whitespace is these four characters and no others. */
function isWs(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

function isDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

function isHex(code: number): boolean {
  return isDigit(code) || (code >= 0x41 && code <= 0x46) || (code >= 0x61 && code <= 0x66);
}

/**
 * The whole code point at `offset`, as something a person can read in a
 * sentence: an astral character is not reported as half a surrogate pair, and
 * one that cannot be seen (a non-breaking space, a zero-width joiner, a control
 * character) is named by its code point instead, since a hint reading
 * "unexpected character: " followed by nothing is no hint at all.
 */
function charAt(text: string, offset: number): string {
  const point = text.codePointAt(offset);
  if (point === undefined) return "";
  const ch = String.fromCodePoint(point);
  if (/[\p{C}\p{Z}]/u.test(ch)) return `U+${point.toString(16).toUpperCase().padStart(4, "0")}`;
  return ch;
}

/**
 * Line and column of a UTF-16 `offset` in `text`.
 *
 * `\r\n`, `\n` and a lone `\r` each end a line once, so a Windows paste and a
 * Unix paste report the same line for the same place. Columns count code
 * points, so an emoji earlier on the line does not push the column by two.
 */
export function lineColumnAt(text: string, offset: number): LineColumn {
  let line = 1;
  let lineStart = 0;
  const end = Math.min(offset, text.length);
  for (let i = 0; i < end; i++) {
    const code = text.charCodeAt(i);
    if (code === 0x0a) {
      line++;
      lineStart = i + 1;
    } else if (code === 0x0d) {
      if (text.charCodeAt(i + 1) === 0x0a) continue; // the \n counts it
      line++;
      lineStart = i + 1;
    }
  }
  let column = 1;
  for (let i = lineStart; i < end; i++) {
    const code = text.charCodeAt(i);
    // The low half of a surrogate pair does not start a new character.
    if (code >= 0xdc00 && code <= 0xdfff) continue;
    column++;
  }
  return { line, column };
}

/**
 * Find the first place `text` stops being valid JSON. `null` when the scanner
 * finds nothing wrong — which means the caller should say so rather than
 * guess, since `JSON.parse` disagreeing with this function is a bug here, not
 * in the input.
 */
export function locateSyntaxError(text: string): SyntaxLocation | null {
  const n = text.length;
  let i = 0;

  const fail = (problem: SyntaxProblem, at: number): SyntaxLocation => ({ problem, offset: at });
  /** Fail at `at`: the end of the text is `unexpected-end`, anything else is a stray character. */
  const stray = (at: number): SyntaxLocation =>
    at >= n ? fail({ kind: "unexpected-end" }, n) : fail({ kind: "unexpected-char", char: charAt(text, at) }, at);

  const skipWs = (): void => {
    while (i < n && isWs(text.charCodeAt(i))) i++;
  };

  /** Scan a string whose opening quote is at `i`. Returns a failure, or `null` with `i` past the closing quote. */
  const scanString = (): SyntaxLocation | null => {
    i++; // the opening quote
    while (i < n) {
      const code = text.charCodeAt(i);
      if (code === 0x22) {
        i++;
        return null;
      }
      if (code < 0x20) return fail({ kind: "control-in-string" }, i);
      if (code === 0x5c) {
        const next = text.charCodeAt(i + 1);
        if (i + 1 >= n) return fail({ kind: "unexpected-end" }, n);
        if (next === 0x75) {
          for (let k = 2; k <= 5; k++) {
            if (i + k >= n) return fail({ kind: "unexpected-end" }, n);
            if (!isHex(text.charCodeAt(i + k))) return fail({ kind: "bad-escape" }, i + k);
          }
          i += 6;
          continue;
        }
        // `"` `\` `/` `b` `f` `n` `r` `t`
        if ('"\\/bfnrt'.includes(text[i + 1]!)) {
          i += 2;
          continue;
        }
        return fail({ kind: "bad-escape" }, i + 1);
      }
      i++;
    }
    return fail({ kind: "unexpected-end" }, n);
  };

  const scanNumber = (): SyntaxLocation | null => {
    if (text.charCodeAt(i) === 0x2d) i++;
    if (i >= n) return stray(i);
    if (text.charCodeAt(i) === 0x30) {
      i++;
    } else if (isDigit(text.charCodeAt(i))) {
      while (i < n && isDigit(text.charCodeAt(i))) i++;
    } else {
      return stray(i);
    }
    if (text.charCodeAt(i) === 0x2e) {
      i++;
      if (!(i < n && isDigit(text.charCodeAt(i)))) return stray(i);
      while (i < n && isDigit(text.charCodeAt(i))) i++;
    }
    const e = text.charCodeAt(i);
    if (e === 0x65 || e === 0x45) {
      i++;
      const sign = text.charCodeAt(i);
      if (sign === 0x2b || sign === 0x2d) i++;
      if (!(i < n && isDigit(text.charCodeAt(i)))) return stray(i);
      while (i < n && isDigit(text.charCodeAt(i))) i++;
    }
    return null;
  };

  const scanLiteral = (word: string): SyntaxLocation | null => {
    for (let k = 0; k < word.length; k++) {
      if (text[i + k] !== word[k]) return stray(i + k);
    }
    i += word.length;
    return null;
  };

  /** Containers still open: `{` or `[`. */
  const stack: ("{" | "[")[] = [];
  /** What the grammar wants next. */
  let want: "value" | "key-or-end" | "key" | "colon" | "after-value" | "value-or-end" = "value";
  /** Was the last significant character a comma? Decides `trailing-comma` over `unexpected-char`. */
  let afterComma = false;

  for (;;) {
    skipWs();

    switch (want) {
      case "value":
      case "value-or-end": {
        if (i >= n) return fail({ kind: "unexpected-end" }, n);
        const ch = text[i]!;
        if (want === "value-or-end" && ch === "]") {
          stack.pop();
          i++;
          want = "after-value";
          afterComma = false;
          break;
        }
        afterComma = false;
        let failure: SyntaxLocation | null = null;
        if (ch === "{") {
          stack.push("{");
          i++;
          want = "key-or-end";
          break;
        } else if (ch === "[") {
          stack.push("[");
          i++;
          want = "value-or-end";
          break;
        } else if (ch === '"') failure = scanString();
        else if (ch === "-" || isDigit(ch.charCodeAt(0))) failure = scanNumber();
        else if (ch === "t") failure = scanLiteral("true");
        else if (ch === "f") failure = scanLiteral("false");
        else if (ch === "n") failure = scanLiteral("null");
        else return stray(i);
        if (failure) return failure;
        want = "after-value";
        break;
      }

      case "key-or-end":
      case "key": {
        if (i >= n) return fail({ kind: "unexpected-end" }, n);
        const ch = text[i]!;
        if (want === "key-or-end" && ch === "}") {
          stack.pop();
          i++;
          want = "after-value";
          break;
        }
        if (ch !== '"') {
          if (ch === "}" && afterComma) return fail({ kind: "trailing-comma" }, i);
          return stray(i);
        }
        const failure = scanString();
        if (failure) return failure;
        afterComma = false;
        want = "colon";
        break;
      }

      case "colon": {
        if (i >= n) return fail({ kind: "unexpected-end" }, n);
        if (text[i] !== ":") return stray(i);
        i++;
        want = "value";
        break;
      }

      case "after-value": {
        const top = stack[stack.length - 1];
        if (top === undefined) {
          // The document is complete; anything but whitespace is extra.
          if (i >= n) return null;
          return fail({ kind: "extra-content", char: charAt(text, i) }, i);
        }
        if (i >= n) return fail({ kind: "unexpected-end" }, n);
        const ch = text[i]!;
        if (ch === ",") {
          i++;
          afterComma = true;
          if (top === "{") {
            want = "key";
          } else {
            // `[1,]` — look ahead so the closing bracket is named, not "unexpected".
            skipWs();
            if (text[i] === "]") return fail({ kind: "trailing-comma" }, i);
            want = "value";
          }
          break;
        }
        if ((ch === "}" && top === "{") || (ch === "]" && top === "[")) {
          stack.pop();
          i++;
          break;
        }
        return stray(i);
      }
    }
  }
}
