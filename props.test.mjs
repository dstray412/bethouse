/*
 * BetHouse — props.test.mjs
 * A book's prop lines beside the site's numbers: the arithmetic and the
 * joins. Oracles are a book's own settlement and the textbook de-vig
 * (each side's implied chance over the two sides' sum); the feed's shape
 * is The Odds API v4's, as documented.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import P from "./props.js";
import nfl from "./nfl.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `expected ${a} ≈ ${b}`);

test("decimal: American odds as a decimal price; nothing usable is null", () => {
  close(P.decimal(-110), 1 + 100 / 110);
  close(P.decimal(150), 2.5);
  close(P.decimal(100), 2);
  close(P.decimal("-200"), 1.5);
  for (const bad of [null, undefined, "", 0, NaN, "abc", 50, -99]) assert.equal(P.decimal(bad), null, String(bad));
});

test("noVig: each side's implied chance over the two sides' sum; a missing price is no answer", () => {
  const even = P.noVig(-110, -110);
  close(even.over, 0.5); close(even.under, 0.5);
  close(even.hold, 2 * (110 / 210) - 1);
  const skew = P.noVig(-150, 120);
  close(skew.over + skew.under, 1);
  close(skew.over, (150 / 250) / (150 / 250 + 100 / 220));
  assert.equal(P.noVig(-110, null), null);
  assert.equal(P.noVig(undefined, 120), null);
});

test("normName: two feeds' spellings of one man agree", () => {
  assert.equal(P.normName("Marvin Harrison Jr."), P.normName("marvin harrison"));
  assert.equal(P.normName("A.J. Brown"), "aj brown");
  assert.equal(P.normName("Ja'Marr Chase"), "jamarr chase");
  assert.equal(P.normName("Amon-Ra St. Brown"), "amon ra st brown");
  assert.equal(P.normName("Kenneth Walker III"), "kenneth walker");
  assert.equal(P.normName(null), "");
});

/* The Odds API v4 event-odds shape. */
const outcome = (name, description, price, point, extra) => Object.assign({ name, description, price }, point == null ? {} : { point }, extra || {});
const EVENTS = [{
  id: "ev1", sport_key: "americanfootball_nfl", commence_time: "2026-11-29T21:25:00Z", home_team: "Arizona Cardinals", away_team: "Washington Commanders",
  bookmakers: [
    { key: "draftkings", title: "DraftKings", last_update: "2026-11-25T12:00:00Z", markets: [
      { key: "player_reception_yds", last_update: "2026-11-25T12:00:00Z", outcomes: [
        outcome("Over", "Trey McBride", -115, 68.5, { player_id: "espn:4361307" }), outcome("Under", "Trey McBride", -105, 68.5, { player_id: "espn:4361307" }),
        outcome("Over", "Marvin Harrison Jr.", -110, 55.5), outcome("Under", "Marvin Harrison Jr.", -110, 55.5),
        outcome("Over", "Nobody Known", -110, 20.5), outcome("Under", "Nobody Known", -110, 20.5),
        outcome("Over", "Half Priced", -110, 30.5),
        outcome("Over", "No Price", null, 30.5), outcome("Under", "No Price", 0, 30.5)] },
      { key: "player_anytime_td", outcomes: [outcome("Yes", "Trey McBride", 140), outcome("Yes", "Both Sides", 200), outcome("No", "Both Sides", -260), outcome("No", "Only No", -300)] },
      { key: "player_pass_tds", outcomes: [outcome("Over", "Jayden Daniels", -110, 1.5), outcome("Under", "Jayden Daniels", -110, 1.5)] }] },
    { key: "fanduel", title: "FanDuel", markets: [
      { key: "player_reception_yds", outcomes: [
        /* An alternate-style ladder under the main key: the main line is the one priced nearest even. */
        outcome("Over", "Trey McBride", -300, 49.5), outcome("Under", "Trey McBride", 230, 49.5),
        outcome("Over", "Trey McBride", -112, 70.5), outcome("Under", "Trey McBride", -108, 70.5)] }] },
    { key: "betmgm", title: "BetMGM", markets: [{ key: "player_reception_yds", outcomes: [outcome("Over", "Trey McBride", -110, 66.5), outcome("Under", "Trey McBride", -110, 66.5)] }] },
  ],
}];

/* PropLine's live shape (prop-line.com/odds-api/nfl, read 2026-11-24): several markets under one key, each with a line_type; a yes-only list with the player in `name`; milestone rungs. */
const PROPLINE = [{
  id: "87239", sport_key: "football_nfl", home_team: "Kansas City Chiefs", away_team: "Arizona Cardinals", commence_time: "2026-11-22T18:00:00Z",
  bookmakers: [{ key: "fanduel", title: "FanDuel", last_update: "2026-11-22T17:17:03.987230Z", markets: [
    { key: "player_anytime_td", line_type: "main", last_update: "2026-11-22T17:17:03Z", outcomes: [
      { name: "Andrew Armstrong", description: "Andrew Armstrong", price: 2000, point: null, player_id: "espn:5093923", side: null },
      { name: "Trey McBride", description: "Trey McBride", price: 150, point: null, player_id: null }] },
    { key: "player_reception_yds", description: "Cyrus Allen Receiving Yards", line_type: "milestone", outcomes: [
      { name: "100+ Receiving Yards", description: "Cyrus Allen", price: 1900, point: null, player_id: "espn:4912218" }] },
    { key: "player_reception_yds", description: "Cyrus Allen Receiving Yards", line_type: "alternate", outcomes: [
      { name: "Over", description: "Cyrus Allen", price: -110, point: 9.5, player_id: "espn:4912218" }, { name: "Under", description: "Cyrus Allen", price: -110, point: 9.5 }] },
    { key: "player_reception_yds", description: "Cyrus Allen Receiving Yards", line_type: "main", last_update: "2026-11-22T17:10:00Z", outcomes: [
      { name: "Over", description: "Cyrus Allen", price: -120, point: 24.5, player_id: "espn:4912218" }, { name: "Under", description: "Cyrus Allen", price: -102, point: 24.5, player_id: "espn:4912218" }] },
    { key: "player_reception_yds", description: "Trey McBride Receiving Yards", line_type: "main", outcomes: [
      { name: "Over", description: "Trey McBride", price: -114, point: 61.5 }, { name: "Under", description: "Trey McBride", price: -110, point: 61.5 },
      { name: "60+ Receiving Yards", description: "Trey McBride", price: -130, point: null }] }] }],
}];

