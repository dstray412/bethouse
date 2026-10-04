/*
 * BetHouse — parlay-page.test.mjs
 * The prop parlay page: every leg the board prices as "N+" (a rung on
 * the model's ladder, or an anytime touchdown), never an over/under at
 * the projection; for each player and stat the highest rung the model
 * gives at least the chosen floor; the consistency count and the
 * opponent's cheat-sheet rank beside each leg; the slip built by
 * parlay.js. Oracles: nfl.js's own ladder and scorers (the page must
 * print what the board prints), the consistency page's hit rule, the
 * cheat sheet's top-five rule, and the record's rung table.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import page from "./parlay-page.js";
import parlay from "./parlay.js";
import nfl from "./nfl.js";

const NOW = Date.parse("2026-10-04T12:00Z");
/* A flat ratio pool: 400 ratios from 0.005 to 2.0, so P(actual > line) is the share of ratios above line/exp. */
const POOL = Array.from({ length: 400 }, (_, i) => (i + 1) * 0.005);
const row = (recYds, recs, rushYds, passYds, tds, date, team) => [date || "260927", "BAL", recYds, recs, rushYds, passYds, tds, team || "KC"];
const ten = (f) => Array.from({ length: 10 }, (_, i) => f(i));
const player = (over) => Object.assign({
  id: "p1", name: "Alpha Wide", team: "KC", pos: "WR", opp: "LAC", games: 12, tds: 6, carries: 2, targets: 96, recYds: 900, rushYds: 10, recs: 66, passAtt: 0, passYds: 0,
  recent: ten((i) => row(i < 7 ? 80 : 15, i < 8 ? 5 : 2, 0, 0, i < 3 ? 1 : 0)),
}, over || {});
const GAMES = [
  { id: "g1", date: "2026-10-04T17:00Z", home: "KC", away: "LAC", completed: false },
  { id: "g2", date: "2026-10-04T17:00Z", home: "DEN", away: "LV", completed: false },
  { id: "g0", date: "2026-10-02T00:15Z", home: "CLE", away: "PIT", completed: true },
];
const stats = (keys) => Object.fromEntries(keys.map((k) => [k, { label: k, soft: "most", kind: "mean" }]));
const DEFENCE = { side: "defence", field: 32, stats: stats(["recYdsWR", "recYdsTE", "recYdsRB", "recsWR", "rushYds", "passYds", "recTdWR", "rushTd"]),
  teams: { LAC: { recYdsWR: { v: 190, n: 3, rank: 2, of: 32 }, recsWR: { v: 14, n: 3, rank: 9, of: 32 }, rushYds: { v: 140, n: 3, rank: 1, of: 32 }, passYds: { v: 260, n: 3, rank: 4, of: 32 }, recTdWR: { v: 5, n: 3, rank: 3, of: 32 } },
    KC: { recYdsWR: { v: 120, n: 3, rank: 30, of: 32 } } } };
const RECORD = { props: { td: { label: "Anytime touchdown", n: 833, bands: [{ lo: 20, n: 247, predicted: 24.9, actual: 22.7 }, { lo: 60, n: 20, predicted: 64, actual: 70 }] } },
  ladder: { stats: { recyds: { label: "Receiving yards", n: 1676, rungs: [{ rung: 20, n: 160, predicted: 64.3, actual: 65.6 }, { rung: 50, n: 160, predicted: 28, actual: 31.9 }, { rung: 150, n: 10, predicted: 5, actual: 0 }] } } } };
const data = (players, over) => Object.assign({ season: 2026, week: 4, games: GAMES, players, teamFactors: { KC: { off: 1.05, def: 0.9, allow: { recyds: 1.0 } }, LAC: { off: 1, def: 1.1, allow: { recyds: 1.1, rushyds: 1.2, recs: 1.0, rushrec: 1.05, passyds: 1.1 } } },
  pools: { recyds: POOL, rushyds: POOL, passyds: POOL, recs: POOL, rushrec: POOL }, defence: DEFENCE }, over || {});

