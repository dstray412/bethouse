#!/usr/bin/env node
/*
 * BetHouse — tendencies.mjs
 * What an offence does, what a defence allows, and where the two disagree.
 *
 *   node tendencies.mjs                      # 2024–2026, writes tendencies-nfl.json
 *   node tendencies.mjs --seasons 2024-2026
 *
 * WHY
 * ---
 * Every game-line question this repo has asked came back inside the noise,
 * and the 2026-09-08 sweep over 27 seasons said why: the closing line
 * already contains everything a box score does (README, "Reconfiguring the
 * model"). So the next attempt needs something a box score cannot see. A
 * play-by-play file can see it. It knows that a team threw on 62% of its
 * early downs and 71% of its neutral-script snaps, that it went deep on 15%
 * of its throws, that it ran outside on 28% of its carries — and, from the
 * other side, that the defence across from it has given up +0.31 EPA per
 * deep throw against a league +0.18.
 *
 * WHAT THIS FILE IS
 * -----------------
 * Arithmetic, and nothing else. Every function here is pure: hand it plays,
 * it hands back numbers. Nothing fetches, nothing writes, nothing formats
 * except `describe`, which exists so a board never has to reinvent a
 * sentence. `main` at the bottom is the only I/O in the file.
 *
 * WHAT IT IS NOT
 * --------------
 * Not wired into any board, fetcher, tracker or backtest. Not a bet. These
 * are descriptions, and a description is not an edge until something
 * measures it against a price — which nothing here does yet.
 *
 * THE THREE CHOICES WORTH ARGUING WITH
 * ------------------------------------
 * 1. A dropback is `pass === 1`, not `qb_dropback`. nflverse sets `pass` on
 *    sacks and on scrambles; `qb_dropback` misses ten of 2026's 149
 *    scrambles. See isScrimmage in nflverse.mjs.
 * 2. Inside and outside run shares are shares of the runs that CAN be
 *    classified, so they sum to 1. Fifteen of 1,489 runs in 2026 weeks 1–2
 *    carry neither a location nor a gap; leaving them in the denominator
 *    would make both shares quietly low, and a reader comparing two teams
 *    with different charting gaps would be comparing charting, not running.
 * 3. A rate whose denominator is under twenty plays is null, not a number.
 *    One deep ball in two is not a 50% deep rate, and a board that prints
 *    it will be believed. MIN_N is that floor.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Under this many plays behind a rate, the rate is null. */
export const MIN_N = 20;

/* ------------------------------------------------------------------ *
 * Play families
 * ------------------------------------------------------------------ */

/** A snap the offence meant to throw on: a pass, a sack or a scramble. */
export const isDropback = (p) => p.pass === 1;

/** A called run. Scrambles are not here; they are dropbacks that broke. */
export const isDesignedRun = (p) => p.rush === 1;

/**
 * "inside" | "outside" | null for a run.
 * nflverse charts run_location (left/middle/right) and, for left and right
 * only, run_gap (guard/tackle/end). Middle is inside by construction;
 * guard and tackle are inside; end is outside. A run with neither is
 * unclassified rather than guessed.
 */
export function runFamily(p) {
  const gap = p.run_gap, loc = p.run_location;
  if (gap === "guard" || gap === "tackle" || loc === "middle") return "inside";
  if (gap === "end") return "outside";
  return null;
}

/** Neutral script: within a touchdown either way, and before the fourth quarter. */
export const isNeutral = (p) =>
  p.score_differential != null && Math.abs(p.score_differential) <= 7
  && p.game_seconds_remaining != null && p.game_seconds_remaining > 900;

/* The depth a throw has to travel to be "deep", and the gains that make a
   play explosive. Conventional numbers, not fitted ones — 20 air yards is
   where every public charting source draws the line, and 20 / 10 yards is
   the usual explosive-play pair. Stated here so a later pass can move them
   in one place and see what changes. */
export const DEEP_AIR_YARDS = 20;
export const EXPLOSIVE_PASS = 20;
export const EXPLOSIVE_RUSH = 10;

