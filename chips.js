/* chips.js — the chips a football row and its card wear.
 *
 * Each chip is one measured number past a threshold, and the thresholds
 * live here and nowhere else (tasks/lessons.md: two copies of the same
 * rule will disagree). The board asks for a player's chips and escapes
 * what it prints; this file returns plain data and writes no markup.
 *
 *   Volume up / down   the last three games' carries and targets against
 *                      the games before them, past twenty percent either
 *                      way, with six games or more so there are at least
 *                      three to compare against
 *   Red zone N%        his share of the red-zone touches (carries and
 *                      targets inside the 20) logged for his team's
 *                      priced players, from twenty percent; the data
 *                      file carries no team total, and the note says so
 *   Snaps N%           the season snap share at seventy or above, or at
 *                      forty or below
 *   Deep N%            the air-yards share from thirty percent
 *   Soft D / Tough D   the opponent factor the model applies (for a
 *                      counting prop, the allowance at the stat's fitted
 *                      strength), seven percent either side of average:
 *                      the badge the stat rows always carried, now with
 *                      its threshold here
 *
 * The inputs are the data file's fields (fetch-football.mjs, A1): `log`
 * rows oldest first [td, carries, receivingOpportunity, rzc, rzt, glc],
 * `rz` {c, t, g, n}, `usage` {snap, snapN, ays, aysN, ...}. A field the
 * file does not carry is a chip the player does not wear, never a zero.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BetHouseChips = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const THRESHOLDS = Object.freeze({
    volume: 0.2, redZone: 0.2, snapsHigh: 0.7, snapsLow: 0.4, deep: 0.3, defence: 0.07,
    recentGames: 3, minGames: 6,
  });
  /* A row wears this many; the card's overview wears them all. */
  const MAX_ROW = 3;

  const num = (v) => (typeof v === "number" && isFinite(v) ? v : Number(v) || 0);
  const pctOf = (x) => Math.round(100 * x) + "%";
  const signed = (d) => (d >= 0 ? "+" : "−") + Math.abs(d) + "%";

  /* The last three games' opportunities a game against the games before
     them, so the three are not diluted by comparing them with themselves. */
  function volume(player) {
    const log = player && player.log;
    if (!Array.isArray(log) || log.length < THRESHOLDS.minGames) return null;
    const opp = (row) => num(row[1]) + num(row[2]);
    const last = log.slice(-THRESHOLDS.recentGames), before = log.slice(0, -THRESHOLDS.recentGames);
    const recent = last.reduce((s, r) => s + opp(r), 0) / last.length;
    const prior = before.reduce((s, r) => s + opp(r), 0) / before.length;
    if (!(prior > 0)) return null;
    return { ratio: recent / prior, recent, prior, priorN: before.length };
  }

  function forPlayer(player, ctx) {
    const p = player || {}, c = ctx || {}, out = [];
    const v = volume(p);
    if (v) {
      const d = Math.round((v.ratio - 1) * 100);
      if (Math.abs(v.ratio - 1) >= THRESHOLDS.volume) {
        out.push({ id: "volume", dir: d > 0 ? "up" : "down", label: d > 0 ? "Volume up" : "Volume down", value: signed(d),
          note: v.recent.toFixed(1) + " carries and targets a game over his last " + THRESHOLDS.recentGames + " games, against " + v.prior.toFixed(1) + " over the " + v.priorN + " before" });
      }
    }
    const rz = p.rz;
    if (rz && num(rz.n) > 0 && num(c.teamRz) > 0) {
      const mine = num(rz.c) + num(rz.t), share = mine / num(c.teamRz);
      if (share >= THRESHOLDS.redZone) {
        out.push({ id: "redzone", dir: null, label: "Red zone " + pctOf(share), value: null,
          note: mine + " of the " + num(c.teamRz) + " red-zone touches logged for " + String(c.team || "the team") + "'s priced players (carries and targets inside the 20); his over " + num(rz.n) + " games" });
      }
    }
    if (c.oppFactor != null && isFinite(c.oppFactor) && Math.abs(c.oppFactor - 1) >= THRESHOLDS.defence) {
      const d = Math.round((c.oppFactor - 1) * 100), soft = d > 0;
      out.push({ id: "defence", dir: soft ? "up" : "down", label: soft ? "Soft D" : "Tough D", value: signed(d),
        note: String(c.opp || "the opponent") + " gives up " + Math.abs(d) + "% " + (soft ? "more" : "fewer") + " " + (c.what || "of these") + " than average" });
    }
    const u = p.usage;
    if (u && num(u.snapN) > 0 && typeof u.snap === "number" && isFinite(u.snap)) {
      const s = num(u.snap);
      if (s >= THRESHOLDS.snapsHigh || s <= THRESHOLDS.snapsLow) {
        out.push({ id: "snaps", dir: s >= THRESHOLDS.snapsHigh ? "up" : "down", label: "Snaps " + pctOf(s), value: null,
          note: "on the field for " + pctOf(s) + " of the offence's snaps over " + num(u.snapN) + " games" });
      }
    }
    if (u && num(u.aysN) > 0 && isFinite(u.ays) && num(u.ays) >= THRESHOLDS.deep) {
      out.push({ id: "deep", dir: null, label: "Deep " + pctOf(u.ays), value: null,
        note: pctOf(u.ays) + " of the team's air yards over " + num(u.aysN) + " games: thrown to far downfield" });
    }
    return out;
  }

  const row = (list) => (list || []).slice(0, MAX_ROW);

  return { THRESHOLDS, MAX_ROW, volume, forPlayer, row };
});
