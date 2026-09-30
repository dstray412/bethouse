/* faces.js — a player's photo and a team's mark, for every page.
 *
 * The leagues publish these themselves: ESPN's image service for NFL,
 * college and golf headshots and for every team's logo, MLB's photo
 * service for batters. A page asks here for a url by league and id and
 * gets one sized for the spot (a row's 44px disc, the drawer's cutout),
 * or null when the id is not an id. The img markup is built here too,
 * once, so every image on the site carries the same rules: no referrer,
 * lazy, a fixed box so nothing shifts, and hidden when it does not
 * load, leaving the empty disc rather than a placeholder face.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BetHouseFaces = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ESPN = "https://a.espncdn.com";
  const HEADS = { NFL: "nfl", "College football": "college-football", PGA: "golf" };
  const LOGOS = { NFL: "nfl", MLB: "mlb", "College football": "ncaa" };
  const HEAD_SIZE = { row: "w=96&h=70", large: "w=200&h=145" };
  const MLB_SIZE = { row: "w_120", large: "w_240" };

  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, String(k == null ? "" : k)) ? o[k] : null;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const idOf = (v) => { const s = String(v == null ? "" : v); return /^[0-9]{1,10}$/.test(s) ? s : null; };
  const keyOf = (v) => { const k = String(v == null ? "" : v).toLowerCase(); return /^[a-z0-9]{1,8}$/.test(k) ? k : null; };

  /** A headshot url by league and the league's own player id, sized "row" (default) or "large". */
  function headshotUrl(league, id, size) {
    const pid = idOf(id);
    if (!pid) return null;
    const sz = size === "large" ? "large" : "row";
    if (league === "MLB") return "https://img.mlbstatic.com/mlb-photos/image/upload/" + MLB_SIZE[sz] + ",q_auto:best/v1/people/" + pid + "/headshot/67/current";
    const path = own(HEADS, league);
    return path ? ESPN + "/combiner/i?img=/i/headshots/" + path + "/players/full/" + pid + ".png&" + HEAD_SIZE[sz] : null;
  }

  /** A team logo url: "small" (default, 80px through the combiner) or "full" (the 500px file). College by ESPN's numeric id. */
  function logoUrl(league, key, size) {
    const path = own(LOGOS, league);
    const k = keyOf(key);
    if (!path || !k) return null;
    if (league === "College football" && !/^[0-9]+$/.test(k)) return null;
    const file = "/i/teamlogos/" + path + "/500/" + k + ".png";
    return size === "full" ? ESPN + file : ESPN + "/combiner/i?img=" + file + "&w=80&h=80";
  }

  /** The logo key for a player's team: the abbreviation, or for college the id the game carries. */
  function teamKey(league, team, game) {
    if (!team) return null;
    if (league !== "College football") return keyOf(team);
    if (!game) return null;
    if (game.home === team && game.homeId) return keyOf(game.homeId);
    if (game.away === team && game.awayId) return keyOf(game.awayId);
    return null;
  }

  /** The one img markup: fixed box, lazy, no referrer, hidden on error; "" without a url. */
  function img(url, cls, px, alt) {
    if (!url) return "";
    const n = Number(px) || 44;
    return '<img class="' + esc(cls || "") + '" src="' + esc(url) + '" alt="' + esc(alt || "") + '" width="' + n + '" height="' + n + '" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.hidden=true">';
  }

  /** A row's face cell: the disc, with the photo when the id is one. */
  function face(league, id, px, size) {
    return '<span class="face">' + img(headshotUrl(league, id, size), "", px || 44) + "</span>";
  }
  /** A team's mark inline before its name; nothing without a key. */
  function mark(league, key, px) {
    return img(logoUrl(league, key, "small"), "tmark", px || 22);
  }

  return { headshotUrl, logoUrl, teamKey, img, face, mark, keyOf, idOf };
});
