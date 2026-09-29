/* watchlist.js — what the browser remembers about the football boards.
 *
 * The price you typed against a row, so the board can show your edge at
 * it and still show it tomorrow. Nothing here touches localStorage: the
 * page reads and writes the store (try/catch, a private window can
 * refuse) and hands the raw string in and out, the way index.html does
 * for the bet log. Same shape as bets.js: a versioned key, a parse that
 * swallows bad JSON, a serialise that is plain JSON.
 *
 * A price is keyed by league, player, prop and -- for a counting prop --
 * the line, because the price the book offers at o59.5 is not a price at
 * o77.5, and the board's line setting moves the line.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BetHouseWatchlist = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const PRICE_KEY = "bethouse.prices.v1";

  function priceKey(e) {
    const base = String(e.league) + "|" + String(e.playerId) + "|" + String(e.prop);
    return e.prop === "td" ? base : base + "|" + String(e.line);
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

  return { PRICE_KEY, priceKey, validPrice, parsePrices, serialise };
});
