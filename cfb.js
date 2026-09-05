/*
 * BetHouse — cfb.js
 * College football is the NFL model with its own constants.
 *
 * UMD like nfl.js: loads as a plain <script> after nfl.js in the browser,
 * imports in Node. Everything here is `BetHouseNFL.bind(...)`: the same
 * three models -- anytime touchdown, receiving yards, spread and total --
 * with every constant re-measured on FBS games. There is no second copy
 * of the arithmetic to drift from the first.
 *
 * WHAT IS DIFFERENT ABOUT COLLEGE, AND WHAT IS NOT
 * ------------------------------------------------
 * Not different: a touchdown is still a rare event driven by opportunity,
 * receiving yards are still right-skewed with a floor at zero, and a
 * spread is still graded by (home - away) + spread > 0.
 *
 * Different, and each one measured rather than assumed:
 *
 *   RECEPTIONS, NOT TARGETS. College box scores do not record targets.
 *   The receiving-opportunity term is receptions, and the touchdowns-per-
 *   opportunity coefficient is re-measured to match: a catch is worth more
 *   than a target because it is a target that succeeded.
 *
 *   ONE LEAGUE OF 134 TEAMS, PLUS `FCS`. Every opponent that is not an FBS
 *   member is recorded under one code and rated as one team, so a win by
 *   fifty over a school that appears once a year is a win by fifty over
 *   the FCS, not over an average side. fetch-football.mjs does the mapping.
 *
 *   NEUTRAL SITES. Kickoff classics and conference championships give home
 *   field to nobody, and the model is told so.
 *
 * The constants below are PLACEHOLDERS copied from the NFL until
 * `node backtest-nfl.mjs --league cfb --measure` has been run on two
 * seasons of history. Ship nothing off this file while this note is here.
 */
(function (root, factory) {
  const base =
    typeof module !== "undefined" && module.exports ? require("./nfl.js") : root.BetHouseNFL;
  const api = factory(base);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BetHouseCFB = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (nfl) {
  "use strict";

  const CFB = {
    /*
     * Expected touchdowns from opportunity alone, by least squares over
     * 33,482 player-games by REGULARS -- players with three or more games
     * that season, which is exactly the population the board scores:
     *
     *     TDs = 0.0453 * carries + 0.0842 * receptions
     *
     * (backtest-nfl.mjs --league cfb --measure). Over every player-game
     * the coefficients are 0.0442 and 0.0821 and the league rate is 0.289,
     * and using those ran the board 1.8 points cold at every setting of
     * the shrink: a 120-man roster carries a tail of one-game players who
     * score less per touch than a starter, and the league rate the shrink
     * pulls toward was 9% too low for the players it was applied to. The
     * NFL's two populations agree to the third decimal, which is why nfl.js
     * never needed the distinction. Against the NFL's 0.0335 and 0.0473 per
     * target: a reception is a target that succeeded, which is most of the
     * gap; the rest is that college offences score more.
     */
    tdPerCarry: 0.0453,
    tdPerTarget: 0.0842, // per RECEPTION; receivingStat says so
    /*
     * Fitted by backtest-nfl.mjs --league cfb --fit, two passes of
     * coordinate descent, and validated on the two seasons separately:
     * 2024 alone and 2025 alone both chose K = 14 on the second pass, and
     * the shrink landed at 0.90 (full window, 2024) and 0.85 (2025), a
     * Brier difference of 0.00004, which is noise. 0.90 is the majority
     * and the timid end -- less correction, not more -- and gives the
     * flatter calibration table (top bucket -2.5pp, bottom +1.3pp against
     * -3.5pp and +3.2pp at 0.85). More games of evidence than the NFL's 6
     * before a player's own rate outweighs his usage, because college
     * touchdowns are spread across more hands.
     */
    tdK: 14,
    tdShrink: 0.9,
    leagueLambda: 0.315, // measured TDs per regular's player-game, 2024-25

    /*
     * Home field is 3.5 points, solved with team strength held fixed. The
     * raw home margin is 9.0, and the seven-point difference is the buy
     * game: the home team in college is usually the better team, because
     * the better team is the one with the stadium and the cheque. Reading
     * home field off the raw margin would hand every host five points it
     * has not earned.
     */
    homeField: 3.54,
    leaguePoints: 26.71, // per team per game
    /* The model's own projection error over 1,510 walk-forward games. The
       closing line's is 15.18 and 15.73: the market is better, as expected. */
    marginSD: 16.54,
    totalSD: 16.19,
    teamK: 6,

    /* A receiver nobody has heard of: a little under the 30.1-yard mean of
       every player-game with a catch, in the NFL's proportion. */
    yardK: 5,
    yardPrior: 26,
    yardMinGames: 3,
    yardMinOpportunity: 7, // receptions: the NFL catches 67.9% of targets, so its 10 targets is 6.8 of these
    yardFloor: 20,

    receivingStat: "recs",
  };

  return nfl.bind(CFB);
});
