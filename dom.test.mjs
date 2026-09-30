/*
 * BetHouse — dom.test.mjs
 * The gate that would have caught this session's design bugs.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The suite had 202 tests and not one of them looked at a page. score.js,
 * edge.js, golf.js and nfl.js were covered to the decimal place while the
 * three HTML boards -- the entire thing a user actually sees -- had no
 * coverage at all. A design review then found five defects on a fully green
 * suite, including two controls that rendered on every view and did nothing.
 * The gate and the failures did not overlap anywhere.
 *
 * WHAT THIS DOES NOT DO
 * ---------------------
 * It does not render anything. There is no jsdom, no headless browser, no
 * package.json, because "no build step, no server, no API key" is a real
 * property of this project and a test dependency would be the first crack
 * in it. Nor does it skip when a browser is missing: a gate that reports
 * success while quietly running nothing is worse than no gate.
 *
 * So it asserts SOURCE INVARIANTS instead -- the things that were actually
 * broken, in the form they were actually broken in. Every assertion below
 * is a regression test for a real defect, and each was checked against the
 * pre-fix source to confirm it fails there.
 *
 * Runtime behaviour (horizontal scroll, console errors, computed contrast)
 * stays in `/design-review`, which drives a real browser on demand.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const BOARDS = ["index.html", "baseball.html", "golf.html", "nfl.html", "cfb.html", "bets.html", "live.html"];
const src = (f) => readFileSync(resolve(DIR, f), "utf8");

/*
 * Markup only, with <script> bodies removed.
 *
 * The first version of the duplicate-id check scanned raw source and
 * reported nfl.html as defining the id `why'+i+'` three times. That is a
 * JavaScript string concatenation appearing once per view renderer, not a
 * duplicated DOM id -- the regex was reading JS as if it were HTML. Style
 * blocks are deliberately KEPT, because the CSS assertions above need them.
 */
const markup = (f) => src(f).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");

/* ------------------------------------------------------------------ *
 * FINDING-001 — the hidden attribute must actually hide
 *
 * .ctl and .controls declare display:flex. An author style beats the UA
 * stylesheet's [hidden]{display:none} regardless of specificity, so
 * `el.hidden = true` silently did nothing: the Bases control sat on every
 * bet type and the NFL yardage control on two views of three, both inert.
 * ------------------------------------------------------------------ */

const SHEET = "board.css";

test("every board loads the one shared stylesheet, and none carries its own copy", () => {
  for (const f of BOARDS) {
    const s = src(f);
    assert.match(s, /<link rel="stylesheet" href="board\.css">/, `${f} does not load ${SHEET}`);
    assert.doesNotMatch(s, /:root\s*\{/, `${f} defines its own :root tokens; they live in ${SHEET}`);
    const own = (s.match(/<style>[\s\S]*?<\/style>/g) || []).join("\n");
    // A page may override a shared rule by repeating its selector (bets pads
    // its segments, baseball's rows have more columns); what it may not do
    // is carry a copy of the sheet. These are the rules that mark a copy.
    for (const shared of [".who{", ".prob{", ".note{", ".gtitle{", "header{", ".logo{", ".why{"]) {
      assert.ok(!own.includes("\n" + shared), `${f} re-declares ${shared} in its own <style>; edit ${SHEET} instead`);
    }
  }
});

test("every board neutralises the hidden-attribute override", () => {
  {
    const f = SHEET;
    const css = src(f);
    assert.match(
      css,
      /\[hidden\]\s*\{\s*display\s*:\s*none\s*!important\s*\}/,
      `${f} is missing [hidden]{display:none!important} — any class that sets ` +
        `display will beat the attribute and leave dead controls on screen`,
    );
  }
});

test("nothing re-introduces a display rule that could outrank it", () => {
  // The !important above wins, but only while nothing else is !important.
  for (const f of BOARDS) {
    const bad = src(f).match(/\.(ctl|controls)[^{]*\{[^}]*display\s*:[^;}]*!important/g);
    assert.equal(
      bad, null,
      `${f} declares display !important on .ctl/.controls, which would tie with ` +
        `the [hidden] rule and reopen FINDING-001`,
    );
  }
});

/* ------------------------------------------------------------------ *
 * FINDING-002 — prose needs a measure
 *
 * The paragraph carrying the calibration caveats ran 166 characters per
 * line against a 45-75 target. Long measure is the readability defect that
 * matters: past ~75 the eye loses the next line on the return sweep.
 * ------------------------------------------------------------------ */

test("the explanatory paragraph has a capped measure", () => {
  {
    const f = SHEET;
    const rule = src(f).match(/\.note\{[^}]*\}/);
    assert.ok(rule, `${f} has no .note rule`);
    assert.match(
      rule[0], /max-width\s*:\s*\d+ch/,
      `${f}: .note has no ch-based max-width, so it will run the full column ` +
        `width — this is how it reached 166 characters per line`,
    );
  }
});

test("the measure cap is set in ch, and low enough to mean it", () => {
  /*
   * 1ch is the advance width of "0", which is wider than average prose:
   * max-width:72ch measured 93 real characters here. Anything above ~60ch
   * is over the 75-character limit in practice regardless of what the
   * number looks like.
   */
  {
    const f = SHEET;
    const m = src(f).match(/\.note\{[^}]*max-width\s*:\s*(\d+)ch/);
    assert.ok(m, `${f}: .note max-width is not in ch`);
    const ch = Number(m[1]);
    assert.ok(
      ch <= 60,
      `${f}: .note is capped at ${ch}ch. 1ch is the width of "0" and wider than ` +
        `average prose, so ${ch}ch renders roughly ${Math.round(ch * 1.3)} characters ` +
        `— over the 75-character limit. 56ch is the measured value for 72 characters.`,
    );
  }
});

/* ------------------------------------------------------------------ *
 * Copy-paste drift — the root cause behind FINDING-001 and FINDING-004
 *
 * The boards do not share a stylesheet, they share a copy of one.
 * Two separate findings this session were the copies diverging. Pin the
 * design tokens so a change to one board that should apply to all cannot
 * silently apply to one.
 * ------------------------------------------------------------------ */

test("the design tokens exist once, in the shared stylesheet", () => {
  const blocks = src(SHEET).match(/:root\{[^}]*\}/g) || [];
  assert.equal(blocks.length, 1, `${SHEET} should define :root exactly once`);
  assert.match(blocks[0], /--accent:/);
});

/* ------------------------------------------------------------------ *
 * FINDING-004 — wayfinding
 *
 * The same destination had two names depending on where you stood, and the
 * baseball board never said which board it was: the only signal of location
 * was which nav link happened to be absent.
 * ------------------------------------------------------------------ */

test("every board links to every other board, and nowhere broken", () => {
  for (const f of BOARDS) {
    const hrefs = [...src(f).matchAll(/class="navlink"\s+href="([^"]+)"/g)].map((m) => m[1]);
    const others = BOARDS.filter((b) => b !== f);
    assert.equal(
      hrefs.length, others.length,
      `${f} has ${hrefs.length} nav links, expected ${others.length} (one per sibling board)`,
    );
    for (const o of others) {
      assert.ok(hrefs.includes(o), `${f} does not link to ${o}`);
    }
    for (const h of hrefs) {
      assert.ok(existsSync(resolve(DIR, h)), `${f} links to ${h}, which does not exist`);
    }
  }
});

test("a destination has ONE name everywhere it is linked", () => {
  const names = new Map(); // href -> Set of link texts
  for (const f of BOARDS) {
    for (const m of src(f).matchAll(/class="navlink"\s+href="([^"]+)">([^<]+)</g)) {
      const href = m[1];
      const label = m[2].replace(/[→\s]+$/u, "").trim();
      if (!names.has(href)) names.set(href, new Set());
      names.get(href).add(label);
    }
  }
  for (const [href, set] of names) {
    assert.equal(
      set.size, 1,
      `${href} is called ${[...set].map((s) => `"${s}"`).join(" and ")} depending on which ` +
        `board you are standing on. A section that renames itself stops users building a ` +
        `map of the site.`,
    );
  }
});

test("every board states which board it is", () => {
  for (const f of BOARDS) {
    const s = src(f);
    const hasStatic = /class="tagline"[^>]*>[^<]*\S[^<]*</.test(s);
    const hasDynamic = /tagline'\)\.textContent\s*=\s*'[A-Z]/.test(s);
    assert.ok(
      hasStatic || hasDynamic,
      `${f} has an empty tagline — the page never names itself, so the only clue to ` +
        `where you are is which nav link is missing (the trunk test failing)`,
    );
  }
});

/* ------------------------------------------------------------------ *
 * Assets — a board that cannot load its own model is a blank page
 * ------------------------------------------------------------------ */

test("every script and stylesheet a board loads actually exists", () => {
  for (const f of BOARDS) {
    const s = src(f);
    const refs = [
      ...[...s.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]),
      ...[...s.matchAll(/<link[^>]+href="([^"]+)"/g)].map((m) => m[1]),
    ].filter((r) => !/^https?:/.test(r));
    assert.ok(refs.length, `${f} loads no local assets, which cannot be right`);
    for (const r of refs) {
      assert.ok(existsSync(resolve(DIR, r)), `${f} loads ${r}, which does not exist in the repo`);
    }
  }
});

