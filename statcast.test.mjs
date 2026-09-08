/*
 * BetHouse — statcast.test.mjs
 * The Statcast prior: last season's expected batting average, converted
 * from per at-bat to the per plate appearance the model uses.
 *
 * Oracle: the definitions. xBA is per at-bat; the model's hit rate is per
 * plate appearance; hits/PA = xBA * AB/PA, with the player's own AB/PA so a
 * hitter who walks a lot is not credited with hits on trips that ended in
 * a walk. A hitter with expected stats but no season line, or the other
 * way round, has no prior: half a prior is a guess.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPriors, parseSavantCSV, measureHRPerBarrel, buildPitcherPriors } from "./statcast.mjs";

test("parseSavantCSV: reads Savant's quoted CSV with its BOM and its name column", () => {
  const csv = '﻿"last_name, first_name","player_id","year","pa","bip","ba","est_ba","est_ba_minus_ba_diff","slg","est_slg","est_slg_minus_slg_diff","woba","est_woba","est_woba_minus_woba_diff"\n' +
    '"Holliday, Jackson","702616","2025","649","447",0.242,0.241,0.001,0.375,0.404,-0.029,0.304,0.313,-0.009\n';
  const rows = parseSavantCSV(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].player_id, "702616");
  assert.equal(rows[0].est_ba, "0.241");
  assert.equal(rows[0]["last_name, first_name"], "Holliday, Jackson");
});

test("buildPriors: hit prior is xBA times the player's own AB per PA", () => {
  const priors = buildPriors(
    [{ player_id: "702616", pa: "649", est_ba: "0.241", est_slg: "0.404", est_woba: "0.313", ba: "0.242", slg: "0.375" }],
    [{ id: 702616, name: "Jackson Holliday", pa: 649, ab: 586, hits: 142 }],
    2025,
  );
  const p = priors["702616"];
  assert.ok(p);
  assert.ok(Math.abs(p.hit - 0.241 * 586 / 649) < 1e-9);
  assert.equal(p.xba, 0.241);
  assert.equal(p.xslg, 0.404);
  assert.equal(p.pa, 649);
  assert.equal(p.season, 2025);
});

test("buildPriors: no prior without both halves, or below the floor", () => {
  const priors = buildPriors(
    [{ player_id: "1", pa: "300", est_ba: "0.250" }, { player_id: "2", pa: "300", est_ba: "0.250" }, { player_id: "3", pa: "20", est_ba: "0.400" }],
    [{ id: 1, pa: 300, ab: 270 }, { id: 3, pa: 20, ab: 18 }],
    2025,
  );
  assert.ok(priors["1"], "both halves present");
  assert.equal(priors["2"], undefined, "expected stats but no season line");
  assert.equal(priors["3"], undefined, "under the 50 PA floor");
});

test("buildPriors: total bases and home run priors ride the same join", () => {
  const priors = buildPriors(
    [{ player_id: "1", pa: "600", est_ba: "0.250", est_slg: "0.450" }],
    [{ id: 1, pa: 600, ab: 540, hits: 150, hr: 20 }],
    2025,
    [{ player_id: "1", barrels: "40", brl_pa: "6.7" }],
    0.5,
  );
  const p = priors["1"];
  assert.ok(Math.abs(p.tb - 0.450 * 540 / 600) < 1e-9, "TB/PA is xSLG times AB/PA");
  assert.ok(Math.abs(p.hr - 0.067 * 0.5) < 1e-9, "HR/PA is barrels per PA times HR per barrel");
  assert.equal(p.brlPa, 0.067);
  // No batted-ball row: no HR prior, the rest intact.
  const q = buildPriors([{ player_id: "1", pa: "600", est_ba: "0.250", est_slg: "0.450" }], [{ id: 1, pa: 600, ab: 540 }], 2025, [], 0.5)["1"];
  assert.equal(q.hr, undefined);
  assert.ok(q.tb > 0);
});

test("measureHRPerBarrel: ratio of sums over hitters with 200 PA", () => {
  const r = measureHRPerBarrel(
    [{ player_id: "1", barrels: "40" }, { player_id: "2", barrels: "20" }, { player_id: "3", barrels: "10" }],
    [{ id: 1, pa: 600, hr: 22 }, { id: 2, pa: 300, hr: 8 }, { id: 3, pa: 100, hr: 9 }],
  );
  assert.ok(Math.abs(r - 30 / 60) < 1e-12, "the 100 PA hitter is excluded");
  assert.equal(measureHRPerBarrel([], []), null);
});

test("buildPitcherPriors: expected average allowed, per at-bat, with the floor", () => {
  const p = buildPitcherPriors([
    { player_id: "669373", pa: "748", est_ba: "0.206", est_woba: "0.258" },
    { player_id: "9", pa: "30", est_ba: "0.300" },
  ], 2025);
  assert.deepEqual(p["669373"], { season: 2025, bf: 748, xbaAllowed: 0.206, xwobaAllowed: 0.258 });
  assert.equal(p["9"], undefined);
});