test("parseEvents: PropLine's three outcome shapes; only a book's main line, gathered across its markets of one key", () => {
  const offers = P.parseEvents(PROPLINE);
  const of = (stat, player) => offers.filter((o) => o.stat === stat && o.player === player);
  /* Shape 3: the player is the name and the bet is Yes. */
  assert.deepEqual(of("td", "Andrew Armstrong").map((o) => [o.line, o.over, o.under, o.espnId]), [[0.5, 2000, null, "5093923"]]);
  assert.equal(of("td", "Trey McBride")[0].espnId, null, "the feed's null id is not a guess");
  /* One offer a player: the main market's line, never the alternate's or a milestone's. */
  assert.deepEqual(of("recyds", "Cyrus Allen").map((o) => [o.line, o.over, o.under, o.espnId, o.at]), [[24.5, -120, -102, "4912218", "2026-11-22T17:10:00Z"]]);
  assert.deepEqual(of("recyds", "Trey McBride").map((o) => [o.line, o.over, o.under]), [[61.5, -114, -110]], "a milestone rung inside a main market is not a line");
  assert.equal(offers.length, 4);
  /* The feed's timestamp is a timestamp or it is nothing. */
  const bad = JSON.parse(JSON.stringify(PROPLINE)); bad[0].bookmakers[0].last_update = "<img src=x>"; bad[0].bookmakers[0].markets.forEach((m) => { m.last_update = "<img src=x>"; });
  assert.ok(P.parseEvents(bad).every((o) => o.at === null));
});

test("parseEvents: one offer a player, market and book, over and under of the main line together; only the books and markets asked for", () => {
  const offers = P.parseEvents(EVENTS);
  const of = (book, stat, player) => offers.find((o) => o.book === book && o.stat === stat && o.player === player);
  const mc = of("draftkings", "recyds", "Trey McBride");
  assert.deepEqual({ line: mc.line, over: mc.over, under: mc.under, espnId: mc.espnId, eventId: mc.eventId, home: mc.home, away: mc.away },
    { line: 68.5, over: -115, under: -105, espnId: "4361307", eventId: "ev1", home: "Arizona Cardinals", away: "Washington Commanders" });
  assert.equal(of("draftkings", "recyds", "Marvin Harrison Jr.").espnId, null, "an offer with no id still parses");
  assert.equal(of("fanduel", "recyds", "Trey McBride").line, 70.5, "the main line is the one priced nearest even, not the first listed");
  assert.equal(offers.some((o) => o.book === "betmgm"), false, "a book nobody asked for");
  assert.equal(offers.some((o) => o.stat === undefined || o.player === "Jayden Daniels"), false, "a market the board has no prop for");
  /* A yardage line with one price has no main line to choose and no cut to take out: not an offer. */
  assert.equal(of("draftkings", "recyds", "Half Priced"), undefined);
  assert.equal(of("draftkings", "recyds", "No Price"), undefined);
  /* Touchdowns: Yes is the over at 0.5; a No alone is not an offer. */
  const td = of("draftkings", "td", "Trey McBride");
  assert.deepEqual({ line: td.line, over: td.over, under: td.under }, { line: 0.5, over: 140, under: null });
  assert.deepEqual({ over: of("draftkings", "td", "Both Sides").over, under: of("draftkings", "td", "Both Sides").under }, { over: 200, under: -260 });
  assert.equal(of("draftkings", "td", "Only No"), undefined);
  assert.deepEqual(P.parseEvents(null), []); assert.deepEqual(P.parseEvents([{ id: "x" }]), []);
  assert.equal(P.parseEvents(EVENTS, { books: ["betmgm"] }).length, 1);
});

/* A board with a levelled pool whose ratios are known, so every chance can be worked by hand. */
const RATIOS = [0.2, 0.4, 0.6, 0.8, 1.0, 1.0, 1.2, 1.4, 1.6, 1.8];
const fakeModel = {
  STATS: { recyds: { label: "Receiving yards" } },
  DEFAULTS: {},
  allowOf: () => 1,
  poolSize: (p) => (p ? p.length : 0),
  statEligible: (stat, p) => (p.exp ? { exp: p.exp } : null),
  empiricalOver: (exp, line, pool) => (pool ? pool.filter((r) => exp * r > line).length / pool.length : null),
  scoreAnytimeTD: (p) => (p.td != null ? { prob: p.td } : null),
  recentValues: (stat, recent) => recent.map((r) => r[2]),
  recentTdHits: (recent) => recent.filter((r) => r[6] >= 1).length,
};
const BOARD = {
  games: [
    { id: "g1", date: "2026-11-29T21:25Z", name: "Washington Commanders at Arizona Cardinals", home: "ARI", away: "WSH" },
    { id: "g2", date: "2026-11-29T18:00Z", name: "Green Bay Packers at Los Angeles Rams", home: "LAR", away: "GB" },
  ],
  players: [
    { id: "4361307", name: "Trey McBride", team: "ARI", opp: "WSH", exp: 70, td: 0.4, recent: [[0, 0, 80, 0, 0, 0, 1], [0, 0, 60, 0, 0, 0, 0], [0, 0, 70, 0, 0, 0, 0]] },
    { id: "77", name: "Marvin Harrison Jr.", team: "ARI", opp: "WSH", exp: 50 },
    { id: "88", name: "Marvin Harrison", team: "GB", opp: "LAR", exp: 10 },
    { id: "99", name: "Not Eligible", team: "WSH", opp: "ARI" },
  ],
  pools: { recyds: RATIOS },
};

