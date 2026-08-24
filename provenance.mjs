/*
 * BetHouse — provenance.mjs
 * Every number this repo prints says where it came from.
 *
 * WHY THIS EXISTS
 * ---------------
 * On 2026-08-24 an analysis session ran against a working tree 77 commits
 * behind origin and reported three things as fact, all of them false:
 *
 *   "the odds feed is broken"        — it was serving 244 markets
 *   "CLV has collected nothing"      — 666 frozen prices across two days
 *   "the new model has no record"    — 1,355 graded predictions
 *
 * Every reading was correct for the files on disk. The files were old.
 *
 * Nobody catches that by being careful, because a stale number and a current
 * number are the same number. The repo already solved this problem once, for
 * predictions: `recordedAt` is stamped on every row so a result can never be
 * mistaken for a prediction. This does the same thing for analysis output.
 *
 * THE RULE
 * --------
 * Any tool whose output someone might act on prints `banner()` first, always,
 * even when everything is fine. A banner that only appears on trouble teaches
 * the reader to skim past it, and then its ABSENCE becomes the signal instead
 * of its content. Unconditional, or it does not work.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * Fetch. A network call inside every analysis run would be slow, would fail
 * offline, and would make the tool's behaviour depend on the network. Instead
 * it reports how old the last fetch was and lets the reader judge, because a
 * `behind` count computed from an unfetched ref is not a reassurance -- it is
 * a guess wearing a number's clothes.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));

/* How long data may sit before it stops describing today. The board refreshes
   many times a day, so anything past one day means a workflow is failing. */
const DATA_STALE_DAYS = 1;
/* A fetch older than this makes the behind-count unreliable. Origin here moves
   hourly. */
const FETCH_STALE_HOURS = 6;

/* ------------------------------------------------------------------ *
 * How old is the data on disk
 * ------------------------------------------------------------------ */

export function newestDay(dir) {
  if (!fs.existsSync(dir)) return null;
  const days = fs
    .readdirSync(dir)
    .filter((f) => /^\d{4}-\d\d-\d\d\.json$/.test(f))
    .map((f) => f.slice(0, 10))
    .sort();
  return days.length ? days[days.length - 1] : null;
}

export function daysOld(day, now = Date.now()) {
  if (typeof day !== "string" || !/^\d{4}-\d\d-\d\d$/.test(day)) return null;
  const t = Date.parse(`${day}T00:00:00Z`);
  if (!isFinite(t)) return null;
  /* Guard against a date that parses but is not real: Date.parse accepts some
     impossible values in some runtimes, and a silently wrong age is worse than
     a null. */
  const round = new Date(t).toISOString().slice(0, 10);
  if (round !== day) return null;
  const nowDay = Date.parse(`${new Date(now).toISOString().slice(0, 10)}T00:00:00Z`);
  return Math.max(0, Math.round((nowDay - t) / 86400000));
}

/* ------------------------------------------------------------------ *
 * What makes a reading untrustworthy. Pure, so it is testable without git.
 * ------------------------------------------------------------------ */

export function reasons(state) {
  const out = [];
  const { behind, dirty, fetchAgeHours, dataAgeDays } = state || {};

  if (behind > 0) {
    out.push(`the checkout is ${behind} commit${behind === 1 ? "" : "s"} behind origin/main`);
  }
  if (fetchAgeHours == null || fetchAgeHours > FETCH_STALE_HOURS) {
    /* Said even when behind is 0, because that zero was computed from a local
       ref that may itself be a day old. This is the reassurance that was
       false on 2026-08-24. */
    out.push(
      `origin was last fetched ${fetchAgeHours == null ? "never" : `${Math.round(fetchAgeHours)}h ago`}, ` +
        `so the behind-count is not reliable`,
    );
  }
  if (dataAgeDays == null) {
    out.push(`no dated records on disk, so the data age is unknown`);
  } else if (dataAgeDays > DATA_STALE_DAYS) {
    out.push(`the newest record on disk is ${dataAgeDays} days old`);
  }
  if (dirty) {
    out.push(`there are uncommitted changes, so this does not match any commit`);
  }
  return out;
}

/**
 * The subset of reasons that should fail a gate rather than merely be printed.
 *
 * A dirty tree is the normal state of development; a check that failed on it
 * would fire every run and be switched off within a day. An unfetched ref is
 * worth saying but is not itself wrong. Being behind origin, or holding data
 * older than the refresh cadence, means the numbers describe a repository or a
 * day that no longer exists -- act on those and you are acting on fiction.
 *
 * Always a subset of `reasons()`, so a gate can never fail for something the
 * human was not shown.
 */
export function blocking(state) {
  return reasons(state).filter((r) => /behind origin|days old/.test(r));
}

/* ------------------------------------------------------------------ *
 * Reading the real repo
 * ------------------------------------------------------------------ */

const git = (args) => {
  try {
    return execFileSync("git", args, { cwd: DIR, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
};

export function repoState(now = Date.now()) {
  const head = git(["rev-parse", "--short", "HEAD"]) || "unknown";
  const dirty = (git(["status", "--porcelain"]) || "") !== "";
  const behindRaw = git(["rev-list", "--count", "HEAD..origin/main"]);
  const behind = Number(behindRaw);

  let fetchAgeHours = null;
  for (const f of ["FETCH_HEAD", "refs/remotes/origin/main"]) {
    const p = path.join(DIR, ".git", f);
    if (fs.existsSync(p)) {
      fetchAgeHours = (now - fs.statSync(p).mtimeMs) / 3600000;
      break;
    }
  }

  const newest = newestDay(path.join(DIR, "history"));
  return {
    head,
    dirty,
    behind: Number.isFinite(behind) ? behind : 0,
    fetchAgeHours,
    dataDay: newest,
    dataAgeDays: daysOld(newest, now),
  };
}

/* ------------------------------------------------------------------ *
 * The banner
 * ------------------------------------------------------------------ */

export function banner(state) {
  const rs = reasons(state);
  const lines = [];
  lines.push(
    `read at ${state.head}${state.dataDay ? `, newest record ${state.dataDay}` : ""}` +
      (rs.length ? "" : " — current"),
  );
  if (rs.length) {
    /* Two different complaints, and conflating them would cry wolf. Behind
       origin or stale data means the reading describes a world that has moved
       on. A dirty tree is the opposite problem: the reading is NEWER than any
       commit and simply cannot be reproduced. Saying "not current" for a
       working tree mid-edit would fire on every development run and teach the
       reader to ignore the banner, which is the one failure mode this cannot
       afford. */
    const bad = blocking(state);
    lines.push(bad.length ? `THIS READING IS NOT CURRENT:` : `NOTE:`);
    for (const r of rs) lines.push(`  - ${r}`);
    if (bad.length) lines.push(`  run: git fetch origin && git pull --ff-only`);
  }
  return lines.join("\n");
}

/* ------------------------------------------------------------------ *
 * CLI: `node provenance.mjs` prints the banner and exits non-zero if stale.
 * Used by scripts/local-check.sh so a stale tree is loud rather than silent.
 * ------------------------------------------------------------------ */

if (import.meta.url === `file://${process.argv[1]}`) {
  const s = repoState();
  console.log(banner(s));
  /* Exits non-zero only on what should stop a gate. `--all` treats every
     reason as blocking, for a pre-push check where a dirty tree does matter. */
  const bad = process.argv.includes("--all") ? reasons(s) : blocking(s);
  process.exit(bad.length ? 1 : 0);
}
