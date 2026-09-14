// @vitest-environment node
import { describe, expect, it } from "vitest";
import { MIN_NODE_MAJOR, runtimeProblem } from "../../mcp/runtime.js";

const CAPABLE = { hasSubtleCrypto: true, hasCompressionStream: true };

describe("runtimeProblem", () => {
  it("is satisfied by the minimum supported Node, fully capable", () => {
    expect(runtimeProblem({ nodeVersion: `v${MIN_NODE_MAJOR}.0.0`, ...CAPABLE })).toBeNull();
  });

  it("is satisfied by a newer Node too", () => {
    expect(runtimeProblem({ nodeVersion: `v${MIN_NODE_MAJOR + 3}.4.1`, ...CAPABLE })).toBeNull();
  });

  it("names the required version on a Node one major below the minimum", () => {
    const problem = runtimeProblem({ nodeVersion: `v${MIN_NODE_MAJOR - 1}.9.9`, ...CAPABLE });
    expect(problem).not.toBeNull();
    expect(problem).toContain(String(MIN_NODE_MAJOR));
    expect(problem).toContain(`v${MIN_NODE_MAJOR - 1}.9.9`);
  });

  it("is a readable message, never a crash, on a version string it cannot parse", () => {
    expect(() => runtimeProblem({ nodeVersion: "not-a-version", ...CAPABLE })).not.toThrow();
    const problem = runtimeProblem({ nodeVersion: "not-a-version", ...CAPABLE });
    expect(problem).toContain(String(MIN_NODE_MAJOR));
  });

  it("reports missing WebCrypto even on a new-enough Node", () => {
    const problem = runtimeProblem({
      nodeVersion: `v${MIN_NODE_MAJOR}.0.0`,
      hasSubtleCrypto: false,
      hasCompressionStream: true,
    });
    expect(problem).not.toBeNull();
    expect(problem).toMatch(/webcrypto/i);
  });

  it("reports missing CompressionStream even on a new-enough Node", () => {
    const problem = runtimeProblem({
      nodeVersion: `v${MIN_NODE_MAJOR}.0.0`,
      hasSubtleCrypto: true,
      hasCompressionStream: false,
    });
    expect(problem).not.toBeNull();
    expect(problem).toMatch(/compressionstream/i);
  });

  it("reports both missing capabilities together, not just the first", () => {
    const problem = runtimeProblem({
      nodeVersion: `v${MIN_NODE_MAJOR}.0.0`,
      hasSubtleCrypto: false,
      hasCompressionStream: false,
    });
    expect(problem).toMatch(/webcrypto/i);
    expect(problem).toMatch(/compressionstream/i);
  });

  it("never mentions a stack trace or 'undefined' — the failure this check exists to avoid", () => {
    const problem = runtimeProblem({ nodeVersion: "v18.0.0", ...CAPABLE });
    expect(problem).not.toBeNull();
    expect(problem!.toLowerCase()).not.toContain("undefined");
    expect(problem!.toLowerCase()).not.toContain("typeerror");
  });
});
