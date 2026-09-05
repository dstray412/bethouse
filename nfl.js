/*
 * BetHouse — nfl.js
 * Three NFL models. Pure functions, no I/O.
 *
 * UMD like score.js, edge.js and golf.js: loads as a plain <script> in the
 * browser and imports in Node, so the board, the tests and the backtest all
 * run identical code.
 *
 *   1. ANYTIME TOUCHDOWN   per player, binary. The closest thing here to the
 *                          home run model: a rare event driven by opportunity.
 *   2. YARDS AND CATCHES   per player, over/under a threshold. Needs a
 *                          distribution, not a probability.
 *   3. SPREAD AND TOTAL    per game, and graded against the closing line
 *                          rather than against nothing.
 *
 * THE HONEST PART, STATED UP FRONT
 * --------------------------------
 * The closing NFL line is very good. Over 543 games with a line, the home
 * side covered 49.7% of the time and the line's error was unbiased (mean
 * 0.37 points). Anyone building model #3 should expect to lose to that
 * number, and `backtest-nfl.mjs` is set up to say so plainly if it does.
 * The player models are on friendlier ground, because touchdown and yardage
 * props are priced with more juice and less attention.
 *
 * Sample sizes behind the constants: 544 games and 10,694 player-games
 * across the 2024 and 2025 regular seasons.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BetHouseNFL = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* ------------------------------------------------------------------ *
   * 1. Constants, all measured
   * ------------------------------------------------------------------ */

  const DEFAULTS = {
    /*
     * Expected touchdowns from opportunity alone, by least squares over
     * 10,521 player-games:
     *
     *     TDs = 0.0335 * carries + 0.0473 * targets
     *
     * A target is worth about 1.4 carries for scoring, which reads
     * backwards until you remember that targets include the throws teams
     * make from the seven yard line, while carries include every first-down
     * plunge between the tackles.
     *
     * This matters because touchdowns are rare and touches are not. A back
     * with 18 carries and no scores in two games is not a bad bet; he is a
     * small sample sitting on a lot of opportunity. Shrinking his observed
     * rate toward what his USAGE implies is the whole trick.
     */
    tdPerCarry: 0.0335,
    tdPerTarget: 0.0473,
    /* Games of evidence before a player's own scoring rate outweighs what
       his usage predicts. Fitted by backtest-nfl.mjs --fit. */
    tdK: 6,
    /*
     * REGRESSION DILUTION. A player's true scoring rate is predicted from
     * his season-average workload, and that prediction carries error, so
     * the spread of PREDICTED rates is wider than the spread of true ones.
     * Left alone it makes the board too confident at both ends -- the
     * backtest showed the top bucket running 7.5 points hot while the
     * bottom ran 4.6 points cold, which is the signature of a range that is
     * too wide rather than of a bias.
     *
     * So pull every rate toward the league average by this factor. 1.0 is
     * no correction. FITTED at 0.75 by backtest-nfl.mjs --fit, an interior
     * optimum: 0.6 and 1.0 are both worse on Brier, and it takes the top
     * bucket from 6.4 points hot to 1.6.
     */
    tdShrink: 0.75,
    leagueLambda: 0.251, // measured TDs per player-game, 2024-25

    /* Team scoring: home field is worth about two points now, not three. */
    homeField: 1.97,
    leaguePoints: 22.96, // per team per game
    marginSD: 14.29,
    totalSD: 13.44,
    /* Ridge for the team ratings solve. */
    teamK: 6,

    /* Yardage: shrink a player's per-game average toward a replacement-level
       per-game figure by this many games. */
    yardK: 5,
    yardPrior: 25, // yards a game for a receiver nobody has heard of
    /*
     * The yards gate, in one place. A row goes on the board when the player
     * has this many games and this much receiving opportunity, and projects
     * at least `yardFloor` yards. The tracker records exactly the rows the
     * board shows, so the gate has to be one named thing rather than the
     * same three comparisons typed out in two files.
     */
    yardMinGames: 3,
    yardMinOpportunity: 10,
    yardFloor: 20,
    /*
     * Which box-score stat counts as receiving opportunity. The NFL records
     * targets. College box scores record receptions and nothing about the
     * throws that were not caught, so cfb.js binds this to "recs" and
     * re-measures the per-opportunity touchdown rate to match.
     */
    receivingStat: "targets",
  };

  const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
  const num = (v) => (typeof v === "number" && isFinite(v) ? v : 0);

  /* ------------------------------------------------------------------ *
   * 2. Team ratings — the same two-way solve the golf model uses
   *
   * A team's points in a game are its offence plus the opponent's defence
   * plus home field. Solving offence and defence together stops a team that
   * played four terrible defences from reading as a good offence:
   *
   *     points(team, game) = league + offence(team) + defence(opponent)
   *                          + homeField if at home
   *
   * Alternating least squares with a ridge, exactly as in golf.js. The
   * ridge is what stops a 3-0 team from being rated on three games.
   * ------------------------------------------------------------------ */

  function buildTeamRatings(games, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    const iterations = o.iterations || 50;
    const obs = [];
    for (const g of games || []) {
      if (!g || !g.home || !g.away) continue;
      const hs = num(g.home.score), as = num(g.away.score);
      if (!(hs >= 0 && as >= 0)) continue;
      // A neutral site gives home field to nobody. See fetch-football.mjs.
      obs.push({ off: g.home.team, def: g.away.team, pts: hs, home: g.neutral ? 0 : 1 });
      obs.push({ off: g.away.team, def: g.home.team, pts: as, home: 0 });
    }
    if (!obs.length) return { off: {}, def: {}, league: o.leaguePoints, homeField: o.homeField, games: {} };

    const league = obs.reduce((s, x) => s + x.pts, 0) / obs.length;
    const off = new Map(), def = new Map(), played = new Map();
    for (const x of obs) {
      off.set(x.off, 0); def.set(x.def, 0);
      played.set(x.off, (played.get(x.off) || 0) + 1);
    }
    const hfa = o.homeField;
    const K = o.teamK;

    for (let it = 0; it < iterations; it++) {
      // offence: what the team scored above what the defence usually allows
      const oSum = new Map(), oN = new Map();
      for (const x of obs) {
        const r = x.pts - league - def.get(x.def) - (x.home ? hfa : 0);
        oSum.set(x.off, (oSum.get(x.off) || 0) + r);
        oN.set(x.off, (oN.get(x.off) || 0) + 1);
      }
      for (const t of off.keys()) off.set(t, (oSum.get(t) || 0) / ((oN.get(t) || 0) + K));
      // defence: what it allowed above league
      const dSum = new Map(), dN = new Map();
      for (const x of obs) {
        const r = x.pts - league - off.get(x.off) - (x.home ? hfa : 0);
        dSum.set(x.def, (dSum.get(x.def) || 0) + r);
        dN.set(x.def, (dN.get(x.def) || 0) + 1);
      }
      for (const t of def.keys()) def.set(t, (dSum.get(t) || 0) / ((dN.get(t) || 0) + K));
    }

    const O = {}, D = {}, N = {};
    for (const [t, v] of off) O[t] = v;
    for (const [t, v] of def) D[t] = v;
    for (const [t, v] of played) N[t] = v;
    return { off: O, def: D, league, homeField: hfa, games: N };
  }

  /**
   * Expected points for each side, and the margin and total they imply.
   * `opts.neutral` withholds home field, the same way the ratings solve
   * withheld it from a neutral game.
   */
  function projectGame(ratings, homeTeam, awayTeam, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    if (!ratings) return null;
    const oh = num(ratings.off[homeTeam]), dh = num(ratings.def[homeTeam]);
    const oa = num(ratings.off[awayTeam]), da = num(ratings.def[awayTeam]);
    const lg = isFinite(ratings.league) ? ratings.league : o.leaguePoints;
    const hf = o.neutral ? 0 : isFinite(ratings.homeField) ? ratings.homeField : o.homeField;
    const homePts = lg + oh + da + hf;
    const awayPts = lg + oa + dh;
    return {
      homePts, awayPts,
      margin: homePts - awayPts, // positive = home favoured
      total: homePts + awayPts,
    };
  }

  /* ------------------------------------------------------------------ *
   * 3. Against the line
   *
   * The market's spread is home-relative and negative when the home team is
   * favoured, so the home side covers when
   *
   *     (homeScore - awayScore) + spread > 0
   *
   * The model's edge is therefore its projected margin plus the spread, and
   * the probability of covering is that edge measured in units of how wrong
   * the line usually is (sd 12.41 points, measured).
   * ------------------------------------------------------------------ */

  /** Standard normal CDF, Abramowitz-Stegun 7.1.26. Good to ~1e-7. */
  function normalCDF(z) {
    const s = z < 0 ? -1 : 1;
    const x = Math.abs(z) / Math.SQRT2;
    const t = 1 / (1 + 0.3275911 * x);
    const y =
      1 -
      ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
        0.254829592) *
        t *
        Math.exp(-x * x);
    return 0.5 * (1 + s * y);
  }

  function spreadProbability(projectedMargin, spread, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    if (!isFinite(projectedMargin) || !isFinite(spread)) return null;
    const edge = projectedMargin + spread;
    return {
      edge,
      homeCoverProb: normalCDF(edge / o.marginSD),
    };
  }

  function totalProbability(projectedTotal, marketTotal, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    if (!isFinite(projectedTotal) || !isFinite(marketTotal)) return null;
    const edge = projectedTotal - marketTotal;
    return {
      edge,
      overProb: normalCDF(edge / o.totalSD),
    };
  }

  /* ------------------------------------------------------------------ *
   * 4. Anytime touchdown
   *
   * Poisson on expected touchdowns. The rate blends what a player has
   * actually scored with what his workload says he should:
   *
   *     lambda = (observedTDs + K * usageRate) / (games + K)
   *
   * With K = 0 that is his raw scoring rate, which for most players is
   * built on one or two touchdowns and is mostly noise. With K large it is
   * pure opportunity. The fitted value sits closer to opportunity than
   * instinct suggests, because touchdowns are the noisiest thing a skill
   * player does.
   *
   * P(at least one) = 1 - e^-lambda, then scaled by how good the offence is
   * and how leaky the opponent has been.
   *
   * WHY THE AVERAGE WORKLOAD IS NOT ENOUGH
   * --------------------------------------
   * A player's season average is not what he will see on Sunday. Measured
   * over 9,982 player-games, one game's workload divided by that player's
   * own season average has a standard deviation of 0.55 -- more than half
   * his own average, either way. Injuries, blowouts, game script, a week
   * where the other back gets the goal-line work.
   *
   * That matters because 1 - e^-lambda is CONCAVE, so feeding it the
   * average workload is not the same as averaging what it returns:
   *
   *     lambda   1 - e^-lambda    E[1 - e^-lambda]    error
   *     0.25         22.1%             21.4%          +0.7pp
   *     0.75         52.8%             49.2%          +3.6pp
   *     1.25         71.3%             65.4%          +5.9pp
   *
   * Nothing at the bottom of the board, several points at the top -- which
   * is exactly the shape the backtest showed before this was fixed (+11.6pp
   * in the top bucket, roughly flat at the bottom).
   *
   * So when the caller supplies `usagePool` -- real one-game-over-average
   * workload ratios -- the probability is averaged over it rather than
   * evaluated at the mean. Same instinct as sampling real golf scores
   * instead of assuming a bell curve, and the same class of bug as raising
   * a rate to a fractional power in score.js: applying a curved function to
   * an average instead of averaging the function.
   * ------------------------------------------------------------------ */

  /** Expected TDs from workload alone. */
  function usageTDs(carries, targets, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    return o.tdPerCarry * num(carries) + o.tdPerTarget * num(targets);
  }

  /**
   * A player's receiving opportunity, in whichever stat the league records
   * (see DEFAULTS.receivingStat). Every reader goes through here so the
   * board, the tracker and the backtest cannot count it three ways.
   */
  function receivingOpportunity(record, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    return num(record && record[o.receivingStat]);
  }

  /**
   * @param player {games, tds, carries, targets|recs} season to date
   * @param ctx    {teamFactor, oppFactor} multipliers, 1.0 = league average
   */
  function scoreAnytimeTD(player, ctx) {
    const o = Object.assign({}, DEFAULTS, (ctx && ctx.opts) || {});
    if (!player) return null;
    const games = num(player.games);
    if (games <= 0) return null;

    const perGameCarries = num(player.carries) / games;
    const perGameReceiving = receivingOpportunity(player, o) / games;
    const usageRate = usageTDs(perGameCarries, perGameReceiving, o);
    const observed = num(player.tds);

    // Shrink the observed rate toward what the workload implies.
    const base = (observed + o.tdK * usageRate) / (games + o.tdK);

    const teamFactor = clamp(num((ctx && ctx.teamFactor) || 1) || 1, 0.6, 1.6);
    const oppFactor = clamp(num((ctx && ctx.oppFactor) || 1) || 1, 0.6, 1.6);
    const raw = Math.max(0, base * teamFactor * oppFactor);
    // Toward the league average, by the fitted amount. See tdShrink.
    const bar = num(o.leagueLambda);
    const lambda = Math.max(0, bar + o.tdShrink * (raw - bar));

    // Average over real workload variation when the caller supplies it. The
    // bare 1 - e^-lambda is the honest fallback and is measurably worse at
    // the top of the board; see the note above.
    const pool = ctx && ctx.usagePool && ctx.usagePool.length ? ctx.usagePool : null;
    let prob;
    if (pool) {
      let sum = 0;
      for (let i = 0; i < pool.length; i++) sum += 1 - Math.exp(-lambda * pool[i]);
      prob = sum / pool.length;
    } else {
      prob = 1 - Math.exp(-lambda);
    }

    return {
      prob: clamp(prob, 0, 0.95),
      lambda,
      rawLambda: raw,
      usageRate,
      observedRate: observed / games,
      shrink: games / (games + o.tdK),
      usageAveraged: !!pool,
      perGameCarries,
      perGameReceiving,
      teamFactor,
      oppFactor,
      games,
    };
  }

  /**
   * Workload ratios for `scoreAnytimeTD`: one game's expected touchdowns
   * divided by that player's own average, across players with enough games
   * to have an average worth dividing by.
   */
  function usagePoolFrom(perPlayerGames, minGames) {
    const need = isFinite(minGames) ? minGames : 6;
    const out = [];
    for (const games of perPlayerGames || []) {
      if (!games || games.length < need) continue;
      let sum = 0;
      for (const u of games) sum += num(u);
      const avg = sum / games.length;
      if (!(avg > 0)) continue;
      for (const u of games) out.push(num(u) / avg);
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 5. Yards and catches
   *
   * A yes/no probability will not do here: the question is "how many", so
   * it needs a distribution. Receiving yards are violently right-skewed
   * (mean 29, sd 31, floor of zero, no ceiling) and nothing normal-shaped
   * describes them.
   *
   * So do what the golf model does and use the real thing. `empiricalOver`
   * takes a pool of actual outcomes from players at a similar expected
   * level and reads the answer straight off it. No distribution is assumed,
   * no parameter is fitted, and the zero-inflation that wrecks a parametric
   * fit — the games where a receiver is targeted twice and catches none —
   * is in the pool where it belongs.
   * ------------------------------------------------------------------ */

  /** Shrunk per-game expectation for a counting stat. The prior defaults
      to the league's replacement-level figure. */
  function expectedVolume(total, games, priorPerGame, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    const prior = priorPerGame == null ? o.yardPrior : num(priorPerGame);
    const g = num(games);
    if (g <= 0) return prior;
    return (num(total) + o.yardK * prior) / (g + o.yardK);
  }

  /**
   * Whether a receiving-yards row belongs on the board, and at what
   * projection. `null` when it does not. The ONE gate: the page shows a
   * row iff this says so, and the tracker records a row iff this says so,
   * so the record can never grade a bet the board never offered.
   */
  function yardsEligible(record, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    if (!record) return null;
    if (!(num(record.games) >= o.yardMinGames)) return null;
    if (!(receivingOpportunity(record, o) >= o.yardMinOpportunity)) return null;
    const exp = expectedVolume(record.recYds, record.games, null, o);
    if (!(exp >= o.yardFloor)) return null;
    return { exp };
  }

  /**
   * P(actual > threshold) read off a pool of comparable real outcomes.
   *
   * `pool` is actual outcomes from player-games whose expectation was close
   * to this one. Ratios are used rather than raw values so a 90-yard
   * receiver and a 30-yard receiver can share a pool: each pool entry is
   * actual/expected, and it is rescaled to this player's expectation.
   */
  function empiricalOver(expected, threshold, pool) {
    const e = num(expected);
    if (!(e > 0) || !pool || !pool.length) return null;
    let over = 0;
    for (let i = 0; i < pool.length; i++) {
      if (e * pool[i] > threshold) over++;
    }
    return over / pool.length;
  }

  /**
   * Build the ratio pool: actual/expected for every player-game supplied.
   * Entries whose expectation is tiny are dropped, because dividing by a
   * number near zero produces ratios that are all noise and no shape.
   */
  function ratioPool(samples, minExpected) {
    const floor = isFinite(minExpected) ? minExpected : 5;
    const out = [];
    for (const s of samples || []) {
      const e = num(s.expected), a = num(s.actual);
      if (!(e >= floor)) continue;
      out.push(a / e);
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 6. Presentation
   * ------------------------------------------------------------------ */

  function fairPrice(p) {
    p = Number(p);
    if (!(p > 0 && p < 1)) return null;
    const d = 1 / p;
    return d >= 2 ? Math.round((d - 1) * 100) : -Math.round(100 / (d - 1));
  }

  /* ------------------------------------------------------------------ *
   * 7. Another league, same model
   *
   * College football is this model with different constants: a bigger
   * home field, more points, wider margins, receptions instead of targets.
   * Rather than a second copy of four hundred lines that would drift from
   * this one, cfb.js asks for the same API with its own constants merged
   * in. An explicit `opts` at a call site still wins, so a neutral-site
   * projection or a backtest sweep works the same either way.
   * ------------------------------------------------------------------ */

  function bind(overrides) {
    const base = Object.assign({}, DEFAULTS, overrides || {});
    const merge = (opts) => Object.assign({}, base, opts || {});
    return {
      DEFAULTS: base,
      buildTeamRatings: (games, opts) => buildTeamRatings(games, merge(opts)),
      projectGame: (r, h, a, opts) => projectGame(r, h, a, merge(opts)),
      normalCDF,
      spreadProbability: (m, s, opts) => spreadProbability(m, s, merge(opts)),
      totalProbability: (t, m, opts) => totalProbability(t, m, merge(opts)),
      usageTDs: (c, t, opts) => usageTDs(c, t, merge(opts)),
      receivingOpportunity: (rec, opts) => receivingOpportunity(rec, merge(opts)),
      usagePoolFrom,
      scoreAnytimeTD: (p, ctx) =>
        scoreAnytimeTD(p, Object.assign({}, ctx || {}, { opts: merge(ctx && ctx.opts) })),
      expectedVolume: (total, games, prior, opts) => expectedVolume(total, games, prior, merge(opts)),
      yardsEligible: (rec, opts) => yardsEligible(rec, merge(opts)),
      empiricalOver,
      ratioPool,
      fairPrice,
      bind: (more) => bind(Object.assign({}, overrides || {}, more || {})),
    };
  }

  return {
    DEFAULTS,
    buildTeamRatings,
    projectGame,
    normalCDF,
    spreadProbability,
    totalProbability,
    usageTDs,
    receivingOpportunity,
    usagePoolFrom,
    scoreAnytimeTD,
    expectedVolume,
    yardsEligible,
    empiricalOver,
    ratioPool,
    fairPrice,
    bind,
  };
});
