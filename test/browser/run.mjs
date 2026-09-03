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

/**
 * The retry loop that reads `wanted` through the app's own paste flow — the
 * textarea, Read, and (when the shape offer appears) "Read as plain JSON" —
 * rather than reaching into the app's internals, so this exercises what a
 * person does. Returns the expression string for `page.evaluate`; the result
 * is `''` on success or an error message on rejection.
 *
 * Retried, because the paste view is static markup in index.html: the button
 * exists long before the module that listens to it has booted, so a single
 * click can land on nothing and look exactly like a slow render. Clicking
 * again once it has rendered is harmless, so a loop is the simplest way to be
 * sure the click took.
 *
 * The "rendered" check is `#overview`, not `.res` — `render-document.ts`
 * gives both `renderOverview` (JSON:API) and `renderJsonOverview` (plain
 * JSON) the same id, which is what makes this one check work for either
 * shape. Before this, the loop only ever recognised a `.res` section, so a
 * plain-JSON document — which never has one — timed out as "the app
 * rejected it" no matter how correctly it read: this suite could not load
 * the path T1 added at all, offer included.
 */
function readFlow(wanted) {
  return `(async () => {
    const wanted = ${JSON.stringify(wanted)};
    for (let attempt = 0; attempt < 40; attempt++) {
      const overview = document.getElementById('overview');
      const doc = document.getElementById('doc');
      if (overview && doc && !doc.hidden) return '';

      const error = document.getElementById('error');
      if (error && !error.hidden) {
        return [
          document.getElementById('error-headline')?.textContent,
          document.getElementById('error-hint')?.textContent,
          document.getElementById('error-where')?.textContent,
        ].filter(Boolean).join(' — ');
      }

      // Not JSON:API, but valid JSON — the paste view names the shape and
      // offers a choice instead of reading straight through. Take the
      // plain-JSON reading, the one this suite exists to protect now that
      // it has its own path through the app.
      const offer = document.getElementById('shape-offer');
      const offerPlain = document.getElementById('shape-offer-plain');
      if (offer && !offer.hidden && offerPlain) {
        offerPlain.click();
        await new Promise((r) => setTimeout(r, 250));
        continue;
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
  })()`;
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
  // into its internals, so the test exercises what a person does. `amtrak.json`
  // is JSON:API, so this always takes `readFlow`'s straight-through path — the
  // shape-offer branch exists for the plain-JSON check near the end of this file.
  const text = await readFile(DOC, "utf8");
  const rejected = await page.evaluate(readFlow(text));
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

  // Reload, last, because it destroys the page context the scenarios run in.
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

  // Plain JSON: a reference nested deeper than `AUTO_OPEN_DEPTH` must still be
  // *visibly* open after a reload, not merely present in the DOM. This is the
  // one check in this suite that can see that class of regression at all —
  // `nav-harness.js`'s `NAV` and every `SCEN.*` scenario above are built
  // entirely around `.res`/`.res__d`, and `amtrak.json` is JSON:API, so none
  // of them ever take the branch this exercises. Run last, after the
  // JSON:API reload probe above, for the same reason that one runs last: it
  // replaces the loaded document and reloads the page, which nothing here
  // needs to survive afterward.
  await page.navigate(`${ORIGIN}/`);
  await waitFor(page, "!!document.getElementById('input')", "the paste view, for the plain-JSON check");
  // Let `boot()`'s own IndexedDB read (of whichever document `amtrak.json`'s
  // run above persisted) settle before submitting a fresh paste — otherwise
  // this check would also be exercising the boot()/pendingOffer race, which
  // is a different, already-covered bug, not the one this block exists for.
  await sleep(500);

  const plainJsonDoc = '{ "a": { "b": { "c": { "id": 4 } } }, "c_id": 4 }';
  const plainRejected = await page.evaluate(readFlow(plainJsonDoc));
  if (plainRejected) {
    throw new Error(`the app rejected the plain-JSON reload fixture: ${plainRejected}`);
  }

  // The offer button's click handler fires `load(..., { persist: true })`
  // without awaiting it, so the IndexedDB write can still be in flight the
  // instant `readFlow` sees `#overview` appear — reloading immediately after
  // can lose the document entirely. Margin here, not a flaky check.
  await sleep(800);

  const before = JSON.parse(
    await page.evaluate(`(async () => {
      const link = document.querySelector('a.v--ref');
      if (!link) return JSON.stringify({ error: 'no resolved reference link rendered' });
      link.click();
      await new Promise((r) => setTimeout(r, 300));
      const id = location.hash.slice(1);
      const el = document.getElementById(id);
      if (!el) return JSON.stringify({ error: 'link target ' + id + ' missing from the DOM' });
      const chain = [];
      for (let n = el; n; n = n.parentElement) if (n.tagName === 'DETAILS') chain.push(n.open);
      return JSON.stringify({ id, chain, height: Math.round(el.getBoundingClientRect().height) });
    })()`),
  );
  if (before.error) throw new Error(`plain-JSON reload check: ${before.error}`);

  await page.evaluate("location.reload(); undefined").catch(() => {});
  await waitFor(
    page,
    `!!document.getElementById(${JSON.stringify(before.id)})`,
    "the plain-JSON document to come back after a reload",
  );
  const after = JSON.parse(
    await page.evaluate(`(async () => {
      await new Promise((r) => setTimeout(r, 800));
      const el = document.getElementById(${JSON.stringify(before.id)});
      const chain = [];
      for (let n = el; n; n = n.parentElement) if (n.tagName === 'DETAILS') chain.push(n.open);
      return JSON.stringify({ chain, height: Math.round(el.getBoundingClientRect().height) });
    })()`),
  );

  // Both halves matter: `clickWorked` is the precondition (the link itself
  // still resolves and opens its target) so a broken click path fails loudly
  // as itself, not as a confusing false pass on the reload comparison.
  const clickWorked = before.chain.length > 0 && before.chain.every((open) => open === true);
  const survivedReload = after.chain.length === before.chain.length && after.chain.every((open) => open === true);
  const plainOk = clickWorked && survivedReload;
  if (!plainOk) failed += 1;
  console.log(
    `${plainOk ? "pass" : "FAIL"}  ${String(after.height).padStart(6)}px  27 plain JSON: a reference 2+ levels deep survives reload` +
      `\n            chain ${JSON.stringify(before.chain)}->${JSON.stringify(after.chain)}, height ${before.height}->${after.height}, clickWorked=${clickWorked}`,
  );

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
