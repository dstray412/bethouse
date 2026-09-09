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
    /*
     * HOW MUCH OF THE MODEL'S OPINION ABOUT A LINE TO BELIEVE.
     *
     * Against 480 closing spreads, regressing the outcome on the model's
     * cover probability gives a slope of -0.25: when the model said 67%
     * the home side covered 47%. The projection carries nothing about
     * the spread that the line does not already carry, so the cover
     * probability the page prints is pulled ALL the way to 50%. The lean
     * (the edge in points) is untouched and is still recorded and graded;
     * this is only about not printing a percentage the replay says is
     * false. Totals looked better on two seasons (slope 0.33; 0.35 and
     * 0.31 on each alone) and that was a window: over twenty-seven seasons
     * of nflverse closing totals (experiment-nflverse.mjs, 6,895 games)
     * the slope is 0.036, and by era 0.12, 0.17, 0.06, -0.17, 0.03. The
     * long run ships. Measured by backtest-nfl.mjs ("calibration slope")
     * on the ESPN cache and by experiment-nflverse.mjs on nflverse.
     */
    spreadShrink: 0,
    totalShrink: 0.04,
    /* Ridge for the team ratings solve. */
    teamK: 6,

    /* Yardage: shrink a player's per-game average toward a replacement-level
       per-game figure by this many games. */
    yardK: 5,
    yardPrior: 25, // yards a game for a receiver nobody has heard of
    /* The same for the other counting props, each a little under the
       league's per-game mean among players with an opportunity (28.6,
       189.3 and 2.7 in the NFL; backtest-nfl.mjs --measure, 2026-09-08). */
    rushPrior: 25,
    passPrior: 165,
    recsPrior: 2.3,
    /*
     * The pool floor per stat: a player-game joins a stat's ratio pool
     * (actual / his expectation at the time) only when his expectation
     * was at least this. Receiving yards keeps 5, the board's original
     * definition (see fetch-football.mjs, "which population goes in the
     * pool"), and passing and receptions take the same quarter of their
     * floor. Rushing is the exception, and the one place the choice was
     * forced: below 20 expected yards the rushers with a carry are
     * quarterbacks' scrambles and receivers' end-arounds, a different
     * population from the backs the board prices, and a pool of them ran
     * the rushing model seven points cold in both leagues (replay,
     * 2026-09-08: floor 5 -6.8pp, 10 -6.1, 15 -2.7, 20 +1.2, 30 +6.6 in
     * the NFL; college 5 -8.6pp, 20 +0.9). So the rushing pool is the
     * population the board would offer a line on: expectation at least
     * the floor. The same rule tried on passing and receptions made both
     * worse (+3.5pp and +3.6pp), so it is not a rule, it is a fact about
     * rushing.
     */
    yardPoolFloor: 5,
    rushPoolFloor: 20,
    passPoolFloor: 37.5,
    recsPoolFloor: 0.5,
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
    /* The other counting props' gates in the same terms (STATS names
       which key each row reads). yardMinGames is shared by all four;
       receptions gate on the same receiving opportunity as yards. */
    rushMinOpportunity: 10,
    rushFloor: 20,
    passMinOpportunity: 40,
    passFloor: 150,
    recsFloor: 2,
    /*
     * The opponent's defence, per stat: how much of the league's per-game
     * figure the opponent allows, regressed toward 1 over six games like
     * the touchdown factors (fetch-football.mjs seasonLines, `allow`),
     * applied to the projection at this strength: 1 + shrink × (allow − 1).
     * 0 is a projection with no opponent in it.
     *
     * Replay, 2026-09-08, strength 0 / 0.5 / 1, Brier:
     *   rushing    NFL 0.2229 / 0.2220 / 0.2229   college 0.2326 / 0.2321 / 0.2325
     *   passing    NFL 0.1619 / 0.1611 / 0.1621   college 0.1787 / 0.1779 / 0.1779
     * (the 0.5 column re-run after pool membership went back to the
     * player's own level; the scan's 0.2322 / 0.1774 had it adjusted)
     *   receiving  NFL 0.2224 / 0.2223 / 0.2224   college 0.2300 / 0.2300 / 0.2303
     *   receptions NFL 0.2047 / 0.2045 / 0.2047   college 0.2131 / 0.2135 / 0.2139
     * Rushing and passing improve at half strength in both leagues and
     * give it back at full; receiving yards and receptions move nothing
     * or get worse, so the opponent stays out of them. The effect is
     * small everywhere, which is what the game-line work found too: the
     * box score adds little the market and the pool do not already carry.
     */
    yardOppShrink: 0,
    rushOppShrink: 0.5,
    passOppShrink: 0.5,
    recsOppShrink: 0,
    /*
     * Parlays: which props may be parlayed (only the one whose slips went
     * through the replay), and how a slip whose legs share a game or a
     * team cashes against the product of its legs.
     *
     * backtest-nfl.mjs --parlay, 2026-09-09. Touchdown legs with prob >=
     * 0.2, actual / predicted; "random" slips test the arithmetic, "top"
     * slips are what the board would offer:
     *
     *                  2 legs         3 legs         4 legs
     *   cross-game     1.12 / 0.98    1.26 / 1.00    1.43 / 0.79   random / top
     *   same game      1.13 / 0.94    0.93 / 1.17    0.93 / 1.09
     *   same team      1.00 / 0.92    0.80 / 0.80    0.75 / 0.82
     *
     * Cross-game slips cash at or above the product (the single legs in
     * the 20-35% band run a little cold, and it compounds; the top slips
     * are made of 50-60% legs and sit at 1.0). A same-game slip with a
     * leg on each side behaves like a cross-game one. A same-TEAM slip
     * cashes LESS than the product -- 0.80 for three legs, 0.90 in 2024
     * and 0.73 in 2025 for the top slips -- because a team's touchdowns
     * are shared: one scoring makes the next less likely. The baseball
     * intuition (a slugfest lifts everyone) does not carry over.
     *
     * Every leg the boards offer, 2026-09-09 (--parlay; counting props at
     * the projection line with 300+ games in their pool, the model's side
     * on spread and total), random slips, actual / predicted, NFL:
     *
     *                        2 legs   3 legs   4 legs   5 legs
     *   none    other games   1.06     1.13     1.15     1.31
     *   game    no shared team 1.01    1.08
     *   mixed   some share     --      1.04     1.01     1.03   (seasons 1.24/0.88, 1.12/0.91)
     *   team    all one team   1.01    0.89     1.27     --     (touchdowns only: 0.66-0.86)
     *   player  same player    1.58     1.51     1.76     2.27   (every season >= 1.30)
     *
     * The slate's top picks cashed 0.55-0.72x the product on 32 weeks:
     * the top of the board runs hot, as baseball found; the slip says to
     * shade it and no correction is fitted to 32 rows.
     *
     * Shipped: 1 for other games, one game and mixed; 0.85 for every leg
     * on one team (the touchdown case is the common one and measured
     * 0.66-0.86); 1.3 for the same player, the smallest ratio measured.
     * College (cfb.js): 1 everywhere but the same player, 1.3. The slip
     * prints the product, the adjusted number where they differ, and
     * the ratio it came from.
     */
    parlayProps: ["td", "recyds", "rushyds", "passyds", "recs", "spread", "total"],
    parlayLift: { game: 1, mixed: 1, team: 0.85, player: 1.3 },
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
    const raw = normalCDF(edge / o.marginSD);
    return {
      edge,
      homeCoverProb: 0.5 + num(o.spreadShrink) * (raw - 0.5),
      rawCoverProb: raw,
    };
  }

  function totalProbability(projectedTotal, marketTotal, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    if (!isFinite(projectedTotal) || !isFinite(marketTotal)) return null;
    const edge = projectedTotal - marketTotal;
    const raw = normalCDF(edge / o.totalSD);
    return {
      edge,
      overProb: 0.5 + num(o.totalShrink) * (raw - 0.5),
      rawOverProb: raw,
    };
  }

  /** P(home wins outright): the projected margin in units of the model's
      own margin error. The moneyline's question. */
  function winProbability(projectedMargin, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    if (!isFinite(projectedMargin)) return null;
    return normalCDF(projectedMargin / o.marginSD);
  }

  /*
   * Which side the model likes, on each market a line offers.
   *
   * ONE function, used by the page, the tracker and the backtest, so the
   * side the board shows is the side the record grades is the side the
   * replay counted. The side is whichever the projection gives more than
   * half a chance; `prob` is that side's probability; `edge` is points in
   * that side's favour; `price` is the American price of that side, with
   * spread and total juice defaulting to -110 when the feed has none.
   *
   * A projection sitting exactly on the number is not a pick. A market
   * the line does not carry is null rather than a guess.
   */
  function pickGame(projection, line, opts) {
    if (!projection || !line) return null;
    const m = projection.margin, t = projection.total;
    const out = { spread: null, total: null, ml: null };

    if (isFinite(line.spread) && isFinite(m)) {
      const sp = spreadProbability(m, line.spread, opts);
      if (sp.edge > 0) {
        out.spread = { side: "home", prob: sp.homeCoverProb, edge: sp.edge,
          line: line.spread, price: isFinite(line.homeSpreadOdds) ? line.homeSpreadOdds : -110 };
      } else if (sp.edge < 0) {
        out.spread = { side: "away", prob: 1 - sp.homeCoverProb, edge: -sp.edge,
          line: line.spread, price: isFinite(line.awaySpreadOdds) ? line.awaySpreadOdds : -110 };
      }
    }
    if (isFinite(line.total) && isFinite(t)) {
      const tp = totalProbability(t, line.total, opts);
      if (tp.edge > 0) {
        out.total = { side: "over", prob: tp.overProb, edge: tp.edge,
          line: line.total, price: isFinite(line.overOdds) ? line.overOdds : -110 };
      } else if (tp.edge < 0) {
        out.total = { side: "under", prob: 1 - tp.overProb, edge: -tp.edge,
          line: line.total, price: isFinite(line.underOdds) ? line.underOdds : -110 };
      }
    }
    if (isFinite(line.homeML) && isFinite(line.awayML) && isFinite(m) && m !== 0) {
      const pHome = winProbability(m, opts);
      out.ml = m > 0
        ? { side: "home", prob: pHome, price: line.homeML }
        : { side: "away", prob: 1 - pHome, price: line.awayML };
    }
    return out;
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

  /*
   * THE STAT TABLE. Four counting props share one shape: a season total,
   * an opportunity count that says whether the player is really in that
   * business, a replacement-level prior the per-game rate is shrunk
   * toward (yardK games), and a floor under which no line is worth
   * offering. Receiving yards is the original; the other three are the
   * same machinery with their own measured numbers (backtest-nfl.mjs
   * --measure prints the per-game means the priors sit under).
   *
   * `opportunity` is a record field, except "receiving", which is
   * whatever the league records (targets in the NFL, receptions in
   * college -- DEFAULTS.receivingStat). `box` is where the stat sits on
   * a box-score line (block, field). Every threshold is a DEFAULTS key,
   * so a league can bind its own.
   */
  const STATS = {
    recyds:  { label: "Receiving yards", total: "recYds",  opportunity: "receiving", box: ["rec", "yds"],  priorKey: "yardPrior", poolFloorKey: "yardPoolFloor", minOppKey: "yardMinOpportunity", floorKey: "yardFloor", oppShrinkKey: "yardOppShrink" },
    rushyds: { label: "Rushing yards",   total: "rushYds", opportunity: "carries",   box: ["rush", "yds"], priorKey: "rushPrior", poolFloorKey: "rushPoolFloor", minOppKey: "rushMinOpportunity", floorKey: "rushFloor", oppShrinkKey: "rushOppShrink" },
    passyds: { label: "Passing yards",   total: "passYds", opportunity: "passAtt",   box: ["pass", "yds"], priorKey: "passPrior", poolFloorKey: "passPoolFloor", minOppKey: "passMinOpportunity", floorKey: "passFloor", oppShrinkKey: "passOppShrink" },
    recs:    { label: "Receptions",      total: "recs",    opportunity: "receiving", box: ["rec", "rec"],  priorKey: "recsPrior", poolFloorKey: "recsPoolFloor", minOppKey: "yardMinOpportunity", floorKey: "recsFloor", oppShrinkKey: "recsOppShrink" },
  };

  /** A box-score line (the fetcher's rush / rec / pass blocks) in the
      shape of a season record, so statOpportunity reads either. */
  function gameLine(p) {
    const b = p || {};
    return {
      targets: num(b.rec && b.rec.tgt), recs: num(b.rec && b.rec.rec),
      carries: num(b.rush && b.rush.att), passAtt: num(b.pass && b.pass.att),
    };
  }

  /** A box-score line's actual value of a stat. */
  function gameValue(stat, p) {
    const st = STATS[stat];
    if (!st || !p) return 0;
    const block = p[st.box[0]];
    return num(block && block[st.box[1]]);
  }

  /** A stat's opportunity count on a season record or a game line. */
  function statOpportunity(stat, record, opts) {
    const st = STATS[stat];
    if (!st || !record) return 0;
    return st.opportunity === "receiving" ? receivingOpportunity(record, opts) : num(record[st.opportunity]);
  }

  /** The shrunk per-game expectation of a stat. */
  function expectedStat(stat, record, opts) {
    const st = STATS[stat];
    if (!st || !record) return null;
    const prior = Object.assign({}, DEFAULTS, opts || {})[st.priorKey];
    return expectedVolume(record[st.total], record.games, prior, opts);
  }

  /**
   * Who a player faced in a game, or null when his team code matches
   * neither side (a box-score abbreviation the schedule does not use).
   * Null means "no opponent", never "the home team": every caller that
   * attributes a stat to a defence uses this one lookup.
   */
  function opponentIn(game, player) {
    if (!game || !player) return null;
    const h = game.home && game.home.team, a = game.away && game.away.team;
    return player.team === h ? a : player.team === a ? h : null;
  }

  /** A defence's allowance for a stat out of a teamFactors table; null when unknown. */
  function allowOf(teamFactors, team, stat) {
    const f = team && teamFactors && teamFactors[team];
    const v = f && f.allow ? f.allow[stat] : null;
    return isFinite(v) && v > 0 ? v : null;
  }

  /**
   * The opponent's allowance for a stat (1 = league average, from
   * seasonLines' `allow`), applied at the stat's strength and clamped
   * like the touchdown factors (at the shipped half strength the clamp
   * cannot fire; it is there for a full-strength league). 1 when there
   * is no opponent or no strength.
   */
  function statOppFactor(stat, allow, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    const st = STATS[stat];
    const f = num(allow);
    if (!st || !(f > 0)) return 1;
    return clamp(1 + num(o[st.oppShrinkKey]) * (f - 1), 0.6, 1.6);
  }

  /**
   * Whether a row for this stat belongs on the board, and at what
   * projection. `null` when it does not. The ONE gate: the page shows a
   * row iff this says so, and the tracker records a row iff this says so,
   * so the record can never grade a bet the board never offered.
   *
   * The gate is the player's own season (`base`); the opponent moves the
   * projection (`exp`), never who is on the board. `ctx.oppFactor` is the
   * opponent's `allow` for this stat.
   */
  function statEligible(stat, record, opts, ctx) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    const st = STATS[stat];
    if (!st || !record) return null;
    if (!(num(record.games) >= o.yardMinGames)) return null;
    if (!(statOpportunity(stat, record, o) >= o[st.minOppKey])) return null;
    const base = expectedStat(stat, record, o);
    if (!(base >= o[st.floorKey])) return null;
    return projectedStat(stat, record, o, ctx, base);
  }

  /**
   * The projection itself, gate or no gate: the player's own expectation
   * times the opponent's factor. The pools divide by this, the board and
   * the tracker print it, and it is computed here and nowhere else.
   */
  function projectedStat(stat, record, opts, ctx, base) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    const b = base != null ? base : expectedStat(stat, record, o);
    if (b == null) return null;
    const oppFactor = statOppFactor(stat, ctx && ctx.oppFactor, o);
    return { exp: b * oppFactor, base: b, oppFactor };
  }

  /** Receiving yards, the original gate. Kept by name for its callers. */
  function yardsEligible(record, opts, ctx) {
    return statEligible("recyds", record, opts, ctx);
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
   * 6. Availability
   *
   * What a book does with an injury status. Out, injured reserve,
   * doubtful, suspended: the props are void, so the row is not shown and
   * not recorded. Questionable: shown and recorded, flagged -- 59% of
   * skill players listed Questionable at game time played (120 games,
   * 2025). Anything else, including an unknown word, is available: the
   * safe failure is a row that may void, not a starter that vanishes.
   * ------------------------------------------------------------------ */

  /**
   * A team's roster, from ESPN's roster endpoint: every athlete with the
   * team's code, his position and the roster group he sits in (offense,
   * defense, specialTeam, injuredReserveOrOut, suspended, practiceSquad).
   * Empty when the payload carries no team code, because a roster that
   * cannot say which team it is cannot move anyone.
   */
  function parseRoster(payload) {
    const team = payload && payload.team && payload.team.abbreviation;
    if (!team) return [];
    const out = [];
    for (const g of (payload.athletes || [])) {
      for (const a of (g && g.items) || []) {
        if (!a || a.id == null) continue;
        out.push({
          id: String(a.id), name: a.fullName || a.displayName || "", team,
          pos: (a.position && a.position.abbreviation) || "",
          group: g.position || "", status: (a.status && a.status.name) || "",
        });
      }
    }
    return out;
  }

  /**
   * Put every player where the rosters say he is. The season record is
   * what he did, and the box score that produced it names the team he
   * did it for -- last season's team until he plays a game for the new
   * one. The roster is who he plays for today. A player on no roster at
   * all (retired, released, unsigned) leaves the board: there is nothing
   * to bet. Returns new player objects; the inputs are not touched.
   * `roster` is a Map by athlete id, or null to change nothing.
   */
  function applyRosters(players, roster) {
    const list = players || [];
    if (!roster || typeof roster.get !== "function") return { players: list.slice(), moved: [], dropped: [] };
    const out = [], moved = [], dropped = [];
    for (const p of list) {
      const r = roster.get(String(p.id));
      if (!r) { dropped.push({ id: p.id, name: p.name, team: p.team }); continue; }
      if (r.team && r.team !== p.team) {
        out.push(Object.assign({}, p, { team: r.team, movedFrom: p.team }));
        moved.push({ id: p.id, name: p.name, from: p.team, to: r.team });
      } else out.push(p);
    }
    return { players: out, moved, dropped };
  }

  /**
   * Does a player match what someone typed into the search box? Every
   * word typed must begin some word of his name, team or opponent --
   * "ne" is the Patriots, not everyone called Achane -- and case, dots,
   * apostrophes and accents do not count. Word order does not matter.
   * An empty query matches everyone.
   */
  function searchWords(s) {
    return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
      .replace(/[.'\u2019]/g, "").split(/[\s-]+/).filter(Boolean);
  }
  function playerMatches(query, p) {
    if (!p) return false;
    const words = searchWords(query);
    if (!words.length) return true;
    const hay = [].concat(searchWords(p.name), searchWords(p.team), searchWords(p.opp));
    return words.every((w) => hay.some((h) => h.indexOf(w) === 0));
  }

  function availability(status) {
    const s = String(status || "").toLowerCase();
    if (!s) return "ok";
    if (/^(out|injured reserve|doubtful|suspen|physically unable|non-football|reserve)/.test(s)) return "out";
    if (/questionable/.test(s)) return "questionable";
    return "ok";
  }

  /* ------------------------------------------------------------------ *
   * 7. Presentation
   * ------------------------------------------------------------------ */

  function fairPrice(p) {
    p = Number(p);
    if (!(p > 0 && p < 1)) return null;
    const d = 1 / p;
    return d >= 2 ? Math.round((d - 1) * 100) : -Math.round(100 / (d - 1));
  }

  /* ------------------------------------------------------------------ *
   * 8. Another league, same model
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
      winProbability: (m, opts) => winProbability(m, merge(opts)),
      pickGame: (proj, line, opts) => pickGame(proj, line, merge(opts)),
      usageTDs: (c, t, opts) => usageTDs(c, t, merge(opts)),
      receivingOpportunity: (rec, opts) => receivingOpportunity(rec, merge(opts)),
      usagePoolFrom,
      scoreAnytimeTD: (p, ctx) =>
        scoreAnytimeTD(p, Object.assign({}, ctx || {}, { opts: merge(ctx && ctx.opts) })),
      expectedVolume: (total, games, prior, opts) => expectedVolume(total, games, prior, merge(opts)),
      yardsEligible: (rec, opts, ctx) => yardsEligible(rec, merge(opts), ctx),
      STATS,
      gameLine,
      gameValue,
      statOpportunity: (stat, rec, opts) => statOpportunity(stat, rec, merge(opts)),
      expectedStat: (stat, rec, opts) => expectedStat(stat, rec, merge(opts)),
      statEligible: (stat, rec, opts, ctx) => statEligible(stat, rec, merge(opts), ctx),
      projectedStat: (stat, rec, opts, ctx) => projectedStat(stat, rec, merge(opts), ctx),
      statOppFactor: (stat, allow, opts) => statOppFactor(stat, allow, merge(opts)),
      opponentIn,
      allowOf,
      empiricalOver,
      ratioPool,
      availability,
      playerMatches,
      parseRoster,
      applyRosters,
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
    winProbability,
    pickGame,
    usageTDs,
    receivingOpportunity,
    usagePoolFrom,
    scoreAnytimeTD,
    expectedVolume,
    yardsEligible,
    STATS,
    gameLine,
    gameValue,
    statOpportunity,
    expectedStat,
    statEligible,
    projectedStat,
    statOppFactor,
    opponentIn,
    allowOf,
    empiricalOver,
    ratioPool,
    availability,
    playerMatches,
    parseRoster,
    applyRosters,
    fairPrice,
    bind,
  };
});
