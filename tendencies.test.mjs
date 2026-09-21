/*
 * BetHouse — tendencies.test.mjs
 * The tendencies module is arithmetic over play-by-play rows, so every test
 * here builds the rows by hand and pins the number the arithmetic must
 * produce. No network, no cache: `play()` below is the whole fixture.
 *
 * Oracles, where the arithmetic has a choice to make:
 *   - A dropback is `pass === 1`. nflverse sets `pass` on sacks AND on
 *     scrambles (measured: 2026 weeks 1–2 carry 149 scrambles, all with
 *     pass=1 and rush=0, and 147 sacks, all pass=1). `qb_dropback` misses
 *     10 of those 149, so `pass` is the flag that counts snaps correctly.
 *   - Inside/outside run shares are shares of the runs that CAN be
 *     classified, so they sum to 1. 15 of 1,489 runs in 2026 weeks 1–2
 *     carry neither a location nor a gap; counting them in the denominator
 *     would make both shares quietly low.
 *   - A rate whose denominator is under 20 is null, not a number. A 1-for-2
 *     deep rate is not 50%.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MIN_N, profile, teamProfiles, rank, matchup, describe, profilesThrough,
} from "./tendencies.mjs";

/* A neutral-script first-down dropback, 2026 week 1, KC with the ball. */
const play = (o = {}) => Object.assign({
  game_id: "G1", play_id: 1, season: 2026, week: 1, season_type: "REG",
  posteam: "KC", defteam: "DEN", play_type: "pass", yards_gained: 0,
  shotgun: 0, no_huddle: 0, qb_scramble: 0, sack: 0,
  pass_length: "", pass_location: "", air_yards: null, yards_after_catch: null,
  run_location: "", run_gap: "", down: 1, ydstogo: 10, yardline_100: 50,
  score_differential: 0, game_seconds_remaining: 1800,
  epa: 0, success: 0, pass: 1, rush: 0, complete_pass: 0, pass_oe: null,
}, o);

const pass = (o = {}) => play(o);
const run = (o = {}) => play(Object.assign({ play_type: "run", pass: 0, rush: 1 }, o));
const many = (n, f) => Array.from({ length: n }, (_, i) => f(i));

const near = (got, want, msg) =>
  assert.ok(got != null && Math.abs(got - want) < 1e-9, `${msg}: got ${got}, want ${want}`);

/* ------------------------------------------------------------------ *
 * profile: the play-call split
 * ------------------------------------------------------------------ */

test("profile: pass and rush rates, plays, games, plays per game", () => {
  const plays = [...many(24, () => pass()), ...many(16, () => run())];
  const p = profile(plays);
  assert.equal(p.plays, 40);
  assert.equal(p.games, 1);
  near(p.playsPerGame, 40, "playsPerGame");
  near(p.passRate, 0.6, "passRate");
  near(p.rushRate, 0.4, "rushRate");
  near(p.passRate + p.rushRate, 1, "the two sides of the split are the whole");
  assert.equal(p.n.passRate, 40, "the denominator is every play");
});

test("profile: a sack and a scramble are dropbacks, not runs", () => {
  // nflverse: a sack is play_type "pass"; a scramble is play_type "run" with
  // pass=1 and rush=0. Both are snaps the offence meant to throw on.
  const plays = [
    ...many(18, () => pass()),
    pass({ sack: 1, yards_gained: -7 }),
    pass({ play_type: "run", qb_scramble: 1, yards_gained: 9 }),
    ...many(20, () => run({ yards_gained: 4 })),
  ];
  const p = profile(plays);
  near(p.passRate, 0.5, "20 dropbacks of 40 plays");
  near(p.sackRate, 1 / 20, "one sack in twenty dropbacks");
  near(p.scrambleRate, 1 / 20, "one scramble in twenty dropbacks");
  // ypa is yards per DROPBACK: the sack's -7 and the scramble's +9 are in it.
  near(p.ypa, 2 / 20, "yards per dropback nets the sack");
  near(p.ypc, 4, "yards per designed run");
});

test("profile: distinct games, not distinct rows", () => {
  const p = profile([...many(20, (i) => pass({ game_id: i < 10 ? "A" : "B", play_id: i }))]);
  assert.equal(p.games, 2);
  near(p.playsPerGame, 10, "playsPerGame");
});

/* ------------------------------------------------------------------ *
 * profile: how the ball travels
 * ------------------------------------------------------------------ */

