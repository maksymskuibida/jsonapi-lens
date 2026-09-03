// @vitest-environment node
/**
 * `mcp/locale.ts`'s pin, tested the only way it can be: a real subprocess,
 * because the hazard it guards against (Node's `navigator.language`
 * reflecting the host's `LANG`/`LC_ALL`) is fixed when a process starts and
 * cannot be varied per test case within one running vitest worker.
 *
 * Three review findings, all fixed:
 *
 *   - S1: the pin lived only in `mcp/server.ts`, not in `mcp/build-server.ts`
 *     itself — the module `docs/test-plans/T7.md` documents building
 *     directly. `test/mcp/fixtures/locale-pin-probe.ts` imports
 *     `build-server.js` alone, never `locale.js`, to prove the pin now
 *     travels with it.
 *   - S2: the pin was skipped entirely once `globalThis.localStorage`
 *     already existed (e.g. under `--experimental-webstorage`), because the
 *     old code treated "does a storage exist" and "is our key set in it" as
 *     the same question. The probe's `--pre-existing-storage` flag
 *     reproduces exactly that precondition, and `--pre-existing-de-storage`
 *     the sharper one — a real prior choice that must be overwritten, not
 *     merely tolerated.
 *   - S3 (round 2): even with the write unconditional, a `localStorage`
 *     whose `setItem` throws, or — the one that would have stayed invisible
 *     without a read-back check — silently accepts the call and changes
 *     nothing, both left the pin unset. `--throwing-storage` and
 *     `--noop-storage` reproduce each.
 */
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const TSX_BIN = resolve(REPO_ROOT, "node_modules/.bin/tsx");
const PROBE = resolve(HERE, "fixtures/locale-pin-probe.ts");

function runProbe(env: NodeJS.ProcessEnv, extraArgs: string[] = []): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [TSX_BIN, PROBE, ...extraArgs], {
      cwd: REPO_ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    const timer = setTimeout(() => {
      child.kill();
      rejectRun(new Error(`locale-pin-probe timed out. stderr so far:\n${stderr}`));
    }, 15_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        rejectRun(new Error(`locale-pin-probe exited ${code}. stderr:\n${stderr}`));
        return;
      }
      resolveRun({ stdout, stderr });
    });
  });
}

/** German text for the exact message the probe's forced failure produces
 * (`en.ts`'s `shareErrors.corruptShort`), so the assertions below can tell
 * "pinned to English" apart from "silently answered in German" rather than
 * just checking for the absence of English words. */
const GERMAN_CORRUPT_SHORT_FRAGMENT = "zu kurz"; // "...ist zu kurz, um ein gültiges Dokument zu sein."

function extractText(stdout: string): string {
  const parsed = JSON.parse(stdout) as { content: { type: string; text?: string }[] };
  return parsed.content.map((c) => c.text ?? "").join("\n");
}

describe("the locale pin holds under a hostile host environment", () => {
  it("positive control: LANG=de_DE really does change navigator.language in a bare Node process", async () => {
    // Proves the environment manipulation below is a real hazard, not a
    // no-op — if this ever stopped being true (a Node behaviour change), the
    // two tests below would pass vacuously.
    const { stdout } = await new Promise<{ stdout: string }>((resolveRun) => {
      const child = spawn(
        process.execPath,
        ["-e", "process.stdout.write(navigator.language)"],
        { env: { ...process.env, LANG: "de_DE.UTF-8" } },
      );
      let out = "";
      child.stdout.on("data", (c: Buffer) => (out += c.toString("utf8")));
      child.on("close", () => resolveRun({ stdout: out }));
    });
    expect(stdout).toBe("de-DE");
  });

  it("S1 — build-server.js alone (never importing locale.js directly) still answers in English under LANG=de_DE", async () => {
    const { stdout } = await runProbe({ ...process.env, LANG: "de_DE.UTF-8", LC_ALL: "de_DE.UTF-8" });
    const text = extractText(stdout);
    expect(text).toMatch(/too short/i);
    expect(text.toLowerCase()).not.toContain(GERMAN_CORRUPT_SHORT_FRAGMENT);
  });

  it("S2 — the pin still takes effect when globalThis.localStorage already exists before it runs", async () => {
    const { stdout } = await runProbe(
      { ...process.env, LANG: "de_DE.UTF-8", LC_ALL: "de_DE.UTF-8" },
      ["--pre-existing-storage"],
    );
    const text = extractText(stdout);
    expect(text).toMatch(/too short/i);
    expect(text.toLowerCase()).not.toContain(GERMAN_CORRUPT_SHORT_FRAGMENT);
  });

  it("also holds under a Ukrainian host locale", async () => {
    const { stdout } = await runProbe({ ...process.env, LANG: "uk_UA.UTF-8", LC_ALL: "uk_UA.UTF-8" });
    const text = extractText(stdout);
    expect(text).toMatch(/too short/i);
  });

  it("overwrites a pre-existing localStorage already holding a different locale choice", async () => {
    // Sharper than "empty pre-existing storage" (the S2 case above): this one
    // has to be overwritten, not merely tolerated. If the pin only wrote when
    // the key was absent, this would still read German.
    const { stdout } = await runProbe(
      { ...process.env, LANG: "de_DE.UTF-8", LC_ALL: "de_DE.UTF-8" },
      ["--pre-existing-de-storage"],
    );
    const text = extractText(stdout);
    expect(text).toMatch(/too short/i);
    expect(text.toLowerCase()).not.toContain(GERMAN_CORRUPT_SHORT_FRAGMENT);
  });

  it("S3 (round 2) — still pins to English when localStorage.setItem always throws", async () => {
    const { stdout } = await runProbe(
      { ...process.env, LANG: "de_DE.UTF-8", LC_ALL: "de_DE.UTF-8" },
      ["--throwing-storage"],
    );
    const text = extractText(stdout);
    expect(text).toMatch(/too short/i);
    expect(text.toLowerCase()).not.toContain(GERMAN_CORRUPT_SHORT_FRAGMENT);
  });

  it("S3 (round 2) — still pins to English when localStorage.setItem silently no-ops", async () => {
    // The one the original read-nothing-back version could not see at all:
    // no exception is ever thrown, so there is nothing for a try/catch to
    // catch. Only checking the effect (read the key back) closes this.
    const { stdout } = await runProbe(
      { ...process.env, LANG: "de_DE.UTF-8", LC_ALL: "de_DE.UTF-8" },
      ["--noop-storage"],
    );
    const text = extractText(stdout);
    expect(text).toMatch(/too short/i);
    expect(text.toLowerCase()).not.toContain(GERMAN_CORRUPT_SHORT_FRAGMENT);
  });
});
