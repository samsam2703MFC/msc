# MySmartCoach

Plan d'entraînement adaptatif — semi-marathon, 10 km, Hyrox, natation.
Implementation of the Claude Design handoff (`Formulaire application`), built as
an installable PWA.

Four screens, entirely driven by the MSC database: **Aujourd'hui** (the day's
session, the journal, and Claude's read of it), **La semaine** (planned vs done,
the seven days, the type legend), **État de forme** (the four load metrics), and
**Coach** (the five real-life reasons a day goes sideways, the detected gap, the
weekly verdict, the adjustments). Full FR / PL.

## Running it

```sh
npm install
npm run dev        # dev server
npm run build      # typecheck + production build + service worker
npm run preview    # serve the build
npm run typecheck
```

On a desktop viewport the app renders inside an iPhone frame, the way the design
presents it. Below 720×940 the frame drops away and the app fills the screen, so
the installed PWA looks like an app rather than a picture of one.

## How it is put together

```
src/
  data/       the MSC database — 18 msc_ tables and the accessor seam
  design/     design-system tokens + the global stylesheet
  state/      the app's state machine
  components/ the frame, the sheets, and the shapes every screen repeats
  screens/    one file per tab
```

**The database is the point.** No screen holds data of its own: paces are
selected out of `msc_zone` for the session's block, labels out of `msc_ui`,
statuses out of `msc_statut`. Screens go through `src/data/db.ts` (`select`,
`one`, `mustOne`, `type`, `ui`) and never import `tables.ts` directly — that
module is the seam a real backend replaces, and it is the only file that has to
change when it does.

The tables were ported one-for-one from the handoff's `msc-db.js`, comments
included, and typed in `src/data/types.ts`.

| Filled how | Tables |
|---|---|
| by the Strava webhook | `msc_activity`, `msc_daily` |
| computed on the backend | `msc_metric` |
| returned by the Anthropic API | `msc_analyse`, `msc_adaptation`, `msc_ajustement` |
| loaded once | `msc_session`, `msc_zone`, `msc_type` |
| by hand, each day | `msc_journal` (RPE + note, on the Aujourd'hui screen) |

## What is simulated

The design is a clickable prototype, and three things in it stand in for
integrations that do not exist yet. They behave exactly as designed — the
buttons work, the states change — but nothing leaves the device:

- **Analyser avec Claude** and **Recalculer le plan** resolve on a timer and
  read their results out of `msc_analyse` / `msc_ecart`. The Anthropic API call
  goes where those timers are, in `src/state/useApp.ts`.
- **Take my data** toggles the Strava source between connected and not. The MCP
  connector goes behind that toggle.
- The two chat bars (Coach, and the one on each session) render but have no send
  handler yet.

Still open from the design conversation, and deliberately not invented here: the
import of `Plan30semainessemi10kmhyroxnatation.xlsx` (the ~245 `msc_session`
rows — the app currently carries the week-3 sample), and the "Données" admin
screen for filling the tables by hand.

## Deviations from the prototype

Four places where the prototype's behaviour was an artefact of the design medium
rather than the intent:

1. **Sheets no longer close on any click.** In the prototype a click anywhere in
   a bottom sheet dismissed it, which would have made the Strava toggle, the
   language switch and the chat inputs unusable. The scrim closes them; Escape
   closes them; the panel does not.
2. **The B1–B4 split bars now have a height.** Their percentage heights resolved
   against an auto-height parent and collapsed to zero.
3. **Interactive elements are real buttons** with `aria-pressed` / `aria-current`
   and focus rings, rather than divs with click handlers.
4. **`circle-help` is aliased to `circle-question-mark`** — Lucide renamed the
   glyph after the design was made. Same icon.

The language choice persists to `localStorage`; the RPE and the note do not,
because they belong in `msc_journal` on a backend rather than in this device's
storage.

## Design system

Tokens come from the Franchise Generation design system that shipped with the
handoff (`src/design/tokens/`, copied verbatim): the cool blue-green neutrals,
navy `#0A1C33` for authority, and the single emerald `#02C9A0` as the only "go"
colour. Archivo for headings, Inter for body, JetBrains Mono for figures.
Icons are Lucide, outline only, 1.75px stroke.