test("legs: a leg is the highest rung the model gives at least the floor, priced by the model's own ladder, labelled N+, never an over", () => {
  const p = player();
  const legs = page.legs(nfl, data([p]), RECORD, { now: NOW, floor: 0.7 });
  const rec = legs.find((l) => l.prop === "recyds");
  assert.ok(rec, "no receiving-yards leg for a 900-yard receiver");
  const y = nfl.statEligible("recyds", p, null, { oppFactor: nfl.allowOf(data([p]).teamFactors, "LAC", "recyds") });
  const ladder = nfl.ladder("recyds", y.exp, POOL);
  const clear = ladder.filter((r) => r.prob >= 0.7);
  assert.equal(rec.rung, clear[clear.length - 1].at, "not the highest rung at 70% or better");
  assert.equal(rec.prob, clear[clear.length - 1].prob, "the leg's chance is not the ladder's");
  assert.ok(ladder.some((r) => r.at > rec.rung && r.prob < 0.7), "a higher rung also cleared the floor");
  assert.equal(rec.propLabel, rec.rung + "+ receiving yards");
  assert.doesNotMatch(JSON.stringify(legs), /\bo\d|over \d|\d\.5\b/, "an over/under line leaked into a leg");
  assert.deepEqual([rec.playerId, rec.gameId, rec.team, rec.opp, rec.name, rec.pos], ["p1", "g1", "KC", "LAC", "Alpha Wide", "WR"]);
  /* Every stat he is in the business of gets its own leg; one rung a stat. */
  const props = legs.map((l) => l.prop);
  assert.equal(new Set(props).size, props.length, "two legs on one stat");
  assert.ok(props.includes("recs") && props.includes("rushrec"), "receptions and rush + rec missing: " + props.join(","));
  assert.ok(!props.includes("rushyds"), "a receiver with two carries got a rushing leg");
  /* The floor is the floor: at 90% the rung drops or the leg goes. */
  const high = page.legs(nfl, data([p]), RECORD, { now: NOW, floor: 0.9 }).find((l) => l.prop === "recyds");
  assert.ok(!high || high.rung < rec.rung, "a higher floor did not lower the rung");
  assert.ok(!high || high.prob >= 0.9);
});

test("legs: the consistency count at the leg's own rung, the opponent's cheat-sheet line by position, and the record's word at that rung", () => {
  const p = player();
  const legs = page.legs(nfl, data([p]), RECORD, { now: NOW, floor: 0.6 });
  const rec = legs.find((l) => l.prop === "recyds");
  /* Hits: the model's own recentHits at the leg's rung over the last ten (seven games at 80, three at 15). */
  assert.deepEqual(rec.hits, { hits: nfl.recentHits("recyds", p.recent.slice(0, 10), rec.rung), n: 10 });
  assert.equal(rec.hits.hits, rec.rung <= 15 ? 10 : 7);
  /* The sheet: a WR's receiving yards read the defence's "to WR" line; top five only, with the rank and the field. */
  assert.deepEqual(rec.sheet, { key: "recYdsWR", label: "recYdsWR", rank: 2, of: null, v: 190, n: 3, one: false }, "a line ranked among the whole field carries a field count");
  const part = { side: "defence", field: 32, stats: stats(["rushYds"]), teams: { LAC: { rushYds: { v: 140, n: 3, rank: 1, of: 20 } } } };
  assert.equal(page.sheetLine(part, "LAC", "rushyds", "RB").of, 20, "a line ranked among fewer than the field does not say how many");
  const recs = legs.find((l) => l.prop === "recs");
  assert.equal(recs.sheet, null, "a 9th-ranked line is not a soft spot; the sheets stop at five");
  /* The record: the rung table's row for that rung with 15+ graded calls; said and hit. */
  if (rec.rung === 20) assert.deepEqual(rec.rec, { said: 64.3, hit: 65.6, n: 160 });
  const r150 = page.recordFor(RECORD, "recyds", 150); assert.equal(r150, null, "ten graded calls is a figure");
  assert.deepEqual(page.recordFor(RECORD, "recyds", 50), { said: 28, hit: 31.9, n: 160 });
  assert.equal(page.recordFor(RECORD, "rushyds", 50), null, "a stat the record has no table for");
  assert.deepEqual(page.recordFor(RECORD, "td", 1, 0.25), { lo: 20, said: 24.9, hit: 22.7, n: 247 }, "a touchdown reads the props band for its chance");
  assert.equal(page.recordFor(RECORD, "td", 1, 0.45), null);
  assert.equal(page.recordFor(null, "recyds", 20), null);
  /* No ten-game log: no count, not zero. */
  const bare = page.legs(nfl, data([player({ recent: p.recent.slice(0, 6) })]), RECORD, { now: NOW, floor: 0.6 }).find((l) => l.prop === "recyds");
  assert.equal(bare.hits, null);
});

