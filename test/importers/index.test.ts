import { describe, expect, it } from "vitest";
import { detectAll, detectBest, IMPORTERS } from "../../src/importers/index.js";

describe("detectAll / detectBest — the highest confidence wins", () => {
  it("a curl command is offered over a bare-URL reading of the same text", () => {
    // "curl 'https://api.example.com'" is not itself a URL (it has a space
    // and the word "curl" in it), so this is really testing that cURL wins
    // outright rather than testing a genuine tie — see the next test for that.
    const matches = detectAll("curl 'https://api.example.com/x'");
    expect(matches[0]!.importer.id).toBe("curl");
  });

  it("returns every match, sorted by confidence descending", () => {
    const matches = detectAll("https://api.example.com/x");
    expect(matches.length).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i - 1]!.detection.confidence).toBeGreaterThanOrEqual(matches[i]!.detection.confidence);
    }
  });

  it("detectBest returns the single top match", () => {
    const best = detectBest("https://api.example.com/x");
    expect(best?.importer.id).toBe("url");
  });

  it("returns null when nothing recognises the text — the fall-through case", () => {
    expect(detectBest("just an ordinary sentence with no structure to it")).toBeNull();
    expect(detectAll("just an ordinary sentence with no structure to it")).toEqual([]);
  });

  it("every registered importer's id is unique", () => {
    const ids = IMPORTERS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("all six importers are registered", () => {
    expect(IMPORTERS.map((i) => i.id).sort()).toEqual(
      ["curl", "har", "raw-http-request", "raw-http-response", "transport-log", "url"].sort(),
    );
  });
});
