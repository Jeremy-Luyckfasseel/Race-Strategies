# DESIGN.md

> The look, and the rules behind it. Written down here because it was living in
> one machine's local notes, which do not travel between computers or between
> Claude Code sessions — and the first thing a fresh session does is read the
> repo.
>
> **Read the live values out of `src/index.css` before styling anything.** This
> file explains the intent; the CSS is the source of truth for the numbers, and
> the two have drifted apart before.

---

## The direction: "Carbon Wall Terminal"

A pit-wall monitor, not a dashboard. It should look like software someone uses
at three in the morning to make a decision, not like a product page.

The concrete rule that follows: **the tyre compounds are the loudest colours on
screen, and everything else gets out of their way.** H / M / S / IM / W each have
a fixed colour that never changes meaning, and the eye should find them without
being asked to.

---

## Palette

Read from `:root` in `src/index.css`. As of 2026-09-22:

| Token | Value | What it is |
|-------|-------|-----------|
| `--bg-base` | `#06080F` | The page |
| `--accent` | `#E4002B` | Racing red. The one interactive/alert accent. |
| compounds | `H #4A9EDE` · `M #F08420` · `S #E53535` · `IM #22CC6E` · `W #14BBCE` | Fixed per compound, everywhere |

**Never re-introduce gold (`#FFD700`).** The original build was purple-and-gold
and the whole redesign was to get away from it. (CLAUDE.md described the theme as
gold for months after it stopped being gold — if you find a doc saying gold, the
doc is wrong, not the CSS.)

The accent is also the danger colour in this palette. That is deliberate and it
has a consequence: a full-width accent-bordered bar reads as an **error**, not as
an expanded section. Use it as a left edge or a small fill, not as a frame around
something benign.

---

## Type

Three families, loaded from Google Fonts, each with one job:

| Family | Weights | Used for |
|--------|---------|----------|
| `Barlow Condensed` | 600 / 700 / 800 | Display, section headers, labels, buttons |
| `Barlow` | 400 / 500 / 600 | Body text |
| `Space Mono` | 400 / 700 | **All timing data and numbers** |

The mono family is not decoration: lap times, gaps and fuel figures are read by
comparing digits in the same column position, and a proportional font makes that
harder for no gain.

### One scale per surface

Each screen picks **one label size and one value size** and sticks to them, with
at most **one hero number**. "Big" has to mean "this is the number", not "this
block was written later".

The race strip is the worked example (`.race-strip` in `index.css`): a grid with
fixed tracks — car | stint | laps left | the call | race state — so the eye can
go to the same place twice. It was a wrapping flex row of differently-shaped
blocks before, and it read as scattered even though every piece was fine alone.

---

## Component conventions

- **Inputs are bottom-border only**, never boxed. Professional-software feel;
  do not revert to boxes.
- **Sidebar sections** show a 3px accent left border when open.
- **Strategy cards** carry a proportional stint bar (`.stint-bar` /
  `.cmpd-fill-{id}`), not a row of pill badges — the bar shows the shape of the
  race, the pills only its ingredients.
- **KPI numbers** sit in one bordered grid with internal dividers, not as
  individual cards with their own shadows.
- **The empty state** draws the circuit with an SVG `stroke-dasharray`
  animation. It is the one piece of pure decoration in the app and it earns its
  place by filling a screen that would otherwise say nothing.
- **Overlays** — the onboarding card, the confirm dialog — share one backdrop
  and card treatment. There should be one overlay language, not two.

---

## Rules that come from the room, not from taste

These are the ones worth defending in review, because each was learned by
getting it wrong:

1. **The race screen fits the viewport.** No scrolling. Anything you would miss
   by not scrolling is something you will miss. Strategy and Drivers may scroll;
   the in-race screen may not.
2. **A line that never changes what you do is noise.** The lift-and-coast
   indicator had three states and two of them said "carry on" — only the warning
   is left.
3. **Never state the same number twice on one screen.** "BOX: FUEL · 62" under
   "Box lap 62" makes a screen feel like it is shouting. If the second instance
   carries extra meaning, it is a tooltip.
4. **Label the guess, not the measurement.** "TYRE LIFE / estimated" put the
   word over the one exact number on the panel (laps counted since the pit exit)
   and made the whole block look untrustworthy. The configured life is the
   estimate; say so there.
5. **Say the unit the decision is made in.** "247 laps vs 246" is true and
   unreadable; "47s better" is the same fact.
6. **One order for the tyres, everywhere**: soft → medium → hard → inter → wet
   (`COMPOUND_ORDER` in `src/i18n/strings.js`). Two orders for the same five
   buttons is how the wrong one gets clicked at 3am. Sort a **copy** for display
   — the stored array's order is load-bearing for the engine.
7. **Notices navigate, they do not act.** A toast with five compound buttons in
   it turns one mis-tap into a wrong compound in the stint log and the learner
   for the rest of a stint. Send the engineer to the control that already exists.

---

## Accessibility floor

Not negotiable, and cheap to keep:

- Dialogs: Escape cancels, Enter confirms, focus lands on the confirming button,
  `role="alertdialog"` + `aria-modal`.
- **DOM order matches visual order.** `grid-area` reorders the painting, not the
  reading order — the race strip once read "if you box this lap…" before "next
  action" to a screen reader.
- Animations respect `prefers-reduced-motion`.
- Every string goes through `src/i18n/` — see CLAUDE.md. A hardcoded string is
  an accessibility and a translation bug at once.
