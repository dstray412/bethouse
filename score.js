/*
 * BetHouse — score.js
 * Ranking model for player props. Pure functions, no I/O.
 *
 * UMD like edge.js: loads as a plain <script> in the browser and imports in
 * Node, so the app, the tests and the backtest all run identical code.
 *
 * THE HONEST PART
 * ---------------
 * Every number this file produces is an estimate built on assumptions, and the
 * assumptions are wrong in ways nobody can eyeball. That is why `backtest.mjs`
 * exists: it replays completed games and measures whether the ranking actually
 * separates winners from losers. Do not trust a probability out of this file
 * until the backtest says the calibration holds. A confident number nobody has
 * checked is the thing this whole project keeps almost building.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BetHouseScore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* ------------------------------------------------------------------ *
   * 1. Plate appearances by lineup slot
   *
   * The leadoff spot gets roughly 4.6 PA a game and each slot down the
   * order loses about a tenth of one. This is the single biggest driver
   * of a 1+ hits/runs/RBI prop: more trips, more chances. A .260 hitter
   * batting first clears it more often than a .290 hitter batting eighth.
   * ------------------------------------------------------------------ */

  const PA_LEADOFF = 4.65;
  const PA_DECAY = 0.105; // PA lost per slot going down the order

  function expectedPA(slot) {
    if (!(slot >= 1 && slot <= 9)) return NaN;
    return PA_LEADOFF - PA_DECAY * (slot - 1);
  }

  /* ------------------------------------------------------------------ *
   * 2. Per-plate-appearance rates
   *
   * Note these are per PA, not per at-bat. Batting average is hits/AB and
   * excludes walks from the denominator, which would overstate the hit
   * chance on a prop that is decided per trip to the plate.
   * ------------------------------------------------------------------ */

  function safeRate(numerator, denominator) {
    if (!(denominator > 0)) return 0;
    const r = numerator / denominator;
    return r > 0 && r < 1 ? r : Math.max(0, Math.min(0.999, r));
  }

  function perPA(player) {
    const pa = Number(player.pa) || 0;
    return {
      hit: safeRate(player.hits, pa),
      run: safeRate(player.runs, pa),
      rbi: safeRate(player.rbi, pa),
    };
  }

  /**
   * Regression to the mean.
   *
   * A call-up who is 5-for-9 has a .556 average and a raw model will happily
   * rank him first on the slate at 99%. He is not the best hitter in baseball,
   * he is a small sample. Blend every player's rate toward the league rate,
   * weighted by how much you have actually seen:
   *
   *   regressed = (events + leagueRate * K) / (PA + K)
   *
   * K is the number of plate appearances at which you trust the player and the
   * league equally. At K=180, a hitter with 9 PA is ~95% league average and a
   * hitter with 600 PA is ~77% himself. This is the single most important
   * guard in the file: without it the board's top row is always whoever went
   * 2-for-3 in his debut.
   */
  const REGRESSION_PA = 180;

  function regressedPerPA(player, leagueRates, opts) {
    opts = opts || {};
    const K = opts.regressionPA == null ? REGRESSION_PA : opts.regressionPA;
    const pa = Number(player.pa) || 0;
    if (!leagueRates || K <= 0) return perPA(player);
    const blend = (events, lgRate) =>
      Math.max(0, Math.min(0.999, (num(events) + lgRate * K) / (pa + K)));
    return {
      hit: blend(player.hits, leagueRates.hit),
      run: blend(player.runs, leagueRates.run),
      rbi: blend(player.rbi, leagueRates.rbi),
    };
  }

  function num(v) {
    const n = Number(v);
    return isFinite(n) ? n : 0;
  }

  /* ------------------------------------------------------------------ *
   * 3. The combined probability
   *
   * The prop cashes on a hit OR a run OR an RBI. Treating those three as
   * independent would be wrong and optimistic: a player who fails to get
   * a hit is also less likely to have scored, because the usual way you
   * score is by getting a hit first. Independence understates the chance
   * of the all-three-miss case and therefore overstates the prop.
   *
   * `correlation` (k) dampens the run and RBI contributions:
   *   k = 0   only hits count. Most conservative.
   *   k = 1   full independence. Most optimistic, and wrong.
   * The right value is somewhere between and is FITTED, not guessed —
   * `backtest.mjs --fit` sweeps k against real outcomes. DEFAULT_K below
   * is a placeholder until that runs.
   * ------------------------------------------------------------------ */

  /*
   * FITTED, not guessed. backtest.mjs --fit swept k against 1,703 real
   * hitter-games (2026-07-26..08-01) and found 0.05, where the mean
   * prediction matches the actual 67.6% cash rate to within half a point.
   *
   * The first version of this file guessed 0.55 and ran 13 percentage points
   * hot: it said 82% where reality was 69.5%. Betting that model at -300
   * would have felt like value on every line and lost steadily. k is this
   * low because the three legs are almost perfectly correlated — you score
   * BECAUSE you got a hit, so runs and RBI add very little independent
   * chance. Re-fit whenever the season's run environment shifts.
   */
  const DEFAULT_K = 0.05;

  /** The core: combine three per-PA rates into one game probability. */
  function probFromRates(rates, pa, k) {
    if (!(pa > 0)) return NaN;
    const noHit = Math.pow(1 - rates.hit, pa);
    const noRun = Math.pow(1 - rates.run, pa);
    const noRbi = Math.pow(1 - rates.rbi, pa);
    const noneAtAll = noHit * Math.pow(noRun, k) * Math.pow(noRbi, k);
    return 1 - Math.max(0, Math.min(1, noneAtAll));
  }

  function probAtLeastOne(player, opts) {
    opts = opts || {};
    const k = opts.correlation == null ? DEFAULT_K : opts.correlation;
    const pa = opts.pa != null ? opts.pa : expectedPA(player.slot);
    if (!(pa > 0)) return NaN;
    const rates = opts.leagueRates ? regressedPerPA(player, opts.leagueRates, opts) : perPA(player);
    return probFromRates(rates, pa, k);
  }

  /* ------------------------------------------------------------------ *
   * 4. Context adjustments
   *
   * Two things move the baseline: who is pitching, and how good the
   * offense around the hitter is. Both are expressed as multipliers on
   * the per-PA rates rather than on the final probability, so a small
   * edge does not get amplified by the exponent.
   * ------------------------------------------------------------------ */

  /**
   * Opposing starter's opponent batting average against, relative to the
   * league. A pitcher allowing .280 when the league allows .245 makes
   * every hitter he faces meaningfully more likely to reach.
   *
   * Clamped hard: a 40-inning sample can produce a .180 or a .330 that
   * says more about luck than about the pitcher.
   */
  function pitcherFactor(oppAvgAllowed, leagueAvgAllowed, opts) {
    opts = opts || {};
    const lg = leagueAvgAllowed > 0 ? leagueAvgAllowed : 0.248;
    if (!(oppAvgAllowed > 0)) return 1;
    const raw = oppAvgAllowed / lg;
    const cap = opts.cap == null ? 0.12 : opts.cap; // +/- 12%
    return Math.max(1 - cap, Math.min(1 + cap, raw));
  }

  /* ------------------------------------------------------------------ *
   * Handedness and home/away
   *
   * Both are supplied as MEASURED league ratios by the fetcher, never
   * assumed here. For 2026 through Aug 2, hits per PA came out:
   *
   *   R-handed batters  vs LHP .2309  vs RHP .2201   (+4.9%)
   *   L-handed batters  vs LHP .2219  vs RHP .2303   (-3.6%)
   *   S-handed batters  vs LHP .2243  vs RHP .2154   (+4.1%)
   *   home .2249  away .2192                          (+2.6%)
   *
   * A warning about the aggregate: pooling all batters together shows only
   * a +1.6% "vs LHP" effect, because righties' +4.9% and lefties' -3.6%
   * partly cancel. Applying that pooled number to everyone would be worse
   * than applying nothing, since it points the wrong way for half the
   * league. Always split by batter handedness.
   *
   * PLAYER-SPECIFIC SPLITS ARE MOSTLY NOISE. A hitter needs on the order of
   * 1,000 PA against one hand before his own platoon split says more than
   * the league's does. So the player's own number is blended in with a very
   * large K, which means for most hitters this is the league effect plus a
   * nudge. That is the honest amount of signal available, not a shortcut.
   * ------------------------------------------------------------------ */

  const PLATOON_K = 600;   // PA vs one hand before a player's own split half-counts
  const HOMEAWAY_K = 800;  // individual home/away splits are even noisier

  /* Below this many PA, ignore the player's own split entirely and use the
     league value. The regression weight at 40 PA is only 6%, but a hot
     40-PA line can be a 1.36x multiplier, and 6% of that still moved the
     final probability by 0.86pp — nearly the size of the entire league
     platoon effect. Forty plate appearances should not get that much say. */
  const MIN_SPLIT_PA = 60;

  /**
   * Multiplier on the hit rate for this batter facing this pitcher's hand.
   *
   * @param batSide   "L" | "R" | "S"
   * @param pitchHand "L" | "R"
   * @param lg        measured ratios: { R:{L:1.035,R:0.986}, L:{...}, S:{...} }
   *                  keyed [batSide][pitchHand], relative to the batter's
   *                  OVERALL rate
   * @param own       optional { hits, pa } for this batter vs this hand
   * @param ownOverall optional the batter's overall hits-per-PA
   */
  function platoonFactor(batSide, pitchHand, lg, own, ownOverall, opts) {
    if (!lg || !batSide || !pitchHand) return 1;
    const row = lg[batSide] || lg["R"];
    if (!row) return 1;
    const leagueMult = row[pitchHand];
    if (!(leagueMult > 0)) return 1;

    // No usable player sample: use the league effect alone.
    if (!own || !(own.pa >= MIN_SPLIT_PA) || !(ownOverall > 0)) return leagueMult;

    const ownMult = safeRate(own.hits, own.pa) / ownOverall;
    /* A ratio this far from 1 means the caller passed mismatched units (for
       example a hits count divided by a home-run rate, which lands near 4.4).
       Clamping that would produce a confident 1.35 in a matchup whose real
       value is 0.75 — pointing the wrong way. Refuse it and fall back to the
       league value instead. */
    if (!(ownMult > 0.4 && ownMult < 2.5)) return leagueMult;

    const w = own.pa / (own.pa + PLATOON_K);
    const blended = w * ownMult + (1 - w) * leagueMult;
    /* Clamp. The floor has to accommodate the real lefty-vs-lefty home run
       effect (~0.71), which a hits-calibrated floor of 0.82 would silently
       truncate — turning a 29% suppression into 18%. */
    const lo = opts && opts.floor != null ? opts.floor : 0.65;
    const hi = opts && opts.ceil != null ? opts.ceil : 1.35;
    return Math.max(lo, Math.min(hi, blended));
  }

  /** Same idea for the ballpark the game is in. */
  function homeAwayFactor(isHome, lg, own, ownOverall) {
    if (!lg) return 1;
    const leagueMult = isHome ? lg.home : lg.away;
    if (!(leagueMult > 0)) return 1;
    if (!own || !(own.pa >= MIN_SPLIT_PA) || !(ownOverall > 0)) return leagueMult;
    const ownMult = safeRate(own.hits, own.pa) / ownOverall;
    if (!(ownMult > 0.4 && ownMult < 2.5)) return leagueMult;
    const w = own.pa / (own.pa + HOMEAWAY_K);
    const blended = w * ownMult + (1 - w) * leagueMult;
    return Math.max(0.88, Math.min(1.14, blended));
  }

  /**
   * Team runs per game relative to the league. Affects the run and RBI
   * legs only — a great lineup does not make YOU get a hit, it makes you
   * more likely to be driven in and to have someone on base to drive in.
   */
  function offenseFactor(teamRunsPerGame, leagueRunsPerGame, opts) {
    opts = opts || {};
    const lg = leagueRunsPerGame > 0 ? leagueRunsPerGame : 4.5;
    if (!(teamRunsPerGame > 0)) return 1;
    const cap = opts.cap == null ? 0.15 : opts.cap;
    return Math.max(1 - cap, Math.min(1 + cap, teamRunsPerGame / lg));
  }

  /**
   * Full 1+ hits/runs/RBI estimate with context applied.
   *
   * @param player {hits, runs, rbi, pa, slot, name}
   * @param ctx    {oppAvgAllowed, leagueAvgAllowed, teamRunsPerGame,
   *                leagueRunsPerGame, correlation}
   */
  function scoreHRR(player, ctx) {
    ctx = ctx || {};
    const pa = expectedPA(player.slot);
    if (!(pa > 0) || !(Number(player.pa) > 0)) return null;

    const pf = pitcherFactor(ctx.oppAvgAllowed, ctx.leagueAvgAllowed);
    const of = offenseFactor(ctx.teamRunsPerGame, ctx.leagueRunsPerGame);
    const k = ctx.correlation == null ? DEFAULT_K : ctx.correlation;

    // Regress first, THEN apply context. Doing it the other way round lets a
    // 9-PA hitter's noise get multiplied by a favourable matchup.
    const base = regressedPerPA(player, ctx.leagueRates, ctx);

    const plat = platoonFactor(
      player.batSide,
      ctx.pitchHand,
      ctx.leaguePlatoon,
      player.vsHand,
      base.hit
    );
    const ha = homeAwayFactor(ctx.isHome, ctx.leagueHomeAway, player.homeAway, base.hit);

    /* The platoon factor moves hits and RBI but NOT runs. That is a data
       fact, not a modelling choice: MLB does not report runs scored inside
       the vs-LHP / vs-RHP splits (154/154 and 346/346 rows came back null),
       because you score after reaching base, often against a different
       pitcher entirely. Home/away does report runs, so it moves all three. */
    const clamp = (x) => Math.max(0, Math.min(0.999, x));
    const rates = {
      hit: clamp(base.hit * pf * plat * ha),
      run: clamp(base.run * pf * of * ha),
      rbi: clamp(base.rbi * pf * of * plat * ha),
    };

    const prob = probFromRates(rates, pa, k);
    const raw = perPA(player);
    return {
      name: player.name,
      slot: player.slot,
      expectedPA: pa,
      hitRate: rates.hit,
      runRate: rates.run,
      rbiRate: rates.rbi,
      rawHitRate: raw.hit,
      pa: player.pa,
      confidence: sampleConfidence(player.pa),
      pitcherFactor: pf,
      offenseFactor: of,
      platoonFactor: plat,
      homeAwayFactor: ha,
      batSide: player.batSide || null,
      pitchHand: ctx.pitchHand || null,
      isHome: !!ctx.isHome,
      prob: prob,
      score: isFinite(prob) ? Math.round(prob * 1000) / 10 : NaN,
    };
  }

  /* ------------------------------------------------------------------ *
   * 5. Home runs
   *
   * A different shape of problem. Home run rate is low enough per PA that
   * the Poisson approximation is fine, and the dominant context is the
   * pitcher's own home-run rate rather than the offense around the hitter.
   * ------------------------------------------------------------------ */

  function scoreHR(player, ctx) {
    ctx = ctx || {};
    const pa = expectedPA(player.slot);
    if (!(pa > 0) || !(Number(player.pa) > 0)) return null;

    // Same regression guard as the H+R+RBI model. One home run in 12 PA is
    // not a 40-homer pace, and without this it would top the board.
    const K = ctx.regressionPA == null ? REGRESSION_PA : ctx.regressionPA;
    const lgHrPerPA = ctx.leagueRates && ctx.leagueRates.hr > 0 ? ctx.leagueRates.hr : null;
    const hrPerPA = lgHrPerPA
      ? ((Number(player.hr) || 0) + lgHrPerPA * K) / ((Number(player.pa) || 0) + K)
      : safeRate(player.hr, player.pa);
    // Pitcher HR/9 relative to league, clamped. 1.2 HR/9 is a normal season.
    const lgHr9 = ctx.leagueHr9 > 0 ? ctx.leagueHr9 : 1.2;
    let pf = 1;
    if (ctx.pitcherHr9 > 0) pf = Math.max(0.75, Math.min(1.35, ctx.pitcherHr9 / lgHr9));
    const park = ctx.parkFactor > 0 ? ctx.parkFactor : 1;

    /* Use the HOME RUN platoon table, not the hits one. Measured 2026:
       a left-handed batter facing left-handed pitching hits 29% fewer home
       runs per PA, where his hit rate only drops about 4%. Applying the
       hits ratios here would understate the effect that matters most by
       more than five times. Falls back to the hits table if HR ratios are
       missing, and to neutral if both are. */
    const platTable = ctx.leaguePlatoonHR || ctx.leaguePlatoon;
    const haTable = ctx.leagueHomeAwayHR || ctx.leagueHomeAway;
    const plat = platoonFactor(player.batSide, ctx.pitchHand, platTable, player.vsHandHR, hrPerPA);
    const ha = homeAwayFactor(ctx.isHome, haTable, player.homeAwayHR, hrPerPA);
    const lambda = hrPerPA * pa * pf * park * plat * ha;
    const prob = 1 - Math.exp(-lambda);
    return {
      name: player.name,
      slot: player.slot,
      expectedPA: pa,
      hrRate: hrPerPA,
      pitcherFactor: pf,
      parkFactor: park,
      platoonFactor: plat,
      homeAwayFactor: ha,
      batSide: player.batSide || null,
      pitchHand: ctx.pitchHand || null,
      isHome: !!ctx.isHome,
      prob: prob,
      score: Math.round(prob * 1000) / 10,
    };
  }

  /* ------------------------------------------------------------------ *
   * 6. Presentation
   * ------------------------------------------------------------------ */

  /** Probability to the American price that would be exactly fair. */
  function fairPrice(prob) {
    if (!(prob > 0 && prob < 1)) return NaN;
    const dec = 1 / prob;
    return dec >= 2 ? Math.round((dec - 1) * 100) : -Math.round(100 / (dec - 1));
  }

  /**
   * Confidence in the ESTIMATE, which is not the same as the probability.
   * A .400 hitter in 30 plate appearances is not a good bet, he is a small
   * sample. Anything under ~150 PA gets flagged rather than ranked.
   */
  function sampleConfidence(pa) {
    if (!(pa > 0)) return 0;
    if (pa >= 400) return 1;
    if (pa >= 250) return 0.85;
    if (pa >= 150) return 0.65;
    if (pa >= 80) return 0.4;
    return 0.2;
  }

  function rank(list) {
    return list
      .filter(function (x) { return x && isFinite(x.prob); })
      .sort(function (a, b) { return b.prob - a.prob; });
  }

  return {
    PA_LEADOFF: PA_LEADOFF,
    PA_DECAY: PA_DECAY,
    DEFAULT_K: DEFAULT_K,
    REGRESSION_PA: REGRESSION_PA,
    expectedPA: expectedPA,
    perPA: perPA,
    regressedPerPA: regressedPerPA,
    safeRate: safeRate,
    probFromRates: probFromRates,
    probAtLeastOne: probAtLeastOne,
    pitcherFactor: pitcherFactor,
    offenseFactor: offenseFactor,
    platoonFactor: platoonFactor,
    homeAwayFactor: homeAwayFactor,
    PLATOON_K: PLATOON_K,
    HOMEAWAY_K: HOMEAWAY_K,
    MIN_SPLIT_PA: MIN_SPLIT_PA,
    scoreHRR: scoreHRR,
    scoreHR: scoreHR,
    fairPrice: fairPrice,
    sampleConfidence: sampleConfidence,
    rank: rank,
  };
});
