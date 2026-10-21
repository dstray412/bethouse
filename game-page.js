/* game-page.js — one NFL game's preview (2026-10-21): what the boards
 * already know about the two teams, on one page a home card links to.
 *
 * The head is the slate's line (week, day, kickoff), the matchup, and
 * the model's projection beside the market's numbers (a line, never a
 * price). Then the two teams' offence and defence ratings as the teams
 * page draws them (teams-page.js, every rank among the 32); each offence
 * against the defence it faces, in the core's own sentences for the
 * families either side leans into or gives up (tendencies-core.js); the
 * cheat sheet for the game (sheet-page.js); and who on either side has
 * cleared his line most in his last ten (consistency-page.js). Nothing
 * here is computed twice: the page hands each module the game and
 * prints what it returns, and a module that did not load is a section
 * that is not shown.
 *
 * Pure the way teams-page.js is: `find`, `players` and the *Html
 * functions take data and hand back markup; `render` writes the hosts.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BetHouseGamePage = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pct = (v) => (v == null || !isFinite(v) ? "—" : Math.round(100 * v) + "%");
  const sgn = (v) => (v > 0 ? "+" : "") + v;

  /** The game with this id in the data file, or null. Ids are strings in the file; a number from a URL still matches. */
  function find(data, id) {
    if (!data || !Array.isArray(data.games) || id == null || id === "") return null;
    return data.games.find((g) => g && String(g.id) === String(id)) || null;
  }

  /** The data file's players on either side of the game. */
  function players(data, game) {
    if (!data || !Array.isArray(data.players) || !game) return [];
    return data.players.filter((p) => p && (p.team === game.away || p.team === game.home));
  }

  /** The head: the week line's own pattern (kicker, heading, one sentence), with the projection beside the market's line. */
  function headHtml(game, data, model, helpers) {
    const h = helpers || {}, F = h.faces || null, league = h.league || "NFL";
    if (!game) return "";
    const mark = (t) => (F ? F.mark(league, t, 28) : "");
    const t = Date.parse(game.date);
    const when = isFinite(t) ? new Date(t).toLocaleString(undefined, { weekday: "long", month: "long", day: "numeric" }) + " · " + new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "";
    const kick = [data && data.week != null ? "Week " + esc(data.week) : "", esc(when), game.completed ? "Final" : ""].filter(Boolean).join(" · ");
    let sentence = "";
    const pr = model && data && data.ratings && typeof model.projectGame === "function"
      ? model.projectGame(data.ratings, game.home, game.away, { neutral: !!game.neutral, wind: game.wind, indoor: !!game.indoor }) : null;
    if (pr) {
      const fav = pr.margin >= 0 ? game.home : game.away, win = typeof model.winProbability === "function" ? model.winProbability(Math.abs(pr.margin)) : null;
      sentence += "The model projects <b>" + esc(game.home) + " " + pr.homePts.toFixed(1) + "</b> — <b>" + esc(game.away) + " " + pr.awayPts.toFixed(1) + "</b>" +
        (pr.margin !== 0 ? ", " + esc(fav) + " by " + Math.abs(pr.margin).toFixed(1) + (win != null ? " (a " + pct(win) + " chance)" : "") : ", a pick 'em") +
        ", total <b>" + pr.total.toFixed(1) + "</b>";
    }
    const L = game.line;
    /* Number.isFinite, not the global: the fetcher writes null for a number ESPN did not have, and global isFinite(null) is true. */
    const hasS = !!L && Number.isFinite(L.spread), hasT = !!L && Number.isFinite(L.total);
    if (hasS || hasT) {
      sentence += (sentence ? ". " : "") + "The market has " + (hasS ? esc(game.home) + " <b>" + sgn(L.spread) + "</b>" : "") +
        (hasS && hasT ? ", " : "") + (hasT ? "total <b>" + L.total + "</b>" : "") + (L.book ? " (" + esc(L.book) + ")" : "");
    }
    if (sentence) sentence += ". The replay found neither the favourite nor the lines beat the market: shown because you asked which side, not as a bet.";
    return '<div class="week gphead"><span class="kick">' + kick + '</span><h2>' + mark(game.away) + esc(game.away) + '<span class="at">at</span>' + mark(game.home) + esc(game.home) + '</h2>' +
      (game.venue ? '<span class="venue">' + esc(game.venue) + (game.neutral ? " · neutral site" : "") + "</span>" : "") +
      (sentence ? "<p>" + sentence + ' <a class="open" href="nfl.html">The NFL board →</a></p>' : "") + "</div>";
  }

  /** The two teams' rows on the teams page's two tables, every rank still among the league. "" without the module or the profiles. */
  function ratingsHtml(tend, core, game, helpers, sort) {
    const h = helpers || {}, TP = h.teamsPage || null;
    if (!TP || typeof TP.rows !== "function" || !game) return "";
    const all = TP.rows(tend, core);
    const two = all.filter((r) => r.team === game.away || r.team === game.home);
    if (!two.length) return "";
    const s = sort || {};
    return ['off', 'def'].map((v) => '<div class="game tscroll grate" data-view="' + v + '"><div class="ghead"><h3 class="gtitle">' + (v === "off" ? "Offence" : "Defence") + "</h3></div>" +
      TP.tableHtml(two, s[v] || TP.DEFAULT_SORT[v], h, v) + "</div>").join("") +
      (two.length < 2 ? '<p class="note">Only ' + esc(two[0].team) + " has a profile this season.</p>" : "");
  }

  /** Each offence against the defence it faces: the families either side leans into or gives up, in the core's sentences. "" without profiles. */
  function matchupHtml(tend, core, game) {
    if (!core || !tend || !tend.current || !tend.current.off || !tend.current.def || !tend.current.league || !game) return "";
    const side = (offTeam, defTeam) => {
      const off = tend.current.off[offTeam], def = tend.current.def[defTeam];
      if (!off || !def) return "";
      const edges = core.matchup(off, def, tend.current.league).filter((e) => (e.edge != null && Math.abs(e.edge) >= core.SOFT_EPA) || (e.lean != null && Math.abs(e.lean) >= core.LEAN_SHARE));
      /* Softest first; two lean-only families (no EPA for the family on the defence's profile) by name, since -Infinity minus -Infinity is NaN and would leave the order to the engine. */
      edges.sort((a, b) => ((b.edge == null ? -Infinity : b.edge) - (a.edge == null ? -Infinity : a.edge)) || a.family.localeCompare(b.family));
      let html = '<div class="muside"><div class="mutitle">' + esc(offTeam) + " offence vs " + esc(defTeam) + " defence</div>";
      if (!edges.length) return html + '<p class="mline">Nothing either side leans into or gives up past the league.</p></div>';
      html += '<ul class="mulist">';
      for (const e of edges) {
        let tags = "";
        if (e.edge != null && e.edge >= core.SOFT_EPA) tags += '<span class="tag soft">soft</span>';
        else if (e.edge != null && e.edge <= -core.SOFT_EPA) tags += '<span class="tag tough">stout</span>';
        if (e.lean != null && e.lean >= core.LEAN_SHARE) tags += '<span class="tag lean">leans in</span>';
        else if (e.lean != null && e.lean <= -core.LEAN_SHARE) tags += '<span class="tag lean">avoids</span>';
        html += "<li><b>" + esc(e.family) + "</b>" + tags + "<span>" + esc(core.describe(e, { off: offTeam, def: defTeam })) + "</span></li>";
      }
      return html + "</ul></div>";
    };
    const body = side(game.away, game.home) + side(game.home, game.away);
    if (!body) return "";
    const w = tend.through && tend.through.week;
    return '<div class="mu">' + body + '<p class="mufoot">Play-by-play' + (w ? " through week " + esc(Number(w)) : "") + " (nflverse); each rate regressed toward last season by " + esc(Number(tend.K || 0)) +
      " games. An offence <b>leans in</b> to a family it uses " + esc(Math.round(100 * core.LEAN_SHARE)) + " points more than the league and <b>avoids</b> one it uses less; a defence is <b>soft</b> where it allows " +
      esc(core.SOFT_EPA) + ' EPA a play more than the league and <b>stout</b> where it allows that much less. Descriptive: nothing here is in a price. <a href="teams.html">Every team →</a></p></div>';
  }

  /** The cheat sheet for the game: every top-five line for both sides, tagged D or O. "" without the sheets or the module. */
  function cheatHtml(data, game, helpers) {
    const h = helpers || {}, SP = h.sheetPage || null;
    if (!SP || typeof SP.listHtml !== "function" || !game || !data || !(data.defence || data.offence)) return "";
    const list = SP.listHtml(data.defence || null, data.offence || null, game);
    if (!list || !list.html) return "";
    const fd = data.defence && data.defence.field, fo = data.offence && data.offence.field, field = fd && fo ? (fd === fo ? fd : null) : fd || fo || null;
    const thr = (data.defence && data.defence.through) || (data.offence && data.offence.through) || null;
    return '<div class="mu cheat">' + list.html + '<p class="mufoot">What each side has allowed (<b>D</b>) or done (<b>O</b>) most this season' + (thr && thr.week ? " through week " + esc(thr.week) : "") +
      ", the top five" + (field ? " of " + esc(field) : "") + "; turnovers, takeaways and a defence's sacks rank from the fewest; <b>1g</b> marks a line from a single game. " +
      'A place to look, not a price: the model already carries a defence through its fitted allowances. <a href="defence.html">Defences →</a> <a href="offence.html">Offences →</a></p></div>';
  }

  /** Who on either side has cleared his line most in his last ten: a card a prop at its lowest rung (as the home's strip does, so one player's 100-yard games do not fill three receiving cards), only the props with somebody, five a card. "" without the module. */
  function consistencyHtml(model, data, game, helpers) {
    const h = helpers || {}, CP = h.consistencyPage || null;
    if (!CP || typeof CP.rows !== "function" || !model || !game) return "";
    const ps = players(data, game);
    const lowest = [];
    for (const r of CP.RUNGS || []) { const i = lowest.findIndex((x) => x.stat === r.stat); if (i < 0) lowest.push(r); else if (r.rung < lowest[i].rung) lowest[i] = r; }
    const cards = lowest.map((r) => { const list = CP.rows(model, ps, r, data && data.season, 5); return list.length ? CP.cardHtml(r, list, h, 5) : ""; }).filter(Boolean);
    return cards.length ? '<div class="cons cgrid">' + cards.join("") + "</div>" : "";
  }

  /* The sections, by host id; their heads are the page's own markup (game.html). */
  const SECTIONS = [{ id: "ratings" }, { id: "matchup" }, { id: "cheat" }, { id: "cons" }];

  /**
   * Render into the page: the head into #ghead, each section into its
   * host (#ratings, #matchup, #cheat, #cons; a section with nothing is
   * hidden with its host), the caveat into #gfoot. opts: data (the NFL
   * file), model (nfl.js), tend and core (the profiles and their
   * arithmetic), teamsPage, sheetPage, consistencyPage, faces, teams,
   * league, id (the game to show; from the page's URL).
   */
  function render(doc, opts) {
    const o = opts || {}, host = doc.getElementById("ghead");
    if (!host) return;
    const game = find(o.data, o.id);
    const hide = (id, on) => { const el = doc.getElementById(id); if (el) el.hidden = !on; return el; };
    if (!game) {
      host.innerHTML = '<div class="empty"><div class="big">No such game on the board</div><div>The slate is on the <a href="index.html">home</a>; the NFL file rebuilds daily.</div></div>';
      for (const s of SECTIONS) hide(s.id + "sec", false);
      return;
    }
    if (doc.title !== undefined) doc.title = game.away + " at " + game.home + " · BetHouse";
    host.innerHTML = headHtml(game, o.data, o.model, o);
    /* Each section once; a sort redraws the ratings alone, so the other three keep their selection and scroll. */
    const put = (id, html) => { const el = doc.getElementById(id); hide(id + "sec", !!html); if (el) el.innerHTML = html || ""; };
    const draw = (sort) => put("ratings", ratingsHtml(o.tend, o.core, game, o, sort));
    draw(null);
    put("matchup", matchupHtml(o.tend, o.core, game));
    put("cheat", cheatHtml(o.data, game, o));
    put("cons", consistencyHtml(o.model, o.data, game, o));
    /* A column head on a ratings table re-sorts that table, as on the teams page; one listener per host. */
    const rate = doc.getElementById("ratings");
    if (rate && rate.addEventListener && !rate.__sorting) {
      rate.__sorting = true;
      rate.__sort = {};
      rate.addEventListener("click", (e) => {
        const b = e.target && e.target.closest ? e.target.closest("[data-sort]") : null, panel = b && b.closest ? b.closest("[data-view]") : null;
        if (!b || !panel) return;
        rate.__sort[panel.getAttribute("data-view")] = b.getAttribute("data-sort");
        draw(rate.__sort);
      });
    }
    const foot = doc.getElementById("gfoot");
    if (foot) foot.innerHTML = "<p>Built from the NFL board's data file" + (o.data && o.data.generated ? " (" + esc(String(o.data.generated).slice(0, 16).replace("T", " ")) + " UTC)" : "") +
      ". Every number here is one a board already shows: the ratings are the teams page's, the matchup the board's own panel, the sheet lines the cheat sheets', the counts the consistency cards'. The chance a player clears his line this week is on the NFL board, in his drawer.</p>";
  }

  return { SECTIONS, find, players, headHtml, ratingsHtml, matchupHtml, cheatHtml, consistencyHtml, render };
});
