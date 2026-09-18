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

  // Reload, first of the four checks below that need a page load of their own,
  // because it destroys the page context the scenarios run in — the injected
  // `NAV`/`SCEN` harness does not survive it, so nothing below this point may
  // call either again. The three after it (resume, plain JSON, bundle) are
  // ordered so each only needs what the one before it leaves behind.
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

  // Three halves, not two: `clickWorked` is the precondition (the link itself
  // still resolves and opens its target) so a broken click path fails loudly
  // as itself, not as a confusing false pass on the reload comparison. The
  // other two are the state and the place, checked separately on purpose —
  // this project's own founding defect was a restoration that landed on the
  // right pixel while the row underneath had silently stopped expanding, a
  // place assertion passing over a broken state. This scenario is that
  // lesson's exact mirror, so it does not get to make the same mistake in
  // the other direction: `chain` is the state (every ancestor open), `height`
  // is the place (the same box, not a collapsed one at the same scroll
  // position). Both must hold, and `height` was already being collected and
  // printed here before this was fixed to actually assert it.
  const clickWorked = before.chain.length > 0 && before.chain.every((open) => open === true);
  const chainSurvived = after.chain.length === before.chain.length && after.chain.every((open) => open === true);
  const heightSurvived = Math.abs(after.height - before.height) <= 2;
  const plainOk = clickWorked && chainSurvived && heightSurvived;
  report(
    plainOk,
    `${after.height}px`,
    "28 plain JSON: a reference 2+ levels deep survives reload",
    `chain ${JSON.stringify(before.chain)}->${JSON.stringify(after.chain)}, height ${before.height}->${after.height}, clickWorked=${clickWorked}, chainSurvived=${chainSurvived}, heightSurvived=${heightSurvived}`,
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
        toast: (document.getElementById('toast') || {}).textContent || '',
        stillMarked: (history.state || {}).bundle === true,
        // The same branch can fall through to a "no document" toast a few
        // lines below, and this suite runs in whatever language the browser
        // negotiated — so the text cannot be compared and "a toast appeared"
        // is not the assertion. The two differ by tone: this one is an error,
        // that one is not, and the error class is what says so.
        toastIsError: (document.getElementById('toast') || { classList: { contains: () => false } })
          .classList.contains('toast--error'),
      };
    })())`),
  );
  const bundleReloadOk =
    bundleReload.bundleContainerShowing === false &&
    (bundleReload.pasteShowing || bundleReload.docShowing);
  report(
    bundleReloadOk,
    "-",
    "a cold reload of a bundle-marked entry is not blank",
    JSON.stringify(bundleReload),
  );

  // Not blank is only half of it. Before this, the reload silently rendered
  // whatever document had been stored previously — so the shared documents
  // appeared to turn into an unrelated one, with nothing said. The bundle is
  // genuinely unrecoverable (the key left the URL before the entry existed),
  // which is exactly why the app has to say so rather than substitute.
  // Not "a toast appeared" — *this* toast. The same branch can fall through to
  // "no document" a few lines below, and that would have kept a length check
  // green while the bundle message was gone.
  const saidTheRightThing = bundleReload.toast.trim().length > 0 && bundleReload.toastIsError;
  report(
    saidTheRightThing && !bundleReload.stillMarked,
    "-",
    "a cold reload of a bundle-marked entry says the documents are gone, once",
    `error-toned toast: ${bundleReload.toastIsError}, still marked: ${bundleReload.stillMarked}, got: ${JSON.stringify(bundleReload.toast.slice(0, 50))}`,
  );

  // Renaming the document that is open has to move the name on screen with it.
  // `main.ts` wires itself to the real document at module scope, so no vitest
  // test can reach this sink — the unit tests cover only the notification the
  // modal sends, not whether the topbar acts on it.
  try {
    await page.navigate(`${ORIGIN}/`);
    await waitFor(page, "!!document.getElementById('input')", "the paste view");
    await page.evaluate(readFlow('{"data":{"type":"a","id":"1"}}'));

    const renamed = await page.evaluate(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "s", bubbles: true }));
      await wait(500);
      const save = [...document.querySelectorAll(".modal__panel button")].pop();
      save.click();
      await wait(800);

      const before = {
        topbar: document.getElementById("topbar-label").textContent,
        title: document.title,
      };

      document.getElementById("library-label").closest("button").click();
      await wait(700);
      const rename = [...document.querySelectorAll(".modal__panel button")]
        .find((b) => /rename|umbenennen|перейменувати/i.test(b.textContent.trim()));
      if (!rename) return { before, after: null, reason: "no rename button" };
      rename.click();
      await wait(500);

      const top = [...document.querySelectorAll(".modal__panel")].pop();
      top.querySelector("input").value = "renamed-while-open";
      const confirm = [...top.querySelectorAll(".modal__actions button")].pop();
      confirm.click();
      await wait(1200);

      return {
        before,
        after: {
          topbar: document.getElementById("topbar-label").textContent,
          title: document.title,
        },
      };
    })()`);

    const followed =
      renamed.after !== null &&
      renamed.after.topbar === "renamed-while-open" &&
      renamed.after.title.startsWith("renamed-while-open") &&
      renamed.before.topbar !== renamed.after.topbar;
    report(
      followed,
      "-",
      "renaming the open document moves the name in the topbar and the title",
      `${JSON.stringify(renamed.before)} -> ${JSON.stringify(renamed.after)}`,
    );
  } catch (error) {
    report(false, "err", "renaming the open document moves the name in the topbar and the title", error.message);
  }

  /*
   * Last in the file on purpose: this drives a same-origin iframe through the
   * app's own paste flow, which writes to the shared `documents` store — the
   * record `resume renders the stored document` and the bundle-reload check
   * read would be overwritten if it ran earlier.
   *
   * Layout, measured rather than eyeballed. This shipped to production and was
   * found by a QA pass, and it is not expressible in jsdom — it has no layout
   * engine, which is why the preflight forbids layout assertions there.
   *
   * Run in a same-origin iframe sized to a phone, so the width is real without
   * disturbing the metrics override the scenarios above depend on.
   */
  try {
    const narrow = await page.evaluate(`(async () => {
      const widths = {};
      for (const lang of ["en", "de", "uk"]) {
        const frame = document.createElement("iframe");
        frame.style.cssText = "position:fixed;left:-9999px;top:0;width:375px;height:812px;border:0";
        frame.src = location.origin + "/?lang=" + lang;
        document.body.appendChild(frame);
        await new Promise((resolve) => {
          frame.addEventListener("load", resolve, { once: true });
          setTimeout(resolve, 4000);
        });
        await new Promise((r) => setTimeout(r, 600));
        const d = frame.contentDocument;
        const input = d.getElementById("input");
        input.value = '{"data":{"type":"a","id":"1"}}';
        input.dispatchEvent(new frame.contentWindow.Event("input", { bubbles: true }));
        d.getElementById("parse").click();
        await new Promise((r) => setTimeout(r, 1200));
        const root = d.documentElement;
        const buttons = [...d.querySelectorAll(".topbar button")];
        const reachable = buttons.every(
          (b) => b.getBoundingClientRect().right <= root.clientWidth + 0.5,
        );
        // The new-document button is the widest control and is hidden until a
        // document is open. A hidden element measures all zeros, so without
        // this the check would quietly stop measuring what overflowed.
        const newDoc = d.getElementById("new-doc");
        widths[lang] = {
          vw: root.clientWidth,
          sw: root.scrollWidth,
          reachable,
          buttons: buttons.length,
          newDocShown: !!newDoc && newDoc.offsetParent !== null,
        };
        frame.remove();
      }
      return widths;
    })()`);

    const fits = Object.values(narrow).every(
      (w) => w.sw <= w.vw && w.reachable && w.newDocShown && w.buttons >= 4,
    );
    report(
      fits,
      "375px",
      "the topbar fits a phone in every language, with every control reachable",
      Object.entries(narrow)
        .map(
          ([lang, w]) =>
            `${lang} ${w.sw}/${w.vw}${w.reachable ? "" : " UNREACHABLE"}${w.newDocShown ? "" : " NO-NEW-DOC"}`,
        )
        .join(", "),
    );
  } catch (error) {
    report(false, "err", "the topbar fits a phone in every language, with every control reachable", error.message);
  }

  /*
   * Deep nesting, measured at 1024px rather than this suite's own 1512px.
   * Every nesting level spends another key column, so the depth at which the
   * value runs out of room depends on the width: at 1512 seven levels still
   * fit, and this check passed with the fix reverted. 1024 is where it bites,
   * and `/orders/0/meta/audit/trail/actor/userId` is that deep in real data.
   *
   * Three assertions, because each one alone can be satisfied while the bug is
   * present. "The page does not scroll sideways" is true of a tree that has
   * been clipped instead of made reachable — the first attempt at this fix
   * scored 1024/1024 with the deepest value still 0px wide. "The value has
   * width" is true of a page that scrolls the whole body instead. And both are
   * vacuously true of a page with nothing on it: a `?.` miss on the shape-offer
   * button leaves the paste view up and every measurement trivially passes, so
   * the nesting has to be shown to have rendered at all.
   *
   * Also last in the file, for the same reason as the check above it: this
   * drives the paste flow and writes to the shared `documents` store.
   */
  try {
    const deep = await page.evaluate(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const frame = document.createElement("iframe");
      frame.style.cssText = "position:fixed;left:-9999px;top:0;width:1024px;height:900px;border:0";
      frame.src = location.origin + "/?lang=en";
      document.body.appendChild(frame);
      await new Promise((resolve) => {
        frame.addEventListener("load", resolve, { once: true });
        setTimeout(resolve, 5000);
      });
      await wait(600);
      const d = frame.contentDocument;
      const input = d.getElementById("input");
      input.value = '{"a":{"b":{"c":{"d":{"e":{"f":{"g":"deep value"}}}}}},"z":1}';
      input.dispatchEvent(new frame.contentWindow.Event("input", { bubbles: true }));
      d.getElementById("parse").click();
      await wait(900);
      // Not JSON:API, so the app offers a choice rather than reading straight
      // through. Take the plain-JSON reading — that is the shape that nests.
      const plain = d.getElementById("shape-offer-plain");
      if (plain) plain.click();
      await wait(1200);
      for (let i = 0; i < 12; i++) {
        const shut = [...d.querySelectorAll("details.tree:not([open])")];
        if (!shut.length) break;
        shut.forEach((tree) => (tree.open = true));
        await wait(200);
      }
      await wait(400);
      const root = d.documentElement;
      const values = [...d.querySelectorAll(".kv__val")].map(
        (v) => v.getBoundingClientRect().width,
      );
      const out = {
        vw: root.clientWidth,
        sw: root.scrollWidth,
        depth: d.querySelectorAll(".kv .kv .kv .kv .kv").length,
        values: values.length,
        narrowest: values.length ? Math.round(Math.min(...values)) : -1,
      };
      frame.remove();
      return out;
    })()`);

    const held = deep.depth > 0 && deep.sw <= deep.vw && deep.narrowest > 0;
    report(
      held,
      "1024px",
      "deeply nested values keep their width without the page scrolling sideways",
      `page ${deep.sw}/${deep.vw}, narrowest value ${deep.narrowest}px, nested rows ${deep.depth}, values ${deep.values}`,
    );
  } catch (error) {
    report(
      false,
      "err",
      "deeply nested values keep their width without the page scrolling sideways",
      error.message,
    );
  }

  // `total` is whatever `report` was actually called with, rather than a
  // hand-maintained `keys.length + n`: every check added since this line was
  // written was added outside `SCEN`, and each one silently widened the gap
  // between the denominator and the run. An under-counted total is invisible
  // in a green run — see `report`'s own comment.
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