test("profile: deep rate, average air yards and the EPA split by depth", () => {
  const plays = [
    ...many(5, () => pass({ air_yards: 24, epa: 0.6 })),   // deep
    ...many(20, () => pass({ air_yards: 4, epa: 0.1 })),   // short
    ...many(6, () => pass({ sack: 1, yards_gained: -6 })), // no air yards: not a throw
  ];
  const p = profile(plays);
  assert.equal(p.n.deepRate, 25, "the denominator is throws, not dropbacks");
  near(p.deepRate, 5 / 25, "deep rate");
  near(p.shortRate, 20 / 25, "short rate is the complement");
  near(p.avgAirYards, (5 * 24 + 20 * 4) / 25, "average air yards");
  near(p.shortEpa, 0.1, "EPA on short throws");
  assert.equal(p.deepEpa, null, "5 deep throws is under the floor, so no number");
  near(profile(plays, { min: 0 }).deepEpa, 0.6, "with the floor off, the mean is there");
});

test("profile: yards after catch is per completion", () => {
  const plays = [
    ...many(20, () => pass({ air_yards: 5, complete_pass: 1, yards_after_catch: 6 })),
    ...many(10, () => pass({ air_yards: 5, complete_pass: 0 })),
  ];
  near(profile(plays).yacPerCatch, 6, "yacPerCatch");
  assert.equal(profile(plays).n.yacPerCatch, 20);
});

test("profile: inside and outside run shares are shares of the classifiable runs", () => {
  const plays = [
    ...many(6, () => run({ run_location: "middle", epa: 0.2 })),
    ...many(3, () => run({ run_location: "left", run_gap: "guard", epa: 0.2 })),
    ...many(3, () => run({ run_location: "right", run_gap: "tackle", epa: 0.2 })),
    ...many(8, () => run({ run_location: "left", run_gap: "end", epa: -0.1 })),
    ...many(3, () => run({ run_location: "", run_gap: "" })), // charted nowhere
  ];
  const p = profile(plays, { min: 0 });
  assert.equal(p.n.insideRunShare, 20, "the three uncharted runs are out of the denominator");
  assert.equal(p.n.epaPerRush, 23, "but they are still designed runs");
  near(p.insideRunShare, 0.6, "inside share");
  near(p.outsideRunShare, 0.4, "outside share");
  near(p.insideRunShare + p.outsideRunShare, 1, "the two shares are the whole");
  near(p.insideRunEpa, 0.2, "inside EPA");
  near(p.outsideRunEpa, -0.1, "outside EPA");
});

test("profile: explosive plays, EPA and success, split by pass and rush", () => {
  const plays = [
    ...many(15, () => pass({ yards_gained: 25, epa: 1, success: 1 })),
    ...many(5, () => pass({ yards_gained: 3, epa: -0.2, success: 0 })),
    ...many(16, () => run({ yards_gained: 12, epa: 0.5, success: 1 })),
    ...many(4, () => run({ yards_gained: 1, epa: -0.4, success: 0 })),
  ];
  const p = profile(plays);
  near(p.explosivePassRate, 15 / 20, "20+ yard passes");
  near(p.explosiveRushRate, 16 / 20, "10+ yard rushes");
  near(p.epaPerPass, (15 * 1 + 5 * -0.2) / 20, "EPA per dropback");
  near(p.epaPerRush, (16 * 0.5 + 4 * -0.4) / 20, "EPA per designed run");
  near(p.successPass, 0.75, "success on dropbacks");
  near(p.successRush, 0.8, "success on runs");
  near(p.successRate, 31 / 40, "success over everything");
  near(p.epaPerPlay, (15 * 1 + 5 * -0.2 + 16 * 0.5 + 4 * -0.4) / 40, "EPA per play");
});

/* ------------------------------------------------------------------ *
 * profile: the situational windows
 * ------------------------------------------------------------------ */

