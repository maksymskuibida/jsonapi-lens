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
let total = 0;

/**
 * One result line, and the two counters the summary is built from.
 *
 * Every check goes through this rather than a hand-maintained denominator: the
 * runner-level checks around the scenarios are exactly the ones an addition
 * forgets to count, and an under-counted total is invisible in a green run.
 */
function report(ok, metric, name, detail) {
  total += 1;
  if (!ok) failed += 1;
  let line = `${ok ? "pass" : "FAIL"}  ${String(metric).padStart(8)}  ${name}`;
  if (detail) line += `\n            ${detail}`;
  console.log(line);
}

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
    try {
      const raw = await page.evaluate(
        `(async () => JSON.stringify(await SCEN[${JSON.stringify(key)}](NAV)))()`,
      );
      const result = JSON.parse(raw);
      // Detail on failures only: on 23 passing scenarios it is just noise.
      report(
        result.ok,
        `${result.driftPx ?? "?"}px`,
        result.name ?? key,
        result.ok ? null : (result.detail ?? ""),
      );
    } catch (error) {
      report(false, "err", key, error.message);
    }
  }

  // Reload, first of the two checks that need a page load, because it destroys
  // the page context the scenarios run in.
  //
  // This is the case the old absolute-offset restoration got most wrong — -1215px
  // — and the reason is worth keeping in front of whoever changes this next: on a
  // fresh load nothing has been measured yet, so the page is at its shortest and
  // a saved pixel offset means the least it will ever mean. Restoring a place
  // instead survives it, and the restored offset is expected to differ.
  try {
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
    report(
      Math.abs(reloadDrift) <= 2,
      `${reloadDrift}px`,
      "reload restores the same place",
      `top ${saved.top}->${landed.top}, y ${saved.y}->${landed.y}, h ${saved.h}->${landed.h}`,
    );
  } catch (error) {
    report(false, "err", "reload restores the same place", error.message);
  }

  // Resuming a stored document from the paste view, which needs a page load of
  // its own and so cannot be a scenario — every `SCEN.*` runs in one page
  // context, and a load destroys it.
  //
  // `boot()` parses a stored document so that "Back to document" is instant but
  // deliberately stays on the paste view, so a loaded document and an empty
  // `#doc` is a normal state. Revealing the document view without building it
  // first showed a blank page below the topbar, and "leave the tab, come back
  // later, click the button" is an ordinary way to use the app.
  try {
    await page.navigate(`${ORIGIN}/`);
    // The button clause first: `Page.navigate` resolves at navigation commit,
    // when the parser may not have reached `#resume` yet, and reading `.hidden`
    // off the null that gets you throws out of the run instead of polling again.
    await waitFor(
      page,
      "!!document.querySelector('#resume button') && !document.getElementById('resume').hidden",
      "the resume button offering the stored document",
    );
    const resumed = JSON.parse(
      await page.evaluate(`(async () => {
        const doc = document.getElementById('doc');
        // Nothing built yet is the state under test: if the document view were
        // already there, clicking would prove nothing about building it.
        const before = doc.childElementCount;
        // Reaching this button often means scrolling the paste view, and the
        // built document inherits whatever offset that left behind — so the
        // click has to be made from somewhere other than the top.
        window.scrollTo(0, 400);
        await new Promise((r) => setTimeout(r, 250));
        const beforeY = Math.round(scrollY);
        document.querySelector('#resume button').click();
        // Polled rather than slept: the handler is synchronous today, so this
        // returns at once, and a fixed wait would quietly become the assertion
        // if that ever changed.
        for (let i = 0; i < 50 && doc.childElementCount === 0; i++) {
          await new Promise((r) => setTimeout(r, 100));
        }
        return JSON.stringify({
          before,
          beforeY,
          path: location.pathname,
          hidden: doc.hidden,
          children: doc.childElementCount,
          sections: document.querySelectorAll('.res').length,
          y: Math.round(scrollY),
        });
      })()`),
    );
    // `before === 0` is load-bearing, not commentary: if some later change
    // builds `#doc` at boot, this check would pass while proving nothing, and
    // the fix it guards could be reverted under a green run.
    const resumeOk =
      resumed.before === 0 &&
      resumed.path === "/view" &&
      !resumed.hidden &&
      resumed.children > 0 &&
      resumed.sections > 0 &&
      // Built and revealed is not enough: inheriting the paste view's offset
      // drops you into the middle of a document you have not seen yet.
      resumed.y === 0;
    report(
      resumeOk,
      resumed.sections,
      "resume renders the stored document",
      `#doc children ${resumed.before}->${resumed.children} at ${resumed.path}, y ${resumed.beforeY}->${resumed.y}` +
        (resumed.before > 0 ? " — already built before the click, so this proved nothing" : ""),
    );
  } catch (error) {
    report(false, "err", "resume renders the stored document", error.message);
  }

  console.log(`\n${total - failed}/${total} passed`);
} finally {
  page?.close();
  chrome.kill();
  // Chrome is still flushing its profile as it goes down, and a failed tidy-up
  // must not be what this reports.
  await Promise.race([once(chrome, "exit"), sleep(5000)]);
  await rm(profile, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
}

process.exit(failed === 0 ? 0 : 1);