test("legs: the sheet line by stat and position, and the stronger of two for rush + rec", () => {
  const sheet = page.sheetLine(DEFENCE, "LAC", "rushyds", "RB"); assert.equal(sheet.key, "rushYds"); assert.equal(sheet.rank, 1);
  assert.equal(page.sheetLine(DEFENCE, "LAC", "recyds", "TE"), null, "no TE line on the sheet");
  assert.equal(page.sheetLine(DEFENCE, "LAC", "recyds", "QB"), null, "a position without its own receiving line read a different stat");
  assert.equal(page.sheetLine(DEFENCE, "LAC", "rushrec", "WR").key, "rushYds", "rush + rec did not take the better-ranked of the two lines");
  assert.equal(page.sheetLine(DEFENCE, "LAC", "td", "WR").key, "recTdWR");
  assert.equal(page.sheetLine(DEFENCE, "LAC", "td", "RB"), null, "rushTd is not on this team's sheet");
  const rbTd = { side: "defence", field: 32, stats: stats(["rushTd", "recTdRB"]), teams: { LAC: { rushTd: { v: 3, n: 3, rank: 4, of: 32 }, recTdRB: { v: 2, n: 3, rank: 2, of: 32 } } } };
  assert.equal(page.sheetLine(rbTd, "LAC", "td", "RB").key, "recTdRB", "a back's touchdown reads the rushing line only; the sheet also ranks touchdowns caught by backs");
  assert.equal(page.sheetLine(DEFENCE, "KC", "recyds", "WR"), null, "30th is not soft");
  assert.equal(page.sheetLine(null, "LAC", "recyds", "WR"), null);
});

test("legs: the gates are the board's: ruled out, no opponent, a game played or kicked off, and the floor on a touchdown", () => {
  const p = player();
  const d = data([p, player({ id: "p2", name: "Out Man", status: "Out" }), player({ id: "p3", name: "No Opp", opp: undefined }), player({ id: "p4", name: "Done", team: "CLE", opp: "PIT" })]);
  const legs = page.legs(nfl, d, RECORD, { now: NOW, floor: 0.6 });
  assert.deepEqual([...new Set(legs.map((l) => l.name))], ["Alpha Wide"], "a ruled-out, opponent-less or finished player got a leg");
  const started = page.legs(nfl, d, RECORD, { now: Date.parse("2026-10-04T17:00:01Z"), floor: 0.6 });
  assert.equal(started.length, 0, "a game at kickoff is still open");
  /* The touchdown has one rung, so the floor (which picks a rung) does not apply: its leg is listed at its own chance, in its own family. */
  const td = legs.find((l) => l.prop === "td");
  assert.ok(td, "the touchdown leg is missing at a 60% floor");
  assert.ok(td.prob < 0.6, "the fixture's touchdown chance is not under the floor: " + td.prob);
  assert.deepEqual(page.legs(nfl, d, RECORD, { now: NOW, floor: 0.9 }).filter((l) => l.prop === "td").map((l) => l.prob), [td.prob], "the floor moved the touchdown leg");
  assert.equal(td.propLabel, "Anytime TD"); assert.equal(td.rung, 1);
  assert.equal(td.hits.hits, 3, "the touchdown count is not the model's recentTdHits");
  assert.equal(page.legs(nfl, { players: [] }, RECORD, { now: NOW }).length, 0);
  assert.equal(page.legs(null, d, RECORD, { now: NOW }).length, 0);
});

