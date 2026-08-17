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
