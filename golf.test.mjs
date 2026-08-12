/*
 * BetHouse — golf.test.mjs
 * Tests for the make-the-cut model.
 *
 * The oracle for most of these is either a published rule ("low 65 and
 * ties" is the PGA Tour's own wording), an algebraic identity that must
 * hold regardless of fitted constants, or a synthetic world where the
 * true answer is known by construction. Where a test pins a number that
 * came out of a fit rather than a rule, it is marked `characterization:`
 * so the next person knows they are allowed to move it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import golf from "./golf.js";

const {
  cutLine,
  cutRuleFor,
  buildRatings,
  simulateCut,
  makeRng,
  normal,
  fairPrice,
} = golf;

/* ------------------------------------------------------------------ *
 * cutLine — "low N and ties"
 * ------------------------------------------------------------------ */

test("cutLine: no ties, the Nth best score is the line", () => {
  // scores 1..10, low 3 → line is 3, three players survive
  const scores = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(cutLine(scores, 3), 3);
  assert.equal(scores.filter((s) => s <= cutLine(scores, 3)).length, 3);
});

test("cutLine: ties at the number all survive — more than N make it", () => {
  // four players tied on the 3rd-best score: low 3 and ties keeps 6
  const scores = [1, 2, 3, 3, 3, 3, 7, 8];
  assert.equal(cutLine(scores, 3), 3);
  assert.equal(scores.filter((s) => s <= cutLine(scores, 3)).length, 6);
});

test("cutLine: N at or beyond the field keeps everyone", () => {
  const scores = [5, 6, 7];
  assert.equal(scores.filter((s) => s <= cutLine(scores, 3)).length, 3);
  assert.equal(scores.filter((s) => s <= cutLine(scores, 99)).length, 3);
});

test("cutLine: unsorted input gives the same answer as sorted", () => {
  const a = [7, 2, 9, 4, 1, 4];
  const b = [...a].sort((x, y) => x - y);
  assert.equal(cutLine(a, 4), cutLine(b, 4));
});

test("cutLine: is a real score from the field, never an interpolation", () => {
  const scores = [140, 141, 143, 148];
  assert.ok(scores.includes(cutLine(scores, 2)));
});

/* ------------------------------------------------------------------ *
 * cutRuleFor — the published rules
 *
 * Oracle: the tournaments' own published cut rules, corrected against
 * what the 2026 results actually did (the first draft of this table was
 * wrong about the signature events, which do cut, at 50).
 * ------------------------------------------------------------------ */

test("cutRuleFor: the tour standard is low 65 and ties", () => {
  assert.equal(cutRuleFor("Wyndham Championship").cut, 65);
  assert.equal(cutRuleFor("Valspar Championship").cut, 65);
});

test("cutRuleFor: majors set their own numbers", () => {
  assert.equal(cutRuleFor("Masters Tournament").cut, 50);
  assert.equal(cutRuleFor("U.S. Open").cut, 60);
  assert.equal(cutRuleFor("PGA Championship").cut, 70);
  assert.equal(cutRuleFor("The Open").cut, 70);
});

test("cutRuleFor: signature events cut at 50", () => {
  assert.equal(cutRuleFor("The Genesis Invitational").cut, 50);
  assert.equal(cutRuleFor("Arnold Palmer Invitational pres. by Mastercard").cut, 50);
  assert.equal(cutRuleFor("the Memorial Tournament pres. by Workday").cut, 50);
});

test("cutRuleFor: no-cut events report null, not a number", () => {
  // A 100% column would be worse than useless — it would look like a lock.
  assert.equal(cutRuleFor("Travelers Championship").cut, null);
  assert.equal(cutRuleFor("FedEx St. Jude Championship").cut, null);
  assert.equal(cutRuleFor("TOUR Championship").cut, null);
  assert.equal(cutRuleFor("RBC Heritage").cut, null);
});

