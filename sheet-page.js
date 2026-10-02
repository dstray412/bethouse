/* sheet-page.js — the cheat sheets: for each open NFL game, what its two
 * defences allow most (defence.html), or what its two offences do most
 * (offence.html).
 *
 * The sheet itself is computed by the fetcher (fetch-football.mjs,
 * teamSheet) from this season's box scores and ships in nfl-data.js as
 * `defence` and `offence`: per team, each stat's value, how many games
 * it covers and its rank among the teams from the top end (1 the most,
 * or for takeaways and turnovers the fewest). This page lists, per
 * game, the lines ranked in the top five, both sides merged by rank, so
 * a reader sees at once where each is most generous, or most prolific.
 * The caveat differs by side: what the model takes from a defence, or
 * from an offence; the page names its side and refuses the other's sheet. A line from a single game is marked
 * "1g"; a line ranked among fewer than the field says of how many.
 * Descriptive, like the teams page: the model prices a defence through
 * its own fitted allowances (full strength on the touchdown chance and
 * the game line, half strength on rushing and passing yards, none on
 * the other counting props), and the caveat says so.
 *
 * Pure in the way record-page.js is: `lines`/`gameLines` are arithmetic
 * over the sheet, `cardHtml` is markup, `render` writes two containers.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BetHouseSheetPage = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const SHOWN = 5;
  const ord = (n) => { const s = ["TH", "ST", "ND", "RD"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

  /** One side's lines ranked in the top `max` places, in rank order then by label. */
  function lines(sheet, team, max) {
    const cut = max || SHOWN;
    const t = sheet && sheet.teams && sheet.teams[team], stats = sheet && sheet.stats;
    if (!t || !stats) return [];
    const out = [];
    for (const key of Object.keys(stats)) {
      const c = t[key];
      if (!c || !(c.rank >= 1) || c.rank > cut) continue;
      out.push({ rank: c.rank, team, key, label: stats[key].label, kind: stats[key].kind, soft: stats[key].soft, v: c.v, n: c.n, one: c.n === 1, of: c.of != null && sheet.field != null && c.of !== sheet.field ? c.of : null });
    }
    return out.sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label));
  }

  /** Both teams' lines, merged by rank; on a tie the away team first, as the head reads. */
  function gameLines(sheet, game, max) {
    const away = lines(sheet, game.away, max).map((l, i) => ({ ...l, where: 0, i })), home = lines(sheet, game.home, max).map((l, i) => ({ ...l, where: 1, i }));
    return away.concat(home).sort((a, b) => a.rank - b.rank || a.where - b.where || a.i - b.i);
  }

  const fmt = (l) => (l.kind === "total" ? String(Math.round(l.v)) : l.kind === "pct" ? l.v.toFixed(1) + "%" : l.kind === "rate" ? l.v.toFixed(2) : l.v.toFixed(1));

  /** One game's card, or "" when neither team has a line in the top places. `helpers`: faces, teams, league. */
  function cardHtml(sheet, game, helpers) {
    const h = helpers || {}, F = h.faces || null, T = h.teams || null, league = h.league || "NFL";
    const list = gameLines(sheet, game);
    if (!list.length) return "";
    const mark = (t) => (F ? F.mark(league, t, 22) : "");
    const stripe = T ? T.stripe(league, game.away, game.home) : "";
    const when = game.date && isFinite(Date.parse(game.date)) ? new Date(game.date).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }) : "";
    let html = '<section class="scard">' + (stripe ? '<span class="gstripe" style="background:' + esc(stripe) + '"></span>' : "") +
      '<header class="shead"><span class="sat">' + mark(game.away) + "<b>" + esc(game.away) + '</b><span class="at">@</span>' + mark(game.home) + "<b>" + esc(game.home) + "</b></span>" +
      (when ? '<span class="gtime">' + esc(when) + "</span>" : "") + "</header><ul class=\"slines\">";
    for (const l of list) {
      html += "<li>" + '<span class="rk' + (l.rank === 1 ? " r1" : "") + '">' + (l.rank === 1 ? (l.soft === "fewest" ? "FEWEST" : "MOST") : ord(l.rank)) + "</span>" +
        '<b class="tm">' + esc(l.team) + '</b> <span class="st">' + esc(l.label) + (l.of ? ' <small>of ' + esc(l.of) + "</small>" : "") + '</span><span class="v">' + (l.one ? "<small>1g</small>" : "") + esc(fmt(l)) + "</span></li>";
    }
    return html + "</ul></section>";
  }

  /** The caveat: what the ranks are, what a one-game line is, the window, and what the model takes from this side. */
  function footHtml(sheet) {
    const field = sheet && sheet.field, thr = sheet && sheet.through, off = sheet && sheet.side === "off";
    const unit = off ? "offences" : "defences", when = thr && thr.season != null && thr.week ? ", " + esc(thr.season) + " through week " + esc(thr.week) : "";
    return "<p>" + (off ? "What each offence has done most this season" : "What each defence has allowed most this season") + ", from the box scores" + when +
      ". A place is out of " + (field != null ? esc(field) : "the") + " " + unit + ", 1 the most (for " + (off ? "turnovers" : "takeaways") + ", the fewest), ties sharing it; only the top five places are listed, and a line ranked among fewer (a split not every " + (off ? "offence" : "defence") + " has yet) says of how many. " +
      "Yardage is a game; touchdowns and " + (off ? "turnovers" : "takeaways") + " are the season's count, ranked a game so an extra game played is not an extra touchdown" + (off ? "" : " allowed") + "; the home and road splits count that side's games; <b>1g</b> marks a line from a single game. The position splits come from the roster, so a catcher on none is in none. " +
      (off
        ? "Descriptive: a tendency is a place to look, not a price. The model takes from an offence its team factor, its touchdown rate against the league, at full strength on the touchdown chance, and its rating on the game line; a counting prop takes nothing from the offence's own production, only the opponent's allowance and the share its injured teammates leave behind."
        : "Descriptive: a soft spot is a place to look, not a price. The model prices a defence through its own fitted allowances: at full strength on the touchdown chance and the game line, at half strength on rushing and passing yards, and not at all on the other counting props.") + "</p>";
  }

  /* Render: the open games in kickoff order into #sheet, the caveat into #sfoot. */
  function render(doc, opts) {
    const o = opts || {}, host = doc.getElementById("sheet"), foot = doc.getElementById("sfoot");
    if (!host) return;
    /* A page says which side it is; a sheet of the other side (a build that mislabelled one) is refused, not captioned wrongly. */
    const wrongSide = !!(o.sheet && o.side && (o.sheet.side || "def") !== o.side);
    const sheet = o.sheet && !wrongSide ? o.sheet : null;
    if (foot) foot.innerHTML = sheet ? footHtml(sheet) : "";
    if (wrongSide) { host.innerHTML = '<div class="empty"><div class="big">Wrong sheet</div><div>The file carries the other side\'s sheet; the fetcher labels each one.</div></div>'; return; }
    if (!sheet || !sheet.teams || !Object.keys(sheet.teams).length) { host.innerHTML = '<div class="empty"><div class="big">No sheet</div><div>The fetcher writes it from this season\'s box scores; none are on file yet.</div></div>'; return; }
    const now = o.now || Date.now();
    const games = (o.games || []).filter((g) => g && g.home && g.away && !g.completed && Date.parse(g.date) > now).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    if (!games.length) { host.innerHTML = '<div class="empty"><div class="big">No games</div><div>Nothing is scheduled in the NFL file.</div></div>'; return; }
    const cards = games.map((g) => cardHtml(sheet, g, o)).filter(Boolean);
    host.innerHTML = cards.length ? cards.join("") : '<div class="empty"><div class="big">Nothing in the top five</div><div>No ' + (sheet.side === "off" ? "offence" : "defence") + ' on this slate ranks in the top five places on any line.</div></div>';
  }

  return { SHOWN, lines, gameLines, cardHtml, footHtml, render };
});