test("profile: early down, neutral script and red zone are their own windows", () => {
  const plays = [
    // early downs: 20 snaps, 15 dropbacks
    ...many(15, () => pass({ down: 2 })),
    ...many(5, () => run({ down: 1 })),
    // third down: outside the early-down window entirely
    ...many(10, () => pass({ down: 3 })),
    // neutral needs |margin| <= 7 AND more than 900 seconds left
    ...many(20, () => pass({ score_differential: 7, game_seconds_remaining: 901, down: 3 })),
    ...many(30, () => run({ score_differential: 8, game_seconds_remaining: 1800, down: 3 })),
    ...many(30, () => run({ score_differential: 0, game_seconds_remaining: 900, down: 3 })),
    // red zone
    ...many(12, () => pass({ yardline_100: 20, down: 3 })),
    ...many(8, () => run({ yardline_100: 3, down: 3 })),
  ];
  const p = profile(plays);
  assert.equal(p.n.earlyDownPassRate, 20, "down 1 and 2 only");
  near(p.earlyDownPassRate, 0.75, "early-down pass rate");
  // Everything not deliberately pushed out of the window sits at margin 0
  // with 1800 seconds left, so it is neutral: 15 + 5 + 10 + 20 + 12 + 8.
  assert.equal(p.n.neutralPassRate, 70, "one point past the margin, one second short of the clock: both out");
  assert.equal(p.n.redZonePassRate, 20, "yardline_100 <= 20");
  near(p.redZonePassRate, 0.6, "red-zone pass rate");
});

test("profile: pass rate over expectation is the mean of pass_oe, in points", () => {
  const plays = [
    ...many(10, () => pass({ pass_oe: 30 })),
    ...many(10, () => run({ pass_oe: -10 })),
    ...many(10, () => run({ pass_oe: null })), // no expectation model on this snap
  ];
  const p = profile(plays);
  assert.equal(p.n.proe, 20, "only the snaps that carry pass_oe");
  near(p.proe, 10, "mean pass_oe in percentage points");
});

test("profile: shotgun and no-huddle are rates over every play", () => {
  const p = profile([...many(30, () => pass({ shotgun: 1 })), ...many(10, () => run({ no_huddle: 1 }))]);
  near(p.shotgunRate, 0.75, "shotgun rate");
  near(p.noHuddleRate, 0.25, "no-huddle rate");
});

/* ------------------------------------------------------------------ *
 * The floor: a rate with too little behind it is null
 * ------------------------------------------------------------------ */

test("profile: a denominator under the floor yields null, not a noisy number", () => {
  assert.equal(MIN_N, 20);
  const p = profile(many(19, () => pass()));
  assert.equal(p.plays, 19, "the count is still reported");
  assert.equal(p.games, 1);
  near(p.playsPerGame, 19, "and so is the per-game count");
  assert.equal(p.passRate, null, "19 plays is not a pass rate");
  assert.equal(p.n.passRate, 19, "the denominator says why");
  near(profile(many(20, () => pass())).passRate, 1, "twenty is the floor, and it counts");
});

test("profile: an empty set is a profile of nulls, not a crash", () => {
  const p = profile([]);
  assert.equal(p.plays, 0);
  assert.equal(p.games, 0);
  assert.equal(p.playsPerGame, null);
  assert.equal(p.passRate, null);
  assert.equal(p.n.passRate, 0);
});

/* ------------------------------------------------------------------ *
 * The FTN charting join
 * ------------------------------------------------------------------ */

test("profile: charted play action, screens, motion, RPO and blitz", () => {
  const plays = [
    ...many(8, (i) => pass({ play_id: 100 + i, epa: 1, success: 1 })),
    ...many(12, (i) => pass({ play_id: 200 + i, epa: 0, success: 0 })),
    ...many(20, (i) => run({ play_id: 300 + i })),
  ];
  const ftn = new Map();
  for (const p of plays) {
    const pa = p.play_id >= 100 && p.play_id < 200;          // the 8 good dropbacks
    const blitz = p.play_id % 2 === 0;                        // half of everything
    ftn.set(`${p.game_id}|${p.play_id}`, {
      is_play_action: pa, is_screen_pass: p.play_id === 201,
      is_rpo: p.play_id >= 300 && p.play_id < 310, is_motion: true,
      n_blitzers: blitz ? 2 : 0, n_pass_rushers: blitz ? 6 : 4,
    });
  }
  const p = profile(plays, { ftn, min: 0 });
  assert.equal(p.n.playActionRate, 20, "charted dropbacks");
  near(p.playActionRate, 8 / 20, "play-action rate");
  near(p.screenRate, 1 / 20, "screen rate");
  near(p.rpoRate, 10 / 40, "RPO is a rate over every charted play, runs included");
  near(p.motionRate, 1, "motion rate");
  near(p.blitzRate, 10 / 20, "blitz rate over dropbacks");
  near(p.paEpa, 1, "EPA on play action");
  near(p.paSuccess, 1, "success on play action");
  // blitzed dropbacks: the even play_ids, 4 of the 8 good and 6 of the 12 flat.
  near(p.blitzEpa, (4 * 1 + 6 * 0) / 10, "EPA against the blitz");
});