/* ------------------------------------------------------------------ *
 * The metrics
 *
 * Every metric is a mean: a rate is the mean of a 0/1 indicator, an EPA is
 * the mean of an EPA. That is not a flourish — it means every metric
 * carries its own denominator, which is what makes the null floor honest
 * (deepEpa's denominator is deep throws, not plays) and what lets
 * profilesThrough regress each metric by the right amount of prior season.
 * ------------------------------------------------------------------ */

export const METRICS = [
  // play calling
  "passRate", "rushRate", "proe", "earlyDownPassRate", "neutralPassRate", "redZonePassRate",
  "shotgunRate", "noHuddleRate",
  // how the ball travels
  "deepRate", "shortRate", "avgAirYards", "yacPerCatch",
  "insideRunShare", "outsideRunShare",
  // how well it goes
  "epaPerPlay", "epaPerPass", "epaPerRush",
  "successRate", "successPass", "successRush",
  "explosivePassRate", "explosiveRushRate",
  "ypa", "ypc", "sackRate", "scrambleRate",
  "deepEpa", "shortEpa", "insideRunEpa", "outsideRunEpa",
  // FTN charting, when it is joined
  "playActionRate", "rpoRate", "screenRate", "motionRate", "blitzRate",
  "paEpa", "paSuccess", "blitzEpa", "blitzSuccess",
];

function tally(m, key, v) {
  const a = m[key] || (m[key] = { n: 0, sum: 0 });
  a.n++; a.sum += v;
}
const ind = (b) => (b ? 1 : 0);

/**
 * Sums and counts over one side's plays. Not for callers — `profile` is —
 * but the shape profilesThrough blends, because you cannot blend two means
 * without knowing what is behind each of them.
 */
export function rawProfile(plays, ftn) {
  const m = {};
  const games = new Set();
  let n = 0;
  for (const p of plays) {
    n++;
    if (p.game_id) games.add(p.game_id);
    const drop = isDropback(p), run = isDesignedRun(p);

    tally(m, "passRate", ind(drop));
    tally(m, "rushRate", ind(run));
    tally(m, "shotgunRate", ind(p.shotgun === 1));
    tally(m, "noHuddleRate", ind(p.no_huddle === 1));
    if (p.epa != null) tally(m, "epaPerPlay", p.epa);
    if (p.success != null) tally(m, "successRate", p.success);
    if (p.pass_oe != null) tally(m, "proe", p.pass_oe);
    if (p.down === 1 || p.down === 2) tally(m, "earlyDownPassRate", ind(drop));
    if (isNeutral(p)) tally(m, "neutralPassRate", ind(drop));
    if (p.yardline_100 != null && p.yardline_100 <= 20) tally(m, "redZonePassRate", ind(drop));

    if (drop) {
      if (p.epa != null) tally(m, "epaPerPass", p.epa);
      if (p.success != null) tally(m, "successPass", p.success);
      if (p.yards_gained != null) {
        tally(m, "ypa", p.yards_gained);
        tally(m, "explosivePassRate", ind(p.yards_gained >= EXPLOSIVE_PASS));
      }
      tally(m, "sackRate", ind(p.sack === 1));
      tally(m, "scrambleRate", ind(p.qb_scramble === 1));
      if (p.air_yards != null) {
        const deep = p.air_yards >= DEEP_AIR_YARDS;
        tally(m, "deepRate", ind(deep));
        tally(m, "shortRate", ind(!deep));
        tally(m, "avgAirYards", p.air_yards);
        if (p.epa != null) tally(m, deep ? "deepEpa" : "shortEpa", p.epa);
      }
      if (p.complete_pass === 1 && p.yards_after_catch != null) tally(m, "yacPerCatch", p.yards_after_catch);
    }

    if (run) {
      if (p.epa != null) tally(m, "epaPerRush", p.epa);
      if (p.success != null) tally(m, "successRush", p.success);
      if (p.yards_gained != null) {
        tally(m, "ypc", p.yards_gained);
        tally(m, "explosiveRushRate", ind(p.yards_gained >= EXPLOSIVE_RUSH));
      }
      const fam = runFamily(p);
      if (fam) {
        tally(m, "insideRunShare", ind(fam === "inside"));
        tally(m, "outsideRunShare", ind(fam === "outside"));
        if (p.epa != null) tally(m, fam === "inside" ? "insideRunEpa" : "outsideRunEpa", p.epa);
      }
    }

    const f = ftn && ftn.get(`${p.game_id}|${p.play_id}`);
    if (f) {
      tally(m, "rpoRate", ind(f.is_rpo === true));
      tally(m, "motionRate", ind(f.is_motion === true));
      if (drop) {
        tally(m, "playActionRate", ind(f.is_play_action === true));
        tally(m, "screenRate", ind(f.is_screen_pass === true));
        const blitz = f.n_blitzers != null && f.n_blitzers >= 1;
        if (f.n_blitzers != null) tally(m, "blitzRate", ind(blitz));
        if (f.is_play_action === true) {
          if (p.epa != null) tally(m, "paEpa", p.epa);
          if (p.success != null) tally(m, "paSuccess", p.success);
        }
        if (blitz) {
          if (p.epa != null) tally(m, "blitzEpa", p.epa);
          if (p.success != null) tally(m, "blitzSuccess", p.success);
        }
      }
    }
  }
  return { plays: n, games: games.size, metrics: m };
}

