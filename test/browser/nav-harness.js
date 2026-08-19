/* Vocabulary for the history-restoration scenarios in nav-scenarios.js.
   Loaded by hand in a real browser; not part of the app or its build.
   See ./README.md — a hidden or occluded tab invalidates every measurement. */
(() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const raf = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const settle = async (ms = 450) => { await sleep(ms); await raf(); await sleep(60); };

  const enc = (s) => [...s].map((ch) => (/[A-Za-z0-9]/.test(ch) ? ch : '_' + ch.charCodeAt(0).toString(16).padStart(4, '0'))).join('');
  const domId = (type, id) => `r_${enc(type)}__${enc(id)}`;
  const sec = (type, id) => document.getElementById(domId(type, id));
  const top = (el) => (el ? Math.round(el.getBoundingClientRect().top) : null);
  const height = () => document.documentElement.scrollHeight;
  const openIds = () => [...document.querySelectorAll('.res__d[open]')].map((d) => d.closest('.res').id);

  /** An anchor to `type:id` that is really clickable: laid out, not inside a closed row. */
  function anchorTo(type, id, withinEl) {
    const wanted = `#${domId(type, id)}`;
    for (const a of (withinEl || document).querySelectorAll('a[href]')) {
      if (a.getAttribute('href') !== wanted) continue;
      if (a.getClientRects().length === 0) continue; // display:none, or inside a closed <details>
      return a;
    }
    return null;
  }

  /** The section a saved position is really about: the topmost one still on screen. */
  function topmostVisible() {
    for (const el of document.querySelectorAll('.group:not([data-filtered]) .res')) {
      const r = el.getBoundingClientRect();
      if (r.height > 0 && r.bottom > 0) return el;
    }
    return null;
  }

  const NAV = {
    sleep, raf, settle, domId, sec, top, height, openIds, anchorTo, topmostVisible,

    /** A clean entry: no fragment, no saved state, everything collapsed, at the top. */
    async fresh() {
      history.replaceState(null, '', '/view');
      for (const d of document.querySelectorAll('.res__d[open]')) d.open = false;
      const clear = document.querySelector('#clear-filter');
      if (clear && !clear.hidden) clear.click();
      window.scrollTo(0, 0);
      await settle(350);
      return { h: height(), y: Math.round(scrollY), open: openIds().length };
    },

    async open(type, id) {
      const s = sec(type, id);
      if (!s) throw new Error(`no section ${type}:${id}`);
      const d = s.querySelector('.res__d');
      if (!d.open) d.open = true;
      await settle(250);
    },

    async close(type, id) {
      const d = sec(type, id).querySelector('.res__d');
      if (d.open) d.open = false;
      await settle(250);
    },

    /** Expand every row in a type's group via its own "Expand all" button. */
    async expandGroup(type) {
      const group = [...document.querySelectorAll('.group')].find((g) => g.dataset.type === type);
      group.querySelector('.group__toggle').click();
      await settle(400);
    },

    /** Scroll an element to the middle of the viewport, converging past lazy measurement. */
    async center(el) {
      for (let i = 0; i < 5; i++) {
        const t = el.getBoundingClientRect().top;
        window.scrollTo(0, Math.round(t + scrollY - innerHeight / 2));
        await settle(200);
      }
      await settle(400);
    },

    async scrollToFraction(f) {
      for (let i = 0; i < 4; i++) { window.scrollTo(0, Math.round((height() - innerHeight) * f)); await settle(200); }
      await settle(400);
    },

    /** Click a real anchor, the way a user follows a relationship. */
    async click(type, id, withinEl) {
      const a = anchorTo(type, id, withinEl);
      if (!a) throw new Error(`no clickable anchor to ${type}:${id}`);
      a.click();
      await settle(700);
      return a;
    },

    async back() { history.back(); await settle(900); },
    async forward() { history.forward(); await settle(900); },

    async railFilter(type) {
      const row = [...document.querySelectorAll('.railrow__solo')].find((b) => b.dataset.solo === type);
      row.click();
      await settle(400);
    },
    async clearFilter() {
      const c = document.querySelector('#clear-filter');
      if (c && !c.hidden) { c.click(); await settle(400); }
    },
  };

  window.NAV = NAV;
})();
'nav-harness loaded';
