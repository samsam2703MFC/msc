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
npm run server     # the plan server — needs ANTHROPIC_API_KEY, see .env.example

npm run check:engine   # paces against the workbook, cell for cell
npm run check:plan     # the generator against its own rules
npm run check:strava   # the session ↔ activity matcher against the real plan

npm run strava:webhook -- etat      # the push subscription, see « Strava »
```

`npm run server` and `npm run strava:webhook` read `.env` if there is one, so
copying `.env.example` is enough — no export needed.

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

## Generating a plan for a new athlete

The workbook plan is one athlete's. The **Créer** screen encodes a profile —
name, the two 10 km references, the start date — plus objectives and
constraints, and builds a plan from them. `src/data/generateur.ts` does it, in
one pure function, with no network:

```
périodisation inverse   the plan is counted back from the main objective's date;
                        each intermediate race closes a block
référence de bloc       a block's 10 km reference is the target of the race that
                        ends it, converted to a 10 km equivalent by Riegel
                        (T2 = T1 × (D2/D1)^1.06) — a half-marathon pace is not a
                        10 km pace, and treating it as one makes the block far
                        too easy
                        checkpoints use the middle of their target range; the
                        main objective uses the fast end
volume                  +6 %/semaine inside a block, ×0,80 every fourth week,
                        ×0,55 on a race week, never below the athlete's floor
                        except on race weeks
qualité                 one quality run a week, never within 48 h of another hard
                        run; the long run sits three days after it, and the day
                        before a race is rest
planchers               the weekly hours floor and the per-run km floor both hold
```

`npm run check:plan` generates the plan for the workbook's own athlete and
asserts the rules hold. It also prints the block references it derives against
the ones the workbook hand-set:

| Bloc | Généré | Classeur |
|---|---|---|
| A | 52:00 | 52:00 |
| B | 47:00 | 47:31 |
| C | 41:00 | 41:36 |
| D | 36:00 | 36:00 |

Within 36 seconds on a 10 km, from the race targets alone — the periodisation
model reproduces the workbook rather than approximating it.

Anything the generator has to bend is surfaced, not swallowed: a block too short
to train is folded into the one before it, and the screen shows what happened.

## The methodology service

The generator produces the skeleton — dates, blocks, volumes, placement. What
each session actually *is* comes from Claude, through `server/methode.mjs`:

1. **recherche** — `claude-opus-5` with adaptive thinking and the web search
   tool, reading current endurance-training guidance for this athlete's shape of
   problem, and citing what it used.
2. **synthèse** — the same model with a Zod-validated output format, turning the
   brief into the strict object the generator consumes.

The split matters: **Claude never sets a pace, a volume or a date.** It is given
the computed zones and writes prescriptions against them by zone name. Everything
numeric stays in the deterministic half, where `check:engine` and `check:plan`
can assert it.

> **The API key never reaches the browser.** A key in a PWA bundle is a key
> anyone can read and spend, so it lives in `server/`, and the app calls that.
> Copy `.env.example`, set `ANTHROPIC_API_KEY`, then `npm run server` alongside
> `npm run dev` — Vite proxies `/api` to it. Without a key the server answers
> 401 with what to do about it, and the rest of the app is unaffected: the plan
> still generates, because generating it needs nothing.

## Linking Strava

The plan knows what the athlete was *supposed* to do. Strava knows what they
actually did. `server/strava.mjs` and `src/data/strava.ts` join the two.

It is a direct OAuth integration rather than the MCP connector the prototype
mentioned, for a plain reason: an MCP connector is something *Claude* uses to
reach a service. This is the *app* needing the athlete's own activities, on its
own screens, with no model in the loop — so it needs its own authorisation, and
Strava's is OAuth 2.

**The seam is the same one the methodology service draws.** The server does the
half that needs a secret and a network; the app does the half that needs the
plan:

```
server/strava.mjs     OAuth, the token and its refresh, the fetch, the webhook
                      → returns aggregates. Knows nothing about blocks, zones,
                        sessions or paces
src/data/strava.ts    which session an activity was, and what that makes of it
                      → the plan lives in the browser, so the matching does too
