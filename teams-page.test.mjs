/*
 * BetHouse — teams-page.test.mjs
 * The teams page: one row per team out of tendencies-data.js, through the
 * same arithmetic the matchup panel uses (tendencies-core.js). Oracle: the
 * core's rank/matchup/threshold tests, and the matchup panel's wording.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import page from "./teams-page.js";
import core from "./tendencies-core.js";

const prof = (o) => Object.assign({ plays: 100, games: 2, playsPerGame: 60, passRate: 0.6, proe: 0, epaPerPlay: 0, epaPerPass: 0.05, epaPerRush: -0.05,
  deepRate: 0.12, shortRate: 0.88, insideRunShare: 0.8, outsideRunShare: 0.2, playActionRate: 0.24, blitzRate: 0.3,
  deepEpa: 0.4, shortEpa: 0.13, insideRunEpa: -0.1, outsideRunEpa: 0.03, paEpa: 0.13, blitzEpa: 0.01 }, o);
const DATA = {
  K: 6, through: { season: 2026, week: 3 },
  current: {
    off: { KC: prof({ epaPerPlay: 0.2, deepRate: 0.17, playsPerGame: 70 }), LAC: prof({ epaPerPlay: -0.1, deepRate: 0.08 }), DEN: prof({ epaPerPlay: 0.2, passRate: null }) },
    def: { KC: prof({ epaPerPlay: -0.1, deepEpa: 0.9 }), LAC: prof({ epaPerPlay: 0.1, insideRunEpa: -0.3 }), DEN: prof({}) },
    league: prof({}),
  },
};

test("rows: one per team, the offence's numbers, the defence's allowances, ranks that agree with the core, and the family chips at the core's thresholds", () => {
  const rows = page.rows(DATA, core);
  assert.deepEqual(rows.map((r) => r.team), ["DEN", "KC", "LAC"]);
  const kc = rows.find((r) => r.team === "KC");
  assert.equal(kc.epaPerPlay, 0.2); assert.equal(kc.defEpaPerPlay, -0.1); assert.equal(kc.blitzRate, 0.3);
  assert.equal(kc.rank.epaPerPlay, 1); assert.equal(rows.find((r) => r.team === "LAC").rank.epaPerPlay, 3);
  assert.equal(kc.rank.defEpaPerPlay, 1, "the best defence allows the least");
  assert.equal(kc.rank.passRate, undefined, "a style column carries no rank: 'best' means nothing there");
  assert.equal(kc.rank.blitzRate, undefined);
  assert.equal(kc.field.epaPerPlay, 3);
  assert.deepEqual(kc.offLeans, [{ family: "deep pass", dir: "lean" }], "KC throws deep 5 points more than the league");
  assert.deepEqual(rows.find((r) => r.team === "LAC").offLeans, [{ family: "deep pass", dir: "avoid" }]);
  assert.deepEqual(kc.defSpots, [{ family: "deep pass", dir: "soft" }], "KC allows 0.5 EPA more on deep throws");
  assert.deepEqual(rows.find((r) => r.team === "LAC").defSpots, [{ family: "inside run", dir: "stout" }]);
  assert.equal(rows.find((r) => r.team === "DEN").passRate, null, "a null metric stays null");
  const half = { K: 6, current: { off: { KC: prof({ epaPerPass: null }), LAC: prof({}), DEN: prof({}) }, def: DATA.current.def, league: prof({}) } };
  const d = page.rows(half, core).find((r) => r.team === "DEN");
  assert.equal(d.field.epaPerPass, 2, "a rank's field is the teams with a number, not every team");
  assert.equal(page.rows(half, core).find((r) => r.team === "KC").rank.epaPerPass, null, "no number, no rank");
});

test("sorted: best first by the column's own direction, nulls last, the team column alphabetical", () => {
  const rows = page.rows(DATA, core);
  assert.deepEqual(page.sorted(rows, "epaPerPlay").map((r) => r.team), ["DEN", "KC", "LAC"], "a tie on the metric breaks alphabetically");
  assert.deepEqual(page.sorted(rows, "defEpaPerPlay").map((r) => r.team), ["KC", "DEN", "LAC"], "the lowest EPA allowed is the best defence");
  assert.deepEqual(page.sorted(rows, "passRate").map((r) => r.team), ["KC", "LAC", "DEN"], "a null sorts last");
  assert.deepEqual(page.sorted(rows, "team").map((r) => r.team), ["DEN", "KC", "LAC"]);
});

test("tableHtml: every column headed with a sort button, the pressed one marked, every figure with its rank, every chip, every value escaped", () => {
  const rows = page.rows(DATA, core);
  const html = page.tableHtml(rows, "epaPerPlay", {});
  assert.equal((html.match(/<th[ >]/g) || []).length, page.VIEWS.off.length, "the offence table, by default");
  assert.match(html, /data-sort="epaPerPlay" aria-pressed="true"/);
  assert.match(html, /data-sort="passRate" aria-pressed="false"/);
  assert.match(html, /<th><span>Offence leans<\/span><\/th>/, "a chip column's head looks sortable and is not");
  assert.doesNotMatch(html, /data-sort="(offLeans|defSpots)"/);
  assert.match(html, /<td class="r"><b>\+0\.20<\/b><small>1st<\/small>/, "KC's EPA per play with its rank");
  assert.match(html, /<td class="r"><b>70<\/b><\/td>/, "plays a game rounded, and no rank on a style column");
  assert.match(html, /<td class="r"><b>—<\/b><\/td>/, "a null metric prints a dash and no rank");
  assert.match(html, /<span class="tag lean">deep pass · leans in<\/span>/);
  const def = page.tableHtml(rows, "defEpaPerPlay", {}, "def");
  assert.match(def, /<span class="tag soft">deep pass · soft<\/span>/);
  assert.match(def, /<span class="tag tough">inside run · stout<\/span>/);
  const hostile = { K: 6, current: { off: { "<b>": prof({}) }, def: { "<b>": prof({}) }, league: prof({}) } };
  assert.doesNotMatch(page.tableHtml(page.rows(hostile, core), "team", {}), /<b><b>|<td class="tm"><b><b>/);
  assert.match(page.tableHtml(page.rows(hostile, core), "team", {}), /&lt;b&gt;/);
});

test("the team cell carries the mark and the colour edge when the helpers are there, and nothing without them", () => {
  const rows = page.rows(DATA, core);
  const faces = { mark: (league, key) => '<img class="tmark" data-k="' + key + '">' };
  const teams = { paint: (league, key) => (key === "KC" ? "#e31837" : null) };
  const html = page.tableHtml(rows, "team", { faces, teams, league: "NFL" });
  assert.match(html, /<tr><td class="tm" style="border-left-color:#e31837"><img class="tmark" data-k="KC"><b>KC<\/b>/, "the edge rides the team cell, which stays in view while the panel scrolls");
  assert.match(html, /<tr><td class="tm"><img class="tmark" data-k="LAC"><b>LAC<\/b>/, "a team with no colour has no edge");
  assert.doesNotMatch(page.tableHtml(rows, "team", {}), /<img|style=/);
});

test("the caveat names the week, the regression, the core's own thresholds and that nothing here is a price", () => {
  const f = page.footHtml(DATA, core);
  assert.match(f, /through week 3/); assert.match(f, /regressed toward last season by 6 games/);
  assert.match(f, /styles, sorted most first and ranked by nobody/);
  // The thresholds are read off the core, so the sentence follows a change there.
  assert.match(f, new RegExp(Math.round(100 * core.LEAN_SHARE) + " points more than the league"));
  assert.match(f, new RegExp(core.SOFT_EPA + " EPA a play more than the league"));
  assert.match(page.footHtml(DATA, { LEAN_SHARE: 0.04, SOFT_EPA: 0.07 }), /4 points more than the league[\s\S]*0\.07 EPA a play/, "the caveat does not follow the thresholds it is handed");
  assert.match(f, /nothing here is in a price yet/);
  const bad = page.footHtml({ K: "six", through: { week: "x" }, current: DATA.current }, core);
  assert.doesNotMatch(bad, /NaN/, "a corrupt week or K prints NaN instead of being left out");
  assert.doesNotMatch(bad, /through week|regressed/);
});

test("render: the table and the caveat land in their slots, a head click re-sorts, and no data says so", () => {
  const slots = {};
  const el = (id) => (slots[id] = slots[id] || { innerHTML: "", handlers: {}, addEventListener(t, f) { (this.handlers[t] = this.handlers[t] || []).push(f); } });
  const doc = { getElementById: el };
  page.render(doc, { data: DATA, core });
  assert.match(slots.teams.innerHTML, /data-sort="epaPerPlay" aria-pressed="true"/, "the default sort is EPA per play");
  assert.match(slots.tfoot.innerHTML, /nothing here is in a price yet/);
  slots.teams.handlers.click[0]({ target: { closest: (sel) => (sel === "[data-sort]" ? { getAttribute: () => "playsPerGame" } : null) } });
  assert.match(slots.teams.innerHTML, /data-sort="playsPerGame" aria-pressed="true"/);
  assert.ok(slots.teams.innerHTML.indexOf("<b>KC</b>") < slots.teams.innerHTML.indexOf("<b>LAC</b>"), "the fastest offence did not come first after the click");
  assert.equal(slots.teams.handlers.click.length, 1);
  page.render(doc, { data: DATA, core });
  assert.equal(slots.teams.handlers.click.length, 1, "a second render stacked a second listener");
  assert.match(slots.teams.innerHTML, /data-sort="playsPerGame" aria-pressed="true"/, "a second render forgot the sort");
  const empty = {};
  page.render({ getElementById: (id) => (empty[id] = empty[id] || { innerHTML: "", addEventListener() {} }) }, { data: null, core });
  assert.match(empty.teams.innerHTML, /No team profiles/);
  assert.match(empty.tfoot.innerHTML, /nothing here is in a price yet/, "the empty page lost its caveat");
});

/* ------------------------------------------------------------------ *
 * Two views (2026-10-17): the one wide table was hard to read, thirteen
 * columns with a stacked rank under every figure and a chip column that
 * wrapped every row to three lines. The page is two tables now, an
 * offence and a defence, one line a team, under a segmented control.
 * ------------------------------------------------------------------ */

