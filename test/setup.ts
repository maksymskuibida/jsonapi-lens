/**
 * jsdom does not expose `CSS.escape`, which `resourceSelector` uses. Rather
 * than weakening the production code with a fallback that would never run in a
 * browser, the spec algorithm is supplied here so the tests exercise the real
 * path.
 *
 * https://drafts.csswg.org/cssom/#serialize-an-identifier
 */
function escapeIdentifier(value: string): string {
  const string = String(value);
  let result = "";

  for (let i = 0; i < string.length; i++) {
    const code = string.charCodeAt(i);

    if (code === 0x0000) {
      result += "�";
      continue;
    }

    if (
      (code >= 0x0001 && code <= 0x001f) ||
      code === 0x007f ||
      (i === 0 && code >= 0x0030 && code <= 0x0039) ||
      (i === 1 && code >= 0x0030 && code <= 0x0039 && string.charCodeAt(0) === 0x002d)
    ) {
      result += "\\" + code.toString(16) + " ";
      continue;
    }

    if (i === 0 && code === 0x002d && string.length === 1) {
      result += "\\" + string.charAt(i);
      continue;
    }

    if (
      code >= 0x0080 ||
      code === 0x002d ||
      code === 0x005f ||
      (code >= 0x0030 && code <= 0x0039) ||
      (code >= 0x0041 && code <= 0x005a) ||
      (code >= 0x0061 && code <= 0x007a)
    ) {
      result += string.charAt(i);
      continue;
    }

    result += "\\" + string.charAt(i);
  }

  return result;
}

const existing = (globalThis as { CSS?: { escape?: (value: string) => string } }).CSS;

if (!existing?.escape) {
  Object.defineProperty(globalThis, "CSS", {
    configurable: true,
    writable: true,
    value: { ...existing, escape: escapeIdentifier },
  });
}

/**
 * Pin `navigator.language`/`navigator.languages` to English, for every test.
 *
 * jsdom already hardcodes these to `"en-US"`, so this is a no-op there. It is
 * not a no-op for a file marked `@vitest-environment node` — `crypto.test.ts`,
 * for one — because Node has shipped a real `navigator` since v21, and unlike
 * a browser's, its `language`/`languages` mirror the *host's* locale:
 * `LANG=de_DE.UTF-8 node -e "console.log(navigator.language)"` prints
 * `"de-DE"`. `src/i18n/index.ts#locale` negotiates through exactly this
 * property whenever no `?lang=` and no stored choice are present — both true
 * in a test — so any test exercising a code path that reads `t()` (the
 * `ShareError` messages `crypto.ts` throws, for one) would silently assert on
 * whichever language the machine or CI image happens to be set to. `de` and
 * `uk` are two of exactly three catalogues this app ships, so this is not a
 * far-fetched machine to run the suite on. See `docs/qa-reports` D6 and
 * `mcp/locale.ts`, which pins the same negotiation for the MCP server.
 *
 * Shadowing the two properties here, once, for the whole suite, is cheaper
 * than fixing it call site by call site and — being in `setupFiles`, which
 * vitest re-runs for every test file — cannot be bypassed by a new test that
 * forgets about it. `configurable: true` leaves a test that genuinely wants
 * to exercise locale negotiation free to redefine it for itself.
 */
if (typeof navigator !== "undefined") {
  Object.defineProperty(navigator, "language", { value: "en-US", configurable: true });
  Object.defineProperty(navigator, "languages", { value: ["en-US"], configurable: true });
}
