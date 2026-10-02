/*
 * BetHouse — sheet-page.test.mjs
 * The cheat sheets: for each open game, what the two defences allow most
 * (or the two offences do most), from the sheet the fetcher computed. Oracle: the sheet's
 * own ranks (defenceSheet's test) and the page's stated rules: only the
 * top five places, both defences in one list by rank, a one-game split
 * marked, nothing on a game whose defences have no sheet.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import page from "./sheet-page.js";

const SHEET = {
  through: { season: 2026, week: 3 }, field: 32,
  stats: { passYds: { label: "Pass yards", soft: "most", kind: "mean" }, passYdsAway: { label: "Pass yards on the road", soft: "most", kind: "mean" }, passTd: { label: "Passing TD", soft: "most", kind: "total" }, takeaways: { label: "Takeaways", soft: "fewest", kind: "total" }, compPct: { label: "Pass comp %", soft: "most", kind: "pct" } },
  teams: {
    IND: { passYds: { v: 276, n: 3, rank: 3, of: 32 }, passYdsAway: { v: 371, n: 1, rank: 1, of: 16 }, passTd: { v: 4, n: 3, rank: 12, of: 32 }, takeaways: { v: 1, n: 3, rank: 2, of: 32 }, compPct: { v: 70.6, n: 3, rank: 4, of: 32 } },
    WSH: { passYds: { v: 280.3, n: 3, rank: 2, of: 32 }, passTd: { v: 11, n: 3, rank: 1, of: 32 }, takeaways: { v: 5, n: 3, rank: 1, of: 32 }, compPct: { v: 61, n: 3, rank: 15, of: 32 } },
    ZZZ: { passYds: { v: 100, n: 3, rank: 32, of: 32 } },
  },
};
const GAMES = [
  { id: "g1", home: "WSH", away: "IND", date: "2026-10-04T13:30Z", completed: false },
  { id: "g2", home: "ZZZ", away: "QQQ", date: "2026-10-04T17:00Z", completed: false },
  { id: "g0", home: "IND", away: "WSH", date: "2026-09-27T17:00Z", completed: true },
];

test("lines: the top five places for a defence, soft end first, ranks shared across the two defences of a game", () => {
  const ind = page.lines(SHEET, "IND");
  assert.deepEqual(ind.map((l) => [l.rank, l.key]), [[1, "passYdsAway"], [2, "takeaways"], [3, "passYds"], [4, "compPct"]], "not the top five places in rank order");
  assert.equal(ind[0].one, true, "a one-game split is not marked");
  assert.equal(ind[2].one, false);
  assert.deepEqual(page.lines(SHEET, "WSH").map((l) => l.key), ["passTd", "takeaways", "passYds"]);
  assert.equal(ind[0].of, 16, "a line ranked among fewer than the field does not say of how many"); assert.equal(ind[2].of, null, "a line ranked among the whole field says nothing");
  assert.deepEqual(page.lines(SHEET, "QQQ"), [], "a defence with no sheet has no lines");
  const both = page.gameLines(SHEET, GAMES[0]);
  assert.deepEqual(both.map((l) => l.rank + " " + l.team + " " + l.key), ["1 IND passYdsAway", "1 WSH passTd", "1 WSH takeaways", "2 IND takeaways", "2 WSH passYds", "3 IND passYds", "4 IND compPct"], "the game's list is not both defences merged by rank, home after away on a tie");
  assert.deepEqual(page.lines(SHEET, "IND", 2).map((l) => l.key), ["passYdsAway", "takeaways"], "the cut is not the caller's");
});

test("cardHtml: the badge says MOST for first place and the ordinal after, the value prints by its kind, the one-game mark rides the value, every string is escaped", () => {
  const html = page.cardHtml(SHEET, GAMES[0], {});
  assert.match(html, /class="scard"/);
  assert.match(html, /<span class="rk r1">MOST<\/span>/); assert.match(html, /<span class="rk">2ND<\/span>/); assert.match(html, /<span class="rk">3RD<\/span>/); assert.match(html, /<span class="rk">4TH<\/span>/);
  assert.match(html, /<b class="tm">IND<\/b> <span class="st">Pass yards on the road <small>of 16<\/small><\/span><span class="v"><small>1g<\/small>371\.0<\/span>/, "the one-game split is not marked beside the value, its field not named, or a mean does not print to one place");
  assert.match(html, /<span class="rk r1">FEWEST<\/span><b class="tm">WSH<\/b> <span class="st">Takeaways<\/span>/, "first place on a fewest-is-soft line does not say FEWEST");
  assert.match(html, /<span class="st">Pass yards<\/span>/, "a line ranked among the whole field names a field");
  assert.match(html, /<span class="st">Passing TD<\/span><span class="v">11<\/span>/, "a total does not print whole");
  assert.match(html, /<span class="st">Pass comp %<\/span><span class="v">70\.6%<\/span>/, "a share does not print as a percentage");
  assert.match(html, /IND<\/b>[\s\S]*@[\s\S]*WSH/, "the head is not away at home");
  assert.doesNotMatch(html, /undefined|NaN/);
  const hostile = page.cardHtml({ ...SHEET, stats: { ...SHEET.stats, passYds: { label: "<img src=x>", soft: "most", kind: "mean" } } }, { id: "g", home: "WSH", away: "IND", date: "2026-10-04T13:30Z" }, {});
  assert.doesNotMatch(hostile, /<img/); assert.match(hostile, /&lt;img src=x&gt;/);
  assert.equal(page.cardHtml(SHEET, GAMES[1], {}), "", "a game with nothing in the top five has a card");
});

test("cardHtml: a game whose defences have one line between them still has a card; none at all, no card", () => {
  const one = page.cardHtml(SHEET, { id: "g", home: "ZZZ", away: "IND", date: "2026-10-04T13:30Z" }, {});
  assert.match(one, /IND/); assert.doesNotMatch(one, /ZZZ<\/b> <span class="st">/, "a 32nd-ranked defence has a line");
  assert.equal(page.cardHtml(SHEET, { id: "g", home: "ZZZ", away: "QQQ", date: "2026-10-04T13:30Z" }, {}), "", "a game with nothing in the top five has a card");
});

test("render: open games in kickoff order into #sheet, the caveat into #sfoot with the field and the window, empty states that say why", () => {
  const made = (id) => { const el = { id, innerHTML: "", children: [] }; return el; };
  const els = { sheet: made("sheet"), sfoot: made("sfoot") };
  const doc = { getElementById: (id) => els[id] || null };
  const now = Date.parse("2026-10-03T00:00Z"); // pinned: the fixture's kickoffs are dated, and a test that reads the clock goes red on its own
  page.render(doc, { sheet: SHEET, games: GAMES, league: "NFL", now });
  assert.match(els.sheet.innerHTML, /scard/);
  assert.ok(els.sheet.innerHTML.indexOf("IND") < els.sheet.innerHTML.indexOf("QQQ") || els.sheet.innerHTML.indexOf("QQQ") < 0, "games are not in kickoff order");
  assert.doesNotMatch(els.sheet.innerHTML, /g0/, "a played game is on the sheet");
  assert.match(els.sfoot.innerHTML, /out of 32 defences/); assert.match(els.sfoot.innerHTML, /1g/); assert.match(els.sfoot.innerHTML, /2026 through week 3/);
  assert.match(els.sfoot.innerHTML, /full strength on the touchdown chance and the game line, at half strength on rushing and passing yards, and not at all on the other counting props/, "the caveat does not say what the model applies, in full");
  assert.match(els.sfoot.innerHTML, /ranked a game/, "the caveat does not say a season total is ranked a game");
  assert.match(els.sfoot.innerHTML, /sacks, red-zone trips and third downs come from the play-by-play, which can lag the box scores by a week/, "the caveat does not say where the play lines come from, or that they can lag");
  page.render(doc, { sheet: null, games: GAMES, league: "NFL", now });
  assert.match(els.sheet.innerHTML, /class="empty"/); assert.match(els.sheet.innerHTML, /No sheet/);
  page.render(doc, { sheet: SHEET, games: [], league: "NFL", now });
  assert.match(els.sheet.innerHTML, /No games/);
});

test("the offence's sheet reads the other way: the caveat says what each offence has done, what the model takes from an offence, and turnovers from the fewest", () => {
  const OFF = { ...SHEET, side: "off", stats: { ...SHEET.stats, takeaways: undefined, turnovers: { label: "Turnovers", soft: "fewest", kind: "total" } }, teams: { IND: { ...SHEET.teams.IND, takeaways: undefined, turnovers: { v: 2, n: 3, rank: 1, of: 32 } }, WSH: SHEET.teams.WSH } };
  delete OFF.stats.takeaways; delete OFF.teams.IND.takeaways;
  const made = (id) => ({ id, innerHTML: "" });
  const els = { sheet: made("sheet"), sfoot: made("sfoot") };
  const doc = { getElementById: (id) => els[id] || null };
  page.render(doc, { sheet: OFF, games: GAMES, league: "NFL", now: Date.parse("2026-10-03T00:00Z") });
  assert.match(els.sfoot.innerHTML, /What each offence has done most this season/, "the offence's caveat reads as the defence's");
  assert.match(els.sfoot.innerHTML, /for turnovers, the fewest/);
  assert.doesNotMatch(els.sfoot.innerHTML, /sacks, the fewest/, "the offence's sacks taken rank from the most");
  assert.match(els.sfoot.innerHTML, /The model takes from an offence its team factor, its touchdown rate against the league, at full strength on the touchdown chance, and its rating on the game line; a counting prop takes nothing from the offence's own production, only the opponent's allowance and the share its injured teammates leave behind/, "the caveat does not say what the model takes from an offence, in full");
  assert.doesNotMatch(els.sfoot.innerHTML, /defence/);
  assert.match(els.sheet.innerHTML, /<span class="rk r1">FEWEST<\/span><b class="tm">IND<\/b> <span class="st">Turnovers<\/span>/);
  /* A page names its side; a sheet of the other side is refused rather than captioned wrongly. */
  page.render(doc, { sheet: OFF, games: GAMES, league: "NFL", side: "def", now: Date.parse("2026-10-03T00:00Z") });
  assert.match(els.sheet.innerHTML, /Wrong sheet/, "the defence page rendered the offence's sheet, or did not say why it refused it");
  assert.doesNotMatch(els.sheet.innerHTML, /none are on file/, "a refused sheet is reported as missing");
  assert.equal(els.sfoot.innerHTML, "", "a refused sheet still got a caveat");
  page.render(doc, { sheet: SHEET, games: GAMES, league: "NFL", side: "def", now: Date.parse("2026-10-03T00:00Z") });
  assert.match(els.sheet.innerHTML, /scard/, "a sheet without a side is the defence's, as the first build wrote it");
  /* The defence's caveat is the defence's. */
  page.render(doc, { sheet: SHEET, games: GAMES, league: "NFL", now: Date.parse("2026-10-03T00:00Z") });
  assert.match(els.sfoot.innerHTML, /What each defence has allowed most this season/);
  assert.match(els.sfoot.innerHTML, /for takeaways and sacks, the fewest/, "the defence's caveat does not say its sacks rank from the fewest");
});
