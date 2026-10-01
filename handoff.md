# handoff

**Read this first, then verify it.** This file was wrong for two days before
anyone noticed — it still described the NFL board as "new and uncommitted"
after it had shipped, and knew nothing about the bet tracker, the
recalibration, or CLV. A handoff note is the one document a new session trusts
without checking, which makes a stale one worse than none at all.

So: `node provenance.mjs` before you believe anything below. It prints the
commit you are reading and how old the data on disk is.

---

## Where things are

**Eight pages**, all live and deployed:

| page | what |
|---|---|
| `index.html` | the home: tonight's slate across the boards, game cards with logos, tops |
| `baseball.html` | baseball. 1+ H/R/RBI, total bases, home runs, suggested parlay |
| `live.html` | the live tracker: the props you marked, counted off the feeds |
| `record.html` | the record: the replay tables and the live records for both football boards. Added 2026-10-01 |
| `nfl.html` | anytime TD; receiving, rushing, rush + rec and passing yards and receptions, each with a ladder of alternate lines; game matchups from play-by-play. Spreads and totals shown with the board saying they do not beat the close |
| `cfb.html` | college football, the same props and ladders (no matchups). Added 2026-09-05 |
| `golf.html` | PGA Tour make-the-cut |
| `bets.html` | the bet log: history, win rate by bet type, closing line value |

Zero dependencies, no build step, no server, no API key. `node --test` with
**named files** — bare discovery pulls in the backtests, which fire live API
calls. The list lives in seven places and `dom.test.mjs` checks all seven.

## A3: the counting props (2026-10-01, latest)

Shipped (nfl.js DEFAULTS, the fixed-line table beside them):
`yardDecay 0.88`, `rushDecay 0.97`, `rushrecDecay 0.9` (`passDecay`,
`recsDecay` stay 1); `yardOppShrink` stays 0 (the own-line pass had it
at 0.5; fixed lines say noise); `passPoolShare` stays 0 (dead). College
(`cfb.js`) pins the decays to 1 until its own replay.

The measurement design changed mid-step after the code review:
`backtest-nfl.mjs --fixed-lines` takes the graded line and the
eligibility from a reference model (no decay, no opponent) so base and
candidate grade the same propositions; the line is in the dump key;
`compare-td.mjs paired()` refuses dumps from different windows or line
designs and reports rows with the same key and a different outcome
(always 0 under fixed lines); `verdict()` charges only bands both runs
have and notes a band only the candidate reaches. `compare-td.test.mjs`
pins all of it and is in the seven gates. The README's "The rule for
every model change" is now the one statement of the rule; nfl.js and
compare-stats.mjs point at it.

Verifier pass after the commit (6df2abb), fixed in the follow-up: the
"outcome differs" detector could never fire (the line is in the key),
so `sameExam` now REFUSES a counting-prop comparison unless both dumps
are `--fixed-lines`; `paired()` counts rows missing on either side
(`notInBase`, `notInCand`) and past 2% unpaired `verdict()` gives NO
VERDICT; `verdict()` also reports a band the base had and the candidate
left. The README rule carries the band qualifier. The board drops a
data file's `w` when its `model` stamp's decays differ from the
script's (never a weight it did not apply). The swipe-to-close is gated
to the 760px breakpoint and to downward drags.

Plumbing: `seasonLines` keeps `record.slog` (one value per stat in
STATS order, oldest first) in memory; `boardPlayer` writes `w` (only
the stats whose decay is under 1, via `model.weightedStatTotals`), so
the data file carries three numbers a player, not the log.
`weightedStatTotal(stat, record)` reads slog, then w, then the plain
total; `expectedStat` goes through it. The arithmetic tab's "Regressed
to" cell says when the weight is on. Two shell slips this step, both
zsh not splitting a variable (`$w`, `$OFF`): one sweep ran without a
window and one base ran with the shipped defaults; both were caught by
the dump's `overrides` field and re-run with explicit flags. Always
pass `--set` flags literally.

## B1/B2: team colours and the loosened taste rules (2026-10-01, later)

- `teams.js` (UMD `BetHouseTeams`, `teams.test.mjs`, in all seven
  gates): `use(table)`, `colour(league,key)` → `{primary, secondary}`
  as `#hex` or null, `stripe(league,away,home)` → two solid halves (or
  one colour, or ''), `tint(league,key,alpha=0.16)` → `rgba()`. Keys
  as faces.js: NFL/MLB abbreviation, college ESPN id. Table:
  `teams-data.js` from `node fetch-teams.mjs` (ESPN's keyless team
  lists; 32 NFL, 690 college, 30 MLB; run by hand, committed, not in
  any workflow).
- Where it goes: `index.html` game card `<span class="gstripe">` (4px,
  top); the drawer's `#dhead` gets `style="background:<tint>"` (set to
  '' for a team with no colour, so the stub and a browser agree); the
  tray card's `border-left-color`. `dhead` is in the stale-page list.
  A dom test scans both files for any text-colour sink fed by a team
  value. `paint()` picks the secondary when the primary's luminance is
  under `DARK` (0.02), and null when the secondary is dark too: black
  primaries are real (PIT, LV, 330 FBS rows, 313 of them with no
  usable secondary on ESPN's list, which therefore paint nothing).
  Navies (CHI, DEN, HOU, NYY) switch to their secondary as well. A
  one-sided stripe is the known half beside `transparent`.
  MLB rows are also written under statsapi's abbreviation (`cws`, `az`)
  because home.js keys by it; the shape test checks every abbreviation
  in mlb-data.js resolves. `fetch-teams.mjs` refuses to write below a
  per-league floor. `teams-data.js`'s `generated` stamp is deliberately
  outside provenance.mjs's one-day freshness gate: the table is
  decade-scale.
- B1: DESIGN.md colours/typography/don'ts rewritten (team colours,
  kickers, measured colour); the head-label test pins the first two
  columns and that every figure column has a head. The 56ch note cap
  is KEPT on purpose (the plan said 72ch; the test's own measurement
  says that is 93 characters).

## B0: the card says why (2026-10-01)

The user compared nhlpropking.com's card with ours: too much text to
tell why one player is a favourite. Shipped, all on `football-board.js`
with `board.css`:

- The drawer's bands: head, **why** (at most three sentences: his
  line; the opponent and offence factors only when ≥5%, bigger first;
  for a stat the allowance and the recent-games hit count), rate,
  receipt. The receipt is this call's facts plus a link to
  `record.html#nfl`; the record's n/predicted/actual left the card.
