/*
 * BetHouse — provenance.test.mjs
 * Every number this repo prints must say where it came from.
 *
 * WHY THIS EXISTS
 * ---------------
 * On 2026-08-24 an analysis session ran against a working tree 77 commits
 * behind origin and reported three things as fact that were all false: that
 * the odds feed was broken (it was serving 244 markets), that closing-line
 * value had collected nothing (it had 666 frozen prices across two days), and
 * that the recalibrated model had no forward record (it had 1,355 graded
 * predictions). Every one of those readings was correct FOR THE FILES ON DISK.
 * The files were just old.
 *
 * That is not a mistake anyone catches by being careful, because a stale
 * number and a current number look identical. The only fix is to make the
 * output carry its own provenance, the same way the forward record carries
 * `recordedAt` -- a result that states the commit it came from and how old its
 * inputs are cannot be quietly mistaken for a fresh one.
 *
 * THE RULE
 * --------
 * Any tool whose output someone might act on prints its provenance banner
 * first. Not a warning that fires on a threshold somebody has to tune -- an
 * unconditional statement of what was read, so a human reading the output can
 * see for themselves.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as prov from "./provenance.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bethouse-prov-"));

/* ---------------------------------------------------------------- *
 * How old is the data on disk
 * ---------------------------------------------------------------- */

test("newestDay: finds the latest dated file, not the last one readdir returns", () => {
  const d = tmp();
  for (const n of ["2026-08-03.json", "2026-08-22.json", "2026-08-11.json"]) {
    fs.writeFileSync(path.join(d, n), "{}");
  }
  assert.equal(prov.newestDay(d), "2026-08-22");
});

test("newestDay: ignores files that are not dated records", () => {
  /* record.js and .gitkeep live in these directories too. A sort that picked
     them up would return a filename as a date and every downstream age
     calculation would read NaN. */
  const d = tmp();
  fs.writeFileSync(path.join(d, "2026-08-03.json"), "{}");
  fs.writeFileSync(path.join(d, "record.js"), "");
  fs.writeFileSync(path.join(d, "2026-8-3.json"), "{}");
  assert.equal(prov.newestDay(d), "2026-08-03");
});

test("newestDay: a directory that does not exist is null, not a crash", () => {
  assert.equal(prov.newestDay(path.join(tmp(), "nope")), null);
});

test("newestDay: an empty directory is null", () => {
  assert.equal(prov.newestDay(tmp()), null);
});

test("daysOld: counts whole days between a record date and now", () => {
  const now = Date.parse("2026-08-24T12:00:00Z");
  assert.equal(prov.daysOld("2026-08-24", now), 0);
  assert.equal(prov.daysOld("2026-08-22", now), 2);
});

test("daysOld: an unreadable date is null rather than a wrong number", () => {
  /* Returning 0 here would report unknown-age data as fresh, which is the
     exact failure this file exists to prevent. */
  for (const bad of [null, undefined, "", "yesterday", "2026-13-45"]) {
    assert.equal(prov.daysOld(bad, Date.now()), null, `${JSON.stringify(bad)} must not read as fresh`);
  }
});

/* ---------------------------------------------------------------- *
 * What makes a reading untrustworthy
 *
 * Pure, so the rules can be tested without a git repo in a temp dir.
 * ---------------------------------------------------------------- */

test("reasons: a clean, current, freshly-fetched tree has nothing to say", () => {
  assert.deepEqual(
    prov.reasons({ behind: 0, dirty: false, fetchAgeHours: 0.2, dataAgeDays: 0 }),
    [],
  );
});

test("reasons: being behind origin is named, with the count", () => {
  const r = prov.reasons({ behind: 77, dirty: false, fetchAgeHours: 0.1, dataAgeDays: 0 });
  assert.equal(r.length, 1);
  assert.match(r[0], /77/, "the count belongs in the message — 1 behind and 77 behind are different problems");
});

test("reasons: an unfetched ref makes the behind count meaningless, and says so", () => {
  /* `git rev-list HEAD..origin/main` reads a LOCAL ref. Without a fetch it can
     cheerfully report 0 behind while origin has moved a hundred commits. A
     behind count is only as fresh as the last fetch, and reporting it without
     that caveat is how "behind: 0" became a false reassurance. */
  const r = prov.reasons({ behind: 0, dirty: false, fetchAgeHours: 30, dataAgeDays: 0 });
  assert.equal(r.length, 1);
  assert.match(r[0], /fetch/i);
});

test("reasons: stale data on disk is named separately from a stale checkout", () => {
  /* Different failures with different fixes. A current checkout can still hold
     old records if the refresh workflow has been failing. */
  const r = prov.reasons({ behind: 0, dirty: false, fetchAgeHours: 0.1, dataAgeDays: 4 });
  assert.equal(r.length, 1);
  assert.match(r[0], /4 days/);
});

