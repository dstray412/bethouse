/* teams-page.js — the teams page: one row per team from tendencies-data.js.
 *
 * What each offence does and what each defence allows, as the matchup
 * panel already shows for one game, laid out for the whole league and
 * sortable by any column: pace, pass rate, pass rate over expectation,
 * EPA per play, pass and rush, and the six play families as chips (the
 * offence's leans, the defence's soft spots), every one from the same
 * arithmetic the board uses (tendencies-core.js). Descriptive, like the
 * panel: nothing here is in a price, and the page says so.
 *
 * Pure in the same way record-page.js is: `rows()` is arithmetic over
 * the data file, `render()` writes one container, and a page passes in
 * the document, the data and the helpers it has.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BetHouseTeamsPage = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pct = (v) => (v == null ? "—" : Math.round(100 * v) + "%");
  const epa = (v) => (v == null ? "—" : (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(2));
  const pts = (v) => (v == null ? "—" : (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(1));

  /* The columns, in order: key, head, the side it reads, how to print it,
     and which way the sort runs. A RANK ("3rd") is printed only where a
     direction is better: the EPA columns, and for a defence the less it
     allows. Pace, pass rate, PROE and blitz rate are styles, not scores;
     they sort (most first) and carry no rank, since "1st" would say
     "best" of a thing that is neither better nor worse. */
  const COLUMNS = [
    { key: "team", head: "Team", side: null, sort: true },
    { key: "playsPerGame", head: "Plays/g", side: "off", fmt: (v) => (v == null ? "—" : Math.round(v)), hi: true, sort: true, title: "Offensive plays a game" },
    { key: "passRate", head: "Pass", side: "off", fmt: pct, hi: true, sort: true, title: "Share of plays that are dropbacks" },
    { key: "proe", head: "PROE", side: "off", fmt: pts, hi: true, sort: true, title: "Pass rate over expectation, in points" },
    { key: "epaPerPlay", head: "EPA/play", side: "off", fmt: epa, hi: true, sort: true, rank: true, title: "Expected points added per offensive play" },
    { key: "epaPerPass", head: "EPA/pass", side: "off", fmt: epa, hi: true, sort: true, rank: true },
    { key: "epaPerRush", head: "EPA/rush", side: "off", fmt: epa, hi: true, sort: true, rank: true },
    { key: "offLeans", head: "Offence leans", side: null },
    { key: "defEpaPerPlay", head: "Allows/play", side: "def", metric: "epaPerPlay", fmt: epa, hi: false, sort: true, rank: true, title: "EPA allowed per play; lower is the better defence" },
    { key: "defEpaPerPass", head: "Allows/pass", side: "def", metric: "epaPerPass", fmt: epa, hi: false, sort: true, rank: true },
    { key: "defEpaPerRush", head: "Allows/rush", side: "def", metric: "epaPerRush", fmt: epa, hi: false, sort: true, rank: true },
    { key: "blitzRate", head: "Blitz", side: "def", metric: "blitzRate", fmt: pct, hi: true, sort: true, title: "How often the defence blitzes" },
    { key: "defSpots", head: "Defence", side: null },
  ];

  /** One row per team: the numbers, their ranks, and the family tags. */
  function rows(data, core) {
    if (!data || !data.current || !data.current.off || !data.current.def || !data.current.league || !core) return [];
    const off = data.current.off, def = data.current.def, lg = data.current.league;
    const teams = Object.keys(off).filter((t) => off[t] && def[t]).sort();
    const ranks = {};
    for (const c of COLUMNS) if (c.rank) ranks[c.key] = core.rank(c.side === "off" ? off : def, c.metric || c.key, { higherIsBetter: !!c.hi });
    return teams.map((t) => {
      /* `field` is how many teams a rank is out of: the core ranks only those with a number. */
      const r = { team: t, rank: {}, field: {}, offLeans: [], defSpots: [] };
      for (const c of COLUMNS) if (c.side) {
        r[c.key] = (c.side === "off" ? off[t] : def[t])[c.metric || c.key];
        if (r[c.key] == null) r[c.key] = null;
        if (c.rank) { r.rank[c.key] = ranks[c.key][t] || null; r.field[c.key] = Object.keys(ranks[c.key]).length; }
      }
      /* The offence against the league's defence profile is its own leans; the
         defence against the league's offence is its own soft spots. */
      for (const e of core.matchup(off[t], null, lg)) if (!e.defsCall && e.lean != null) {
        if (e.lean >= core.LEAN_SHARE) r.offLeans.push({ family: e.family, dir: "lean" });
        else if (e.lean <= -core.LEAN_SHARE) r.offLeans.push({ family: e.family, dir: "avoid" });
      }
      for (const e of core.matchup(null, def[t], lg)) if (e.edge != null) {
        if (e.edge >= core.SOFT_EPA) r.defSpots.push({ family: e.family, dir: "soft" });
        else if (e.edge <= -core.SOFT_EPA) r.defSpots.push({ family: e.family, dir: "stout" });
      }
      return r;
    });
  }

  /** The rows sorted by a column: best first by the column's own direction; a null value last; the team column alphabetical. */
  function sorted(list, key) {
    const c = COLUMNS.find((x) => x.key === key) || COLUMNS[0];
    const out = list.slice();
    if (!c.side) return out.sort((a, b) => a.team.localeCompare(b.team));
    return out.sort((a, b) => {
      const va = a[key], vb = b[key];
      if (va == null && vb == null) return a.team.localeCompare(b.team);
      if (va == null) return 1; if (vb == null) return -1;
      return (c.hi ? vb - va : va - vb) || a.team.localeCompare(b.team);
    });
  }

  const ord = (n) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

  /** The table's markup for a sort key. `helpers`: faces/teams modules and the league, all optional. */
  function tableHtml(list, key, helpers) {
    const h = helpers || {}, F = h.faces || null, T = h.teams || null, league = h.league || "NFL";
    const mark = (t) => (F ? F.mark(league, t, 22) : "");
    const edge = (t) => { const c = T ? T.paint(league, t) : null; return c ? ' style="border-left-color:' + esc(c) + '"' : ""; };
    const chip = (x) => '<span class="tag ' + (x.dir === "soft" ? "soft" : x.dir === "stout" ? "tough" : "lean") + '">' + esc(x.family) + " · " + esc(x.dir === "lean" ? "leans in" : x.dir === "avoid" ? "avoids" : x.dir) + "</span>";
    let html = '<table class="teams"><thead><tr>';
    /* A sortable column's head is a button; the chip columns' heads are plain text, since there is nothing to sort them by. */
    for (const c of COLUMNS) html += '<th' + (c.side ? ' class="r"' : "") + (c.title ? ' title="' + esc(c.title) + '"' : "") + '>' +
      (c.sort ? '<button type="button" data-sort="' + c.key + '" aria-pressed="' + (c.key === key) + '">' + esc(c.head) + "</button>" : '<span>' + esc(c.head) + "</span>") + "</th>";
    html += "</tr></thead><tbody>";
    for (const r of sorted(list, key)) {
      /* The colour edge and the stickiness ride the team cell, which stays in view while the panel scrolls sideways. */
      html += '<tr><td class="tm"' + edge(r.team) + '>' + mark(r.team) + "<b>" + esc(r.team) + "</b></td>";
      for (const c of COLUMNS) {
        if (c.key === "team") continue;
        if (c.key === "offLeans" || c.key === "defSpots") { html += '<td class="chips">' + (r[c.key].length ? r[c.key].map(chip).join("") : '<span class="none">—</span>') + "</td>"; continue; }
        const rk = c.rank ? r.rank[c.key] : null;
        html += '<td class="r"><b>' + esc(c.fmt(r[c.key])) + "</b>" + (rk ? '<small>' + ord(rk) + (r.field[c.key] && r.field[c.key] !== list.length ? " of " + r.field[c.key] : "") + "</small>" : "") + "</td>";
      }
      html += "</tr>";
    }
    return html + "</tbody></table>";
  }

  /** The caveat under the table: what the numbers are and are not. The thresholds are the core's, never re-typed. */
  function footHtml(data, core) {
    /* A bad week or K is left out like a missing one, never printed as NaN. */
    const num = (v) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
    const w = num(data && data.through && data.through.week), K = num(data && data.K);
    const lean = core ? Math.round(100 * core.LEAN_SHARE) : null, soft = core ? core.SOFT_EPA : null;
    return "<p>What each offence does and what each defence gives up, from nflverse play-by-play" + (w != null ? " through week " + w : "") +
      (K != null ? ", each rate regressed toward last season by " + K + " games" : "") +
      ". A rank under an EPA figure is the team's place among the teams with one, 1 the best (and \"of N\" when fewer than all have one); pace, pass rate, PROE and blitz rate are styles, sorted most first and ranked by nobody. " +
      (core ? "The chips are the matchup panel's: an offence <b>leans in</b> to a family it uses " + lean + " points more than the league and <b>avoids</b> one it uses less; a defence is <b>soft</b> where it allows " + soft + " EPA a play more than the league and <b>stout</b> where it allows less. " : "") +
      "Descriptive: nothing here is in a price yet.</p>";
  }

  /* Render into the page: the table into #teams, the caveat into #tfoot,
     and a click on a column head re-sorts. */
  function render(doc, opts) {
    const o = opts || {}, host = doc.getElementById("teams"), foot = doc.getElementById("tfoot");
    if (!host) return;
    const core = o.core || null, data = o.data || null;
    const list = rows(data, core);
    if (foot) foot.innerHTML = footHtml(data, core);
    if (!list.length) { host.innerHTML = '<div class="empty"><div class="big">No team profiles</div><div>Run <code>node tendencies.mjs</code> to build them.</div></div>'; return; }
    /* One listener per host however often render runs; the sort key lives on the host. */
    host.__sort = o.sort || host.__sort || "epaPerPlay";
    const draw = () => { host.innerHTML = tableHtml(list, host.__sort, o); };
    draw();
    if (host.addEventListener && !host.__sorting) {
      host.__sorting = true;
      host.addEventListener("click", (e) => {
        const b = e.target && e.target.closest ? e.target.closest("[data-sort]") : null;
        if (!b) return;
        host.__sort = b.getAttribute("data-sort"); draw();
      });
    }
  }

  return { COLUMNS, rows, sorted, tableHtml, footHtml, render };
});
