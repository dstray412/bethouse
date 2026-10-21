/* watchlist.js — what the browser remembers about the football boards.
 *
 * The players you starred and the props you track live. (The price you
 * typed against a row lived here too until 2026-10-17, when the site
 * stopped showing odds.) Nothing here touches localStorage: the page
 * reads and writes the store (try/catch, a private window can refuse)
 * and hands the raw string in and out, the way baseball.html does for
 * the bet log. Same shape as bets.js: a versioned key, a parse that
 * swallows bad JSON, a serialise that is plain JSON.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BetHouseWatchlist = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const WATCH_KEY = "bethouse.watch.v1";
  const TRACK_KEY = "bethouse.track.v1";

  /* A tracked prop for the live page: one player, one prop, one target,
     in one game. The key is the identity; the rest is what the page
     shows without a data file. */
  function trackKey(t) {
    const base = [t.league, t.gameId, t.playerId, t.prop].map(String).join("|");
    return t.prop === "td" || t.rung == null ? base : base + "|" + String(t.rung);
  }
  const TRACK_FIELDS = ["league", "sport", "gameId", "playerId", "name", "team", "opp", "teamKey", "prop", "rung", "addedAt"];
  function normTrack(t) {
    const out = {};
    for (const f of TRACK_FIELDS) if (t[f] != null) out[f] = t[f];
    out.key = trackKey(out);
    return out;
  }
  function parseTracks(raw) {
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return [];
    }
    if (!Array.isArray(data)) return [];
    const out = [], seen = new Set();
    for (const t of data) {
      if (!t || typeof t !== "object" || !t.playerId || !t.prop || !t.gameId) continue;
      if (t.key !== trackKey(t) || seen.has(t.key)) continue;
      seen.add(t.key); out.push(normTrack(t));
    }
    return out;
  }
  function hasTrack(list, key) {
    return Array.isArray(list) && list.some((t) => t && t.key === key);
  }
  function toggleTrack(list, t) {
    const cur = Array.isArray(list) ? list : [];
    const key = trackKey(t);
    if (hasTrack(cur, key)) return cur.filter((x) => x.key !== key);
    return cur.concat([normTrack(Object.assign({ addedAt: new Date().toISOString() }, t))]);
  }

  /* A star is on the player, per league: you watch a man, then look at his props. */
  function watchKey(e) {
    return String(e.league) + "|" + String(e.playerId);
  }
  function parseWatch(raw) {
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return [];
    }
    if (!Array.isArray(data)) return [];
    const out = [];
    for (const k of data) if (typeof k === "string" && k && out.indexOf(k) < 0) out.push(k);
    return out;
  }
  function has(list, key) {
    return Array.isArray(list) && list.indexOf(key) >= 0;
  }
  function toggle(list, key) {
    const cur = Array.isArray(list) ? list : [];
    return has(cur, key) ? cur.filter((k) => k !== key) : cur.concat([key]);
  }

  function serialise(map) {
    return JSON.stringify(map);
  }

  return { serialise, WATCH_KEY, watchKey, parseWatch, toggle, has, TRACK_KEY, trackKey, parseTracks, toggleTrack, hasTrack };
});