/** Raw sums and counts → the profile a caller reads, with the null floor applied. */
export function finish(raw, min = MIN_N) {
  const out = {
    plays: raw.plays,
    games: raw.games,
    playsPerGame: raw.games ? raw.plays / raw.games : null,
    n: { plays: raw.plays, games: raw.games },
  };
  for (const k of METRICS) {
    const a = raw.metrics[k];
    out[k] = a && a.n >= min && a.n > 0 ? a.sum / a.n : null;
    out.n[k] = a ? a.n : 0;
  }
  return out;
}

/**
 * Aggregate one side's plays: an offence's own snaps, or the snaps a
 * defence faced. `ftn` is the charting Map from nflverse.loadFtnCharting;
 * without it the charted metrics are null and nothing else changes.
 * `min` overrides the null floor — profilesThrough sets it to 0 while it
 * is still blending, and applies the floor to the blend instead.
 */
export function profile(plays, opts = {}) {
  return finish(rawProfile(plays, opts.ftn), opts.min ?? MIN_N);
}

/**
 * Every team's offence and defence, plus the league.
 *
 * A defence's profile is the profile of the plays it faced, so a "pass
 * rate" on the defensive side means how often it was thrown at, and an
 * "epaPerPlay" means what it gave up. The league profile is the same set of
 * plays counted once, which is why it serves as the baseline for both
 * sides in `matchup`.
 */
export function teamProfiles(plays, ftn, opts = {}) {
  const min = opts.min ?? MIN_N;
  const { off, def, league } = rawTeamProfiles(plays, ftn);
  const fin = (m) => Object.fromEntries(Object.entries(m).map(([t, r]) => [t, finish(r, min)]));
  return { off: fin(off), def: fin(def), league: finish(league, min) };
}

function rawTeamProfiles(plays, ftn) {
  const byOff = new Map(), byDef = new Map();
  const push = (map, team, p) => {
    if (!team) return;
    const list = map.get(team);
    if (list) list.push(p); else map.set(team, [p]);
  };
  for (const p of plays) { push(byOff, p.posteam, p); push(byDef, p.defteam, p); }
  const build = (map) => Object.fromEntries(
    [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([t, ps]) => [t, rawProfile(ps, ftn)]),
  );
  return { off: build(byOff), def: build(byDef), league: rawProfile(plays, ftn) };
}

/* ------------------------------------------------------------------ *
 * Ranking
 * ------------------------------------------------------------------ */

/**
 * {TEAM: rank} over one metric, 1 = best. Ties share a place, and a team
 * whose value is null (too little behind it) is absent rather than last —
 * `Object.keys(r).length` is the field a caller says "3rd of 30" against.
 */
export function rank(profiles, key, opts = {}) {
  const hi = opts.higherIsBetter !== false;
  const rows = Object.entries(profiles)
    .filter(([, p]) => p && p[key] != null)
    .sort((a, b) => (hi ? b[1][key] - a[1][key] : a[1][key] - b[1][key]));
  const out = {};
  let prev = null, place = 0;
  rows.forEach(([t, p], i) => {
    if (prev === null || p[key] !== prev) { place = i + 1; prev = p[key]; }
    out[t] = place;
  });
  return out;
}