test("profile: with no charting, the charted rates are null and nothing else changes", () => {
  const plays = many(30, () => pass({ epa: 0.1 }));
  const bare = profile(plays);
  assert.equal(bare.playActionRate, null);
  assert.equal(bare.blitzRate, null);
  assert.equal(bare.n.playActionRate, 0);
  near(bare.epaPerPass, 0.1, "the uncharted numbers are untouched");
});

/* ------------------------------------------------------------------ *
 * teamProfiles: one side's plays, from both sides
 * ------------------------------------------------------------------ */

test("teamProfiles: offence is what a team did, defence is what it faced", () => {
  const plays = [
    // KC with the ball against DEN: all passes
    ...many(20, (i) => pass({ game_id: "A", play_id: i, posteam: "KC", defteam: "DEN", epa: 0.5 })),
    // DEN with the ball against KC: all runs
    ...many(20, (i) => run({ game_id: "A", play_id: 100 + i, posteam: "DEN", defteam: "KC", epa: -0.2 })),
  ];
  const { off, def, league } = teamProfiles(plays);
  near(off.KC.passRate, 1, "KC threw it every down");
  near(off.DEN.rushRate, 1, "DEN ran it every down");
  near(def.DEN.passRate, 1, "DEN's defence saw nothing but passes");
  near(def.KC.rushRate, 1, "KC's defence saw nothing but runs");
  near(def.DEN.epaPerPlay, 0.5, "a defence's EPA is what it allowed");
  near(league.passRate, 0.5, "the league is both sides of every play, once");
  assert.equal(league.plays, 40);
  assert.equal(Object.keys(off).sort().join(","), "DEN,KC");
});

test("teamProfiles: the league profile is the same set seen from either side", () => {
  const plays = [
    ...many(20, (i) => pass({ game_id: "A", play_id: i, posteam: "KC", defteam: "DEN", air_yards: 22 })),
    ...many(20, (i) => run({ game_id: "A", play_id: 100 + i, posteam: "DEN", defteam: "KC" })),
  ];
  const { off, def, league } = teamProfiles(plays);
  // Summing offences and summing defences has to give the same league, which
  // is why matchup() can compare an offence and a defence to one number.
  near(off.KC.n.plays + off.DEN.n.plays, league.n.plays, "offences sum to the league");
  near(def.KC.n.plays + def.DEN.n.plays, league.n.plays, "so do defences");
  near(league.deepRate, 1, "the league's deep rate");
});

/* ------------------------------------------------------------------ *
 * rank
 * ------------------------------------------------------------------ */

test("rank: 1 is best, ties share a place, a null value is unranked", () => {
  const profiles = {
    A: { epaPerPlay: 0.3 }, B: { epaPerPlay: 0.1 }, C: { epaPerPlay: 0.3 },
    D: { epaPerPlay: -0.2 }, E: { epaPerPlay: null },
  };
  const hi = rank(profiles, "epaPerPlay", { higherIsBetter: true });
  assert.deepEqual(hi, { A: 1, C: 1, B: 3, D: 4 });
  assert.equal("E" in hi, false, "no number, no rank");
  const lo = rank(profiles, "epaPerPlay", { higherIsBetter: false });
  assert.deepEqual(lo, { D: 1, B: 2, A: 3, C: 3 });
  assert.equal(Object.keys(lo).length, 4, "the caller counts the field to say '3rd of 4'");
});

/* ------------------------------------------------------------------ *
 * matchup
 * ------------------------------------------------------------------ */

const prof = (o) => Object.assign({
  deepRate: null, shortRate: null, insideRunShare: null, outsideRunShare: null,
  playActionRate: null, blitzRate: null,
  deepEpa: null, shortEpa: null, insideRunEpa: null, outsideRunEpa: null,
  paEpa: null, blitzEpa: null,
}, o);

test("matchup: each family carries the offence's share and the defence's EPA allowed", () => {
  const off = prof({ deepRate: 0.15, shortRate: 0.85, deepEpa: 0.25 });
  const def = prof({ deepRate: 0.12, shortRate: 0.88, deepEpa: 0.31 });
  const league = prof({ deepRate: 0.11, shortRate: 0.89, deepEpa: 0.18, shortEpa: 0.02 });
  const edges = matchup(off, def, league);
  const deep = edges.find((e) => e.family === "deep pass");
  assert.ok(deep, "there is a deep-pass edge");
  near(deep.offShare, 0.15, "offShare");
  near(deep.offShareLeague, 0.11, "offShareLeague");
  near(deep.defAllowed, 0.31, "defAllowed");
  near(deep.defAllowedLeague, 0.18, "defAllowedLeague");
  near(deep.lean, 0.04, "lean is the offence's share over the league's");
  near(deep.edge, 0.13, "edge is the EPA the defence allows over the league's");
  assert.equal(deep.note, "lean+soft", "leans into a family the defence is soft against");
});