test("matchOffers: the feed's ESPN id first, then name within the game's two teams; everyone missed is named with the reason", () => {
  const { matched, unmatched } = P.matchOffers(P.parseEvents(EVENTS), BOARD);
  const mc = matched.find((o) => o.player === "Trey McBride" && o.book === "draftkings" && o.stat === "recyds");
  assert.equal(mc.playerId, "4361307"); assert.equal(mc.gameId, "g1"); assert.equal(mc.kickoff, "2026-11-29T21:25Z");
  /* By name: the suffix does not stop it, and the namesake on a team not in this game does not confuse it. */
  assert.equal(matched.find((o) => o.player === "Marvin Harrison Jr.").playerId, "77");
  assert.ok(unmatched.some((u) => u.player === "Nobody Known" && u.why === "no player"));
  /* An id that points at a player in another game is not trusted over the game. */
  const wrongId = P.matchOffers([{ ...mc, espnId: "88", player: "Trey McBride" }], BOARD).matched[0];
  assert.equal(wrongId.playerId, "4361307");
  /* A neutral site: the feed and the board can disagree about who is home. */
  assert.equal(P.matchOffers([{ ...mc, home: "Washington Commanders", away: "Arizona Cardinals" }], BOARD).matched[0].gameId, "g1");
  /* No game: a team pair the board does not have, or the same pair a week away. */
  assert.equal(P.matchOffers([{ ...mc, home: "Dallas Cowboys" }], BOARD).unmatched[0].why, "no game");
  assert.equal(P.matchOffers([{ ...mc, commence: "2026-12-06T21:25:00Z" }], BOARD).unmatched[0].why, "no game");
  /* The override file names a player the feed spells its own way. */
  const odd = P.matchOffers([{ ...mc, espnId: null, player: "T. McBride" }], BOARD, { [P.normName("T. McBride")]: "4361307" });
  assert.equal(odd.matched[0].playerId, "4361307");
  /* Two men of one name in one game is not a guess. */
  const twins = { ...BOARD, players: BOARD.players.concat([{ id: "78", name: "Marvin Harrison", team: "WSH" }]) };
  assert.match(P.matchOffers([{ ...mc, espnId: null, player: "Marvin Harrison" }], twins).unmatched[0].why, /two players/);
});

test("siteChance: the model's distribution read at the book's line, with the push a whole-number line can land on", () => {
  const mc = BOARD.players[0];
  /* exp 70: values 14, 28, 42, 56, 70, 70, 84, 98, 112, 126. Over 68.5 is six of ten. */
  const half = P.siteChance(fakeModel, BOARD, mc, "recyds", 68.5);
  close(half.over, 0.6); close(half.under, 0.4); close(half.push, 0);
  /* At 70 exactly two land on the line: over four, push two, under four. */
  const whole = P.siteChance(fakeModel, BOARD, mc, "recyds", 70);
  close(whole.over, 0.4); close(whole.push, 0.2); close(whole.under, 0.4);
  const td = P.siteChance(fakeModel, BOARD, mc, "td", 0.5);
  close(td.over, 0.4); close(td.under, 0.6);
  assert.equal(P.siteChance(fakeModel, BOARD, BOARD.players[3], "recyds", 30.5), null, "a player the board would not show has no chance to compare");
  assert.equal(P.siteChance(fakeModel, BOARD, mc, "recyds", null), null);
  assert.equal(P.siteChance(fakeModel, BOARD, mc, "nope", 1.5), null);
  /* A player the board hides because he is ruled out has no chance to compare (nfl.js availability). */
  const avail = { ...fakeModel, availability: (s) => (/out|doubtful/i.test(String(s || "")) ? "out" : "ok") };
  assert.equal(P.siteChance(avail, BOARD, { ...mc, status: "Doubtful" }, "recyds", 68.5), null);
  assert.equal(P.siteChance(avail, BOARD, { ...mc, status: "Out" }, "td", 0.5), null);
  assert.ok(P.siteChance(avail, BOARD, { ...mc, status: "Questionable" }, "recyds", 68.5));
});

test("siteChance: at a whole-number line the model's own rule decides, N+ is the over of N - 0.5", () => {
  /* Oracle: nfl.js LADDERS. The pool's values are continuous, so "4 or more" is everything over 3.5 and "5 or more" everything over 4.5; the push is the band between. Reading the over at 4 itself counted half that band as a win (review, 2026-11-24). */
  const cont = { ...fakeModel, empiricalOver: (exp, line) => Math.max(0, Math.min(1, (10 - line) / 10)) };
  const c = P.siteChance(cont, BOARD, BOARD.players[0], "recyds", 4);
  close(c.over, 0.55); close(c.push, 0.1); close(c.under, 0.35);
});

test("quote: line, prices, no-vig, the site's chance at that line, the gap and the return, for the side the gap favours", () => {
  const mc = BOARD.players[0];
  const q = P.quote(fakeModel, BOARD, mc, { stat: "recyds", book: "draftkings", line: 68.5, over: -110, under: -110 });
  assert.equal(q.side, "over"); close(q.site, 0.6); close(q.fair, 0.5); close(q.gap, 10);
  /* 0.6 x (100/110) - 0.4 */
  close(q.ev, 0.6 * (100 / 110) - 0.4);
  assert.equal(q.log, true); assert.equal(q.oneSided, false); assert.equal(q.price, -110);
  assert.deepEqual(q.recent, { hits: 2, n: 3 }, "recent games over the book's line, with n");
  /* The other side when the model is under the market. */
  const u = P.quote(fakeModel, BOARD, mc, { stat: "recyds", book: "fanduel", line: 90.5, over: -110, under: -110 });
  assert.equal(u.side, "under"); close(u.site, 0.7); close(u.gap, 20);
  /* Inside the noise: shown, not logged. */
  const small = P.quote(fakeModel, BOARD, mc, { stat: "recyds", book: "fanduel", line: 68.5, over: -150, under: 120 });
  assert.ok(small.gap < P.MIN_GAP && small.gap >= 0, String(small.gap)); assert.equal(small.log, false);
  /* A push returns the stake: at 70, over wins 0.4, pushes 0.2, loses 0.4. */
  const w = P.quote(fakeModel, BOARD, mc, { stat: "recyds", book: "draftkings", line: 70, over: 100, under: -120 });
  const over = w.sides.find((s) => s.side === "over");
  close(over.ev, 0.4 * 1 - 0.4); close(w.push, 0.2);
  /* The book's two chances sum to one because a push is refunded, so the site's is compared given no push: 0.4 of the 0.8 that settles. */
  close(over.site, 0.5); close(over.gap, 100 * (0.5 - P.noVig(100, -120).over));
  /* A touchdown with only a Yes price: compared with the raw implied chance, and said to be. */
  const td = P.quote(fakeModel, BOARD, mc, { stat: "td", book: "draftkings", line: 0.5, over: 200, under: null });
  assert.equal(td.oneSided, true); close(td.fair, 1 / 3); close(td.gap, 100 * (0.4 - 1 / 3)); assert.equal(td.sides.length, 1);
  assert.deepEqual(td.recent, { hits: 1, n: 3 });
  assert.equal(P.quote(fakeModel, BOARD, BOARD.players[3], { stat: "recyds", book: "draftkings", line: 30.5, over: -110, under: -110 }), null);
  assert.equal(P.quote(fakeModel, BOARD, mc, null), null);
});