test("filter: families, the consistency floor and the soft-opponent switch", () => {
  const legs = [
    { prop: "recyds", hits: { hits: 8, n: 10 }, sheet: { rank: 2 } },
    { prop: "recs", hits: { hits: 6, n: 10 }, sheet: null },
    { prop: "td", hits: null, sheet: { rank: 1 } },
  ];
  const all = page.cleanState({ fams: page.FAMILIES.map((f) => f.id) });
  assert.equal(page.filter(legs, all).length, 2, "the default six-of-ten floor kept a leg without a count");
  assert.equal(page.filter(legs, Object.assign({}, all, { hits: 0 })).length, 3);
  assert.deepEqual(page.filter(legs, Object.assign({}, all, { hits: 8 })).map((l) => l.prop), ["recyds"]);
  assert.deepEqual(page.filter(legs, Object.assign({}, all, { hits: 0, soft: true })).map((l) => l.prop), ["recyds", "td"]);
  assert.deepEqual(page.filter(legs, Object.assign({}, all, { hits: 0, fams: ["recs", "td"] })).map((l) => l.prop), ["recs", "td"]);
  assert.deepEqual(page.filter(legs, page.cleanState({ hits: 0 })).map((l) => l.prop), ["recyds", "recs"], "the touchdown family is on by default; its legs sit at 20–45% and would drag a slip");
});

test("cleanState: the defaults, and every bad value falls to one", () => {
  assert.deepEqual(page.cleanState(null), { legs: 3, scope: "slate", floor: 0.7, hits: 6, soft: false, fams: page.DEFAULT_FAMS });
  assert.deepEqual(page.DEFAULT_FAMS, ["recyds", "recs", "rushyds", "rushrec", "passyds"], "the default set is not every family but the touchdown");
  assert.deepEqual(page.cleanState({ legs: "5", scope: "players", floor: "0.8", hits: "8", soft: "1", fams: "td,recs,nope" }), { legs: 5, scope: "players", floor: 0.8, hits: 8, soft: true, fams: ["td", "recs"] });
  const bad = page.cleanState({ legs: 9, scope: "x", floor: 0.65, hits: 7, soft: "0", fams: "" });
  assert.deepEqual([bad.legs, bad.scope, bad.floor, bad.hits, bad.soft], [3, "slate", 0.7, 6, false]);
  assert.deepEqual(bad.fams, page.DEFAULT_FAMS, "no family at all is the default set, not none");
  assert.deepEqual(page.cleanState({ fams: ["recyds", "recyds"] }).fams, ["recyds"]);
});

test("controlsHtml: labelled segmented groups carrying their state, the families pressed as a set", () => {
  const h = page.controlsHtml(page.cleanState({ legs: 4, floor: 0.8, fams: ["td", "recyds"] }));
  assert.match(h, /<label id="lab-pcount">Legs<\/label><div class="seg" id="pcount" role="group" aria-labelledby="lab-pcount">/);
  /* No control carries a host's id: a second render on a real document would find the control first and write the list into it (it did, 2026-10-04). */
  for (const id of page.HOSTS) assert.doesNotMatch(h, new RegExp('id="' + id + '"'), "a control carries the host id " + id);
  assert.deepEqual(page.HOSTS, ["pcontrols", "pslip", "plegs", "pfoot"]);
  assert.match(h, /<button type="button" data-legs="4" aria-pressed="true">4<\/button>/);
  assert.match(h, /<button type="button" data-legs="3" aria-pressed="false">3<\/button>/);
  assert.match(h, /data-floor="0.8" aria-pressed="true">80%\+<\/button>/);
  assert.match(h, /data-scope="slate" aria-pressed="true">One leg a game<\/button>/);
  assert.match(h, /data-hits="6" aria-pressed="true">6 of 10<\/button>/);
  assert.match(h, /data-soft="1" aria-pressed="false">Soft defence only<\/button>/);
  assert.match(h, /data-fam="td" aria-pressed="true">Anytime TD<\/button>/);
  assert.match(page.controlsHtml(page.cleanState({})), /data-fam="td" aria-pressed="false">Anytime TD<\/button>/, "the touchdown family is pressed by default");
  assert.match(page.controlsHtml(page.cleanState({})), /data-fam="rushrec" aria-pressed="true">Rush \+ rec yards<\/button>/);
  assert.match(h, /data-fam="recs" aria-pressed="false">Receptions<\/button>/);
  for (const id of ["pcount", "pscope", "pfloor", "phits", "psoft", "pfams"]) assert.match(h, new RegExp('aria-labelledby="lab-' + id + '"'), "no label for " + id);
});

