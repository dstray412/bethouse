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
  assert.equal(big.length, 15, "more than fifteen a card");
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
