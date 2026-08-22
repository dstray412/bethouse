/*
 * BetHouse — bets.js
 * The bets you actually placed, and how they turned out.
 *
 * UMD-ish: loads as a plain <script> in the browser (sets window.BetHouseBets)
 * and imports in Node (`import bets from './bets.js'`) so `node --test` runs
 * the exact code the board runs. Same shape as edge.js and score.js.
 *
 * WHAT THIS IS, AND WHAT IT IS NOT
 * --------------------------------
 * track.mjs already keeps a record of what the BOARD predicted, graded
 * against real outcomes, and the footer reports it. That record is honest by
 * construction: the model does not get to choose which predictions count.
 *
 * This is the other half — what YOU picked — and it has the opposite problem.
 * The data is your own claim, so the rules that stop a bet log flattering its
 * owner have to be written down:
 *
 *   1. PREGAME ONLY. The board refuses to track a game that has started, the
 *      same rule track.mjs enforces on itself. Marking a bet in the seventh
 *      inning is not recording a bet, it is recording an outcome.
 *   2. FIRST GRADE WINS. Once a pick has an outcome it is never rewritten,
 *      so rebuilding a history file cannot turn a loss into a win.
 *   3. EXPECTATION IS SUMMED OVER THE GRADED PICKS ONLY. "9 hit, model
 *      expected 8.6" is only a sentence worth reading if both numbers cover
 *      the same bets.
 *
 * There is no stake and no price here. Those were not asked for, and without
 * a price this cannot and does not claim to tell you whether you made money —
 * only whether your picks landed as often as the model said they would.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BetHouseBets = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* Storage key carries a version. A future shape change gets a new key
     rather than silently misreading the old one. */
  const STORAGE_KEY = "bethouse.bets.v1";

  /* ------------------------------------------------------------------ *
   * Identity
   *
   * One bet is one player, in one game, on one prop. The same hitter on
   * 1+ H/R/RBI and on 2+ total bases is two bets that can settle in
   * opposite directions, and a doubleheader is two games.
   * ------------------------------------------------------------------ */

  function keyOf(pick) {
    if (!pick) return null;
    const { gamePk, playerId, prop } = pick;
    if (gamePk == null || playerId == null || !prop) return null;
    return `${gamePk}|${playerId}|${prop}`;
  }

  /* ------------------------------------------------------------------ *
   * Adding and removing
   *
   * Every operation returns a new array. The caller holds one list and
   * writes it back to storage, so in-place mutation would let a failed
   * write leave the page and the storage disagreeing.
   * ------------------------------------------------------------------ */

  function add(list, pick) {
    const key = keyOf(pick);
    if (!key) return list.slice();
    if (has(list, key)) return list.slice();
    /* An outcome is carried through when one is offered. A tap from the
       board never supplies it — the game has not started — but importing
       an exported log does, and rebuilding those entries without their
       grades would quietly erase the record for any day older than the
       history files still on disk. */
    const graded =
      pick.actual == null
        ? {}
        : { actual: Number(pick.actual), gradedAt: pick.gradedAt || new Date().toISOString() };
    return list.concat([
      Object.assign(graded, {
        key,
        gamePk: pick.gamePk,
        playerId: pick.playerId,
        prop: pick.prop,
        propLabel: pick.propLabel || pick.prop,
        name: pick.name || "",
        team: pick.team || "",
        // The model's number AT THE MOMENT YOU BET, kept so the comparison
        // later is against what you were actually shown, not against a
        // number the model revised afterwards.
        prob: isFinite(pick.prob) ? Number(pick.prob) : null,
        date: pick.date || "",
        addedAt: pick.addedAt || new Date().toISOString(),
      }),
    ]);
  }

  function remove(list, key) {
    return list.filter((b) => b.key !== key);
  }

  function has(list, key) {
    return list.some((b) => b.key === key);
  }

  /* ------------------------------------------------------------------ *
   * Grading
   *
   * history/<date>.json is written by track.mjs on every board refresh and
   * carries `actual` (1 or 0) for every player it snapshotted, on all five
   * props. So a pick made from the board is already in that file and is
   * already graded within half an hour of the game ending. Nothing here
   * decides an outcome; it only reads one.
   * ------------------------------------------------------------------ */

  function resultsFrom(historyDay) {
    const out = {};
    const rows = historyDay && historyDay.predictions;
    if (!Array.isArray(rows)) return out;
    for (const r of rows) {
      // `actual` is 0 for a miss, so test for absence rather than falsiness.
      if (!r || r.actual == null) continue;
      const key = keyOf(r);
      if (key) out[key] = Number(r.actual);
    }
    return out;
  }

  function applyResults(list, results) {
    if (!results) return list.slice();
    return list.map((b) => {
      // Rule 2: first grade wins.
      if (b.actual != null) return b;
      const got = results[b.key];
      if (got == null) return b;
      return Object.assign({}, b, { actual: Number(got), gradedAt: new Date().toISOString() });
    });
  }

  /* Days that still hold something unsettled, newest first — the day you
     care about most is the one that just finished, and it is also the one
     most likely to answer. */
  function ungradedDates(list) {
    const dates = new Set();
    for (const b of list) if (b.actual == null && b.date) dates.add(b.date);
    return Array.from(dates).sort().reverse();
  }

  /* ------------------------------------------------------------------ *
   * The record
   * ------------------------------------------------------------------ */

  function blankTally() {
    return { tracked: 0, graded: 0, hits: 0, expected: 0, variance: 0 };
  }

  function finish(t) {
    /* How far the total could reasonably drift on luck alone. Each bet is
       its own coin with its own bias, so the variance of the sum is the sum
       of p(1-p) and the spread is its root. Without this the panel can only
       say "you hit 9, the model said 8.6", which invites reading a gap of
       0.4 as skill. It is the same test the rest of this project applies to
       itself before calling anything a real effect. */
    t.sd = Math.sqrt(t.variance);
    // Rule 3: hitRate is null, not 0 and not NaN, when nothing has settled.
    // "No record yet" and "a record of none" are different claims, and the
    // page has to be able to tell them apart before it writes a sentence.
    t.hitRate = t.graded > 0 ? t.hits / t.graded : null;
    t.expectedRate = t.graded > 0 ? t.expected / t.graded : null;
    return t;
  }

  function summarise(list) {
    const total = blankTally();
    const byProp = {};

    for (const b of list) {
      const p = (byProp[b.prop] = byProp[b.prop] || blankTally());
      total.tracked++;
      p.tracked++;
      if (b.actual == null) continue;
      total.graded++;
      p.graded++;
      total.hits += b.actual ? 1 : 0;
      p.hits += b.actual ? 1 : 0;
      // Expectation only accumulates alongside a grade, so the two numbers
      // always describe the same set of bets.
      if (isFinite(b.prob)) {
        total.expected += b.prob;
        p.expected += b.prob;
        // Accumulated in the same branch as expected, so sd always covers
        // exactly the bets expected covers.
        total.variance += b.prob * (1 - b.prob);
        p.variance += b.prob * (1 - b.prob);
      }
    }

    total.pending = total.tracked - total.graded;
    for (const k of Object.keys(byProp)) {
      byProp[k].pending = byProp[k].tracked - byProp[k].graded;
      finish(byProp[k]);
    }
    const out = finish(total);
    out.byProp = byProp;
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Storage
   *
   * Corrupt local data must cost the user their log and nothing else. A
   * throw on read would take the whole board down — which is exactly what
   * a stale script did during QA, rendering zero rows with no error
   * anywhere — so parse swallows and returns an empty log.
   * ------------------------------------------------------------------ */

  function parse(raw) {
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return [];
    }
    if (!Array.isArray(data)) return [];
    // Keep whatever is still identifiable; drop the rest rather than
    // carrying half-formed entries into the record.
    return data.filter((b) => b && typeof b === "object" && keyOf(b) === b.key);
  }

  function serialise(list) {
    return JSON.stringify(list);
  }

  return {
    STORAGE_KEY,
    keyOf,
    add,
    remove,
    has,
    resultsFrom,
    applyResults,
    ungradedDates,
    summarise,
    parse,
    serialise,
  };
});