test("buildSlip: the best leg of each family in turn, one a game or one a player, the measured props only; refuses short", () => {
  const L = (key, playerId, gameId, team, prop, prob, over) => Object.assign({ key, playerId, gameId, team, opp: "X", name: key, pos: "WR", prop, rung: 20, prob, propLabel: prop + " 20+", hits: null, sheet: null, rec: null }, over || {});
  const list = [
    L("a-recs", "a", "g1", "KC", "recs", 0.9), L("a-recyds", "a", "g1", "KC", "recyds", 0.8), L("b-recyds", "b", "g2", "DEN", "recyds", 0.78),
    L("c-rushyds", "c", "g3", "SF", "rushyds", 0.76), L("d-rushrec", "d", "g4", "LV", "rushrec", 0.95), L("e-recs", "e", "g5", "NO", "recs", 0.74),
  ];
  const lift = nfl.DEFAULTS.parlayLift, eligible = nfl.DEFAULTS.parlayProps;
  const s3 = page.buildSlip(list, page.cleanState({ legs: 3, fams: ["recs", "recyds", "rushyds", "rushrec"] }), { parlay, lift, eligible });
  assert.deepEqual(s3.legs.map((l) => l.key), ["a-recs", "b-recyds", "c-rushyds"], "not one leg a family, the families in the order of their best leg, one a game");
  assert.deepEqual(s3.skipped, ["rushrec"], "a prop the replay has not measured in a parlay was put in the slip");
  assert.equal(s3.combined.correlation, "none"); assert.equal(s3.combined.distinctGames, 3);
  /* More legs than families: the second pass takes each family's next leg, still one a game. */
  const s4 = page.buildSlip(list, page.cleanState({ legs: 4, fams: ["recs", "recyds", "rushyds"] }), { parlay, lift, eligible });
  assert.deepEqual(s4.legs.map((l) => l.key), ["a-recs", "b-recyds", "c-rushyds", "e-recs"], "the second pass is not the families again in turn");
  /* Any games: one a player; a's receiving yards is his second leg, so it is skipped for the next player's. */
  const sp = page.buildSlip(list, page.cleanState({ legs: 4, scope: "players", fams: ["recs", "recyds", "rushyds"] }), { parlay, lift, eligible });
  assert.deepEqual(sp.legs.map((l) => l.key), ["a-recs", "b-recyds", "c-rushyds", "e-recs"]);
  assert.equal(page.buildSlip(list, page.cleanState({ legs: 5, fams: ["recs", "recyds", "rushyds"] }), { parlay, lift, eligible }), null, "four legs answered a five-leg question");
  assert.equal(page.buildSlip([], page.cleanState({ legs: 2 }), { parlay, lift, eligible }), null);
  /* Without an eligible list every prop is in. */
  const free = page.buildSlip(list, page.cleanState({ legs: 2, fams: ["rushrec", "recs"] }), { parlay, lift });
  assert.deepEqual(free.legs.map((l) => l.key), ["d-rushrec", "a-recs"]); assert.deepEqual(free.skipped, []);
});

