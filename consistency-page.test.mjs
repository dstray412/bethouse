/*
 * BetHouse — consistency-page.test.mjs
 * The consistency cards: for each prop at a standard line, who cleared
 * it most often in his last ten games on file. Oracle: the definition
 * (a hit is a game at or over the line; a touchdown is one or more),
 * the model's own recentHits, and the page's stated rules: ten games,
 * a game this week, not ruled out, 60% and up, fifteen a card.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import page from "./consistency-page.js";
import nfl from "./nfl.js";

const row = (recYds, recs, rushYds, passYds, tds, date, team) => [date || "260928", "DEN", recYds, recs, rushYds, passYds, tds, team || "KC"];
const ten = (f) => Array.from({ length: 10 }, (_, i) => f(i));
const PLAYERS = [
  { id: "a", name: "Alpha Wide", team: "KC", pos: "WR", opp: "LAC", recent: ten((i) => row(i < 9 ? (i < 7 ? 80 : 60) : 20, i < 7 ? 6 : 2, 0, 0, i < 4 ? 1 : 0)) },      // 9/10 at 50+, 7/10 at 75+, 4/10 TD, 7/10 at 4+ recs
  { id: "b", name: "Bravo Back", team: "LAC", pos: "RB", opp: "KC", recent: ten((i) => row(10, 1, i < 8 ? 60 : 30, 0, i < 6 ? 1 : 0)) },           // 8/10 at 50+ rush, 6/10 TD
  { id: "c", name: "Charlie Out", team: "KC", pos: "WR", opp: "LAC", status: "Out", recent: ten(() => row(100, 8, 0, 0, 1)) },              // ruled out: never listed
  { id: "d", name: "Delta Bye", team: "ZZZ", pos: "WR", opp: null, recent: ten(() => row(100, 8, 0, 0, 1)) },                                   // no game this week
  { id: "e", name: "Echo New", team: "KC", pos: "WR", opp: "LAC", recent: ten(() => row(100, 8, 0, 0, 1)).slice(0, 7) },                     // seven games: not ten
  { id: "f", name: "Foxtrot QB", team: "KC", pos: "QB", opp: "LAC", recent: ten((i) => row(0, 0, 10, i < 8 ? 280 : 200, 0)) },               // 8/10 at 250+
  { id: "g", name: "Golf Low", team: "LAC", pos: "WR", opp: "KC", recent: ten((i) => row(i < 5 ? 60 : 10, 3, 0, 0, 0)) },                       // 5/10: under the floor
];

test("hits: a game at or over the line counts, a touchdown is one or more, and only the last ten games on file", () => {
  assert.equal(page.hits(nfl, PLAYERS[0], page.RUNGS.find((r) => r.id === "recyds50")), 9);
  assert.equal(page.hits(nfl, PLAYERS[0], page.RUNGS.find((r) => r.id === "recyds70")), 7);
  assert.equal(page.hits(nfl, PLAYERS[0], page.RUNGS.find((r) => r.id === "recs4")), 7);
  assert.equal(page.hits(nfl, PLAYERS[0], page.RUNGS.find((r) => r.id === "td")), 4);
  assert.equal(page.hits(nfl, PLAYERS[1], page.RUNGS.find((r) => r.id === "rushyds50")), 8);
  assert.equal(page.hits(nfl, PLAYERS[5], page.RUNGS.find((r) => r.id === "passyds250")), 8);
  assert.equal(page.hits(nfl, PLAYERS[1], page.RUNGS.find((r) => r.id === "rushrec70")), 8, "rush + rec is the two yardages added: 60 and 10 clear 70");
  /* Every rung is a line the board prices, so the caveat's chance exists. */
  for (const r of page.RUNGS) if (r.stat !== "td") assert.ok(nfl.LADDERS[r.stat].includes(r.rung), r.id + " is not on the model's ladder");
  assert.equal(page.hits(nfl, { recent: null }, page.RUNGS[0]), null, "no log: no count, not zero");
});

