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

**The database is the point.** No screen holds data of its own — and no screen
holds a pace, because paces are computed. Screens go through `src/data/db.ts`
(`select`, `one`, `mustOne`, `type`, `ui`, plus the engine) and never import the
table modules directly.

## The training mechanic

The plan is not a list of sessions with paces written on them. It is 243
sessions plus **two numbers**, and every pace is derived from those two.

```
référence(bloc) = actuelle − (actuelle − cible) × part(bloc)
allure(zone, bloc) = référence(bloc) + écart(zone)
charge = durée (min) × RPE                     ← Foster's session-RPE
```

**The two references** live on `msc_athlete`: the current 10 km pace
(`ref_actuelle_s`, 312 s/km = 52:00) and the target (`ref_cible_s`, 216 s/km =
36:00). **The four blocks** (`msc_bloc`) each carry a `part` — how far along the
way from one to the other they sit: A 0 · B 0,28 · C 0,65 · D 1,0. **The eight
zones** (`msc_zone`) are offsets in seconds per km from the block's 10 km
reference: Récup +95, EF +75, End. active +55, Marathon +30, Semi +14, Seuil +10,
10 km 0, VMA −10.

That is the whole pace engine. It means the week-5 time trial recalibrates all
thirty weeks by rewriting one field: change `ref_actuelle_s` and every session in
the plan slides with it.

`npm run check:engine` verifies the engine against the workbook cell for cell —
all 32 paces of the "Allures" sheet, the four block references, and the load
formula.

**The adjustment rules** (`msc_regle`) are data, not prose. Each names the signal
it watches, the comparator and the threshold that fires it, and the effect —
so `evaluer(signaux)` runs them instead of a human reading them off a page:

| Si | Alors | Gravité |
|---|---|---|
| RPE du mercredi > 8 | −10 s/km sur la séance suivante | ajuste |
| RPE du mercredi ≤ 6 | +5 s/km | ajuste |
| Dérive cardiaque > 8 % sur la longue | endurance −15 s/km pendant 2 semaines | ajuste |
| FC repos +5 bpm sur 3 jours | semaine allégée, on coupe vélo et Hyrox n°2 | allège |
| Sensation « dur » 2 semaines de suite | décharge anticipée | allège |
| Douleur tendineuse 2 jours de suite | STOP course 5 jours | stop |
| Deux nuits courtes | la qualité devient un footing | ajuste |
| Une séance saute | jamais rattrapée — sacrifice : vélo, Hyrox n°2, nage | ajuste |

Fired rules are shown live on the Coach screen; the block's full pace grid is on
the Semaine screen; the two references are in the settings sheet.

## Reference data

`reference/Plan30semainessemi10kmhyroxnatation.xlsx` is the source of truth and
is committed. `python3 scripts/import_plan.py` regenerates
`src/data/plan.generated.ts` from it — 243 sessions across 30 weeks, with their
phase, block, discipline, type, duration, target RPE, planned load, zones and
the full session prose.

Everything the workbook computes, the app now computes: the four block
references (52:00 → 47:31 → 41:36 → 36:00), the eight zones per block, the
planned load per session and per week. Fractional seconds are truncated rather
than rounded, because that is what the spreadsheet displays — without it block C
comes out 1 s/km fast on every zone.

The four races are in `msc_objectif`: semi 22/11/2026 (1h45–1h52), 10 km
29/11/2026 (46–48), 10 km 14/02/2027 (40–42), and the objective, 10 km
21/03/2027 (36:00–36:30).

| Filled how | Tables |
|---|---|
| by the Strava webhook | `msc_activity`, `msc_daily` |
| computed by the engine | paces, per-session and per-week load, week totals, session status |
| computed on the backend | `msc_metric` |
| returned by the Anthropic API | `msc_analyse`, `msc_adaptation`, `msc_ajustement` |
| imported from the workbook | `msc_session`, `msc_week` |
| set once, per athlete | `msc_athlete`, `msc_bloc`, `msc_zone`, `msc_objectif`, `msc_regle` |
| by hand, each day | `msc_journal` (RPE + note, on the Aujourd'hui screen) |

The app resolves "today" from the real date, clamped into the plan's span. The
settings sheet carries a date control so you can walk the thirty weeks.

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

The seeded `msc_analyse` / `msc_adaptation` / `msc_ajustement` rows are an
example of what the API writes back. They are anchored on session 1052 — the
plan's first quality session, semaine 7, "CAP · Seuil — 5 × 3'" — and their
figures follow the worked example in the workbook's "Suivi & ajustement" sheet.

Still open: the admin screen for creating an athlete and their objectives (today
`msc_athlete` and `msc_objectif` are seeded from the workbook, not editable in
the app), and generating a plan for a *new* athlete — the engine computes paces,
load and adjustments from a plan, but the 243 sessions themselves still come from
the workbook rather than from a generator.

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

The prototype's `msc_zone` also had the block-A threshold pace at 5:12, which is
in fact the 10 km reference pace; the workbook puts the threshold at 5:22. The
engine follows the workbook.

The language choice persists to `localStorage`; the RPE and the note do not,
because they belong in `msc_journal` on a backend rather than in this device's
storage.

## Design system

Tokens come from the Franchise Generation design system that shipped with the
handoff (`src/design/tokens/`, copied verbatim): the cool blue-green neutrals,
navy `#0A1C33` for authority, and the single emerald `#02C9A0` as the only "go"
colour. Archivo for headings, Inter for body, JetBrains Mono for figures.
Icons are Lucide, outline only, 1.75px stroke.
