/* teams.js — a team's colours, for the few places DESIGN.md lets them go.
 *
 * The home's game cards wear a two-colour stripe (away · home), the
 * drawer's hero a faint tint of the team's primary behind the photo, and
 * the tray cards a left edge in it. A team colour is a stripe or a tint
 * behind white text, never a text colour: this module hands back bare
 * CSS colour values and the callers put them only in background and
 * border properties (dom.test.mjs pins that).
 *
 * The table is teams-data.js, written by fetch-teams.mjs from ESPN's
 * team lists and keyed the way faces.js keys a team: the NFL and MLB by
 * abbreviation, college by ESPN's numeric id. Without the table every
 * call is empty and the pages keep their shape.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BetHouseTeams = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  let table = (root && root.BetHouseTeamsData) || null;
  const HEX = /^[0-9a-f]{6}$/;
  const keyOf = (v) => { const k = String(v == null ? "" : v).toLowerCase(); return /^[a-z0-9]{1,8}$/.test(k) ? k : null; };
  const hex = (v) => { const h = String(v == null ? "" : v).toLowerCase(); return HEX.test(h) ? "#" + h : null; };
  /* DESIGN.md: the tint is faint; the text over it stays white on near-black. */
  const TINT = 0.16;
  /* A primary this dark is invisible on the site's black and near-black
     surfaces (black is 0, the surface #111 is 0.006, a navy is 0.04), so
     such a team paints with its secondary: the Steelers' gold, not their
     black. Relative luminance, sRGB. */
  const DARK = 0.02;
  const lum = (h) => {
    const n = parseInt(h.slice(1), 16);
    const ch = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * ch(n >> 16) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
  };

  /** Point the module at a table (the page's global, a test's fixture, or null). */
  function use(data) { table = data || null; return api; }

  /** {primary, secondary} as #hex, or null when the team or its primary is unknown. */
  function colour(league, key) {
    const k = keyOf(key);
    const rows = table && Object.prototype.hasOwnProperty.call(table, String(league)) ? table[league] : null;
    const row = rows && k && Object.prototype.hasOwnProperty.call(rows, k) ? rows[k] : null;
    const p = row && hex(row.p);
    if (!p) return null;
    return { primary: p, secondary: hex(row.s) };
  }

  /** The colour to paint for a team: its primary, or its secondary when the primary would vanish on
      black; null when unknown, and null when both would vanish (313 FBS rows are black with no usable
      secondary on ESPN's list), so a miss reads as a miss and never as a black bar. */
  function paint(league, key) {
    const c = colour(league, key);
    if (!c) return null;
    if (lum(c.primary) >= DARK) return c.primary;
    return c.secondary && lum(c.secondary) >= DARK ? c.secondary : null;
  }

  /** The two teams' colours as two solid halves (away, home); a known side beside a transparent one, so a miss reads as a miss; "" when neither. */
  function stripe(league, awayKey, homeKey) {
    const a = paint(league, awayKey), h = paint(league, homeKey);
    if (!a && !h) return "";
    return "linear-gradient(90deg," + (a || "transparent") + " 0 50%," + (h || "transparent") + " 50% 100%)";
  }

  /** The team's paint colour at an alpha, as rgba(); "" when unknown. */
  function tint(league, key, alpha) {
    const c = paint(league, key);
    if (!c) return "";
    const n = parseInt(c.slice(1), 16);
    const a = typeof alpha === "number" && alpha >= 0 && alpha <= 1 ? alpha : TINT;
    return "rgba(" + (n >> 16) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
  }

  const api = { use, colour, paint, stripe, tint, TINT, DARK };
  return api;
});