test("matchup: the tags name the four directions, and a quiet matchup is neutral", () => {
  const league = prof({ insideRunShare: 0.6, outsideRunShare: 0.4, insideRunEpa: 0, outsideRunEpa: 0 });
  const tag = (share, allowed) => matchup(
    prof({ insideRunShare: share }), prof({ insideRunEpa: allowed }), league,
  ).find((e) => e.family === "inside run").note;
  assert.equal(tag(0.60, 0), "neutral");
  assert.equal(tag(0.64, 0.06), "lean+soft");
  assert.equal(tag(0.64, -0.06), "lean+stout");
  assert.equal(tag(0.56, 0.06), "avoid+soft");
  assert.equal(tag(0.56, -0.06), "avoid+stout");
  assert.equal(tag(0.64, 0), "lean");
  assert.equal(tag(0.60, -0.06), "stout");
});

test("matchup: a family nobody has a number for is left out", () => {
  const edges = matchup(prof({ deepRate: 0.15 }), prof({ deepEpa: 0.2 }), prof({ deepRate: 0.11 }));
  assert.deepEqual(edges.map((e) => e.family), ["deep pass"], "no charting, no play-action edge");
});

test("describe: the sentence carries the numbers the edge holds", () => {
  const edges = matchup(
    prof({ deepRate: 0.15 }), prof({ deepEpa: 0.31 }), prof({ deepRate: 0.11, deepEpa: 0.18 }),
  );
  const s = describe(edges[0], { off: "KC", def: "DEN" });
  assert.match(s, /KC/);
  assert.match(s, /DEN/);
  assert.match(s, /15%/);
  assert.match(s, /11%/);
  assert.match(s, /\+0\.31/);
  assert.match(s, /\+0\.18/);
  assert.equal(typeof s, "string");
});

/* ------------------------------------------------------------------ *
 * profilesThrough: what was known before a given week
 * ------------------------------------------------------------------ */

const seasonPlay = (season, week, o = {}) =>
  play(Object.assign({ season, week, game_id: `${season}_${week}`, play_id: Math.random() }, o));

test("profilesThrough: the window stops before the week being asked about", () => {
  const plays = [
    ...many(20, () => seasonPlay(2026, 1, { epa: 1 })),
    ...many(20, () => seasonPlay(2026, 2, { epa: 1 })),
    ...many(20, () => seasonPlay(2026, 3, { epa: -5 })),  // the week itself
    ...many(20, () => seasonPlay(2026, 4, { epa: -5 })),  // and the future
  ];
  const t = profilesThrough(plays, 2026, 3);
  assert.equal(t.off.KC.plays, 40, "weeks 1 and 2 only");
  assert.equal(t.week, 3);
  assert.equal(t.season, 2026);
  near(t.off.KC.epaPerPlay, 1, "nothing from week 3 leaked in");
  assert.equal(profilesThrough(plays, 2026, 1).off.KC ?? null, null, "before week 1 there is nothing");
});

test("profilesThrough: another season's plays are not this season's", () => {
  const plays = [
    ...many(20, () => seasonPlay(2025, 9, { epa: -5 })),
    ...many(20, () => seasonPlay(2026, 1, { epa: 1 })),
  ];
  const t = profilesThrough(plays, 2026, 2, { K: 0 });
  assert.equal(t.off.KC.plays, 20, "2025 is prior-season weight, not this season's sample");
  near(t.off.KC.epaPerPlay, 1, "with K=0 the prior carries no weight at all");
});

test("profilesThrough: the current season is regressed toward the prior by K games of it", () => {
  /* Prior season: one game, 5 dropbacks, EPA 2 each. Per game that is 5
     dropbacks, so K=6 games of prior weighs 30 dropbacks at a mean of 2.
     Current: 10 dropbacks at EPA 1.
     Blended = (10*1 + 2*30) / (10 + 30) = 70/40 = 1.75. */
  const plays = [
    ...many(5, () => seasonPlay(2025, 1, { epa: 2 })),
    ...many(10, () => seasonPlay(2026, 1, { epa: 1 })),
  ];
  const t = profilesThrough(plays, 2026, 2, { K: 6, min: 0 });
  near(t.off.KC.epaPerPass, 1.75, "blended EPA per dropback");
  near(t.off.KC.n.epaPerPass, 40, "the effective sample is current plus K games of prior");
  assert.equal(t.off.KC.plays, 10, "but `plays` is still what this season actually ran");
  assert.equal(t.K, 6);
});

