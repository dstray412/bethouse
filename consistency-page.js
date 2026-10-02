/* consistency-page.js — the consistency cards: for each prop at a
 * standard line, who cleared it most often in his last ten games.
 *
 * The board's data file carries each player's last ten game lines
 * (`recent`: date, opponent, receiving yards, receptions, rushing
 * yards, passing yards, touchdowns), so the count is made here from
 * the same rows the drawer's recent-games tab shows, through the
 * model's own recentHits. A card a rung the board prices (anytime touchdown;
 * 50, 70 and 100 receiving yards; 4 and 6 receptions; 50, 70 and 100
 * rushing yards; 70 and 100 rush + rec; 250 and 300 passing yards): the players
 * ranked by hits, most first, a bar for the share, 60% and up, fifteen
 * a card. A player needs ten games on file, a game this week and no Out
 * status. Descriptive: a hit count is not a chance; the model's chance
 * for the game is on the board.
 *
 * Pure in the way record-page.js is: `hits`/`rows` are arithmetic over
 * the data file, `cardHtml` is markup, `render` writes two containers.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BetHouseConsistency = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const N = 10, FLOOR = 6, SHOWN = 15;

  /* The rungs: a line the board itself prices (every one is on the
     model's ladder, nfl.js LADDERS, so the chance the caveat points at
     exists), each with the stat the model's recentHits reads. */
  const RUNGS = [
    { id: "td", stat: "td", rung: 1, label: "Anytime TD" },
    { id: "recyds50", stat: "recyds", rung: 50, label: "50+ receiving yards" },
    { id: "recyds70", stat: "recyds", rung: 70, label: "70+ receiving yards" },
    { id: "recyds100", stat: "recyds", rung: 100, label: "100+ receiving yards" },
    { id: "recs4", stat: "recs", rung: 4, label: "4+ receptions" },
    { id: "recs6", stat: "recs", rung: 6, label: "6+ receptions" },
    { id: "rushyds50", stat: "rushyds", rung: 50, label: "50+ rushing yards" },
    { id: "rushyds70", stat: "rushyds", rung: 70, label: "70+ rushing yards" },
    { id: "rushyds100", stat: "rushyds", rung: 100, label: "100+ rushing yards" },
    { id: "rushrec70", stat: "rushrec", rung: 70, label: "70+ rush + rec yards" },
    { id: "rushrec100", stat: "rushrec", rung: 100, label: "100+ rush + rec yards" },
    { id: "passyds250", stat: "passyds", rung: 250, label: "250+ passing yards" },
    { id: "passyds300", stat: "passyds", rung: 300, label: "300+ passing yards" },
  ];

  /** Hits in the player's last ten games on file, or null without a log. A touchdown is the model's own count. */
  function hits(model, p, r) {
    const rec = p && Array.isArray(p.recent) ? p.recent.slice(0, N) : null;
    if (!rec || !rec.length) return null;
    if (r.stat === "td") return model.recentTdHits(rec);
    return model.recentHits(r.stat, rec, r.rung);
  }

  /** The year a row's YYMMDD date falls in. */
  const yearOf = (d) => { const s = String(d == null ? "" : d); return /^\d{6}$/.test(s) ? 2000 + Number(s.slice(0, 2)) : null; };

  /**
   * The card's rows for a rung: who qualifies, most hits first then by
   * name, the floor and the cap applied. Each row carries what the count
   * is not: how many of the ten were last season (`prev`), how many he
   * played for another team (`away`, from the row's own team column,
   * written since 2026-10-02; an older file reads 0), and whether he is
   * Questionable.
   */
  function rows(model, players, r, season, limit) {
    const out = [];
    for (const p of players || []) {
      if (!p || !p.opp || !Array.isArray(p.recent) || p.recent.length < N) continue;
      const avail = model.availability ? model.availability(p.status) : "ok";
      if (avail === "out") continue;
      const h = hits(model, p, r);
      if (h == null || h < FLOOR) continue;
      const rec = p.recent.slice(0, N);
      const prev = season != null ? rec.filter((x) => { const y = yearOf(x[0]); return y != null && y < Number(season); }).length : 0;
      const away = rec.filter((x) => x[7] != null && x[7] !== p.team).length;
      out.push({ id: p.id, name: p.name, team: p.team, opp: p.opp, hits: h, n: N, pct: Math.round((100 * h) / N), prev, away, q: avail === "questionable" });
    }
    return out.sort((a, b) => b.hits - a.hits || String(a.name).localeCompare(String(b.name))).slice(0, limit > 0 ? limit : SHOWN);
  }

  /* The home's strip: one card a scoring family (touchdown, receiving,
     rushing), each at the family's lowest rung so the three cards do not
     count the same yards twice; five a card, the same card markup; ""
     with nobody. */
  const HOME_RUNGS = ["td", "recyds50", "rushyds50"];
  function stripHtml(model, data, helpers) {
    if (!model || !data || !Array.isArray(data.players)) return "";
    const cards = HOME_RUNGS.map((id) => RUNGS.find((r) => r.id === id)).filter(Boolean)
      .map((r) => { const list = rows(model, data.players, r, data.season, 5); return list.length ? cardHtml(r, list, helpers) : ""; }).filter(Boolean);
    return cards.join("");
  }

  const tier = (pct) => (pct >= 80 ? "good" : pct >= 70 ? "warn" : "low");

  /** One rung's card; with nobody on it, the card says so rather than vanishing. */
  function cardHtml(r, list, helpers) {
    const h = helpers || {}, F = h.faces || null, league = h.league || "NFL";
    const mark = (t) => (F ? F.mark(league, t, 18) : "");
    let html = '<section class="ccard"><header><h3>' + esc(r.label) + "</h3><small>consistency · last " + N + " games on file, this season and last</small></header>";
    if (!list || !list.length) return html + '<p class="cnone">Nobody at six hits or better.</p></section>';
    html += "<ol>";
    list.forEach((x, i) => {
      const t = tier(x.pct);
      const notes = [esc(x.team) + " vs " + esc(x.opp)];
      if (x.prev) notes.push(x.prev + " last season");
      if (x.away) notes.push(x.away + " for another team");
      html += '<li><span class="n">' + (i + 1) + '</span><span class="who">' + mark(x.team) + "<b>" + esc(x.name) + (x.q ? '<span class="tag q" title="Questionable on the report">Q</span>' : "") + "</b><small>" + notes.join(" · ") + "</small></span>" +
        '<b class="hits ' + t + '">' + x.hits + "/" + x.n + '</b><span class="bar"><i style="width:' + x.pct + '%"></i></span><span class="pct ' + t + '">' + x.pct + "%</span></li>";
    });
    return html + "</ol></section>";
  }

  function footHtml(data) {
    const w = data && data.week != null ? data.week : null, s = data && data.season != null ? data.season : null;
    return "<p>Hits in each player's last ten games on file, this season and last" + (s != null && w != null ? ", before week " + esc(w) + " of " + esc(s) : "") +
      ", at a line the board prices: a game at or over the line is a hit, a touchdown game is one or more. A game he dressed for without a touch or a target leaves no line, so the ten are his last ten with one. " +
      "Each row says how many of the ten were last season and how many he played for another team; <b>Q</b> marks a player Questionable on the report. A player needs ten games, a game this week and no Out status to be listed; 60% and up, fifteen a card, most hits first. " +
      "Descriptive: a hit count is not a chance, and the chance the model gives him this week, against this opponent, is on the <a href=\"nfl.html\">NFL board</a>, at this line, in his drawer.</p>";
  }

  function render(doc, opts) {
    const o = opts || {}, host = doc.getElementById("cons"), foot = doc.getElementById("cfoot");
    if (!host) return;
    const data = o.data || null, model = o.model || null;
    const ok = !!(data && model && Array.isArray(data.players));
    if (foot) foot.innerHTML = ok ? footHtml(data) : "";
    if (!ok) { host.innerHTML = '<div class="empty"><div class="big">No board</div><div>The NFL data file did not load.</div></div>'; return; }
    const cards = RUNGS.map((r) => cardHtml(r, rows(model, data.players, r, data.season), o));
    host.innerHTML = cards.join("");
  }

  return { RUNGS, HOME_RUNGS, N, FLOOR, SHOWN, hits, rows, tier, cardHtml, stripHtml, footHtml, render };
});
