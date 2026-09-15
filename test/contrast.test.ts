// @vitest-environment node
/**
 * Text tokens meet WCAG AA against the surfaces they are used on.
 *
 * Found by a blind QA pass: `--text-3` measured 3.26:1 against the footer and
 * 3.64:1 against white, where text at this size needs 4.5:1. It is used on 61
 * declarations — the tagline, every meta line, the character count — so this
 * is most of the small print in the app.
 *
 * The ratios are computed from `styles.css` itself rather than from a screen,
 * because jsdom has no layout and no colour engine: the tokens are parsed out
 * of the file, converted oklch → oklab → linear sRGB → sRGB, and run through
 * the WCAG formula. That makes this a test about the palette, which is what
 * actually regressed, rather than about a rendering.
 *
 * Note on the original report: it recorded the footer links at 2.21:1. That
 * pairing does not exist — `rgb(161,165,172)` is the **dark** theme's
 * `--text-2`, measured against the **light** theme's footer. The links
 * themselves are 5.82:1 and always passed. The `--text-3` failures were real.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

/** AA for text below the large-text threshold. */
const AA_NORMAL = 4.5;

function oklchToRgb(l: number, c: number, hDeg: number): [number, number, number] {
  const h = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const lCube = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mCube = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sCube = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;

  const linear = [
    4.0767416621 * lCube - 3.3077115913 * mCube + 0.2309699292 * sCube,
    -1.2684380046 * lCube + 2.6097574011 * mCube - 0.3413193965 * sCube,
    -0.0041960863 * lCube - 0.7034186147 * mCube + 1.707614701 * sCube,
  ];

  return linear.map((v) => {
    const encoded = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(v, 0) ** (1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, encoded)) * 255);
  }) as [number, number, number];
}

function luminance([r, g, b]: [number, number, number]): number {
  const channel = (v: number): number => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(fg: [number, number, number], bg: [number, number, number]): number {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * Every declaration of a token, in file order: `[light, darkMedia, darkStamp]`.
 * Reading all of them is the point — a fix applied to one theme only is the
 * shape of this defect.
 */
function tokenValues(name: string): [number, number, number][] {
  const pattern = new RegExp(`--${name}:\\s*oklch\\(([\\d.]+)%\\s+([\\d.]+)\\s+([\\d.]+)\\)`, "g");
  const found = [...CSS.matchAll(pattern)].map(
    (m) => oklchToRgb(Number(m[1]) / 100, Number(m[2]), Number(m[3])),
  );
  return found as [number, number, number][];
}

describe("text tokens meet AA against the surfaces they sit on", () => {
  it("parses every declaration of each token — three per token, one light and two dark", () => {
    // If this drops to one, the regex has stopped matching and every assertion
    // below would be checking the light theme three times.
    for (const token of ["text", "text-2", "text-3", "bg", "surface", "surface-2"]) {
      expect(tokenValues(token), token).toHaveLength(3);
    }
  });

  it("light theme: every text tier clears AA on every light surface", () => {
    const bg = tokenValues("bg")[0]!;
    const surface = tokenValues("surface")[0]!;
    const surface2 = tokenValues("surface-2")[0]!;

    for (const token of ["text", "text-2", "text-3"]) {
      const fg = tokenValues(token)[0]!;
      for (const [label, on] of [["bg", bg], ["surface", surface], ["surface-2", surface2]] as const) {
        expect(contrast(fg, on), `light --${token} on --${label}`).toBeGreaterThanOrEqual(AA_NORMAL);
      }
    }
  });

  it("dark theme: every text tier clears AA on every dark surface, in both dark blocks", () => {
    // Index 1 is the `prefers-color-scheme` block, index 2 the `[data-theme]`
    // stamp. They must agree, and both must pass — a viewer on "system" sees
    // the first and a viewer who toggled sees the second.
    for (const index of [1, 2]) {
      const surfaces = {
        bg: tokenValues("bg")[index]!,
        surface: tokenValues("surface")[index]!,
        "surface-2": tokenValues("surface-2")[index]!,
      };
      for (const token of ["text", "text-2", "text-3"]) {
        const fg = tokenValues(token)[index]!;
        for (const [label, on] of Object.entries(surfaces)) {
          expect(contrast(fg, on), `dark[${index}] --${token} on --${label}`).toBeGreaterThanOrEqual(
            AA_NORMAL,
          );
        }
      }
    }
  });

  it("the two dark blocks declare the same values, so a toggle matches the system", () => {
    for (const token of ["text", "text-2", "text-3", "bg", "surface", "surface-2"]) {
      const values = tokenValues(token);
      expect(values[1], token).toEqual(values[2]);
    }
  });

  it("keeps the tiers distinguishable, so the hierarchy survives the fix", () => {
    const text = tokenValues("text")[0]!;
    const text2 = tokenValues("text-2")[0]!;
    const text3 = tokenValues("text-3")[0]!;
    // Raising `--text-3` to clear AA pulls it toward `--text-2`. It must still
    // be lighter than it, and both still darker than nothing.
    expect(luminance(text3)).toBeGreaterThan(luminance(text2));
    expect(luminance(text2)).toBeGreaterThan(luminance(text));
  });
});
