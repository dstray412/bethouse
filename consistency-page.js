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
 * status. The reader can pick a prop and any line the board prices
 * (the model's ladder) and see everyone at that one rung; the pick
 * rides the URL. Descriptive: a hit count is not a chance; the model's
 * chance for the game is on the board.
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
    return out.sort((a, b) => b.hits - a.hits || String(a.name).localeCompare(String(b.name))).slice(0, limit > 0 ? limit : SHOWN); // Infinity is no cap
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

  /* ---- choosing the prop and the line ----
     The props are the model's stats plus the touchdown; the lines the
     model's own ladder for that stat, so a picked rung is always one the
     board prices. "all" is the overview: the thirteen standard cards. */
  const PROP_LABEL = { td: "Anytime TD", recyds: "Receiving yards", recs: "Receptions", rushyds: "Rushing yards", rushrec: "Rush + rec yards", passyds: "Passing yards" };
  const PROP_ORDER = ["td", "recyds", "recs", "rushyds", "rushrec", "passyds"];
  /* A picked line lists everyone at six hits or better: the pick is the page, so there is no further page to send the cut to. */
  function props(model) {
    const have = PROP_ORDER.filter((id) => id === "td" || (model && model.STATS && model.STATS[id]));
    return [{ id: "all", label: "Overview" }].concat(have.map((id) => ({ id, label: PROP_LABEL[id] })));
  }
  function lines(model, prop) {
    if (prop === "td") return [1];
    const l = model && model.LADDERS && model.LADDERS[prop];
    return Array.isArray(l) ? l.slice() : [];
  }
  /** The rung for a prop and a line the model prices, or null. */
  function rungFor(model, prop, line) {
    const n = Number(line);
    if (!lines(model, prop).includes(n)) return null;
    if (prop === "td") return RUNGS[0];
    const word = prop === "recs" ? "receptions" : prop === "rushrec" ? "rush + rec yards" : PROP_LABEL[prop].toLowerCase();
    return { id: prop + n, stat: prop, rung: n, label: n + "+ " + word };
  }
  /** The two segmented controls, the pressed prop and (for a picked prop) its lines. */
  function controlsHtml(model, state) {
    const s = state || { prop: "all", line: null };
    /* The board's own pattern for a segmented control: a labelled group, so a reader on a screen reader hears which strip he is in. */
    let html = '<div class="ctl"><label id="lab-cprop">Prop</label><div class="seg" id="cprops" role="group" aria-labelledby="lab-cprop">' +
      props(model).map((p) => '<button type="button" data-prop="' + esc(p.id) + '" aria-pressed="' + (p.id === s.prop) + '">' + esc(p.label) + "</button>").join("") + "</div></div>";
    if (s.prop !== "all") html += '<div class="ctl"><label id="lab-cline">Line</label><div class="seg" id="clines" role="group" aria-labelledby="lab-cline">' +
      lines(model, s.prop).map((n) => '<button type="button" data-line="' + esc(n) + '" aria-pressed="' + (n === Number(s.line)) + '">' + esc(n) + "+</button>").join("") + "</div></div>";
    return html;
  }
  /** A state the page can render, or the overview: the prop must be one the page offers (a labelled stat with a ladder), the line one on its ladder. The validation boundary for the URL. */
  function cleanState(model, state) {
    const s = state || {};
    const prop = typeof s.prop === "string" ? s.prop : "";
    if (!prop || prop === "all" || !props(model).some((p) => p.id === prop)) return { prop: "all", line: null };
    const ls = lines(model, prop);
    if (!ls.length) return { prop: "all", line: null };
    if (s.line == null || s.line === "" || ls.length === 1) return { prop, line: ls[0] }; // a prop just picked, or a link without a line, starts at its lowest; a one-rung prop has no other
    const n = Number(s.line);
    return ls.includes(n) ? { prop, line: n } : { prop: "all", line: null }; // a line the model does not price is the overview, not a guess
  }

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

  function footHtml(data, picked) {
    const w = data && data.week != null ? data.week : null, s = data && data.season != null ? data.season : null;
    return "<p>Hits in each player's last ten games on file, this season and last" + (s != null && w != null ? ", before week " + esc(w) + " of " + esc(s) : "") +
      ", at a line the board prices: a game at or over the line is a hit, a touchdown game is one or more. A game he dressed for without a touch or a target leaves no line, so the ten are his last ten with one. " +
      "Each row says how many of the ten were last season and how many he played for another team; <b>Q</b> marks a player Questionable on the report. A player needs ten games, a game this week and no Out status to be listed; 60% and up, most hits first" + (picked ? ", everyone at that line" : ", fifteen a card on the overview") + ". " +
      "Descriptive: a hit count is not a chance, and the chance the model gives him this week, against this opponent, is on the <a href=\"nfl.html\">NFL board</a>, at this line, in his drawer.</p>";
  }

  /* Render: the controls into #ccontrols (one listener per host however
     often render runs; the pick lives on the host), the cards into #cons
     (the overview's thirteen, or the one picked rung at thirty rows),
     the caveat into #cfoot. `opts.state` sets the pick; `opts.onState`
     hears a change, so the page can write it to the URL. */
  function render(doc, opts) {
    const o = opts || {}, host = doc.getElementById("cons"), foot = doc.getElementById("cfoot"), ctl = doc.getElementById("ccontrols");
    if (!host) return;
    const data = o.data || null, model = o.model || null;
    const ok = !!(data && model && Array.isArray(data.players));
    if (!ok) { if (ctl) { ctl.innerHTML = ""; ctl.hidden = true; } if (foot) foot.innerHTML = ""; host.innerHTML = '<div class="empty"><div class="big">No board</div><div>The NFL data file did not load.</div></div>'; return; }
    const given = o.state || (ctl && ctl.__state) || null;
    const state = cleanState(model, given);
    if (ctl) ctl.__state = state;
    /* The latest payload and callback live on the host, so the one listener always draws from the current render, never a stale first one. */
    const draw = () => {
      const s = (ctl && ctl.__state) || state;
      if (ctl) { ctl.innerHTML = controlsHtml(model, s); ctl.hidden = false; }
      if (s.prop === "all") host.innerHTML = RUNGS.map((r) => cardHtml(r, rows(model, data.players, r, data.season), o)).join("");
      else { const r = rungFor(model, s.prop, s.line); host.innerHTML = cardHtml(r, rows(model, data.players, r, data.season, Infinity), o); }
      if (foot) foot.innerHTML = footHtml(data, s.prop !== "all");
    };
    if (ctl) { ctl.__draw = draw; ctl.__on = typeof o.onState === "function" ? o.onState : null; ctl.__model = model; }
    draw();
    /* A pick the page could not render was cleaned to something it could: tell the caller, so the URL says what the page shows. */
    if (given && typeof o.onState === "function" && (given.prop !== state.prop || (state.prop !== "all" && Number(given.line) !== state.line))) o.onState(state);
    if (ctl && ctl.addEventListener && !ctl.__picking) {
      ctl.__picking = true;
      ctl.addEventListener("click", (e) => {
        const t = e.target, bp = t && t.closest ? t.closest("[data-prop]") : null, bl = t && t.closest ? t.closest("[data-line]") : null;
        if (!bp && !bl) return;
        const cur = ctl.__state || { prop: "all", line: null }, m = ctl.__model || model;
        const next = bp ? cleanState(m, { prop: bp.getAttribute("data-prop"), line: null }) : cleanState(m, { prop: cur.prop, line: bl.getAttribute("data-line") });
        ctl.__state = next;
        if (ctl.__draw) ctl.__draw();
        if (ctl.__on) ctl.__on(next);
      });
    }
  }

  return { RUNGS, HOME_RUNGS, N, FLOOR, SHOWN, hits, rows, tier, props, lines, rungFor, cleanState, controlsHtml, cardHtml, stripHtml, footHtml, render };
});