test("rows: ten games, a game this week, not ruled out, at least six hits, most hits first then by name, fifteen a card", () => {
  const r50 = page.rows(nfl, PLAYERS, page.RUNGS.find((r) => r.id === "recyds50"));
  assert.deepEqual(r50.map((x) => [x.name, x.hits, x.pct]), [["Alpha Wide", 9, 90]], "the ruled-out, the idle, the seven-game and the five-hit players were listed");
  assert.deepEqual([r50[0].prev, r50[0].away, r50[0].q], [0, 0, false]);
  /* The row says what the count is not: games from last season, games for another team, a Questionable listing. */
  const moved = { id: "m", name: "Moved Man", team: "SF", pos: "WR", opp: "DEN", status: "Questionable", recent: ten((i) => row(60, 4, 0, 0, 0, i < 3 ? "26092" + i : "25122" + i, i < 3 ? "SF" : "TB")) };
  const rm = page.rows(nfl, [moved], page.RUNGS.find((r) => r.id === "recyds50"), 2026)[0];
  assert.equal(rm.prev, 7, "seven of the ten were last season"); assert.equal(rm.away, 7, "seven were for Tampa Bay"); assert.equal(rm.q, true);
  const old = page.rows(nfl, [{ ...moved, status: undefined, recent: moved.recent.map((x) => x.slice(0, 7)) }], page.RUNGS.find((r) => r.id === "recyds50"), 2026)[0];
  assert.equal(old.away, 0, "an older file without the team column reads no other-team games, not all of them");
  const td = page.rows(nfl, PLAYERS, page.RUNGS.find((r) => r.id === "td"));
  assert.deepEqual(td.map((x) => x.name), ["Bravo Back"], "a four-hit player is under the floor");
  assert.equal(td[0].n, 10); assert.equal(td[0].pct, 60); assert.equal(td[0].opp, "KC"); assert.equal(td[0].team, "LAC");
  const many = Array.from({ length: 20 }, (_, k) => ({ id: "m" + k, name: "Player " + String(k).padStart(2, "0"), team: "KC", pos: "WR", opp: "LAC", recent: ten((i) => row(i < 6 + (k % 5) ? 60 : 0, 0, 0, 0, 0)) }));
  const big = page.rows(nfl, many, page.RUNGS.find((r) => r.id === "recyds50"));
  assert.equal(big.length, 10, "more than ten a card on the overview");
  assert.equal(page.rows(nfl, many, page.RUNGS.find((r) => r.id === "recyds50"), 2026, 5).length, 5, "the home's cap is not the caller's");
  /* The home's strip: three broad rungs, five a card, through the same card markup, with a link to the page; nothing with nobody. */
  const strip = page.stripHtml(nfl, { players: many, season: 2026 }, {});
  assert.equal((strip.match(/class="ccard"/g) || []).length, 1, "the strip shows a card for a rung nobody clears");
  assert.equal((strip.match(/<li>/g) || []).length, 5, "the strip's card is not capped at five");
  assert.match(strip, /50\+ receiving yards/);
  assert.equal(page.stripHtml(nfl, { players: [], season: 2026 }, {}), "", "a strip with nobody");
  assert.equal(page.stripHtml(null, { players: many, season: 2026 }, {}), "", "no model, no strip"); assert.equal(page.stripHtml(nfl, null, {}), "", "no data, no strip");
  assert.deepEqual(page.HOME_RUNGS, ["td", "recyds50", "rushyds50"]);
  assert.ok(big.every((x, i) => i === 0 || big[i - 1].hits >= x.hits), "not most hits first");
  assert.deepEqual(page.rows(nfl, [], page.RUNGS[0]), []);
});

test("tier and cardHtml: 80% and up good, 70% a warning, 60% plain; the bar is the share; every string escaped; the card says the window", () => {
  assert.equal(page.tier(90), "good"); assert.equal(page.tier(80), "good"); assert.equal(page.tier(70), "warn"); assert.equal(page.tier(60), "low");
  const rung = page.RUNGS.find((r) => r.id === "recyds50");
  const html = page.cardHtml(rung, page.rows(nfl, PLAYERS.concat([{ id: "h", name: "<b>Hostile</b>", team: "KC", pos: "WR", opp: "LAC", recent: ten((i) => row(i < 7 ? 60 : 0, 0, 0, 0, 0)) }]), rung), {});
  assert.match(html, /<section class="ccard"><header><h3>50\+ receiving yards<\/h3><small>consistency · last 10 games on file, this season and last<\/small><\/header>/);
  assert.match(html, /<li><span class="n">1<\/span><span class="who"><b>Alpha Wide<\/b><small>KC vs LAC<\/small><\/span><b class="hits good">9\/10<\/b><span class="bar"><i style="width:90%"><\/i><\/span><span class="pct good">90%<\/span><\/li>/, "the first row is not the ninety-percent player with a good tier and a ninety-percent bar");
  assert.match(html, /<span class="n">2<\/span><span class="who"><b>&lt;b&gt;Hostile&lt;\/b&gt;<\/b>/, "a name reached the card unescaped");
  assert.match(html, /<b class="hits warn">7\/10<\/b>/);
  assert.match(page.cardHtml(rung, [], {}), /<p class="cnone">Nobody at six hits or better\.<\/p>/, "a card with nobody vanishes instead of saying so");
  const notes = page.cardHtml(rung, [{ id: "m", name: "Moved Man", team: "SF", opp: "DEN", hits: 7, n: 10, pct: 70, prev: 7, away: 7, q: true }], {});
  assert.match(notes, /<b>Moved Man<span class="tag q" title="Questionable on the report">Q<\/span><\/b><small>SF vs DEN · 7 last season · 7 for another team<\/small>/, "the row does not say what the count is not");
});

