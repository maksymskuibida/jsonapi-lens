/**
 * Which key names to print.
 *
 * The app's own bindings are bare letters, so this matters in exactly two
 * places: the ⌘/Ctrl + Enter that reads a pasted document, and the browser's
 * own Back and Forward. The second one is the important one. This app navigates
 * a document by pushing real history entries, so Back *is* the way up a
 * relationship chain — and it is spelled differently on every platform, which
 * is why so few people know it.
 *
 * `navigator.userAgentData.platform` is the current answer and what Chromium
 * reports; Safari and Firefox still only offer the older surfaces, so all three
 * are consulted in that order. Being wrong prints a wrong key name in a hint,
 * so this is worth no more code than it takes.
 */

interface NavigatorWithUAData extends Navigator {
  userAgentData?: { platform?: string };
}

function platformString(): string {
  if (typeof navigator === "undefined") return "";
  const nav = navigator as NavigatorWithUAData;
  return nav.userAgentData?.platform || nav.platform || nav.userAgent || "";
}

/** Does this machine use ⌘ rather than Ctrl and Alt? Pass a string to test. */
export function isApplePlatform(source: string = platformString()): boolean {
  // iPadOS Safari reports "MacIntel"; that is fine, the key names match.
  return /mac|iphone|ipad|ipod/i.test(source);
}

export const IS_APPLE: boolean = isApplePlatform();

/** The primary modifier's printed name: "⌘" or "Ctrl". */
export const MOD_KEY: string = IS_APPLE ? "⌘" : "Ctrl";

export interface KeyHint {
  /** Each entry is one equivalent combination, `" + "`-separated. */
  combos: string[];
  description: string;
}

/** Which browser navigation key a row describes, so a catalogue can name it. */
export type BrowserNavKey = "back" | "forward" | "newTab";

/**
 * The browser's history keys, per platform.
 *
 * Deliberately short. Back and Forward are the whole point; opening a
 * relationship in a new tab is here because every pointer in this app is an
 * ordinary link, so it is the one other thing worth knowing.
 *
 * Only the *spelling* lives here — ⌘, Alt and the arrows are symbols, not
 * words, and they are the same in every language. The descriptions come from
 * the message catalogue, keyed by `id`, so this module has no copy to
 * translate.
 */
export function browserNavKeys(
  apple: boolean = IS_APPLE,
): { id: BrowserNavKey; combos: string[] }[] {
  if (apple) {
    return [
      { id: "back", combos: ["⌘ + [", "⌘ + ←"] },
      { id: "forward", combos: ["⌘ + ]", "⌘ + →"] },
      { id: "newTab", combos: ["⌘ + click"] },
    ];
  }
  return [
    { id: "back", combos: ["Alt + ←"] },
    { id: "forward", combos: ["Alt + →"] },
    { id: "newTab", combos: ["Ctrl + click"] },
  ];
}