test("no board defines the same id twice", () => {
  for (const f of BOARDS) {
    const ids = [...markup(f).matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    assert.deepEqual(
      [...new Set(dupes)], [],
      `${f} defines duplicate ids, so getElementById silently returns whichever came first`,
    );
  }
});

/* ------------------------------------------------------------------ *
 * The parlay may only be built on the prop it was measured on
 *
 * index.html hid the SUGGEST control on total bases and home runs, which
 * looked like the scope rule was enforced. It was not: every row still
 * rendered a live + button, so a total-bases slip was two clicks away and
 * arrived carrying "cross-game slips cashed 1.03-1.08x as often as the
 * product predicts" — a measurement taken on 1+ H/R/RBI and nowhere else.
 *
 * A gate on the control alone cannot catch that, so this checks the thing
 * that was actually wrong: the button itself must sit INSIDE the guard.
 * ------------------------------------------------------------------ */

/* The body of the first `if (<needle>) { ... }` in `js`, brace-matched.
   Braces inside strings, template literals, regex literals and comments
   would break a naive counter; the render code has none inside this block,
   and the assertion below fails loudly rather than silently passing if
   that ever stops being true. */
function guardedRanges(js, needle) {
  const out = [];
  let from = 0;
  for (;;) {
    const at = js.indexOf(needle, from);
    if (at < 0) return out;
    /* The needle ends with its own `{`; scanning from `at` finds that brace
       and not the next one down. Getting this wrong once already cost a
       confusing failure, which is the good outcome — the assertions below
       are written so a broken scan reports "outside the guard" rather than
       quietly passing. */
    const open = js.indexOf("{", at);
    if (open < 0) return out;
    let depth = 0;
    let close = -1;
    for (let i = open; i < js.length; i++) {
      if (js[i] === "{") depth++;
      else if (js[i] === "}" && --depth === 0) {
        close = i;
        break;
      }
    }
    if (close < 0) return out;
    out.push([open, close]);
    from = close;
  }
}

test("every add-to-parlay button is built inside the eligibility guard", () => {
  const js = src("baseball.html");
  assert.ok(
    js.includes("S.parlayEligible("),
    "index.html must ask score.js which views may build a parlay, not re-derive it",
  );

  const guards = guardedRanges(js, "if(S.parlayEligible(state.view)){");
  assert.ok(guards.length, "no `if(S.parlayEligible(state.view)){` block found in index.html");

  /* There is one row renderer for today and one for a replayed day, and both
     build a + button. Counting call sites would have to be edited every time
     a renderer is added; what actually matters is that NONE of them sits
     outside a guard. */
  const sites = [];
  for (let i = js.indexOf("'addleg'"); i >= 0; i = js.indexOf("'addleg'", i + 1)) sites.push(i);
  assert.ok(sites.length, "index.html no longer builds an addleg button");

  for (const at of sites) {
    const inside = guards.some(([open, close]) => at > open && at < close);
    assert.ok(
      inside,
      `an addleg button at index ${at} is built OUTSIDE the eligibility guard — ` +
        "that is how it became reachable on total bases and home runs",
    );
  }

  /* And the suggestion candidates, which only the live board collects. */
  const push = js.indexOf("state.candidates.push");
  assert.ok(push > 0, "the live board no longer collects suggestion candidates");
  assert.ok(
    guards.some(([open, close]) => push > open && push < close),
    "suggestion candidates are collected outside the eligibility guard",
  );
});

/* ------------------------------------------------------------------ *
 * A price that already carries its sign must not be given a second one
 *
 * fetch-odds-espn.mjs stores American prices as SIGNED STRINGS: "+111",
 * "-103". index.html rendered them as `(mkt.over>0?'+':'')+mkt.over`, and
 * "+111" > 0 coerces to 111 > 0, which is true — so every positively
 * priced row on total bases showed `++111`, in the chip and again in the
 * detail panel's "Market: ++111 over 1.5". Negative prices looked fine,
 * which is why it survived: half the rows were correct.
 *
 * index.html already has amer() for exactly this. Math.round("+111") is
 * 111, so it takes the string or a number and emits one sign either way.
 * ------------------------------------------------------------------ */

/* The prices that break the contract. An empty market set yields none, which
   is the entire point: see the note below. */
const unsignedPrices = (markets) =>
  Object.values(markets)
    .flatMap((m) => [m.over, m.under])
    .filter((p) => !/^[+-]\d+$/.test(String(p)));

/*
 * An empty slate is a legitimate state and must never fail a run.
 *
 * The first version of the test below asserted `prices.length > 0`. That is
 * a claim about the live feed, and this file runs inside all three refresh
 * workflows against data they have just fetched. At 13:51 UTC on 2026-08-20
 * no MLB props were posted yet, refresh-odds.yml printed its own "no
 * scheduled games — nothing priced" and exited 0 as designed, then handed
 * the same empty file to `node --test` and this assertion failed the run.
 * Thirteen consecutive refreshes died on it and the board sat past its
 * six-hour cutoff showing no prices at all.
 *
 * The rule was already written, three lines above the call site: "An empty
 * slate is legitimate (no games scheduled); a malformed file is not. Only
 * the second one should fail the run."
 *
 * So: nothing in this file may assert that live data is non-empty. Check the
 * shape of what is there; say how much that was.
 */

test("an empty slate is not a contract violation", () => {
  assert.deepEqual(unsignedPrices({}), [], "an empty market set must pass");
  assert.deepEqual(
    unsignedPrices({ a: { over: "+108", under: "-144" } }),
    [],
    "signed strings are the contract",
  );
  assert.deepEqual(
    unsignedPrices({ a: { over: 108, under: "-144" } }),
    [108],
    "a bare number is a violation — it is what made index.html print ++108",
  );
});

test("the odds feed stores prices with their sign attached", (t) => {
  const file = resolve(DIR, "odds-data.js");
  assert.ok(existsSync(file), "odds-data.js is missing");

  const win = {};
  new Function("window", readFileSync(file, "utf8"))(win);
  const markets = (win.BetHouseOdds || {}).markets;
  assert.ok(markets && typeof markets === "object", "odds-data.js defines no markets object");

  assert.deepEqual(
    unsignedPrices(markets),
    [],
    "a price is not a signed American string — the render path assumes it is",
  );

  /* Vacuous on an empty slate, by design. Reported so that a file which is
     empty forever is visible in the run output rather than silently green. */
  t.diagnostic(
    `${Object.keys(markets).length} markets, ${Object.values(markets).length * 2} prices checked`,
  );
});

test("no board hand-prefixes a sign onto a market price", () => {
  /* The bug in the form it was written in: a truthiness test on a value
     that is already signed, used to decide whether to add a sign. */
  for (const f of BOARDS) {
    const js = src(f);
    const offenders = js.match(/\.(over|under)\s*>\s*0\s*\?\s*'\+'/g) || [];
    assert.deepEqual(
      offenders,
      [],
      `${f} prefixes '+' onto an already-signed market price — use amer()`,
    );
  }
});

/* ------------------------------------------------------------------ *
 * A fixed-width cell must not let its content decide the row height
 *
 * nfl.html's spread board put "SEA -7.2" inside .prob, a 74px grid column
 * styled for one 21px number. Fifteen of sixteen rows wrapped to two lines
 * and "TB -0.7" did not, so row heights alternated 63px and 32px on
 * nothing but the length of a team abbreviation. The board read as ragged
 * for a reason carrying no information.
 *
 * The file already had the answer in .be: number, then a <small> block
 * label under it ("43.3 / total"). The invariant is that a sublabel inside
 * one of these cells is a block, never inline text that can wrap.
 * ------------------------------------------------------------------ */

test("a sublabel inside a fixed-width row cell is a block, not wrappable text", () => {
  const css = src(SHEET);
  const rule = css.match(/^([^\n{]*\bsmall\b[^\n{]*)\{([^}]*display:\s*block[^}]*)\}/m);
  assert.ok(rule, `${SHEET} has no display:block rule for row sublabels`);

  const selectors = rule[1].split(",").map((s) => s.trim());
  for (const cell of [".be", ".prob", ".px"]) {
    assert.ok(
      selectors.includes(`${cell} small`),
      `${cell} small is not blocked — content can wrap and set the row height`,
    );
  }
});

/* ------------------------------------------------------------------ *
 * One age computation, not two
 *
 * index.html used to compute the feed's age twice: once inside the ODDS
 * gate to decide whether to show prices, and again into an ODDS_AGE_H
 * that nothing ever read. Two copies of the same arithmetic, one of them
 * dead — which is why the board could withhold prices without being able
 * to say it was withholding them.
 * ------------------------------------------------------------------ */

test("the board asks edge.js how old the odds are, and asks once", () => {
  const js = src("baseball.html");
  assert.ok(
    js.includes("E.oddsFreshness("),
    "index.html must get odds age from edge.js, not re-derive it",
  );
  const inlined = js.match(/Date\.parse\([^)]*generated[^)]*\)/g) || [];
  assert.deepEqual(
    inlined,
    [],
    "index.html re-derives the feed's age inline; that is the duplication oddsFreshness replaced",
  );
});

/* ------------------------------------------------------------------ *
 * Every test file is actually wired into every gate
 *
 * `node --test` is invoked with an explicit file list, not bare discovery,
 * because discovery would fire the backtest scripts and their live API
 * calls. The cost of that is the list existing in SEVEN places, and adding a
 * seventh test file means remembering all seven. Miss one and the gap is
 * silent: the suite still passes, just without the new file.
 *
 * This is the same duplication that put the parlay scope rule in two places
 * and let them disagree. Here it cannot be deduplicated away — the CI files
 * are YAML and the hook config is its own format — so it gets checked
 * instead.
 * ------------------------------------------------------------------ */

test("every test file runs in every gate that runs tests", () => {
  const GATES = [
    "scripts/local-check.sh",
    ".pre-commit-config.yaml",
    ".github/workflows/ci.yml",
    ".github/workflows/refresh.yml",
    ".github/workflows/refresh-nfl.yml",
    ".github/workflows/refresh-cfb.yml",
    ".github/workflows/refresh-odds.yml",
  ];

  const files = readdirSync(DIR)
    .filter((f) => f.endsWith(".test.mjs"))
    .sort();
  assert.ok(files.length >= 6, `expected the suite's test files, found ${files.join(", ")}`);

  for (const gate of GATES) {
    const path = resolve(DIR, gate);
    assert.ok(existsSync(path), `${gate} is missing`);
    const text = readFileSync(path, "utf8");
    assert.ok(/node --test/.test(text), `${gate} no longer runs the suite`);
    for (const f of files) {
      assert.ok(text.includes(f), `${gate} does not run ${f}`);
    }
  }
});

