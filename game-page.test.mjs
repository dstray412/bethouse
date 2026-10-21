/*
 * BetHouse — game-page.test.mjs
 * One game's preview page: the game found by its id, the head's
 * projection beside the market's line, and four sections each handed
 * to the module that already draws it (teams-page, tendencies-core,
 * sheet-page, consistency-page), restricted to the two teams.
 *
 * Oracles: the data file's shape (games[], players[], defence/offence
 * sheets, ratings), the modules' own output on the same input, and the
 * rule that a module that did not load is a section not shown.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import page from "./game-page.js";
import nfl from "./nfl.js";
import core from "./tendencies-core.js";
import teamsPage from "./teams-page.js";
import sheetPage from "./sheet-page.js";
import consistency from "./consistency-page.js";

const row = (recYds, recs, rushYds, passYds, tds, date, team) => [date || "260928", "DEN", recYds, recs, rushYds, passYds, tds, team || "KC"];
const ten = (f) => Array.from({ length: 10 }, (_, i) => f(i));
const PLAYERS = [
  { id: "a", name: "Alpha Wide", team: "KC", pos: "WR", opp: "LAC", recent: ten((i) => row(i < 9 ? 80 : 20, i < 7 ? 6 : 2, 0, 0, i < 4 ? 1 : 0)) },
  { id: "b", name: "Bravo Back", team: "LAC", pos: "RB", opp: "KC", recent: ten((i) => row(10, 1, i < 8 ? 60 : 30, 0, i < 6 ? 1 : 0)) },
  { id: "z", name: "Zulu Other", team: "DEN", pos: "RB", opp: "LV", recent: ten(() => row(10, 1, 100, 0, 1)) },
];
const prof = (o) => Object.assign({ playsPerGame: 64, passRate: 0.58, proe: 0, epaPerPlay: 0, epaPerPass: 0, epaPerRush: 0, blitzRate: 0.3, deepRate: 0.12, shortRate: 0.88, insideRunShare: 0.6, outsideRunShare: 0.4, playActionRate: 0.25, deepEpa: 0, shortEpa: 0, insideRunEpa: 0, outsideRunEpa: 0, paEpa: 0, blitzEpa: 0 }, o);
const TEND = { K: 6, through: { season: 2026, week: 6 }, current: {
  off: { KC: prof({ epaPerPlay: 0.2, deepRate: 0.2 }), LAC: prof({ epaPerPlay: -0.1 }), DEN: prof({ epaPerPlay: 0.1 }) },
  def: { KC: prof({ epaPerPlay: -0.1 }), LAC: prof({ epaPerPlay: 0.1, deepEpa: 0.5 }), DEN: prof({}) },
  league: prof({}) } };
const SHEET = { through: { season: 2026, week: 6 }, field: 32, stats: { passYds: { label: "Pass yards", soft: "most", kind: "mean" } },
  teams: { KC: { passYds: { v: 276, n: 6, rank: 3, of: 32 } }, LAC: { passYds: { v: 180, n: 6, rank: 30, of: 32 } }, DEN: { passYds: { v: 300, n: 6, rank: 1, of: 32 } } } };
const GAME = { id: "401", date: "2026-10-23T00:15Z", completed: false, home: "LAC", away: "KC", venue: "SoFi", line: { spread: -3, total: 50.5, homeML: -148, awayML: 124, homeSpreadOdds: -102, book: "Draft Kings" } };
const DATA = { season: 2026, week: 7, generated: "2026-10-20T17:04:00Z", games: [GAME, { id: "402", date: "2026-10-25T17:00Z", home: "DEN", away: "LV" }], players: PLAYERS,
  ratings: { off: { KC: 3, LAC: -1, DEN: 0 }, def: { KC: 0, LAC: 2, DEN: 1 }, league: 21, homeField: 2 }, defence: { ...SHEET, side: "def" }, offence: { ...SHEET, side: "off" } };
const H = { teamsPage, sheetPage, consistencyPage: consistency, league: "NFL" };

test("find and players: the game by its id as a string or a number, and the players on either side only", () => {
  assert.equal(page.find(DATA, "401"), GAME);
  assert.equal(page.find(DATA, 401), GAME, "a number from a URL still matches the file's string");
  assert.equal(page.find(DATA, "999"), null); assert.equal(page.find(DATA, ""), null); assert.equal(page.find(null, "401"), null);
  assert.deepEqual(page.players(DATA, GAME).map((p) => p.id), ["a", "b"], "a player in another game is on the page");
  assert.deepEqual(page.players(DATA, null), []);
});

test("head: the week, the matchup, the model's projection and the market's line as numbers, never a price; the caveat travels with them", () => {
  const h = page.headHtml(GAME, DATA, nfl, H);
  assert.match(h, /^<div class="week gphead"><span class="kick">Week 7 · /, "the kicker is not the week line's");
  /* The fetcher writes null for a number ESPN did not have: it must not print. */
  const half = page.headHtml({ ...GAME, line: { spread: -3, total: null, book: "Draft Kings" } }, DATA, nfl, H);
  assert.match(half, /The market has LAC <b>-3<\/b> \(Draft Kings\)/); assert.doesNotMatch(half, /null/, "a null total printed");
  assert.doesNotMatch(page.headHtml({ ...GAME, line: { spread: null, total: null } }, DATA, nfl, H), /The market has|null/, "a line with no numbers is a market sentence");
  assert.match(h, /<h2>KC<span class="at">at<\/span>LAC<\/h2>/);
  assert.match(h, /SoFi/);
  const pr = nfl.projectGame(DATA.ratings, "LAC", "KC", { neutral: false, wind: undefined, indoor: false });
  assert.match(h, new RegExp("projects <b>LAC " + pr.homePts.toFixed(1) + "</b> — <b>KC " + pr.awayPts.toFixed(1) + "</b>"), "the projection is not the model's");
  assert.match(h, /total <b>50\.5<\/b> \(Draft Kings\)/, "the market's total is not shown");
  assert.match(h, /LAC <b>-3<\/b>/, "the market's spread is not shown");
  assert.doesNotMatch(h, /-148|124|-102|price|odds/, "a price on the head");
  assert.match(h, /neither the favourite nor the lines beat the market/, "the replay's verdict does not travel with the numbers");
  assert.equal(page.headHtml(null, DATA, nfl, H), "");
  const bare = page.headHtml({ ...GAME, line: null }, { week: 7 }, null, {});
  assert.doesNotMatch(bare, /<p>/, "a sentence with no projection and no line");
  const hostile = page.headHtml({ ...GAME, venue: "<img src=x>" }, DATA, nfl, H);
  assert.match(hostile, /&lt;img src=x&gt;/); assert.doesNotMatch(hostile, /<img/);
});

