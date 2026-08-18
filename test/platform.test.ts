import { describe, expect, it } from "vitest";
import { browserNavKeys, isApplePlatform, otherPlatformNote } from "../src/platform.js";

describe("isApplePlatform", () => {
  it("recognises what the three engines actually report", () => {
    // Chromium's userAgentData.platform, and the legacy navigator.platform
    // Safari and Firefox still hand out. iPadOS Safari says "MacIntel" too.
    expect(isApplePlatform("macOS")).toBe(true);
    expect(isApplePlatform("MacIntel")).toBe(true);
    expect(isApplePlatform("iPhone")).toBe(true);
    expect(isApplePlatform("Windows")).toBe(false);
    expect(isApplePlatform("Win32")).toBe(false);
    expect(isApplePlatform("Linux x86_64")).toBe(false);
    expect(isApplePlatform("Android")).toBe(false);
    expect(isApplePlatform("")).toBe(false);
  });

  it("does not read a Linux Android UA as Apple", () => {
    const ua = "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36";
    // "AppleWebKit" is in every Chrome UA string on every platform; matching it
    // would call every machine a Mac.
    expect(isApplePlatform(ua)).toBe(false);
  });
});

describe("browserNavKeys", () => {
  it("gives each platform its own spelling of Back and Forward", () => {
    const mac = browserNavKeys(true);
    expect(mac[0]?.combos).toEqual(["⌘ + [", "⌘ + ←"]);
    expect(mac[1]?.combos).toEqual(["⌘ + ]", "⌘ + →"]);

    const pc = browserNavKeys(false);
    expect(pc[0]?.combos).toEqual(["Alt + ←"]);
    expect(pc[1]?.combos).toEqual(["Alt + →"]);
  });

  it("leads with Back on both, since that is the one people miss", () => {
    for (const hints of [browserNavKeys(true), browserNavKeys(false)]) {
      expect(hints[0]?.description).toMatch(/^Back/);
    }
  });

  it("points at the other platform's keys, not its own", () => {
    expect(otherPlatformNote(true)).toContain("Alt");
    expect(otherPlatformNote(true)).not.toContain("⌘ + [");
    expect(otherPlatformNote(false)).toContain("⌘ + [");
  });
});
