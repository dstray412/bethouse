/* parlay.js — combining legs, and suggesting a slip. Shared by the boards.
 *
 * Multiplying the legs is the easy part. The honest part is being clear
 * about what the product is not. Two legs in one game rise and fall
 * together, and two legs on one player are close to the same bet; the
 * product understates the joint chance in the first case and is
 * meaningless in the second. This module classifies a slip rather than
 * silently multiplying, and lets the caller pass a MEASURED lift for the
 * correlated cases (backtest-nfl.mjs --parlay) rather than inventing one.
 *
 * A leg is { key, playerId, gameId, team, prob, ... }. The caller decides
 * what is bettable; nothing here knows what time it is. `lift` carries
 * one multiplier per class: game, mixed, team, player.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.BetHouseParlay = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const num = (x) => (typeof x === "number" && isFinite(x) ? x : 0);

  /**
   * What a set of legs adds up to. `lift` is optional: { game, team }
   * multipliers measured on the replay for same-game and same-team slips
   * (1 = independent). The product is always reported; `adjusted` is the
   * product times the lift that applies, so a page can print both.
   */
  function combineLegs(legs, lift) {
    if (!Array.isArray(legs) || !legs.length) return null;
    let prob = 1;
    for (const l of legs) {
      if (!l || !(l.prob > 0 && l.prob <= 1)) return null;
      prob *= l.prob;
    }
    /* A game leg (spread or total, playerId "game") is nobody's player;
       a spread leg carries the side's team, a total leg no team. */
    const byPlayer = {}, byGame = {}, byTeam = {};
    for (const l of legs) {
      const pid = String(l.playerId);
      if (pid !== "game") byPlayer[String(l.gameId) + "|" + pid] = (byPlayer[String(l.gameId) + "|" + pid] || 0) + 1;
      byGame[String(l.gameId)] = (byGame[String(l.gameId)] || 0) + 1;
      if (l.team) byTeam[String(l.gameId) + "|" + String(l.team)] = (byTeam[String(l.gameId) + "|" + String(l.team)] || 0) + 1;
    }
    const dupPlayers = Object.values(byPlayer).filter((n) => n > 1).length;
    const sameGame = Object.values(byGame).filter((n) => n > 1).length;
    const sameTeam = Object.values(byTeam).filter((n) => n > 1).length;
    /* The same player twice is "player" when the caller has measured that
       case and passed lift.player, and "severe" -- no number -- when not. */
    /* "team" is every leg on one team; "mixed" is some legs sharing a
       team and others not; "game" is one game with no two on one team.
       They measured differently, so they are different classes. */
    const teamCounts = Object.values(byTeam);
    const allOneTeam = teamCounts.length === 1 && teamCounts[0] === legs.length;
    const L = lift || {};
    const correlation = dupPlayers > 0 ? (num(L.player) > 0 ? "player" : "severe")
      : sameTeam > 0 ? (allOneTeam ? "team" : "mixed") : sameGame > 0 ? "game" : "none";
    const mult = correlation === "player" ? num(L.player) : correlation === "none" ? 1 : (num(L[correlation]) || 1);
    return {
      prob,
      adjusted: correlation === "severe" ? null : Math.min(1, prob * mult),
      lift: mult,
      legs: legs.length,
      distinctGames: Object.keys(byGame).length,
      duplicatePlayers: dupPlayers,
      correlation,
      independent: correlation === "none",
    };
  }

  /**
   * Build a slip. `opts.legs` legs (default 3), ranked by probability:
   * the slip most likely to CASH, which is not the slip most likely to be
   * worth betting, because nothing here can see a price.
   *
   *   scope "slate" (default): one leg per game, the best in each, from
   *     that many different games. Refuses when there are not enough
   *     games: a two-leg answer to a three-leg question is a different
   *     question.
   *   scope "game" with opts.gameId: the best legs in that one game, at
   *     most one per player (a game leg is its own "player"). Refuses when
   *     the game has fewer legs than asked. The caller decides whether to
   *     offer this at all: see the measured same-game lift before you do.
   */
  function suggestParlay(candidates, opts) {
    const o = opts || {};
    const want = o.legs == null ? 3 : o.legs;
    if (!Number.isInteger(want) || want < 1) return null;
    if (!Array.isArray(candidates) || !candidates.length) return null;
    const usable = candidates.filter((c) => c && typeof c.prob === "number" && isFinite(c.prob) && c.prob > 0 && c.prob <= 1);
    const byProb = (a, b) => b.prob - a.prob || String(a.playerId).localeCompare(String(b.playerId));
    let legs;
    if (o.scope === "game") {
      const inGame = usable.filter((c) => String(c.gameId) === String(o.gameId));
      const seen = new Set();
      const who = (c) => String(c.playerId) === "game" ? "game|" + String(c.prop) : String(c.playerId);
      legs = inGame.sort(byProb).filter((c) => !seen.has(who(c)) && seen.add(who(c)));
    } else {
      const best = new Map();
      for (const c of usable) {
        const g = String(c.gameId);
        if (!best.has(g) || byProb(c, best.get(g)) < 0) best.set(g, c);
      }
      legs = [...best.values()].sort(byProb);
    }
    if (legs.length < want) return null;
    legs = legs.slice(0, want);
    return { legs, combined: combineLegs(legs, o.lift) };
  }

  return { combineLegs, suggestParlay };
});
