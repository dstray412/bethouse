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
   * opposite directions, and a doubleheader is two games. A football leg
   * is a line sold as a number and up (20+ receiving yards), so its rung
   * is part of its identity too: 20+ and 30+ on one receiver are two legs.
   *
   * One BET is the set of its legs. Sorted, so reordering the slip is not
   * a different wager — otherwise the same three legs dragged into a
   * different order would log twice.
   * ------------------------------------------------------------------ */

  function legKey(leg) {
    if (!leg) return null;
    const { gamePk, playerId, prop, rung } = leg;
    if (gamePk == null || playerId == null || !prop) return null;
    return `${gamePk}|${playerId}|${prop}` + (rung != null ? `|${rung}` : "");
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

  const RECORD_DIR = { NFL: "nfl-record" };
  const isDay = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);

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
    /* A football leg: the rung it is sold at, the league (for the headshot
       and the record directory), the kickoff (a bet after it is retro) and
       the record day (the tracker names a week's file for its first
       kickoff), so the log can find the box line that grades it. */
    /* The league and the record day become a fetch path on the bet log, so
       only a league the log grades and a calendar date are kept: an
       imported or hand-edited log cannot widen the path. */
    if (l.rung != null && isFinite(l.rung)) out.rung = Number(l.rung);
    if (l.league && RECORD_DIR[String(l.league).toUpperCase()]) out.league = String(l.league).toUpperCase();
    /* A football leg from a league the log no longer grades (the college
       board, removed 2026-10-16) can never be fetched a box line: the book
       voids a market it cannot settle, and so does the log. */
    if (out.rung != null && l.league && !out.league) out.void = true;
    if (l.kickoff) out.kickoff = String(l.kickoff);
    if (isDay(l.recordDay)) out.recordDay = String(l.recordDay);
    /* No market, no price, no closing number on a new leg: a leg is the pick
       and the chance (the price fields went on 2026-10-17 with the odds
       feed). A log written before then keeps what it had: the fields pass
       through untouched, so nothing a bettor recorded is lost on the next
       save; nothing reads or shows them. */
    for (const k of ["marketKey", "priceAtBet", "noVigAtBet", "noVigAtClose", "priceAtClose"]) if (l[k] != null) out[k] = l[k];
    // Carried through when present. A tap from the board never supplies it —
    // the game has not started — but an import or a migration does, and
    // rebuilding without it would erase a settled record.
    if (l.actual != null) out.actual = Number(l.actual);
    // A scratched player's leg: the book would void it. Carried like a grade.
    if (l.void === true) out.void = true;
    return out;
  }

  function build(legs, prob, date, extra) {
    if (!Array.isArray(legs) || !legs.length) return null;
    const normed = legs.map(normLeg);
    /* Every leg void at build (a slip of legs the log no longer grades): nothing left to settle, so it is settled void now. */
    const allVoid = normed.every((l) => l.void === true);
    const bet = Object.assign(
      {
        legs: normed,
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
        : (extra && extra.void === true) || allVoid
          ? { void: true, gradedAt: (extra && extra.gradedAt) || new Date().toISOString() }
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

  /* A football row's box line, read at a rung: the stat the prop counts, at or over the rung is a hit. */
  const BOX = { td: (b) => b.td, recyds: (b) => b.recYds, rushyds: (b) => b.rushYds, passyds: (b) => b.passYds, recs: (b) => b.recs, rushrec: (b) => Number(b.rushYds) + Number(b.recYds) };
  function boxHit(prop, box, rung) {
    const f = BOX[prop];
    if (!f || !box) return null;
    const v = f(box);
    return v == null || !isFinite(v) ? null : Number(v) >= Number(rung) ? 1 : 0;
  }

  /*
   * A history day read into leg key -> outcome. A baseball row carries
   * `actual` for the prop it was about, and that is the leg. A football
   * row (the tracker's record day) carries the box line (`result`) once
   * the game is final, and the leg is a rung of the caller's choosing,
   * so `held` (the log) says which rungs to read; without it a football
   * day grades nothing, since the row's own line is not a held leg.
   */
  function resultsFrom(historyDay, held) {
    const out = {};
    const rows = historyDay && historyDay.predictions;
    if (!Array.isArray(rows)) return out;
    const want = {};
    for (const b of Array.isArray(held) ? held : []) {
      if (!b || b.actual != null || !Array.isArray(b.legs)) continue;
      for (const l of b.legs) {
        if (!l || l.rung == null || l.actual != null) continue;
        const base = `${l.gamePk}|${l.playerId}|${l.prop}`;
        (want[base] = want[base] || new Set()).add(Number(l.rung));
      }
    }
    for (const r of rows) {
      if (!r) continue;
      const id = r.gamePk != null ? r.gamePk : r.gameId;
      const base = id != null && r.playerId != null && r.prop ? `${id}|${r.playerId}|${r.prop}` : null;
      if (base && want[base] && (r.result || r.scratched)) {
        for (const rung of want[base]) {
          /* Inactive, or never touched the ball: the tracker marks him scratched and counts no miss; the book voids the leg. */
          const hit = r.scratched ? "void" : boxHit(r.prop, r.result, rung);
          if (hit != null) out[`${base}|${rung}`] = hit;
        }
        continue;
      }
      // `actual` is 0 for a miss, so test for absence rather than falsiness.
      if (r.actual == null) continue;
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
    let allIn = true, stood = 0;
    for (const l of legs) {
      if (l.void) continue; // a voided leg comes off the slip; the rest settle as a shorter parlay, as a book does it
      stood++;
      if (l.actual == null) {
        allIn = false;
        continue;
      }
      if (Number(l.actual) === 0) return 0;
    }
    if (!stood) return "void";
    return allIn ? 1 : null;
  }

  function applyResults(list, results) {
    if (!results) return list.slice();
    return list.map((b) => {
      // Rule 2: first grade wins, for the bet as a whole; a void is a grade.
      if (b.actual != null || b.void) return b;

      let touched = false;
      const legs = b.legs.map((l) => {
        if (l.actual != null || l.void) return l;
        const got = results[legKey(l)];
        if (got == null) return l;
        touched = true;
        return got === "void" ? Object.assign({}, l, { void: true }) : Object.assign({}, l, { actual: Number(got) });
      });
      if (!touched) return b;

      const out = Object.assign({}, b, { legs: legs });
      const verdict = settle(legs);
      if (verdict === "void") {
        out.void = true;
        out.gradedAt = new Date().toISOString();
      } else if (verdict != null) {
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
    for (const b of list) if (b.actual == null && !b.void && b.date) dates.add(b.date);
    return Array.from(dates).sort().reverse();
  }

  /* Where the grades live, for every bet still open: a baseball bet in
     history/<its date>.json (what track.mjs writes), a football leg in
     <league>-record/<its record day>.json (what track-football.mjs
     writes, a file a week named for its first kickoff). Newest first,
     football before baseball; a football leg without a record day has
     nowhere to be graded and is not sent to the baseball file. */
  function recordPaths(list) {
    const ball = new Set(), foot = new Set();
    for (const b of list || []) {
      if (!b || b.actual != null || b.void || !Array.isArray(b.legs)) continue;
      for (const l of b.legs) {
        if (!l || l.actual != null || l.void) continue;
        const dir = l.league && RECORD_DIR[String(l.league).toUpperCase()];
        if (dir) { if (isDay(l.recordDay)) foot.add(dir + "/" + l.recordDay + ".json"); } // checked again here: storage can be hand-edited
        else if (l.rung == null && isDay(b.date)) ball.add("history/" + b.date + ".json"); // a rung is a football leg: without a league it has nowhere to grade
      }
    }
    return Array.from(foot).sort().reverse().concat(Array.from(ball).sort().reverse());
  }

  /* ------------------------------------------------------------------ *
   * The record
   * ------------------------------------------------------------------ */

  function blankTally() {
    return { tracked: 0, graded: 0, void: 0, hits: 0, expected: 0, variance: 0 };
  }

  function count(t, b) {
    t.tracked++;
    if (b.void) { t.void++; return; } // settled, with nothing to grade
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
    t.pending = t.tracked - t.graded - t.void;
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
    recordPaths,
    boxHit,
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