test("render: a card per rung with rows, the caveat, and empty states that say why", () => {
  const made = (id) => ({ id, innerHTML: "" });
  const els = { cons: made("cons"), cfoot: made("cfoot") };
  const doc = { getElementById: (id) => els[id] || null };
  page.render(doc, { data: { players: PLAYERS, week: 4, season: 2026 }, model: nfl });
  assert.match(els.cons.innerHTML, /50\+ receiving yards/); assert.match(els.cons.innerHTML, /Anytime TD/); assert.match(els.cons.innerHTML, /250\+ passing yards/);
  assert.match(els.cons.innerHTML, /300\+ passing yards<\/h3>[\s\S]*?<p class="cnone">Nobody at six hits or better/, "a rung nobody clears has no card saying so");
  assert.equal((els.cons.innerHTML.match(/class="ccard"/g) || []).length, page.RUNGS.length, "not a card per rung");
  assert.match(els.cfoot.innerHTML, /last ten games on file/); assert.match(els.cfoot.innerHTML, /ten games, a game this week and no Out/); assert.match(els.cfoot.innerHTML, /not a chance/);
  assert.match(els.cfoot.innerHTML, /without a touch or a target leaves no line/, "the caveat does not disclose the dropped zero games");
  assert.doesNotMatch(els.cfoot.innerHTML + els.cons.innerHTML, /record\.html|streak was worth/, "a streak claim the record does not make");
  page.render(doc, { data: null, model: nfl });
  assert.match(els.cons.innerHTML, /class="empty"/); assert.equal(els.cfoot.innerHTML, "", "a caveat for data that is not there");
  page.render(doc, { data: { players: [] }, model: nfl });
  assert.equal((els.cons.innerHTML.match(/cnone/g) || []).length, page.RUNGS.length, "an empty board does not show every rung as empty");
});

/* Choosing the prop and the line: the props are the model's stats plus
   the touchdown, the lines the model's own ladder for that stat, the
   state shareable as ?prop=&line=. The picked view is one card, every
   qualifying player up to thirty; the overview stays the default. */
test("props and lines: the choices are the model's stats and its ladder, a label for every rung, and the touchdown's one rung", () => {
  const props = page.props(nfl);
  assert.deepEqual(props.map((p) => p.id), ["all", "td", "recyds", "recs", "rushyds", "rushrec", "passyds"]);
  assert.deepEqual(page.lines(nfl, "rushyds"), nfl.LADDERS.rushyds, "the lines are not the model's ladder");
  assert.deepEqual(page.lines(nfl, "td"), [1]); assert.deepEqual(page.lines(nfl, "all"), []);
  assert.equal(page.rungFor(nfl, "rushyds", 40).label, "40+ rushing yards"); assert.equal(page.rungFor(nfl, "recs", 3).label, "3+ receptions");
  assert.equal(page.rungFor(nfl, "td", 1).label, "Anytime TD"); assert.equal(page.rungFor(nfl, "rushrec", 125).label, "125+ rush + rec yards");
  assert.equal(page.rungFor(nfl, "rushyds", 45), null, "a line the model does not price is not a rung");
  assert.equal(page.rungFor(nfl, "nope", 40), null);
});