test("cutRuleFor: unmodelled formats are excluded, not guessed at", () => {
  // Zurich is two-man teams; the American Express cuts after 54 holes
  // across three courses. Neither is the bet this model prices.
  assert.equal(cutRuleFor("Zurich Classic of New Orleans").excluded, true);
  assert.equal(cutRuleFor("The American Express").excluded, true);
  assert.equal(cutRuleFor("AT&T Pebble Beach Pro-Am").excluded, true);
  assert.notEqual(cutRuleFor("Wyndham Championship").excluded, true);
});

test("cutRuleFor: matching is case-insensitive and tolerates sponsors", () => {
  assert.equal(cutRuleFor("MASTERS TOURNAMENT").cut, 50);
  assert.equal(cutRuleFor("masters tournament").cut, 50);
});

/* ------------------------------------------------------------------ *
 * rng — determinism, so a board is reproducible and tests are stable
 * ------------------------------------------------------------------ */

test("makeRng: same seed gives the same stream", () => {
  const a = makeRng(42), b = makeRng(42);
  for (let i = 0; i < 20; i++) assert.equal(a(), b());
});

test("makeRng: different seeds diverge", () => {
  const a = makeRng(1), b = makeRng(2);
  assert.notEqual(a(), b());
});

test("makeRng: stays in [0,1)", () => {
  const r = makeRng(7);
  for (let i = 0; i < 2000; i++) {
    const v = r();
    assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
  }
});

test("normal: mean ~0 and SD ~1 over many draws", () => {
  const r = makeRng(11);
  const xs = Array.from({ length: 40000 }, () => normal(r));
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
  assert.ok(Math.abs(m) < 0.02, `mean ${m}`);
  assert.ok(Math.abs(sd - 1) < 0.02, `sd ${sd}`);
});

/* ------------------------------------------------------------------ *
 * buildRatings — the two-way solve
 *
 * Oracle: a synthetic world where every player's true skill and every
 * round's true difficulty are known by construction. The solve has to
 * recover them.
 * ------------------------------------------------------------------ */

/** Build a synthetic season with known skills and known round difficulty. */
function syntheticSeason({ nPlayers = 60, nEvents = 20, seed = 5, noise = 0 } = {}) {
  const rng = makeRng(seed);
  const truth = Array.from({ length: nPlayers }, (_, i) => ({
    id: `p${i}`,
    name: `Player ${i}`,
    // Exactly centred, because skill is only identified up to the field
    // average and the solve returns it centred.
    skill: (i - (nPlayers - 1) / 2) / 20, // about -1.5 .. +1.5 strokes/round
  }));
  const events = [];
  for (let e = 0; e < nEvents; e++) {
    const difficulty = 68 + (e % 5); // rounds differ in difficulty by event
    const players = truth.map((t) => ({
      id: t.id,
      name: t.name,
      madeCut: true,
      rounds: [0, 1, 2, 3].map(
        () => difficulty + t.skill + (noise ? normal(rng) * noise : 0),
      ),
    }));
    events.push({ id: `e${e}`, name: `Event ${e}`, players });
  }
  return { truth, events };
}

test("buildRatings: recovers known skills from noiseless data", () => {
  const { truth, events } = syntheticSeason({ noise: 0 });
  const { players } = buildRatings(events, { K: 0 });
  for (const t of truth) {
    const got = players[t.id].skill;
    // skills are relative to field average, so compare against centred truth
    assert.ok(
      Math.abs(got - t.skill) < 0.02,
      `${t.id}: expected ~${t.skill}, got ${got}`,
    );
  }
});

test("buildRatings: removes round difficulty — an easy course does not make a hero", () => {
  // Two players, identical skill; one plays only the easy event.
  const events = [
    { id: "easy", name: "Easy Open", players: [
      { id: "a", name: "A", rounds: [64, 64, 64, 64] },
      { id: "c", name: "C", rounds: [64, 64, 64, 64] },
    ]},
    { id: "hard", name: "Hard Open", players: [
      { id: "b", name: "B", rounds: [76, 76, 76, 76] },
      { id: "c", name: "C", rounds: [76, 76, 76, 76] },
    ]},
  ];
  const { players } = buildRatings(events, { K: 0 });
  assert.ok(
    Math.abs(players.a.skill - players.b.skill) < 0.01,
    `A ${players.a.skill} vs B ${players.b.skill} — course difficulty leaked into skill`,
  );
});