test("quote: a market whose live record is off by more than the gap carries that bias, and the others carry none", () => {
  assert.ok(P.BIASED.rushyds > P.MIN_GAP && P.BIASED.passyds < -P.MIN_GAP, "characterization: the two markets record.html showed off on 2026-11-24");
  const q = P.quote(fakeModel, BOARD, BOARD.players[0], { stat: "recyds", book: "draftkings", line: 68.5, over: -110, under: -110 });
  assert.equal(q.bias, null);
});

test("the real model prices a real line: the site's chance falls as the book's line rises", async () => {
  const fs = await import("node:fs");
  const w = {}; new Function("window", fs.readFileSync(new URL("./nfl-data.js", import.meta.url), "utf8"))(w);
  const D = w.BetHouseNFLData;
  const p = D.players.find((x) => nfl.statEligible("recyds", x, null, P.contextFor(nfl, D, x, "recyds")));
  const exp = nfl.statEligible("recyds", p, null, P.contextFor(nfl, D, p, "recyds")).exp;
  const lo = P.siteChance(nfl, D, p, "recyds", Math.floor(exp * 0.6) + 0.5), hi = P.siteChance(nfl, D, p, "recyds", Math.floor(exp * 1.4) + 0.5);
  assert.ok(lo.over > hi.over, `${lo.over} > ${hi.over}`);
  close(lo.over + lo.under + lo.push, 1);
  const td = P.siteChance(nfl, D, D.players.find((x) => x.tds > 2), "td", 0.5);
  assert.ok(td.over > 0 && td.over < 1);
  /* A whole-number line on the real model: the three outcomes sum to one and the push is a real share. */
  const q = D.players.find((x) => nfl.statEligible("recs", x, null, P.contextFor(nfl, D, x, "recs")));
  const e = nfl.statEligible("recs", q, null, P.contextFor(nfl, D, q, "recs")).exp, L = Math.max(1, Math.round(e));
  const whole = P.siteChance(nfl, D, q, "recs", L);
  assert.ok(whole.push > 0, "no push at a whole-number line");
  close(whole.over + whole.push + whole.under, 1);
  close(whole.over, nfl.empiricalOver(e, L + 0.5, D.pools.recs));
});

test("closeMove: the closing no-vig chance against the pick's at the same line, points toward the pick when the line moved", () => {
  const pick = { side: "over", line: 68.5, fair: 0.5 };
  /* Same line, the over shortened to -130 / +110: the market came to the pick. */
  const same = P.closeMove(pick, { line: 68.5, over: -130, under: 110 });
  assert.equal(same.pts, 0); assert.ok(same.prob > 0); close(same.prob, Math.round(1000 * (P.noVig(-130, 110).over - 0.5)) / 10);
  /* An over gains when the line goes up; an under when it goes down. */
  assert.deepEqual(P.closeMove(pick, { line: 71.5, over: -110, under: -110 }), { prob: null, pts: 3 });
  assert.deepEqual(P.closeMove(pick, { line: 66.5, over: -110, under: -110 }), { prob: null, pts: -2 });
  assert.deepEqual(P.closeMove({ side: "under", line: 68.5, fair: 0.5 }, { line: 66.5, over: -110, under: -110 }), { prob: null, pts: 2 });
  assert.ok(P.closeMove({ side: "under", line: 68.5, fair: 0.5 }, { line: 68.5, over: -130, under: 110 }).prob < 0);
  /* A one-sided pick's chance still holds the book's cut, so its close is read the same way: the same side's raw implied chance. */
  const yes = { side: "over", line: 0.5, fair: 1 / 3, oneSided: true };
  close(P.closeMove(yes, { line: 0.5, over: 150, under: -200 }).prob, Math.round(1000 * (1 / 2.5 - 1 / 3)) / 10);
  close(P.closeMove(yes, { line: 0.5, over: 150, under: null }).prob, Math.round(1000 * (1 / 2.5 - 1 / 3)) / 10);
  /* A close with one price says the line held and nothing about the chance. */
  assert.deepEqual(P.closeMove(pick, { line: 68.5, over: -130, under: null }), { prob: null, pts: 0 });
  assert.equal(P.closeMove(pick, null), null); assert.equal(P.closeMove(pick, { line: null }), null);
});