/* ------------------------------------------------------------------ *
 * Matchups
 *
 * An edge is six numbers and a tag: how often this offence uses a family
 * and how often the league does, how well the offence does with it, how
 * often this defence sees it and what it gives up there, and the league's
 * number for the same. The tag is the only interpretation — two thresholds
 * chosen to be legible, not fitted, and stated below so nobody mistakes
 * them for measurements.
 * ------------------------------------------------------------------ */

/** A share this far from the league's is a lean. Chosen for legibility. */
export const LEAN_SHARE = 0.03;
/** EPA per play this far from the league's is soft or stout. Likewise. */
export const SOFT_EPA = 0.05;

const FAMILIES = [
  { family: "deep pass", share: "deepRate", epa: "deepEpa", unit: "of throws" },
  { family: "short pass", share: "shortRate", epa: "shortEpa", unit: "of throws" },
  { family: "inside run", share: "insideRunShare", epa: "insideRunEpa", unit: "of runs" },
  { family: "outside run", share: "outsideRunShare", epa: "outsideRunEpa", unit: "of runs" },
  { family: "play action", share: "playActionRate", epa: "paEpa", unit: "of dropbacks" },
  /* The blitz is the defence's call, not the offence's: the share here is
     how often the DEFENCE blitzes, read off its own profile, and it earns
     no lean/avoid tag. `blitzRate` on an offence's profile is how often it
     was blitzed, which is the same fact seen from the other sideline. */
  { family: "vs blitz", share: "blitzRate", epa: "blitzEpa", unit: "of dropbacks", who: "def" },
];

const sub = (a, b) => (a == null || b == null ? null : a - b);

function noteFor(lean, edge) {
  const t = [];
  if (lean != null) { if (lean >= LEAN_SHARE) t.push("lean"); else if (lean <= -LEAN_SHARE) t.push("avoid"); }
  if (edge != null) { if (edge >= SOFT_EPA) t.push("soft"); else if (edge <= -SOFT_EPA) t.push("stout"); }
  return t.join("+") || "neutral";
}

/**
 * One offence against one defence, family by family. Returns numbers; the
 * sentence is `describe`'s job, so a board can print it differently without
 * touching the arithmetic. A family no side has a number for is left out
 * rather than returned full of nulls.
 *
 * `defAllowed` positive means the defence gives up EPA there, so a soft
 * spot is a POSITIVE `edge`. That is the opposite of the usual "lower is
 * better" defensive convention and it is deliberate: every number in an
 * edge is offence-relative, so they add up in one direction.
 */
export function matchup(off, def, league) {
  const out = [];
  for (const f of FAMILIES) {
    const defsCall = f.who === "def";
    const offShare = defsCall ? (def ? def[f.share] : null) : off ? off[f.share] : null;
    const defAllowed = def ? def[f.epa] : null;
    const leagueShare = league ? league[f.share] : null;
    const leagueEpa = league ? league[f.epa] : null;
    if (offShare == null && defAllowed == null && leagueShare == null && leagueEpa == null) continue;
    const lean = defsCall ? null : sub(offShare, leagueShare);
    const edge = sub(defAllowed, leagueEpa);
    out.push({
      family: f.family,
      unit: f.unit,
      offShare, offShareLeague: leagueShare, defsCall,
      offEpa: off ? off[f.epa] : null, offEpaLeague: leagueEpa,
      defShare: def ? def[f.share] : null, defShareLeague: leagueShare,
      defAllowed, defAllowedLeague: leagueEpa,
      lean, edge,
      note: noteFor(lean, edge),
    });
  }
  return out;
}