test("buildRatings: K shrinks a small sample toward field average", () => {
  const events = [
    { id: "e1", name: "E1", players: [
      { id: "star", name: "Star", rounds: [60, 60, 60, 60] },
      { id: "avg1", name: "Avg1", rounds: [70, 70, 70, 70] },
      { id: "avg2", name: "Avg2", rounds: [70, 70, 70, 70] },
      { id: "avg3", name: "Avg3", rounds: [70, 70, 70, 70] },
    ]},
  ];
  const none = buildRatings(events, { K: 0 }).players.star.skill;
  const some = buildRatings(events, { K: 12 }).players.star.skill;
  const hard = buildRatings(events, { K: 100 }).players.star.skill;
  assert.ok(none < some && some < hard, "more K must mean more shrinkage toward 0");
  assert.ok(Math.abs(hard) < Math.abs(none), "heavy K should pull close to average");
});

test("buildRatings: counts rounds actually played", () => {
  const events = [
    { id: "e1", name: "E1", players: [
      { id: "made", name: "Made", rounds: [70, 70, 70, 70] },
      { id: "miss", name: "Miss", rounds: [75, 75] },
    ]},
  ];
  const { players } = buildRatings(events, { K: 0 });
  assert.equal(players.made.rounds, 4);
  assert.equal(players.miss.rounds, 2);
});

test("buildRatings: ignores junk scores instead of rating them", () => {
  const events = [
    { id: "e1", name: "E1", players: [
      { id: "a", name: "A", rounds: [70, null, 0, 999, undefined, 70] },
      { id: "b", name: "B", rounds: [70, 70] },
    ]},
  ];
  const { players } = buildRatings(events, { K: 0 });
  assert.equal(players.a.rounds, 2, "only the two real scores should count");
});

test("buildRatings: excluded formats never reach the ratings", () => {
  const events = [
    { id: "e1", name: "Zurich Classic of New Orleans", players: [
      { id: "team", name: "Team", rounds: [58, 58, 58, 58] },
    ]},
    { id: "e2", name: "Wyndham Championship", players: [
      { id: "real", name: "Real", rounds: [70, 70, 70, 70] },
    ]},
  ];
  const { players } = buildRatings(events, { K: 0 });
  assert.equal(players.team, undefined, "team scores must not become skill");
  assert.ok(players.real);
});

test("buildRatings: skills are centred on the field, so they sum to about zero", () => {
  const { events } = syntheticSeason({ noise: 2.5, seed: 3 });
  const { players } = buildRatings(events, { K: 0 });
  const vals = Object.values(players).map((p) => p.skill);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  assert.ok(Math.abs(mean) < 0.05, `skills should centre on 0, mean was ${mean}`);
});

test("buildRatings: is deterministic", () => {
  const { events } = syntheticSeason({ noise: 2.5, seed: 9 });
  const a = buildRatings(events, { K: 12 }).players;
  const b = buildRatings(events, { K: 12 }).players;
  for (const id of Object.keys(a)) assert.equal(a[id].skill, b[id].skill);
});

/* ------------------------------------------------------------------ *
 * simulateCut
 * ------------------------------------------------------------------ */

