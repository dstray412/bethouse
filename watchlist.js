/* watchlist.js — what the browser remembers about the football boards.
 *
 * The price you typed against a row, so the board can show your edge at
 * it and still show it tomorrow, and the players you starred. Nothing here touches localStorage: the
 * page reads and writes the store (try/catch, a private window can
 * refuse) and hands the raw string in and out, the way baseball.html does
 * for the bet log. Same shape as bets.js: a versioned key, a parse that
 * swallows bad JSON, a serialise that is plain JSON.
 *
 * A price is keyed by league, slate (season and week), player, prop and
 * -- for a counting prop -- the line: the price the book offers at o59.5
 * is not a price at o77.5, and the board's line setting moves the line;
 * and last week's price is not this week's, a new opponent and a new
 * number at the book. Only the slate on the board is kept, so the store
 * does not carry every week ever typed.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BetHouseWatchlist = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const PRICE_KEY = "bethouse.prices.v1";
  const WATCH_KEY = "bethouse.watch.v1";
  const TRACK_KEY = "bethouse.track.v1";

  /* A tracked prop for the live page: one player, one prop, one target,
     in one game. The key is the identity; the rest is what the page
     shows without a data file. */
  function trackKey(t) {
    const base = [t.league, t.gameId, t.playerId, t.prop].map(String).join("|");
    return t.prop === "td" || t.rung == null ? base : base + "|" + String(t.rung);
  }
  const TRACK_FIELDS = ["league", "sport", "gameId", "playerId", "name", "team", "opp", "prop", "rung", "addedAt"];
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

  function priceKey(e) {
    const base = String(e.league) + "|" + String(e.slate) + "|" + String(e.playerId) + "|" + String(e.prop);
    return e.prop === "td" ? base : base + "|" + String(e.line);
  }

  /** The entries for one league's slate, and nothing older or elsewhere. */
  function forSlate(map, league, slate) {
    const out = {};
    if (!map || typeof map !== "object") return out;
    const head = String(league) + "|" + String(slate) + "|";
    for (const k of Object.keys(map)) if (k.indexOf(head) === 0) out[k] = map[k];
    return out;
  }

  /** An American price: a whole number at or beyond ±100, or null. */
  function validPrice(x) {
    if (x == null) return null;
    const s = String(x).trim();
    if (!/^[+-]?\d+$/.test(s)) return null;
    const n = Number(s);
    return Math.abs(n) >= 100 ? n : null;
  }

  function parsePrices(raw) {
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return {};
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) return {};
    const out = {};
    for (const k of Object.keys(data)) {
      if (!k) continue;
      const v = validPrice(data[k]);
      if (v != null) out[k] = v;
    }
    return out;
  }

  function serialise(map) {
    return JSON.stringify(map);
  }

  return { PRICE_KEY, priceKey, forSlate, validPrice, parsePrices, serialise, WATCH_KEY, watchKey, parseWatch, toggle, has, TRACK_KEY, trackKey, parseTracks, toggleTrack, hasTrack };
});
