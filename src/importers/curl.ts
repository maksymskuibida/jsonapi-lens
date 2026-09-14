/**
 * The cURL importer — `docs/task-specs/T3.md` importer #1.
 *
 * A devtools "Copy as cURL" command is a shell command, not a wire format, so
 * this module's first job is a small shell-like tokenizer
 * (`tokenizeShellCommand`) before any curl-specific flag handling starts. Two
 * simplifications are deliberate and documented here rather than per call
 * site, because they are properties of the *tokenizer*, not of any one flag:
 *
 *   - **Line continuations are joined textually before tokenizing**, by
 *     stripping `\` or `^` immediately followed by a newline. This is what
 *     "Copy as cURL (bash)" and "Copy as cURL (cmd)" both produce, and it is
 *     enough to join them correctly for the common case — a continuation
 *     outside any quotes. A backslash-newline that happens to sit *inside* a
 *     single-quoted string (where POSIX shells do not treat it as a
 *     continuation at all) is not distinguished from one outside; this is a
 *     tokenizer-wide approximation, not a per-flag limitation, and no
 *     generated devtools command produces that shape.
 *   - **Only the continuation convention of `cmd.exe`-style commands is
 *     honoured, not its quoting.** A real `cmd.exe` paste also doubles `"` as
 *     `""` and can carry `^`-escaped metacharacters outside quotes; neither
 *     is attempted. The bash-style tokenizer runs on the line-joined text
 *     regardless of which continuation character joined it, which is
 *     sufficient for the flags this importer recognises but not a full
 *     `cmd.exe` grammar.
 *
 * Every flag this importer does not recognise is skipped with a warning
 * naming it, per the spec — never a failure, and never silently dropped
 * without saying so. A run of flags this importer *does* recognise but has
 * nothing to do with (`-s`, `-v`, `-L`, `-k`, timeouts, `-o`, a proxy, …) is
 * treated differently again: understood and intentionally not modelled, so
 * it produces no warning at all — warning on every `-s` a browser's devtools
 * attaches by default would drown the warnings that matter.
 *
 * Text in, `Partial<Exchange>` out — no DOM, no `t()` at module scope, no
 * network. See `./types.ts`.
 */

import type { BodyPart, Exchange } from "../exchange.js";
import type { HeaderSet } from "../headers.js";
import { addHeader, hasHeader, headerSet } from "../headers.js";
import { parseCookieHeader } from "../cookies.js";
import { encodeParams } from "../params.js";
import { t } from "../i18n/index.js";
import { shouldMaskHeader } from "../secrets.js";
import { lineFromOffset, safeDecodeParams, splitUrl, toBase64Standard, utf8Encode } from "./shared.js";
import type { Detection, ImportResult, Importer } from "./types.js";
import { ImportError } from "./types.js";

export const CURL_ID = "curl";

/* ------------------------------------------------------------ tokenizer --- */

interface TokenizeError {
  position: number;
  quote: "'" | '"' | "$'";
}

interface TokenizeResult {
  tokens: string[];
  error?: TokenizeError;
}

const ANSI_C_ESCAPES: Record<string, string> = {
  n: "\n",
  t: "\t",
  r: "\r",
  "\\": "\\",
  "'": "'",
  '"': '"',
  a: "\x07",
  b: "\b",
  f: "\f",
  v: "\v",
  e: "\x1b",
};

/** Join `\<newline>` (bash) and `^<newline>` (`cmd.exe`) continuations before tokenizing — see this file's header. */
function joinContinuations(text: string): string {
  return text.replace(/\\\r?\n/g, "").replace(/\^\r?\n/g, "");
}

function isShellSpace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

/**
 * A small POSIX-ish shell tokenizer: unquoted words (backslash escapes the
 * next character), single quotes (fully literal), double quotes (backslash
 * escapes `\`, `"`, `$`, `` ` `` only), and `$'…'` ANSI-C quoting with the
 * common escapes. Adjacent quoted/unquoted parts with no separating
 * whitespace concatenate into one token, exactly as a real shell does —
 * `-H'Accept: text/plain'` is one token, not two.
 *
 * Returns every token found even when it also returns an `error` — the
 * *positions* found before the unterminated quote are still useful context
 * for a caller reporting the failure, but the caller must check `error`
 * before trusting the result as complete.
 */
