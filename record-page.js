/* record-page.js — the record page's script.
 *
 * One page for every board's forward record: what each board actually
 * published, graded after the fact, and the suggested parlays settled
 * the way a book would. The trackers (track-nfl.mjs, track-cfb.mjs)
 * write a record file per league; this reads each one and fills its
 * slot on record.html. The replay tables beside them are static markup
 * on the page: they change only when a backtest is re-run.
 *
 * These two renderers lived in football-board.js and printed under every
 * table on both football boards, where they read as part of the board.
 * The record is the model's honesty, not any row's story, so it has a
 * page; each board keeps one line and a link.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BetHouseRecordPage = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pct = (x, d) => (100 * x).toFixed(d == null ? 1 : d) + "%";
  const n = (v) => Number(v).toLocaleString("en-US");
  /* A signed figure with a real minus sign, as the boards print theirs. */
  const signed = (v) => (Number(v) >= 0 ? "+" : "\u2212") + esc(Math.abs(Number(v)));

  /* The forward record: a row per prop, then the game picks. A backtest
     grades a model against history it was fitted to; this grades what the
     board actually said before kickoff, which is the number that counts. */
  function liveRecord(R) {
    if (!R || !R.total) {
      return "<p><b>Live record:</b> nothing graded yet. Predictions are recorded " +
        "before kickoff and graded once the games are final; the first numbers arrive after the first week.</p>";
    }
    let rows = "";
    Object.keys(R.props || {}).forEach((k) => {
      const p = R.props[k];
      rows += "<tr><td>" + esc(p.label) + "</td><td>n <b>" + n(p.n) + "</b> · predicted <b>" +
        esc(p.predicted) + "%</b>, actual <b>" + esc(p.actual) + "%</b> · off by <b>" +
        signed(p.bias) + "pp</b> · Brier <b>" + esc(p.brier) + "</b></td></tr>";
    });
    let picks = "";
    if (R.picks) {
      const lab = { spread: "spread", total: "total", ml: "moneyline" };
      Object.keys(R.picks).forEach((k) => {
        const g = R.picks[k];
        picks += "<tr><td>" + esc(lab[k] || k) + " picks</td><td>n <b>" + n(g.n) + "</b> · won <b>" + esc(g.rate) + "%</b> (" + esc(g.lo) + "–" + esc(g.hi) + "%), needs 52.4%" +
          (g.clvPts != null ? " · closing line moved toward the pick <b>" + esc(g.movedToward) + "%</b> of the time, <b>" +
            signed(g.clvPts) + "</b> pts on average" : "") + "</td></tr>";
      });
      picks = "<p>The sides the board picked, settled the way a book would:</p><table>" + picks + "</table>";
    }
    const weeks = (R.days || []).length;
    return "<p><b>" + n(R.total) + "</b> graded prediction" + (R.total === 1 ? "" : "s") +
      " over " + weeks + " week" + (weeks === 1 ? "" : "s") + ", measured against what the board actually published:</p><table>" + rows + "</table>" + picks +
      (R.total < 400 ? "<p>Far too few to mean anything yet. Bias needs n in the thousands.</p>" : "");
  }

  /* The suggested slips, settled like a book would: the number a parlay
     product sells, measured rather than multiplied. */
  function parlayRecord(R) {
    if (!R || !R.parlays) return "";
    const rows = Object.keys(R.parlays).map((k) => {
      const t = R.parlays[k];
      return "<tr><td>" + (t.scope === "game" ? "one game" : "slate") + ", " + esc(t.legs) + " legs" + (t.tag === "td" ? " (touchdowns)" : "") +
        "</td><td>" + n(t.n) + " slip" + (t.n === 1 ? "" : "s") + " · said <b>" + pct(t.adjusted, 1) + "</b> · cashed <b>" + pct(t.n ? t.cashed / t.n : 0, 1) + "</b></td></tr>";
    });
    if (!rows.length) return "";
    return "<p><b>Suggested parlays</b>, recorded before kickoff and settled like a book would:</p><table>" + rows.join("") + "</table>";
  }

  /* Fill each league's slot: `records` maps a slot prefix to its record
     object, or null when the league's file carries nothing yet. */
  function render(doc, records) {
    Object.keys(records || {}).forEach((k) => {
      const el = doc.getElementById(k + "-live");
      if (el) el.innerHTML = liveRecord(records[k]) + parlayRecord(records[k]);
    });
  }

  return { liveRecord, parlayRecord, render };
});
