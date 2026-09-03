/**
 * Run the history-restoration scenarios in headless Chrome.
 *
 * These scenarios need real layout — `content-visibility` only measures a row
 * once it has been on screen, and that lazy measurement is the whole bug they
 * exist to catch. jsdom has no layout, so vitest cannot host them.
 *
 * A headed browser can host them, but only while its tab is the visible,
 * non-occluded tab of a non-minimised window: anywhere else the tab stops
 * running `requestAnimationFrame` and stops updating `content-visibility`, and
 * the numbers come out quietly wrong rather than failing. Headless Chrome always
 * renders, needs nobody's screen, and several copies can run at once.
 *
 * Dependency-free on purpose: Chrome speaks CDP over a WebSocket, and Node has
 * had a global `WebSocket` since 22. Adding puppeteer to a project whose only
 * dev dependencies are vite, vitest and wrangler would be a poor trade for the
 * ~60 lines below.
 *
 * Usage:
 *   node test/browser/run.mjs
 *   node test/browser/run.mjs --only s02,s08,s16
 *   node test/browser/run.mjs --extra my-scenarios.js
 *
 * `--url` defaults to http://localhost:5180, and can be pointed at a deployment
 * just as well — the harness is injected from disk, not fetched from the origin.
 * Exits non-zero if any scenario fails, so it can gate a release.
 */

import { spawn } from "node:child_process";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { once } from "node:events";

const CHROME =
  process.env["CHROME_PATH"] ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const ORIGIN = arg("url", "http://localhost:5180");
const DOC = arg("doc", "test/browser/amtrak.json");
const ONLY = arg("only");
const EXTRA = arg("extra");
const WIDTH = Number(arg("width", "1512"));
const HEIGHT = Number(arg("height", "944"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A free port, so several of these can run at the same time. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** One CDP connection, with a session attached to a single page target. */
async function connect(port) {
  let version;
  for (let i = 0; i < 60; i++) {
    try {
      version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      break;
    } catch {
      await sleep(250);
    }
  }
  if (!version) throw new Error("Chrome never opened its debugging port");

  const socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const waiting = pending.get(message.id);
    if (!waiting) return; // an event, not a reply
    pending.delete(message.id);
    if (message.error) waiting.reject(new Error(JSON.stringify(message.error)));
    else waiting.resolve(message.result);
  });

  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });

  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Page.enable", {}, sessionId);
  await send("Runtime.enable", {}, sessionId);

  // `--window-size` is not enough: headless Chrome refuses to make a window
  // narrower than about 500px, so asking for a phone width silently gave you 500
  // and the narrow-layout scenarios were not testing a narrow layout at all.
  // Overriding the metrics sets the viewport itself, which has no such floor.
  await send(
    "Emulation.setDeviceMetricsOverride",
    // `mobile: true` would also apply a page scale derived from the viewport meta
    // tag, so `innerWidth` would stop matching the width asked for. What these
    // scenarios need is a narrow layout, not touch emulation.
    { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false },
    sessionId,
  );

  /** Evaluate in the page and hand back the value, awaiting any promise. */
  const evaluate = async (expression) => {
    const result = await send(
      "Runtime.evaluate",
      { expression, awaitPromise: true, returnByValue: true },
      sessionId,
    );
    if (result.exceptionDetails) {
      const thrown = result.exceptionDetails.exception;
      throw new Error(thrown?.description ?? thrown?.value ?? "page threw");
    }
    return result.result.value;
  };

  return {
    evaluate,
    navigate: (url) => send("Page.navigate", { url }, sessionId),
    close: () => socket.close(),
  };
}

/** Poll the page until `expression` is truthy, so nothing races the render. */
async function waitFor(page, expression, what, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await page.evaluate(expression)) return;
    await sleep(200);
  }
  // Say where the page actually got to; "timed out" on its own tells you nothing
  // about whether the server was up, the route was wrong, or the app threw.
  const where = await page
    .evaluate(
      "JSON.stringify({ url: location.href, readyState: document.readyState, title: document.title, body: document.body ? document.body.innerHTML.length : 0 })",
    )
    .catch((error) => `unavailable: ${error.message}`);
  throw new Error(`timed out waiting for ${what} — page is at ${where}`);
}

const profile = await mkdtemp(join(tmpdir(), "jsonapi-lens-cdp-"));
const port = await freePort();

const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--window-size=${WIDTH},${HEIGHT}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    // Headless throttles background work by default; these scenarios are
    // entirely about what the renderer does, so it has to keep doing it.
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
  ],
  { stdio: "ignore" },
);

let page;
let failed = 0;