```

That division is why there is only ever one copy of the plan. It is also why
the token never appears in anything the browser can read: `/api/strava/etat`
returns the athlete's first name and when the last sync ran, and nothing else.

### The three moving parts

1. **The link.** The settings sheet asks the server for an authorisation URL
   and opens it. Strava's consent screen is on Strava's origin, so the popup is
   opaque to us — the app watches `/api/strava/etat` for the token appearing
   instead of trying to read the window. Scope is `read,activity:read_all`:
   private activities included, because a training log with the private
   sessions missing is a training log with holes in it. Nothing is ever
   written back to Strava.
2. **The sync.** One pass over the plan's whole span — about 250 activities
   across thirty weeks, which is three requests against a quota of a hundred.
   A rolling window would cost more round-trips than it saves. Laps are a
   separate request each, so they are fetched only for the quality runs of the
   week on screen.
3. **The webhook.** Strava pushes an event when an activity lands. It must be
   answered in under two seconds, so the server records that something happened
   and does nothing else; the app asks its own server once a minute — a local
   request, costing no quota — and only then spends a Strava one. An athlete
   revoking access from Strava's side arrives the same way, and the server
   drops the token on the spot.

   Strava does not sign its deliveries, so anyone who learns the callback URL
   can post to it. An event that does not name the athlete whose token we hold
   is dropped: recording it would spend their quota on a sync, and honouring
   its revocation flag would throw away a token that is still good.

### Matching an activity to a session

`apparier()` is the only part of this with a right answer, and `npm run
check:strava` holds it to the real plan:

| | |
|---|---|
| same day, always | in the athlete's own timezone (`start_date_local`) — a 22:00 run in Paris is not tomorrow's session |
| never across days | a Sunday long run moved to Monday is a session missed *and* a session done; the Coach screen has rules for exactly that, and guessing here would hide the gap |
| best fit by duration | a 20-minute jog in the morning and 68 minutes of threshold in the evening: the threshold session goes to the threshold run, not to whichever came first |
| each session once | whatever is left over is *orpheline* — shown as a count in the settings sheet, not swallowed |
| paces only on runs | a swim carrying "4:56/km" would be a lie |

The per-interval splits of a quality session are a heuristic, and named as one
in the code: the laps of a structured session fall into two groups separated by
a wide gap in pace, so the widest gap in the sorted lap paces is the split.
Requiring that gap to be real (15 s/km) is what stops a steady run from
reporting its faster half as intervals. A session run without pressing lap
gives nothing back — which is the honest answer rather than a fabricated one.

### Setting it up

1. Create an application at <https://www.strava.com/settings/api>. Set its
   Authorization Callback Domain to `localhost` for development. Since June
   2026 the standard developer tier requires an active Strava subscription on
   the account that owns the application.
2. Copy `.env.example` to `.env` and fill in `STRAVA_CLIENT_ID`,
   `STRAVA_CLIENT_SECRET` and a `STRAVA_VERIFY_TOKEN` you invent.
3. `npm run server` alongside `npm run dev`, then **Take my data** in the
   settings sheet.

The webhook is the one part that cannot work from a laptop: Strava validates
the callback URL synchronously, from the internet, when the subscription is
created. So it is a deployment step rather than a startup one, and it lives in
its own script:

```sh
npm run strava:webhook -- abonner https://exemple.tld/api/strava/webhook
npm run strava:webhook -- etat
npm run strava:webhook -- desabonner 123456
```

Without a subscription everything still works — the settings card says *synchro
manuelle* instead of *webhook actif*, and syncing is a tap.

> **The client secret never reaches the browser**, for the same reason the
> Anthropic key does not. The athlete's tokens live in `.strava.json` (0600,
> gitignored) so a server restart does not cost them another trip through the
> consent screen. Without `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET` the
> server answers 501 with what to do about it, and the rest of the app is
> unaffected.

Strava answers every request with what is left of the quota, and the server
reads it: it stops before a 429 rather than after one, and the numbers are on
`/api/strava/etat`.

## The coach

The generator writes the plan and the sync says what was done. This is the part
that says what it *meant*: `server/coach.mjs`, behind two routes.

```
/api/analyse   « Analyser avec Claude » on the Aujourd'hui screen
/api/coach     the two chat bars — the Coach screen's, and one per session
```

**Strava's MCP server is attached to both calls.** That is the piece the app
could not do for itself: the sync keeps aggregates — duration, average pace,
heart rate, the work blocks — because that is all `msc_activity` needs and all
the pace engine computes against. A coach reading a session back wants more
than that, and `mcp.strava.com` is where more lives. So the call carries what
the app already knows, and Claude can go further when it needs to.

```js
mcp_servers: [{ type: 'url', url: MCP_STRAVA, name: 'strava',
                authorization_token: <le jeton de l'athlète> }],
tools: [{ type: 'mcp_toolset', mcp_server_name: 'strava',
          default_config: { enabled: false },      // allowlist
          configs: { list_activities: …, get_activity_performance: …,
                     get_activity_streams: … } }],
```

The allowlist is three tools out of eight. Claude has no business reading the
athlete's clubs or their gear to say how Wednesday's threshold went, and a list
of what is allowed ages better than a list of what is not.

The token is the one the OAuth half already holds, fetched by the route — never
taken from the request body, which the server strips. A browser that could name
its own credential would be a browser that could borrow someone else's.

Whether Strava's MCP server accepts that token is not knowable from here: it
may run its own authorisation server, in which case a Strava API token is not
its currency. So the call is made twice at most — once with the server
attached, once without — and the answer is poorer without the streams, not
absent. Everything the app synced is in the prompt either way.

### Claude still does not produce a figure

The same line that runs through the methodology service runs through here, one
level down. Every number on the analysis panel is computed by
`src/data/analyse.ts` from `msc_activity`, `msc_journal` and the engine:

| Figure | How |
|---|---|
| dérive B1 → Bn | last work block minus the first, from the laps |
| allure | the mean of the work blocks against the block's zone — an interval session is judged on its intervals, not on an average that includes the warm-up |
| RPE | what the athlete logged, against the plan's target |
| charge | Foster's session-RPE, against what the week budgeted |

Claude is handed those and cites them. What it writes is the verdict, what went
well, what to watch — and an adjustment expressed as **a zone and a fraction of
the planned duration**, never as minutes and a pace.

`appliquerAdaptation` turns that back into a line, and it is the guard rail:

- a zone the engine does not know falls back to the session's own;
- so does a zone *faster* than planned — an adjustment after a hard session
  protects, it does not sharpen, and deciding when to go hard is the plan's job;
- the fraction is clamped to [0,5 · 1] — never longer than planned;
- a session the plan writes no zone on (Hyrox, a swim, a ride) gets a duration
  and no pace at all, for the same reason a swim carries no pace anywhere else.

Between those, a model cannot put a number on this screen. It can only choose
among the ones the engine is willing to compute — and `check:strava` asserts
each rule, including the ones that fire when Claude answers badly.

### Why OAuth *and* MCP

They are not the same job, and the split falls where the model belongs.

|  | the sync | the coach |
|---|---|---|
| what | fills `msc_activity` | reads a session back |
| how | Strava's REST API, `server/strava.mjs` | Strava's MCP server, via the Messages API |
| why not the other one | MCP is request-scoped — Claude connects during a call, so nothing pushes, and the webhook would disappear. And a model transcribing numbers the pace engine then computes against is a non-deterministic step in a path `check:engine` asserts to the second. | The REST aggregates are what one sync happened to keep. The coach wants the shape of the effort inside the session and the weeks before it. |

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
| by Strava, for real | `msc_activity` — synced on link, on demand, and on the webhook |
| still to come from a wearable | `msc_daily` (resting HR; Strava does not carry it) |
| computed by the engine | paces, per-session and per-week load, week totals, session status |
| computed on the backend | `msc_metric` |
| returned by the Anthropic API | `msc_analyse` + `msc_adaptation` for a session, for real; `msc_ajustement` still seeded |
| imported from the workbook | `msc_session`, `msc_week` |
| set once, per athlete | `msc_athlete`, `msc_bloc`, `msc_zone`, `msc_objectif`, `msc_regle` |
| by hand, each day | `msc_journal` (RPE + note, on the Aujourd'hui screen) |

The app resolves "today" from the real date, clamped into the plan's span. The
settings sheet carries a date control so you can walk the thirty weeks.

## What is simulated

The design is a clickable prototype, and one thing in it still stands in for an
integration that does not exist yet:

- **Recalculer le plan** resolves on a timer and reads its result out of
  `msc_ecart`. It is the weekly half of the coach — the same shape as
  `/api/analyse`, over a week instead of a session — and it is the next thing
  to wire.

**Analyser avec Claude** and the two chat bars are no longer among them — see
« The coach » above. The analysis writes a real `msc_analyse` row through
`db.setAnalyse`, and each chat bar keeps its own thread.

**Take my data** is no longer one of them either — see « Linking Strava » above. The
card has six states now instead of a boolean, because a boolean could only say
"connected" and mean nothing by it. Unlinking puts the seeded example activities
back, so the prototype still has something to show without a Strava account.

`msc_daily` — resting heart rate, which two adjustment rules watch — stays
seeded: Strava does not carry it. It needs the wearable, not the platform.

The seeded `msc_analyse` / `msc_adaptation` / `msc_ajustement` rows are an
example of what the API writes back. They are anchored on session 1052 — the
plan's first quality session, semaine 7, "CAP · Seuil — 5 × 3'" — and their
figures follow the worked example in the workbook's "Suivi & ajustement" sheet.

Still open: the generated plan is previewed on the Créer screen but not yet
persisted — the rest of the app still reads the imported workbook plan. Wiring
"generate" through to `msc_session` is the next step, and it needs a decision
about what happens to the journal and analyses attached to the plan being
replaced.

The methodology call has been written against the documented API surface but not
executed end to end here — this environment has no Anthropic credential, so the
401 path is tested and the success path is not. The two coach routes are in
exactly the same position, with one more unknown on top: whether Strava's MCP
server accepts the token, which is why they fall back rather than assume.

The same caveat applies to Strava, and to the same extent. There is no Strava
application behind this checkout, so what has actually been exercised is every
route the server exposes (health, state, the authorisation URL, the webhook
handshake with a good and a bad verify token, an event POST, and the 409 / 501 /
400 paths) and the matcher, against the real plan, in `check:strava`. What has
not is the round-trip through Strava's own consent screen and the shape of a
live activity payload.

## Deviations from the prototype

Five places where the prototype's behaviour was an artefact of the design medium
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
5. **The Strava source is OAuth, and the coach is MCP.** The prototype labelled
   the single channel `MCP`. It turned out to be two jobs: the app filling
   `msc_activity` on a webhook, with no model in the loop, needs its own OAuth;
   Claude reading a session back wants Strava's MCP server. Both are wired, and
   « Why OAuth *and* MCP » above says which does what.

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
