/* tendencies-core.js — the arithmetic a page needs from tendencies.mjs:
 * ranks, the two legibility thresholds, the play families, a matchup and
 * its sentence. tendencies.mjs (the builder, ESM with file I/O) imports
 * this and re-exports it, so the board, the teams page and the builder
 * share one copy; the board used to re-type the thresholds and the family
 * table, the duplication tasks/lessons.md warns about, and a test checked
 * them for drift instead of removing it (the TODO(simplify) this retires).
 *
 * Every function is pure: hand it profiles, it hands back numbers; only
 * `describe` formats. Descriptive, not a price: nothing here is measured
 * against a line.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BetHouseTendencyCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /**
   * {TEAM: rank} over one metric, 1 = best. Ties share a place, and a team
   * whose value is null (too little behind it) is absent rather than last —
   * `Object.keys(r).length` is the field a caller says "3rd of 30" against.
   */
  function rank(profiles, key, opts = {}) {
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
  const LEAN_SHARE = 0.03;
  /** EPA per play this far from the league's is soft or stout. Likewise. */
  const SOFT_EPA = 0.05;

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
  function matchup(off, def, league) {
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
  function describe(e, names = {}) {
    const o = names.off || "the offence", d = names.def || "the defence";
    const who = e.defsCall ? `${d} blitzes on ${pct(e.offShare)} ${e.unit}` : `${o}: ${e.family} on ${pct(e.offShare)} ${e.unit}`;
    return `${who} (league ${pct(e.offShareLeague)}). ` +
      `${d} allows ${epa(e.defAllowed)} EPA there (league ${epa(e.defAllowedLeague)}).`;
  }

  return { rank, LEAN_SHARE, SOFT_EPA, FAMILIES, matchup, describe };
});