const pct = (v) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const epa = (v) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`);

/** One edge as a plain sentence. The only formatting in this file. */
export function describe(e, names = {}) {
  const o = names.off || "the offence", d = names.def || "the defence";
  const who = e.defsCall ? `${d} blitzes on ${pct(e.offShare)} ${e.unit}` : `${o}: ${e.family} on ${pct(e.offShare)} ${e.unit}`;
  return `${who} (league ${pct(e.offShareLeague)}). ` +
    `${d} allows ${epa(e.defAllowed)} EPA there (league ${epa(e.defAllowedLeague)}).`;
}

/* ------------------------------------------------------------------ *
 * Walk-forward: what was known before a given week
 *
 * A replay that asks "what did we know about Denver before week 5" must be
 * given week 1 through 4 and nothing else, or it is reading the answer off
 * the back of the card. Four games is also not a profile, so each metric is
 * regressed toward the same team's last season by K games of it.
 *
 * The weight is in PLAYS, per metric, not in games across the board. For
 * metric k, the prior gets `K * (priorN[k] / priorGames)` — K games' worth
 * of last year's own sample of exactly that metric. That matters because
 * the metrics have wildly different denominators: a team runs ~64 plays a
 * game but throws deep about four times, so six games of prior is ~384
 * plays of pass-rate evidence and ~24 throws of deep-rate evidence. One
 * blanket play count would have regressed the deep rate sixteen times too
 * hard.
 *
 * K = 6 is the same constant fetch-football.mjs regresses its touchdown
 * factors by, for the same reason and with no more justification than that:
 * about a third of a season, enough that week 2 is mostly last year and
 * week 12 is mostly this one.
 *
 * A team with no prior season falls back to the prior LEAGUE (halved to a
 * per-team-game rate, since every league play has two teams in it), so an
 * expansion or a relocation reads as average rather than as an outlier.
 * ------------------------------------------------------------------ */

export const DEFAULT_K = 6;

/** Blend one side's current raw sums toward a prior's means, by K games of prior. */
function blendRaw(cur, prior, K) {
  const out = { plays: cur.plays, games: cur.games, metrics: {} };
  for (const k of METRICS) {
    const a = cur.metrics[k] || { n: 0, sum: 0 };
    const b = prior && prior.metrics[k];
    if (!b || !b.n || !prior.games || !K) { out.metrics[k] = { n: a.n, sum: a.sum }; continue; }
    const w = K * (b.n / prior.games);
    out.metrics[k] = { n: a.n + w, sum: a.sum + (b.sum / b.n) * w };
  }
  return out;
}

const EMPTY_RAW = { plays: 0, games: 0, metrics: {} };

/**
 * Profiles built only from plays before `week` of `season`, regressed
 * toward the prior season.
 *
 * `plays` may hold several seasons; the prior is taken from it unless
 * `priorSeasonPlays` is handed in. `K` is in games (default 6); `K: 0`
 * turns the regression off and gives the raw current-season numbers.
 *
 * The returned profiles carry `plays` and `games` from THIS season only —
 * what actually happened — while `n[metric]` is the effective sample the
 * blend used, current plus the prior's weight. The two differ on purpose:
 * one says what was played, the other says how much the number can bear.
 */
export function profilesThrough(plays, season, week, opts = {}) {
  const K = opts.K ?? DEFAULT_K;
  const min = opts.min ?? MIN_N;
  const ftn = opts.ftn || null;

  const cur = plays.filter((p) => p.season === season && p.week != null && p.week < week);
  const prior = opts.priorSeasonPlays || plays.filter((p) => p.season === season - 1);

  const c = rawTeamProfiles(cur, ftn);
  const b = rawTeamProfiles(prior, ftn);

  /* The prior league, halved: a league play is one offence and one defence,
     so the per-team-game rate is half the per-game rate. */
  const leagueFallback = b.league.games
    ? { metrics: b.league.metrics, games: b.league.games * 2 }
    : null;

  const side = (curSide, priorSide) => {
    const teams = new Set([...Object.keys(curSide), ...Object.keys(priorSide)]);
    const out = {};
    for (const t of [...teams].sort()) {
      const raw = curSide[t] || EMPTY_RAW;
      const p = priorSide[t] || leagueFallback;
      out[t] = finish(blendRaw(raw, p, K), min);
    }
    return out;
  };

  return {
    season, week, K,
    off: side(c.off, b.off),
    def: side(c.def, b.def),
    league: finish(blendRaw(c.league, b.league.games ? b.league : null, K), min),
  };
}

/* ------------------------------------------------------------------ *
 * Main: build the walk-forward table and write it out
 * ------------------------------------------------------------------ */

const DIR = path.dirname(fileURLToPath(import.meta.url));

const round = (v, d) => (v == null ? null : Number(v.toFixed(d)));

/**
 * A profile trimmed for JSON: a null metric's key is dropped, the rest are
 * rounded to four decimals. The DENOMINATOR is kept whenever it is not
 * zero, even for a dropped metric — otherwise a reader cannot tell "this
 * team has never thrown deep" from "it has thrown deep eight times, which
 * is under the floor", and those are different facts.
 */
export function trimProfile(p) {
  const o = { plays: p.plays, games: p.games, playsPerGame: round(p.playsPerGame, 2) };
  for (const k of METRICS) if (p[k] != null) o[k] = round(p[k], 4);
  o.n = { plays: p.n.plays, games: p.n.games };
  for (const k of METRICS) if (p.n[k]) o.n[k] = round(p.n[k], 1);
  return o;
}

function trimSide(side) {
  return Object.fromEntries(Object.entries(side).map(([t, p]) => [t, trimProfile(p)]));
}

async function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf("--seasons");
  /* Two finished seasons and the one under way, like the fetcher: a fixed
     range would go on building 2026 profiles in 2027 and the panel would
     never say so. */
  const year = new Date().getUTCFullYear();
  const [from, to] = i >= 0 ? String(args[i + 1]).split("-").map(Number) : [year - 2, year];
  const seasons = []; for (let s = from; s <= (to || from); s++) seasons.push(s);
  const j = args.indexOf("--out");
  const out = path.join(DIR, j >= 0 ? args[j + 1] : "tendencies-nfl.json");
  const K = args.includes("--k") ? Number(args[args.indexOf("--k") + 1]) : DEFAULT_K;

  const { loadPlayByPlay, loadFtnCharting } = await import("./nflverse.mjs");
  console.log(`seasons ${seasons.join(", ")}`);
  const t0 = Date.now();
  const plays = await loadPlayByPlay(seasons);
  console.log(`plays: ${plays.length} regular-season snaps from scrimmage (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

  let ftn = null;
  if (!args.includes("--no-ftn")) {
    ftn = await loadFtnCharting(seasons);
    let joined = 0;
    for (const p of plays) if (ftn.has(`${p.game_id}|${p.play_id}`)) joined++;
    console.log(`charting: ${ftn.size} FTN rows, ${joined} of ${plays.length} plays joined ` +
      `(${(100 * joined / plays.length).toFixed(1)}%)`);
    if (joined === 0) { console.log("  no play joined — check the id columns before trusting the charted rates"); }
  }

  /* Every (season, week) that has a play in it, walk-forward. */
  const weeks = new Map();
  for (const p of plays) {
    if (p.season == null || p.week == null) continue;
    weeks.set(`${p.season}|${p.week}`, [p.season, p.week]);
  }
  const keys = [...weeks.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const byWeek = {};
  for (const [s, w] of keys) {
    const t = profilesThrough(plays, s, w, { ftn, K });
    byWeek[`${s}|${w}`] = { off: trimSide(t.off), def: trimSide(t.def), league: trimProfile(t.league) };
  }

  /* `current`: everything on file, i.e. one week past the last one played. */
  const [lastS, lastW] = keys.at(-1);
  const now = profilesThrough(plays, lastS, lastW + 1, { ftn, K });

  const doc = {
    generated: new Date().toISOString(),
    seasons, K, minN: MIN_N,
    through: { season: lastS, week: lastW },
    byWeek,
    current: { off: trimSide(now.off), def: trimSide(now.def), league: trimProfile(now.league) },
  };
  writeFileSync(out, JSON.stringify(doc));
  const mb = readFileSync(out).length / 1e6;
  console.log(`wrote ${path.basename(out)}: ${mb.toFixed(1)} MB, ${keys.length} weeks, ` +
    `${Object.keys(doc.current.off).length} offences, ${Object.keys(doc.current.def).length} defences`);

  /* The page's copy: only what is true now, as a plain <script> like the
     other data files, so the game view can put an offence beside the
     defence it faces without the four megabytes of walk-forward history
     that only the replay reads. */
  const page = path.join(DIR, "tendencies-data.js");
  const slim = { generated: doc.generated, seasons, K, through: doc.through, current: doc.current };
  writeFileSync(page, `/* generated by tendencies.mjs — do not edit */\nwindow.BetHouseTendencies = ${JSON.stringify(slim)};\n`);
  console.log(`wrote ${path.basename(page)}: ${(readFileSync(page).length / 1e3).toFixed(0)} KB for the board`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