- Tabs: Overview (price, Track, "How he gets there" = chips with notes
  + one game-log sentence) · Alternate lines · Recent games · **The
  arithmetic** (the old nine cells, unchanged). `app.__over` is the
  overview builder, `app.__detail` the arithmetic (and a game's table).
- `chips.js` (UMD, `BetHouseChips`, `chips.test.mjs`): thresholds in
  one place. Volume ±20%: the last three games of `p.log` against the
  games before them (≥6 games). Red zone ≥20%: his `rz` touches over
  the touches summed for every player on his team in the DATA FILE
  (not the team's true total, which the file lacks; the note says
  "logged for KC's priced players"). Snaps ≥70%/≤40%, deep ≥30%
  (`usage.ays`), defence ±7% on the factor the model APPLIES (`y.oppFactor`
  for a stat, i.e. the allowance at the fitted strength, half for
  rushing/passing yards; none when `oppShrinkKey` is 0). The stat row's
  hand-typed soft/tough badge is gone. Rows wear `CH.row()` (three; one
  on a phone via CSS), the overview all of them; a stat overview with
  no chips still carries the recent-games hit sentence, so college
  (no `log`/`rz`/`usage` yet) never opens on a bare price box.
- Review fixes folded in before the commit: the controls row was never
  un-hidden once the game-view toggle moved to per-child hiding (the
  DOM stub now seeds `hidden` from nfl.html's markup so that class of
  bug fails in the suite); the TD why line uses plain per-game counts
  beside the plain rate (the decay-weighted workload stays labelled in
  the arithmetic tab); closing the parlay strip also clears the typed
  slip price; `receivingOpportunity` is in NEEDS; the record page's
  minus signs are U+2212 like the boards'.
- `record.html` + `record-page.js` (UMD, `record-page.test.mjs`): the
  replay tables are static markup there (moved out of the two HTML
  pages' `copy.footer`, which no longer exists); `liveRecord` and
  `parlayRecord` moved there from the board. Every board has a
  `Record →` nav link; `BOARDS` in `dom.test.mjs` is eight.
- The parlay strip sits under the controls row and hides behind one
  `Suggest a parlay` button (`#parlaywrap`/`#parlayseg`); the controls
  row shows on the game view with only that button. `#sortwrap` and
  `#teamwrap` ids added; `parlayseg` is in the stale-page list.
- `dom.test.mjs`: the stub's `innerHTML` setter now drops children on
  `""`, so a re-rendered segment's `children[0]` is the live button.

Not done, by design: baseball and PGA keep their own footers; the
record page says so. Next in the plan: B1/B2 (DESIGN.md loosening, team
colours), then A3.

## A2: the touchdown model (2026-09-30)

Three terms measured on the fit window (2023 to 2024) and validated
on 2025 to 2026, paired row for row against the equal-weight replay
(`node backtest-nfl.mjs --from … --dump`, then `node compare-td.mjs`).
Shipped: `tdDecay` 0.97 (Brier 0.15459 → 0.15432 fit, 0.15720 →
0.15683 validation, Δ/SE −4.2 and −4.0, no band worse than 3pp; the
comment beside the constant in nfl.js carries the full table and the
commands). The A2 review caught two measurement faults in the first
pass that had made 0.95 look clean: the replay handed every game all
four cached seasons where the board caps at two, and the decay
shrank the evidence as well as reweighting it; `backtest-nfl.mjs`
now applies the board's window to the lines (the team ratings still
take every prior game, as the board's do), `weightedLine` scales its
weights to the game count, `--fit` re-scores from the weighted count
the shrink used, and the grid was re-run. Also from that
review: the per-game log stores the league's receiving opportunity
(college records receptions, never targets, and the first cut would
have zeroed every college receiver's usage on the next build);
`seasonLines` sorts the games itself; the panel's workload cell shows
the weighted figures and says so; the era stamp is on each record row
beside `recordedAt`, and a day file's first era is never overwritten. Dead:
`tdScript` (worse at every power on both windows) and `tdRz` (worse on
both windows whether fitted on box scores or on prediction-time
inputs; `fit-usage.mjs` is the second fit). The data file carries
`model` and the tracker stamps it into each day file, so the record
reads by era. A first red-zone pass looked wrong for a data reason
before the term was measured: the play-by-play only made a row for a
player who had a red-zone touch, so 66% of player-games read as
unknown and every rate was inflated; the review caught it and the
zero fill is coverage-aware now. Also caught there: scrambles were
dropped (168 of 168 red-zone scrambles in 2025), two-point tries were
counted. Next: A3, the counting props (target and carry shares, the
same decay, air yards, the passing 300+ shape).

## A1: the usage feed (2026-09-30)

Start of the program the user approved: a stronger NFL player-prop
model and a board that says more, with the honesty rules kept and the
taste rules loosened (the plan is in the session's plan file and in the
README's model section as it ships). A1 is data only. `enrich-nfl.mjs`
joins nflverse's weekly stats, snap counts and play-by-play to ESPN ids
through nflverse's `players` crosswalk and writes `nfl-enrich.json`
(gitignored; `node enrich-nfl.mjs --seasons 2023,2024,2025,2026` wrote
22,383 player-games, 982 KB, join rates above 99.7% on every file per
the report it carries). `fetch-football.mjs` builds it for the NFL
(`league.enrich`), attaches the rows to the window's games and puts
`usage` / `usage3` on each board player (`usageOf` in enrich-nfl.mjs:
mean snap, target and air-yards shares with the count of games behind
each, summed red-zone carries, targets and goal-line carries); a feed
failure logs and the board builds without them. `backtest-nfl.mjs`
attaches the cache when present so A2's terms can read `p.x` on every
prior game. The NFL workflow restores the whole `nflverse/` cache
before the fetch (it used to restore only the play-by-play, after).
The three A2 terms are wired in nfl.js at their off values (tdRz 0,
tdDecay 1, tdScript 0), tested to change nothing at those values, with
the replay plumbing to measure them: `--dump` writes every touchdown
row with the model's inputs, `compare-td.mjs` compares two dumps row
for row (paired Δ/SE), `fit-usage.mjs` fits the usage regression on
prediction-time inputs. Review fixes from the A1 pass: scrambles count
as carries; two-point tries are skipped; a played game in a week the
play-by-play covered has zero red-zone touches rather than unknown
(`fillZeroTouches`, coverage-aware); the join count no longer goes
negative on an unmatched goal-line carry; the cache merges seasons
instead of shrinking to the board's two; the CLI default reads the
history's seasons; the replay prints the cache's seasons and warns on
a partial overlap. A2's results and the shipped constant are in the
next section.

## The player card (2026-09-29, later)

The user showed nhlpropking.com's player card and chose: keep the
slide-in panel, football boards first. `renderDrawer` fills a hero
(`#dkick` matchup label, `#dtitle` the name only, tests pin it; `#dsub`
`pos · Model rank #n of N · prop`; `#dface` the large headshot at 150px
as a cutout, the mark under it) and `#dbands` from `app.__bands(r)`,
set per view beside `app.__detail`: the headline band (`band('head',…)`),
`receiptBand(prop)` from `cfg.record.props[prop]` (n, bias; absent
without a record) and `rateBand(ratio, own, delta, unit)` from the same
ratio the pill and the boost sort use. The overviews are `cells([...])`:
TD keeps every number of the old table (the word "carries" is pinned);
the stat view's verdict became the headline band and its prose became
cells. The game view sets `app.__bands=null`. The panel is 640px;
`.dcells` three columns, two on a phone; the phone rules live in the
drawer's own 760px block (the `[^@]*` test). Not done: a per-player
receipt (recordedAt is in the `nfl-record/` day files the page does not
load; a roll-up into nfl-record.js would allow "we said X% on <date>");
the baseball and golf inline panels as the same card.

Review fixes before the push: the Opportunities cell printed a season
total labelled "a game" (now per game); "Model rank #n of N" used the
rows on screen as N (now stamped on every row before the cut, so it is
his place in the whole field and does not move with a filter); the rate
band and the row's pill classified "above his rate" on different
thresholds (one `rateClass`, on the rounded percent, for both); the
receipt is claimed only when the build precedes the game's kickoff,
quotes the record the way the footer does (predicted, actual, off by),
drops the label's ", over" suffix, and labels the build time UTC only
when the stamp ends in Z; the cells are a `<dl>` so a label reads with
its value; `statusRow` (dead) is gone; the tests pin the numbers
(chance, fair, the rate band's delta and direction against the row's
pill, the rank against the field, the stat receipt's own prop, the
venue subtitle, the 150px cutout).

## Tablet clipping on the stat view (2026-09-29, last)

Pre-existing, noticed by the faces review: between 761 and about 812px
the stat view's eight desktop columns did not fit and `.game`'s
`overflow:hidden` clipped the caret and part of the price cell, with no
scrollbar (measured 44px at 768). A tablet block in board.css, up to
959px, drops the fair column on the TD and stat views (the phone drops
it too) and narrows the matchup, figure and price cells. The block sits
before the phone block so the phone's sets win at 760 and below: the
first cut used `min-width:761px`, and a fractional viewport (browser
zoom, Windows scaling) between 760 and 761 matched neither block and
clipped again; the review also measured the name cell collapsing on the
desktop set up to ~956px, hence 959. `dom.test.mjs` pins the invariant
rather than the text: for each view and variant, the tablet set has
exactly as many fewer tracks as cells the block hides, and the block
precedes the phone block. Measured with fresh loads at 760, 761, 768,
800, 850, 900, 940, 959, 960 and 1000: zero clip, zero name overflow,
heads aligned to rows; the name cell on the stat view is 127px at 761
and 134px at 768 (TD view 191 and 198). Those assume overlay
scrollbars (macOS); a classic 15px scrollbar takes 15px off each.

## Faces (2026-09-29, late)

The user showed nhlpropking.com's board (a headshot between the star
and the name) and asked for photos and logos throughout. `faces.js`
(UMD `BetHouseFaces`, `faces.test.mjs`, in all seven gates) builds the
urls (`headshotUrl`, `logoUrl`, `teamKey`) and the one `img` markup;
`home.js` now delegates its `logoUrl` to it. Every `--cols` in
board.css gained a 44px face track after the rank (28px on a phone, where the rank is hidden, and
the golf default got a phone rule it never had); baseball.html's eight
per-page grids likewise. Rows: football (TD, stat, and both marks in a
game row's face cell), baseball (DOM-built, MLB ids, marks in the team
header from `abbrev`), golf (ESPN golfer id). Elsewhere: the drawer head
(`#dface`, a new sibling of `#dtitle`, whose textContent tests pin),
tray cards, slip legs, live cards (tracks now carry `teamKey` so a
college team has a mark), bet-log legs (MLB ids; a mark only when the
team is an abbreviation). `dom.test.mjs` pins the attributes on every
`<img>` any page writes, the two hosts, the face track in every column
set, and a face per football row. Checked in the browser: every image
on nfl, baseball, golf and live loaded (golf lazily below the fold),
no sideways scroll at 390, rows still 60px. The phone column sets
changed to make room: the rank number is hidden under 760px
(`span.slot` and the head's `.rk`; the order shows it), the face is
28px, and the stat view drops the figures' sublabels (the heads say
Proj and Over). Measured on nfl.html at 390: the name cell went from
66px to 106px on the TD view and from 20px (clipped, pre-existing) to
76px on the stat view.

Review fixes before the push: the face rules had been appended after
the phone media block, so the 28px phone size never applied (equal
specificity, later source wins) and the 44px photo sat 10px over the
name on every board at 390; the block moved above the first `@media`
and `dom.test.mjs` pins that order. The home's logo img goes through
`faces.js` too (it had already drifted: no `decoding="async"`), so the
test now asserts faces.js is the only file that writes an `<img>`, with
every attribute, and that no page names an image host but the two
leagues'. `home.js` uses faces.js's key validator instead of its own
copy; the baseball replay row's phone grid dropped a dead track.

## The home (2026-09-29, night)

The user liked nhlpropking.com's home: a hero for the day's slate, game
cards with logos and the model's favourite, a row of tops. `index.html`
is that now and the baseball board is `baseball.html` (every board
gained a Home link; `dom.test.mjs` BOARDS has seven entries and the
tests that read the baseball page read it by its new name).
`home.js` (UMD `BetHouseHome`, `home.test.mjs`, in all seven gates)
holds the arithmetic: `normalise` (one list from the three data files),
`slate` (today, else the next day with games, in the reader's zone),
`footballCard` (projection, favourite, better of spread/total by EV via
nfl.js, so the card agrees with the board's game view), `topTD`,
`topEdge`, `counts`, `golfLine`, `logoUrl`. Logos are ESPN's CDN, keyed
by abbreviation (NFL, MLB) or numeric id (college): `fetch-football.mjs`
now writes `homeId`, `awayId` and `venue` per game (a few KB; both
files were regenerated locally, 16/16 and 59/59 games carry ids). The
`<img>` is built in the page from the module's sanitised url,
`referrerpolicy="no-referrer"`, hidden on error. Deferred: a baseball
top card (`ctxFor`/`scoreSide` live inline in baseball.html, not in
score.js); a small `slate-data.js` from the fetchers if the ~1.2 MB of
football data drags on a phone (`TODO(simplify)` in index.html).

Review fixes after the first push: the boards' verdict now travels with
the numbers (a `#caveat` note above the slate says the replay found the
favourite and the lines do not beat the market; `dom.test.mjs` pins
it); "Top game edge" became "Top model EV on a line", only from 1% up
and only for games not yet started (`topEdge` filters on state); a
started or finished game's card keeps its projection and shows "Line ·
closed" instead of a pick; a missing `cfb.js` no longer falls back to
the NFL model (college cards show no numbers instead); a favourite
under 50.5% prints "pick 'em"; an EV that rounds to 0.0 prints nothing;
`pitcherLabel` skips Jr./Sr.; the slate meta names only the sports on
it and carries the lines' fetch time; Open links have aria-labels; the
render is wrapped so one bad file leaves an honest empty state. Left:
moving the rest of the card's display helpers into home.js, a
`<ul>` for the cards and a `<main>` landmark.

## Larger type (2026-09-29, later still)

The user asked for text that is easier to read. Every `font-size`
under 18px in `board.css` went up one step (10 to 12, 11 and 12 to 13,
13 to 14, 14 to 15, 15 to 16, 16 to 17; 97 rules, one regex pass), the
body to 16px, the caps labels lost their 87.5% condensing and loosened
to 0.1em tracking, and the muted greys lightened. The figures, panel
titles and wordmark did not move. Checked: rows still 60px, no column
head wraps at 1440, and no sideways scroll at 390px on the NFL, live,
baseball and bets boards. DESIGN.md's typography follows.

## Neon green (2026-09-29, later)

The gold on black did not pop for the user. Three palettes were mocked
on the real NFL board by injecting a `<style>` in the headless browser
(amber, lime, cyan + gold); they chose the lime and asked for a truer
green. `--accent` and `--good` are now one neon green (#3DFF5C),
`--warn` #FFD23F, `--bad` #FF3366, text pure white, muted lighter,
hairlines up to 16%; the vs-rate and edge pills are solid fills with
ink (or white, on red) text instead of tints. DESIGN.md's front matter,
colour strategy, pill component and decisions log follow.

## Pitch black, and the strips no longer clip (2026-09-29, evening)

The user saw the warm black on the live site as faded and asked for
pitch black and a brighter yellow. `:root` in `board.css` now has
`--bg:#000000`, neutral surfaces (`#111111`, `#1A1A1A`), hairlines at
12% and the rule at 28% so panels still read on true black, and
`--accent:#FFC53D`; DESIGN.md's front matter, prose and decisions log
follow. Same screenshot showed the last button of every segmented
strip losing its right edge: `.seg` has `padding:3px;margin:-3px` for
the focus ring, but `max-width:100%` capped it at the column's width,
so the 3px of padding came out of the last button. It is
`max-width:calc(100% + 6px)` now; measured on nfl.html, no strip
overflows its box and the body has no sideways scroll at 390px.

## Live, phase 5, 2026-09-29

`live.html` + `live.js` (UMD; `feedUrl footballLine footballState
mlbLine mlbState target current progress summarise pollInterval`,
`live.test.mjs`, in all seven gates) + `watchlist.js` tracked props
(`TRACK_KEY`, `trackKey`, `parseTracks`, `toggleTrack`, `hasTrack`).
The board's drawer renders `trackBtn(r, prop, rung)` on the touchdown
overview and under the pressed rung; the delegated drawer click handles
`[data-track]` (`"td"` or `"stat|rung"`) before `[data-rung]`, and
`toggleTrack` reads the store fresh, toggles, writes the whole list.
The page reads tracks plus open bets from the log (last 36 hours),
groups them by feed URL, fetches each game once, measures every item,
renders cards and the strip, and schedules the next poll by
`pollInterval`. dom.test.mjs lists `live.html` in `BOARDS`, so every
board links to it and it links to every board; the drawer test presses
a Track button through the stub. Football reads `cdn.espn.com/core/<league>/boxscore?xhr=1&gameId=`
(CORS `*`, same box-score shape under `gamepackageJSON`); the site API
host the fetchers use returns 403 to browser user agents, which cost an
hour to find. Verified in the browser against the finished game
401872945: rush + rec 132 of 100 cashed, rushing 92 of 100 missed, a
receiver's anytime TD 0 of 1 missed; a college game's feed parses the
same way (401856704).

Not done: a play-by-play panel (the user chose cards first); college
tracks work the same way through `college-football`; baseball tracks
come only from the bet log, since the baseball drawer has no Track
button yet.

Review fixes before the push: ESPN says `post` for a postponed or
cancelled game too, so only `type.completed` settles (MLB likewise says
Final for a postponed game; `detailedState` is checked); a rung of 0 or
a prop the model does not know counts nothing rather than reading
0 >= 0 as cashed; a request is given ten seconds and the next poll is
armed whatever happened; a feed that fails keeps its last good answer,
says so on the card, and is retried on a short backoff instead of
blanking the game and dropping to the five-minute cadence; polling
stops while the tab is hidden. Left for later, from the same review:
`aria-live` and a progressbar role on the cards, focus kept through a
refresh, real recorded feed payloads as fixtures.

## The restyle, 2026-09-29

**Softened the same day.** The user saw the ledger cut and asked for
the reference's feel; DESIGN.md was revised (decisions log) and
`board.css` with it: `--r-btn 10px`, `--r-panel 14px`, `.pill` (up /
down / good / warn / bad), gold on `.prob`, `.tile b`, `.tcard .tnum`
and pressed `.seg button`; the header's thick-thin rule and the
`.thead` double rule are gone (the table is a rounded panel with a
tinted head row). `football-board.js ratePill(ratio)` renders the
vs-rate pill under the matchup from the same ratio the boost sort uses;
`pxInner` renders the edge as a `small.edge` pill (the `.px small` rule
stays first in the file for `:433`). The head labels read
"Matchup · vs rate"; dom.test.mjs pins the pill's thresholds.

`DESIGN.md` is the source of truth for anything visual (CLAUDE.md points
at it); README, "The look", says what changed. `board.css` was rewritten
to it: one-line `:root` (dom.test.mjs pins exactly one), `--surface` /
`--surface2` replace `--panel` / `--panel2`, new `--rule --muted-dim
--ink --label --mono --body`, `--accent2` gone with the glow and the logo
gradient. Fonts: `fonts/fonts.css` with four self-hosted faces from
Google Fonts' latin woff2 (URLs in the plan file; re-fetch the same way
if a face ever needs another subset); Space Grotesk's files deleted.

The football board script emits a `.thead` per view and names the
column set on the table (`.game.v-td / v-stat / v-game`, `nopx` when
`watchlist.js` is absent, `nostar` on the game view); rows gained a
`.mtch` cell and the counting props a `.fair` cell; `.pos` now holds the
position. `renderTile()` fills `#tile`. Pages: `nfl.html` / `cfb.html`
carry no `<style>`; `index.html` keeps its own `.row` grids (its rows
have their own cells) and its page-only components; `golf.html` keeps
`.ev` and its banner list; `bets.html` keeps the record, breakdown and
CLV blocks and renamed its day head to `.dayhead`. dom.test.mjs:738 now
reads the control-strip pair off `board.css` and forbids a `<style>` on
the football pages; three tests pin the heads, the tile and the column
sets.

Watch: `:433` still reads the first `small{…display:block}` rule, so
`.be small,.prob small,.px small` stays the first in the file; `:1138`
needs the drawer's 760px block free of any `@`; `:153` needs `:root{` on
one line.

## The interactive football board, phase 3 of 3, 2026-09-29

Stars and the compare tray; the three-phase plan is complete. README,
"Stars, and the compare tray". `watchlist.js` gains `WATCH_KEY`,
`watchKey({league, playerId})` (player-level, not per prop -- a change
from the plan, so a starred man shows on every view), `parseWatch`,
`toggle`, `has`. `football-board.js`: `state.watch / starOnly / compare`;
`starBtn(p)` renders a `button.star[data-star]` **beside** the row inside
`div.rowline` (a button inside a button is invalid), handled before
`.row` in the delegated click; `keep()` honours `starOnly`; `#starseg`
is a one-button toggle; `SCOPES` gains `stars` and `suggest()` filters
`buildCandidates()` (the one builder; dom.test.mjs pins it) to starred
players then runs the slate rule; `tdRow(p)` / `statRow(stat,p,pool)`
are the row functions the board and the tray share; `renderTray()` runs
at the end of every `render()` and `renderDrawer()`; `#dcompare` in the
drawer head adds or drops the open player (disabled with a title when
three are in); `[data-untray]` and `#tclear` are delegated on `#tray`.
`board.css`: `.rowline/.star`, `.dbtns/.dcompare`, `.tray/.tcards/.tcard/
.tclear`, `.tray:not([hidden])~footer` clears the footer, phone cards
scroll sideways.

## The interactive football board, phase 2 of 3, 2026-09-29

The drawer. README, "The player drawer: a row is a link". `football-
board.js`: `state.drawer = {id, kind, tab, rung, opener}`; `openDrawer(i,
opener, quiet)` / `closeDrawer(quiet)` / `openById(id, quiet)` (lifts the
twenty-row cut) / `renderDrawer()` (called at the end of every `render()`,
so a filter that removes the row closes it); `pushUrl` writes
`?player=<id>&prop=<view>` (or `?game=`) through `window.history` when it
exists, `syncFromUrl` reads it on mount and on `popstate`; Escape and a
Tab wrap sit on the document `keydown`; the scrim, `#dclose` and
`[data-rung]` presses are delegated on the drawer. The price handlers
listen on both `#app` and `#drawer`. The inline `.why` panel and its
click toggle are gone; rows carry `aria-haspopup="dialog"`. `renderStat`
exposes `app.__ladder(r)` for the ladder tab; the other views set it
null so the tab does not show.

**Data.** `fetch-football.mjs recentRows(games, n, model)` → Map id →
rows dated `YYMMDD`; `boardPlayer` writes `recent` when there are any;
`football-leagues.mjs recentGames` 10 / 5; the fetcher throws over
1000 KB. `nfl.js recentLine / recentValues / recentHits / recentDate` (in
`NEEDS`). Sizes after the rebuild are in the phase-2 commit message.

**After review.** `setUrl(id, kind, replace)`: a gesture pushes, the
board's tidying (row gone under a filter, link to nobody) replaces;
`syncFromUrl` closes quietly before switching views, so a popstate never
pushes; re-clicking the open row does not push; `openById` clears filters
and pins the row (`state.pin`, honoured by `trim`) and restores the board
when the player is on no view; focus returns to the live row
(`liveOpener`); the "/" shortcut is off while the drawer is open; the
mount guard also asks for the drawer markup (an old cached page reads
"Reload this page").

**Tests.** `dom.test.mjs`: the stub window now has `location`, `history`
(records pushes), `addEventListener` (records `popstate`), elements
record `focus()`, the document records listeners; `clickRow()` drives
the delegated row click. Six drawer tests: open/URL/Escape/back/focus,
deep link under the cut, recent-games bars and counts, ladder buttons and
the pressed rung reaching the recent tab, page and stylesheet contracts,
feature detection of `window.history`.

## The interactive football board, phase 1 of 3, 2026-09-29

The user wants the football boards to feel like nhlpropking.com's
projections page (screenshots in `.gstack/browse-reports/2026-09-29-1410/`).
Approved plan in three phases: (1) a typed price with the edge on every
row, team and position filters, sort by projection / edge / boost;
(2) a player drawer with tabs (overview, the ladder as threshold buttons,
recent games as a bar chart from a new compact `recent` array the
fetcher writes) and `?player=<id>` in the URL; (3) a starred watchlist
that feeds the parlay slip and a compare tray. Phase 1 shipped here.

**Why typed, not a feed.** ESPN's keyless core API has NFL game lines but
`propBets` returns 404 for NFL events (probed against TB @ DAL
2026-10-09); `fetch-odds.mjs` (The Odds API) needs a key that is not
configured and cannot afford props for sixteen games on the free tier.
The user chose typing. README, "Typing a price, and what the edge means".

**What landed.** `watchlist.js` (UMD like `bets.js`): `PRICE_KEY`,
`priceKey` (league|player|prop|line; td has no line), `validPrice`,
`parsePrices`, `serialise`; `watchlist.test.mjs`, listed in all seven
gates. `fetch-football.mjs boardPlayer` builds the player row and adds
`pos` off the roster (tested). `football-board.js`: `keep()` is the one
row gate (available, search, team, position); `sortRows()`; `priceEdge()`
through `E.evPct`; the `.px` row cell (`#px<i>`) and the panel's
`.pxin` input (`data-pk`, `data-i`), updated in place by the delegated
`input` handler so the box keeps the cursor; `renderFilters()`. Pages:
`#sortseg`, `#teamsel`, `#poswrap/#posseg`, `#linewrap` inside
`#controls`, which now hides only on the game view. `board.css`:
`.row.priced` six-column grid, `.px`, `.pxrow/.pxin/.pxedge`, phone
rules hide the cell.

**After review.** The price key carries the slate (`league|season-week|
player|prop|line`) and `W.forSlate` keeps only the board's slate, so a
week-4 price is never a week-5 edge; the store getter is inside
try/catch (a browser that refuses storage still renders); teams come
from the players (a bye team is still a choice) and positions are
restricted to `POS_ORDER`; a page without `watchlist.js` renders plain
rows with no price cell; a price committed (`change`) re-sorts when the
order is by edge, a keystroke never does; `edgeClass` is the one colour
rule (`.edge.good/.warn/.bad`), used by the slip too.

**Constraints met.** `.px small` joined the block list; the price map is
only ever indexed by a `W.priceKey` result (dom.test.mjs pins both); the
live tests mount the real script with edge.js and watchlist.js and a
Map-backed `localStorage` on the stub window (`mountPlayers`).

**Phase 2 notes.** The row is a `<button>`, which is why the input lives
in the panel rather than the row (interactive content inside a button is
invalid and would fight the row's click). The drawer inherits that: the
input moves into the drawer. Game-view rows keep the five-column grid.

## The baseball refresh on an off day, 2026-09-29

`Refresh board` failed four times running from 2026-09-28: `fetch-mlb.mjs`
exited 1 on an empty slate, the off day before the Wild Card round, and
the job died before golf, grading and the commit. The fetcher now writes
the empty board (the page reads `D.games || []` and the workflow's sanity
check accepts zero games) and `track.mjs snapshot` records nothing for a
day with no games rather than saving an empty day file. The postseason
has more off days (2026-10-02, between rounds); each would have done the
same. `history/2026-09-27.json` was left `graded: false` by the failures
and the next successful run grades it.

## Availability off the roster, and one passer per team, 2026-09-24

Two things the suggested parlay got wrong on the Thursday board, both
fixed at the source (the fetcher and the one gate) rather than in the
slip. README, "Injuries" and "One quarterback throws for a team".

**Josh Jacobs, suspended, was on the board.** The league injury report
does not list suspensions; the roster's own athlete entry did
(`injuries: [{status: "Out"}]`, status "News"). `parseRoster` now carries
`listed` and `listedAt` -- the athlete's injury entry (not one that says
Active), else his roster group (`suspended`, `injuredReserveOrOut`) --
and `notActive` in `fetch-football.mjs` merges it under the report,
dropping a dated listing he has played through. 76 of 403 week-3 board
players carry a status, 42 ruled out.

**Two quarterbacks on one team, both over their passing yards.** Every
passer with 40 attempts on file had a line. `backupPassers`
(fetch-football.mjs, tested) takes each team's quarterbacks by roster
position and `startingPasser` (nfl.js) names one: not ruled out, most
attempts over the team's last three games this season, then most on
file. The first cut used the last game alone; the review found that in
week 1 that is a week-18 finale where the backup threw (15 of 32 teams
in 2025), and that punters with a trick-play attempt were in the race.
The fetcher marks the rest `backupQB` and `statEligible` gives a backup
no passing line. Board and tracker share the gate. Limits: a mid-week
change of starter is not seen until the next daily build; a quarterback
with no game on file for his new team (Tua at Atlanta) reads as the
backup until he throws one; a Doubtful starter reads as out, as he does
everywhere on the board.

The day's record (`nfl-record/`) already carried the old rows before
kickoff and is left alone: Jacobs settles void on `played`, and the
backups' passing rows grade as the board offered them. First prediction
wins.

## Alternate lines, levelled pools and tendencies, 2026-09-21

Three things landed together; the second was found by the first.

**The ladder.** Every counting prop now carries the book's alternate
lines: `LADDERS` in `nfl.js` names the rungs (10+, 20+, 25+ … 150+ for
the yardage stats, 150+ … 400+ passing, 2+ … 10+ catches),
`ladder(stat, exp, pool)` prices them off the same pool as the projection
line, and "N+" settles as the over of N − 0.5. Rungs outside 2%–98%
(`ladderEdge`) are neither shown nor recorded. The board shows the ladder
in every counting-prop panel (`football-board.js`, `.ladder` in
`board.css`); the tracker records every shown rung on the projection-line
row as `ladder` (rung → chance) — a row per rung was tried first and one
college week came to 7.5 MB, over the 1 MB file limit — settles a rung
off the row's graded `result` with `statTotal`, and prints a per-rung
table (`ladderSummary`, `out.ladder` in the record) apart from the
projection lines; rungs are never parlay legs. `backtest-nfl.mjs --ladder` grades every rung walk-forward and
prints calibration by predicted, by rung and by projection third.

**Rush + receiving yards** is a fifth `STATS` row (`rushrec`): totals
summed (`total` is now a list on every row, `box` a list of pairs;
`statTotal` sums), touches for opportunity, prior 31 NFL / 29 college
(under the measured 35.9 / 34.3 like the others), floor 25, pool floor
**a quarter of the floor** (6.25) in the NFL — NOT rushing's rule: at the
board's floor it ran 3.1pp hot and the walk is monotone (README, "The
rush + rec pool floor") — and **25** in college, which reads the other
way (−0.1pp at 25, −1.6 at a quarter; `cfb.js`). Opponent strength 0
(0.5 read worse). Replay: NFL +0.8pp, Brier 0.2155, seasons −0.3 / +1.8;
college −0.1pp, 0.2280. College inherits the pool shares and they hold
there (receiving 0.2304 → 0.2288, rushing 0.2323 → 0.2297).

**Pools by level — the finding.** The first ladder replay, on one pool
per stat, was calibrated on average and wrong by size: the smallest
third of projections 5–10pp too confident at the middle rungs, the
largest third 7–12pp too timid, every stat. Pools now carry each game's
expectation beside its ratio (`sortedPool` → `{stat, exp, ratio}`,
sorted; `poolKeep` 6,000 most recent; the data files' `pools[stat]` are
this shape now, `stat` included) and `empiricalOver` reads the over off
the share of the pool nearest the player's projection (`poolReads`,
`poolNear`; `poolSize` is the one way to ask a pool how big it is —
`.length` on the new shape is undefined and reads as an empty board).
The share is per stat: **0.5** for receiving, rushing and rush + rec
(better in both seasons on both the line and the ladder), **0** for
passing and receptions (the seasons disagree). Sweep table in
`DEFAULTS` and README "Alternate lines". A flat pool still reads whole,
so an older data file keeps working. The projection-line numbers moved
with it (receiving −0.8 → +1.7pp, Brier 0.2224 → 0.2205; rushing
0.2215 → 0.2186); the README results table is re-read.

The parlay slip's 300-game floor on a counting-prop leg now counts the
games the over was read off (`poolReads`), not the games held; the lift
factors were measured before that and stand (the replay's pools clear 600
within weeks). Rebuild the boards after pulling: the notes above each
prop quote the re-read replay.

**Tendencies.** `nflverse.mjs` gained play-by-play (`loadPlayByPlay`,
gzipped, column-filtered `parseCSV(text, keep)`) and FTN charting
(`loadFtnCharting`, 2022–2026: play action, RPO, screens, motion,
blitzers), team codes translated to ESPN's (LA → LAR, WAS → WSH).
`tendencies.mjs` is the pure module: `profile`, `teamProfiles`, `rank`,
`matchup`, `describe`, `profilesThrough` (walk-forward, regressed toward
last season by K = 6 games, weighted in plays per metric). `node
tendencies.mjs` writes `tendencies-nfl.json` (3.9 MB walk-forward table,
gitignored) and `tendencies-data.js` (105 KB, committed, the current
profiles for the page; the NFL refresh workflow rebuilds it daily and
caches `nflverse/`). Three definitions to know: a dropback is `pass ===
1` (sacks and scrambles included); inside/outside run shares are of the
classifiable runs; any rate under 20 plays is null. College has no
tendencies (cfbfastr has play-by-play; not built).
**Does any of it predict the props?** `experiment-tendencies.mjs`
replays the counting props walk-forward (it reproduces the backtest to
four decimals) with each candidate as a multiplier on the projection at
strength 0 / 0.5 / 1: the defence's yards-per-carry and yards-per-dropback
allowed, pass success rate allowed, explosive-pass rate allowed, pass and
run share faced, plays per game (theirs and the offence's own), the
closing spread as game script, the closing total. **Nothing shipped.**
Full strength is worse than half in 105 of 105 stat–candidate pairs, and
the strength sweep's winners sit at its low edge, which is a signal
drowned in the variance it adds. The one interior optimum is
`defSuccPass` at 0.5 on receiving yards (Brier −0.0004, both seasons,
Δ/SE −2.9) and receptions (−0.0005, −3.6) — the two props that carry no
opponent factor today. That is a quarter of the opponent factor's gain
and would make the board's numbers depend on a daily play-by-play
download, so it is recorded here, not wired in. Re-run it when 2026 is
a full season; if it clears on three, put it in `allow` beside the yards.
Explosive-pass rate allowed at full strength is emphatically wrong
(+0.005 / +0.007, Δ/SE +10 / +14): a defence that has given up big plays
is not one that will. The matchup panel on the game view is descriptive
and says so on its footer.

## College football, 2026-09-05

The NFL stack was split into shared machinery plus a league table, and
college is a second entry in the table:

- `football-leagues.mjs` — the one table: endpoints, files, weeks, model,
  what to call a team that is not in the league.
- `fetch-football.mjs`, `track-football.mjs`, `backtest-nfl.mjs --league cfb`
  — shared. `fetch-nfl.mjs`, `fetch-cfb.mjs`, `track-nfl.mjs`, `track-cfb.mjs`
  are three-line entry points.
- `cfb.js` = `nfl.js` bound to college constants (`bind()`), every one
  measured. Receptions instead of targets (college box scores have no targets).
- `football-board.js` — the page script, shared by `nfl.html` and `cfb.html`.
- `.github/workflows/refresh-cfb.yml` — daily at 12:20 UTC, like the NFL.

Verified before commit: the refactored fetcher reproduces the committed NFL
board byte for byte (bar one real fact it now records: Rams-49ers week 1 is a
neutral site), and the refactored tracker reproduces the NFL week-1 snapshot
exactly. NFL backtest numbers are unchanged for touchdowns; the yards replay
now uses the board's own pool definition and reads −1.2pp where it read +1.0pp
(README, "the yards replay depends on a choice nobody fitted").

**Two defects found in the shared path, both fixed:**
- The season default was `[year-2, year-1]`, so neither board would ever have
  ingested a 2026 game. Now `[year-2, year-1, year]`.
- Player lines were "the latest season on file". With 2026 games flowing in
  that would have emptied the board until week 4 (three-game gate). Now this
  season plus last, so week 1 is last season and the current year takes over
  as it accumulates. Unchanged for week 1.

**Game picks, 2026-09-06.** Both football boards now carry a live line on
every unplayed game and show the side the model likes on spread, total and
moneyline, with EV at the price. `pickGame` in `nfl.js` is the one function
that decides the side. The replay's calibration slope of the cover
probability is ~0 in both leagues (−0.25 NFL, 0.07 college), so
`spreadShrink = 0`: spread picks print at 50% and −4.5% EV. Totals keep
0.31 (NFL) and 0.10 (college, timid end of a 0.44/0.10 split). The
moneyline loses money at the close in both leagues and the page says not to
bet it; the row never ranks by moneyline EV. Picks are recorded pregame and
settled like a book, with closing line value in points; first rows are in
`nfl-record/2026-09-10.json` (48) and `cfb-record/2026-08-29.json` (12).
The pick rows were re-recorded once, within the hour, after the shrink was
measured and before anything was published or graded.

**Reconfiguring the game model, 2026-09-06.** "If the model is losing,
reconfigure it." Nine rating schemes and a bias scan of the closing line,
each season separately (`experiment-lines.mjs`, README "Reconfiguring the
model"). No spread scheme clears a slope of 0.1 on both seasons in either
league; efficiency ratings (yards per play, turnovers) are worse than points
in the NFL and inside the noise in college. The constraint is information,
not configuration: the close already contains everything a box score does.
Nothing shipped from it except the experiment, the team-efficiency lines in
both history caches (`side.stats`), and this paragraph. Next attempts need
data the box score lacks: injuries and QB status before the market moves,
weather, line movement.

**Line movement, 2026-09-06.** ESPN carries open/current/close on every
odds object; both caches now hold the opening line (`game.open`, backfilled
with `--lines`), every pick row records `open`, and the board prints open →
current. Measured over two seasons: the side a line moved toward covers ~50%
at the close in both leagues and 60% at the open for moves of 3+ points; the
model does not predict the move (50%). Real information, spent before it can
be bet. README "Line movement". Nothing in the model changed.

**Injuries, 2026-09-06.** The NFL board reads ESPN's injury report
(`injuriesUrl` in the league table; college's endpoint is empty). Out /
IR / doubtful / suspended players are hidden from the props views and
skipped by the tracker; Questionable is flagged `Q` (59% play); each game's
detail lists hurt skill players. `availability` in `nfl.js` is the one
rule. No game-line change: injury news moves lines within minutes and
there is no report history to test against. The week-1 NFL snapshot,
taken before this, carries rows for players now out; they void at grading.

**nflverse, 2026-09-08.** `nflverse.mjs` + `experiment-nflverse.mjs`: 27
NFL seasons with closing lines and weather, injuries and depth charts since
2009, cached under `nflverse/` (gitignored, 116 MB, `node nflverse.mjs`
fills it). Three findings: the spread model has no information beyond the
line in any era (slope 0.02 over 6,895 games); the totals slope is 0.04
over 27 seasons, so the two-season 0.33 was a window and NFL `totalShrink`
went 0.31 → 0.04 (total picks recorded before 2026-09-08 carry the old
probability; first prediction wins, so they stand as recorded); and
**unders at 15+ mph wind hit 56% in every era since 1999**, points − total
−1.4 at 15–20 mph against +1.3 in calm games. The one bettable bias found
all week. It needs a wind forecast per game, which nothing fetches yet
(Open-Meteo is keyless; stadium coordinates are the missing table). A
missing starting QB moves the line about a point too little (opponent
covers 53.3%, n=345): watch, not bet.

**Touchdown model over 25 seasons, 2026-09-08.** nflverse weekly stats
(`loadWeeklyStats`): constants within a few percent of the shipped ones in
every era, model calibrated within a point everywhere, top decile within
a point. Confirmed, nothing changed. The players file maps nflverse ids
to ESPN ids (418 of 419 board players match), so a last-season
opportunity prior is possible but the two-season line window already
carries last season, so it was not built.

**College over twenty seasons, 2026-09-08.** `cfbfastr.mjs` +
`experiment-cfbfastr.mjs` (cache under `cfbfastr/`, gitignored, 143 MB):
spread slope −0.04 with no era above 0.01, total slope 0.08 (0.11–0.17
recent, matching the shipped 0.1), under at 56+ 52.1% on 5,917 games.
Nothing bettable, nothing changed; cfb.html's copy updated to say so.

**College results** (README has the full section): touchdowns −1.4pp, Brier
0.1743; yards −3.0pp and approximate; spread 51.7% and total 53.4% against the
close on ~1,485 games, inside the noise. The forward record started
2026-09-05 with 1,183 pregame predictions (`cfb-record/2026-08-29.json`).

**Three more counting props, 2026-09-08.** Rushing yards, passing yards
and receptions join receiving yards as one table, `STATS` in `nfl.js`:
total, opportunity, prior, gate, pool floor. `statEligible(stat, rec)` is
the one gate; `yardsEligible` is its receiving row. `fetch-football.mjs`
writes `pools` (one per stat; `yardPool` is gone), `football-board.js`
grows a view per stat from the table, `track-football.mjs` records and
settles all four (`settlePlayer`), `backtest-nfl.mjs` replays all four and
prints each season alone. Passers now enter the players file at the passing gate's own
attempts (`passMinOpportunity`, 40), which also lets them into the
touchdown view; the replay's touchdown population never had a touches
gate, so nothing new is being claimed there. Every threshold a stat's
gate reads is a `DEFAULTS` key named on its `STATS` row, so a league can
bind its own; college inherits the NFL's for the three new props, which
is what was measured.

The pool floor was the finding. Each pool began as receiving's (three
games, expectation at least a quarter of the floor). Rushing ran 6.8pp
cold in the NFL and 8.6 in college on that: under 20 expected rushing
yards the pool is quarterbacks' scrambles and end-arounds. The rushing
pool floor is now **20, the board's own floor**, in both leagues (NFL
+1.2pp, college +0.9). The same rule on passing and receptions made both
worse, so it is not a rule. College passing needed its own floor, **75,
half the board's** (a quarter read −6.1pp; college has a mop-up backup
pool). README "Three more counting props". Passing yards is the prop to
hold loosely in both leagues: too timid at both ends, and the NFL seasons
sit 4pp apart. First rows for the new props are in the record files
dated 2026-09-10 (NFL) and 2026-09-11 (college).

The session before this one was cut off with the code written, the
comment claiming the floors were "chosen on the replay", and the replay
not yet run at those floors (`tasks/lessons.md`, "A comment is not a
measurement").

**The opponent's defence, 2026-09-08, later.** Every counting-prop
projection now carries the opponent: `teamFactors[team].allow[stat]`
from `seasonLines`, applied by `statOppFactor` at a per-stat strength
(`rushOppShrink`, `passOppShrink` 0.5; `yardOppShrink`, `recsOppShrink`
0) inside `statEligible`, which takes a `ctx.oppFactor` and returns
`{exp, base, oppFactor}`. The gate is `base`, the player's own season.
Replay table in `nfl.js` and README "The opponent's defence": rushing and
passing gain a thousandth of Brier at half strength in both leagues,
receiving and receptions nothing or worse. The rows recorded earlier
today for this week carry the pre-opponent projection; first prediction
wins.

**Review fixes on the opponent factor, 2026-09-08, late.** One
`opponentIn(game, player)` (null for a team code on neither side; the
old two-way lookup handed such a player the home defence), one
`allowOf(teamFactors, team, stat)`, and one `projectedStat` that
`statEligible` returns and both pools divide by. Pool membership is the
player's own level again; college's 0.5 column moved to 0.2321 / 0.1779.
`yardsEligible` forwards `ctx`. `dom.test.mjs` now asserts every
`statEligible` caller passes the opponent and both pools divide by
`projectedStat`. The board's own `allowFor` still exists; swap it for
`N.allowOf` when next in that file.

**Design review of the NFL board, 2026-09-08, late.** `/design-review`
(gstack) on nfl.html: fourteen findings, twelve fixed in one commit each
(`style(design): FINDING-NNN`), all CSS or board-script only, shared by
cfb.html. Twenty rows then "Show N more"; board links under the brand,
bet types scroll on phones; caret kept on phones; 44px controls on
touch; the honesty numbers behind a "How it was checked" disclosure; the
odds column dims at the Projection line where every player prices the
same; game rows lead with the side; Q is a tag; badge colours on tokens;
`color-scheme: dark`; prose sizes up a step. Deferred: the five pages'
stylesheets have drifted (golf/baseball/bets forked the boilerplate) and
want one shared board.css, and system-ui as the body face is a taste
call. Report and before/after shots:
`~/.gstack/projects/BetHouse/designs/design-audit-20260908/`. Baseline
design score B−, AI-slop A.

**Parlays on every leg, 2026-09-09, later.** The slip draws on every
kind of leg (touchdowns, the counting props at the line setting, spread
and total), with a "Legs" toggle per kind. `--parlay` replays every leg
the boards offer; the first two measurements were wrong (a "same team"
population that mixed all-one-team with some-share; early-week pools of
a dozen entries reading as 91% overs) and the README table is the third.
Classes in `parlay.js`: none / game / mixed / team / player. Shipped
lifts: NFL `{game:1, mixed:1, team:0.85, player:1.3}`, college
`{1,1,1,1.3}`; `parlayProps` is all seven. Recorded slips carry a `tag`
("td" for the first week's touchdown-only slips, "all" after) in their
key, so both are rows. The slate's top picks cashed 0.55-0.72x on 32
weeks: the top of the board runs hot; no correction fitted.

**Suggested parlays, 2026-09-09.** `parlay.js` (shared, tested:
`combineLegs`, `suggestParlay` with a slate or one-game scope and a
measured lift) and controls on the football boards' touchdown view: 3/4/5
legs, "All games" (one leg per game) or "One game" (a game picker). The
replay (`backtest-nfl.mjs --parlay`, README "Suggested parlays") found
same-TEAM touchdown slips cash ~0.80× the product in the NFL, the
opposite of baseball's same-game intuition; cross-game and mixed-team
about 1. Shipped `parlayLift: {game:1, team:0.85}` in nfl.js, `{1,1}` in
cfb.js; only `td` is parlay-eligible (`parlayProps`). The tracker records
the slips the board would suggest (`day.parlays`, first wins), settles
them from their legs (`gradeParlays`), and the footer shows the parlay
record when there is one. First rows: NFL 2026-09-10, college 2026-09-11.
Not done: manual add-to-slip on football rows, "I bet this parlay" into
the bet log (bets.js legs are keyed for baseball's record), baseball
switching to the shared module.

**Search, 2026-09-09.** A "Find" box on the football boards (`#q` in
nfl.html / cfb.html) filters the touchdown and counting-prop views by
player, team or opponent — `playerMatches` in `nfl.js`, tested: words in
any order, case, dots and accents ignored. A search shows every match,
not the first twenty; the game view hides the box; "/" focuses it. The
baseball board has its own page script and no search yet.

**Rosters, 2026-09-09.** A.J. Brown was on the Eagles' board in week 1
after joining the Patriots: a player's team was the team of his last box
score, which is last season's team until he plays a game. Now every
board build fetches every team's roster (`teamsUrl` / `rosterUrl` in the
league table; college uses its membership ids), `parseRoster` /
`applyRosters` in `nfl.js` put each player where the roster says and
drop anyone on no roster (retired, released, unsigned, graduated).
First build: NFL 137 moved, 93 dropped (430 → 386 board players);
college 344 moved, 2,824 dropped (1,836 → 1,026). A partial roster fetch
moves nobody rather than dropping a failed team's players. The panel
says "now NE — every number here is from his PHI games". The week-1
rows recorded before this under the old teams stay as recorded and will
void at grading (the player is not in that game's box score); the moved
players were re-recorded in their real games the same day.

**One stylesheet, 2026-09-08, late (FINDING-014).** `board.css` holds
what the five pages used to copy; each page keeps only its own rules in
a short `<style>` after the link (baseball 173 lines, bets 84, golf 15,
football 8). Drift reconciled to the football values: title 16px, big
figure 22px, meta 13, note 15, name 15, panel prose 14, segments 14,
golf's row grid 30/74. Proved by diffing computed styles on every page
before and after: only those properties moved. `dom.test.mjs` now reads
the sheet, asserts every page links it and none re-declares its core
rules or `:root`. To change a shared rule, edit `board.css`; to override
one on a page, repeat the selector in that page's block.

**Design review, second pass (baseball, golf, bets), 2026-09-08, late.**
Four cross-page fixes, one commit each (FINDING-015..018): board links
under the brand on every page, 44px touch targets everywhere (the
baseball row's ○ and + were 28px), `color-scheme: dark`, and the caret
kept on phones (baseball's three mobile row grids gained a fifth
column). Baseball's expanded panel is the model the football panels now
follow. Still deferred: one shared board.css.

**Readability pass on the counting props, 2026-09-08, late.** The prop
rows lead with the projection (yards or catches), then the over chance
and fair price; the line sits beside the matchup. A `soft D` / `tough D`
badge shows only where the opponent is applied and the allowance is 7%+
either side of average. The panel is two paragraphs: the decision (over
X hits Y%, fair Z, bet only if the book beats it) and the arithmetic in
plain words (averages, regressed to, opponent adds/takes off, projects
to). No constants on the page; nfl.js and the README carry them. Shot
at 1200 and 390 wide, `.playwright-mcp/` (gitignored). The touchdown and
game views are untouched; the same treatment is owed to them.

## Statcast prior, 2026-09-08

The hitter model's regression centre is now `league + 0.75 × (last season's
Statcast xBA per PA − league)` for the hit rate (`PRIOR_WEIGHT` in score.js;
`statcast/2025.json`, committed; `node statcast.mjs 2025` rebuilds it, and
in 2027 run it for 2026 and the fetcher picks it up by season). Validated
on the forward record via `experiment-statcast.mjs`: better on both halves,
both ways, raw and calibrated, monotone; fits chose 1.0 and 0.75, timid end
ships. Later the same day, same bar: the **pitcher's average allowed is now
regressed by innings** (`PITCHER_K_IP = 80`) toward league + 0.5 × (his xBA
allowed − league), the biggest single gain the model has had (held-out log
loss on hrr 0.6340 → 0.6319); the **TB centre** moves 0.25 of the way to
xSLG per PA; the barrels HR prior did not validate and stays at 0. Runs and
RBI still regress to the league. `statcast/2025.json` holds all of it;
`node statcast.mjs 2026` next winter. Predictions before 2026-09-08 stand
as recorded; the calibration centres were solved on the old raw
distribution and should be re-checked with `node calibrate.mjs` once a few
weeks of the new model's record exist.

## The model was wrong, and was fixed

**2026-08-22.** The MLB probabilities were over-dispersed. Found by the forward
record, not by any backtest — a backtest fits constants to the same history it
then grades, so it could not see this. Predictions under 65% ran +4.79pp cold
(z = 4.32); 65–75% ran 2.86pp hot. A second-order level error on total bases
came from centring the shrink on the model's own mean.

Fixed in `31af014` and `8de1cfb`: `CALIBRATION_SHRINK = 0.8` toward solved
per-prop centres, cross-validated on non-overlapping halves.

**The consequence nobody expected.** Everything in `history/` before
2026-08-22 19:37 PT is the OLD model's record. `track.mjs:173` snapshots the
probability at prediction time and never recomputes, so 23,040 of those graded
predictions belong to a model that no longer exists. It cannot be regenerated:
`score.js:229` records that the centres were solved on 2026-08-02..08-21, the
same window, so re-grading would be in-sample.

**The current model's forward record starts 2026-08-23.**

## What is being measured, and where

| tool | question |
|---|---|
| `track.mjs`, `track-football.mjs`, `track-pga.mjs` | were the published probabilities true? (calibration) |
| `clv.mjs` | does the model predict better than the closing line? (edge) |
| `close-odds.mjs` | freezes the last price before each game starts |
| `backtest*.mjs` | replays history. Fits constants to it, so it cannot grade itself |

`clv.mjs` is the one that decides whether there is a business here.
`track.mjs` says whether the numbers are true; a perfectly true number still
loses money at these prices.

## The arithmetic that constrains everything

Measured hold on 1+ H/R/RBI: **6.96%** (n=180). A correct 66.6% leg into that
gives a per-leg multiplier of 0.9304, so:

- a 3-leg slip of perfectly calibrated legs returns **−15.4%**
- **a hit rate can therefore never be the product.** Anyone can produce one

But parlay EV is `m^n`, and that exponent is leverage. At a 5% per-leg edge the
same 3-leg slip returns **+22%**. Parlays are right if and only if the legs
carry real edge.

**Break-even needs `m >= 0.9839` against today's `0.9304` — a 5.7% relative
improvement over the book's price, per leg.** That is the number the whole
thing rests on, and `clv.mjs` measures it.

**First reading, 2026-08-23, n=170:** model Brier 0.2441, close 0.2399. Paired
t = 0.76, which is noise. The feed prices ~170 comparable legs a day, so an
answer is roughly twelve days out. Do not act before then.

## Watch, do not touch

The recalibrated model ran **cold** on its first day: hrr predicted 66.6%
against 70.8% actual (−4.30pp, n=271), and `clv.mjs` independently showed
44.2% predicted against 47.6% actual. Both are inside noise at this n. Cold is
what over-correction looks like, and the shrink was deliberately shipped at the
timid end. Let n reach the thousands before changing a constant.

The same applies to college: cold on the replay, deliberately left alone.

## Traps this repo has already paid for

All in `tasks/lessons.md`, which is the real list. The ones that bite hardest:

- **A stale checkout reads exactly like a current one.** A session ran 77
  commits behind and reported the odds feed broken, CLV empty, and the new
  model unrecorded. All three were false. `provenance.mjs` exists because of
  this; every analysis tool prints its provenance first.
- **A test wired into a refresher must not assert live data is non-empty.**
  Went red 13 times on quiet days.
- **Every test file must run in all seven gates.** `dom.test.mjs` enforces
  it: `local-check.sh`, `.pre-commit-config.yaml`, `ci.yml`, and the four
  refresh workflows.
- **ESPN serves in-play odds beside closing odds for finished games.** Grading
  against those grades against the answer. College does it too.
- **NFL `spread` is always home-relative** even though `details` names the
  favourite. Trusting the label flips every road favourite.
- **The constants have to describe the population they are applied to.**
  College ran 1.8pp cold until the touchdown coefficients were measured on
  regulars rather than every player-game.

## Housekeeping

- `nfl-history.json`, `cfb-history.json` and `.espn-athletes.json` are
  gitignored (size). Rebuild with `node fetch-nfl.mjs --history` (~1,100
  requests) and `node fetch-cfb.mjs --history` (~3,500).
- `.env` and `.odds-quota.json` stay gitignored.
- Git identity is repo-local: `Dustin Strayer <dstray@dstray.local>`.
- `bash scripts/local-check.sh` mirrors CI exactly. It now runs a freshness
  check first.
- CI does **not** gate main via branch protection; the refresh workflows commit
  straight to it and Pages serves the branch.
- One college game per fetch fails with a warning (`WARNING: 1 games failed to
  fetch`). It has not been identified; it is one game in 1,790.

## What is not done

- **No parlay forward record on the baseball board.** The football trackers
  record the suggested slips since 2026-09-09; `track.mjs` still records
  single legs only.
- `backtest.mjs --fit` still fits `k` against the uncalibrated probability; the
  two layers now interact.
- The parlay suggester cannot say whether it picked 3 from 14 games or 3 from 3.
- No stake is recorded anywhere, so there is no profit and loss.
- Football game lines now have CLV via the tracker. Player props in football and golf still have no odds feed, so no CLV there.
- The college yards replay is three points cold and sensitive to the pool
  definition. Not fitted, on purpose; the forward record decides.
- A receiver with no catches is voided rather than graded under in both
  football records; the hole is bigger in college, where he has no box-score
  line at all.
- The design doc at `docs/designs/bethouse-play-plus-receipt.md` carries one
  open decision: what the page says about the record spanning a model change.
