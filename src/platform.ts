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

/**
 * The browser's history keys, per platform.
 *
 * Deliberately short. Back and Forward are the whole point; opening a
 * relationship in a new tab is here because every pointer in this app is an
 * ordinary link, so it is the one other thing worth knowing.
 */
export function browserNavKeys(apple: boolean = IS_APPLE): KeyHint[] {
  if (apple) {
    return [
      { combos: ["⌘ + [", "⌘ + ←"], description: "Back — to the resource you came from" },
      { combos: ["⌘ + ]", "⌘ + →"], description: "Forward — back down the chain you retraced" },
      { combos: ["⌘ + click"], description: "Open a relationship in a new tab" },
    ];
  }
  return [
    { combos: ["Alt + ←"], description: "Back — to the resource you came from" },
    { combos: ["Alt + →"], description: "Forward — back down the chain you retraced" },
    { combos: ["Ctrl + click"], description: "Open a relationship in a new tab" },
  ];
}

/** How the *other* platform spells them, so the list still helps on a loaner. */
export function otherPlatformNote(apple: boolean = IS_APPLE): string {
  return apple
    ? "On Windows and Linux the same two are Alt + ← and Alt + →."
    : "On a Mac the same two are ⌘ + [ and ⌘ + ] (or ⌘ + ← and ⌘ + →).";
}

/** Pointing-device equivalents, which are often the easier sell. */
export function pointerNavNote(apple: boolean = IS_APPLE): string {
  return apple
    ? "A two-finger swipe left or right on the trackpad does the same thing, as do your mouse's side buttons."
    : "Your mouse's side buttons do the same thing, as does swiping left or right on a trackpad.";
}