test("ratings: the teams page's two tables for the two teams only, every rank still among the league; nothing without the module or profiles", () => {
  const h = page.ratingsHtml(TEND, core, GAME, H);
  assert.equal((h.match(/<table class="teams">/g) || []).length, 2, "not the offence and the defence tables");
  assert.match(h, /data-view="off"[\s\S]*Offence[\s\S]*data-view="def"[\s\S]*Defence/);
  assert.doesNotMatch(h, /<b>DEN<\/b>/, "a third team on the page");
  const all = teamsPage.rows(TEND, core);
  const kc = all.find((r) => r.team === "KC");
  assert.ok(h.includes("<b>" + esc(teamsPage.COLUMNS.find((c) => c.key === "epaPerPlay").fmt(kc.epaPerPlay)) + "</b><small>1st of 3</small>"), "KC's rank is not its place among all three profiled teams");
  assert.equal(page.ratingsHtml(TEND, core, GAME, {}), "", "without teams-page.js there is no table");
  assert.equal(page.ratingsHtml(null, core, GAME, H), "");
  assert.equal(page.ratingsHtml(TEND, core, { ...GAME, home: "QQQ", away: "ZZZ" }, H), "", "two unprofiled teams show nothing");
  assert.match(page.ratingsHtml(TEND, core, { ...GAME, home: "QQQ" }, H), /Only KC has a profile/, "one unprofiled side is said");
  const sorted = page.ratingsHtml(TEND, core, GAME, H, { off: "team" });
  assert.match(sorted, /data-sort="team" aria-pressed="true"/, "the offence table ignores the sort");
});

test("matchup: each offence against the defence it faces, only the families past the core's thresholds, in the core's sentences; nothing without profiles", () => {
  const h = page.matchupHtml(TEND, core, GAME);
  assert.match(h, /KC offence vs LAC defence[\s\S]*LAC offence vs KC defence/, "both directions, away first");
  /* LAC allows +0.5 EPA on deep passes (league 0): soft; KC throws deep 20% against 12%: leans in. */
  assert.match(h, /<b>deep pass<\/b><span class="tag soft">soft<\/span><span class="tag lean">leans in<\/span><span>/, "the tags are not the core's thresholds");
  const e = core.matchup(TEND.current.off.KC, TEND.current.def.LAC, TEND.current.league).find((x) => x.family === "deep pass");
  assert.ok(h.includes(esc(core.describe(e, { off: "KC", def: "LAC" }))), "the sentence is not the core's");
  assert.match(h, /LAC offence vs KC defence<\/div><p class="mline">Nothing either side leans into/, "an even matchup is not said");
  assert.ok(h.includes("through week 6") && h.includes("leans in</b> to a family it uses " + Math.round(100 * core.LEAN_SHARE) + " points") && h.includes("allows " + core.SOFT_EPA + " EPA"), "the foot does not say the core's thresholds");
  assert.doesNotMatch(h, /fair price|odds|-110/i, "a price on the matchup");
  assert.equal(page.matchupHtml(null, core, GAME), ""); assert.equal(page.matchupHtml(TEND, null, GAME), "");
  assert.equal(page.matchupHtml(TEND, core, { ...GAME, home: "QQQ", away: "ZZZ" }), "");
});

