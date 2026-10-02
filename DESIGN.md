---
# gstack: design-md-format=spec
name: BetHouse
description: A pitch-black board with soft rounded panels, neon-green figures, and solid green or red pills where the model found something.
colors:
  primary: "#FFFFFF"
  on-primary: "#000000"
  surface: "#111111"
  surface-2: "#1A1A1A"
  background: "#000000"
  line: "rgba(255,255,255,0.16)"
  rule: "rgba(255,255,255,0.32)"
  text: "#FFFFFF"
  text-muted: "#C9C9C9"
  accent: "#3DFF5C"
  on-accent: "#000000"
  success: "#3DFF5C"
  warning: "#FFD23F"
  error: "#FF3366"
typography:
  display:
    fontFamily: Bricolage Grotesque
    fontWeight: 700
    fontSize: clamp(1.375rem, 1rem + 1vw, 1.625rem)
    letterSpacing: 0.06em
  body:
    fontFamily: Source Sans 3
    fontSize: 1rem
    lineHeight: 1.5
  label:
    fontFamily: Archivo
    fontSize: 0.75rem
    letterSpacing: 0.1em
  mono:
    fontFamily: Martian Mono
    fontFeature: tnum
rounded:
  sm: 999px
  md: 10px
  lg: 14px
  full: 999px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  2xl: 48px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.md}"
  button-primary-hover:
    backgroundColor: "#FFFFFF"
  input:
    borderColor: "{colors.line}"
    rounded: "{rounded.md}"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
  nav-link:
    textColor: "{colors.text-muted}"
---

# BetHouse

## Overview