test("grade: settled as a book would, at the pick's line and price; a push on the number, a void with no box-score line", () => {
  assert.deepEqual(P.grade({ side: "over", line: 68.5, price: -110 }, 70), { outcome: "win", units: 0.9091 });
  assert.deepEqual(P.grade({ side: "over", line: 68.5, price: -110 }, 60), { outcome: "loss", units: -1 });
  assert.deepEqual(P.grade({ side: "under", line: 68.5, price: 120 }, 60), { outcome: "win", units: 1.2 });
  assert.deepEqual(P.grade({ side: "under", line: 68.5, price: 120 }, 90), { outcome: "loss", units: -1 });
  assert.deepEqual(P.grade({ side: "over", line: 5, price: -110 }, 5), { outcome: "push", units: 0 });
  assert.deepEqual(P.grade({ side: "over", line: 0.5, price: 140 }, 1), { outcome: "win", units: 1.4 }, "a touchdown is over a half");
  assert.deepEqual(P.grade({ side: "over", line: 0.5, price: 140 }, 0), { outcome: "loss", units: -1 });
  assert.deepEqual(P.grade({ side: "over", line: 68.5, price: -110 }, null), { outcome: "void", units: 0 });
  assert.equal(P.grade(null, 3), null);
});

test("summarise: n, win rate, return with its interval and what the close did; a void is in none of it, a push in n and not the win rate", () => {
  const picks = [
    { outcome: "win", units: 1, clvPts: 0, clvProb: 2 }, { outcome: "win", units: 1, clvPts: 1.5, clvProb: null },
    { outcome: "loss", units: -1, clvPts: -1, clvProb: null }, { outcome: "push", units: 0, clvPts: 0, clvProb: -1 },
    { outcome: "void", units: 0, clvPts: 3 }, { outcome: "loss", units: -1 }, null, {},
  ];
  const s = P.summarise(picks);
  assert.equal(s.n, 5); assert.equal(s.won, 2); assert.equal(s.pushes, 1); assert.equal(s.rate, 50);
  assert.equal(s.roi, 0);
  assert.ok(s.roiLo < 0 && s.roiHi > 0);
  assert.equal(s.closed, 4); assert.equal(s.movedToward, 50); assert.equal(s.lineMoved, 2); assert.equal(s.clvProb, 0.5);
  /* A close that held its line and offered no chance to compare is not a close that moved away. */
  const blind = P.summarise([{ outcome: "win", units: 1, clvPts: 0, clvProb: null }, { outcome: "win", units: 1, clvPts: 2, clvProb: null }]);
  assert.equal(blind.closed, 1); assert.equal(blind.movedToward, 100);
  assert.equal(P.summarise([]), null); assert.equal(P.summarise([{ outcome: "void" }]), null);
});

/* ------------------------------------------------------------------ *
 * The fetcher's payload and the pick record
 * ------------------------------------------------------------------ */
import { buildPayload, underFloor, fetchPropLine, fetchOddsApi, PROPLINE as PL_BASE, ODDS_API } from "./fetch-props.mjs";
import { logPicks, gradeGame, reportOf, valueOf, pickKey, weekFile, serialise, boxComplete } from "./track-props.mjs";

const NOW = Date.parse("2026-11-25T12:00:00Z");

test("buildPayload: today's offers by player, prop and book for games not yet started; a live or started game's prices never reach the page", () => {
  const { payload, unmatched } = buildPayload({ events: EVENTS, D: { ...BOARD, season: 2026, week: 12 }, source: "propline", fetched: "2026-11-25T12:00:00Z", remaining: 987, now: NOW });
  assert.deepEqual(payload.offers["4361307"].recyds.draftkings, { line: 68.5, over: -115, under: -105, at: "2026-11-25T12:00:00Z", g: "g1" });
  assert.equal(payload.offers["4361307"].recyds.fanduel.line, 70.5);
  assert.equal(payload.offers["4361307"].td.draftkings.over, 140);
  assert.deepEqual([payload.source, payload.season, payload.week, payload.remaining], ["propline", 2026, 12, 987]);
  assert.ok(unmatched.some((u) => u.player === "Nobody Known"));
  assert.equal(JSON.stringify(payload).includes("Nobody Known"), false, "an offer nobody on the board owns is not published");
  const live = buildPayload({ events: [{ ...EVENTS[0], live: true }], D: BOARD, source: "propline", fetched: "x", now: NOW });
  assert.equal(live.payload.count, 0);
  const started = buildPayload({ events: EVENTS, D: BOARD, source: "propline", fetched: "x", now: Date.parse("2026-11-29T22:00:00Z") });
  assert.equal(started.payload.count, 0);
});

test("underFloor: the last run's balance stops the next one, until the provider's own reset", () => {
  const last = { source: "propline", fetched: "2026-11-25T08:00:00Z", remaining: 60 };
  assert.equal(underFloor(last, "propline", NOW), true);
  assert.equal(underFloor({ ...last, remaining: 500 }, "propline", NOW), false);
  assert.equal(underFloor(last, "propline", Date.parse("2026-11-26T00:05:00Z")), false, "PropLine resets at 00:00 UTC");
  assert.equal(underFloor({ source: "the-odds-api", fetched: "2026-11-02T08:00:00Z", remaining: 12 }, "the-odds-api", NOW), true, "The Odds API's credits are monthly");
  assert.equal(underFloor({ source: "the-odds-api", fetched: "2026-10-30T08:00:00Z", remaining: 12 }, "the-odds-api", NOW), false);
  assert.equal(underFloor(null, "propline", NOW), false); assert.equal(underFloor({ ...last, remaining: null }, "propline", NOW), false);
  assert.equal(underFloor(last, "the-odds-api", NOW), false, "another provider's balance is not this one's");
});

/* Oracle: each provider's own docs (read 2026-11-24). The key must never be in a PropLine URL, and an error must never carry it. */
test("fetchPropLine: one request for the slate, the key in a header and never in the URL", async () => {
  const calls = [];
  const fake = async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => EVENTS, headers: new Map([["x-daily-remaining", "987"]]) }; };
  const got = await fetchPropLine("SECRETKEY", fake);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.startsWith(PL_BASE + "/v1/sports/football_nfl/odds?"));
  assert.equal(calls[0].url.includes("SECRETKEY"), false);
  assert.equal(calls[0].init.headers["X-API-Key"], "SECRETKEY");
  assert.equal(calls[0].init.redirect, "error", "a redirect would carry the key header to another host");
  await assert.rejects(fetchPropLine("SECRETKEY", async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected token '<', \"<html>SECRETKEY\"... is not valid JSON"); }, headers: new Map() })), (e) => !/SECRETKEY/.test(e.message) && /not JSON/.test(e.message));
  for (const m of Object.keys(P.MARKETS)) assert.ok(calls[0].url.includes(m), m);
  assert.ok(calls[0].url.includes("bookmakers=draftkings,fanduel"));
  assert.equal(got.remaining, 987); assert.equal(got.events.length, 1);
  await assert.rejects(fetchPropLine("SECRETKEY", async () => ({ ok: false, status: 401, json: async () => ({ message: "bad key SECRETKEY" }), headers: new Map() })), (e) => !/SECRETKEY/.test(e.message) && /401/.test(e.message));
});