test("VIEWS: the offence's columns and the defence's, each a subset of COLUMNS led by the team, neither carrying the other side's figures", () => {
  const keys = page.COLUMNS.map((c) => c.key);
  for (const v of ["off", "def"]) {
    assert.equal(page.VIEWS[v][0], "team");
    for (const k of page.VIEWS[v]) assert.ok(keys.includes(k), v + " names a column that does not exist: " + k);
  }
  assert.deepEqual(page.VIEWS.off, ["team", "playsPerGame", "passRate", "proe", "epaPerPlay", "epaPerPass", "epaPerRush", "offLeans"]);
  assert.deepEqual(page.VIEWS.def, ["team", "defEpaPerPlay", "defEpaPerPass", "defEpaPerRush", "blitzRate", "defSpots"]);
  assert.equal(page.DEFAULT_SORT.off, "epaPerPlay"); assert.equal(page.DEFAULT_SORT.def, "defEpaPerPlay");
});

test("tableHtml takes a view: the offence table has no defence column and the defence table no offence column; the default is the offence", () => {
  const rows = page.rows(DATA, core);
  const off = page.tableHtml(rows, "epaPerPlay", {}, "off"), def = page.tableHtml(rows, "defEpaPerPlay", {}, "def");
  assert.equal((off.match(/<th[ >]/g) || []).length, page.VIEWS.off.length);
  assert.equal((def.match(/<th[ >]/g) || []).length, page.VIEWS.def.length);
  assert.doesNotMatch(off, /Allows\/play|Defence<|tag soft|tag tough/, "the offence table carries the defence");
  assert.doesNotMatch(def, /EPA\/play|Offence leans|tag lean/, "the defence table carries the offence");
  assert.match(def, /<th><span>Defence<\/span><\/th>/); assert.match(def, /data-sort="defEpaPerPlay" aria-pressed="true"/);
  assert.equal(page.tableHtml(rows, "epaPerPlay", {}), off, "no view is the offence");
  assert.equal(page.tableHtml(rows, "epaPerPlay", {}, "nonsense"), off, "an unknown view is the offence");
});