test("controlsHtml: two segmented controls, the pressed prop and line, the line row only for a picked prop, every button carrying its state", () => {
  const over = page.controlsHtml(nfl, { prop: "all", line: null });
  assert.match(over, /<div class="ctl"><label id="lab-cprop">Prop<\/label><div class="seg" id="cprops" role="group" aria-labelledby="lab-cprop">/);
  assert.match(over, /<button type="button" data-prop="all" aria-pressed="true">Overview<\/button>/);
  assert.match(over, /<button type="button" data-prop="rushyds" aria-pressed="false">Rushing yards<\/button>/);
  assert.doesNotMatch(over, /id="clines"/, "a line row on the overview");
  assert.match(over, /<label id="lab-cprop">Prop<\/label><div class="seg" id="cprops" role="group" aria-labelledby="lab-cprop">/, "the prop strip is not a labelled group, as every other segmented control on the site is");
  const picked = page.controlsHtml(nfl, { prop: "rushyds", line: 40 });
  assert.match(picked, /<label id="lab-cline">Line<\/label><div class="seg" id="clines" role="group" aria-labelledby="lab-cline">/);
  assert.match(picked, /data-prop="rushyds" aria-pressed="true"/);
  assert.match(picked, /<div class="ctl"><label id="lab-cline">Line<\/label><div class="seg" id="clines" role="group" aria-labelledby="lab-cline">/);
  assert.match(picked, /<button type="button" data-line="40" aria-pressed="true">40\+<\/button>/);
  assert.match(picked, /<button type="button" data-line="20" aria-pressed="false">20\+<\/button>/);
  assert.equal((picked.match(/data-line=/g) || []).length, nfl.LADDERS.rushyds.length, "not every rung of the ladder");
  const td = page.controlsHtml(nfl, { prop: "td", line: 1 });
  assert.match(td, /data-line="1" aria-pressed="true">1\+<\/button>/);
});

test("render with a picked prop and line: one card at that rung with up to thirty rows, the controls pressed, the overview otherwise, and a bad pick falling back", () => {
  const made = (id) => ({ id, innerHTML: "", listeners: {}, addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); } });
  const els = { ccontrols: made("ccontrols"), cons: made("cons"), cfoot: made("cfoot") };
  const doc = { getElementById: (id) => els[id] || null };
  const many = Array.from({ length: 40 }, (_, k) => ({ id: "m" + k, name: "Player " + String(k).padStart(2, "0"), team: "KC", pos: "RB", opp: "LAC", recent: ten((i) => row(0, 0, i < 6 + (k % 5) ? 45 : 10, 0, 0)) }));
  const changes = [];
  page.render(doc, { data: { players: many, season: 2026, week: 4 }, model: nfl, state: { prop: "rushyds", line: 40 }, onState: (s) => changes.push(s) });
  assert.equal((els.cons.innerHTML.match(/class="ccard"/g) || []).length, 1, "a picked line is not one card");
  assert.doesNotMatch(els.cons.innerHTML, /cgroup/, "a pick is wrapped in a family section");
  assert.match(els.cons.innerHTML, /<h3>40\+ rushing yards<\/h3>/);
  assert.equal((els.cons.innerHTML.match(/<li>/g) || []).length, 40, "a picked line does not list everyone at six hits or better: the pick is the page, there is nowhere to send a cut");
  assert.match(els.cfoot.innerHTML, /everyone at that line/, "the caveat does not say a pick lists everyone"); assert.doesNotMatch(els.cfoot.innerHTML, /fifteen a card/);
  assert.equal(els.ccontrols.hidden, false, "the controls stay hidden once drawn");
  assert.match(els.ccontrols.innerHTML, /data-prop="rushyds" aria-pressed="true"/); assert.match(els.ccontrols.innerHTML, /data-line="40" aria-pressed="true"/);
  /* A click on a control reports the new state and redraws. */
  const click = els.ccontrols.listeners.click[0];
  click({ target: { closest: (sel) => (sel === "[data-prop]" ? null : { getAttribute: () => "20" }) } });
  assert.deepEqual(changes.at(-1), { prop: "rushyds", line: 20 });
  assert.match(els.cons.innerHTML, /<h3>20\+ rushing yards<\/h3>/, "the click did not redraw");
  click({ target: { closest: (sel) => (sel === "[data-prop]" ? { getAttribute: () => "recs" } : null) } });
  assert.deepEqual(changes.at(-1), { prop: "recs", line: nfl.LADDERS.recs[0] }, "a new prop does not start at its lowest line");
  click({ target: { closest: (sel) => (sel === "[data-prop]" ? { getAttribute: () => "all" } : null) } });
  assert.deepEqual(changes.at(-1), { prop: "all", line: null });
  assert.equal((els.cons.innerHTML.match(/class="ccard"/g) || []).length, page.RUNGS.length, "the overview is not the thirteen cards");
  assert.match(els.cfoot.innerHTML, /ten a card on the overview/);
  /* The overview is organised by prop family: a labelled section each, its rungs side by side, in the order a bettor reads them. */
  const groups = [...els.cons.innerHTML.matchAll(/<section class="cgroup"><h2 class="gtitle">([^<]+)<\/h2><div class="cgrid">([\s\S]*?)<\/div><\/section>/g)].map((m) => [m[1], (m[2].match(/class="ccard"/g) || []).length]);
  assert.deepEqual(groups, [["Anytime TD", 1], ["Receiving yards", 3], ["Receptions", 2], ["Rushing yards", 3], ["Rush + rec yards", 2], ["Passing yards", 2]], "the overview is not grouped by family with every rung in its row");
  assert.deepEqual(page.GROUPS.map((g) => g.label), ["Anytime TD", "Receiving yards", "Receptions", "Rushing yards", "Rush + rec yards", "Passing yards"]);
  assert.equal(page.GROUPS.reduce((n, g) => n + g.rungs.length, 0), page.RUNGS.length, "a rung is in no family, or in two");
  assert.equal(els.ccontrols.listeners.click.length, 1, "render added a second listener");
  /* A second render on the same host with new data: the one listener draws from the new payload and reports to the new callback. */
  const later = [];
  page.render(doc, { data: { players: many.slice(0, 3), season: 2026, week: 5 }, model: nfl, state: { prop: "rushyds", line: 40 }, onState: (s) => later.push(s) });
  click({ target: { closest: (sel) => (sel === "[data-prop]" ? null : { getAttribute: () => "20" }) } });
  assert.deepEqual(later.at(-1), { prop: "rushyds", line: 20 }, "the click reported to the first render's callback");
  assert.equal(changes.length, 3, "the stale callback was called");
  assert.equal((els.cons.innerHTML.match(/<li>/g) || []).length, 3, "the click drew from the first render's data");
  /* A pick the model cannot price falls back to the overview rather than an empty page, and tells the caller so the URL follows. */
  const norm = [];
  page.render(doc, { data: { players: many, season: 2026, week: 4 }, model: nfl, state: { prop: "rushyds", line: 45 }, onState: (s) => norm.push(s) });
  assert.equal((els.cons.innerHTML.match(/class="ccard"/g) || []).length, page.RUNGS.length);
  assert.match(els.ccontrols.innerHTML, /data-prop="all" aria-pressed="true"/);
  assert.deepEqual(norm, [{ prop: "all", line: null }], "a cleaned pick was not reported, so the URL would still claim it");
  norm.length = 0;
  page.render(doc, { data: { players: many, season: 2026, week: 4 }, model: nfl, state: { prop: "rushyds", line: "40" }, onState: (s) => norm.push(s) });
  assert.deepEqual(norm, [], "a pick that rendered as given was reported anyway");
  /* No board: the controls hide, the caveat empties. */
  page.render(doc, { data: null, model: nfl });
  assert.equal(els.ccontrols.hidden, true); assert.equal(els.cfoot.innerHTML, "");
});