test("slipHtml and legsHtml: the legs with their evidence, the product, the fair price, the correlation note, the family sections; escaping", () => {
  const leg = { key: "g1|p1|recyds", playerId: "p1", gameId: "g1", team: "KC", opp: "LAC", name: "A <b>Wide", pos: "WR", prop: "recyds", rung: 20, prob: 0.805, propLabel: "20+ receiving yards",
    hits: { hits: 7, n: 10 }, sheet: { key: "recYdsWR", label: "Rec yards to WR", rank: 2, of: null, v: 190, n: 3, one: false }, rec: { said: 64.3, hit: 65.6, n: 160 } };
  const leg2 = { key: "g2|p9|rushyds", playerId: "p9", gameId: "g2", team: "DEN", opp: "LV", name: "Back Man", pos: "RB", prop: "rushyds", rung: 50, prob: 0.72, propLabel: "50+ rushing yards", hits: null, sheet: null, rec: null };
  const td = { key: "g2|p8|td", playerId: "p8", gameId: "g2", team: "LV", opp: "DEN", name: "Six Points", pos: "RB", prop: "td", rung: 1, prob: 0.33, propLabel: "Anytime TD", hits: { hits: 5, n: 10 }, sheet: { key: "rushTd", label: "Rushing TD", rank: 1, of: 20, v: 5, n: 1, one: true }, rec: { lo: 30, said: 34.4, hit: 23.9, n: 109 } };
  const state = page.cleanState({ legs: 2, fams: ["recyds", "rushyds"] });
  const s = page.buildSlip([leg, leg2], state, { parlay, lift: nfl.DEFAULTS.parlayLift, eligible: nfl.DEFAULTS.parlayProps });
  const h = page.slipHtml(s, state, { lift: nfl.DEFAULTS.parlayLift, model: nfl });
  assert.match(h, /<h3>Suggested parlay — 2 legs · from 2 different games<\/h3>/);
  assert.match(h, /best leg of each prop family in turn/);
  assert.match(h, /A &lt;b&gt;Wide/); assert.doesNotMatch(h, /<b>Wide/);
  assert.match(h, /KC vs LAC · 20\+ receiving yards/);
  assert.match(h, /7 of his last 10 at 20\+/);
  assert.match(h, /LAC allows the 2nd-most Rec yards to WR ·/i, "the field count is printed for a line ranked among the whole field");
  assert.match(h, /at 20\+ the record said 64% and hit 66% of 160/);
  assert.match(h, /no ten-game log/); assert.match(h, /not a soft spot on the sheets/); assert.match(h, /the record has under 15 graded calls at 50\+/);
  assert.match(h, new RegExp((100 * 0.805 * 0.72).toFixed(1) + "%"), "the product is not printed to the board's one decimal");
  assert.match(h, /fair price/); assert.match(h, /Legs from different games multiply honestly/);
  assert.match(h, /id="slipprice"/);
  assert.doesNotMatch(h, / o\d/, "an over line");
  assert.doesNotMatch(h, /rush \+ rec/i, "a skipped family is named when none was skipped");
  const sk = page.slipHtml(Object.assign({}, s, { skipped: ["rushrec"] }), state, { lift: nfl.DEFAULTS.parlayLift, model: nfl });
  assert.match(sk, /Rush \+ rec yards legs are listed but kept out of the slip: the replay has not measured them in a parlay/);
  const none = page.slipHtml(null, page.cleanState({ legs: 5 }), { reason: "Only 2 games still open" });
  assert.match(none, /Cannot build that slip/); assert.match(none, /Only 2 games still open/);
  /* The list: a section a family in the control's order, each ranked by chance, ten rows and the cut; the record fact framed at its rung. */
  const list = page.legsHtml([leg2, leg, td], page.cleanState({ fams: ["td", "recyds", "rushyds"] }), {});
  const secs = [...list.matchAll(/<section class="cgroup"><h2 class="gtitle">([^<]+)<\/h2>/g)].map((m) => m[1]);
  assert.deepEqual(secs, ["Anytime TD", "Receiving yards", "Rushing yards"], "the sections are not the families on, in order");
  assert.equal((list.match(/<ol class="plegs">/g) || []).length, 3); assert.equal((list.match(/<li>/g) || []).length, 3);
  assert.match(list, new RegExp((100 * 0.805).toFixed(0) + "%<\\/b>")); assert.match(list, /20\+ receiving yards/); assert.match(list, /7\/10/); assert.match(list, /2nd Rec yards to WR/);
  assert.match(list, /at 20\+ said 64% · hit 66%/, "the record fact is not framed at its rung; a reader compares it with this leg's chance");
  assert.match(list, /at 30–40% said 34% · hit 24%/, "the touchdown's record fact is not framed at its band");
  assert.match(list, /<span class="one">1st Rushing TD of 20 \(one game\)<\/span>/, "a one-game line is painted as a soft spot rather than the sample-size caution");
  assert.match(list, /<span class="up">2nd Rec yards to WR<\/span>/);
  assert.match(page.legsHtml([leg], page.cleanState({ fams: ["recyds", "recs"] }), {}), /<h2 class="gtitle">Receptions<\/h2><p class="cnone">Nobody clears the filters at this floor\.<\/p>/, "an empty family does not say so");
  const many = Array.from({ length: 30 }, (_, i) => Object.assign({}, leg2, { key: "k" + i, name: "P" + i, prob: 0.9 - i / 1000 }));
  const big = page.legsHtml(many, page.cleanState({ fams: ["rushyds"] }), {});
  assert.equal((big.match(/<li>/g) || []).length, page.LISTED, "a family's list is not capped");
  assert.match(big, new RegExp("\\+" + (30 - page.LISTED) + " more under "));
  assert.match(page.legsHtml([], page.cleanState({}), {}), /No leg clears/);
});

