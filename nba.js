/*
 * BetHouse — nba.js
 * The NBA model: five counting props. Pure functions, no I/O.
 *
 * UMD like nfl.js and score.js: loads as a plain <script> in the browser
 * (after nfl.js) and imports in Node, so the board, the tests and the
 * backtest all run identical code.
 *
 *   POINTS, REBOUNDS, ASSISTS, THREES MADE, POINTS + REBOUNDS + ASSISTS
 *   per player, over/under a line. "How many", so each needs a
 *   distribution, and each gets the same one the football counting props
 *   get: the over is read off real games by players projected near his
 *   level (nfl.js, "Yards and catches"), not off a bell curve. Made
 *   threes are small whole numbers and a normal would be wrong about
 *   them in exactly the way tasks/lessons.md describes.
 *
 * WHAT IS SHARED AND WHAT IS NOT
 * ------------------------------
 * The pool arithmetic (sortedPool, poolNear, poolSize, ratioPool, the
 * count inside empiricalOver), the shrink toward a prior (expectedVolume)
 * and the search, opponent and roster helpers are nfl.js's own functions,
 * taken by reference: two copies of the same rule will disagree. What is
 * basketball's is here: the stat table, the minutes gate, the constants,
 * the availability words, the shape of a box-score line.
 *
 * A season record is {games, min, pts, reb, ast, tpm} with `slog`, the
 * per-game log oldest first, each row [min, pts, reb, ast, tpm]; the data
 * file carries the weighted totals (`w`) in the log's place.
 *
 * Every constant below is measured by backtest-nba.mjs under the README's
 * rule for a model change: fitted on 2024-25, validated on 2025-26 and
 * the 2026-27 games played so far, shipped only where it clears both.
 */