/* ------------------------------------------------------------------ *
 * Two copies of the name matcher, and they have to agree
 *
 * The odds feed keys every market by a normalised player name. That
 * normalisation exists twice: `normalizeName` in fetch-odds-espn.mjs, which
 * writes the keys, and `normName` in index.html, which reads them. The
 * board cannot import an .mjs without becoming a module, so the duplication
 * is structural rather than careless.
 *
 * If they ever disagree, no price matches any player: the chips vanish, and
 * closing line value silently reports nothing for every bet rather than
 * failing loudly. So compare them on the names that actually break this
 * sort of function.
 * ------------------------------------------------------------------ */

test("the board and the odds fetcher normalise names identically", async () => {
  const { normalizeName } = await import("./fetch-odds-espn.mjs");

  const js = src("baseball.html");
  const at = js.indexOf("function normName(s){");
  assert.ok(at > 0, "index.html no longer defines normName");
  const end = js.indexOf("\n}", at) + 2;
  // eslint-disable-next-line no-new-func
  const boardVersion = new Function(js.slice(at, end) + "; return normName;")();

  const NAMES = [
    "Luis García Jr.",          // accent AND a suffix
    "José Ramírez",
    "Ronald Acuña Jr.",
    "Ken Griffey Sr.",
    "Vladimir Guerrero Jr.",
    "J.T. Realmuto",            // periods inside initials
    "A.J. Pollock",
    "Jackson Merrill III",
    "Michael A. Taylor",
    "Shohei Ohtani",
    "O'Neil Cruz",              // apostrophe
    "Jean-Carlos Rodríguez",    // hyphen
    "  Extra   Spaces  ",
    "",
  ];
  for (const n of NAMES) {
    assert.equal(
      boardVersion(n),
      normalizeName(n),
      `"${n}" normalises differently in index.html than in fetch-odds-espn.mjs — ` +
        `every market key for a name like this would fail to match, and CLV would ` +
        `quietly report nothing`,
    );
  }
});

/* ------------------------------------------------------------------ *
 * The opponent reaches every projection, or none
 *
 * The board, the tracker, the board's pools and the replay must all
 * compute the same opponent-adjusted expectation, or the record grades a
 * bet the board never offered. The functions are tested in nfl.test.mjs;
 * this is the wiring, which no unit test can see.
 * ------------------------------------------------------------------ */
test("every statEligible call outside the model passes the opponent, and every pool divides by projectedStat", () => {
  const callers = ["football-board.js", "track-football.mjs", "backtest-nfl.mjs"];
  for (const f of callers) {
    const js = src(f);
    const calls = js.match(/statEligible\([^;\n]*/g) || [];
    assert.ok(calls.length, `${f} no longer calls statEligible`);
    for (const c of calls) assert.match(c, /oppFactor/, `${f}: ${c} does not pass the opponent`);
  }
  for (const f of ["fetch-football.mjs", "backtest-nfl.mjs"]) {
    const js = src(f);
    assert.match(js, /projectedStat\(stat, (r|rec), null, \{ oppFactor: [^}]*\}\)/, `${f}: the pool divisor is not the model's projectedStat`);
    assert.doesNotMatch(js, /expectedStat\([^)]*\)\s*\*\s*[A-Za-z.]*statOppFactor/, `${f}: the pool divisor is re-derived by hand`);
    assert.doesNotMatch(js, /p\.team === g\.home\.team \? g\.away\.team : g\.home\.team/, `${f}: a two-way opponent lookup gives the home team to a player on neither side; use opponentIn`);
  }
});

/* ------------------------------------------------------------------ *
 * A stat the model gains is a view the page gains — copy included
 *
 * The board builds one view per row of the model's stat table, so adding
 * "Rush + rec yards" to nfl.js put a fifth view on both football boards
 * without either page being touched. What does NOT arrive on its own is
 * the sentence above the rows: `copy.noteStat` is keyed by stat, and a
 * missing key renders the word `undefined` across the top of the board.
 * ------------------------------------------------------------------ */

test("the views are built from the model's stat table, not a list typed on the page", () => {
  const js = src("football-board.js");
  assert.match(
    js, /Object\.keys\(N\.STATS\)/,
    "football-board.js no longer builds its views from the model's stat table; a " +
      "second copy of the list is how a stat the model has stops being a view the page has",
  );
});

test("every counting prop the model has has a note on both football boards", async () => {
  const nfl = (await import("./nfl.js")).default;
  const stats = Object.keys(nfl.STATS);
  assert.ok(stats.length >= 5, `expected the model's counting props, found ${stats.join(", ")}`);
  for (const f of ["nfl.html", "cfb.html"]) {
    const js = src(f);
    const at = js.indexOf("noteStat:");
    assert.ok(at > 0, `${f} defines no noteStat table`);
    const end = js.indexOf("noteGames:", at);
    assert.ok(end > at, `${f}: noteStat is no longer followed by noteGames; this slice is wrong`);
    const block = js.slice(at, end);
    for (const s of stats) {
      assert.match(
        block, new RegExp("\\b" + s + ":"),
        `${f}: noteStat has no entry for "${s}", so that view renders "undefined" above its rows`,
      );
    }
  }
});

/* ------------------------------------------------------------------ *
 * The panel reads the model, it does not re-derive it
 *
 * A stat's season total is a LIST of record fields now (rush + rec sums
 * two), so `r.p[ST.total]` — which worked while every row named one
 * field — silently became `undefined`, and the panel said the player
 * averages NaN a game.
 * ------------------------------------------------------------------ */

