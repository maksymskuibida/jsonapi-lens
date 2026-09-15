/**
 * Ask a bare Node process what language it thinks the host speaks.
 *
 * This is the positive control behind `test/locale-pin.test.ts`: it proves the
 * hazard that `test/setup.ts` pins against is real, rather than describing it.
 *
 * It is plain JavaScript for the same reason `test/browser/run.mjs` is: it
 * needs Node's own APIs, and this file predates the `mcp/` tree. Note the
 * original reasoning here — that the tsconfig covering `src` carries no Node
 * types, so nothing under `src/` could reach a Node API and still typecheck —
 * is **no longer true**, and was not true by the time this branch merged
 * `main`: `@types/node` is a devDependency for `mcp/`, and a file under `src/`
 * importing `node:child_process` typechecks clean. The `.mjs`/`.d.mts` pair is
 * kept because it works and matches `run.mjs`, not because it enforces
 * anything. Restoring that boundary is a real task and is not this one.
 */
import { spawn } from "node:child_process";

/** How long to wait for a `node -e` that should answer in milliseconds. Kept
 * under vitest's 5s default `testTimeout` so that a hung probe reports its own
 * diagnostic — including whatever the child wrote to stderr — rather than
 * being killed first by a generic "Test timed out". */
const TIMEOUT_MS = 3_000;

/**
 * `navigator.language` as reported by `node -e` run under `lang`.
 *
 * @param {string} lang POSIX locale name, e.g. `"de_DE.UTF-8"`.
 * @returns {Promise<string>} the language tag the child printed, e.g. `"de-DE"`.
 */
export function hostLanguageUnder(lang) {
  return new Promise((resolve, reject) => {
    // `LC_ALL` outranks `LC_MESSAGES` and `LANG`, and `LANGUAGE` is a gettext
    // variable ICU does not read — but the parent's values are dropped anyway
    // rather than reasoned about, so the child's answer depends on this call
    // and not on the environment the suite happens to run in.
    const env = { ...process.env, LANG: lang, LC_ALL: lang };
    delete env.LANGUAGE;
    delete env.LC_MESSAGES;

    const child = spawn(process.execPath, ["-e", "process.stdout.write(navigator.language)"], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString("utf8")));

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`the ${lang} probe did not answer in ${TIMEOUT_MS}ms. stderr so far:\n${stderr}`));
    }, TIMEOUT_MS);

    const settle = (fn, value) => {
      clearTimeout(timer);
      fn(value);
    };

    // Without this, a spawn that fails outright — EAGAIN or EMFILE under load,
    // a sandbox refusing to create processes — emits an `error` event with no
    // listener, which Node throws as an uncaught exception in the vitest
    // worker instead of failing this probe's own promise.
    child.on("error", (error) => settle(reject, error));

    child.on("close", (code) => {
      if (code === 0) settle(resolve, stdout);
      else settle(reject, new Error(`the ${lang} probe exited ${code}. stderr:\n${stderr}`));
    });
  });
}