(function (root, factory) {
  const core = typeof module !== "undefined" && module.exports ? require("./nfl.js") : root.BetHouseNFL;
  const api = factory(core);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BetHouseNBA = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (core) {
  "use strict";

  if (!core) throw new Error("nba.js needs nfl.js loaded first: the pool arithmetic is shared, not copied");

  /* ------------------------------------------------------------------ *
   * 1. Constants
   * ------------------------------------------------------------------ */

  /*
   * Every number here was measured on 2026-11-23 by backtest-nba.mjs on
   * FIXED LINES (the README's rule): the graded line and the eligibility
   * from the plain season line, the candidate supplying the probability,
   * paired row for row against the model without the term. Fit on
   * 2024-25 (about 14,800 player-games a prop, five lines each),
   * validated on 2025-26 and the 2026-27 games played so far (about
   * 18,200). Each table is paired Brier Δ/SE, fit / validation.
   */
  const DEFAULTS = {
    /*
     * The shrink: a per-game figure is pulled toward an ordinary
     * player's line by this many games of it. The priors are about 85%
     * of the per-game mean among everyone who logged a minute in
     * 2024-25 (10.65 points, 4.13 rebounds, 2.47 assists, 1.26 threes;
     * backtest-nba.mjs --measure). With the recent-form weights scaled
     * to the game count a player forty games in barely feels it, and
     * less is better: against K = 4, on top of the decays below,
     *
     *          0.5            1              2              3
     *   pts   -2.6 / -6.2    -3.0 / -6.7    -3.6 / -7.0    -3.1 / -6.3
     *   reb   -4.2 / -4.2    -4.3 / -4.6    -4.6 / -6.3    -4.1 / -7.4
     *   ast   -3.2 / -2.3    -4.0 / -3.0    -4.5 / -4.7    -5.2 / -4.5
     *   tpm   +3.4 / -2.8    +1.9 / -3.3    +0.6 / -4.0    -0.7 / -2.3
     *   pra   -1.3 / -5.2    -1.7 / -5.8    -1.6 / -6.7    -1.6 / -6.8
     *
     * 2 where it clears; threes are worse on the fit window under 3 and
     * keep 4. The gains are a tenth of a point of Brier in the fourth
     * decimal: this is the smallest lever here.
     */
    ptsK: 2, rebK: 2, astK: 2, tpmK: 4, praK: 2,
    ptsPrior: 9, rebPrior: 3.6, astPrior: 2.1, tpmPrior: 1, praPrior: 14.7,

    /*
     * THE RECENT-FORM WEIGHT, the largest term by a distance: a game's
     * weight in his line falls by this factor per game of age, the
     * weights scaled to sum to his game count so the shrink is
     * untouched. 1 is equal weights. A basketball season is 82 games and
     * the window is this season and last, so an equal-weight line is
     * mostly a year old. Against equal weights:
     *
     *          0.97           0.95           0.94           0.92           0.90           0.88           0.85
     *   pts   -28.6 / -45.9  -25.3 / -42.0  -24.1 / -40.4  -21.9 / -37.7  -19.8 / -35.7  -18.1 / -33.7  -15.4 / -31.0
     *   reb   -22.6 / -31.5  -19.7 / -27.1  -18.5 / -25.3  -16.3 / -22.4  -14.4 / -20.0  -12.6 / -17.7  -10.2 / -14.8
     *   ast   -27.7 / -35.9  -24.6 / -32.8  -23.2 / -31.5  -21.1 / -29.3  -19.1 / -27.2  -17.4 / -25.3  -15.1 / -22.7
     *   tpm   -17.1 / -25.8  -14.0 / -22.5  -12.6 / -20.9  -10.2 / -18.4   -8.2 / -16.2   -6.5 / -14.2   -4.1 / -11.3
     *   pra   -32.7 / -46.2  -29.6 / -43.1  -28.4 / -41.8  -26.5 / -39.4  -24.9 / -37.5  -23.3 / -35.8  -21.1 / -33.4
     *
     * Δ/SE falls as the decay strengthens because the paired difference
     * gets noisier, not smaller: the Brier gain itself peaks on the fit
     * window at 0.92 for points (0.19292 → 0.18596), rebounds (0.19498 →
     * 0.19060) and assists (0.19774 → 0.18962), at 0.95 for threes
     * (0.20479 → 0.20188; from 0.85 down a band moves worse than 3pp)
     * and at 0.90 for the sum (0.17124 → 0.16220). Chosen on the fit
     * window; each clears validation with no band moving 3pp.
     */
    ptsDecay: 0.92, rebDecay: 0.92, astDecay: 0.92, tpmDecay: 0.95, praDecay: 0.9,
    /*
     * THE MINUTES HE IS GETTING NOW, apart from what he does with one:
     * the line is his per-minute rate (weighted by the stat's own decay)
     * times his minutes a game (weighted by this one, which forgets
     * faster). null is one decay for both, the plain line. A role
     * changes in a night; a shot does not. On top of the decays above:
     *
     *          0.90           0.85           0.80           0.70
     *   pts   -6.6 / -16.0   -5.5 / -14.5   -4.0 / -12.8   -1.0 /  -9.7
     *   reb  -11.9 / -13.0  -10.8 / -12.2   -9.2 / -10.5   -5.9 /  -7.5
     *   ast  -10.4 / -15.7  -10.0 / -14.9   -9.5 / -13.5   -7.6 / -10.9
     *   tpm   -7.3 / -12.0   -6.5 / -11.7   -6.1 / -10.8   -4.1 /  -9.4
     *   pra    0.0 /   0.0   -4.7 / -12.2   -2.5 / -10.3   +1.3 /  -6.4
     *
     * (0.90 is the sum's own decay, so that cell is the plain line.) The
     * Brier gain grows to 0.80 on most props but 0.80 moves a validation
     * band by 3.0pp on rebounds and 2.9 on assists, and 0.70 is worse on
     * the fit window for the sum; 0.85 is the strongest value clean on
     * all five. A slower rate decay with a faster minutes decay (0.97 or
     * 0.95 with 0.85 to 0.65) was tried and moved an assists band 3.8 to
     * 6.8pp on validation.
     */
    minDecay: 0.85,

    /*
     * THE OPPONENT: what the defence allows of a stat (1 = league
     * average, regressed; fetch-nba.mjs seasonLines), applied at this
     * strength. On top of everything above:
     *
     *          0.25           0.5            0.75           1
     *   pts   -9.9 / -11.9   -9.2 / -10.8   -7.8 /  -8.9   -6.2 /  -6.9
     *   reb   -4.7 / -11.0   -4.1 / -10.8   -2.9 /  -9.3   -1.7 /  -7.7
     *   ast  -11.9 / -13.3  -10.8 / -11.9   -9.3 /  -9.3   -7.5 /  -7.2
     *   tpm   -6.4 /  -8.8   -4.8 /  -8.5   -3.5 /  -6.8   -1.9 /  -5.0
     *   pra   -9.6 / -13.5   -8.3 / -12.1   -6.1 / -10.2   -4.3 /  -7.9
     *
     * Every strength clears on every prop. The Brier gain on the fit
     * window peaks at 0.75 for rebounds, threes and the sum and is a
     * plateau from 0.75 to 1 for points and assists (1 is the sweep's
     * edge, not a peak), so 0.75 for all five.
     */
    ptsOppShrink: 0.75, rebOppShrink: 0.75, astOppShrink: 0.75, tpmOppShrink: 0.75, praOppShrink: 0.75,
    /*
     * HOME FLOOR, DEAD: the projection scaled by 1 + this at home and
     * 1 - this away. At 1% it is noise on every prop (assists the one
     * narrow pass, Δ/SE -1.4 / -2.0 for three hundred-thousandths of
     * Brier); at 2% and up it is worse on both windows for points,
     * rebounds and the sum. His own line already holds half his games
     * at home. Wired at 0 for the record.
     */
    ptsHome: 0, rebHome: 0, astHome: 0, tpmHome: 0, praHome: 0,

    /* The gate: games on file, minutes a game (recent-weighted like the
       line), and a floor under which no line is worth offering. A
       choice, not a fit: who a book would post a line for. */
    minGames: 5,
    minMinutes: 15,
    ptsFloor: 8, rebFloor: 3, astFloor: 2, tpmFloor: 1, praFloor: 14,

    /*
     * Pools: a game enters at this expectation or above (half the
     * board's floor), and a player's over is read off this share of the
     * pool nearest his projection. The whole pool (0) is the worst thing
     * measured here, Δ/SE +10 to +27 against a quarter on every prop
     * with bands 5 to 10pp off: a ten-point scorer and a thirty-point
     * one do not share a shape. Half is worse too (+2 to +13); a tenth
     * to a third is inside the noise of a quarter.
     */
    ptsPoolFloor: 4, rebPoolFloor: 1.5, astPoolFloor: 1, tpmPoolFloor: 0.5, praPoolFloor: 7,
    ptsPoolShare: 0.25, rebPoolShare: 0.25, astPoolShare: 0.25, tpmPoolShare: 0.25, praPoolShare: 0.25,
    /* The most recent games a pool keeps: what the data file can carry under the 1 MB ceiling, and what the replay prices off. */
    poolKeep: 6000,
    /* A rung is shown and recorded between this chance and one minus it. */
    ladderEdge: 0.02,
  };

  const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
  const num = (v) => (typeof v === "number" && isFinite(v) ? v : 0);
  const merged = (opts) => Object.assign({}, DEFAULTS, opts || {});

  /*
   * THE STAT TABLE. One shape for every prop, the football table's: the
   * record fields that make the total, a prior the per-game rate is
   * shrunk toward, a floor, a pool. `unit` is what the board calls a
   * count of it, `decimals` how a projection of it prints (a made three
   * rounded to a whole number is no projection) and `who` whose games
   * the pool is made of. The opportunity behind every one is minutes.
   */
  const row = (id, label, total, unit) => ({
    label, total, unit, decimals: 1, who: "rotation players", opportunity: "min", opportunityWord: "minutes",
    priorKey: id + "Prior", kKey: id + "K", poolFloorKey: id + "PoolFloor", poolShareKey: id + "PoolShare",
    floorKey: id + "Floor", oppShrinkKey: id + "OppShrink", decayKey: id + "Decay", homeKey: id + "Home",
  });
  const STATS = {
    pts: row("pts", "Points", ["pts"], "points"),
    reb: row("reb", "Rebounds", ["reb"], "rebounds"),
    ast: row("ast", "Assists", ["ast"], "assists"),
    tpm: row("tpm", "Threes made", ["tpm"], "threes"),
    pra: row("pra", "Pts + reb + ast", ["pts", "reb", "ast"], "pts + reb + ast"),
  };

  /* The lines a book offers. "N+" is at least N, so a rung is the over of N - 0.5. */
  const LADDERS = {
    pts: [5, 8, 10, 12, 15, 18, 20, 22, 25, 30, 35, 40, 45, 50],
    reb: [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16],
    ast: [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14],
    tpm: [1, 2, 3, 4, 5, 6, 7, 8],
    pra: [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60],
  };

  /* Where each field sits in a log row: [min, pts, reb, ast, tpm]. */
  const LOG = { min: 0, pts: 1, reb: 2, ast: 3, tpm: 4 };
  /** A box-score line as a log row. */
  function logRow(p) {
    const b = p || {};
    return [num(b.min), num(b.pts), num(b.reb), num(b.ast), num(b.tpm)];
  }

  /* ------------------------------------------------------------------ *
   * 2. The line
   * ------------------------------------------------------------------ */

  /** A stat's total on a season record, or its value on a box-score line: the fields the row names, summed. */
  function statTotal(stat, record) {
    const st = STATS[stat];
    if (!st || !record) return 0;
    let t = 0;
    for (const f of st.total) t += num(record[f]);
    return t;
  }
  const gameValue = statTotal;

  /** Minutes on file: the opportunity behind every prop. */
  function statOpportunity(stat, record) {
    return STATS[stat] && record ? num(record.min) : 0;
  }

  /* Σ decay^age × value over a log, newest at weight 1; `value` reads a row. */
  function wsum(log, decay, value) {
    let s = 0;
    for (let k = 0; k < log.length; k++) s += Math.pow(decay, log.length - 1 - k) * value(log[k]);
    return s;
  }
  const rowStat = (stat) => { const idx = STATS[stat].total.map((f) => LOG[f]); return (r) => { let v = 0; for (const i of idx) v += num(r[i]); return v; }; };
  const rowMin = (r) => num(r[LOG.min]);
  const one = () => 1;

  /**
   * His recent-weighted total of a stat, scaled to the game count. With
   * one decay it is the weighted mean times his games. With `minDecay`
   * it is his per-minute rate (the stat's decay) times his minutes a
   * game (minDecay), times his games: what he does with a minute, and
   * the minutes he gets now. From the log when the record carries one,
   * else the fetcher's `w`, else the plain total.
   */
  function weightedStatTotal(stat, record, opts) {
    const o = merged(opts);
    const st = STATS[stat];
    const plain = statTotal(stat, record);
    if (!st || !record) return plain;
    const d = num(o[st.decayKey]) || 1;
    const dm = o.minDecay == null ? d : num(o.minDecay) || 1;
    if (!(d < 1) && !(dm < 1)) return plain;
    const log = record.slog;
    if (Array.isArray(log) && log.length) {
      const val = rowStat(stat);
      if (dm === d) { const ws = wsum(log, d, one); return ws > 0 ? wsum(log, d, val) * (log.length / ws) : plain; }
      const rateMin = wsum(log, d, rowMin), ws = wsum(log, dm, one);
      if (!(rateMin > 0) || !(ws > 0)) return plain;
      return (wsum(log, d, val) / rateMin) * (wsum(log, dm, rowMin) / ws) * log.length;
    }
    if (record.w && record.w[stat] != null && isFinite(record.w[stat])) return num(record.w[stat]);
    return plain;
  }

  /** His recent-weighted minutes a game, for the gate: the minutes decay, or the gate's stat's own. */
  function weightedMinutes(stat, record, opts) {
    const o = merged(opts);
    const g = num(record && record.games);
    if (!(g > 0)) return 0;
    const st = STATS[stat];
    const d = o.minDecay == null ? (st ? num(o[st.decayKey]) || 1 : 1) : num(o.minDecay) || 1;
    const log = record.slog;
    if (d < 1 && Array.isArray(log) && log.length) { const ws = wsum(log, d, one); if (ws > 0) return wsum(log, d, rowMin) / ws; }
    if (d < 1 && record.w && record.w.min && record.w.min[stat] != null && isFinite(record.w.min[stat])) return num(record.w.min[stat]);
    return num(record.min) / g;
  }

  /** What the fetcher writes in the log's place: each stat's weighted total and the gate's weighted minutes; null with every decay at 1 or no log. */
  function weightedStatTotals(record, opts) {
    const o = merged(opts);
    if (!record || !Array.isArray(record.slog) || !record.slog.length) return null;
    const out = {}, min = {};
    for (const stat of Object.keys(STATS)) {
      const d = num(o[STATS[stat].decayKey]) || 1;
      if (!(d < 1) && !(o.minDecay != null && num(o.minDecay) < 1)) continue;
      out[stat] = Number(weightedStatTotal(stat, record, o).toFixed(2));
      min[stat] = Number(weightedMinutes(stat, record, o).toFixed(2));
    }
    if (!Object.keys(out).length) return null;
    out.min = min;
    return out;
  }

  /** The shrunk per-game expectation: the weighted line pulled toward the stat's prior by its K games (nfl.js expectedVolume, the one shrink). */
  function expectedStat(stat, record, opts) {
    const st = STATS[stat];
    if (!st || !record) return null;
    const o = merged(opts);
    return core.expectedVolume(weightedStatTotal(stat, record, o), record.games, o[st.priorKey], { yardK: o[st.kKey] });
  }

  /** The opponent's allowance at the stat's strength, clamped like the football factors; 1 with no opponent or no strength. */
  function statOppFactor(stat, allow, opts) {
    const o = merged(opts);
    const st = STATS[stat];
    const f = num(allow);
    if (!st || !(f > 0)) return 1;
    return clamp(1 + num(o[st.oppShrinkKey]) * (f - 1), 0.6, 1.6);
  }

  /** Home floor: 1 + the stat's strength at home, 1 - it away, 1 when the side is not known. */
  function statHomeFactor(stat, home, opts) {
    const o = merged(opts);
    const st = STATS[stat];
    if (!st || home == null) return 1;
    const h = num(o[st.homeKey]);
    return home ? 1 + h : 1 - h;
  }

  /**
   * The projection, gate or no gate: his own expectation times the
   * opponent's factor and the floor's. The pools divide by this, the
   * board and the tracker print it, and it is computed here only.
   * `ctx.oppFactor` is the opponent's allowance, `ctx.home` whether he is
   * at home.
   */
  function projectedStat(stat, record, opts, ctx, base) {
    const o = merged(opts);
    const b = base != null ? base : expectedStat(stat, record, o);
    if (b == null) return null;
    const oppFactor = statOppFactor(stat, ctx && ctx.oppFactor, o);
    const homeFactor = statHomeFactor(stat, ctx ? ctx.home : null, o);
    return { exp: b * oppFactor * homeFactor, base: b, oppFactor, homeFactor, vacFactor: 1 };
  }

  /**
   * Whether a row for this stat belongs on the board, and at what
   * projection; null when it does not. THE ONE GATE: the page shows a
   * row iff this says so and the tracker records a row iff this says so,
   * so the record never grades a bet the board did not offer. The gate
   * is his own line (games, minutes, the floor); the opponent moves the
   * projection, never who is on the board.
   */
  function statEligible(stat, record, opts, ctx) {
    const o = merged(opts);
    const st = STATS[stat];
    if (!st || !record) return null;
    if (!(num(record.games) >= o.minGames)) return null;
    if (!(weightedMinutes(stat, record, o) >= o.minMinutes)) return null;
    const base = expectedStat(stat, record, o);
    if (!(base >= o[st.floorKey])) return null;
    return projectedStat(stat, record, o, ctx, base);
  }

  /**
   * The line a projection is offered and recorded at: the half number
   * nearest it, times the board's Low / High multiple. Football rounds
   * the projection first (nfl.js lineFor), which is nothing in yards and
   * most of a made three: 2.6 would be offered at 3.5. The nearest half
   * keeps every prop's own line within half a count of its projection.
   */
  function lineFor(expected, mult) {
    return Math.floor(num(expected) * (mult == null ? 1 : num(mult))) + 0.5;
  }

  /* ------------------------------------------------------------------ *
   * 3. The over
   * ------------------------------------------------------------------ */

  /** The ratios an over is read off: the stat's share of a levelled pool nearest `expected`, or the whole of a flat one. */
  function poolReads(pool, expected, opts) {
    if (!pool) return [];
    if (Array.isArray(pool)) return pool;
    if (!Array.isArray(pool.exp) || !Array.isArray(pool.ratio)) return [];
    const o = merged(opts);
    const st = STATS[pool.stat];
    const share = st ? num(o[st.poolShareKey]) : 0;
    if (!(share > 0)) return pool.ratio;
    return core.poolNear(pool, expected, Math.round(share * pool.ratio.length));
  }

  /** P(actual > threshold): the share of the games read (poolReads) that, rescaled to his projection, cleared it. The count is nfl.js's. */
  function empiricalOver(expected, threshold, pool, opts) {
    return core.empiricalOver(expected, threshold, poolReads(pool, expected, opts));
  }

  /** Every rung of the stat's ladder with the chance he reaches it, off the same games as his line; empty with nothing to read it off. */
  function ladder(stat, expected, pool, opts) {
    const o = merged(opts);
    const rungs = LADDERS[stat];
    const e = num(expected);
    if (!rungs || !(e > 0) || !core.poolSize(pool)) return [];
    const edge = num(o.ladderEdge);
    const reads = poolReads(pool, e, o);
    const out = [];
    for (const at of rungs) {
      const line = at - 0.5;
      const prob = core.empiricalOver(e, line, reads);
      if (prob == null || prob < edge || prob > 1 - edge) continue;
      out.push({ at, line, prob });
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 4. Recent games
   *
   * The data file's compact rows, newest first:
   * [YYMMDD, opp, min, pts, reb, ast, tpm, team].
   * ------------------------------------------------------------------ */

  const RECENT = { min: 2, pts: 3, reb: 4, ast: 5, tpm: 6 };
  /* The game log's columns, for the board's table. */
  const RECENT_COLUMNS = [
    { label: "min", at: RECENT.min }, { label: "pts", at: RECENT.pts }, { label: "reb", at: RECENT.reb },
    { label: "ast", at: RECENT.ast }, { label: "3pm", at: RECENT.tpm },
  ];
  /** `day` is the league's day the game was played on, YYYYMMDD (fetch-nba.mjs slateDay); the row keeps YYMMDD. */
  function recentRow(day, p, opp) {
    return [String(day || "").slice(2, 8), opp, num(p.min), num(p.pts), num(p.reb), num(p.ast), num(p.tpm), p.team];
  }
  function recentLine(r) {
    const x = Array.isArray(r) ? r : [];
    return { min: num(x[RECENT.min]), pts: num(x[RECENT.pts]), reb: num(x[RECENT.reb]), ast: num(x[RECENT.ast]), tpm: num(x[RECENT.tpm]) };
  }
  function recentValues(stat, recent) {
    return (Array.isArray(recent) ? recent : []).map((r) => gameValue(stat, recentLine(r)));
  }
  function recentHits(stat, recent, rung) {
    return recentValues(stat, recent).filter((v) => v >= num(rung) - 0.5).length;
  }

  /* ------------------------------------------------------------------ *
   * 5. Availability
   *
   * What a book does with a status. Out, suspended, doubtful: the props
   * are void, so the row is not shown and not recorded. Day-to-day and
   * questionable: shown and recorded, flagged; how often such a player
   * plays has not been measured here and the board does not say. Any
   * other word, an unknown one included, is available: the safe failure
   * is a row that may void, not a starter that vanishes.
   * ------------------------------------------------------------------ */

  function availability(status) {
    const s = String(status || "").toLowerCase();
    if (!s) return "ok";
    if (/^(out|doubtful|suspen|injured reserve)/.test(s)) return "out";
    if (/day-to-day|questionable/.test(s)) return "questionable";
    return "ok";
  }

  /**
   * A team's roster off ESPN's roster endpoint: every athlete with the
   * team's code, his position and his latest listing that does not say
   * Active (an Active entry is a return, not a listing). Empty when the
   * payload names no team: a roster that cannot say whose it is moves
   * nobody.
   */
  function parseRoster(payload) {
    const team = payload && payload.team && payload.team.abbreviation;
    if (!team) return [];
    const out = [];
    for (const a of payload.athletes || []) {
      if (!a || a.id == null) continue;
      const entry = (Array.isArray(a.injuries) ? a.injuries : [])
        .filter((i) => i && i.status && !/^active$/i.test(String(i.status)))
        .sort((x, y) => String(y.date || "").localeCompare(String(x.date || "")))[0];
      out.push({
        id: String(a.id), name: a.fullName || a.displayName || "", team,
        pos: (a.position && a.position.abbreviation) || "",
        listed: entry ? String(entry.status) : "", listedAt: entry ? String(entry.date || "") : "",
      });
    }
    return out;
  }

  /**
   * The terms a projection ran under, as one short string: the decay,
   * opponent strength, shrink, prior and home strength of each prop in
   * table order, then the minutes decay: every constant projectedStat
   * reads. The data file carries it and the record stamps every
   * row with it, so the record reads by era and the page can tell a
   * data file built under other constants. Derived, so a constant that
   * moves cannot leave it behind; one string and not sixteen keys
   * because a nightly slate writes it six hundred times.
   */
  function terms(opts) {
    const o = merged(opts);
    const col = (key) => Object.keys(STATS).map((s) => o[STATS[s][key]]).join("/");
    return "decay " + col("decayKey") + " opp " + col("oppShrinkKey") + " k " + col("kKey") + " prior " + col("priorKey") + " home " + col("homeKey") + " min " + (o.minDecay == null ? "-" : o.minDecay);
  }

  /* ------------------------------------------------------------------ *
   * 6. Other constants, same model (the backtest's sweeps)
   * ------------------------------------------------------------------ */

  function bind(overrides) {
    const base = Object.assign({}, DEFAULTS, overrides || {});
    const m = (opts) => Object.assign({}, base, opts || {});
    return Object.assign({}, api, {
      DEFAULTS: base,
      weightedStatTotal: (s, r, o) => weightedStatTotal(s, r, m(o)),
      weightedMinutes: (s, r, o) => weightedMinutes(s, r, m(o)),
      weightedStatTotals: (r, o) => weightedStatTotals(r, m(o)),
      expectedStat: (s, r, o) => expectedStat(s, r, m(o)),
      statOppFactor: (s, a, o) => statOppFactor(s, a, m(o)),
      statHomeFactor: (s, h, o) => statHomeFactor(s, h, m(o)),
      projectedStat: (s, r, o, c, b) => projectedStat(s, r, m(o), c, b),
      statEligible: (s, r, o, c) => statEligible(s, r, m(o), c),
      poolReads: (p, e, o) => poolReads(p, e, m(o)),
      empiricalOver: (e, t, p, o) => empiricalOver(e, t, p, m(o)),
      ladder: (s, e, p, o) => ladder(s, e, p, m(o)),
      terms: (o) => terms(m(o)),
      TERMS: terms(base),
      bind: (more) => bind(Object.assign({}, overrides || {}, more || {})),
    });
  }

  const api = {
    DEFAULTS, STATS, LADDERS, RECENT_COLUMNS,
    logRow, statTotal, gameValue, statOpportunity,
    weightedStatTotal, weightedMinutes, weightedStatTotals, expectedStat,
    statOppFactor, statHomeFactor, projectedStat, statEligible, lineFor,
    poolReads, empiricalOver, ladder,
    recentRow, recentLine, recentValues, recentHits,
    availability, parseRoster, terms, bind,
    /* The shipped constants' terms, as a value: what a data file's stamp is compared with. */
    TERMS: terms(),
    /* nfl.js's own, by reference. */
    sortedPool: core.sortedPool, poolNear: core.poolNear, poolSize: core.poolSize, ratioPool: core.ratioPool,
    playerMatches: core.playerMatches, opponentIn: core.opponentIn, allowOf: core.allowOf,
    recentDate: core.recentDate, applyRosters: core.applyRosters,
  };
  return api;
});
