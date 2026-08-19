/* Realistic journeys through the Amtrak connections payload. Each returns the
   pixel drift of a watched element across a history traversal: `driftPx` above
   ±2 means Back stopped returning you to where you were. See ./README.md. */
(() => {
  const ID = {
    c0: ['connections', 'ATES-USWASWDU-USYVRVAN-2026-08-24T15:57-2026-08-27T10:35-0'],
    c1: ['connections', 'ATES-USWASWDU-USYVRVAN-2026-08-24T10:35-2026-08-27T10:35-1'],
    c5: ['connections', 'ATES-USWASWDU-USYVRVAN-2026-08-24T10:35-2026-08-28T16:13-5'],
    seg0: ['segments', 'ATES-USWASWDU-USCHICHI-2026-08-24T15:57-2026-08-25T08:45-0-0'],
    seg1: ['segments', 'ATES-USCHICHI-USYVRVAN-2026-08-25T15:05-2026-08-27T10:35-0-1'],
    fare15: ['fares', 'ATES-USWASWDU-USYVRVAN-2026-08-24T15:57-2026-08-27T10:35-0-FARE-15'],
    fc15: ['fare_classes', 'ATES-FARE-15'],
    fc1: ['fare_classes', 'ATES-FARE-1'],
    fc38: ['fare_classes', 'ATES-FARE-38'],
    chi: ['stations', 'USCHICHI'],
    was: ['stations', 'USWASWDU'],
    sea: ['stations', 'USSEASEA'],
    cityChi: ['cities', 'USCHI'],
    wifi: ['amenities', 'ATES-WIFI'],
    cbag: ['amenities', 'ATES-CBAG'],
    veh0: ['vehicles', 'TRAIN-ATES-USWASWDU-USCHICHI-2026-08-24T15:57-2026-08-25T08:45-0-0'],
    vtype: ['vehicle_types', 'TRAIN'],
    mc: ['marketing_carriers', 'ATES'],
    oc: ['operating_carriers', 'ATES'],
    psoe: ['passenger_types', 'PSOE'],
    pnos: ['passenger_types', 'PNOS'],
    pax: ['passengers', 'pax-18-1'],
    nref: ['fare_features', 'ATES-NREF'],
    refu: ['fare_features', 'ATES-REFU'],
  };

  const TOL = 2;

  /** Open `from`, centre the anchor it holds to `to`, click it, come Back, measure. */
  async function follow(N, name, from, to, opts = {}) {
    await N.fresh();
    for (const pre of opts.alsoOpen || []) await N.open(...ID[pre]);
    await N.open(...ID[from]);
    const host = N.sec(...ID[from]);
    const a = N.anchorTo(...ID[to], host);
    if (!a) return { name, ok: false, detail: `no anchor ${to} inside ${from}` };
    await N.center(a);
    const before = { top: N.top(a), y: Math.round(scrollY), h: N.height(), open: N.openIds().length };
    await N.click(...ID[to], host);
    // Arriving somewhere has to open it. Following a relationship to read a
    // collapsed row is most of the point, and a position-only assertion cannot
    // see it: the landing is in exactly the right place either way.
    const arrivedOpen = !!N.sec(...ID[to]).querySelector('.res__d[open]');
    const landed = { y: Math.round(scrollY), h: N.height(), hash: location.hash };
    await N.back();
    const after = { top: N.top(a), y: Math.round(scrollY), h: N.height(), open: N.openIds().length };
    const drift = after.top - before.top;
    return {
      name, ok: Math.abs(drift) <= TOL && arrivedOpen, driftPx: drift,
      detail: `top ${before.top}->${after.top}, y ${before.y}->${after.y}, h ${before.h}->${after.h}, open ${before.open}->${after.open}, arrivedOpen=${arrivedOpen}`,
      landed,
    };
  }

  const SCEN = {
    ID, TOL, follow,

    /* 1-9: one relationship hop and back, the bread and butter. */
    s01: (N) => follow(N, "01 cheapest connection -> its FARE-15 fare", 'c0', 'fare15'),
    s02: (N) => follow(N, "02 fare -> its fare class", 'fare15', 'fc15'),
    s03: (N) => follow(N, "03 segment -> arrival station", 'seg1', 'chi', { alsoOpen: [] }),
    s04: (N) => follow(N, "04 station -> its city", 'chi', 'cityChi'),
    s05: (N) => follow(N, "05 segment -> an amenity", 'seg0', 'wifi'),
    s06: (N) => follow(N, "06 segment -> its vehicle", 'seg0', 'veh0'),
    s07: (N) => follow(N, "07 carrier -> passenger type PSOE (reported case)", 'mc', 'psoe'),
    s08: (N) => follow(N, "08 carrier -> fare class FARE-1 (jumps far up)", 'mc', 'fc1'),
    s09: (N) => follow(N, "09 fare class -> fare feature", 'fc1', 'nref'),

    /* 10 four-deep chain, then unwind with three Backs, checking each level. */
    async s10(N) {
      await N.fresh();
      const marks = [];
      const chain = [['c0', 'seg1'], ['seg1', 'chi'], ['chi', 'cityChi']];
      for (const [from, to] of chain) {
        await N.open(...ID[from]);
        const host = N.sec(...ID[from]);
        const a = N.anchorTo(...ID[to], host);
        await N.center(a);
        marks.push({ from, to, el: a, top: N.top(a) });
        await N.click(...ID[to], host);
      }
      const results = [];
      for (let i = marks.length - 1; i >= 0; i--) {
        await N.back();
        const m = marks[i];
        results.push({ level: `${m.from}->${m.to}`, drift: N.top(m.el) - m.top });
      }
      const worst = Math.max(...results.map((r) => Math.abs(r.drift)));
      return { name: '10 four-deep chain, unwound with three Backs', ok: worst <= TOL, driftPx: worst, detail: JSON.stringify(results) };
    },

    /* 11 Back then Forward: the forward landing must be exact too. */
    async s11(N) {
      await N.fresh();
      await N.open(...ID.mc);
      const host = N.sec(...ID.mc);
      const a = N.anchorTo(...ID.psoe, host);
      await N.center(a);
      await N.click(...ID.psoe, host);
      const landed = { top: N.top(N.sec(...ID.psoe)), y: Math.round(scrollY) };
      await N.back();
      await N.forward();
      const after = { top: N.top(N.sec(...ID.psoe)), y: Math.round(scrollY) };
      const drift = after.top - landed.top;
      return { name: '11 Back then Forward returns to the link target', ok: Math.abs(drift) <= TOL, driftPx: drift, detail: `top ${landed.top}->${after.top}, y ${landed.y}->${after.y}` };
    },

    /* 16 collapse the row you landed on, leave, come Back: the saved shape must win. */
    async s16(N) {
      await N.fresh();
      await N.open(...ID.mc);
      const host = N.sec(...ID.mc);
      const a = N.anchorTo(...ID.fc1, host);
      await N.center(a);
      await N.click(...ID.fc1, host);           // FARE-1 opens on arrival
      await N.close(...ID.fc1);                 // ...and the user collapses it again
      await N.scrollToFraction(0.62);
      const watch = N.topmostVisible();
      const before = { top: N.top(watch), y: Math.round(scrollY), open: N.openIds().length };
      await N.click(...ID.psoe);                // go somewhere else
      await N.back();
      const after = { top: N.top(watch), y: Math.round(scrollY), open: N.openIds().length, fc1Open: !!N.sec(...ID.fc1).querySelector('.res__d[open]') };
      const drift = after.top - before.top;
      return { name: '16 collapse the landed row, leave, Back (shape must not re-open it)', ok: Math.abs(drift) <= TOL && !after.fc1Open, driftPx: drift, detail: `top ${before.top}->${after.top}, open ${before.open}->${after.open}, landedRowReopened=${after.fc1Open}` };
    },

    /* 17 Back to the very top. */
    async s17(N) {
      await N.fresh();
      window.scrollTo(0, 0); await N.settle(400);
      await N.click(...ID.psoe);
      await N.back();
      const y = Math.round(scrollY);
      return { name: '17 Back to the very top (y=0)', ok: y <= TOL, driftPx: y, detail: `y=${y}` };
    },

    /* 18 Back to the very bottom. */
    async s18(N) {
      await N.fresh();
      await N.scrollToFraction(1);
      const before = { y: Math.round(scrollY), max: N.height() - innerHeight };
      const watch = [...document.querySelectorAll('.res')].pop();
      const wTop = N.top(watch);
      await N.click(...ID.c0);
      await N.back();
      const drift = N.top(watch) - wTop;
      return { name: '18 Back to the very bottom', ok: Math.abs(drift) <= TOL, driftPx: drift, detail: `y ${before.y}->${Math.round(scrollY)}, watch ${wTop}->${N.top(watch)}` };
    },

    /* 19 two Backs in quick succession (no settling between). */
    async s19(N) {
      await N.fresh();
      await N.open(...ID.mc);
      const host = N.sec(...ID.mc);
      const a = N.anchorTo(...ID.psoe, host);
      await N.center(a);
      const before = N.top(a);
      await N.click(...ID.psoe, host);
      await N.click(...ID.pnos);
      history.back(); history.back();          // deliberately no settle between
      await N.settle(1400);
      const drift = N.top(a) - before;
      return { name: '19 two Backs in quick succession', ok: Math.abs(drift) <= TOL, driftPx: drift, detail: `top ${before}->${N.top(a)}, hash=${location.hash}` };
    },

    /* 20 Back/Forward/Back/Forward hammering. */
    async s20(N) {
      await N.fresh();
      await N.open(...ID.mc);
      const host = N.sec(...ID.mc);
      const a = N.anchorTo(...ID.psoe, host);
      await N.center(a);
      const before = N.top(a);
      await N.click(...ID.psoe, host);
      for (let i = 0; i < 2; i++) { await N.back(); await N.forward(); }
      await N.back();
      const drift = N.top(a) - before;
      return { name: '20 Back/Forward hammered, then Back', ok: Math.abs(drift) <= TOL, driftPx: drift, detail: `top ${before}->${N.top(a)}` };
    },

    /* 14 filter to one type, follow a link that leaves it (filter clears). */
    async s14(N) {
      await N.fresh();
      await N.railFilter('fare_classes');
      await N.scrollToFraction(0.5);
      const watch = N.topmostVisible();
      const before = N.top(watch);
      await N.click(...ID.fc1);
      await N.back();
      const drift = N.top(watch) - before;
      await N.clearFilter();
      return { name: '14 filtered to one type, follow a link, Back', ok: Math.abs(drift) <= TOL, driftPx: drift, detail: `top ${before}->${N.top(watch)}` };
    },

    /* 15 Expand all on the 36-row fare_classes group, then leave and come Back. */
    async s15(N) {
      await N.fresh();
      await N.expandGroup('fare_classes');
      await N.scrollToFraction(0.45);
      const watch = N.sec(...ID.fc38);
      const before = { top: N.top(watch), open: N.openIds().length, h: N.height() };
      await N.click(...ID.psoe);
      await N.back();
      const after = { top: N.top(watch), open: N.openIds().length, h: N.height() };
      const drift = after.top - before.top;
      return { name: '15 Expand all (36 rows), leave, Back', ok: Math.abs(drift) <= TOL, driftPx: drift, detail: `top ${before.top}->${after.top}, open ${before.open}->${after.open}, h ${before.h}->${after.h}` };
    },

    /* 23 position deep INSIDE a tall open row, leave, come Back. */
    async s23(N) {
      await N.fresh();
      await N.open(...ID.c5);                   // the four-segment connection: a tall row
      const rows = [...N.sec(...ID.c5).querySelectorAll('.res__body [data-pointer]')];
      const watch = rows[Math.floor(rows.length * 0.8)];
      await N.center(watch);
      const before = N.top(watch);
      await N.click(...ID.psoe);
      await N.back();
      const drift = N.top(watch) - before;
      return { name: '23 position inside a tall open row, leave, Back', ok: Math.abs(drift) <= TOL, driftPx: drift, detail: `top ${before}->${N.top(watch)}` };
    },

    /* 24 Referenced-by panel: follow a reverse pointer, come Back. */
    async s24(N) {
      await N.fresh();
      await N.open(...ID.chi);
      const host = N.sec(...ID.chi);
      const refPanel = host.querySelector('.block--rev');
      if (!refPanel) return { name: '24 Referenced-by reverse pointer, Back', ok: false, detail: 'no referenced-by panel found' };
      const a = [...refPanel.querySelectorAll('a[href^="#r_"]')][0];
      if (!a) return { name: '24 Referenced-by reverse pointer, Back', ok: false, detail: 'no reverse link' };
      await N.center(a);
      const before = N.top(a);
      a.click();
      await N.settle(700);
      await N.back();
      const drift = N.top(a) - before;
      return { name: '24 Referenced-by reverse pointer, Back', ok: Math.abs(drift) <= TOL, driftPx: drift, detail: `top ${before}->${N.top(a)}` };
    },

    /* 26 Every way of arriving at a resource opens it. Only a restored fold shape
       may leave a row shut, and that is scenario 16. */
    async s26(N) {
      const seen = [];

      // a relationship chip inside another resource's body
      await N.fresh();
      await N.open(...ID.mc);
      await N.click(...ID.psoe, N.sec(...ID.mc));
      seen.push(['relationship chip', !!N.sec(...ID.psoe).querySelector('.res__d[open]')]);

      // a chip in the overview's primary-data list
      await N.fresh();
      await N.click(...ID.c0);
      seen.push(['primary data chip', !!N.sec(...ID.c0).querySelector('.res__d[open]')]);

      // the jump modal
      await N.fresh();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));
      await N.settle(300);
      const input = document.querySelector('.jump input, dialog input[type="search"]');
      if (input) {
        input.value = 'stations USSEASEA';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await N.settle(250);
        const first = document.querySelector('.jump__result');
        if (first) first.click();
        await N.settle(700);
        seen.push(['jump modal', !!N.sec(...ID.sea).querySelector('.res__d[open]')]);
      } else {
        seen.push(['jump modal', 'modal did not open']);
      }

      // a reverse pointer out of "Referenced by"
      await N.fresh();
      await N.open(...ID.chi);
      const rev = N.sec(...ID.chi).querySelector('.block--rev a[href^="#r_"]');
      if (rev) {
        const id = rev.getAttribute('href').slice(1);
        rev.click();
        await N.settle(700);
        seen.push(['referenced-by', !!document.getElementById(id).querySelector('.res__d[open]')]);
      } else {
        seen.push(['referenced-by', 'no reverse link']);
      }

      const ok = seen.every(([, opened]) => opened === true);
      return { name: '26 arriving at a resource opens it, by every route', ok, driftPx: 0, detail: JSON.stringify(seen) };
    },

    /* 25 "Expand all" must read the rows, not remember its own last click.
       Folding happens by other routes too — by hand, on arrival, or a Back
       restoring a whole shape — and a button trusting its own memory ends up
       doing the opposite of its label, or apparently nothing at all. */
    async s25(N) {
      const seen = [];
      const openRows = () => document.querySelectorAll('.group[data-type="fare_classes"] .res__d[open]').length;
      const label = () => document.querySelector('.group[data-type="fare_classes"] .group__toggle').textContent.trim();

      await N.fresh();
      await N.expandGroup('fare_classes');
      seen.push(['expanded', openRows(), label()]);

      // `fresh` collapses the rows directly, as someone folding them by hand does
      await N.fresh();
      await N.expandGroup('fare_classes');
      seen.push(['expanded again after folding by hand', openRows(), label()]);

      await N.expandGroup('fare_classes');
      seen.push(['clicked once more, so collapsing', openRows(), label()]);

      await N.fresh();
      await N.expandGroup('fare_classes');
      await N.click(...ID.psoe);
      await N.back();
      seen.push(['Back onto 36 open rows', openRows(), label()]);

      // The labels are compared against each other, never against a literal:
      // this app is translated, so asserting "Collapse all" would only hold in
      // English. What matters is that the label after a Back onto 36 open rows
      // is the one shown when rows are open, not the one shown when they are not.
      const whenOpen = seen[0][2];
      const whenCollapsed = seen[2][2];
      const ok =
        seen[0][1] === 36 &&
        seen[1][1] === 36 &&
        seen[2][1] === 0 &&
        seen[3][1] === 36 &&
        whenOpen !== whenCollapsed &&
        seen[3][2] === whenOpen;
      return { name: '25 Expand all reads the rows, and says what it will do', ok, driftPx: 0, detail: JSON.stringify(seen) };
    },

    /* 21 the jump modal (`/`) as the navigation, then Back. */
    async s21(N) {
      await N.fresh();
      await N.scrollToFraction(0.4);
      const watch = N.topmostVisible();
      const before = N.top(watch);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));
      await N.settle(300);
      const input = document.querySelector('.jump input, dialog input[type="search"]');
      if (!input) return { name: '21 jump modal navigation, Back', ok: false, detail: 'jump modal did not open' };
      input.value = 'passenger_types PSOE';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await N.settle(250);
      const first = document.querySelector('.jump__result');
      if (!first) return { name: '21 jump modal navigation, Back', ok: false, detail: 'no jump result' };
      first.click();
      await N.settle(700);
      await N.back();
      const drift = N.top(watch) - before;
      return { name: '21 jump modal navigation, Back', ok: Math.abs(drift) <= TOL, driftPx: drift, detail: `top ${before}->${N.top(watch)}` };
    },
  };

  window.SCEN = SCEN;
})();
'nav-scenarios loaded';
