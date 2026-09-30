/*
 * BetHouse — faces.test.mjs
 * The one place a page gets a player's photo or a team's mark: the urls
 * by league and size, what a bad id does, and the img markup every
 * page shares.
 *
 * Oracle: the leagues' own image services, probed 2026-09-29 (ESPN's
 * combiner for headshots and logos, MLB's photo service for batters; a
 * missing id answers 404 with no placeholder image), and the house
 * rule for an image: no referrer, hidden when it does not load, lazy,
 * with a fixed box so a row never shifts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import F from "./faces.js";

test("headshotUrl: each league's service, sized for a row or the drawer", () => {
  assert.equal(F.headshotUrl("NFL", "2577417", "row"), "https://a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/2577417.png&w=96&h=70");
  assert.equal(F.headshotUrl("NFL", 2577417, "large"), "https://a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/2577417.png&w=200&h=145");
  assert.equal(F.headshotUrl("College football", "4801299", "row"), "https://a.espncdn.com/combiner/i?img=/i/headshots/college-football/players/full/4801299.png&w=96&h=70");
  assert.equal(F.headshotUrl("PGA", "10030", "row"), "https://a.espncdn.com/combiner/i?img=/i/headshots/golf/players/full/10030.png&w=96&h=70");
  assert.equal(F.headshotUrl("MLB", 607208, "row"), "https://img.mlbstatic.com/mlb-photos/image/upload/w_120,q_auto:best/v1/people/607208/headshot/67/current");
  assert.equal(F.headshotUrl("MLB", 607208, "large"), "https://img.mlbstatic.com/mlb-photos/image/upload/w_240,q_auto:best/v1/people/607208/headshot/67/current");
  assert.equal(F.headshotUrl("NFL", "2577417"), F.headshotUrl("NFL", "2577417", "row"), "a row by default");
});

test("headshotUrl: an id is digits or nothing; an unknown league is nothing", () => {
  assert.equal(F.headshotUrl("NFL", '12"><script>', "row"), null);
  assert.equal(F.headshotUrl("NFL", "", "row"), null);
  assert.equal(F.headshotUrl("NFL", null, "row"), null);
  assert.equal(F.headshotUrl("NFL", "game", "row"), null, "a game-line leg has no face");
  assert.equal(F.headshotUrl("Curling", "1", "row"), null);
  assert.equal(F.headshotUrl("constructor", "1", "row"), null, "a league name off the prototype is not a league");
  assert.equal(F.logoUrl("__proto__", "x", "small"), null);
  assert.equal(F.headshotUrl("NFL", "1".repeat(11), "row"), null);
});

test("logoUrl: ESPN's marks, small through the combiner or the full file, keys sanitised, college by numeric id", () => {
  assert.equal(F.logoUrl("NFL", "CLE", "small"), "https://a.espncdn.com/combiner/i?img=/i/teamlogos/nfl/500/cle.png&w=80&h=80");
  assert.equal(F.logoUrl("MLB", "phi", "full"), "https://a.espncdn.com/i/teamlogos/mlb/500/phi.png");
  assert.equal(F.logoUrl("College football", "254", "small"), "https://a.espncdn.com/combiner/i?img=/i/teamlogos/ncaa/500/254.png&w=80&h=80");
  assert.equal(F.logoUrl("College football", "UTAH", "small"), null, "college takes the numeric id, not the abbreviation");
  assert.equal(F.logoUrl("NFL", 'cle"><x', "small"), null);
  assert.equal(F.logoUrl("NFL", "CLE"), F.logoUrl("NFL", "CLE", "small"), "small by default");
  assert.equal(F.logoUrl("Curling", "x", "small"), null);
});

test("teamKey: what a player's team is keyed by, per league; college from the game's ids", () => {
  const g = { home: "UTAH", away: "BYU", homeId: "254", awayId: "252" };
  assert.equal(F.teamKey("NFL", "CLE"), "cle");
  assert.equal(F.teamKey("MLB", "PHI"), "phi");
  assert.equal(F.teamKey("College football", "UTAH", g), "254");
  assert.equal(F.teamKey("College football", "BYU", g), "252");
  assert.equal(F.teamKey("College football", "UTAH", null), null, "no game, no id, no mark");
  assert.equal(F.teamKey("College football", "USC", g), null, "a team not in that game");
  assert.equal(F.teamKey("NFL", ""), null);
});

test("img: the house markup for an image, and nothing for no url", () => {
  const h = F.img("https://a.espncdn.com/x.png", "face", 44);
  assert.match(h, /^<img /);
  assert.match(h, /src="https:\/\/a\.espncdn\.com\/x\.png"/);
  assert.match(h, /class="face"/);
  assert.match(h, /width="44" height="44"/);
  assert.match(h, /alt=""/);
  assert.match(h, /loading="lazy"/); assert.match(h, /decoding="async"/);
  assert.match(h, /referrerpolicy="no-referrer"/);
  assert.match(h, /onerror="this\.hidden=true"/);
  assert.equal(F.img(null, "face", 44), "");
  assert.equal(F.img("", "face", 44), "");
  assert.match(F.img('https://a.espncdn.com/a?b=1&c="2"', "x", 10), /src="https:\/\/a\.espncdn\.com\/a\?b=1&amp;c=&quot;2&quot;"/, "the url is escaped for the attribute");
  assert.match(F.img("https://a.espncdn.com/x.png", "tmark", 22, "Cleveland"), /alt="Cleveland"/);
});

test("face and mark: the two composed helpers pages call", () => {
  const face = F.face("NFL", "2577417", 44);
  assert.match(face, /^<span class="face"><img [^>]*width="44" height="44"[^>]*><\/span>$/);
  assert.equal(F.face("NFL", "nobody", 44), '<span class="face"></span>', "no id: the empty disc, so the row keeps its shape");
  assert.match(F.mark("NFL", "CLE"), /^<img [^>]*class="tmark"[^>]*width="22" height="22"/);
  assert.equal(F.mark("College football", null), "", "no key, no mark, no gap");
  assert.match(F.mark("MLB", "phi", 20), /width="20" height="20"/);
});
