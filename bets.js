/*
 * BetHouse — bets.js
 * The bets you actually placed, and how they turned out.
 *
 * UMD-ish: loads as a plain <script> in the browser (sets window.BetHouseBets)
 * and imports in Node (`import bets from './bets.js'`) so `node --test` runs
 * the exact code the board runs. Same shape as edge.js and score.js.
 *
 * A SINGLE IS A PARLAY WITH ONE LEG
 * ---------------------------------
 * Every bet here is `{ legs: [...], prob, date }`. The first version of this
 * file stored one player per entry and would have needed a second shape, a
 * second grading path and a second summary the moment parlays arrived — two
 * of everything, and this project has been bitten four times by two copies of
 * a rule drifting apart. One shape costs a migration once and nothing after.
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
 *   1. AFTER-THE-FACT ENTRY IS MARKED, NOT FORBIDDEN. The first version
 *      refused any bet on a game that had started, borrowing track.mjs's
 *      pregame-only rule. That rule exists to stop the MODEL grading itself
 *      on lookahead; applied to the user's own log it was simply wrong,
 *      because it made writing down a bet you actually placed impossible.
 *      A bet entered once the result was known carries `retro` and is
 *      tallied separately. That is a fact about the entry, not a suspicion
 *      about the person, and the record needs it to keep meaning anything.
 *   2. FIRST GRADE WINS. Once a bet has an outcome it is never rewritten, so
 *      rebuilding a history file cannot turn a loss into a win.
 *   3. EXPECTATION AND SPREAD COVER EXACTLY THE GRADED BETS. "9 hit, model
 *      expected 8.6" is only a sentence worth reading if both numbers cover
 *      the same wagers.
 *
 * There is no stake and no price here. Those were not asked for, and without
 * a price this cannot and does not claim to tell you whether you made money —
 * only whether your bets landed as often as the model said they would.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BetHouseBets = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* Storage keys carry a version. A shape change gets a new key rather than
     silently misreading the old one; LEGACY_KEY is read once and migrated. */
  const STORAGE_KEY = "bethouse.bets.v2";
  const LEGACY_KEY = "bethouse.bets.v1";

  /* ------------------------------------------------------------------ *
   * Identity
   *
   * One LEG is one player, in one game, on one prop. The same hitter on
   * 1+ H/R/RBI and on 2+ total bases is two legs that can settle in
   * opposite directions, and a doubleheader is two games.
   *
   * One BET is the set of its legs. Sorted, so reordering the slip is not
   * a different wager — otherwise the same three legs dragged into a
   * different order would log twice.
   * ------------------------------------------------------------------ */

  function legKey(leg) {
    if (!leg) return null;
    const { gamePk, playerId, prop } = leg;
    if (gamePk == null || playerId == null || !prop) return null;
    return `${gamePk}|${playerId}|${prop}`;
  }

  function keyOf(bet) {
    if (!bet || !Array.isArray(bet.legs) || !bet.legs.length) return null;
    const keys = bet.legs.map(legKey);
    if (keys.some((k) => !k)) return null;
    return keys.slice().sort().join("+");
  }

  /* ------------------------------------------------------------------ *
   * Building
   * ------------------------------------------------------------------ */

  function normLeg(l) {
    const out = {
      gamePk: l.gamePk,
      playerId: l.playerId,
      prop: l.prop,
      propLabel: l.propLabel || l.prop,
      name: l.name || "",
      team: l.team || "",
      prob: isFinite(l.prob) ? Number(l.prob) : null,
    };
    // Carried through when present. A tap from the board never supplies it —
    // the game has not started — but an import or a migration does, and
    // rebuilding without it would erase a settled record.
    if (l.actual != null) out.actual = Number(l.actual);
    return out;
  }

  function build(legs, prob, date, extra) {
    if (!Array.isArray(legs) || !legs.length) return null;
    const bet = Object.assign(
      {
        legs: legs.map(normLeg),
        // The number you were SHOWN when you bet, not a recomputation from
        // legs the model has since revised. Recomputing later would compare
        // your decision against evidence you never had.
        prob: isFinite(prob) ? Number(prob) : null,
        date: date || "",
        addedAt: (extra && extra.addedAt) || new Date().toISOString(),
      },
      // Present only when true, so the flag means something wherever it
      // appears and entries written before it existed need no rewriting.
      extra && extra.retro ? { retro: true } : {},
      extra && extra.actual != null
        ? { actual: Number(extra.actual), gradedAt: extra.gradedAt || new Date().toISOString() }
        : {},
    );
    const key = keyOf(bet);
    if (!key) return null;
    bet.key = key;
    return bet;
  }

  function single(pick, date, opts) {
    if (!pick) return null;
    return build([pick], pick.prob, date || pick.date, Object.assign({}, pick, opts));
  }

  function parlay(legs, combinedProb, date, opts) {
    return build(legs, combinedProb, date, opts);
  }

  function add(list, bet) {
    if (!bet) return list.slice();
    /* Three shapes arrive here and all of them are legitimate: a built bet,
       an entry rebuilt from storage or a hand-edited export, and a BARE PICK
       straight off a board row. The last one is a one-leg bet — that is the
       module's whole premise — and treating it as unrecognisable is how the
       row button silently did nothing for a day in production. migrate()
       already accepted both shapes; this now matches it. */
    const made = bet.legs
      ? build(bet.legs, bet.prob, bet.date, bet)
      : build([bet], bet.prob, bet.date, bet);
    if (!made) return list.slice();
    if (has(list, made.key)) return list.slice();
    return list.concat([made]);
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
   * props. So a leg picked from the board is already in that file and is
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
      const key = legKey(r);
      if (key) out[key] = Number(r.actual);
    }
    return out;
  }

  /*
   * What a set of legs adds up to.
   *
   * A parlay DIES ON THE FIRST MISS. It does not wait for the rest: a 3.05pm
   * leg that missed has already decided a slip whose other legs are 10pm
   * starts, and showing it OPEN for another seven hours would be withholding
   * a result the board already knows.
   *
   * It only pays when every leg is in and every leg hit.
   */
  function settle(legs) {
    let allIn = true;
    for (const l of legs) {
      if (l.actual == null) {
        allIn = false;
        continue;
      }
      if (Number(l.actual) === 0) return 0;
    }
    return allIn ? 1 : null;
  }

  function applyResults(list, results) {
    if (!results) return list.slice();
    return list.map((b) => {
      // Rule 2: first grade wins, for the bet as a whole.
      if (b.actual != null) return b;

      let touched = false;
      const legs = b.legs.map((l) => {
        if (l.actual != null) return l;
        const got = results[legKey(l)];
        if (got == null) return l;
        touched = true;
        return Object.assign({}, l, { actual: Number(got) });
      });
      if (!touched) return b;

      const out = Object.assign({}, b, { legs: legs });
      const verdict = settle(legs);
      if (verdict != null) {
        out.actual = verdict;
        out.gradedAt = new Date().toISOString();
      }
      return out;
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

  function count(t, b) {
    t.tracked++;
    if (b.actual == null) return;
    t.graded++;
    t.hits += b.actual ? 1 : 0;
    if (isFinite(b.prob)) {
      // Accumulated in the same branch as the grade, so expected and sd
      // always cover exactly the bets hits covers.
      t.expected += b.prob;
      t.variance += b.prob * (1 - b.prob);
    }
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
    t.pending = t.tracked - t.graded;
    return t;
  }

  function summarise(list) {
    const total = blankTally();
    const singles = blankTally();
    const parlays = blankTally();
    const live = blankTally();
    const retro = blankTally();
    const byProp = {};
    const legSeen = {};

    for (const b of list) {
      count(total, b);
      count(b.legs.length > 1 ? parlays : singles, b);
      count(b.retro ? retro : live, b);

      // A prop bucket per leg, so a mixed parlay shows up under each prop
      // it touches. Bets, not legs, are what `total` counts.
      for (const l of b.legs) {
        const k = legKey(l);
        if (k) legSeen[k] = (legSeen[k] || 0) + 1;
        const p = (byProp[l.prop] = byProp[l.prop] || blankTally());
        p.tracked++;
        if (l.actual != null) {
          p.graded++;
          p.hits += l.actual ? 1 : 0;
          if (isFinite(l.prob)) {
            p.expected += l.prob;
            p.variance += l.prob * (1 - l.prob);
          }
        }
      }
    }

    for (const k of Object.keys(byProp)) finish(byProp[k]);
    const out = finish(total);
    out.singles = finish(singles);
    out.parlays = finish(parlays);
    out.live = finish(live);
    out.retro = finish(retro);
    out.byProp = byProp;

    /* Adding variances assumes the bets are independent OF EACH OTHER. Bet a
       single on a hitter and a parlay containing him and they are anything
       but, so the spread above is understated. The page cannot fix that
       honestly without modelling the joint distribution, but it can say so. */
    out.sharedLegs = Object.keys(legSeen).filter((k) => legSeen[k] > 1).length;
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
    // Keep whatever is still identifiable and self-consistent. A stored key
    // that disagrees with the legs beside it means the entry was tampered
    // with or half-written, and grading it would attach someone else's
    // outcome to it.
    return data.filter((b) => b && typeof b === "object" && keyOf(b) === b.key);
  }

  function serialise(list) {
    return JSON.stringify(list);
  }

  /*
   * v1 stored one pick per entry, player fields at the top level. It shipped
   * on 2026-08-20 and lasted a day; anyone who tracked a bet in that window
   * must not lose it, or their record silently restarts at zero.
   *
   * Safe to hand a v2 log — it runs on every read and on import.
   */
  function migrate(data) {
    if (!Array.isArray(data)) return [];
    const out = [];
    for (const row of data) {
      if (!row || typeof row !== "object") continue;
      const made = row.legs
        ? build(row.legs, row.prob, row.date, row)
        : build([row], row.prob, row.date, row);
      if (made && !has(out, made.key)) out.push(made);
    }
    return out;
  }

  return {
    STORAGE_KEY,
    LEGACY_KEY,
    legKey,
    keyOf,
    single,
    parlay,
    add,
    remove,
    has,
    resultsFrom,
    settle,
    applyResults,
    ungradedDates,
    summarise,
    parse,
    serialise,
    migrate,
  };
});