function tokenizeShellCommand(text: string): TokenizeResult {
  const tokens: string[] = [];
  const n = text.length;
  let i = 0;

  while (i < n) {
    while (i < n && isShellSpace(text[i]!)) i++;
    if (i >= n) break;

    let word = "";
    let present = false;

    while (i < n && !isShellSpace(text[i]!)) {
      present = true;
      const ch = text[i]!;

      if (ch === "'") {
        const close = text.indexOf("'", i + 1);
        if (close < 0) return { tokens, error: { position: i, quote: "'" } };
        word += text.slice(i + 1, close);
        i = close + 1;
        continue;
      }

      if (ch === '"') {
        const start = i;
        i++;
        let closed = false;
        while (i < n) {
          const c = text[i]!;
          if (c === '"') {
            closed = true;
            i++;
            break;
          }
          if (c === "\\" && i + 1 < n && /["\\$`]/.test(text[i + 1]!)) {
            word += text[i + 1];
            i += 2;
            continue;
          }
          word += c;
          i++;
        }
        if (!closed) return { tokens, error: { position: start, quote: '"' } };
        continue;
      }

      if (ch === "$" && text[i + 1] === "'") {
        const start = i;
        i += 2;
        let closed = false;
        while (i < n) {
          const c = text[i]!;
          if (c === "'") {
            closed = true;
            i++;
            break;
          }
          if (c === "\\" && i + 1 < n) {
            const esc = text[i + 1]!;
            if (esc === "x" && /^[0-9a-fA-F]{2}$/.test(text.slice(i + 2, i + 4))) {
              word += String.fromCharCode(parseInt(text.slice(i + 2, i + 4), 16));
              i += 4;
              continue;
            }
            word += ANSI_C_ESCAPES[esc] ?? esc;
            i += 2;
            continue;
          }
          word += c;
          i++;
        }
        if (!closed) return { tokens, error: { position: start, quote: "$'" } };
        continue;
      }

      if (ch === "\\") {
        if (i + 1 < n) {
          word += text[i + 1];
          i += 2;
        } else {
          i++;
        }
        continue;
      }

      word += ch;
      i++;
    }

    if (present) tokens.push(word);
  }

  return { tokens };
}

/* ------------------------------------------------------------- detection --- */

const CURL_START = /^\s*(?:\$\s+)?curl(?:\.exe)?(?:\s|$)/i;

export function detectCurl(text: string): Detection | null {
  if (!CURL_START.test(text)) return null;

  const { tokens } = tokenizeShellCommand(joinContinuations(text));
  let headerCount = 0;
  let hasData = false;
  let method: string | undefined;
  for (let i = 1; i < tokens.length; i++) {
    const tok = tokens[i]!;
    if (tok === "-H" || tok === "--header" || tok.startsWith("--header=")) headerCount++;
    if (/^(-d|--data|--data-raw|--data-binary|--data-ascii|--data-urlencode|-F|--form)(=|$)/.test(tok)) {
      hasData = true;
    }
    if ((tok === "-X" || tok === "--request") && tokens[i + 1]) method = tokens[i + 1];
    if (tok.startsWith("--request=")) method = tok.slice("--request=".length);
  }

  return {
    id: CURL_ID,
    confidence: 0.95,
    summary: t().import.curl.summary(method ?? (hasData ? "POST" : "GET"), headerCount),
  };
}

/* ------------------------------------------------------------------ flags --- */

/** Boolean flags this importer understands and deliberately does not model — recognised, never warned about. */
const KNOWN_NOOP_BOOLEAN = new Set([
  "-s",
  "--silent",
  "-S",
  "--show-error",
  "-v",
  "--verbose",
  "-i",
  "--include",
  "-k",
  "--insecure",
  "-L",
  "--location",
  "-f",
  "--fail",
  "-#",
  "--progress-bar",
  "-4",
  "--ipv4",
  "-6",
  "--ipv6",
  "-N",
  "--no-buffer",
  "--http1.0",
  "--http1.1",
  "--http2",
]);

/** No-op flags that take one argument this importer understands and discards without comment. */
const KNOWN_NOOP_WITH_ARG = new Set([
  "-o",
  "--output",
  "-w",
  "--write-out",
  "-m",
  "--max-time",
  "--connect-timeout",
  "--retry",
  "--proto",
  "-x",
  "--proxy",
  "--cacert",
  "--cert",
  "--key",
  "-y",
  "--speed-time",
  "-Y",
  "--speed-limit",
]);

function stripPrefixedValue(token: string, short: string, long: string): string | undefined {
  if (token === short || token === long) return undefined; // value is the next token
  if (token.startsWith(`${long}=`)) return token.slice(long.length + 1);
  if (short.length === 2 && token.startsWith(short) && token.length > short.length) {
    return token.slice(short.length);
  }
  return undefined;
}

/** `true` when `token` is exactly this flag or its `--long=`/`-Xvalue` attached form — used to decide whether the *next* token is consumed as a value. */
function isAttachedForm(token: string, short: string, long: string): boolean {
  return token.startsWith(`${long}=`) || (short.length === 2 && token.startsWith(short) && token.length > short.length);
}

interface FlagMatch {
  short: string;
  long: string;
}

const VALUE_FLAGS = {
  method: { short: "-X", long: "--request" },
  header: { short: "-H", long: "--header" },
  data: { short: "-d", long: "--data" },
  dataAscii: { short: "\0", long: "--data-ascii" },
  dataRaw: { short: "\0", long: "--data-raw" },
  dataBinary: { short: "\0", long: "--data-binary" },
  dataUrlencode: { short: "\0", long: "--data-urlencode" },
  form: { short: "-F", long: "--form" },
  cookie: { short: "-b", long: "--cookie" },
  user: { short: "-u", long: "--user" },
  userAgent: { short: "-A", long: "--user-agent" },
  referer: { short: "-e", long: "--referer" },
} satisfies Record<string, FlagMatch>;

function matches(token: string, flag: FlagMatch): boolean {
  return token === flag.short || token === flag.long || isAttachedForm(token, flag.short, flag.long);
}

function valueOf(token: string, flag: FlagMatch, next: string | undefined, consumeNext: () => void): string | undefined {
  const attached = stripPrefixedValue(token, flag.short, flag.long);
  if (attached !== undefined) return attached;
  consumeNext();
  return next;
}

/*
 * Data-family argument handling. Only a leading `@` is a file reference for
 * `-d`/`--data`/`--data-ascii`/`--data-binary` — unlike `-F`/`--form` below,
 * these have no `<file` reading form at all, so `<` here is ordinary literal
 * text, not a file reference this importer cannot follow.
 */
function dataChunkOrSkip(arg: string, allowsAt: boolean): { chunk?: string; skippedFile?: string } {
  if (allowsAt && arg.startsWith("@")) return { skippedFile: arg };
  return { chunk: arg };
}

function urlencodeChunk(arg: string): { chunk?: string; skippedFile?: string } {
  const eq = arg.indexOf("=");
  const at = arg.indexOf("@");
  if (at >= 0 && (eq < 0 || at < eq)) return { skippedFile: arg };
  if (eq < 0) return { chunk: encodeURIComponent(arg) };
  if (eq === 0) return { chunk: encodeURIComponent(arg.slice(1)) };
  return { chunk: `${arg.slice(0, eq)}=${encodeURIComponent(arg.slice(eq + 1))}` };
}

interface FormField {
  name: string;
  value: string;
  isFile: boolean;
}

function parseFormField(arg: string): FormField | null {
  const eq = arg.indexOf("=");
  if (eq < 0) return null;
  const name = arg.slice(0, eq);
  const rawValue = arg.slice(eq + 1);
  const isFile = rawValue.startsWith("@") || rawValue.startsWith("<");
  const value = isFile ? (rawValue.slice(1).split(";")[0] ?? rawValue.slice(1)) : rawValue;
  return { name, value, isFile };
}

/* -------------------------------------------------------------------- parse --- */

export function parseCurl(text: string): ImportResult {
  const joined = joinContinuations(text);
  const { tokens, error } = tokenizeShellCommand(joined);

  if (error) {
    const line = lineFromOffset(joined, error.position);
    throw new ImportError(
      t().import.curl.errors.unbalancedQuote.headline,
      t().import.curl.errors.unbalancedQuote.hint(error.quote),
      line,
    );
  }

  if (tokens.length === 0 || !/^curl(\.exe)?$/i.test(tokens[0]!)) {
    throw new ImportError(t().import.curl.errors.notACommand.headline, t().import.curl.errors.notACommand.hint);
  }

  const warnings: string[] = [];
  let headers: HeaderSet = headerSet([]);
  let method: string | undefined;
  let url: string | undefined;
  let useGet = false;
  let compressed = false;
  const dataParts: string[] = [];
  const formFields: FormField[] = [];
  let cookieValue: string | undefined;

  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i]!;
    let nextConsumed = false;
    const consumeNext = () => {
      nextConsumed = true;
    };
    const next = tokens[i + 1];

    if (matches(token, VALUE_FLAGS.method)) {
      method = valueOf(token, VALUE_FLAGS.method, next, consumeNext);
    } else if (matches(token, VALUE_FLAGS.header)) {
      const raw = valueOf(token, VALUE_FLAGS.header, next, consumeNext);
      if (raw !== undefined) {
        const colon = raw.indexOf(":");
        if (colon >= 0) {
          headers = addHeader(headers, raw.slice(0, colon).trim(), raw.slice(colon + 1).trim());
        } else if (raw.trimEnd().endsWith(";")) {
          headers = addHeader(headers, raw.trimEnd().slice(0, -1).trim(), "");
        } else {
          warnings.push(t().import.curl.warnings.malformedHeader(raw));
        }
      }
    } else if (matches(token, VALUE_FLAGS.data) || matches(token, VALUE_FLAGS.dataAscii)) {
      const flag = matches(token, VALUE_FLAGS.data) ? VALUE_FLAGS.data : VALUE_FLAGS.dataAscii;
      const raw = valueOf(token, flag, next, consumeNext);
      if (raw !== undefined) {
        const { chunk, skippedFile } = dataChunkOrSkip(raw, true);
        if (chunk !== undefined) dataParts.push(chunk);
        if (skippedFile !== undefined) warnings.push(t().import.curl.warnings.fileNotReadable(skippedFile));
      }
    } else if (matches(token, VALUE_FLAGS.dataRaw)) {
      const raw = valueOf(token, VALUE_FLAGS.dataRaw, next, consumeNext);
      if (raw !== undefined) dataParts.push(raw);
    } else if (matches(token, VALUE_FLAGS.dataBinary)) {
      const raw = valueOf(token, VALUE_FLAGS.dataBinary, next, consumeNext);
      if (raw !== undefined) {
        const { chunk, skippedFile } = dataChunkOrSkip(raw, true);
        if (chunk !== undefined) dataParts.push(chunk);
        if (skippedFile !== undefined) warnings.push(t().import.curl.warnings.fileNotReadable(skippedFile));
      }
    } else if (matches(token, VALUE_FLAGS.dataUrlencode)) {
      const raw = valueOf(token, VALUE_FLAGS.dataUrlencode, next, consumeNext);
      if (raw !== undefined) {
        const { chunk, skippedFile } = urlencodeChunk(raw);
        if (chunk !== undefined) dataParts.push(chunk);
        if (skippedFile !== undefined) warnings.push(t().import.curl.warnings.fileNotReadable(skippedFile));
      }
    } else if (matches(token, VALUE_FLAGS.form)) {
      const raw = valueOf(token, VALUE_FLAGS.form, next, consumeNext);
      if (raw !== undefined) {
        const field = parseFormField(raw);
        if (field) {
          formFields.push(field);
          if (field.isFile) warnings.push(t().import.curl.warnings.fileNotReadable(raw));
        } else {
          warnings.push(t().import.curl.warnings.malformedForm(raw));
        }
      }
    } else if (matches(token, VALUE_FLAGS.cookie)) {
      const raw = valueOf(token, VALUE_FLAGS.cookie, next, consumeNext);
      if (raw !== undefined) {
        if (raw.includes("=")) cookieValue = raw;
        else warnings.push(t().import.curl.warnings.fileNotReadable(raw));
      }
    } else if (matches(token, VALUE_FLAGS.user)) {
      const raw = valueOf(token, VALUE_FLAGS.user, next, consumeNext);
      if (raw !== undefined) {
        const encoded = toBase64Standard(utf8Encode(raw));
        headers = addHeader(headers, "Authorization", `Basic ${encoded}`);
      }
    } else if (matches(token, VALUE_FLAGS.userAgent)) {
      const raw = valueOf(token, VALUE_FLAGS.userAgent, next, consumeNext);
      if (raw !== undefined) headers = addHeader(headers, "User-Agent", raw);
    } else if (matches(token, VALUE_FLAGS.referer)) {
      const raw = valueOf(token, VALUE_FLAGS.referer, next, consumeNext);
      if (raw !== undefined) headers = addHeader(headers, "Referer", raw);
    } else if (token === "-G" || token === "--get") {
      useGet = true;
    } else if (token === "--compressed") {
      compressed = true;
    } else if (KNOWN_NOOP_BOOLEAN.has(token)) {
      /* understood, deliberately not modelled */
    } else if (KNOWN_NOOP_WITH_ARG.has(token)) {
      consumeNext();
    } else if (token.startsWith("-") && token !== "-") {
      warnings.push(t().import.curl.warnings.unknownFlag(token));
    } else if (url === undefined) {
      url = token;
    } else {
      warnings.push(t().import.curl.warnings.extraUrl(token));
    }

    if (nextConsumed) i++;
  }

  if (compressed && !hasHeader(headers, "accept-encoding")) {
    headers = addHeader(headers, "Accept-Encoding", "gzip, deflate, br");
  }

  const split = url !== undefined ? splitUrl(url) : null;
  if (url !== undefined && split === null) warnings.push(t().import.common.urlUnparseable(url));
  if (split?.queryUndecodable) warnings.push(t().import.common.queryUndecodable);

  const finalUrl = split?.base ?? url;
  let query = split?.query;
  if (split?.assumedScheme) warnings.push(t().import.common.schemeAssumed);

  if (useGet && dataParts.length > 0) {
    // `-G` moves body params to the query — combine whatever the URL already
    // carried with the `-d`-family contributions, re-deriving wire text from
    // the already-decoded query (`encodeParams`) rather than re-parsing the
    // URL a second time.
    const existingSearch = split?.query ? encodeParams(split.query) : "";
    const extra = dataParts.join("&");
    const combined = safeDecodeParams([existingSearch, extra].filter((s) => s.length > 0).join("&"));
    if (combined !== null) query = combined;
    else warnings.push(t().import.common.queryUndecodable);
  }

  let body: BodyPart | undefined;
  if (!useGet && formFields.length > 0) {
    const raw = formFields
      .map((f) => (f.isFile ? `${f.name}=@${f.value} (${t().import.curl.fileContentUnavailable})` : `${f.name}=${f.value}`))
      .join("\n");
    body = { raw, contentType: "multipart/form-data" };
  } else if (!useGet && dataParts.length > 0) {
    const raw = dataParts.join("&");
    const decodedForm = safeDecodeParams(raw);
    body = { raw, contentType: "application/x-www-form-urlencoded" };
    if (decodedForm !== null) body.form = decodedForm;
    else warnings.push(t().import.common.queryUndecodable);
  }

  if (method === undefined) {
    method = useGet ? "GET" : formFields.length > 0 || dataParts.length > 0 ? "POST" : "GET";
  }

  const cookies = cookieValue !== undefined ? { entries: parseCookieHeader(cookieValue) } : undefined;

  const request: NonNullable<Exchange["request"]> = { method };
  if (finalUrl !== undefined) request.url = finalUrl;
  if (query !== undefined) request.query = query;
  if (headers.entries.length > 0) request.headers = headers;
  if (cookies !== undefined) request.cookies = cookies;
  if (body !== undefined) request.body = body;

  const secretCount = headers.entries.filter((h) => shouldMaskHeader(h.name, h.value)).length;
  if (secretCount > 0) warnings.push(t().import.common.secretsMasked(secretCount));

  const exchange: Partial<Exchange> = { request, origin: { kind: CURL_ID } };
  return { exchanges: [exchange], warnings };
}

export const curlImporter: Importer = { id: CURL_ID, detect: detectCurl, parse: parseCurl };