**Creative North Star:** a warm, soft board that reads like the reference the user likes: rounded panels and pills, figures in gold, colour where the model found something, because the one thing to remember is that it tells you the truth about the price, and the truth should be easy to spot.
**Product context:** a personal, zero-dependency sports-props board: seven static pages (a home, baseball, NFL, college football, golf, a bet log, a live tracker) where every number is a measured probability with a fair price beside it. Used daily, on a laptop and a phone, before kickoff, by the owner and the friends he sends links to. Peers: nhlpropking.com and the props sites it resembles.
**Mode per surface:** the boards and the drawer Operate; the notes, footers and README prose Read; nothing Persuades and nothing is an Experience.
**Reference sites:** nhlpropking.com/projections (the user's reference for density, the headed table, the stat tile and the drawer).
**Key characteristics:**
- Pitch black, not grey and not navy: the page is a board in a dark room, and the neon green is the light on it.
- Every figure on the site is set in one monospace face, larger than the words around it: numbers are machine output.
- Colour marks what matters: the chance or projection figure is neon green, a pressed control is neon green, and a solid green, amber or red pill with ink text says an edge or a projection well above or below his own rate. Prose, labels and chrome stay white and muted.
- Soft shapes: panels at 14px, buttons and inputs at 10px, pills fully round; hairlines inside panels, no glow.
- A real stat tile in the header: players priced, build time, predictions graded. Never a decorative number.

## Colors

**Strategy:** Loud where it counts. Neon green (`accent`, and it is also `success`) for the brand, pressed controls, stars, a tracked bet, the headline figure in a row (chance or projection), the stat tile, and a good edge; amber and hot red for a warning and a bad edge, and for any measured delta the board prints (a pill, a chip's outline, a band's figure). Pills are solid fills with ink text, never tints. **Team colours** (B2, `teams.js` from `teams-data.js`, ESPN's team lists): a 4px stripe along the top of a home game card (away then home), a faint tint (alpha 0.16) of the team's primary behind the drawer's hero, and a 4px left edge on a tray card. A team colour is a background or a border and never a text colour, so white on near-black keeps its contrast whatever the team. A team whose primary is black (the Steelers, a third of the FBS) paints with its secondary, and with no usable secondary paints nothing; a team with no colour on file gets no stripe, and a card with one side unknown shows the known half beside a transparent one, so a miss reads as a miss and never as a black bar. A game row's drawer tints with the home side. Everything else is white on pitch black.
**Light or dark:** dark, fixed by the use scene: evenings, a phone, a slate to check before kickoff. The light theme exists only in the preview toggle and is not shipped.
The ground is true black (#000000); surfaces lift by lightness alone (#111111, #1A1A1A), and hierarchy on them comes from the two rule weights (a hairline at 12% white, a rule at 28%) and from type weight, never from glow or shadow. `accent` is the brand and the pressed state; it is not an edge colour, so the star and the wordmark are gold and a number never is. `success`, `warning`, `error` are the edge colours the baseball board already taught: over 2% good, at or above zero a warning, below zero bad. They appear on the edge cell, the slip's edge, the tray's edge line and the bet log's won/lost; since 2026-10-02 `success` also marks first place on the cheat sheet (a measured rank, the softest of the field) and `warning` its one-game mark (a sample-size caution), and nowhere else.

## Typography

Four faces, all Open Font License, self-hosted as latin woff2 in `fonts/` (no build step, no third-party request at runtime).
- **Bricolage Grotesque**, display: the wordmark (opsz 96, weight 800, tracked 0.06em, gold), panel titles and player names (opsz 14, weight 600). A grotesque with a burr on it, chosen so the site does not read as a startup.
- **Archivo**, label: column heads, the dateline, control labels, the stat-tile captions, and kickers (a caps label above a heading or a band, such as the drawer's matchup line in `accent` and the card's "Why" and "How he gets there"). 12px, weight 600, normal width, caps, tracked 0.1em, muted.
- **Martian Mono**, every figure: chance, projection, fair price, typed price, edge, rungs, win rates, dates in the log. Tabular numerals always. Chance in a row at 19px weight 600; fair and price at 13px; the stat tile at 30px.
- **Source Sans 3**, body: verdicts, notes, control text, the drawer's prose. 16px, line height 1.5.
Space Grotesk retires; its file leaves `fonts/`. Newsreader for the author's prose was offered as a risk and declined. Scale: labels 12px, small text 13 to 14px, body 16px, row figures 24px, panel titles 18 to 22px, the wordmark 26px, the tile 28px; levels differ by face and weight, not by a step of size. Nothing on the site is set under 12px.

## Layout

One column, max width 1180px, 20px side padding on desktop and 12px on a phone; nothing narrower than 390px ever scrolls sideways. The header is a baseline: wordmark and dateline left, the stat tile flush right on the same rule, a 2px rule with a hairline 3px below it (the ledger's thick-thin signature). Controls sit in wrapping rows of labelled groups; on a phone each strip scrolls inside itself. The table is a grid of 36px rows on desktop and 44px on touch, hairline separators, 10px caps heads over the thick-thin double rule, rank dimmed in the left margin, figures right-aligned; on a phone the matchup and fair columns drop and the price cell stays. Density is deliberate in the table and relaxed everywhere else: 4px base, 8px vertical rhythm, 16px between groups, 40px between sections.

## Elevation & Depth

Flat. The drawer is the one raised surface: it sits on the ground colour with a 1px `line` border and a scrim behind it; on a phone it is a bottom sheet. The compare tray sits on a 1px `rule`. No shadows with zero offset, no glows, no blurred backdrops. A hover is a surface tint (`surface`), never a lift.

## Shapes

Panels (the table, the slip, the tile, the record, a day in the log) at 14px; buttons, inputs, rungs and cards at 10px; tags, chips and pills fully round. The drawer's top corners on a phone at 14px. Bars in the recent-games chart round at the top by 3px.

## Components

- **Row** (`.row`): grid, hairline top border, hover tints to `surface`, focus-visible a 2px `accent` outline, `aria-haspopup="dialog"`. The star beside it is its own button, gold when pressed, muted when not.
- **Segmented control** (`.seg button`): muted text on `surface` with a hairline, 10px radius; pressed is gold with ink text, weight 600; hover lifts the text to paper.
- **Pill** (`.pill`): 10px caps in a fully round capsule, solid: `up` a green fill with ink text and `down` a red fill with white text for a projection ten percent above or below his rate, an outlined grey "steady" between; an edge in the price cell wears the same solid capsule in good, warn or bad.
- **Price input** (`.pxin`): mono, 16px, on `surface` with a hairline; focus border `accent`.
- **Edge** (`.edge`): mono, coloured good, warn or bad; the only coloured text in a row, the slip and the tray, and the arithmetic's edge cell once a price is typed.
- **Drawer** (`.drawer`, 640px on desktop, a bottom sheet on a phone): a player card. The Compare and close buttons sit in a bar (`.dbar`) stuck to the top of the scrolling drawer, so they stay in reach however far the card is scrolled; on a phone (the 760px breakpoint) a downward swipe that starts with the card at its top closes the sheet, as do the scrim and Escape; the side panel on a wider screen keeps its buttons and does not dismiss on a drag. The head is a hero: the matchup as a caps label in `accent` (`.dkick`), the name in display 28px, `position · Model rank #n of N · prop` muted beneath, and the large headshot as a 150px cutout on the right with the team mark under it (110px under 960px). Then the bands (`.dbands`, one surface panel), the first screen as three claims: the headline figure in mono accent 32px with its fair price (`.head`); **why** (`.why`, a `.dwhy` list of at most three sentences with their figures in mono and an accent dot each: his line, then only the terms that moved the number five percent or more: the opponent, the offence, a teammate ruled out whose share the model gave him); the projection against his own rate (`.rate`, up in `success`, down in `error`, steady in text) with the difference in mono; the receipt (`.receipt`, a 3px `success` left border) saying this call was recorded before kickoff, built at HH:MM UTC and graded once the game is final, with a caps link to the record page. The record's aggregate for the prop is not on the card. Then the tabs as a segmented control: **Overview** (the price input and Track button, then `.how`: "How he gets there", the chips with their notes as a `.hows` list and one sentence from the game log), **Alternate lines** (square rungs with the pressed one outlined in `accent`), **Recent games** (square bars, the ones that clear the threshold in `success`, the threshold a dashed `warning` line), **The arithmetic** (the cells, `.dcells`, three columns, two on a phone: caps label, mono value, a muted note; a value that is a measured delta takes `success` above or `error` below, the offence and opponent factors, the regression, and the edge at a typed price in the edge rule's colour, which is a cell only once a price is typed; a factor of one and every count stay in text). A game row's drawer keeps the two marks and no bands.
- **Chip** (`.chip`, from `chips.js`): 11px caps in a hairline capsule, one measured number past a threshold that lives in `chips.js`: `Volume up +34%` (last three games against the ones before), `Red zone 42%` (of the red-zone touches logged for the team's priced players; the note says so), `Snaps 84%`, `Deep 38%`, `Soft D +21%` (the factor the model applies, at the stat's strength). `up` outlined in `success`, `down` in `error`, the rest muted. Up to three on a row under the name (`.who .chips`, one line, the overflow clipped; one chip on a phone), all of them with notes in the card's overview. Never an adjective.
- **Record page** (`record.html`): one `.rec` panel per league (surface, 14px): the replay table, the prose verdict, then the live record and the parlays from the record file, in the footer's small ruled style; figures in mono. Each board's footer is one line with the graded count, the touchdown bias and the link here.
- **Featured strip** (`.featured`, the touchdown view of nfl.html and cfb.html, above the table): the view's five highest chances as `.fcard` buttons, five across on desktop, three on a tablet, a strip that scrolls inside itself on a phone; the header does not count them. Touchdowns only: a counting prop's over at the projection line is a coin flip for everyone, and the record has no band at any other line. Each card: the 32px headshot, the name in display 600 with the matchup muted under it, the chance in mono accent 26px with the prop word beside it, and one measured sentence in body 13px: "at 60–70% the record hit 64% of 120", from the record's own band for that chance. A card whose chance falls in no band with 15 graded calls says so ("the record has under 15 graded calls at 60–70% yet") rather than giving way to the sixth-highest; without a record there is no strip. Not a pick: the model's top five and the record's word on them. A card opens the player's drawer.
- **Teams page** (`teams.html`, `.teams` in a `.game.tscroll` panel): one real table, a row per NFL team from the play-by-play profiles: the mark and abbreviation in display 600 with a 4px edge in the team's colour, then plays a game, pass rate, pass rate over expectation, EPA per play, pass and rush, the offence's family leans as chips, the defence's EPA allowed per play, pass and rush, its blitz rate, and its soft and stout families as chips. Every EPA figure in mono with its league rank under it in 11px caps (pace, pass rate, PROE and blitz rate are styles, sorted but never ranked: "1st" would call a style best); every sortable column's head a button, the pressed one in `accent`, the chip columns' heads plain; the team cell carries the colour edge and sticks to the left while the panel scrolls sideways on a phone, so a row is never anonymous. The caveat under it is the matchup panel's: descriptive, nothing here is in a price. The chips and the ranks come from `tendencies-core.js`, the same copy the board's matchup panel and the builder use.
- **Tray card** (`.tcard`): surface, hairline, name in display 600, the figure in mono 20px, the edge line coloured.
- **Bet log row**: date in mono muted, the bet in body, said and price in mono, won and lost as 10px caps labels in `success` and `error`.
- **Hero** (`.hero`): a surface panel with a fully round accent pill naming the day, a long date beside it in label caps, a display heading at 34px and one measured sentence in body. Nothing else lives in it: the board links sit in their own labelled strip (`.bstrip`) beneath, as `.btn` links, so the panel is only about the day. One per page, the home only.
- **Game card** (`.gcard`): surface panel at 14px; league and start time in label caps on the top line; the two teams as logo, abbreviation in display 20px and, for football, the projected points in mono accent; a hairline, then two labelled mono values (favourite and pick, or pitchers and lineups) and an `Open →` link in accent caps. Finished games at 70% opacity.
- **Home cheat-sheet strip** (`#cheatsec`, `.scard.mini` in the `.sheet` flow): one compact card per NFL game on the NFL slate (today's games, or the next day that has any, and the heading names the day), four lines a card: each side's single best line, then the rest by rank, so one side's run of first places cannot push the other off and a fifth place never displaces a first except to keep a side on; each line prefixed by a `D` or `O` pill in 10px caps (the defence muted, the offence in text) before the rank pill; the line and head markup are the sheet card's own functions, so a line prints identically on both; a muted caps count of the lines cut under the list, since the card shows fewer than the pages. The heading carries the field from the sheet, which lines rank from the fewest, and the two page links once. Hidden entirely when there is no NFL game, no sheet or nothing in the top five.
- **Top card** (`.tops .card`): the game card's surface and corners with a caps label, the figure in display 20px beside a mono accent number, a muted line and an `Open →` link; the two football tops wear their game's 4px two-colour stripe along the top, the tracker's top none.
- **Cheat sheet card** (`.scard` in a `.sheet` column flow, on `defence.html` and its twin `offence.html`, two columns on a desktop and one on a phone, since the cards differ in height and a grid would leave a gap beside a tall one): the game card's surface, corners and 4px two-colour stripe; a head with the two marks and abbreviations in display 600, away `@` home, and the kickoff in mono muted; then a list (`.slines`) of the lines where either side (the defence that allowed it, or on the twin the offence that did it) ranks in the top five, merged by rank: a rank pill in 10px caps (`MOST`, or `FEWEST` where the soft end is the fewest, in `success` outline for first place; `2ND` to `5TH` plain), the defence in display 600, the stat in muted body with `of N` in 10px muted caps when the line was ranked among fewer than the field, the value in mono 600 at the right, with `1g` in 10px `warning` caps before a line from a single game. Colour marks the first place and the one-game caution only; a 32nd-ranked team has no line. The caveat under the grid names the field, the window and what the model takes from that side (a defence's allowances; an offence's touchdown rate and rating), and differs by side; a page names its side and refuses the other's sheet.
- **Logo** (`.tlogo`): 44px (36px on a phone), `object-fit:contain`, from ESPN's CDN with no referrer, hidden if it does not load. The home's game cards.
- **Headshot** (`.face`): a 44px disc on `surface-2` (28px on a phone, where the rank number is hidden to give the name its room) with the player's photo `object-fit:cover`, cropped to the top; a 150px cutout (no disc) in the drawer's hero, 32px on a tray card, 40px on a live card, 24px on a slip or bet-log leg. Between the rank and the name in every row. ESPN's headshots for football and golf (sized by ESPN's combiner, ~8 KB), MLB's for batters; `alt=""` since the name is beside it; lazy, no referrer, hidden when it does not load so the empty disc stays and the row keeps its shape. Never a silhouette.
- **Team mark** (`.tmark`): a 22px logo before the team's abbreviation in the matchup cell (both teams), 28px beside the drawer title, 20px in a baseball team header, 18px on a live card and a bet-log leg; two 20px marks in a game row's face cell. ESPN's, sized to 80px by the combiner (~3 KB); college keyed by ESPN's numeric team id from the game, so a team with no game on file has no mark and no gap.
- **States**: disabled at 50% opacity with the cursor default; empty states in body text on the ground, no illustration; loading is the same empty panel with the one sentence it has today.

## Do's and Don'ts

- Do set every number in Martian Mono with tabular figures, including inside prose.
- Do keep colour to neon green on the headline figure, pressed controls and stars, and a solid green, amber or red pill that reports a measurement.
- Do put tables, the slip and the record in rounded panels; hairlines only inside them.
- Do keep rows at 60px on desktop and 56px on a phone with names at 16px and the headline figure at 24px.
- Do show only measured numbers in the stat tile: players priced, build time, predictions graded.
- Don't add a card inside a card, a glow, or a soft gradient; the game card's two-colour stripe is two solid halves.
- Don't colour a number that reports nothing measured; green and red mark a delta the model computed, and never a text colour from a team.
- Don't put an icon in a circle beside a heading. A kicker above one is fine when it names what the block is.
- Don't add a mascot, a drawn illustration or a placeholder silhouette. The images the site ships are player headshots and team logos from the leagues' own image services, at the sizes the Headshot and Team mark components fix, and nothing else.
- Don't let a page carry its own `:root` or redefine the shared classes; everything lives in `board.css`.

## Motion

- **Approach:** minimal-functional
- **Easing:** enter(ease-out) exit(ease-in) move(ease-in-out)
- **Duration:** micro(50-100ms) short(150-250ms) medium(250-400ms) long(400-700ms)
- **The one authored moment:** the drawer sliding in from the right (or up, on a phone) over 250ms ease-out; everything else changes in 150ms or not at all.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-10-02 | The cheat sheets on the home | The user asked for the sheets on the home. Not the full lists (twenty lines a game would bury the slate) but a strip: one compact card per NFL game, both sheets' top four lines merged by rank with a D/O tag, from the same module as the pages, with links to them. |
| 2026-10-02 | The defensive cheat sheet | The user liked a reference sheet (one card a game, each defence's most-allowed lines with a rank badge) and asked for one. Built on the game card's primitives rather than a new table: the stripe, the marks, a rank pill in the chip's shape. Kept the reference's two honest ideas, the rank out of 32 and the one-game mark, and left out the rest; the caveat says a soft spot is a place to look, not a price. |
| 2026-10-01 | The vacated share on the card | A model term that ships (A4: a teammate ruled out leaves his share to those still in) gets the same two surfaces every term has, a why sentence and an arithmetic cell, and only on a row it moved; it names who vacated, since the sentence is unreadable without him. Nothing on a prop whose strength is 0. |
| 2026-10-01 | Colour beyond the figure (B6) | The plan's last taste change: green and red on any delta the model computed, used in the arithmetic cells (the two factors, the regression, the edge at a typed price) and nowhere a number reports nothing measured; the home's football tops take the game cards' stripe; the notes above the views lead with the inputs. The opponent cell on a counting prop now prints the applied factor, as the chip and the why band do, so one number for the opponent appears on every surface. |
| 2026-10-01 | The teams page (B5) | The plan's B5: the matchup panel's numbers for every team on one sortable page, with the mark and the colour edge. The arithmetic the board had re-typed from tendencies.mjs (two thresholds, the family table, the rank) moved into tendencies-core.js, loaded by nfl.html and teams.html and imported by the builder, so there is one copy and the drift test became a no-copy test. |
| 2026-10-01 | The featured strip (B4) | The plan's B4: the view's five highest chances above the table, each with the record's own figure for that chance band. Adopted from the reference's "King's Men" only the placement; the content is the model's top five and the tracker's calibration band, never a hand-picked list, and the strip is absent without a record. |
| 2026-10-01 | Team colours, kickers and measured colour (B1/B2) | The user asked to break free of the taste rules while keeping the honesty rules. Loosened: a team's colours may appear as a stripe on the home's game cards, a tint behind the drawer's hero and an edge on a tray card (`teams.js`, from ESPN's team lists, never on text); kickers are allowed; green and red may mark any measured delta, not only the headline figure; the head-label test pins the first two columns and that every figure column has a head, not the exact words. Kept: the 56ch measure on the note. The plan said lift it to 72ch, but this file's own measurement is that 72ch is 93 characters on this face, past the 75-character limit the test cites; longer copy goes in more paragraphs, not wider lines. |
| 2026-10-01 | The card says why; the audit moves one click away | The user put nhlpropking.com's card beside ours and said the board carries too much text to tell why one player is a favourite. The reference is not less data; it answers one question per surface and keeps the rest a tab away. So the card's first screen became three claims (the chance, a why band of at most three measured sentences, the rate band), the receipt shrank to this call's own facts with a link to a new record page, the nine cells moved to a tab called The arithmetic, the overview gained chips with notes, rows wear up to three chips (chips.js, thresholds in one place), the parlay strip went behind one button, and the replay and live-record tables left both football footers for record.html. Nothing measured was removed. |
| 2026-09-29 | The player card in the football drawer, with a receipt band | The user showed nhlpropking.com's player card. The drawer's head became a hero (matchup label, name, rank, the photo as a cutout), the overview a grid of labelled cells with the same numbers the old table carried, and three bands above the tabs: the headline figure, a receipt, the projection against his own rate. The receipt was declined at the first consultation ("no receipt metaphor"); it is adopted now because it states only measured facts: recorded before kickoff, how many calls of this prop the record has graded, their bias. Nothing about odds movement: there is no feed for a player's price. |
| 2026-09-29 | Player headshots and team marks throughout | The user showed nhlpropking.com's board: a headshot between the star and the name on every row. Every row on the four boards, the football drawer, the compare tray, the slip legs, the live cards, the bet-log legs and the baseball team headers now carry the player's photo and the team's mark from the leagues' own image services (ESPN's combiner for football, golf and logos; MLB's photo service for batters), through one module, faces.js, that fixes the markup: lazy, no referrer, a fixed box, hidden on error. The no-images rule becomes a no-illustration rule. |
| 2026-09-29 | A home with the slate, and team logos | The user showed nhlpropking.com's home and asked for it: a hero for the day, game cards with logos and the model's favourite, tops. Chosen with the user: the root becomes the home (baseball moves to baseball.html), logos load from ESPN's logo CDN rather than being committed or replaced by coloured chips, the slate covers every board with games today. The logo is the one exception to the no-images rule; it is sent without a referrer and hidden on error. No team colours and no gradients: the reference has them, this design does not. |
| 2026-09-29 | Type one step larger, labels uncondensed, greys lighter | The user asked for text that is easier to read. Every size under 18px went up one step (10 to 12, 11 and 12 to 13, 13 to 14, 14 to 15, 15 to 16, 16 to 17), body to 16px, the labels dropped the 87.5% condensing and loosened from 0.14em to 0.1em, and muted text went to #C9C9C9 (14:1 on black). Rows still 60px; nothing scrolls sideways at 390px. |
| 2026-09-29 | Neon green, solid pills, white text | The user saw the gold on black and asked for colour that pops; of three mocks on the real board (amber, lime, cyan + gold) they chose the lime and asked for a truer green. Accent and success are one neon green (#3DFF5C), warning #FFD23F, error #FF3366, text pure white, and the pills went from faint tints to solid fills with ink text. |
| 2026-09-29 | Pitch black and a brighter gold | The user saw the warm black on the live site and read it as faded. The ground went to #000000, the surfaces to neutral greys, the hairlines up a few points so panels still read, and the accent from #D9A441 to #FFC53D. Ink on the accent stays black; every figure on black now clears 12:1. |
| 2026-09-29 | Softer: rounded panels and pills, gold figures, a vs-rate pill | The user saw the ledger and asked for the reference's feel: bubblier, softer, bigger text, colour that marks good picks. Shapes went to 14 / 10 / round; the chance and projection figures and pressed controls took gold; a pill under each matchup reports the projection against his own rate (the boost ratio the sort computes), green past +10%, red past −10%. Still nothing narrative. |
| 2026-09-29 | Gold on a tracked bet (baseball `.trk[aria-pressed]`) | The tracked and add-to-slip buttons sit side by side on one row and must not look alike; gold already means "yours" on a starred player, so a tracked bet takes it too. Still never on a number. |
| 2026-09-29 | Initial design system created | Created by /design-consultation from the product context and the user's reference (nhlpropking.com), with one outside voice (a Claude subagent; Codex unavailable). Adopted from it: mono figures everywhere, ledger rules, colour as a semantic. Departed: gold accent (the user's ask) over lime; no receipt metaphor in the drawer. Risk 3 (serif prose) declined. |
