/*
 * BetHouse — golf.js
 * Make-the-cut model for the PGA Tour. Pure functions, no I/O.
 *
 * UMD like score.js and edge.js: loads as a plain <script> in the browser
 * and imports in Node, so the board, the tests and the backtest all run
 * identical code.
 *
 * WHY THIS IS NOT LIKE THE BASEBALL MODEL
 * ---------------------------------------
 * Every prop in score.js is a question about one player in isolation: given
 * his rate and his trips to the plate, does he get a hit? Making the cut is
 * not that. The cut is "low 65 and ties" — an ORDER STATISTIC of the whole
 * field. Whether a player survives depends on how the other 155 played, so
 * the players' outcomes are coupled and there is no closed form for one
 * man's probability. Hence Monte Carlo over the entire field: simulate the
 * tournament, find where the line fell, count who was on the right side.
 *
 * That coupling is also the interesting part of the bet. The same player is
 * a different price in a Monday-qualifier field than in a major.
 *
 * THE HONEST PART
 * ---------------
 * Golf is mostly noise. Measured over the 2026 season: true skill spreads
 * about 0.52 strokes per round, while a single round swings 2.7 strokes at
 * random. Over 36 holes the best player in a field is maybe two strokes
 * better than the median and the noise is nearly four. That is why make-cut
 * markets sit near even money, and why nothing in this file will ever spit
 * out a 95% pick for a normal player. If it does, something is broken.
 *
 * Do not trust a number out of this file until `backtest-pga.mjs` says the
 * calibration holds.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BetHouseGolf = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* ------------------------------------------------------------------ *
   * 1. Fitted constants
   *
   * MEASURED, not guessed, over 4,116 player-events and 3,786 R1/R2 pairs
   * from the 2026 season. `backtest-pga.mjs --fit` re-derives them.
   *
   * The variance of one round splits three ways:
   *
   *   true skill    0.52 strokes   who the player actually is
   *   form/fit      1.03 strokes   this week's course, wave and touch,
   *                                shared across his rounds
   *   round noise   2.71 strokes   the part nobody can predict
   *
   * Those imply a 36-hole spread of 4.35 strokes around a player's mean,
   * against an observed 4.48 including the skill spread itself. The
   * decomposition reproduces reality, which is the only reason to trust it.
   * ------------------------------------------------------------------ */

  const DEFAULTS = {
    /*
     * Rounds of evidence before a rating is worth half its face value.
     *
     * Two ways to pin this down disagree slightly. Split-half reliability
     * of the ratings themselves (r = 0.684 over ~27 rounds a side) implies
     * K = 12. Fitting Brier against real cuts lands on K = 6, in both
     * passes. The basin is flat — anything from 4 to 12 is within 0.0005
     * of a Brier point, which at 4,000 sims an event is noise.
     *
     * K = 6 because it is measured on the question actually being asked
     * (did he make the cut) rather than on an intermediate quantity.
     */
    K: 6,
    skillSD: 0.52, // spread of true ability, strokes per round
    formSD: 1.03, // week-level effect shared by a player's rounds
    roundSD: 2.71, // residual per-round noise
    /*
     * Where a player with no tour rounds behind him starts.
     *
     * MEASURED: over 570 first-appearances in 2026, a player making his
     * first start of the season played 1.07 strokes per round worse than
     * the field and made the cut 37.7% of the time, against 57.4% for
     * everyone else. Monday qualifiers, sponsor exemptions and rookies are
     * not average PGA Tour players, and starting them at average was
     * quietly handing free probability to the weakest man in the field.
     *
     * Fitting this against Brier wanted to push it past 2.0, but the gain
     * was five ten-thousandths of a Brier point — Monte Carlo noise. The
     * measured number is the honest one.
     */
    priorSkill: 1.05,
    sims: 20000,
    seed: 20260812,
  };

  /* ------------------------------------------------------------------ *
   * 2. Cut rules
   *
   * The tour standard is low 65 and ties. Majors and signature events set
   * their own, and some events do not cut at all.
   *
   * This table was WRONG on first writing and the data caught it: the
   * signature events (Genesis, Bay Hill, Memorial) were assumed to have no
   * cut, but 2026 shows them cutting 21, 22 and 19 players respectively —
   * they cut at 50. Any change here should be checked the same way, by
   * counting STATUS_CUT in pga-history.json, not by memory.
   * ------------------------------------------------------------------ */

  const CUT_50 = ["masters", "genesis invitational", "arnold palmer", "memorial tournament"];
  const CUT_60 = ["u.s. open"];
  const CUT_70 = ["pga championship", "the open", "open championship"];

  /** No cut at all: limited fields, playoffs, exhibitions. */
  const NO_CUT = [
    "sentry", "rbc heritage", "cadillac championship", "truist championship",
    "travelers championship", "fedex st. jude", "bmw championship",
    "tour championship", "presidents cup", "ryder cup", "hero world challenge",
    "q-school",
  ];

  /*
   * Formats this model does not price, and should not pretend to.
   *
   *   Zurich Classic   — two-man teams, so a "score" is not a player's score
   *   American Express — cuts after 54 holes across three courses
   *   Pebble Beach     — three courses in rotation, so a round's field
   *                      average is three different field averages
   *
   * A multi-course round breaks the central assumption that everyone in a
   * given round faced the same test. Excluded from ratings and from the
   * board rather than silently mis-rated.
   */
  const EXCLUDED = ["zurich classic", "american express", "pebble beach"];

  const DEFAULT_CUT = 65;

  function cutRuleFor(name) {
    const n = String(name || "").toLowerCase();
    for (const x of EXCLUDED) if (n.includes(x)) return { cut: null, excluded: true };
    for (const x of NO_CUT) if (n.includes(x)) return { cut: null, excluded: false };
    for (const x of CUT_50) if (n.includes(x)) return { cut: 50, excluded: false };
    for (const x of CUT_60) if (n.includes(x)) return { cut: 60, excluded: false };
    for (const x of CUT_70) if (n.includes(x)) return { cut: 70, excluded: false };
    return { cut: DEFAULT_CUT, excluded: false };
  }

  /* ------------------------------------------------------------------ *
   * 3. Randomness
   *
   * Seeded, so a board built twice is the same board and a failing test
   * can be re-run. mulberry32 — small, fast, good enough for Monte Carlo.
   * ------------------------------------------------------------------ */

  function makeRng(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Standard normal, Box-Muller. */
  function normal(rng) {
    let u = 0;
    while (u === 0) u = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
  }

  /* ------------------------------------------------------------------ *
   * 4. The cut line
   *
   * "Low N and ties" means: find the Nth best score; everyone at or better
   * than it plays the weekend. The line is always a score somebody shot,
   * never an interpolation, which is what makes ties expand the field.
   * ------------------------------------------------------------------ */

  function cutLine(scores, n) {
    const sorted = Array.prototype.slice.call(scores).sort((a, b) => a - b);
    if (!sorted.length) return Infinity;
    const idx = Math.min(Math.max(1, n | 0), sorted.length) - 1;
    return sorted[idx];
  }

  /* ------------------------------------------------------------------ *
   * 5. Ratings — a two-way solve
   *
   * A raw scoring average cannot separate "this player is good" from "this
   * player drew the easy course in calm weather". So solve both at once:
   *
   *     score(player, round) = roundDifficulty(round) + skill(player)
   *
   * Alternating least squares. Hold skills fixed and each round's
   * difficulty is the average score it gave up; hold difficulties fixed and
   * each player's skill is his average score over par-for-the-day. Repeat.
   *
   * The player step divides by (roundsPlayed + K) rather than roundsPlayed.
   * That is ridge regression, and it is the same idea as regressing a
   * hitter's rate toward league average in score.js: a player who shot 64
   * once is not a -6 talent, he is a small sample.
   *
   * Splitting difficulty out this way is worth a lot. Measured by
   * split-half reliability across the 2026 season:
   *
   *     raw differential vs field, R1-R2     r = 0.443
   *     this solve, R1-R2                    r = 0.581
   *     this solve, all four rounds          r = 0.684
   *
   * The last line is why rounds 3 and 4 are included even though only
   * players who made the cut have them. A raw differential over those
   * rounds is biased — the weekend field is better than the Thursday field,
   * so the average to beat is tougher — but the round-difficulty term
   * absorbs exactly that, because it is estimated from whoever actually
   * teed off. Throwing the weekend away costs more than the bias does.
   * ------------------------------------------------------------------ */

  const MIN_SCORE = 50;
  const MAX_SCORE = 100;

  function validScore(v) {
    return typeof v === "number" && isFinite(v) && v > MIN_SCORE && v < MAX_SCORE;
  }

  function buildRatings(events, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    const K = o.K;
    const iterations = o.iterations || 60;

    // Flatten to (player, round-key, score), dropping formats we do not model.
    const byPlayer = new Map();
    const byRound = new Map();
    const names = new Map();

    for (const ev of events || []) {
      if (cutRuleFor(ev.name).excluded) continue;
      for (const p of ev.players || []) {
        const rounds = p.rounds || [];
        for (let r = 0; r < rounds.length; r++) {
          if (!validScore(rounds[r])) continue;
          const key = ev.id + "|" + r;
          const obs = { pid: p.id, key, score: rounds[r] };
          if (!byPlayer.has(p.id)) byPlayer.set(p.id, []);
          byPlayer.get(p.id).push(obs);
          if (!byRound.has(key)) byRound.set(key, []);
          byRound.get(key).push(obs);
          if (p.name) names.set(p.id, p.name);
        }
      }
    }

    const skill = new Map();
    const round = new Map();
    for (const pid of byPlayer.keys()) skill.set(pid, 0);
    for (const key of byRound.keys()) round.set(key, 0);

    for (let it = 0; it < iterations; it++) {
      for (const [key, list] of byRound) {
        let s = 0;
        for (const o2 of list) s += o2.score - skill.get(o2.pid);
        round.set(key, s / list.length);
      }
      let total = 0;
      for (const [pid, list] of byPlayer) {
        let s = 0;
        for (const o2 of list) s += o2.score - round.get(o2.key);
        const v = s / (list.length + K);
        skill.set(pid, v);
        total += v;
      }
      // Fix the gauge: skill is defined relative to the field, so it is
      // centred. Without this the split is only identified when K > 0.
      const mean = total / (byPlayer.size || 1);
      for (const [pid, v] of skill) skill.set(pid, v - mean);
    }

    const players = {};
    for (const [pid, list] of byPlayer) {
      players[pid] = {
        id: pid,
        name: names.get(pid) || "",
        skill: skill.get(pid),
        rounds: list.length,
      };
    }
    const roundEffects = {};
    for (const [key, v] of round) roundEffects[key] = v;

    return { players, roundEffects, iterations };
  }

  /* ------------------------------------------------------------------ *
   * 5b. The shape of a golf score
   *
   * A normal is the wrong shape and the backtest proved it. Measured over
   * 3,488 real 36-hole totals from 2026:
   *
   *     standard deviation   4.51 strokes
   *     skewness            +0.48      blow-ups outnumber brilliance
   *     excess kurtosis     +0.69      more peaked than a bell
   *
   * Both of those pile players up in the middle, which is precisely where
   * the cut line falls. Real fields stack about 14.7 players per stroke
   * around the line; a normal with the same spread gives 13.1. Fewer
   * players on the number means fewer ties, and "low 65 AND TIES" is how
   * roughly seven extra players make the weekend every week.
   *
   * So rather than pick a fancier closed form and fit its parameters,
   * sample from the real thing. This is the same instinct as the total
   * bases model in score.js: convolve the actual distribution instead of
   * reaching for a normal approximation.
   *
   * The pool is standardised to mean 0 and SD 1, so `simulateCut` can
   * stretch it to each player's own spread. It carries the shape; the
   * caller supplies the scale.
   *
   * Callers must build this from events the model is allowed to have seen.
   * `backtest-pga.mjs` rebuilds it per tournament from prior events only —
   * the shape of this week's scoring is not knowable in advance either.
   * ------------------------------------------------------------------ */

  function standardizedResiduals(events) {
    const out = [];
    for (const ev of events || []) {
      const rule = cutRuleFor(ev.name);
      if (rule.excluded) continue;
      const totals = [];
      for (const p of ev.players || []) {
        const r = p.rounds || [];
        if (validScore(r[0]) && validScore(r[1])) totals.push(r[0] + r[1]);
      }
      if (totals.length < 40) continue;
      const avg = totals.reduce((a, b) => a + b, 0) / totals.length;
      for (const t of totals) out.push(t - avg);
    }
    if (out.length < 200) return null; // not enough shape to be worth it
    const m = out.reduce((a, b) => a + b, 0) / out.length;
    const sd = Math.sqrt(
      out.reduce((s, x) => s + (x - m) * (x - m), 0) / out.length,
    );
    if (!(sd > 0)) return null;
    return Float64Array.from(out, (x) => (x - m) / sd);
  }

  /* ------------------------------------------------------------------ *
   * 6. The simulation
   *
   * For each simulated tournament, every player draws a 36-hole score
   * measured against the field's average round, then the cut falls where
   * the rules say it falls.
   *
   * A player's 36-hole total, relative to two average rounds, is
   *
   *     2 * skill  +  2 * form  +  noise(R1) + noise(R2)
   *
   * plus the uncertainty in the skill estimate itself, which is large for
   * a rookie with four rounds to his name and small for a veteran with
   * forty. Because the cut only cares about the 36-hole SUM, all four of
   * those independent normals collapse into a single draw:
   *
   *     total = 2*skill + sigma * z
   *     sigma = sqrt( 4*skillError^2 + 4*formSD^2 + 2*roundSD^2 )
   *
   * One normal per player per simulation instead of four. The distribution
   * is identical; it is only cheaper.
   *
   * Course difficulty does not appear because everything is relative to the
   * field. A hard week moves every player's raw score and nobody's chance
   * of making the cut.
   *
   * TIES, WHICH ARE MOST OF THE STORY
   * ---------------------------------
   * The simulated total is ROUNDED, because a golf score is a whole number
   * of strokes. Skipping that step looks harmless and is not: with
   * continuous scores no two players ever tie, so exactly `cutN` survive
   * and "and ties" never fires.
   *
   * Reality is not close to that. In a 150-man field the 36-hole scores
   * pile up about thirteen players deep on each stroke near the line, so
   * whoever is sitting on the number brings a dozen friends with him. The
   * 2026 U.S. Open cut at "low 60 and ties" and sent 72 players to the
   * weekend. A continuous model predicted 38.5% for that field — exactly
   * 60/156, which is the giveaway — where the truth was 46.2%.
   *
   * Rounding the score relative to the field average is the same thing as
   * rounding the raw score: every player in a simulation shares the same
   * field-average offset, and a common shift changes neither who ties whom
   * nor where the line falls.
   * ------------------------------------------------------------------ */

  function simulateCut(field, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    const players = (field || []).filter(Boolean);
    const n = players.length;

    // No cut this week: everyone plays the weekend. Say so plainly rather
    // than printing a board full of 100% "picks".
    if (o.cutN == null) {
      const out = players.map((p) => ({
        id: p.id,
        name: p.name,
        skill: typeof p.skill === "number" ? p.skill : o.priorSkill,
        rounds: p.rounds || 0,
        prob: 1,
        fair: null,
        noCut: true,
      }));
      out.cutLineMean = null;
      return out;
    }

    // Per-player mean and spread of the 36-hole total.
    const mu = new Float64Array(n);
    const sigma = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const p = players[i];
      const rated = typeof p.skill === "number" && isFinite(p.skill);
      const s = rated ? p.skill : o.priorSkill;
      const rounds = p.rounds || 0;
      // Shrinkage leaves this much uncertainty in the estimate itself.
      const err = o.skillSD * Math.sqrt(o.K / (rounds + o.K));
      mu[i] = 2 * s;
      sigma[i] = Math.sqrt(
        4 * err * err + 4 * o.formSD * o.formSD + 2 * o.roundSD * o.roundSD,
      );
    }

    const rng = makeRng(o.seed);
    const made = new Int32Array(n);
    const scores = new Float64Array(n);
    const sorted = new Float64Array(n);
    const sims = Math.max(1, o.sims | 0);
    const cutIdx = Math.min(Math.max(1, o.cutN | 0), n) - 1;
    let lineSum = 0;

    // Draw the shape from real golf scores when the caller supplies them,
    // and fall back to a normal when they do not. The fallback is honest
    // but measurably worse: it under-produces ties. See section 5b.
    const pool = o.residuals && o.residuals.length ? o.residuals : null;
    const poolN = pool ? pool.length : 0;
    const draw = pool
      ? () => pool[(rng() * poolN) | 0]
      : () => normal(rng);

    for (let s = 0; s < sims; s++) {
      for (let i = 0; i < n; i++) {
        // Rounded, because a golf score is a whole number of strokes and
        // the ties that creates are most of the story. See TIES below.
        scores[i] = Math.round(mu[i] + sigma[i] * draw());
        sorted[i] = scores[i];
      }
      sorted.sort();
      const line = sorted[cutIdx];
      lineSum += line;
      // "and ties" is just <=, which is why more than cutN can survive.
      for (let i = 0; i < n; i++) if (scores[i] <= line) made[i]++;
    }

    const out = players.map((p, i) => {
      const prob = made[i] / sims;
      return {
        id: p.id,
        name: p.name,
        skill: typeof p.skill === "number" ? p.skill : o.priorSkill,
        rated: typeof p.skill === "number" && isFinite(p.skill),
        rounds: p.rounds || 0,
        sigma: sigma[i],
        prob,
        fair: fairPrice(prob),
        noCut: false,
      };
    });
    out.sort((a, b) => b.prob - a.prob);
    out.cutLineMean = lineSum / sims;
    out.cutN = o.cutN;
    out.fieldSize = n;
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 7. Pricing
   *
   * Same convention as edge.js: even money is +100.
   * ------------------------------------------------------------------ */

  function fairPrice(p) {
    p = Number(p);
    if (!(p > 0 && p < 1)) return null;
    const d = 1 / p;
    return d >= 2 ? Math.round((d - 1) * 100) : -Math.round(100 / (d - 1));
  }

  return {
    DEFAULTS,
    cutRuleFor,
    cutLine,
    buildRatings,
    standardizedResiduals,
    simulateCut,
    makeRng,
    normal,
    fairPrice,
  };
});