function evenField(n, skill = 0) {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`, name: `P${i}`, skill, rounds: 40,
  }));
}

test("simulateCut: every probability is a probability", () => {
  const out = simulateCut(evenField(150), { cutN: 65, sims: 500, seed: 1 });
  for (const p of out) assert.ok(p.prob >= 0 && p.prob <= 1, `${p.id} ${p.prob}`);
});

test("simulateCut: an all-equal field treats everyone the same", () => {
  // Symmetry is the invariant here. The shared probability must sit at or
  // above cutN/field — never below, since ties only ever let extra players
  // through — and identical players must get identical numbers.
  const out = simulateCut(evenField(150), { cutN: 65, sims: 4000, seed: 2 });
  const floor = 65 / 150;
  const probs = out.map((p) => p.prob);
  const lo = Math.min(...probs), hi = Math.max(...probs);
  assert.ok(hi - lo < 0.05, `identical players should get identical odds, spread ${hi - lo}`);
  assert.ok(lo >= floor - 0.02, `nobody should fall below cutN/field (${floor}), saw ${lo}`);
  assert.ok(hi < floor + 0.12, `but not wildly above it either, saw ${hi}`);
});

test("simulateCut: ties push the survivor count meaningfully past cutN", () => {
  // Oracle: the 2026 season. Real "low N and ties" cuts routinely send far
  // more than N to the weekend because scores are whole strokes and the
  // field stacks up on the number — the U.S. Open cut 60-and-ties and kept
  // 72. A simulation using continuous scores can never do this: it lands on
  // exactly cutN every time, which is the bug this test exists to catch.
  const out = simulateCut(evenField(150), { cutN: 65, sims: 4000, seed: 3 });
  const total = out.reduce((a, p) => a + p.prob, 0);
  assert.ok(total > 67, `ties should carry survivors well past 65, got ${total}`);
  assert.ok(total < 80, `but not absurdly far past it, got ${total}`);
});

test("simulateCut: a tighter field ties more, so it overshoots the cut more", () => {
  // Bunched scoring means more players on the number. Halving the spread
  // must not leave the overshoot unchanged.
  const overshoot = (roundSD) => {
    const out = simulateCut(evenField(150), {
      cutN: 65, sims: 4000, seed: 21, roundSD, formSD: 0.2,
    });
    return out.reduce((a, p) => a + p.prob, 0) - 65;
  };
  assert.ok(
    overshoot(1.4) > overshoot(3.2),
    "a tightly bunched field should overshoot the cut by more, not less",
  );
});

test("simulateCut: better players make it more often — the whole point", () => {
  const field = [
    { id: "elite", name: "Elite", skill: -2.0, rounds: 40 },
    { id: "good", name: "Good", skill: -0.7, rounds: 40 },
    { id: "avg", name: "Avg", skill: 0, rounds: 40 },
    { id: "poor", name: "Poor", skill: 1.5, rounds: 40 },
    ...evenField(100),
  ];
  const out = simulateCut(field, { cutN: 45, sims: 4000, seed: 4 });
  const by = Object.fromEntries(out.map((p) => [p.id, p.prob]));
  assert.ok(by.elite > by.good, "elite over good");
  assert.ok(by.good > by.avg, "good over average");
  assert.ok(by.avg > by.poor, "average over poor");
});

test("simulateCut: a big enough skill gap approaches certainty at both ends", () => {
  const field = [
    { id: "lock", name: "Lock", skill: -8, rounds: 40 },
    { id: "hopeless", name: "Hopeless", skill: 8, rounds: 40 },
    ...evenField(100),
  ];
  const out = simulateCut(field, { cutN: 50, sims: 4000, seed: 5 });
  const by = Object.fromEntries(out.map((p) => [p.id, p.prob]));
  assert.ok(by.lock > 0.95, `lock only ${by.lock}`);
  assert.ok(by.hopeless < 0.05, `hopeless still ${by.hopeless}`);
});

test("simulateCut: a no-cut event is certainty for everyone, not a 100% pick", () => {
  const out = simulateCut(evenField(70), { cutN: null, sims: 100, seed: 6 });
  for (const p of out) {
    assert.equal(p.prob, 1);
    assert.equal(p.noCut, true);
  }
});

test("simulateCut: same seed, same numbers", () => {
  const f = evenField(100);
  const a = simulateCut(f, { cutN: 50, sims: 800, seed: 8 });
  const b = simulateCut(f, { cutN: 50, sims: 800, seed: 8 });
  assert.deepEqual(a.map((p) => p.prob), b.map((p) => p.prob));
});

test("simulateCut: it is the field that decides, not the score in isolation", () => {
  // Identical player, once against journeymen and once against a major field.
  const weak = [{ id: "me", name: "Me", skill: -0.5, rounds: 40 }, ...evenField(120, 0.6)];
  const strong = [{ id: "me", name: "Me", skill: -0.5, rounds: 40 }, ...evenField(120, -0.6)];
  const inWeak = simulateCut(weak, { cutN: 65, sims: 4000, seed: 9 }).find((p) => p.id === "me").prob;
  const inStrong = simulateCut(strong, { cutN: 65, sims: 4000, seed: 9 }).find((p) => p.id === "me").prob;
  assert.ok(
    inWeak > inStrong + 0.1,
    `same player should cut more easily in a weak field: ${inWeak} vs ${inStrong}`,
  );
});

test("simulateCut: a tighter cut is always harder than a loose one", () => {
  const f = evenField(150);
  const loose = simulateCut(f, { cutN: 70, sims: 3000, seed: 10 })[0].prob;
  const tight = simulateCut(f, { cutN: 50, sims: 3000, seed: 10 })[0].prob;
  assert.ok(tight < loose, `cut of 50 (${tight}) must be harder than 70 (${loose})`);
});

test("simulateCut: an unrated player is treated as the prior, not as elite", () => {
  const field = [{ id: "rookie", name: "Rookie", skill: null, rounds: 0 }, ...evenField(140)];
  const out = simulateCut(field, { cutN: 65, sims: 3000, seed: 11, priorSkill: 0.35 });
  const rookie = out.find((p) => p.id === "rookie");
  assert.ok(rookie.prob > 0 && rookie.prob < 0.5, `rookie at ${rookie.prob}`);
});

test("simulateCut: output carries what the board has to show its work", () => {
  const out = simulateCut(evenField(120), { cutN: 65, sims: 500, seed: 12 });
  const p = out[0];
  for (const key of ["id", "name", "skill", "prob", "fair"]) {
    assert.ok(key in p, `missing ${key}`);
  }
});

test("simulateCut: results come back ranked, most likely first", () => {
  const field = [
    { id: "a", name: "A", skill: 1.2, rounds: 40 },
    { id: "b", name: "B", skill: -1.2, rounds: 40 },
    { id: "c", name: "C", skill: 0, rounds: 40 },
    ...evenField(80),
  ];
  const out = simulateCut(field, { cutN: 40, sims: 2000, seed: 13 });
  for (let i = 1; i < out.length; i++) {
    assert.ok(out[i - 1].prob >= out[i].prob, "must be sorted by probability");
  }
});

test("simulateCut: reported cut line sits in a believable place", () => {
  // characterization: depends on fitted spread constants, but a 36-hole
  // cut line relative to field average must be a small number of strokes.
  const out = simulateCut(evenField(150), { cutN: 65, sims: 2000, seed: 14 });
  const line = out.cutLineMean;
  assert.ok(line > -6 && line < 6, `implausible mean cut line ${line}`);
});

test("simulateCut: more sims move the answer less", () => {
  const f = evenField(150);
  const spread = (sims) => {
    const runs = [1, 2, 3, 4].map(
      (s) => simulateCut(f, { cutN: 65, sims, seed: s })[0].prob,
    );
    return Math.max(...runs) - Math.min(...runs);
  };
  assert.ok(spread(4000) < spread(200), "more sims should be steadier");
});

/* ------------------------------------------------------------------ *
 * fairPrice
 * ------------------------------------------------------------------ */

test("fairPrice: even money is +100", () => {
  assert.equal(fairPrice(0.5), 100);
});

test("fairPrice: a favourite prices negative, a longshot positive", () => {
  assert.ok(fairPrice(0.8) < 0);
  assert.ok(fairPrice(0.2) > 0);
});

test("fairPrice: certainty has no price", () => {
  assert.ok(!Number.isFinite(fairPrice(1)) || fairPrice(1) === null);
  assert.ok(!Number.isFinite(fairPrice(0)) || fairPrice(0) === null);
});