test("the panel reads a season total through the model, never off the record by key", () => {
  const js = src("football-board.js");
  assert.match(js, /N\.statTotal\(/, "football-board.js no longer asks the model for a season total");
  assert.doesNotMatch(
    js, /\[ST\.total\]/,
    "football-board.js indexes a record by ST.total, which is a LIST of fields — " +
      "that is undefined for every stat and NaN in the panel",
  );
});

/* ------------------------------------------------------------------ *
 * The ladder: the alternate lines, priced, inside the panel
 *
 * Every rung comes from the model (`ladder`, `fairPrice`) so the page and
 * the tracker offer the same rungs, and the strip wraps or scrolls in its
 * own box — thirteen rungs must not make the body scroll sideways on a
 * 390px phone.
 * ------------------------------------------------------------------ */

test("the expanded counting-prop panel prices every rung off the model's ladder", () => {
  const js = src("football-board.js");
  assert.match(js, /N\.ladder\(/, "the panel does not ask the model for the alternate lines");
  assert.match(js, /class="rungs"/, "the panel renders no ladder strip");
  assert.doesNotMatch(
    js, /LADDERS\s*[=:]/,
    "football-board.js carries its own copy of the rungs; they live in nfl.js",
  );
});

test("the ladder wraps inside its own box, so the page never scrolls sideways", () => {
  const css = src(SHEET);
  const rule = css.match(/\.rungs\{[^}]*\}/);
  assert.ok(rule, `${SHEET} has no .rungs rule — the ladder strip is unstyled`);
  assert.match(
    rule[0], /repeat\(auto-fill|repeat\(auto-fit|overflow-x:\s*auto/,
    `${SHEET}: .rungs neither wraps into columns nor scrolls in its own container, ` +
      `so thirteen rungs push the body sideways on a phone`,
  );
});

/* ------------------------------------------------------------------ *
 * A leg is only parlayed on a prop the replay measured
 *
 * The candidate loop runs over every stat the model has, so a stat the
 * model gains would become a parlay leg the replay never graded unless
 * the eligibility gate is inside the loop.
 * ------------------------------------------------------------------ */

test("every counting-prop parlay leg is built inside the parlay-eligibility gate", () => {
  const js = src("football-board.js");
  assert.match(js, /eligible\s*=\s*N\.DEFAULTS\.parlayProps/, "the board no longer reads parlayProps from the model");
  const loops = guardedRanges(js, "STAT_IDS.forEach(function(stat){");
  assert.ok(loops.length, "no per-stat candidate loop found in football-board.js");
  for (const [open, close] of loops) {
    const body = js.slice(open, close);
    if (!body.includes("out.push(")) continue;
    const gate = body.indexOf("on(stat)");
    assert.ok(gate >= 0, "the per-stat candidate loop does not ask whether the prop is parlay-eligible");
    assert.ok(
      gate < body.indexOf("out.push("),
      "a counting-prop leg is pushed before the eligibility gate runs — that is how a " +
        "prop the replay never measured becomes a leg",
    );
  }
});

/* ------------------------------------------------------------------ *
 * The stale-model guard has to know every function it is guarding
 *
 * The page, the board script and the model are three separately cached
 * files, so a browser can hold a new page and an old model. The board
 * checks the model has what it needs and says "reload" instead of failing
 * silently — which only works while the list is the whole list.
 * ------------------------------------------------------------------ */

test("every model function the board calls is named in its stale-model check", () => {
  const js = src("football-board.js");
  const m = js.match(/var NEEDS\s*=\s*\[([^\]]*)\]/);
  assert.ok(m, "football-board.js no longer declares NEEDS");
  const needs = new Set(m[1].split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, "")));
  const called = new Set([...js.matchAll(/\bN\.([A-Za-z_$][\w$]*)\s*\(/g)].map((x) => x[1]));
  for (const fn of called) {
    assert.ok(
      needs.has(fn),
      `football-board.js calls N.${fn}() but NEEDS does not list it — against a cached ` +
        `older model that is a silent failure, which is exactly what NEEDS exists to prevent`,
    );
  }
});

/* ------------------------------------------------------------------ *
 * A strip that scrolls sideways must be the thing that scrolls
 *
 * The football boards let the bet types scroll rather than stack, with
 * `overflow-x:auto` on the segment strip. It never engaged: a flex item's
 * default minimum size is its content, so the .ctl around it simply grew
 * to the full width of the buttons and the BODY scrolled sideways instead.
 * Measured on nfl.html at 390px: 322px of body overflow with four counting
 * props, 458 with five, 0 once the item is allowed to shrink.
 * ------------------------------------------------------------------ */

test("a scrolling control strip sits in a box that is allowed to shrink", () => {
  // The pair used to live in the football pages' own <style>; it is shared now.
  const css = src(SHEET);
  assert.match(css, /\.seg\{[^}]*overflow-x:\s*auto/, "board.css: .seg does not scroll inside itself");
  assert.match(css, /\.ctl\{[^}]*min-width:\s*0/, "board.css: .ctl can widen the page (no min-width:0)");
  for (const page of ["nfl.html", "cfb.html"]) {
    assert.doesNotMatch(src(page), /<style>/, `${page} carries its own <style> again`);
  }
});

/* ------------------------------------------------------------------ *
 * How big a pool is, is the model's question
 *
 * A pool is a flat list of ratios in an older data file and {exp, ratio}
 * sorted by expectation in a newer one — the levelling that stopped a
 * 20-yard projection being priced off a 90-yard one's shape. `pool.length`
 * is `undefined` on the second shape, which silently drops every row (the
 * gate reads `< 300`) and prints "read off undefined real games".
 * ------------------------------------------------------------------ */

test("the board asks the model how many games a pool holds, never .length", () => {
  const js = src("football-board.js");
  assert.match(js, /N\.poolSize\(/, "football-board.js no longer asks the model for a pool's size");
  assert.doesNotMatch(
    js, /\bpool\s*\.\s*length/,
    "football-board.js takes .length of a pool, which is undefined once the pool " +
      "is {exp, ratio} — use N.poolSize(pool)",
  );
  assert.doesNotMatch(
    js, /pool\s*\.\s*(ratio|exp)\b/,
    "football-board.js reaches inside a pool's shape; nfl.js owns that (poolSize, poolNear)",
  );
});

/* ------------------------------------------------------------------ *
 * The matchup panel — the first test in this file that RENDERS
 *
 * Everything above asserts source invariants, for the reason at the top:
 * no jsdom, no browser, no package.json. This one still honours that —
 * the stub below is thirty lines of plain objects, not a dependency — but
 * it runs the real board script and calls the real detail builder, because
 * "the section is there for a game in the file and absent for a game that
 * is not" is a claim about output, and a regex over the source would pass
 * on markup that never renders.
 * ------------------------------------------------------------------ */

/* Enough of an element for football-board.js: it sets innerHTML, appends
   created children, registers listeners, and reads back textContent. */
function stubEl(tag) {
  return {
    tag, children: [], handlers: {}, attrs: {},
    innerHTML: "", textContent: "", value: "", className: "", hidden: false,
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(type, fn) { (this.handlers[type] = this.handlers[type] || []).push(fn); },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    focus() { this.focused = true; },
  };
}

function stubDoc() {
  const byId = new Map();
  return {
    getElementById(id) {
      if (!byId.has(id)) byId.set(id, stubEl(id));
      return byId.get(id);
    },
    createElement(tag) { return stubEl(tag); },
    listeners: {},
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    activeElement: { tagName: "BODY" },
  };
}

/** Mount the real board against the stub and return its game-view panel builder. */
async function mountBoard({ tendencies, games, ratings }) {
  const nfl = (await import("./nfl.js")).default;
  const doc = stubDoc();
  const win = {};
  if (tendencies !== undefined) win.BetHouseTendencies = tendencies;
  // eslint-disable-next-line no-new-func
  new Function("window", "document", src("football-board.js"))(win, doc);

  win.BetHouseFootballBoard.mount({
    model: nfl,
    data: {
      season: 2026, week: 2, statsSeasons: [2025, 2026], generated: "2026-09-21T00:00", gamesCached: 2,
      games, ratings, teamFactors: {}, players: [], pools: {}, usagePool: [],
    },
    record: null,
    league: "NFL",
    fetcher: "fetch-nfl.mjs",
    copy: {
      noteTD: "n", noteStat: Object.fromEntries(Object.keys(nfl.STATS).map((k) => [k, "n"])),
      noteGames: "n", gameBanner: "<p>n</p>", mlVerdict: "n", gameHonestly: "n", footer: "<p>n</p>",
    },
  });

  // The game view is a segment button; click it the way a user would.
  const seg = doc.getElementById("view");
  const button = seg.children.find((b) => b.textContent === "Spread & total");
  assert.ok(button, "the board no longer offers a Spread & total view");
  button.handlers.click[0]();

  const app = doc.getElementById("app");
  assert.ok(app.__rows && app.__rows.length, "the game view rendered no rows");
  return { app, panelFor: (i) => app.__detail(app.__rows[i]) };
}

/* Two teams in the tendencies file, two that are not. Every field the
   panel reads is here; the values are invented and the shape is the one
   tendencies.mjs writes. */
const PROFILE = {
  plays: 140, games: 2, playsPerGame: 70, passRate: 0.64, rushRate: 0.36, proe: 3.75,
  deepRate: 0.12, shortRate: 0.88, insideRunShare: 0.81, outsideRunShare: 0.19,
  epaPerPlay: 0.08, epaPerPass: 0.1, epaPerRush: 0.04,
  deepEpa: 0.31, shortEpa: 0.15, insideRunEpa: -0.03, outsideRunEpa: 0.34,
  playActionRate: 0.17, motionRate: 0.5, blitzRate: 0.27, paEpa: -0.07, blitzEpa: 0.0,
};
const tweak = (over) => Object.assign({}, PROFILE, over);
const TENDENCIES = {
  generated: "2026-09-21T00:00:00.000Z", seasons: [2025, 2026], K: 6,
  through: { season: 2026, week: 2 },
  current: {
    off: { KC: tweak({ deepRate: 0.19 }), LAC: tweak({ deepRate: 0.05 }) },
    def: { KC: tweak({ deepEpa: 0.9 }), LAC: tweak({ deepEpa: -0.4, insideRunEpa: 0.2 }) },
    league: tweak({}),
  },
};
const GAMES = [
  { id: "g1", home: "LAC", away: "KC", date: "2030-01-01T00:00Z", completed: false },
  { id: "g2", home: "BBB", away: "AAA", date: "2030-01-02T00:00Z", completed: false },
];
const RATINGS = { off: { KC: 2, LAC: 1, AAA: 0, BBB: 0 }, def: { KC: -1, LAC: 0, AAA: 0, BBB: 0 } };

test("the matchup section renders for a game whose teams are in the tendencies file", async () => {
  const { app, panelFor } = await mountBoard({ tendencies: TENDENCIES, games: GAMES, ratings: RATINGS });
  const i = app.__rows.findIndex((r) => r.g.id === "g1");
  const html = panelFor(i);
  assert.match(html, /class="mu"/, "no matchup section on a game both of whose teams are profiled");
  // Both directions, not just the home one.
  assert.match(html, /KC offence vs LAC defence/);
  assert.match(html, /LAC offence vs KC defence/);
  // Every family the panel promises.
  for (const f of ["deep pass", "short pass", "inside run", "outside run", "play action", "vs blitz"]) {
    assert.ok(html.includes(f), `the matchup table has no "${f}" row`);
  }
  // The tags, on the fixture built to trigger them.
  assert.match(html, /class="tag soft"/, "a defence 0.39 EPA worse than league is not tagged soft");
  assert.match(html, /class="tag tough"/, "a defence 0.71 EPA better than league is not tagged stout");
  assert.match(html, /leans in|avoids/, "an offence 7 points off the league share is not tagged");
  // The caveat that keeps this descriptive.
  assert.match(html, /nothing here is in a price yet/i);
  assert.match(html, /week 2/, "the footer does not say which week the play-by-play runs through");
});

test("a game whose teams are not in the tendencies file shows no matchup section", async () => {
  const { app, panelFor } = await mountBoard({ tendencies: TENDENCIES, games: GAMES, ratings: RATINGS });
  const i = app.__rows.findIndex((r) => r.g.id === "g2");
  const html = panelFor(i);
  assert.doesNotMatch(html, /class="mu"/, "a game of two unprofiled teams still rendered a matchup section");
  assert.ok(html.includes("projection"), "the rest of the panel disappeared with it");
});

test("a board with no tendencies file loaded renders every game without one", async () => {
  const { app, panelFor } = await mountBoard({ tendencies: undefined, games: GAMES, ratings: RATINGS });
  for (let i = 0; i < app.__rows.length; i++) {
    assert.doesNotMatch(
      panelFor(i), /class="mu"/,
      "the matchup section rendered with no tendencies file loaded — cfb.html loads none",
    );
  }
});

test("the page and tendencies.mjs agree on the thresholds and the families", async () => {
  /* tendencies.mjs is an ES module and the board is a plain script, so the
     two tag thresholds and the family table are re-typed there rather than
     imported. That is the duplication tasks/lessons.md warns about, so it
     gets checked instead of trusted. */
  const t = await import("./tendencies.mjs");
  const js = src("football-board.js");

  const lean = js.match(/LEAN_SHARE\s*=\s*([\d.]+)/);
  const soft = js.match(/SOFT_EPA\s*=\s*([\d.]+)/);
  assert.ok(lean && soft, "football-board.js no longer names the two thresholds");
  assert.equal(Number(lean[1]), t.LEAN_SHARE, "the board's lean threshold has drifted from tendencies.mjs");
  assert.equal(Number(soft[1]), t.SOFT_EPA, "the board's soft/stout threshold has drifted from tendencies.mjs");

  /* The family table: same families, same metric keys, same order of
     definition. Read off the module's source because FAMILIES is private. */
  const modFams = [...src("tendencies.mjs").matchAll(/\{\s*family:\s*"([^"]+)",\s*share:\s*"(\w+)",\s*epa:\s*"(\w+)"/g)];
  assert.ok(modFams.length >= 6, "tendencies.mjs no longer declares a FAMILIES table in the expected shape");
  const boardFams = [...js.matchAll(/\{family:'([^']+)',\s*share:'(\w+)',\s*epa:'(\w+)'/g)];
  assert.deepEqual(
    boardFams.map((m) => [m[1], m[2], m[3]]),
    modFams.map((m) => [m[1], m[2], m[3]]),
    "football-board.js and tendencies.mjs disagree about the play families or their metric keys",
  );
  for (const [, , share, epa] of boardFams) {
    assert.ok(t.METRICS.includes(share), `${share} is not a metric tendencies.mjs computes`);
    assert.ok(t.METRICS.includes(epa), `${epa} is not a metric tendencies.mjs computes`);
  }
});

test("the matchup table fits a 390px phone without widening the page", () => {
  const css = src(SHEET);
  const rule = css.match(/\.mfam\{[^}]*\}/);
  assert.ok(rule, `${SHEET} has no .mfam rule — the matchup table is unstyled`);
  const cols = rule[0].match(/grid-template-columns\s*:\s*([^;}]+)/);
  assert.ok(cols, `${SHEET}: .mfam declares no columns`);
  assert.match(cols[1], /^\s*1fr\b/, ".mfam's first column is not flexible, so long family names widen the page");
  const fixed = [...cols[1].matchAll(/(\d+)px/g)].reduce((a, m) => a + Number(m[1]), 0);
  assert.ok(
    fixed <= 220,
    `.mfam reserves ${fixed}px of fixed columns; a 390px phone leaves about 338px inside the panel, ` +
      `so anything over ~220 squeezes the family name to nothing`,
  );
});

test("the tendencies file is loaded by the board that has play-by-play, and only that one", () => {
  assert.match(src("nfl.html"), /<script src="tendencies-data\.js"><\/script>/, "nfl.html does not load tendencies-data.js");
  assert.doesNotMatch(src("cfb.html"), /tendencies-data/, "cfb.html loads a play-by-play file college has none of");
});

/* ------------------------------------------------------------------ *
 * A typed price, filters and sorts on the football boards (2026-09-29)
 *
 * The rows take the price the book offers and show the edge at once,
 * remembered in the browser. The arithmetic is edge.js's, the key is
 * watchlist.js's, and the rows are narrowed by team and position and
 * re-ordered by projection, edge or boost. Source contracts first, then
 * the real script mounted against the stub.
 * ------------------------------------------------------------------ */

test("both football boards load watchlist.js before the board script", () => {
  for (const page of ["nfl.html", "cfb.html"]) {
    const html = src(page);
    const w = html.indexOf('src="watchlist.js"'), b = html.indexOf('src="football-board.js"');
    assert.ok(w >= 0, `${page} does not load watchlist.js`);
    assert.ok(w < b, `${page} loads watchlist.js after the board`);
  }
});

test("the board keys a typed price through watchlist.js and prices it through edge.js, never by hand", () => {
  const js = src("football-board.js");
  assert.match(js, /W\.priceKey\(/, "no W.priceKey( call: the key would be built by hand");
  // The price map is only ever indexed by a key variable, never by a string the board glued together.
  assert.doesNotMatch(js, /state\.prices\[['"]|state\.prices\[[^\]]*\+/, "a hand-built price key");
  const priced = js.match(/function priceEdge[\s\S]*?\n    }/);
  assert.ok(priced, "no priceEdge helper");
  assert.match(priced[0], /E\.evPct\(/, "the edge is not edge.js's");
});

/* Enough players for every filter and sort to have something to do. */
const PLAYERS = [
  { id: "a", name: "Alpha Wide", team: "KC", pos: "WR", games: 10, tds: 8, carries: 0, targets: 80, recYds: 900, rushYds: 0, recs: 60, passAtt: 0, passYds: 0, opp: "LAC",
    recent: [["260928", "DEN", 110, 8, 0, 0, 1], ["260921", "NYG", 40, 3, 0, 0, 0], ["250914", "LV", 75, 6, 0, 0, 2]] },
  { id: "b", name: "Bravo Back", team: "LAC", pos: "RB", games: 10, tds: 2, carries: 150, targets: 20, recYds: 100, rushYds: 700, recs: 15, passAtt: 0, passYds: 0, opp: "KC" },
  { id: "c", name: "Charlie End", team: "KC", pos: "TE", games: 10, tds: 0, carries: 0, targets: 60, recYds: 500, rushYds: 0, recs: 45, passAtt: 0, passYds: 0, opp: "LAC" },
  // On a bye this week: no game, no opponent, still on the board.
  { id: "d", name: "Delta Bye", team: "ZZZ", pos: "RB", games: 10, tds: 3, carries: 120, targets: 10, recYds: 60, rushYds: 500, recs: 8, passAtt: 0, passYds: 0, opp: null },
  // A defensive listing with a trick-play record: not a position the board files under.
  { id: "e", name: "Echo Safety", team: "LAC", pos: "S", games: 10, tds: 1, carries: 12, targets: 0, recYds: 0, rushYds: 40, recs: 0, passAtt: 0, passYds: 0, opp: "KC" },
  // In the other game, so a slip from stars can carry two legs.
  { id: "f", name: "Foxtrot Back", team: "AAA", pos: "RB", games: 10, tds: 4, carries: 140, targets: 20, recYds: 120, rushYds: 600, recs: 15, passAtt: 0, passYds: 0, opp: "BBB" },
];

/** Mount the real board on the TD view with players, edge.js and watchlist.js present. */
async function mountPlayers({ players, storage, storageThrows, noWatchlist, search, pools, games }) {
  const nfl = (await import("./nfl.js")).default;
  const doc = stubDoc();
  const store = new Map(Object.entries(storage || {}));
  const win = { BetHouseEdge: (await import("./edge.js")).default, BetHouseParlay: (await import("./parlay.js")).default, pushed: [], listeners: {} };
  win.location = { search: search || "", pathname: "/nfl.html" };
  win.history = { pushState(_s, _t, url) { win.pushed.push(url); }, replaceState(_s, _t, url) { win.pushed.push(url); } };
  win.addEventListener = (type, fn) => { (win.listeners[type] = win.listeners[type] || []).push(fn); };
  if (!noWatchlist) win.BetHouseWatchlist = (await import("./watchlist.js")).default;
  if (storageThrows) Object.defineProperty(win, "localStorage", { get() { throw new Error("SecurityError: storage is disabled"); } });
  else win.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  // eslint-disable-next-line no-new-func
  new Function("window", "document", src("football-board.js"))(win, doc);
  win.BetHouseFootballBoard.mount({
    model: nfl,
    data: {
      season: 2026, week: 2, statsSeasons: [2025, 2026], generated: "2026-09-21T00:00", gamesCached: 2,
      games: games || GAMES, ratings: RATINGS, teamFactors: {}, players, pools: pools || {}, usagePool: [],
    },
    record: null, league: "NFL", fetcher: "fetch-nfl.mjs",
    copy: {
      noteTD: "n", noteStat: Object.fromEntries(Object.keys(nfl.STATS).map((k) => [k, "n"])),
      noteGames: "n", gameBanner: "<p>n</p>", mlVerdict: "n", gameHonestly: "n", footer: "<p>n</p>",
    },
  });
  const app = doc.getElementById("app");
  assert.ok(app.__rows && app.__rows.length, "the touchdown view rendered no rows");
  const press = (id, label) => {
    const b = doc.getElementById(id).children.find((x) => x.textContent === label);
    assert.ok(b, `no "${label}" button in #${id}`);
    b.handlers.click[0]();
  };
  return { app, doc, win, store, press };
}

test("team and position filters narrow the rows, a bye team is still a team, roster noise is not a position", async () => {
  const { app, doc, press } = await mountPlayers({ players: PLAYERS });
  assert.equal(app.__rows.length, 6);
  press("posseg", "WR");
  assert.deepEqual(app.__rows.map((r) => r.p.id), ["a"]);
  press("posseg", "All");
  // The stub's innerHTML setter keeps old children, so read the distinct labels.
  const labels = [...new Set(doc.getElementById("posseg").children.map((b) => b.textContent))];
  assert.deepEqual(labels, ["All", "QB", "RB", "WR", "TE"].filter((l) => l === "All" || PLAYERS.some((p) => p.pos === l)), "only the positions the board files under, in depth-chart order");
  assert.ok(!labels.includes("S"), "a safety with a trick-play record is not a filter button");
  const sel = doc.getElementById("teamsel");
  const teams = sel.children.map((o) => o.value);
  assert.ok(teams.includes("ZZZ"), "a team on a bye is still on the board, so it is still a choice");
  sel.value = "KC"; sel.onchange();
  assert.deepEqual(app.__rows.map((r) => r.p.id).sort(), ["a", "c"]);
  sel.value = ""; sel.onchange();
  assert.equal(app.__rows.length, 6);
});

test("a browser that refuses storage still gets a board, and a page without watchlist.js gets rows with no price cell", async () => {
  const { app } = await mountPlayers({ players: PLAYERS, storageThrows: true });
  assert.equal(app.__rows.length, 6, "the board did not render");
  const bare = await mountPlayers({ players: PLAYERS, noWatchlist: true });
  assert.ok(!bare.app.innerHTML.includes('class="px"'), "a price cell with nothing behind it");
  assert.ok(!bare.app.__detail(bare.app.__rows[0]).includes("pxin"), "a price input with nothing behind it");
});

test("with Sort by edge on, a price committed in the panel re-orders the rows; a keystroke does not", async () => {
  const { app, doc, press, win } = await mountPlayers({ players: PLAYERS });
  const W = win.BetHouseWatchlist;
  press("sortseg", "Edge");
  const i = app.__rows.length - 1, last = app.__rows[i];
  const key = W.priceKey({ league: "NFL", slate: "2026-2", playerId: last.p.id, prop: "td" });
  const input = stubEl("input"); input.setAttribute("data-pk", key); input.setAttribute("data-i", String(i)); input.value = "+400";
  app.handlers.input[0]({ target: input });
  assert.equal(app.__rows[i].p.id, last.p.id, "typing must not re-order under the cursor");
  app.handlers.change[0]({ target: input });
  assert.equal(app.__rows[0].p.id, last.p.id, "committing the price put the priced row first");
});

test("sort by boost orders rows by projection over his own rate, with no rate last; sort by edge puts priced rows first", async () => {
  const { app, doc, press, win } = await mountPlayers({ players: PLAYERS, storage: { [ (await import("./watchlist.js")).default.PRICE_KEY ]: JSON.stringify({ "NFL|2026-2|c|td": "+400", "NFL|2026-1|a|td": "-500" }) } });
  press("sortseg", "Boost");
  const ratio = (r) => r.s.observedRate > 0 ? r.s.lambda / r.s.observedRate : -Infinity;
  const got = app.__rows.map(ratio);
  for (let i = 1; i < got.length; i++) assert.ok(got[i - 1] >= got[i], `boost not descending at ${i}: ${got}`);
  assert.equal(app.__rows[app.__rows.length - 1].p.id, "c", "no touchdowns yet: no baseline, so last");
  press("sortseg", "Edge");
  assert.equal(app.__rows[0].p.id, "c", "the one priced row comes first");
  assert.ok(!app.__rows.find((r) => r.p.id === "a").pe, "last week's price is not this week's edge");
  const E = win.BetHouseEdge;
  const ev = E.evPct(app.__rows[0].s.prob, E.americanToDecimal(400));
  assert.ok(app.innerHTML.includes(E.formatPct(ev)), "the row does not show the edge at the stored price");
});

test("typing a price in the panel prices the row at once, through edge.js, and is remembered", async () => {
  const { app, doc, win, store } = await mountPlayers({ players: PLAYERS });
  const W = win.BetHouseWatchlist, E = win.BetHouseEdge;
  const i = app.__rows.findIndex((r) => r.p.id === "a");
  const panel = app.__detail(app.__rows[i]);
  const key = W.priceKey({ league: "NFL", slate: "2026-2", playerId: "a", prop: "td" });
  assert.ok(panel.includes(`data-pk="${key}"`), "the panel has no price input for this row");
  const input = stubEl("input"); input.setAttribute("data-pk", key); input.setAttribute("data-i", String(i)); input.value = "-120";
  app.handlers.input[0]({ target: input });
  const ev = E.evPct(app.__rows[i].s.prob, E.americanToDecimal(-120));
  assert.ok(doc.getElementById("px" + i).innerHTML.includes(E.formatPct(ev)), "the row cell did not update");
  assert.deepEqual(W.parsePrices(store.get(W.PRICE_KEY)), { [key]: -120 }, "the price was not remembered");
  input.value = "";
  app.handlers.input[0]({ target: input });
  assert.deepEqual(W.parsePrices(store.get(W.PRICE_KEY)), {}, "clearing the box forgets the price");
  assert.ok(!doc.getElementById("px" + i).innerHTML.includes("edge"), "a cleared price still shows an edge");
});

test("one edge colour rule: the slip and the row share edgeClass", () => {
  const js = src("football-board.js");
  assert.equal((js.match(/ev>0\.02\?/g) || []).length, 1, "the good/warn/bad threshold appears more than once");
});

/* ------------------------------------------------------------------ *
 * The player drawer (phase 2, 2026-09-29)
 *
 * A row opens a drawer instead of an inline panel: the player's id goes
 * in the URL so a row is a link, Escape and the back button close it,
 * and its tabs are the overview, the ladder as threshold buttons, and
 * the recent games the fetcher wrote. Page and stylesheet contracts
 * first, then the real script against the stub window.
 * ------------------------------------------------------------------ */

test("both football boards carry the drawer and its scrim, and the stylesheet fixes them to the viewport", () => {
  for (const page of ["nfl.html", "cfb.html"]) {
    const html = src(page);
    assert.match(html, /<div[^>]*id="drawer"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*hidden/, `${page}: no dialog drawer`);
    assert.match(html, /id="scrim"[^>]*hidden/, `${page}: no scrim`);
    assert.match(html, /id="dclose"/, `${page}: no close button`);
  }
  const css = src(SHEET);
  assert.match(css, /\.drawer\{[^}]*position:fixed/, "the drawer is not fixed to the viewport");
  assert.match(css, /\.scrim\{[^}]*position:fixed/, "the scrim is not fixed to the viewport");
  assert.match(css, /@media \(max-width:760px\)\{[^@]*\.drawer\{[^}]*(bottom:0|max-height)/, "no phone sheet rule for the drawer");
});

test("the board feature-detects the history API before touching it, and names its recent-games model calls", () => {
  const js = src("football-board.js");
  assert.match(js, /typeof window\.history/, "history is used without a feature check");
  assert.match(js, /N\.recentValues\(/); assert.match(js, /N\.recentHits\(/);
  assert.doesNotMatch(js, /id="why/, "the inline panel is still rendered");
});

const clickRow = (app, i) => {
  const btn = stubEl("button"); btn.setAttribute("data-i", String(i)); btn.setAttribute("aria-expanded", "false");
  app.handlers.click[0]({ target: { closest: (sel) => (sel === ".row" ? btn : null) } });
  return btn;
};

test("a row opens the drawer with the player in the URL; Escape and the back button close it and give focus back", async () => {
  const { app, doc, win } = await mountPlayers({ players: PLAYERS });
  const i = app.__rows.findIndex((r) => r.p.id === "a");
  const btn = clickRow(app, i);
  const drawer = doc.getElementById("drawer");
  assert.equal(drawer.hidden, false, "the drawer did not open");
  assert.equal(doc.getElementById("scrim").hidden, false);
  assert.ok(doc.getElementById("dbody").innerHTML.includes("carries"), "the overview is not the reasoning table");
  assert.ok(doc.getElementById("dtitle").textContent.includes("Alpha Wide"));
  assert.deepEqual(win.pushed.slice(-1), ["?player=a&prop=td"], "the URL does not name the player");
  const closeBtn = doc.getElementById("dclose");
  assert.ok(closeBtn.focused, "focus did not move to the close button");
  // Escape closes, the URL goes back to the bare board, focus returns to the row.
  const keys = doc.listeners.keydown; assert.ok(keys && keys.length, "no document keydown handler");
  keys[keys.length - 1]({ key: "Escape", preventDefault() {} });
  assert.equal(drawer.hidden, true);
  assert.equal(win.pushed.slice(-1)[0], "/nfl.html");
  assert.ok(btn.focused, "focus did not return to the row");
  // Open again, then the back button: a popstate to the bare path closes it without pushing.
  clickRow(app, i);
  const n = win.pushed.length;
  win.location.search = "";
  win.listeners.popstate[0]({});
  assert.equal(drawer.hidden, true);
  assert.equal(win.pushed.length, n, "a popstate must not push");
});

test("a deep link opens the drawer on that player, even one beyond the twenty-row cut", async () => {
  const many = [];
  for (let k = 0; k < 30; k++) many.push({ ...PLAYERS[0], id: "p" + k, name: "Player " + k, tds: 8 - (k % 7), recent: undefined });
  // p27 has the fewest touchdowns of the thirty, so he ranks under the cut.
  const { app, doc } = await mountPlayers({ players: many, search: "?player=p27&prop=td" });
  assert.equal(doc.getElementById("drawer").hidden, false, "the deep link did not open the drawer");
  assert.ok(doc.getElementById("dtitle").textContent.includes("Player 27"));
  assert.ok(app.__rows.length > 20, "the cut was not lifted to reach the player");
});

test("the recent-games tab draws one bar per row and the hit rate at the threshold, and nothing for a player with none", async () => {
  const { app, doc, press } = await mountPlayers({ players: PLAYERS });
  clickRow(app, app.__rows.findIndex((r) => r.p.id === "a"));
  press("dtabs", "Recent games");
  const body = doc.getElementById("dbody").innerHTML;
  assert.equal((body.match(/<rect class="bar/g) || []).length, 3, "one bar per recent row");
  assert.match(body, /scored in <b>2<\/b> of the last <b>3<\/b>/, "touchdowns: how many of the last games he scored in");
  clickRow(app, app.__rows.findIndex((r) => r.p.id === "b"));
  press("dtabs", "Recent games");
  assert.doesNotMatch(doc.getElementById("dbody").innerHTML, /<rect class="bar/, "a player with no rows has no chart");
  assert.match(doc.getElementById("dbody").innerHTML, /no game log/i);
});

/* A levelled receiving-yards pool: 400 games around a 60-yard projection. */
function recPool(nfl) {
  const exp = [], ratio = [];
  for (let k = 0; k < 400; k++) { exp.push(40 + (k % 40)); ratio.push(0.2 + ((k * 37) % 100) / 60); }
  return { recyds: nfl.sortedPool(exp, ratio, "recyds") };
}

test("the ladder tab is the model's rungs as buttons: the near rung pressed first, a press moves the headline and the recent-games threshold", async () => {
  const nfl = (await import("./nfl.js")).default;
  const { app, doc, press } = await mountPlayers({ players: PLAYERS, pools: recPool(nfl) });
  press("view", "Receiving yards");
  const i = app.__rows.findIndex((r) => r.p.id === "a");
  assert.ok(i >= 0, "no receiving row for a");
  clickRow(app, i);
  press("dtabs", "Alternate lines");
  let body = doc.getElementById("dbody").innerHTML;
  assert.match(body, /class="rungs"/);
  const rungs = nfl.ladder("recyds", app.__rows[i].exp, recPool(nfl).recyds);
  assert.equal((body.match(/<button class="rung/g) || []).length, rungs.length, "one button per rung");
  assert.match(body, /aria-pressed="true"/, "no rung pressed");
  const far = rungs[rungs.length - 1];
  const drawer = doc.getElementById("drawer");
  drawer.handlers.click[0]({ target: { closest: (sel) => (sel === "[data-rung]" ? { getAttribute: () => String(far.at) } : null) } });
  body = doc.getElementById("dbody").innerHTML;
  assert.ok(body.includes("<b>" + far.at + "+</b>"), "the headline did not move to the pressed rung");
  press("dtabs", "Recent games");
  body = doc.getElementById("dbody").innerHTML;
  const hits = nfl.recentHits("recyds", PLAYERS[0].recent, far.at);
  assert.match(body, new RegExp("reached <b>" + far.at + "\\+</b> in <b>" + hits + "</b> of the last <b>3</b>"), "the recent tab does not use the pressed rung");
});

test("the back button never pushes: a popstate to another player's URL switches the view and opens him without a new entry", async () => {
  const nfl = (await import("./nfl.js")).default;
  const { app, doc, win } = await mountPlayers({ players: PLAYERS, pools: recPool(nfl) });
  // The back on the touchdown view, then Back lands on the wide receiver's receiving-yards link:
  // the view switches, the back is not on it, and nothing may be pushed while doing so.
  clickRow(app, app.__rows.findIndex((r) => r.p.id === "b"));
  const n = win.pushed.length;
  win.location.search = "?player=a&prop=recyds";
  win.listeners.popstate[0]({});
  assert.equal(doc.getElementById("dtitle").textContent, "Alpha Wide");
  assert.equal(win.pushed.length, n, "a popstate pushed");
  assert.equal(doc.getElementById("drawer").hidden, false);
});

test("re-clicking the open row does not stack a duplicate URL", async () => {
  const { app, win } = await mountPlayers({ players: PLAYERS });
  const i = app.__rows.findIndex((r) => r.p.id === "a");
  clickRow(app, i); clickRow(app, i);
  assert.deepEqual(win.pushed, ["?player=a&prop=td"]);
});

test("a deep link to a player hidden by a filter clears the filter; one to nobody on the view closes quietly and leaves the cut alone", async () => {
  const { app, doc, win } = await mountPlayers({ players: PLAYERS, storage: {}, search: "?player=a&prop=td" });
  assert.equal(doc.getElementById("drawer").hidden, false);
  // Filter him out, then follow a link to him: the filter goes, he opens.
  const sel = doc.getElementById("teamsel"); sel.value = "LAC"; sel.onchange();
  assert.equal(doc.getElementById("drawer").hidden, true, "the drawer stayed open on a row the filter removed");
  win.location.search = "?player=a&prop=td"; win.listeners.popstate[0]({});
  assert.equal(doc.getElementById("drawer").hidden, false, "the deep link did not clear the filter");
  assert.equal(sel.value, "", "the team filter was not cleared");
  // A link to nobody: closed, quiet, and the twenty-row cut untouched.
  const before = win.pushed.length;
  win.location.search = "?player=nobody&prop=td"; win.listeners.popstate[0]({});
  assert.equal(doc.getElementById("drawer").hidden, true);
  assert.equal(win.pushed.length, before);
  assert.ok(app.__rows.length <= 20);
});

test("the slash shortcut stays out of an open drawer", async () => {
  const { app, doc } = await mountPlayers({ players: PLAYERS });
  clickRow(app, 0);
  const q = doc.getElementById("q"); q.focused = false;
  doc.activeElement = { tagName: "BUTTON" };
  for (const h of doc.listeners.keydown) h({ key: "/", preventDefault() {} });
  assert.ok(!q.focused, "the search box took focus from behind the dialog");
});

test("a page without the drawer markup is told to reload, like a stale model", async () => {
  const nfl = (await import("./nfl.js")).default;
  const doc = stubDoc(); const missing = new Set(["starseg", "tray"]);
  const real = doc.getElementById.bind(doc);
  doc.getElementById = (id) => (missing.has(id) ? null : real(id));
  const win = {};
  new Function("window", "document", src("football-board.js"))(win, doc);
  win.BetHouseFootballBoard.mount({ model: nfl, data: { season: 2026, week: 2, games: [], ratings: {}, teamFactors: {}, players: [], pools: {} }, record: null, league: "NFL", fetcher: "x", copy: { noteTD: "", noteStat: {}, noteGames: "", footer: "" } });
  assert.match(doc.getElementById("app").innerHTML, /Reload this page/);
});

/* ------------------------------------------------------------------ *
 * Stars and the compare tray (phase 3, 2026-09-29)
 *
 * A star beside a row keeps the player in the browser; "Starred only"
 * narrows the board to them; the slip can be built from them, through
 * the same candidate builder and gates as the slate; the drawer adds a
 * player to a tray that holds up to three side by side.
 * ------------------------------------------------------------------ */

test("both football boards carry the star strip, the compare button and the tray", () => {
  for (const page of ["nfl.html", "cfb.html"]) {
    const html = src(page);
    for (const id of ["starseg", "dcompare", "tray", "tcards", "tclear"]) assert.match(html, new RegExp(`id="${id}"`), `${page}: no #${id}`);
  }
  const css = src(SHEET);
  assert.match(css, /\.tray\{[^}]*position:fixed/, "the tray is not fixed to the viewport");
});

/* A star click, with the button it landed on: the row around it must not open. */
const clickStar = (app, key) => {
  const btn = stubEl("button"); btn.setAttribute("data-star", key);
  app.handlers.click[0]({ target: { closest: (sel) => (sel === "[data-star]" ? btn : sel === ".row" ? stubEl("button") : null) } });
  return btn;
};

test("a star is kept in the browser and lit in place without opening the row; Starred only narrows the board; another tab's stars survive a save", async () => {
  const { app, doc, win, store, press } = await mountPlayers({ players: PLAYERS, storage: { "bethouse.watch.v1": JSON.stringify(["CFB|zz"]) } });
  const W = win.BetHouseWatchlist;
  const ka = W.watchKey({ league: "NFL", playerId: "a" }), kf = W.watchKey({ league: "NFL", playerId: "f" });
  const btn = clickStar(app, ka);
  assert.equal(btn.getAttribute("aria-pressed"), "true", "the star did not light in place");
  assert.equal(doc.getElementById("dtitle").textContent, "", "a star click opened the drawer");
  clickStar(app, kf);
  assert.deepEqual(W.parseWatch(store.get(W.WATCH_KEY)).sort(), ["CFB|zz", ka, kf].sort(), "the stars were not remembered, or the other board's were lost");
  press("starseg", "Starred only");
  assert.deepEqual(app.__rows.map((r) => r.p.id).sort(), ["a", "f"]);
  assert.ok(app.innerHTML.includes('data-star="' + ka + '" aria-pressed="true"'), "a re-render does not light the star");
  press("starseg", "Starred only");
  assert.equal(app.__rows.length, 6, "the toggle did not come back off");
});

test("the slip from stars is the starred players' legs and nothing else, one per game, through the same gates", async () => {
  // A third game, so three stars can fill three legs.
  const games = GAMES.concat([{ id: "g3", home: "DDD", away: "CCC", date: "2030-01-03T00:00Z", completed: false }]);
  const players = PLAYERS.concat([{ id: "g", name: "Golf End", team: "CCC", pos: "TE", games: 10, tds: 5, carries: 0, targets: 70, recYds: 600, rushYds: 0, recs: 50, passAtt: 0, passYds: 0, opp: "DDD" }]);
  const { app, win, press } = await mountPlayers({ players, games });
  const W = win.BetHouseWatchlist, key = (id) => W.watchKey({ league: "NFL", playerId: id });
  clickStar(app, key("a")); clickStar(app, key("f"));
  press("pscope", "Starred");
  press("plegs", "3 legs");
  assert.ok(app.innerHTML.includes("Cannot build that slip"), "two stars cannot fill three legs");
  clickStar(app, key("g"));
  press("plegs", "3 legs");
  const why = (app.innerHTML.match(/Cannot build that slip<\/h3><div>([^<]*)/) || [])[1];
  assert.ok(!app.innerHTML.includes("Cannot build that slip"), "three stars in three games did not build: " + why + " | candidates " + JSON.stringify((app.__candidates || []).map((c) => c.playerId + "@" + c.gameId)));
  assert.ok(app.__candidates.length, "no candidates");
  for (const c of app.__candidates) assert.ok(["a", "f", "g"].includes(String(c.playerId)), "a candidate nobody starred: " + c.playerId);
  assert.match(app.innerHTML, /Alpha Wide[\s\S]*Foxtrot Back|Foxtrot Back[\s\S]*Alpha Wide/, "the starred legs are not on the slip");
  // Unstar g and star b, who shares a game with a: one leg per game leaves two games, so three legs refuse.
  clickStar(app, key("g")); clickStar(app, key("b"));
  press("plegs", "3 legs");
  assert.ok(app.innerHTML.includes("Cannot build that slip"), "two games filled three legs");
});

test("the compare tray takes a player from the drawer, holds three at most, drops one on demand, and clears", async () => {
  const { app, doc } = await mountPlayers({ players: PLAYERS });
  const compare = doc.getElementById("dcompare"), tray = doc.getElementById("tray");
  const add = (id) => { clickRow(app, app.__rows.findIndex((r) => r.p.id === id)); compare.handlers.click[0](); };
  add("a");
  assert.equal(tray.hidden, false, "the tray did not appear");
  assert.equal((doc.getElementById("tcards").innerHTML.match(/class="tcard"/g) || []).length, 1);
  add("b"); add("c");
  assert.equal((doc.getElementById("tcards").innerHTML.match(/class="tcard"/g) || []).length, 3);
  add("f");
  assert.equal((doc.getElementById("tcards").innerHTML.match(/class="tcard"/g) || []).length, 3, "a fourth was taken");
  assert.equal(compare.disabled, true, "the full tray does not disable the button");
  tray.handlers.click[0]({ target: { closest: (sel) => (sel === "[data-untray]" ? { getAttribute: () => "b" } : null) } });
  assert.equal((doc.getElementById("tcards").innerHTML.match(/class="tcard"/g) || []).length, 2);
  assert.ok(!doc.getElementById("tcards").innerHTML.includes("Bravo Back"));
  assert.equal(compare.disabled, false, "the button did not come back once a card was dropped");
  doc.getElementById("tclear").handlers.click[0]();
  assert.equal(tray.hidden, true);
});

/* ------------------------------------------------------------------ *
 * The ledger (the restyle, 2026-09-29)
 *
 * Each football view is a headed table: caps column heads over the
 * thick-thin rule, one head per column the rows carry, and the view's
 * column set named on the .game so head and rows share a grid. The
 * header carries a stat tile of numbers the page has, and none it
 * does not.
 * ------------------------------------------------------------------ */

test("every football view renders one column-head row that names its columns, on a .game that names its column set", async () => {
  const nfl = (await import("./nfl.js")).default;
  const { app, press } = await mountPlayers({ players: PLAYERS, pools: recPool(nfl) });
  const heads = (html) => (html.match(/<div class="thead">([\s\S]*?)<\/div>/) || [])[1] || "";
  const labels = (html) => [...heads(html).matchAll(/<span[^>]*>([^<]*)<\/span>/g)].map((m) => m[1]).filter(Boolean);
  assert.equal((app.innerHTML.match(/class="thead"/g) || []).length, 1, "the touchdown view has no head row, or two");
  assert.deepEqual(labels(app.innerHTML), ["Rk", "Player", "Matchup · vs rate", "Chance", "Fair", "Price / edge"]);
  assert.match(app.innerHTML, /<div class="game v-td">/);
  press("view", "Receiving yards");
  assert.deepEqual(labels(app.innerHTML), ["Rk", "Player", "Matchup · vs rate", "Proj", "Over", "Fair", "Price / edge"]);
  assert.match(app.innerHTML, /<div class="game v-stat">/);
  press("view", "Spread & total");
  assert.deepEqual(labels(app.innerHTML).slice(0, 2), ["Rk", "Matchup"]);
  assert.match(app.innerHTML, /<div class="game v-game nopx nostar">|<div class="game v-game nostar">/);
});

test("the stat tile carries the players priced and the build time, and a graded count only when there is a record", async () => {
  const { doc } = await mountPlayers({ players: PLAYERS });
  const tile = doc.getElementById("tile").innerHTML;
  assert.match(tile, /<b>6<\/b><span>players priced<\/span>/);
  assert.match(tile, /<b>00:00<\/b><span>built, UTC<\/span>/);
  assert.doesNotMatch(tile, /graded/, "a graded cell with no record behind it");
});

test("the stylesheet's column sets exist for every football view, and the tile sits flush right", () => {
  const css = src(SHEET);
  for (const v of ["v-td", "v-stat", "v-game"]) assert.match(css, new RegExp(`\\.game\\.${v}\\{--cols:`), `no column set for ${v}`);
  assert.match(css, /\.tile\{[^}]*margin-left:auto/);
  // The head's star track is the star's 40px minus the 10px grid gap, so its 1fr equals the row's.
  assert.match(css, /\.thead\{[^}]*grid-template-columns:var\(--cols\) 30px/);
});

test("the vs-rate pill says what the boost sort computes: up past +10%, down past -10%, steady between, nothing without a rate", async () => {
  const { app } = await mountPlayers({ players: PLAYERS });
  const rowHtml = (id) => { const i = app.__rows.findIndex((r) => r.p.id === id); const m = app.innerHTML.split('data-i="' + i + '"')[1] || ""; return m.split("</button>")[0]; };
  for (const r of app.__rows) {
    const html = rowHtml(r.p.id);
    if (!(r.s.observedRate > 0)) { assert.doesNotMatch(html, /class="pill/, r.p.name + ": a pill with no rate behind it"); continue; }
    const d = Math.round((r.s.lambda / r.s.observedRate - 1) * 100);
    const want = d >= 10 ? "pill up" : d <= -10 ? "pill down" : 'pill">steady';
    assert.ok(html.includes(want), r.p.name + ": " + d + "% should show " + want);
  }
});

/* ------------------------------------------------------------------ *
 * The live page (phase 5, 2026-09-29)
 *
 * A tracked prop is set from the drawer: a rung's "Track" button, or
 * "Track anytime TD" on the touchdown view. The page live.html reads
 * them back and polls the public feeds in the browser; live.js holds
 * the arithmetic and is tested on its own.
 * ------------------------------------------------------------------ */

test("the drawer offers a Track button on the pressed rung and on the touchdown view, keyed the way live.html reads", async () => {
  const nfl = (await import("./nfl.js")).default;
  const { app, doc, press, win } = await mountPlayers({ players: PLAYERS, pools: recPool(nfl) });
  const W = win.BetHouseWatchlist;
  clickRow(app, app.__rows.findIndex((r) => r.p.id === "a"));
  let body = doc.getElementById("dbody").innerHTML;
  assert.match(body, /data-track="[^"]*"[^>]*>Track anytime TD</, "no Track button on the touchdown overview");
  press("view", "Receiving yards");
  const i = app.__rows.findIndex((r) => r.p.id === "a");
  clickRow(app, i);
  press("dtabs", "Alternate lines");
  body = doc.getElementById("dbody").innerHTML;
  const m = body.match(/data-track="([^"]+)"[^>]*>Track (\d+)\+</);
  assert.ok(m, "no Track button for the pressed rung");
  // Pressing it stores a tracked prop for this player, this prop, that rung, in this game.
  const drawer = doc.getElementById("drawer");
  drawer.handlers.click[0]({ target: { closest: (sel) => (sel === "[data-track]" ? { getAttribute: (k) => (k === "data-track" ? m[1] : null) } : null) } });
  const tracks = W.parseTracks(win.localStorage.getItem(W.TRACK_KEY));
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].playerId, "a"); assert.equal(tracks[0].prop, "recyds"); assert.equal(tracks[0].rung, Number(m[2])); assert.equal(tracks[0].gameId, "g1"); assert.equal(tracks[0].sport, "football");
  assert.match(doc.getElementById("dbody").innerHTML, /Tracking \d+\+ ✓/, "the button does not say it is tracking");
});

test("live.html is a board: shared stylesheet, the scripts it needs, a card list and a status strip", () => {
  const html = src("live.html");
  for (const s of ["watchlist.js", "bets.js", "nfl.js", "live.js", "edge.js"]) assert.match(html, new RegExp(`src="${s}"`), `live.html does not load ${s}`);
  for (const id of ["cards", "lstrip", "tile", "updated"]) assert.match(html, new RegExp(`id="${id}"`), `live.html has no #${id}`);
  assert.doesNotMatch(html, /fonts\.googleapis|https?:\/\/[^"]*\.(js|css)"/, "an off-origin script or sheet");
});

/* ------------------------------------------------------------------ *
 * index.html is the home: tonight's slate, built from the boards' data
 *
 * The root URL used to open the baseball board. It opens a home now:
 * the slate across the boards, one card per game with the two teams'
 * logos, and a row of top picks. The logos are the one image the site
 * ships and they come from ESPN's logo CDN, so this test pins that
 * every <img> points there and nothing else loads off-origin.
 * ------------------------------------------------------------------ */

test("index.html is the home: the shared models and every board's data, the slate's ids, logos only from ESPN's CDN", () => {
  const html = src("index.html");
  for (const s of ["edge.js", "nfl.js", "cfb.js", "watchlist.js", "home.js", "mlb-data.js", "pga-data.js", "nfl-data.js", "cfb-data.js"]) {
    assert.match(html, new RegExp('<script src="' + s.replace(".", "\\.") + '"'), "index.html loads " + s);
  }
  for (const id of ["tile", "hero", "slate", "gcards", "tops"]) assert.match(html, new RegExp('id="' + id + '"'), "index.html has #" + id);
  assert.doesNotMatch(html, /fonts\.googleapis|https?:\/\/[^"]*\.(js|css)"/, "an off-origin script or sheet");
  // The img markup is built in the script; its src is whatever home.js's logoUrl returns (pinned to
  // ESPN's CDN in home.test.mjs), escaped, with no referrer and hidden when it does not load.
  const imgs = html.match(/<img[^>]*>/g) || [];
  assert.ok(imgs.length, "the page builds a logo img");
  for (const im of imgs) {
    assert.match(im, /src="'\+esc\(u\)\+'"/, "a logo src that is not the module's sanitised url: " + im);
    assert.match(im, /referrerpolicy="no-referrer"/, "a logo request that carries a referrer");
    assert.match(im, /onerror="this\.hidden=true"/, "a logo that does not fail closed");
  }
  assert.match(html, /H\.logoUrl\(/, "the src comes from home.js");
});

test("the baseball board kept its page under its new name, and every board calls the home Home", () => {
  const b = src("baseball.html");
  assert.match(b, /<title>BetHouse — Baseball<\/title>/);
  assert.match(b, /BETHOUSE_MLB|mlb-data\.js/);
  for (const page of BOARDS) {
    if (page === "index.html") continue;
    assert.match(src(page), /class="navlink" href="index\.html">Home →</, page + " links Home");
  }
});
