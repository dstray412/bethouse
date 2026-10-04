/*
 * parlay-page.js — the prop parlay page (parlays.html).
 *
 * Every leg here is a line the book sells as "N+": a rung on the model's
 * own ladder (20+ receiving yards, 4+ receptions, 50+ rushing yards) or
 * an anytime touchdown. Never an over/under at the projection: the user
 * does not bet those, and the board's own slip already does. For each
 * player and stat the leg is the HIGHEST rung the model gives at least
 * the chosen floor, priced by nfl.js's ladder off the same pool the
 * board prices the drawer's alternate lines from, so this page and the
 * board cannot disagree about a number.
 *
 * Beside each leg, three measured facts, none of them the chance: how
 * many of his last ten games on file cleared that rung (the consistency
 * page's own count); whether the opponent is a soft spot on the cheat
 * sheet for that stat (top five of the field, by his position); and
 * what the record did at that rung (the tracker's rung table: what the
 * model said and what hit, 15+ graded calls). The consistency floor and
 * the soft-defence switch are filters the user sets; the slip is then
 * parlay.js's, ranked by chance to cash, with the replay's measured
 * lifts for correlated legs. Nothing here can see a price: the fair
 * price is printed and the user types what the book offers.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.BetHouseParlayPage = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pct = (p, d) => (100 * p).toFixed(d == null ? 0 : d) + "%";
  const sgn = (n) => (n > 0 ? "+" : "") + n;
  const ord = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th");

  const N10 = 10, MIN_GRADED = 15, LISTED = 10, SOFT = 5;
  const LEGS = [2, 3, 4, 5, 6];
  const FLOORS = [0.6, 0.7, 0.8, 0.9];
  const SCOPES = [{ id: "slate", label: "One leg a game" }, { id: "players", label: "Any games" }];
  const HITS = [{ id: 0, label: "Any" }, { id: 6, label: "6 of 10" }, { id: 8, label: "8 of 10" }];
  const FAMILIES = [
    { id: "td", label: "Anytime TD" }, { id: "recyds", label: "Receiving yards" }, { id: "recs", label: "Receptions" },
    { id: "rushyds", label: "Rushing yards" }, { id: "rushrec", label: "Rush + rec yards" }, { id: "passyds", label: "Passing yards" },
  ];
  /* The families on by default: every counting prop. The touchdown has one rung and sits at 20–45%, so it is a family the user
     switches on knowing it, not one that drags a slip of 85% legs by default. */
  const DEFAULT_FAMS = FAMILIES.map((f) => f.id).filter((id) => id !== "td");
  const famLabel = (id) => (FAMILIES.find((f) => f.id === id) || { label: id }).label;
  /* The cheat-sheet line a stat reads, by the player's position: what the opponent's defence allows to players like him. */
  const SHEET_KEYS = {
    recyds: { WR: ["recYdsWR"], TE: ["recYdsTE"], RB: ["recYdsRB"], "*": [] },
    recs: { WR: ["recsWR"], TE: ["recsTE"], RB: ["recsRB"], "*": [] },
    rushyds: { "*": ["rushYds"] },
    passyds: { "*": ["passYds"] },
    rushrec: { WR: ["rushYds", "recYdsWR"], TE: ["rushYds", "recYdsTE"], RB: ["rushYds", "recYdsRB"], "*": ["rushYds"] },
    td: { RB: ["rushTd", "recTdRB"], WR: ["recTdWR"], TE: ["recTdTE"], QB: ["rushTd"], "*": [] },
  };

  /** The opponent's soft spot for this stat and position: the best-ranked of the lines the stat reads, top five only; null otherwise. */
  function sheetLine(sheet, opp, stat, pos) {
    const t = sheet && sheet.teams && sheet.teams[opp], stats = sheet && sheet.stats, map = SHEET_KEYS[stat];
    if (!t || !stats || !map) return null;
    const keys = map[pos] || map["*"];
    let best = null;
    for (const key of keys) {
      const c = t[key], st = stats[key];
      if (!c || !st || !(c.rank >= 1) || c.rank > SOFT) continue;
      /* `of` only when the line was ranked among fewer than the field, as the sheet prints it. */
      if (!best || c.rank < best.rank) best = { key, label: st.label, rank: c.rank, of: c.of != null && sheet.field != null && c.of !== sheet.field ? c.of : null, v: c.v, n: c.n, one: c.n === 1 };
    }
    return best;
  }

  /** What the record did at this rung: the rung table for a stat, the props band for a touchdown's chance; 15+ graded calls, else null. */
  function recordFor(record, stat, rung, prob) {
    if (!record) return null;
    if (stat === "td") {
      const pr = record.props && record.props.td, bands = pr && pr.bands;
      if (!bands) return null;
      const x = Math.min(100 * Number(prob), 99.999);
      for (const b of bands) if (x >= Number(b.lo) && x < Number(b.lo) + 10 && Number(b.n) >= MIN_GRADED) return { lo: Number(b.lo), said: Number(b.predicted), hit: Number(b.actual), n: Number(b.n) };
      return null;
    }
    const s = record.ladder && record.ladder.stats && record.ladder.stats[stat], rows = s && s.rungs;
    if (!rows) return null;
    const r = rows.find((x) => Number(x.rung) === Number(rung));
    return r && Number(r.n) >= MIN_GRADED ? { said: Number(r.predicted), hit: Number(r.actual), n: Number(r.n) } : null;
  }

  const propLabel = (model, stat, rung) => (stat === "td" ? "Anytime TD" : rung + "+ " + String(model.STATS[stat].label).toLowerCase());

  /**
   * Every leg the page can offer: for each player on an open game and
   * each stat he is in the business of, the highest rung the model gives
   * at least `floor`; the touchdown at its own chance, since it has one
   * rung and the floor picks a rung. The gates are the board's own
   * (ruled out, no opponent, game played).
   */
  function legs(model, data, record, opts) {
    const o = opts || {}, now = o.now != null ? o.now : Date.now(), floor = o.floor != null ? Number(o.floor) : 0.7;
    if (!model || !data || !Array.isArray(data.players)) return [];
    const gameOf = {};
    for (const g of data.games || []) { if (g) { gameOf[g.home] = g; gameOf[g.away] = g; } }
    const open = (team) => { const g = gameOf[team]; return g && !g.completed && Date.parse(g.date) > now ? g : null; };
    const TF = data.teamFactors || {}, pools = data.pools || {}, usagePool = data.usagePool && data.usagePool.length ? data.usagePool : null;
    const scriptCache = {};
    const scriptOf = (team) => {
      if (scriptCache[team] != null) return scriptCache[team];
      scriptCache[team] = scriptRaw(team); return scriptCache[team];
    };
    const scriptRaw = (team) => {
      const g = gameOf[team];
      if (!g || !data.ratings || !(data.ratings.league > 0) || typeof model.projectGame !== "function") return 1;
      const pr = model.projectGame(data.ratings, g.home, g.away, { neutral: !!g.neutral, wind: g.wind, indoor: !!g.indoor });
      if (!pr) return 1;
      const pts = team === g.home ? pr.homePts : pr.awayPts;
      return isFinite(pts) && pts > 0 ? pts / data.ratings.league : 1;
    };
    const out = [];
    for (const p of data.players) {
      if (!p || !p.opp || !p.team) continue;
      if (model.availability(p.status) === "out") continue;
      const g = open(p.team); if (!g) continue;
      const vacRec = p.vac ? p.vac.r : undefined, vacRush = p.vac ? p.vac.c : undefined;
      const rec = Array.isArray(p.recent) && p.recent.length >= N10 ? p.recent.slice(0, N10) : null;
      const leg = (stat, rung, prob) => ({
        key: g.id + "|" + p.id + "|" + stat, playerId: String(p.id), gameId: String(g.id), team: p.team, opp: p.opp, name: p.name, pos: p.pos || "", prop: stat, rung, prob,
        propLabel: propLabel(model, stat, rung),
        hits: rec ? { hits: stat === "td" ? model.recentTdHits(rec) : model.recentHits(stat, rec, rung), n: N10 } : null,
        sheet: sheetLine(data.defence, p.opp, stat, p.pos),
        rec: record ? recordFor(record, stat, rung, prob) : undefined, // undefined: no record file at all; null: under 15 calls

      });
      const s = model.scoreAnytimeTD(p, { teamFactor: (TF[p.team] || {}).off || 1, oppFactor: (TF[p.opp] && isFinite(TF[p.opp].def)) ? TF[p.opp].def : 1, usagePool, scriptFactor: scriptOf(p.team), vacRec, vacRush });
      if (s && isFinite(s.prob) && s.prob > 0) out.push(leg("td", 1, s.prob));
      for (const stat of Object.keys(model.STATS)) {
        const pool = pools[stat]; if (!pool || !model.poolSize(pool)) continue;
        const y = model.statEligible(stat, p, null, { oppFactor: model.allowOf(TF, p.opp, stat), vacRec, vacRush }); if (!y) continue;
        const rungs = model.ladder(stat, y.exp, pool).filter((r) => r.prob >= floor);
        if (!rungs.length) continue;
        const top = rungs[rungs.length - 1]; // the ladder climbs, so the last rung clearing the floor is the highest
        out.push(leg(stat, top.at, top.prob));
      }
    }
    return out;
  }

  /** The user's filters: the families on, the consistency floor (a leg without ten games fails any floor), the soft-defence switch. */
  function filter(list, state) {
    const s = cleanState(state);
    return (list || []).filter((l) => s.fams.includes(l.prop) && (s.hits === 0 || (l.hits && l.hits.hits >= s.hits)) && (!s.soft || !!l.sheet));
  }

  /** The state, cleaned: every value one the controls offer, or its default. The validation boundary for the URL. */
  function cleanState(state) {
    const s = state || {}, all = FAMILIES.map((f) => f.id);
    const legsN = Number(s.legs), floor = Number(s.floor), hits = Number(s.hits);
    let fams = Array.isArray(s.fams) ? s.fams : typeof s.fams === "string" ? s.fams.split(",") : DEFAULT_FAMS;
    fams = all.filter((id) => fams.includes(id));
    return {
      legs: LEGS.includes(legsN) ? legsN : 3,
      scope: SCOPES.some((x) => x.id === s.scope) ? s.scope : "slate",
      floor: FLOORS.includes(floor) ? floor : 0.7,
      hits: HITS.some((x) => x.id === hits) ? hits : 6,
      soft: s.soft === true || s.soft === "1" || s.soft === 1,
      fams: fams.length ? fams : DEFAULT_FAMS.slice(),
    };
  }

  const seg = (id, label, buttons) => '<div class="ctl"><label id="lab-' + id + '">' + esc(label) + '</label><div class="seg" id="' + id + '" role="group" aria-labelledby="lab-' + id + '">' + buttons + "</div></div>";
  const btn = (attr, val, on, label) => '<button type="button" data-' + attr + '="' + esc(val) + '" aria-pressed="' + (on ? "true" : "false") + '">' + esc(label) + "</button>";
  function controlsHtml(state) {
    const s = cleanState(state);
    return seg("pcount", "Legs", LEGS.map((n) => btn("legs", n, n === s.legs, n)).join("")) +
      seg("pscope", "From", SCOPES.map((x) => btn("scope", x.id, x.id === s.scope, x.label)).join("")) +
      seg("pfloor", "Each leg at least", FLOORS.map((f) => btn("floor", f, f === s.floor, Math.round(100 * f) + "%+")).join("")) +
      seg("phits", "Cleared it in his last ten", HITS.map((h) => btn("hits", h.id, h.id === s.hits, h.label)).join("")) +
      seg("psoft", "Opponent", btn("soft", "1", s.soft, "Soft defence only")) +
      seg("pfams", "Props", FAMILIES.map((f) => btn("fam", f.id, s.fams.includes(f.id), f.label)).join(""));
  }

  /* The three facts beside a leg, each in words that say what it is and is not. */
  function evidence(l) {
    const out = [];
    const what = l.prop === "td" ? "scored" : "at " + l.rung + "+";
    out.push(l.hits ? l.hits.hits + " of his last " + l.hits.n + " " + what : "no ten-game log on file");
    out.push(l.sheet ? esc(l.opp) + " allows the " + esc(ord(Number(l.sheet.rank))) + "-most " + esc(l.sheet.label) + (l.sheet.of != null ? " of " + esc(l.sheet.of) : "") + (l.sheet.one ? " (one game)" : "") : esc(l.opp) + " is not a soft spot on the sheets for this");
    if (l.rec === undefined) out.push("no record on file");
    else if (l.rec) out.push(l.prop === "td" ? "at " + l.rec.lo + "–" + (l.rec.lo + 10) + "% the record said " + Math.round(l.rec.said) + "% and hit " + Math.round(l.rec.hit) + "% of " + l.rec.n
      : "at " + l.rung + "+ the record said " + Math.round(l.rec.said) + "% and hit " + Math.round(l.rec.hit) + "% of " + l.rec.n);
    else out.push(l.prop === "td" ? "the record has under " + MIN_GRADED + " graded calls at this chance" : "the record has under " + MIN_GRADED + " graded calls at " + l.rung + "+");
    return out;
  }

  function legLine(l, helpers) {
    const h = helpers || {}, F = h.faces || null, league = h.league || "NFL";
    const face = F ? F.face(league, l.playerId, 24) : "";
    return '<div class="leg"><div>' + face + esc(l.name) + ' <span class="lp">' + esc(l.team) + " vs " + esc(l.opp) + " · " + esc(l.propLabel) + '</span></div><div><span class="lp">' + pct(l.prob, 0) + "</span></div></div>" +
      '<div class="leg-line"><span>' + evidence(l).join(" · ") + "</span></div>";
  }

  /**
   * The slip: the best leg of each prop family in turn (the families in
   * the order of their best leg), one a game from the slate or one a
   * player from any games, until the legs are filled; a second pass takes
   * each family's next leg. In turn, because a chance is only comparable
   * within a family: the rungs step by one catch and by ten yards, so a
   * list ranked by raw chance is a list of whichever ladder's step lands
   * highest (2+ receptions, at a 70% floor). Only props the replay has
   * measured in a parlay (`opts.eligible`, the model's parlayProps) go in;
   * the rest are listed and named as kept out. Null when the legs cannot
   * be filled. The arithmetic is parlay.js's combineLegs with the lifts.
   */
  function buildSlip(list, state, opts) {
    const o = opts || {}, s = cleanState(state), P = o.parlay;
    if (!P || typeof P.combineLegs !== "function") return null;
    const usable = (list || []).filter((l) => l && l.prob > 0 && l.prob <= 1);
    const inSlip = (id) => !Array.isArray(o.eligible) || o.eligible.includes(id);
    const skipped = s.fams.filter((id) => !inSlip(id) && usable.some((l) => l.prop === id));
    const byProb = (a, b) => b.prob - a.prob || String(a.name).localeCompare(String(b.name));
    const queues = s.fams.filter(inSlip).map((id) => usable.filter((l) => l.prop === id).sort(byProb)).filter((q) => q.length).sort((a, b) => byProb(a[0], b[0]));
    const who = (l) => (s.scope === "players" ? String(l.playerId) : String(l.gameId));
    const seen = new Set(), legs = [];
    let took = true;
    while (legs.length < s.legs && took) {
      took = false;
      for (const q of queues) {
        if (legs.length >= s.legs) break;
        let l;
        while ((l = q.shift()) && seen.has(who(l))) { /* his second leg, or a game already in */ }
        if (!l) continue;
        seen.add(who(l)); legs.push(l); took = true;
      }
    }
    if (legs.length < s.legs) return null;
    return { legs, combined: P.combineLegs(legs, o.lift), skipped };
  }

  /** The slip's markup, or why there is none. `helpers.lift` is the replay's lifts; `helpers.price` what the user typed; `helpers.edge` edge.js. */
  function slipHtml(slip, state, helpers) {
    const h = helpers || {}, s = cleanState(state), lift = h.lift || {};
    if (!slip) return '<div class="slip warn"><h3>Cannot build that slip</h3><div>' + esc(h.reason || "Nothing clears the filters.") + "</div></div>";
    const c = slip.combined;
    let html = '<div class="slip"><h3>Suggested parlay — ' + slip.legs.length + " legs · " + (s.scope === "players" ? "one leg a player, any games" : "from " + c.distinctGames + " different games") + "</h3>";
    html += '<div class="how">The best leg of each prop family in turn, ' + (s.scope === "players" ? "one a player" : "one a game") + ", each the highest line the model gives at least " + Math.round(100 * s.floor) + "% to, ranked by chance within a family, <b>not</b> by price: it cannot see what you are being offered. The count, the sheet and the record under each leg are facts, not the chance." +
      (slip.skipped && slip.skipped.length ? " " + slip.skipped.map(famLabel).map(esc).join(" and ") + " legs are " + (h.home ? "" : "listed but ") + "kept out of the slip: the replay has not measured them in a parlay." : "") + "</div>";
    html += slip.legs.map((l) => legLine(l, h)).join("");
    const shown = c.adjusted != null ? c.adjusted : c.prob;
    html += '<div class="slipsum"><div><span class="big">' + pct(c.prob, c.prob < 0.1 ? 2 : 1) + '</span><span class="lbl">the legs multiplied</span></div>';
    if (c.adjusted != null && Math.abs(c.adjusted - c.prob) > 1e-9) html += '<div><span class="big">' + pct(c.adjusted, c.adjusted < 0.1 ? 2 : 1) + '</span><span class="lbl">adjusted: such legs cashed ' + c.lift + "× the product on the replay</span></div>";
    if (h.model && typeof h.model.fairPrice === "function") html += '<div><span class="big">' + sgn(h.model.fairPrice(shown)) + '</span><span class="lbl">fair price</span></div>';
    if (!h.home) html += '<div><input id="slipprice" type="number" step="10" placeholder="offered" aria-label="Parlay price you are offered"' + (h.price != null ? ' value="' + esc(h.price) + '"' : "") + '><span class="lbl">price you are offered</span></div>';
    if (!h.home && h.price != null && isFinite(h.price) && h.price !== 0 && h.edge) {
      const ev = h.edge.evPct(shown, h.edge.americanToDecimal(h.price));
      html += '<div><span class="big ' + (ev > 2 ? "good" : ev >= 0 ? "warn" : "bad") + '">' + esc(h.edge.formatPct(ev)) + '</span><span class="lbl">edge at that price</span></div>';
    }
    html += "</div>";
    const applied = (k) => (lift[k] && lift[k] !== 1 ? " The adjusted number applies " + lift[k] + "." : "");
    const note = {
      none: "Legs from different games multiply honestly: on the replay, cross-game slips cashed at or a little above the product.",
      game: "One game, no two legs on one team. On the replay these cashed about the product, the same as different games." + applied("game"),
      mixed: "Some legs share a team. On the replay these cashed about the product; a quarterback and his receiver rise together, two backs share the carries." + applied("mixed"),
      team: "Every leg on one team. Yards legs on one team rise together; touchdowns on one team are shared, so all-touchdown slips cashed well under the product on the replay." + applied("team"),
      player: "The same player on more than one prop. His legs rise and fall together: on the replay these cashed well above the product." + applied("player"),
      severe: "The same player twice: the number is meaningless.",
    }[c.correlation];
    html += '<div class="slipwarn ' + esc(c.correlation) + '">' + note + " Shade the top of the board: the legs it likes most run a little hot.</div></div>";
    return html;
  }

  /** The rule a state spells, for a heading: written from the state so a changed default cannot leave the copy behind. */
  function ruleText(state) {
    const s = cleanState(state), words = { 0: "any count", 6: "six of his last ten", 8: "eight of his last ten" };
    const all = FAMILIES.map((f) => f.id);
    const fams = s.fams.length === all.length ? "every prop" : s.fams.join() === DEFAULT_FAMS.join() ? "the counting props" : s.fams.map((id) => famLabel(id).toLowerCase().replace("anytime td", "anytime TD")).join(" and ");
    return (s.scope === "players" ? "one leg a player" : "one leg a game") + ", each at least " + Math.round(100 * s.floor) + "%, " + words[s.hits] + (s.soft ? ", a soft defence only" : "") + ", " + fams;
  }

  /* The home's strip: the page's slip at its defaults (three legs, one a game, each at least 70%, six of his last ten, the
     counting props), two legs whenever three cannot be filled, on the games of the home's slate day only (`helpers.gameIds`)
     so a Sunday-night leg is never paired with a Monday-night one under one heading, without the price input (the page has
     it); "" when nothing builds, so the home hides the section rather than carrying a refusal. */
  function stripHtml(model, data, record, parlay, helpers) {
    const h = helpers || {};
    if (!model || !data || !parlay || typeof parlay.combineLegs !== "function" || !Array.isArray(data.players)) return "";
    const lift = (model.DEFAULTS && model.DEFAULTS.parlayLift) || {}, eligible = model.DEFAULTS && model.DEFAULTS.parlayProps;
    const base = cleanState(null);
    const ids = Array.isArray(h.gameIds) ? new Set(h.gameIds.map(String)) : null;
    const d = ids ? Object.assign({}, data, { games: (data.games || []).filter((g) => g && ids.has(String(g.id))) }) : data;
    const list = filter(legs(model, d, record, { now: h.now, floor: base.floor }), base);
    for (const n of [3, 2]) {
      const s = Object.assign({}, base, { legs: n });
      const slip = buildSlip(list, s, { parlay, lift, eligible });
      if (slip) return slipHtml(slip, s, { lift, model, faces: h.faces, league: h.league, home: true });
    }
    return "";
  }

  const recFact = (l) => (l.rec === undefined ? "no record" : l.rec ? (l.prop === "td" ? "at " + l.rec.lo + "–" + (l.rec.lo + 10) + "%" : "at " + l.rung + "+") + " said " + Math.round(l.rec.said) + "% · hit " + Math.round(l.rec.hit) + "%" : "—");
  const sheetFact = (l) => (l.sheet ? esc(ord(Number(l.sheet.rank))) + " " + esc(l.sheet.label) + (l.sheet.of != null ? " of " + esc(l.sheet.of) : "") + (l.sheet.one ? " (one game)" : "") : "—");
  /** Every leg that clears the filters: a section a family on, in the control's order, each ranked by chance, LISTED rows and the cut said. */
  function legsHtml(list, state, helpers) {
    const h = helpers || {}, F = h.faces || null, league = h.league || "NFL", s = cleanState(state);
    const all = (list || []).filter((l) => l && s.fams.includes(l.prop));
    if (!all.length) return '<div class="empty"><div class="big">No leg clears the filters</div><div>Lower the floor, the consistency count or switch the soft-defence filter off.</div></div>';
    return FAMILIES.filter((f) => s.fams.includes(f.id)).map((f) => {
      const sorted = all.filter((l) => l.prop === f.id).sort((a, b) => b.prob - a.prob || String(a.name).localeCompare(String(b.name)));
      let html = '<section class="cgroup"><h2 class="gtitle">' + esc(f.label) + "</h2>";
      if (!sorted.length) return html + '<p class="cnone">Nobody clears the filters at this floor.</p></section>';
      const shown = sorted.slice(0, LISTED), cut = sorted.length - shown.length;
      html += '<ol class="plegs">';
      shown.forEach((l, i) => {
        html += '<li><span class="n">' + (i + 1) + '</span><span class="who">' + (F ? F.face(league, l.playerId, 24) : "") + "<b>" + esc(l.name) + "</b><small>" + esc(l.team) + " vs " + esc(l.opp) + "</small></span>" +
          '<span class="pl">' + esc(l.propLabel) + '</span><b class="pp">' + pct(l.prob, 0) + "</b>" +
          '<span class="pe"><span' + (l.hits && l.hits.hits >= 8 ? ' class="up"' : "") + ">" + (l.hits ? l.hits.hits + "/" + l.hits.n : "—") + "</span><span" + (l.sheet ? (l.sheet.one ? ' class="one"' : ' class="up"') : "") + ">" + sheetFact(l) + "</span><span>" + recFact(l) + "</span></span></li>";
      });
      html += "</ol>";
      if (cut > 0) html += '<div class="cmore">+' + cut + " more under " + pct(shown[shown.length - 1].prob, 0) + "</div>";
      return html + "</section>";
    }).join("");
  }

  function footHtml(data) {
    const w = data && data.week != null ? data.week : null, s = data && data.season != null ? data.season : null;
    return "<p>Every leg is a line the book sells as a number and up: a rung on the model's ladder, priced off the same pool of comparable real games as the drawer's alternate lines, or an anytime touchdown; never an over/under at the projection. " +
      "For each player and stat the leg is the highest rung the model gives at least the floor to; the slip is the legs most likely to cash under the filters, one a game from the slate or one a player from any games, with the replay's measured lift for legs that rise together. " +
      "Under each leg: how many of his last ten games on file" + (s != null && w != null ? ", before week " + esc(w) + " of " + esc(s) + "," : "") + " cleared that rung (a count, not a chance); whether the opponent ranks in the top five of the field on the defensive cheat sheet for that stat at his position; and what the record did at that rung, what the model said and what hit, where it has " + MIN_GRADED + " graded calls. " +
      "A player needs a game still to kick off and no Out status. Nothing here sees a price: compare the fair price with the book's, type what you are offered for the edge, and shade the top of the board.</p>";
  }

  const HOSTS = ["pcontrols", "pslip", "plegs", "pfoot"];
  /* Render: the controls into #pcontrols (one listener a host), the slip into #pslip, the list into #plegs, the caveat into #pfoot.
     No control may carry a host's id: a second render would then find the control first and write the list into it. */
  function render(doc, opts) {
    const o = opts || {}, ctl = doc.getElementById("pcontrols"), slipEl = doc.getElementById("pslip"), host = doc.getElementById("plegs"), foot = doc.getElementById("pfoot");
    if (!host) return;
    const data = o.data || null, model = o.model || null, P = o.parlay || null;
    const ok = !!(data && model && P && typeof P.combineLegs === "function" && Array.isArray(data.players));
    if (!ok) { if (ctl) { ctl.innerHTML = ""; ctl.hidden = true; } if (slipEl) slipEl.innerHTML = ""; if (foot) foot.innerHTML = ""; host.innerHTML = '<div class="empty"><div class="big">No board</div><div>The NFL data file did not load.</div></div>'; return; }
    const given = o.state || (ctl && ctl.__state) || null;
    const state = cleanState(given);
    if (ctl) { ctl.__state = state; ctl.__on = typeof o.onState === "function" ? o.onState : null; ctl.__price = o.price != null ? o.price : (ctl.__price != null ? ctl.__price : null); }
    const lift = (model.DEFAULTS && model.DEFAULTS.parlayLift) || { game: 1, mixed: 1, team: 1, player: 1 };
    const draw = () => {
      const s = (ctl && ctl.__state) || state, price = ctl ? ctl.__price : null;
      if (ctl) { ctl.innerHTML = controlsHtml(s); ctl.hidden = false; }
      const all = legs(model, data, o.record || null, { now: o.now, floor: s.floor });
      const list = filter(all, s);
      const slip = buildSlip(list, s, { parlay: P, lift, eligible: model.DEFAULTS && model.DEFAULTS.parlayProps });
      let reason = null;
      if (!slip) {
        const inSlip = list.filter((l) => !model.DEFAULTS || !Array.isArray(model.DEFAULTS.parlayProps) || model.DEFAULTS.parlayProps.includes(l.prop));
        const games = new Set(inSlip.map((l) => l.gameId)), who = new Set(inSlip.map((l) => l.playerId));
        reason = !list.length ? "No leg clears the filters. Lower the floor or the consistency count, or switch the soft-defence filter off."
          : s.scope === "players" ? "Only " + who.size + " player" + (who.size === 1 ? "" : "s") + " with a leg under these filters — a " + s.legs + "-leg slip needs " + s.legs + ", one a player."
          : "Only " + games.size + " game" + (games.size === 1 ? "" : "s") + " with a leg under these filters — a " + s.legs + "-leg slip from the slate needs " + s.legs + ", one a game. Try any games.";
      }
      if (slipEl) slipEl.innerHTML = slipHtml(slip, s, { lift, model, faces: o.faces, league: o.league, edge: o.edge, price, reason });
      host.innerHTML = legsHtml(list, s, { faces: o.faces, league: o.league });
      if (foot) foot.innerHTML = footHtml(data);
    };
    if (ctl) ctl.__draw = draw;
    draw();
    /* A state the page could not use was cleaned to one it could: tell the caller once, so the URL says what the page shows. */
    if (given && typeof o.onState === "function" && differs(given, state)) o.onState(state);
    if (ctl && ctl.addEventListener && !ctl.__picking) {
      ctl.__picking = true;
      ctl.addEventListener("click", (e) => {
        const t = e.target, at = (k) => (t && t.closest ? t.closest("[data-" + k + "]") : null);
        const cur = ctl.__state || cleanState(null);
        let next = null;
        const bl = at("legs"), bs = at("scope"), bf = at("floor"), bh = at("hits"), bo = at("soft"), bfam = at("fam");
        if (bl) next = Object.assign({}, cur, { legs: Number(bl.getAttribute("data-legs")) });
        else if (bs) next = Object.assign({}, cur, { scope: bs.getAttribute("data-scope") });
        else if (bf) next = Object.assign({}, cur, { floor: Number(bf.getAttribute("data-floor")) });
        else if (bh) next = Object.assign({}, cur, { hits: Number(bh.getAttribute("data-hits")) });
        else if (bo) next = Object.assign({}, cur, { soft: !cur.soft });
        else if (bfam) {
          const id = bfam.getAttribute("data-fam");
          if (cur.fams.includes(id) && cur.fams.length === 1) return; // the last family on stays on: nothing is not a view
          next = Object.assign({}, cur, { fams: cur.fams.includes(id) ? cur.fams.filter((x) => x !== id) : cur.fams.concat([id]) });
        }
        if (!next) return;
        ctl.__state = cleanState(next);
        if (ctl.__draw) ctl.__draw();
        if (ctl.__on) ctl.__on(ctl.__state);
      });
    }
    if (slipEl && slipEl.addEventListener && !slipEl.__pricing) {
      slipEl.__pricing = true;
      slipEl.addEventListener("change", (e) => {
        const t = e.target; if (!t || t.id !== "slipprice" || !ctl) return;
        const v = Number(t.value); ctl.__price = t.value === "" || !isFinite(v) ? null : v;
        if (ctl.__draw) ctl.__draw();
      });
    }
  }

  /* Whether a value the caller gave differs from the cleaned one; a key not given is the default and is not a difference. */
  function differs(given, clean) {
    const g = given || {}, has = (k) => g[k] != null && g[k] !== "";
    if (has("legs") && Number(g.legs) !== clean.legs) return true;
    if (has("scope") && g.scope !== clean.scope) return true;
    if (has("floor") && Number(g.floor) !== clean.floor) return true;
    if (has("hits") && Number(g.hits) !== clean.hits) return true;
    if (has("soft") && (g.soft === true || g.soft === "1" || g.soft === 1) !== clean.soft) return true;
    if (has("fams")) { const f = Array.isArray(g.fams) ? g.fams : String(g.fams).split(","); if (f.length !== clean.fams.length || f.some((x) => !clean.fams.includes(x))) return true; }
    return false;
  }

  return { LEGS, FLOORS, SCOPES, HITS, FAMILIES, DEFAULT_FAMS, HOSTS, LISTED, MIN_GRADED, SOFT, sheetLine, recordFor, legs, filter, cleanState, controlsHtml, evidence, ruleText, buildSlip, slipHtml, stripHtml, legsHtml, footHtml, render };
});