test("cleanState: the validation boundary for the URL, table-tested", () => {
  const C = (s) => page.cleanState(nfl, s);
  assert.deepEqual(C(null), { prop: "all", line: null });
  assert.deepEqual(C({ prop: "all" }), { prop: "all", line: null });
  assert.deepEqual(C({ prop: "rushyds", line: "40" }), { prop: "rushyds", line: 40 }, "a string line from the URL is the number on the ladder");
  assert.deepEqual(C({ prop: "rushyds", line: null }), { prop: "rushyds", line: 10 }, "a fresh prop starts at its lowest line");
  assert.deepEqual(C({ prop: "rushyds", line: "" }), { prop: "rushyds", line: 10 }, "a link without a line keeps the prop");
  assert.deepEqual(C({ prop: "rushyds", line: "45" }), { prop: "all", line: null }, "a line the model does not price is the overview, not a guess");
  assert.deepEqual(C({ prop: "td", line: "5" }), { prop: "td", line: 1 }, "the touchdown has one rung, so any line is that rung");
  assert.deepEqual(C({ prop: "<img src=x onerror=alert(1)>", line: "10" }), { prop: "all", line: null });
  assert.deepEqual(C({ prop: "__proto__", line: "10" }), { prop: "all", line: null }); assert.deepEqual(C({ prop: "constructor" }), { prop: "all", line: null });
  assert.deepEqual(C({ prop: { toString: () => "rushyds" }, line: "10" }), { prop: "all", line: null }, "a non-string prop is not a prop");
  /* A ladder without a label is not offered, so it cannot throw in the label. */
  const bare = Object.assign({}, nfl, { LADDERS: Object.assign({}, nfl.LADDERS, { newstat: [10, 20] }) });
  assert.deepEqual(page.cleanState(bare, { prop: "newstat", line: "10" }), { prop: "all", line: null });
});