test("cheat sheet and consistency: the sheet module's list for the game, and the consistency module's cards for the game's players only", () => {
  const c = page.cheatHtml(DATA, GAME, H);
  assert.match(c, /^<div class="mu cheat"><ul class="slines">/);
  assert.ok(c.includes(sheetPage.listHtml(DATA.defence, DATA.offence, GAME).html), "the list is not the sheet module's");
  assert.match(c, /through week 6, the top five of 32/);
  assert.equal(page.cheatHtml({}, GAME, H), ""); assert.equal(page.cheatHtml(DATA, GAME, {}), "");
  const k = page.consistencyHtml(nfl, DATA, GAME, H);
  assert.match(k, /^<div class="cons cgrid"><section class="ccard">/);
  assert.match(k, /Alpha Wide[\s\S]*Bravo Back/, "the game's players are missing");
  assert.doesNotMatch(k, /70\+ receiving yards|100\+ receiving yards/, "a higher rung repeats the same player's games: one card a prop, at its lowest rung");
  assert.match(k, /50\+ receiving yards[\s\S]*4\+ receptions[\s\S]*50\+ rushing yards/, "the props' lowest rungs are missing");
  assert.doesNotMatch(k, /Zulu Other/, "a player from another game is on the card");
  assert.doesNotMatch(k, /Nobody at six hits/, "an empty rung is a card");
  const r = consistency.RUNGS.find((x) => x.id === "recyds50");
  assert.ok(k.includes(consistency.cardHtml(r, consistency.rows(nfl, PLAYERS.slice(0, 2), r, 2026, 5), H, 5)), "a card is not the consistency module's");
  assert.equal(page.consistencyHtml(nfl, DATA, GAME, {}), ""); assert.equal(page.consistencyHtml(null, DATA, GAME, H), "");
});

/* A stub document: hosts by id, hidden flags, a title. */
const stubDoc = () => {
  const els = {};
  const el = (id) => (els[id] = els[id] || { id, innerHTML: "", hidden: false, listeners: {}, addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); } });
  for (const id of ["ghead", "ratings", "ratingssec", "matchup", "matchupsec", "cheat", "cheatsec", "cons", "conssec", "gfoot"]) el(id);
  return { title: "", getElementById: (id) => els[id] || null, els };
};

test("render: the head, four sections each hidden when empty, the title, the foot; an unknown id is an empty state; a column head re-sorts its own table", () => {
  const doc = stubDoc();
  page.render(doc, { ...H, data: DATA, model: nfl, tend: TEND, core, id: "401" });
  assert.equal(doc.title, "KC at LAC · BetHouse");
  assert.match(doc.els.ghead.innerHTML, /^<div class="week gphead">/);
  for (const s of page.SECTIONS) { assert.equal(doc.els[s.id + "sec"].hidden, false, s.id + " hidden with content"); assert.ok(doc.els[s.id].innerHTML.length, s.id + " is empty"); }
  assert.match(doc.els.gfoot.innerHTML, /2026-10-20 17:04 UTC/);
  /* Re-sort the offence table by team: only that table's pressed head moves. */
  const head = { getAttribute: (k) => ({ "data-sort": "team" }[k]), closest: (sel) => (sel === "[data-sort]" ? head : { getAttribute: () => "off" }) };
  const before = doc.els.cons.innerHTML; doc.els.cons.innerHTML = "kept";
  doc.els.ratings.listeners.click[0]({ target: head });
  assert.equal(doc.els.cons.innerHTML, "kept", "a sort redrew a section it does not touch"); doc.els.cons.innerHTML = before;
  assert.match(doc.els.ratings.innerHTML, /data-view="off"[\s\S]*data-sort="team" aria-pressed="true"[\s\S]*data-view="def"[\s\S]*data-sort="defEpaPerPlay" aria-pressed="true"/, "the sort did not stay on its own table");
  /* Without the profiles or the sheets, those sections hide and the rest stand. */
  const thin = stubDoc();
  page.render(thin, { ...H, data: { ...DATA, defence: null, offence: null }, model: nfl, tend: null, core, id: "401" });
  assert.equal(thin.els.ratingssec.hidden, true); assert.equal(thin.els.matchupsec.hidden, true); assert.equal(thin.els.cheatsec.hidden, true); assert.equal(thin.els.conssec.hidden, false);
  const none = stubDoc();
  page.render(none, { ...H, data: DATA, model: nfl, tend: TEND, core, id: "999" });
  assert.match(none.els.ghead.innerHTML, /No such game on the board/);
  for (const s of page.SECTIONS) assert.equal(none.els[s.id + "sec"].hidden, true);
});

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