test("render: the controls, the slip from the filtered legs, every leg listed, the caveat; one listener; the URL told when the state is cleaned", () => {
  const made = (id) => ({ id, innerHTML: "", listeners: {}, addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); } });
  const els = { pcontrols: made("pcontrols"), pslip: made("pslip"), plegs: made("plegs"), pfoot: made("pfoot") };
  const doc = { getElementById: (id) => els[id] || null };
  const p1 = player(), p2 = player({ id: "p2", name: "Bravo Back", team: "DEN", opp: "LV", pos: "RB", carries: 180, targets: 30, recYds: 200, recs: 24, rushYds: 800, tds: 7,
    recent: ten((i) => row(10, 2, i < 9 ? 70 : 20, 0, i < 5 ? 1 : 0)) });
  const p3 = player({ id: "p3", name: "Charlie Catch", team: "LV", opp: "DEN", pos: "TE", targets: 60, recYds: 500, recs: 44, recent: ten((i) => row(i < 8 ? 55 : 10, i < 9 ? 4 : 1, 0, 0, 0)) });
  const d = data([p1, p2, p3]);
  const changes = [];
  page.render(doc, { data: d, model: nfl, record: RECORD, parlay, now: NOW, state: { legs: 2, floor: "0.6", hits: 0 }, onState: (s) => changes.push(s) });
  assert.match(els.pcontrols.innerHTML, /data-legs="2" aria-pressed="true"/);
  assert.match(els.pslip.innerHTML, /Suggested parlay — 2 legs · from 2 different games/);
  assert.match(els.pslip.innerHTML, /Alpha Wide/, "the slate's best leg in game one");
  assert.equal((els.pslip.innerHTML.match(/class="leg"/g) || []).length, 2, "one leg a game from two games is two legs");
  assert.match(els.plegs.innerHTML, /<section class="cgroup"><h2 class="gtitle">Receiving yards<\/h2><ol class="plegs">/);
  assert.doesNotMatch(els.plegs.innerHTML, /Anytime TD/, "the touchdown family is listed when it is off");
  assert.match(els.pfoot.innerHTML, /before week 4 of 2026/);
  assert.equal(changes.length, 0, "a clean state was reported as cleaned");
  /* Three legs from two games: the slate scope refuses and says why, and points at the other scope. */
  page.render(doc, { data: d, model: nfl, record: RECORD, parlay, now: NOW, state: { legs: 3, floor: 0.6, hits: 0 }, onState: (s) => changes.push(s) });
  assert.match(els.pslip.innerHTML, /Cannot build that slip/); assert.match(els.pslip.innerHTML, /Only 2 games/); assert.match(els.pslip.innerHTML, /Try any games/);
  /* Any games: one leg a player, so three players in two games make three legs, two of them in one game, and the correlation is said. */
  page.render(doc, { data: d, model: nfl, record: RECORD, parlay, now: NOW, state: { legs: 3, floor: 0.6, hits: 0, scope: "players" } });
  assert.match(els.pslip.innerHTML, /Suggested parlay — 3 legs · one leg a player, any games/);
  assert.equal((els.pslip.innerHTML.match(/class="leg"/g) || []).length, 3);
  assert.match(els.pslip.innerHTML, /slipwarn game/, "two legs in one game on different teams is not the game class");
  /* Four legs from three players: refused, one a player. */
  page.render(doc, { data: d, model: nfl, record: RECORD, parlay, now: NOW, state: { legs: 4, floor: 0.6, hits: 0, scope: "players" } });
  assert.match(els.pslip.innerHTML, /Only 3 players/);
  assert.equal(els.pcontrols.listeners.click.length, 1, "render added a second listener");
  /* A click on a control redraws from the host's state and reports it. */
  const click = els.pcontrols.listeners.click[0]; const later = [];
  page.render(doc, { data: d, model: nfl, record: RECORD, parlay, now: NOW, state: { legs: 2, floor: 0.6, hits: 0 }, onState: (s) => later.push(s) });
  click({ target: { closest: (sel) => (sel === "[data-floor]" ? { getAttribute: () => "0.9" } : null) } });
  assert.equal(later.at(-1).floor, 0.9);
  assert.match(els.pcontrols.innerHTML, /data-floor="0.9" aria-pressed="true"/);
  click({ target: { closest: (sel) => (sel === "[data-fam]" ? { getAttribute: () => "recyds" } : null) } });
  assert.ok(!later.at(-1).fams.includes("recyds"), "a pressed family did not toggle off");
  click({ target: { closest: (sel) => (sel === "[data-fam]" ? { getAttribute: () => "recyds" } : null) } });
  assert.ok(later.at(-1).fams.includes("recyds"), "a family did not toggle back on");
  /* The last family on cannot be switched off: the click is refused, nothing redraws, nothing is reported. */
  page.render(doc, { data: d, model: nfl, record: RECORD, parlay, now: NOW, state: { legs: 2, floor: 0.6, hits: 0, fams: "recs" }, onState: (s) => later.push(s) });
  const n = later.length;
  click({ target: { closest: (sel) => (sel === "[data-fam]" ? { getAttribute: () => "recs" } : null) } });
  assert.equal(later.length, n, "the last family off was reported"); assert.match(els.pcontrols.innerHTML, /data-fam="recs" aria-pressed="true"/);
  click({ target: { closest: (sel) => (sel === "[data-soft]" ? { getAttribute: () => "1" } : null) } });
  assert.equal(later.at(-1).soft, true);
  /* A bad state is cleaned and the page says so once. */
  const norm = [];
  page.render(doc, { data: d, model: nfl, record: RECORD, parlay, now: NOW, state: { legs: 42 }, onState: (s) => norm.push(s) });
  assert.equal(norm.length, 1); assert.equal(norm[0].legs, 3);
  /* The price typed on the slip: the change listener keeps it on the host, redraws with the edge, and survives a control click. */
  page.render(doc, { data: d, model: nfl, record: RECORD, parlay, edge: { evPct: (p, dec) => 100 * (p * dec - 1), americanToDecimal: (a) => (a > 0 ? 1 + a / 100 : 1 + 100 / -a), formatPct: (x) => (x >= 0 ? "+" : "") + x.toFixed(1) + "%" }, now: NOW, state: { legs: 2, floor: 0.6, hits: 0 } });
  assert.equal(els.pslip.listeners.change.length, 1, "render added a second price listener");
  els.pslip.listeners.change[0]({ target: { id: "slipprice", value: "150" } });
  assert.match(els.pslip.innerHTML, /value="150"/); assert.match(els.pslip.innerHTML, /edge at that price/);
  click({ target: { closest: (sel) => (sel === "[data-legs]" ? { getAttribute: () => "2" } : null) } });
  assert.match(els.pslip.innerHTML, /value="150"/, "a control click lost the typed price");
  els.pslip.listeners.change[0]({ target: { id: "slipprice", value: "" } });
  assert.doesNotMatch(els.pslip.innerHTML, /edge at that price/, "a cleared price keeps an edge");
  /* No board: the controls hide and the page says so. */
  page.render(doc, { data: null, model: nfl, parlay });
  assert.equal(els.pcontrols.hidden, true); assert.match(els.plegs.innerHTML, /No board/); assert.equal(els.pslip.innerHTML, "");
});