test("profilesThrough: before week 1 the answer is last season, unchanged", () => {
  const plays = many(30, () => seasonPlay(2025, 1, { epa: 2, air_yards: 25 }));
  const t = profilesThrough(plays, 2026, 1, { K: 6, min: 0 });
  near(t.off.KC.epaPerPass, 2, "with no current plays, the prior is the whole answer");
  near(t.off.KC.deepRate, 1, "and so is its deep rate");
  assert.equal(t.off.KC.plays, 0, "nothing has been played this season");
});

test("profilesThrough: an explicit prior beats what is in the array", () => {
  const plays = many(10, () => seasonPlay(2026, 1, { epa: 1 }));
  const priorSeasonPlays = many(5, () => seasonPlay(2025, 1, { epa: 2 }));
  const t = profilesThrough(plays, 2026, 2, { K: 6, min: 0, priorSeasonPlays });
  near(t.off.KC.epaPerPass, 1.75, "the same blend, from a prior handed in separately");
});

test("profilesThrough: a team with no prior season regresses toward the prior league", () => {
  const plays = [
    ...many(30, () => seasonPlay(2025, 1, { posteam: "KC", defteam: "DEN", epa: 2 })),
    ...many(30, () => seasonPlay(2026, 1, { posteam: "HOU", defteam: "TEN", epa: 1 })),
  ];
  const t = profilesThrough(plays, 2026, 2, { K: 6, min: 0 });
  // HOU never played in 2025 here, so it falls back to the prior LEAGUE, not
  // to nothing: a team with three games on file should not read as an outlier.
  assert.ok(t.off.HOU.epaPerPass > 1 && t.off.HOU.epaPerPass < 2,
    `HOU regresses toward the prior league, got ${t.off.HOU.epaPerPass}`);
});

test("profilesThrough: the league is regressed too, so week 1 is not empty", () => {
  const plays = many(30, () => seasonPlay(2025, 1, { epa: 2 }));
  const t = profilesThrough(plays, 2026, 1, { K: 6 });
  assert.notEqual(t.league.epaPerPlay, null, "the league profile survives an empty week 1");
  near(t.league.epaPerPlay, 2, "and it is last season's league");
});

/* ------------------------------------------------------------------ *
 * Team codes
 * ------------------------------------------------------------------ */

test("tendencies reads whatever team code the loader hands it", async () => {
  // Translation is the loader's job, not this module's: nflverse.mjs turns
  // LA into LAR and WAS into WSH before a play ever gets here, so the whole
  // repo speaks ESPN's codes. This pins the boundary.
  const { toEspnTeam } = await import("./nflverse.mjs");
  const plays = many(20, (i) => pass({ play_id: i, posteam: toEspnTeam("LA"), defteam: toEspnTeam("WAS") }));
  const { off, def } = teamProfiles(plays);
  assert.deepEqual(Object.keys(off), ["LAR"]);
  assert.deepEqual(Object.keys(def), ["WSH"]);
});

test("matchup: the blitz is the defence's call, so its share is the defence's and it gets no lean", () => {
  const off = { blitzRate: 0.40, blitzEpa: 0.2, deepRate: 0.2, deepEpa: 0.1 };
  const def = { blitzRate: 0.25, blitzEpa: -0.1, deepRate: 0.1, deepEpa: 0.3 };
  const league = { blitzRate: 0.30, blitzEpa: 0.0, deepRate: 0.12, deepEpa: 0.2 };
  const edges = matchup(off, def, league);
  const blitz = edges.find((e) => e.family === "vs blitz");
  assert.equal(blitz.offShare, 0.25, "how often the DEFENCE blitzes, not how often the offence was blitzed");
  assert.equal(blitz.lean, null);
  assert.equal(blitz.defsCall, true);
  assert.ok(!/lean|avoid/.test(blitz.note));
  const deep = edges.find((e) => e.family === "deep pass");
  assert.equal(deep.offShare, 0.2, "an offence's own family reads its own share");
  assert.ok(Math.abs(deep.lean - 0.08) < 1e-12);
});