try {
  page = await connect(port);

  await page.navigate(`${ORIGIN}/`);
  await waitFor(page, "!!document.getElementById('input')", "the paste view");

  // Feed the document in through the app's own paste flow rather than reaching
  // into its internals, so the test exercises what a person does.
  //
  // Retried, because the paste view is static markup in index.html: the button
  // exists long before the module that listens to it has booted, so a single
  // click can land on nothing and look exactly like a slow render. Clicking
  // again once it has rendered is harmless, so a loop is the simplest way to be
  // sure the click took.
  const text = await readFile(DOC, "utf8");
  const rejected = await page.evaluate(`(async () => {
    const wanted = ${JSON.stringify(text)};
    for (let attempt = 0; attempt < 40; attempt++) {
      const doc = document.getElementById('doc');
      const rendered = document.querySelectorAll('.res').length > 0 && doc && !doc.hidden;
      if (rendered) return '';

      const error = document.getElementById('error');
      if (error && !error.hidden) {
        return [
          document.getElementById('error-headline')?.textContent,
          document.getElementById('error-hint')?.textContent,
          document.getElementById('error-where')?.textContent,
        ].filter(Boolean).join(' \u2014 ');
      }

      const input = document.getElementById('input');
      const parse = document.getElementById('parse');
      if (input && parse) {
        if (input.value !== wanted) {
          input.value = wanted;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        parse.click();
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    return '';
  })()`);
  if (rejected) throw new Error(`the app rejected ${DOC}: ${rejected}`);

  await waitFor(
    page,
    // Not just the count: the sections stay in the DOM even when the paste view is
    // showing over the top of them, and a hidden ancestor gives every descendant
    // a zero rect, which would make every measurement below meaningless.
    "document.querySelectorAll('.res').length > 0 && !document.getElementById('doc').hidden",
    "the document to render",
  );

  // `boot()` reads IndexedDB behind an await and used to call `showView("paste")`
  // regardless of what had happened meanwhile, so a document pasted before that
  // read finished got replaced by the paste view a moment later. Rendering once
  // is therefore not proof; it has to still be rendered after boot has landed.
  await sleep(1500);
  const stillRendered = await page.evaluate(
    "document.querySelectorAll('.res').length > 0 && !document.getElementById('doc').hidden",
  );
  if (!stillRendered) {
    throw new Error("the document was rendered and then replaced — boot() raced the paste");
  }

  const sanity = await page.evaluate(`(async () => {
    let raf = false;
    await Promise.race([
      new Promise((r) => requestAnimationFrame(() => { raf = true; r(); })),
      new Promise((r) => setTimeout(r, 2000)),
    ]);
    return JSON.stringify({
      visibility: document.visibilityState,
      rafFires: raf,
      sections: document.querySelectorAll('.res').length,
      viewport: [innerWidth, innerHeight],
    });
  })()`);
  const state = JSON.parse(sanity);
  console.log(`browser: ${sanity}`);
  if (state.visibility !== "visible" || !state.rafFires) {
    throw new Error("the page is not rendering; every measurement would be wrong");
  }
  const [gotWidth] = state.viewport;
  if (gotWidth !== WIDTH) {
    throw new Error(`asked for a ${WIDTH}px viewport and got ${gotWidth}px`);
  }

  // Injected from disk rather than fetched from the origin, so this can be
  // pointed at a deployment as well as at a dev server — the built site serves
  // `dist/`, and asking it for `/test/browser/…` gets the SPA fallback.
  for (const file of ["test/browser/nav-harness.js", "test/browser/nav-scenarios.js"]) {
    await page.evaluate(`(0, eval)(${JSON.stringify(await readFile(file, "utf8"))})`);
  }

  if (EXTRA) {
    const extra = await readFile(EXTRA, "utf8");
    await page.evaluate(`(0, eval)(${JSON.stringify(extra)})`);
  }

  const keys = ONLY
    ? ONLY.split(",").map((k) => k.trim()).filter(Boolean)
    : await page.evaluate(
        // No backslashes: this string is nested inside two levels of quoting and
        // an escaped `\\d` silently becomes a literal backslash, matching nothing.
        "Object.keys(SCEN).filter((k) => typeof SCEN[k] === 'function' && k[0] === 's' && /^[0-9]+$/.test(k.slice(1))).sort()",
      );

  console.log(`running ${keys.length} scenarios\n`);

  for (const key of keys) {
    let line;
    try {
      const raw = await page.evaluate(
        `(async () => JSON.stringify(await SCEN[${JSON.stringify(key)}](NAV)))()`,
      );
      const result = JSON.parse(raw);
      if (!result.ok) failed += 1;
      line = `${result.ok ? "pass" : "FAIL"}  ${String(result.driftPx ?? "?").padStart(6)}px  ${result.name ?? key}`;
      if (!result.ok) line += `\n            ${result.detail ?? ""}`;
    } catch (error) {
      failed += 1;
      line = `FAIL       err  ${key}\n            ${error.message}`;
    }
    console.log(line);
  }

  // Reload, near-last, because it destroys the page context the scenarios
  // run in — the injected `NAV`/`SCEN` harness does not survive it, so
  // nothing below this point may call either again.
  //
  // This is the case the old absolute-offset restoration got most wrong — -1215px
  // — and the reason is worth keeping in front of whoever changes this next: on a
  // fresh load nothing has been measured yet, so the page is at its shortest and
  // a saved pixel offset means the least it will ever mean. Restoring a place
  // instead survives it, and the restored offset is expected to differ.
  const probe = await page.evaluate(`(async () => {
    await NAV.fresh();
    await NAV.open(...SCEN.ID.mc);
    await NAV.open(...SCEN.ID.c5);
    await NAV.scrollToFraction(0.55);
    const watch = NAV.topmostVisible();
    return JSON.stringify({ id: watch.id, top: NAV.top(watch), y: Math.round(scrollY), h: NAV.height() });
  })()`);
  const saved = JSON.parse(probe);

  await page.evaluate("location.reload(); undefined").catch(() => {});
  await waitFor(
    page,
    "document.querySelectorAll('.res').length > 0 && !document.getElementById('doc').hidden",
    "the document to come back after a reload",
  );
  const landed = JSON.parse(
    await page.evaluate(`(async () => {
      await new Promise((r) => setTimeout(r, 1200));
      const el = document.getElementById(${JSON.stringify(saved.id)});
      return JSON.stringify({
        top: el ? Math.round(el.getBoundingClientRect().top) : null,
        y: Math.round(scrollY),
        h: document.documentElement.scrollHeight,
      });
    })()`),
  );
  const reloadDrift = landed.top === null ? NaN : landed.top - saved.top;
  const reloadOk = Math.abs(reloadDrift) <= 2;
  if (!reloadOk) failed += 1;
  console.log(
    `${reloadOk ? "pass" : "FAIL"}  ${String(reloadDrift).padStart(6)}px  reload restores the same place` +
      `\n            top ${saved.top}->${landed.top}, y ${saved.y}->${landed.y}, h ${saved.h}->${landed.h}`,
  );

  // One more reload, genuinely last, closing a coverage gap PR #5 review
  // round 2 found (S9): `isBundleEntryShowing`'s `bundleImportEl.hasChildNodes()`
  // half — main.ts, just above `markBundleEntry` — had no test anywhere that
  // could fail. Deleting it and keeping only `state?.bundle === true` left
  // the entire suite green: 265/265 vitest and every scenario above. What it
  // guards is a plain F5 on a bundle-marked /view entry: a real browser keeps
  // an entry's `history.state` across `location.reload()`, but the secret and
  // the bundle's rendered content do not survive it — a fresh page load
  // starts `bundleImportEl` empty, and nothing in this session re-populates
  // it. Without the guard, `applyRoute` reads the stale marker alone, calls
  // `showView("bundle")`, and shows that empty container: B1's blank page,
  // reached by a different route. The marker is stamped by hand rather than
  // run through s27's `fetch` stub and a real share round trip — the guard
  // only ever reads `history.state` and `bundleImportEl`'s children, and
  // neither cares how the entry came to be marked, so a hand-stamped one
  // exercises the exact same mechanism far more cheaply. Placed after the
  // reload above, not before it, because this one needs no `NAV`/`SCEN` call
  // of its own — only raw DOM queries — so it does not need the harness
  // re-injected after destroying the page context a second time.
  //
  // `bundleImportEl` carries no id or class (see its own comment in
  // main.ts), so it is found the same way `showView` distinguishes it from
  // its four static siblings: the one child of #view whose id is not one of
  // theirs.
  await page.evaluate("history.pushState({ bundle: true }, '', '/view'); undefined");
  await page.evaluate("location.reload(); undefined").catch(() => {});
  await waitFor(
    page,
    "!!document.getElementById('boot') && document.getElementById('boot').hidden === true",
    "the app to leave the boot view after a bundle-marked reload",
  );
  await sleep(1200); // boot() awaits IndexedDB before it settles on a view.
  const bundleReload = JSON.parse(
    await page.evaluate(`JSON.stringify((() => {
      const view = document.getElementById('view');
      const known = new Set(['boot', 'paste', 'doc', 'legal']);
      const extra = [...view.children].find((el) => !known.has(el.id));
      return {
        path: location.pathname,
        pasteShowing: !document.getElementById('paste').hidden,
        docShowing: !document.getElementById('doc').hidden,
        bundleContainerShowing: extra ? !extra.hidden : null,
        bundleContainerHasChildren: extra ? extra.hasChildNodes() : null,
      };
    })())`),
  );
  const bundleReloadOk =
    bundleReload.bundleContainerShowing === false &&
    (bundleReload.pasteShowing || bundleReload.docShowing);
  if (!bundleReloadOk) failed += 1;
  console.log(
    `${bundleReloadOk ? "pass" : "FAIL"}       -  a cold reload of a bundle-marked entry is not blank` +
      `\n            ${JSON.stringify(bundleReload)}`,
  );

  // +2: the scroll-restoration reload above, and the bundle-marked reload above it.
  console.log(`\n${keys.length + 2 - failed}/${keys.length + 2} passed`);
} finally {
  page?.close();
  chrome.kill();
  // Chrome is still flushing its profile as it goes down, and a failed tidy-up
  // must not be what this reports.
  await Promise.race([once(chrome, "exit"), sleep(5000)]);
  await rm(profile, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
}

process.exit(failed === 0 ? 0 : 1);