test("fetchOddsApi: a game at a time, three markets, and it stops under the credit floor", async () => {
  const urls = [];
  let left = 45;
  const list = [1, 2, 3].map((i) => ({ id: "e" + i, commence_time: "2026-11-29T18:00:00Z" })).concat([{ id: "old", commence_time: "2026-11-20T18:00:00Z" }]);
  const fake = async (url) => {
    urls.push(url);
    if (/\/events\?/.test(url)) return { ok: true, json: async () => list, headers: new Map([["x-requests-remaining", String(left)]]) };
    left -= 3;
    return { ok: true, json: async () => ({ ...EVENTS[0], id: url.match(/events\/(\w+)\//)[1] }), headers: new Map([["x-requests-remaining", String(left)]]) };
  };
  const got = await fetchOddsApi("K", fake, NOW);
  /* 45 -> 42 -> 39: the third game is not bought, and a game already played never is. */
  assert.deepEqual(got.events.map((e) => e.id), ["e1", "e2"]);
  assert.equal(got.remaining, 39);
  assert.ok(urls[1].startsWith(ODDS_API + "/v4/sports/americanfootball_nfl/events/e1/odds?"));
  assert.ok(/markets=player_reception_yds,player_rush_yds,player_receptions(&|$)/.test(urls[1]) && /regions=us/.test(urls[1]) && /oddsFormat=american/.test(urls[1]));
  assert.equal(urls.some((u) => u.includes("/old/")), false);
});

const PAYLOAD = () => buildPayload({ events: EVENTS, D: { ...BOARD, season: 2026, week: 12 }, source: "propline", fetched: "2026-11-25T12:00:00Z", remaining: 900, now: NOW }).payload;

test("logPicks: the side the gap favours at five points or more, once a player, prop and book, pregame only, with its price", () => {
  const rec = { picks: [] }, payload = PAYLOAD();
  const first = logPicks(rec, payload, BOARD, fakeModel, NOW);
  /* McBride exp 70. DK 68.5 at -115/-105: site over 0.6 against a no-vig 0.511, logged. FD 70.5: site over 0.4 against 0.505, the under at 0.6 logged. TD: 0.4 against 1/2.4, under five points, not logged. Harrison exp 50 at 55.5: over 0.4, under 0.6 against 0.5, logged. */
  assert.deepEqual(rec.picks.map((p) => [p.name, p.stat, p.book, p.side, p.line, p.price]).sort(), [
    ["Marvin Harrison Jr.", "recyds", "draftkings", "under", 55.5, -110],
    ["Trey McBride", "recyds", "draftkings", "over", 68.5, -115],
    ["Trey McBride", "recyds", "fanduel", "under", 70.5, -108],
  ]);
  assert.equal(first.added, 3);
  const mc = rec.picks.find((p) => p.book === "draftkings" && p.name === "Trey McBride");
  close(mc.site, 0.6); close(mc.fair, P.noVig(-115, -105).over, 1e-4); close(mc.gap, Math.round(1000 * (0.6 - P.noVig(-115, -105).over)) / 10);
  close(mc.decimal, P.decimal(-115), 1e-4);
  assert.deepEqual([mc.at, mc.source, mc.kickoff, mc.gameId, mc.playerId], ["2026-11-25T12:00:00Z", "propline", "2026-11-29T21:25Z", "g1", "4361307"]);
  assert.deepEqual(mc.close, { line: 68.5, over: -115, under: -105, at: "2026-11-25T12:00:00Z" }, "a pick starts with its own look as the close");
  /* Rule 1: a later run with a moved line refreshes the close and never the pick. */
  const later = PAYLOAD(); later.fetched = "2026-11-29T20:55:00Z";
  later.offers["4361307"].recyds.draftkings = { line: 71.5, over: -110, under: -110, at: "x", g: "g1" };
  const second = logPicks(rec, later, BOARD, fakeModel, Date.parse("2026-11-29T20:55:00Z"));
  assert.equal(second.added, 0); assert.equal(second.closed, 3);
  assert.equal(mc.line, 68.5); assert.equal(mc.price, -115);
  assert.deepEqual(mc.close, { line: 71.5, over: -110, under: -110, at: "2026-11-29T20:55:00Z" });
  /* Rule 3: after kickoff nothing is logged and the close is left alone. */
  const after = PAYLOAD(); after.fetched = "2026-11-29T22:00:00Z"; after.offers["4361307"].recyds.draftkings.line = 99.5;
  assert.deepEqual(logPicks(rec, after, BOARD, fakeModel, Date.parse("2026-11-29T22:00:00Z")), { added: 0, closed: 0 });
  assert.equal(mc.close.line, 71.5);
  assert.deepEqual(logPicks({ picks: [] }, null, BOARD, fakeModel, NOW), { added: 0, closed: 0 });
});

test("logPicks: prices older than the last hour and a half, or older than the board they are compared with, log nothing and close nothing", () => {
  /* Oracle: the review's scenario (2026-11-24). A fetch fails, the board re-projects a player after news, and the old price beside the new projection reads as a gap that is not there. */
  const old = logPicks({ picks: [] }, PAYLOAD(), BOARD, fakeModel, NOW + 91 * 60e3);
  assert.deepEqual(old, { added: 0, closed: 0, stale: "prices" });
  assert.equal(logPicks({ picks: [] }, PAYLOAD(), BOARD, fakeModel, NOW + 89 * 60e3).added, 3);
  const rebuilt = logPicks({ picks: [] }, PAYLOAD(), { ...BOARD, generated: "2026-11-25T12:20:00Z" }, fakeModel, NOW + 30 * 60e3);
  assert.deepEqual(rebuilt, { added: 0, closed: 0, stale: "board" });
  assert.equal(logPicks({ picks: [] }, PAYLOAD(), { ...BOARD, generated: "2026-11-25T11:00:00Z" }, fakeModel, NOW + 30 * 60e3).added, 3);
  /* An existing pick's close is not refreshed from a stale file either. */
  const rec = { picks: [] }; logPicks(rec, PAYLOAD(), BOARD, fakeModel, NOW);
  const stale = PAYLOAD(); stale.offers["4361307"].recyds.draftkings.line = 99.5;
  logPicks(rec, stale, BOARD, fakeModel, NOW + 5 * 3600e3);
  assert.equal(rec.picks.find((p) => p.book === "draftkings" && p.name === "Trey McBride").close.line, 68.5);
});

test("boxComplete: a final game's box score with a side missing settles nothing", () => {
  const side = (n) => ({ statistics: [{ name: "receiving", athletes: Array.from({ length: n }, (_, i) => ({ athlete: { id: String(i) } })) }] });
  assert.equal(boxComplete({ boxscore: { players: [side(3), side(2)] } }), true);
  assert.equal(boxComplete({ boxscore: { players: [side(3), side(0)] } }), false);
  assert.equal(boxComplete({ boxscore: { players: [side(3)] } }), false);
  assert.equal(boxComplete({}), false); assert.equal(boxComplete(null), false);
});

test("gradeGame: settled at the pick's line and price, with what the close did; no box-score line is a void", () => {
  const rec = { picks: [] };
  logPicks(rec, PAYLOAD(), BOARD, fakeModel, NOW);
  const mc = rec.picks.find((p) => p.book === "draftkings" && p.name === "Trey McBride");
  mc.close = { line: 71.5, over: -110, under: -110, at: "x" };
  const model = { STATS: { recyds: {} }, statTotal: (stat, line) => line.recYds };
  const lines = new Map([["4361307", { played: true, recYds: 70, td: 1 }]]);
  assert.equal(gradeGame(rec, "g1", lines, model), 3);
  assert.deepEqual([mc.outcome, mc.units, mc.result, mc.clvPts, mc.clvProb], ["win", r4t(P.decimal(-115) - 1), 70, 3, null]);
  const fd = rec.picks.find((p) => p.book === "fanduel");
  assert.deepEqual([fd.outcome, fd.units, fd.clvPts], ["win", r4t(P.decimal(-108) - 1), 0], "70 is under 70.5");
  /* characterization: a void is "no line for him in the box score". A player who dressed and recorded nothing is voided too, where a book would settle him at zero, and that leans the record toward overs. README says so; change it when there is a way to tell the two apart. */
  assert.deepEqual([rec.picks.find((p) => p.name === "Marvin Harrison Jr.").outcome], ["void"], "nobody in the box score by that id");
  assert.equal(gradeGame(rec, "g1", lines, model), 0, "a settled pick is never settled twice");
  assert.equal(valueOf("td", { played: true, td: 2 }), 1); assert.equal(valueOf("td", { played: true, td: 0 }), 0);
  assert.equal(valueOf("recyds", { played: false, recYds: 0 }), null); assert.equal(valueOf("recyds", undefined), null);
  assert.equal(valueOf("rushrec", { played: true, recYds: 30, rushYds: 12 }), 42, "the model's own summation");
});
function r4t(v) { return Math.round(v * 1e4) / 1e4; }

test("reportOf: one summary a market and all of them together, settled picks only", () => {
  const records = [{ picks: [
    { stat: "recyds", outcome: "win", units: 0.9, at: "2026-11-25T12:00:00Z", clvPts: 1, clvProb: null },
    { stat: "recyds", outcome: "loss", units: -1, at: "2026-11-26T12:00:00Z" },
    { stat: "td", outcome: "win", units: 1.4, at: "2026-11-25T12:00:00Z" },
    { stat: "rushyds", outcome: "void", units: 0, at: "2026-11-25T12:00:00Z" },
    { stat: "rushyds", at: "2026-11-27T12:00:00Z" }] }];
  const R = reportOf(records);
  assert.equal(R.total, 3); assert.equal(R.open, 1); assert.equal(R.since, "2026-11-25"); assert.equal(R.minGap, P.MIN_GAP);
  assert.deepEqual(Object.keys(R.markets), ["td", "recyds"], "a market with nothing settled has no row");
  assert.equal(R.markets.recyds.label, "Receiving yards"); assert.equal(R.markets.recyds.n, 2); assert.equal(R.markets.recyds.rate, 50);
  assert.equal(R.all.n, 3);
  assert.deepEqual(reportOf([]), { total: 0, open: 0, since: null, minGap: P.MIN_GAP, all: null, markets: {} });
  assert.equal(pickKey({ gameId: "g", playerId: "p", stat: "td", book: "fanduel" }), "g|p|td|fanduel");
  assert.equal(weekFile(2026, 7), "2026-w07.json");
  /* The week file reads back as what was saved, a pick a line. */
  const rec = { season: 2026, week: 7, picks: [{ a: 1, name: "O'Neil \"Q\"" }, { b: 2 }] };
  assert.deepEqual(JSON.parse(serialise(rec)), rec);
  assert.equal(serialise(rec).split("\n").length, 5);
  assert.deepEqual(JSON.parse(serialise({ season: 2026, week: 7, picks: [] })), { season: 2026, week: 7, picks: [] });
});

/* ------------------------------------------------------------------ *
 * The page's blocks
 * ------------------------------------------------------------------ */
const D12 = { ...BOARD, season: 2026, week: 12 };

test("offersFor: only this board's week, only a game that has not kicked off", () => {
  const payload = PAYLOAD(), mc = D12.players[0];
  assert.deepEqual(Object.keys(P.offersFor(payload, D12, mc, "recyds", NOW)), ["draftkings", "fanduel"]);
  assert.equal(P.offersFor(payload, { ...D12, week: 13 }, mc, "recyds", NOW), null, "last week's prices beside this week's projection");
  assert.equal(P.offersFor(payload, D12, mc, "recyds", Date.parse("2026-11-29T22:00:00Z")), null, "a pregame price after kickoff");
  assert.equal(P.offersFor(payload, D12, mc, "rushyds", NOW), null);
  assert.equal(P.offersFor(null, D12, mc, "recyds", NOW), null);
  /* A price half a day old is not shown as today's. */
  assert.equal(P.offersFor(payload, D12, mc, "recyds", NOW + 13 * 3600e3), null);
  assert.ok(P.offersFor(payload, D12, mc, "recyds", NOW + 11 * 3600e3));
  assert.equal(P.rowTag(P.offersFor(payload, D12, mc, "recyds", NOW)), "DK 68.5 · FD 70.5");
  assert.equal(P.rowTag({ draftkings: { line: 68.5 }, fanduel: { line: 68.5 } }), "DK/FD 68.5");
  assert.equal(P.rowTag(null), "");
});

test("bookHtml: each book's line, both prices, the no-vig chance, the site's chance at that line, the gap, the return and the recent count with its n", () => {
  const h = P.bookHtml(fakeModel, D12, D12.players[0], "recyds", PAYLOAD(), NOW);
  assert.match(h, /At the book/);
  assert.match(h, /<b>DraftKings<\/b><\/td><td>−115 \/ −105<\/td><td>over <b>68\.5<\/b><\/td>/);
  assert.ok(h.includes((100 * P.noVig(-115, -105).over).toFixed(1) + "%"), "the no-vig chance");
  assert.match(h, /<b>60\.0%<\/b>/, "the site's chance at the book's line");
  assert.match(h, /2 of 3/, "recent games over the book's line, with n");
  assert.match(h, /<b>FanDuel<\/b><\/td><td>[^<]*<\/td><td>under <b>70\.5<\/b>/);
  assert.match(h, /as of 2026-11-25 12:00 UTC/);
  assert.doesNotMatch(h, /Read this gap with care/, "a market with no measured bias carries no warning");
  /* A gap inside the noise is greyed and said to be. */
  const td = P.bookHtml(fakeModel, D12, D12.players[0], "td", PAYLOAD(), NOW);
  assert.match(td, /class="dimrow"/); assert.match(td, /inside the noise/);
  assert.match(td, /One-sided/, "a yes-only price says its cut is still in");
  assert.equal(P.bookHtml(fakeModel, D12, D12.players[3], "recyds", PAYLOAD(), NOW), "");
  assert.equal(P.bookHtml(fakeModel, D12, D12.players[0], "recyds", null, NOW), "");
  /* The two markets the record has off say so beside the gap. */
  const rush = { ...fakeModel, STATS: { rushyds: { label: "Rushing yards" } } };
  const pay = PAYLOAD(); pay.offers["4361307"].rushyds = { draftkings: { line: 68.5, over: -110, under: -110, g: "g1" } };
  assert.match(P.bookHtml(rush, { ...D12, pools: { rushyds: RATIOS } }, D12.players[0], "rushyds", pay, NOW), /Read this gap with care.*off by 6\.7 points/);
  /* A hostile name from the feed's side of the file cannot become markup. */
  const evil = PAYLOAD(); evil.offers["4361307"].recyds = { "<img src=x>": { line: 68.5, over: -110, under: -110, g: "g1" } };
  assert.doesNotMatch(P.bookHtml(fakeModel, D12, D12.players[0], "recyds", evil, NOW), /<img/);
});

test("gameHtml: a game's props at a gap of five or more, biggest first, and nothing for a game with none", () => {
  const h = P.gameHtml(fakeModel, D12, D12.games[0], PAYLOAD(), NOW);
  assert.match(h, /^<div class="game tscroll"><table class="booktbl">/);
  const names = [...h.matchAll(/<tr><td><b>([^<]+)<\/b>/g)].map((m) => m[1]);
  assert.deepEqual(names.sort(), ["Marvin Harrison Jr.", "Trey McBride", "Trey McBride"]);
  assert.doesNotMatch(h, /to score/, "a touchdown gap under five points is not on the list");
  assert.equal(P.gameHtml(fakeModel, D12, D12.games[1], PAYLOAD(), NOW), "");
  /* A two-sided touchdown market whose gap favours No says so. */
  const no = PAYLOAD(); no.offers["4361307"].td = { draftkings: { line: 0.5, over: -150, under: 120, g: "g1" } };
  assert.match(P.gameHtml(fakeModel, D12, D12.games[0], no, NOW), /not to score/);
  assert.equal(P.gameHtml(fakeModel, D12, D12.games[0], null, NOW), "");
});

test("recordHtml: a row a market with n, the win rate, the return and its interval, and what the close did", () => {
  const R = reportOf([{ picks: [
    { stat: "recyds", outcome: "win", units: 0.9, at: "2026-11-25T12:00:00Z", clvPts: 1, clvProb: null },
    { stat: "recyds", outcome: "loss", units: -1, at: "2026-11-26T12:00:00Z", clvPts: 0, clvProb: -1.5 },
    { stat: "td", outcome: "win", units: 1.4, at: "2026-11-25T12:00:00Z" }] }]);
  const h = P.recordHtml(R);
  assert.match(h, /<b>3<\/b> prop picks settled since 2026-11-25/);
  assert.match(h, /<td>Receiving yards<\/td><td>n <b>2<\/b> · won <b>50%<\/b> · a unit on each returned <b>−5%<\/b> of stake \(/);
  assert.match(h, /the close moved toward the pick <b>50%<\/b> of 2, <b>−1\.5<\/b> points of no-vig chance/);
  assert.match(h, /<td>All props<\/td>/);
  assert.equal(P.recordHtml(null), ""); assert.equal(P.recordHtml(reportOf([])), "");
});