test("reasons: unknown data age is reported, never treated as fresh", () => {
  const r = prov.reasons({ behind: 0, dirty: false, fetchAgeHours: 0.1, dataAgeDays: null });
  assert.equal(r.length, 1);
  assert.match(r[0], /unknown|no dated/i);
});

test("reasons: uncommitted changes are named, because they are not on origin", () => {
  const r = prov.reasons({ behind: 0, dirty: true, fetchAgeHours: 0.1, dataAgeDays: 0 });
  assert.equal(r.length, 1);
  assert.match(r[0], /uncommitted/i);
});

test("reasons: every problem is listed, none swallowed by the first", () => {
  /* The 2026-08-24 session had two at once: a stale checkout AND stale data.
     Reporting only the first would have fixed half the problem and left the
     other half looking solved. */
  const r = prov.reasons({ behind: 77, dirty: true, fetchAgeHours: 40, dataAgeDays: 9 });
  assert.equal(r.length, 4, `expected all four, got: ${r.join(" | ")}`);
});

/* ---------------------------------------------------------------- *
 * What should stop a gate, versus what should merely be visible
 *
 * A dirty tree is the normal state of development -- a check that failed on it
 * would fire on every run and get switched off within a day. Being behind
 * origin is different: it means the numbers you are about to read describe a
 * repository that no longer exists.
 * ---------------------------------------------------------------- */

test("blocking: uncommitted changes are shown but never block", () => {
  const state = { behind: 0, dirty: true, fetchAgeHours: 0.1, dataAgeDays: 0 };
  assert.equal(prov.reasons(state).length, 1, "still reported");
  assert.deepEqual(prov.blocking(state), [], "but not a gate failure");
});

test("blocking: being behind origin blocks", () => {
  const b = prov.blocking({ behind: 3, dirty: true, fetchAgeHours: 0.1, dataAgeDays: 0 });
  assert.equal(b.length, 1);
  assert.match(b[0], /behind/);
});

test("blocking: stale data blocks, because it means a workflow is failing", () => {
  const b = prov.blocking({ behind: 0, dirty: false, fetchAgeHours: 0.1, dataAgeDays: 5 });
  assert.equal(b.length, 1);
  assert.match(b[0], /5 days/);
});

test("blocking: never returns a reason that reasons() does not also carry", () => {
  /* Blocking is a subset. If the two lists could diverge, a gate could fail
     for something the banner never showed the human. */
  const state = { behind: 4, dirty: true, fetchAgeHours: 40, dataAgeDays: 6 };
  const all = prov.reasons(state);
  for (const b of prov.blocking(state)) {
    assert.ok(all.includes(b), `blocking reason not in the banner: ${b}`);
  }
});

/* ---------------------------------------------------------------- *
 * The banner
 * ---------------------------------------------------------------- */

test("banner: always states the commit, even when everything is fine", () => {
  /* Unconditional. A banner that only appears when something is wrong trains
     the reader to skip it, and its absence becomes the signal rather than its
     content. */
  const b = prov.banner({ head: "1a38439", behind: 0, dirty: false, fetchAgeHours: 0.1, dataAgeDays: 0 });
  assert.match(b, /1a38439/);
});

test("banner: a bad state names every reason in the text", () => {
  const state = { head: "deadbee", behind: 77, dirty: true, fetchAgeHours: 40, dataAgeDays: 9 };
  const b = prov.banner(state);
  for (const r of prov.reasons(state)) {
    assert.ok(b.includes(r), `banner dropped a reason: ${r}`);
  }
});

test("banner: a dirty tree is a NOTE, not a not-current alarm", () => {
  /* Dirty means the reading is newer than any commit, not older. Shouting the
     same warning for both would fire on every development run, and a banner
     that always shouts is a banner nobody reads. */
  const b = prov.banner({ head: "deadbee", behind: 0, dirty: true, fetchAgeHours: 0.1, dataAgeDays: 0 });
  assert.match(b, /NOTE/);
  assert.doesNotMatch(b, /NOT CURRENT/);
  assert.match(b, /uncommitted/i, "still says what is going on");
});

test("banner: says plainly that the reading is not current", () => {
  const b = prov.banner({ head: "deadbee", behind: 77, dirty: false, fetchAgeHours: 0.1, dataAgeDays: 0 });
  assert.match(b, /NOT CURRENT/);
});

/* ---------------------------------------------------------------- *
 * Reading the real repo
 * ---------------------------------------------------------------- */

test("repoState: reports this repository without throwing", () => {
  /* Smoke test only. Asserting a particular commit or behind-count would be
     asserting today's git state, which changes hourly here -- see
     tasks/lessons.md on tests that assert live data. */
  const s = prov.repoState();
  assert.equal(typeof s.head, "string");
  assert.ok(s.head.length >= 7, "a short hash is at least 7 characters");
  assert.equal(typeof s.dirty, "boolean");
  assert.ok(Number.isFinite(s.behind) && s.behind >= 0, "behind is a count");
});
