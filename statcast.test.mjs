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
import { buildPriors, parseSavantCSV } from "./statcast.mjs";

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