test("controlsHtml: the two views as a labelled segmented control in the board's style, the pressed one marked", () => {
  const h = page.controlsHtml("def");
  assert.match(h, /<div class="ctl"><label id="lab-tview">Side<\/label><div class="seg" id="tview" role="group" aria-labelledby="lab-tview">/);
  assert.match(h, /<button type="button" data-view="off" aria-pressed="false">Offence<\/button><button type="button" data-view="def" aria-pressed="true">Defence<\/button>/);
  assert.match(page.controlsHtml("off"), /data-view="off" aria-pressed="true"/);
  assert.match(page.controlsHtml(), /data-view="off" aria-pressed="true"/, "no view is the offence");
});

test("render: the controls land in #tcontrols, a view click swaps the table and its default sort, the view and sort survive a second render", () => {
  const slots = {};
  const el = (id) => (slots[id] = slots[id] || { innerHTML: "", hidden: true, handlers: {}, addEventListener(t, f) { (this.handlers[t] = this.handlers[t] || []).push(f); } });
  const doc = { getElementById: el };
  page.render(doc, { data: DATA, core });
  assert.equal(slots.tcontrols.hidden, false, "the controls host stays hidden");
  assert.match(slots.tcontrols.innerHTML, /data-view="off" aria-pressed="true"/);
  assert.match(slots.teams.innerHTML, /Offence leans/);
  slots.tcontrols.handlers.click[0]({ target: { closest: (sel) => (sel === "[data-view]" ? { getAttribute: () => "def" } : null) } });
  assert.match(slots.tcontrols.innerHTML, /data-view="def" aria-pressed="true"/);
  assert.match(slots.teams.innerHTML, /data-sort="defEpaPerPlay" aria-pressed="true"/, "the defence view did not open on its own default sort");
  assert.doesNotMatch(slots.teams.innerHTML, /Offence leans/);
  slots.teams.handlers.click[0]({ target: { closest: (sel) => (sel === "[data-sort]" ? { getAttribute: () => "blitzRate" } : null) } });
  assert.match(slots.teams.innerHTML, /data-sort="blitzRate" aria-pressed="true"/);
  page.render(doc, { data: DATA, core });
  assert.match(slots.teams.innerHTML, /data-sort="blitzRate" aria-pressed="true"/, "a second render forgot the view or the sort");
  assert.equal(slots.tcontrols.handlers.click.length, 1, "a second render stacked a second listener");
  const empty = {};
  page.render({ getElementById: (id) => (empty[id] = empty[id] || { innerHTML: "", hidden: true, addEventListener() {} }) }, { data: null, core });
  assert.equal(empty.tcontrols.hidden, true, "no data, no controls");
});

test("render: a sort key from the other view falls back to the view's own default", () => {
  const slots = {};
  const el = (id) => (slots[id] = slots[id] || { innerHTML: "", hidden: true, addEventListener() {} });
  page.render({ getElementById: el }, { data: DATA, core, view: "def", sort: "playsPerGame" });
  assert.match(slots.teams.innerHTML, /data-sort="defEpaPerPlay" aria-pressed="true"/, "the defence table opened sorted by an offence column it does not show");
});
