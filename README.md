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
npm run check:db       # the round trip through MySQL, and its guard rails
npm run check:api      # the API over HTTP, cookie and access control included
npm run check:app      # the app itself, in a real browser

npm run db:migrate     # create the database, apply db/schema.sql, add later columns
npm run db:seed        # load the workbook into it
npm run compte -- lister          # the accounts, and who sees which athlete
npm run compte -- role <email> coach   # opens the back office: Athlètes, Réglages
npm run strava:webhook -- etat      # the push subscription, see « Strava »
```

`npm run server` and `npm run strava:webhook` read `.env` if there is one, so
copying `.env.example` is enough — no export needed.

On a desktop viewport the app renders inside an iPhone frame, the way the design
presents it. Below 720×940 the frame drops away and the app fills the screen, so
the installed PWA looks like an app rather than a picture of one.

## How it is put together

```
db/           the MySQL schema — 37 tables, and its own README
server/       the plan server: the secrets, Strava, the coach, the database
src/
  data/       the seam — the live tables, the accessors, the engine, the API client
  design/     design-system tokens + the global stylesheet
  state/      the app's state machine
  components/ the frame, the sheets, and the shapes every screen repeats
  screens/    one file per tab
scripts/      the checks, the plan import, the database migrate and seed
```

**The database is the point.** No screen holds data of its own — and no screen
holds a pace, because paces are computed. Screens go through `src/data/db.ts`
(`select`, `one`, `mustOne`, `type`, `ui`, plus the engine) and never import the
table modules directly. That seam is why the move to MySQL is one file's worth
of change rather than forty screens': it was built for it.

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

### Saving it

**« Enregistrer et activer » writes the plan into `msc_session`,** and the app is
on it from the next reload. `POST /api/plan` → `depots.enregistrerPlan`, one
transaction: `msc_plan` (origine `genere`, active), its blocks, its weeks, its
sessions and their zones, and the objectives — each one finding or creating the
athlete's competition, so regenerating a plan does not seed duplicates in the
back office.

Two things the server refuses to take from the browser even though the browser
sent them: **the load**, which is `duree × RPE` and is therefore derived, and
**the weekly totals**, which are the sum of the week's sessions. The generator's
own numbers for those would be a second truth, and `check:db` asserts the server
wins — no session where `charge <> duree_min * rpe_cible`, no week whose hours
disagree with its sessions.

**The plan that was active is deactivated, not deleted.** That is the whole
answer to the question this README carried open for a long time: nothing is
lost. The old plan keeps its sessions, and the journal entries and activities
that point at them keep pointing. `check:db` writes a real generated plan next
to the workbook's, checks the workbook's 243 sessions are still there, and rolls
the whole thing back.

The button says what it replaces **before** it is pressed — how many sessions,
between which dates, and that the old plan survives. `check:app` asserts that
sentence is on the screen.

One thing the generator lost on the way: **its titles no longer carry a
duration.** « Sortie longue 97 min » said the same number as `meta`
(« 97 min · 16,2 km · RPE 5 ») and became false the minute an accepted
adjustment shortened the session. The workbook writes « Seuil — 5 × 3' » and
leaves the figures to `meta`; the generator does the same now.

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
/api/recalcul  « Recalculer le plan » — the week rather than the session
```

**Strava's MCP server is attached to all three calls.** That is the piece the app
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

### The week — « Recalculer le plan »

`/api/recalcul` is the same shape one scope up, and the split falls in the same
place.

**The gap is arithmetic**, so it is computed — `ecartDeSemaine` in
`src/data/analyse.ts`, on every render, for every week: planned minutes against
done minutes, counting only the sessions that have already come due. That last
clause matters because the settings sheet walks the thirty weeks, and a week
still in the future would otherwise report every session as skipped and 0 %
realised — a gap the athlete has not had the chance to open yet. Rest days are
not sessions and cannot be missed.

That is also a change from the prototype: the gap card used to be a seeded row
that existed for semaine 7 alone, which meant the button existed there alone.
Now the card is computed everywhere, turns from warning to plain when the week
was held, and the recalculation can be asked for on any week.

**What to do about the gap is Claude's**, with two of the plan's own rules
written into the prompt rather than left to the model:

- a missed session is **never** made up for — the plan recalibrates, it does not
  ask the athlete to catch up;
- when something must be sacrificed, the order is the bike, then the second
  Hyrox, then the swim. The quality session and the long run are protected.

A model left to itself proposes catch-up sessions, because that is what the
internet is full of. The workbook says otherwise, and the workbook is the plan.

The adjustments come back structured, and `appliquerAjustement` renders them:

- a `session_id` may only name a session from the week that was sent, and one
  that is not in the plan is **dropped, not guessed** — a dropped adjustment is
  a card that does not appear, a guessed one is a card the athlete might act on;
- the fraction is clamped to [0,5 · 1,25]. A weekly rebalance may lengthen a
  session as well as shorten one — a swim picking up what a missed run gave
  back — but it may not double it;
- a swim is written in metres and a run in minutes, because that is the number
  each session is about, so `Volume — séries longues 3 000 → 3 600 m` and
  `Sortie longue 1h37 → 1h18` are both the engine's arithmetic on the session's
  own planned quantity;
- a week-scoped note carries a session type for its chip, and an invented type
  drops the whole adjustment.

The prose parts — the reading of the gap, the recalibration entries, the weekly
observations — carry **no figure at all**. The prototype's seeded text said
« Volume ramené à 7h » ; this says what changes and over which stretch, and the
number lives on the adjustment card next to it, where it is computed. One place
per figure.

### Accepting one moves the session

The adjustments are proposals the athlete accepts one at a time — and accepting
one now **writes the session**. Until it did, the screen said « accepté » above a
session that had not moved a minute, and the next morning the plan asked again
for the 68 minutes the coach had just brought down to 54.

What moves is the session's quantity: its duration, and with it the distance,
the metres and the load, which are the same quantity in three units — a session
at 80 % is at 80 % of each. And, for a session-scoped adaptation, the zone it is
run in. No pace is written: the engine derives it from the zone and the block,
here as everywhere else.

What is kept is `avant` — the session as it stood immediately before. It is the
one fact of the operation that cannot be recomputed, because the session was
overwritten, and it is what keeps « 68 min → 54 min » true *after* acceptance
and what makes withdrawal exact. It is read whole and never filtered, so it is
JSON, by the schema's own rule.

Four things that only look like details:

- **the zone guard rail moved to where the proposal is written**, not where it is
  displayed. `zoneAdmissible` reads `msc_zone.ordre` — slowest to fastest — so
  what is stored is already what will be shown *and* what will be written on the
  session. There is no displayable version and a stored version;
- **the zone is only rewritten if it changes.** Otherwise accepting an
  adaptation that keeps the planned zone would reduce « EF warm-up then
  threshold » to « threshold », and the session would lose its warm-up for
  nothing;
- **two accepted proposals cannot share a session.** The second would start from
  what the first wrote, and withdrawing the first would erase the second.
  `msc_session.adapte_par` names the one that holds, and the second is refused
  with a sentence the athlete can read — that is what `DepotError` is for, since
  the server otherwise answers « la requête a échoué » and keeps the reason in
  its logs;
- **accepting twice does not shorten twice.** A double click, or an offline
  queue replaying, finds the proposal already in the state it asks for and does
  nothing.

The week's stored totals follow, because a week with a moved session in it has
stale totals by construction — and `ecartDeSemaine` would otherwise measure the
gap against a volume that no longer exists.

### Why OAuth *and* MCP

They are not the same job, and the split falls where the model belongs.

|  | the sync | the coach |
|---|---|---|
| what | fills `msc_activity` | reads a session back |
| how | Strava's REST API, `server/strava.mjs` | Strava's MCP server, via the Messages API |
| why not the other one | MCP is request-scoped — Claude connects during a call, so nothing pushes, and the webhook would disappear. And a model transcribing numbers the pace engine then computes against is a non-deterministic step in a path `check:engine` asserts to the second. | The REST aggregates are what one sync happened to keep. The coach wants the shape of the effort inside the session and the weeks before it. |

## The database

`db/schema.sql` — 37 tables, MySQL 8, validated on MariaDB 10.11 too. `db/README.md`
is its own documentation; what follows is why it looks the way it does.

Until now the MSC database was eighteen TypeScript arrays behind an accessor
seam, which was the right shape for a prototype and the wrong one for four
things that had arrived since: more than one athlete, photos the app uploads,
competitions encoded in a back office, and a plan that can be regenerated.

**Nothing is stored that can be computed.** The engine derives every pace from
two numbers on the athlete, and `check:engine` holds it to the workbook cell for
cell. A pace in the database would be a second truth, and it is the one that
goes wrong the day the 30-minute time trial rewrites the reference. So what is
stored is what was **measured** — an activity's average pace, its work blocks,
a weight, a resting heart rate — or **decided**: the zone and the fraction the
coach proposes, never the minutes and the pace they render to.

**Relational for what gets filtered, JSON for what is only ever read whole.**
"Which sessions are threshold sessions" and "which days had tendon pain" are
questions the plan genuinely asks — those are tables (`msc_session_zone`,
`msc_journal_douleur`), and `check:db` asks them in SQL. The display payloads
Claude produces are only ever read entire; those are JSON.

### The plan became an entity

It was not one while there was a single athlete and a single workbook. An
athlete can now have several plans — the workbook's, then whatever the generator
produces — and one is active.

That is also the answer to the question this README left open. **Nothing is
lost.** The journal and the activities belong to the athlete and *point at*
sessions; deleting a plan takes its sessions and detaches what referenced them,
without erasing a line of what the athlete actually did. `check:db` proves it,
inside a transaction it rolls back.

### The photo, the weight and the resting heart rate

Three tables rather than one, because they are three different facts: the file
received (`msc_photo`), what a model believed it read in it (`msc_extraction`),
and the measurement of record (`msc_mesure`).

What a model reads off a blurry scale does not become the athlete's weight
before they have seen it: `msc_mesure.etat` is `propose` until they confirm. A
failed extraction is **rejected, not deleted** — what the model gets wrong is
worth keeping.

### Competitions belong to the athlete, not to the plan

A competition is a race, run or to be run. An *objectif* is what a plan aims at
on it; a *résultat* is what it gave. That separation is what makes the evolution
charts possible: results outlive the plans that aimed at them, so a three-year
progression curve crosses four plans without noticing.

### The Strava tokens are sealed

AES-256-GCM, in `server/bd.mjs`, with a key that is not in the database. While
they lived in a 0600 file, protecting them was a matter of Unix permissions; a
database is backed up, replicated, restored onto a laptop and read by more
people than a file — a token in the clear inside one is a token that ends up in
a dump.

### What `check:db` asserts

Fifty-four assertions, in four parts. The round trip: the 243 sessions, the four
block `part` values at the thousandth, the eight zone offsets with their signs,
the accents and the Polish. Then the block-B reference recomputed **in SQL** from
what the database holds — if MySQL and the workbook ever disagree, that is where
it shows, because `check:engine` reads the TypeScript and would not see it.

The other half is every guard rail with the write it must refuse: a target
slower than the current reference, a plan that ends before it starts, a 900 kg
weight, an RPE of 12, the same session done twice, an adaptation that doubles the
next session, an analysis of a session with no session, and the same offline
mutation replayed twice — the one that stops a queue from recording the same RPE
twice after a reconnection.

Then the two writes that change the plan itself: a generated plan written next to
the workbook's and checked line for line, and a proposal accepted, re-accepted,
refused a second holder and withdrawn — each inside a transaction it rolls back,
so the workbook is exactly where it was when the check ends.

It found a real defect on its first run: deleting a plan failed, because sessions
held their block and the block FK had no cascade.

### What sits on top of it

The repositories and the API — see « The API » below, which is where the
schema's rules meet a caller.

## The API

`server/index.mjs` routes, `server/depots.mjs` reads and writes, `server/auth.mjs`
says who is asking. `check:api` boots the server and talks to it over HTTP —
seventy-one assertions, because what breaks an API is the layers a direct call
skips: the cookie, the access check, the JSON shape, the status code.

The plan and proposal routes are exercised on a **second athlete** created for
the run — writing a plan and shortening a session must not touch the workbook the
other sections read, and everything goes away with the athlete at teardown.

### One snapshot, not one endpoint per table

`GET /api/db/instantane` returns the whole of one athlete's database in the
shapes `src/data/types.ts` already declares.

That is deliberate. The app holds its tables in memory and its screens read them
synchronously — `db.select('msc_session')`, `db.one(...)`. A snapshot fills them
without a single screen changing, and it is exactly what an offline cache wants
to store. Per-table endpoints would force every screen to become async for no
gain: the plan is 243 sessions, not 243 000.

```
GET  /api/db/instantane    the lot, for one athlete
POST /api/journal          the RPE and the note
POST /api/mesure           the weight and the resting heart rate
POST /api/proposition      accept or withdraw one of the coach's proposals
     /api/competitions     GET · POST · DELETE — the back office
POST /api/analyse          · /api/recalcul · /api/coach, which now persist
```

### The server does not compute a pace

The same line as everywhere else, and the API is where it would have been
easiest to cross. An adaptation comes back as **a zone and a fraction**, never
`44 min · 6:20/km`: the browser renders it with the engine, which is why writing
a new 10 km reference slides the coach's proposals along with the plan.

`check:api` asserts it — no `mm:ss/km` anywhere in the structured fields of a
session — and that assertion found something on its first run. The workbook
carries a per-session `consigne` reading `EF 06:27`: a zone name and the pace
that zone was worth **on the day of the import**. It was rendered on two screens
and it would not have moved when the reference did. Where a session has zones it
is now recomposed by the engine and the server does not serve it; where it has
none it is prose (« À l'effort, pas à l'allure ») and passes through untouched.
Six sessions out of the seventy-four that had one.

### Who is asking

The schema grew accounts when it grew a second athlete, so the API had to answer
that question before answering any other.

Passwords are **scrypt**, from Node's standard library. argon2id would be a
notch better and needs a native dependency that builds badly; scrypt is
memory-hard, it is already there, and it beats a mis-parameterised bcrypt.

Sessions are a **signed token, with no table** — simpler and query-free, at the
cost of one thing worth stating rather than discovering: a session cannot be
revoked before it expires. The day that matters — a lost phone, a shared
account — it needs a sessions table, and that sentence becomes false.

An unknown email and a wrong password return **the same message**, and the
unknown-email path still runs a hash, so the two take the same time. The
difference would say who has an account here.

The client may name an athlete (`?athlete=3`) — a coach's back office needs
exactly that — but `msc_acces` decides, never the parameter. `check:api` creates
a second athlete for the sole purpose of proving that one account cannot read
the other's, because that is the only assertion in an access check that counts.

In development, `MSC_ATHLETE_ID` short-circuits all of it. In production it is
refused, loudly: a service door left open is an open door.

### Writes replay safely

Every write goes through `mutation()`, which deduplicates on an id the client
generates before sending. Without it, an offline queue replaying after a
reconnection records the same RPE twice and nobody notices. `check:api` sends
the same mutation twice with different content and asserts the second one
changed nothing.

### The Strava tokens moved into the database

`server/strava.mjs` kept them in a 0600 JSON file, which knew about exactly one
athlete. Every function that touches an account now takes an `athleteId`, the
tokens live in `msc_strava_compte` sealed by `server/bd.mjs`, and a webhook
event finds its athlete through the table rather than through a single global.
There is no token file any more.

### What is not built yet

The app is on it — see « The app on the API » below.

## Putting it online

**The repository holds the access.** `.github/workflows/deploiement.yml` builds
on the runner, ships to the server over SSH, migrates, flips a symlink and
restarts — with the credentials in the repository's secrets, where nobody has
to read them for it to work. `deploy/README.md` says which secrets, and how to
make the key.

`.github/workflows/ci.yml` runs all five checks on every push, two of them
against a real **MySQL 8** service container. That matters more than it looks:
the schema was written for MySQL 8 but validated on MariaDB 10.11, for want of
anything better where it was written. CI is the first place it meets the engine
it targets.

`deploy/README.md` is the runbook. The short version: one Node process serves
the built PWA **and** the API from the same origin — no CORS, a session cookie
that travels normally, and a service worker that actually controls the page.
A reverse proxy in front is **not** optional, though, and this page said the
opposite for a while — nginx or Apache, `deploy/publier.sh` uses whichever
already holds the ports. In production the session cookie carries `Secure`, so
without TLS the browser never sends it back: the app answers `{"ok":true}` and
nobody can log in, two symptoms with nothing in common. On a bare IP, where no
certificate is possible, the app is served in the clear under `/msc/` and
`MSC_SANS_TLS=1` lifts the flag — explicitly, knowing what it costs. The mount
path comes from the build (`MSC_BASE`, `/msc/` by default); the server itself
never learns it, the proxy strips the prefix.

`NODE_ENV=production` is not optional: it condemns the `MSC_ATHLETE_ID`
development back door and puts `Secure` on the session cookie. `check:api`
starts a second server in production mode and asserts both, along with the
cache headers and that a directory traversal cannot escape `dist/`.

## The app on the API

The screens are unchanged. That is the whole point of the seam: they still call
`db.select('msc_session')` synchronously, and what moved is where those rows
come from.

`src/data/vives.ts` holds the tables. They start **empty** and `charger()` fills
them from `/api/db/instantane`. The workbook no longer ships in the bundle —
`plan.generated.ts` and `reference.ts` are read by the seed script and the
checks, and nothing else imports them. The bundle went from 425 KB to 292 KB,
and more usefully the app can no longer display one athlete's plan while
believing it is showing yours.

Reading `db.athlete` before the load throws, deliberately, through a proxy that
says so. The alternative — a placeholder of zeroes — would render a 6:00/km
session as `0:00/km` and nothing would protest. `App.tsx` holds the gate:
nothing renders until `amorce === 'pret'`.

### Everything that writes ends in a reload

The server is the truth, so a write is followed by re-reading it rather than by
a parallel write into memory. Two copies always diverge. That covers the
journal, the accepted proposals, the coach's output — which the server now
persists — and the Strava sync: matching still happens in the browser because
that is where the plan is, and what comes out is posted and read back.

### The login screen

There is no sign-up and there will not be one. MySmartCoach is an athlete's plan
and their coach's back office, not a service you join — accounts are made with
`npm run compte` on the server. The screen only opens the door for someone who
already has the key.

### `check:app` drives a real browser

The other checks prove the engine computes correctly, the database keeps what it
is given, and the API answers. None of them would say the login screen appears
and the plan arrives behind it. This one does, and it found two real defects
while being written:

- The form unmounted during a login attempt, because `seConnecter` switched the
  boot state to "loading". A wrong password cleared both fields, so the address
  had to be retyped every time.
- `/api/strava/etat` was called before login, on the login screen, where it can
  only 401 — leaving a "Non connecté" error to surface in the settings sheet
  afterwards.

It also asserts the negative space: that the plan is not visible before login,
and that logging out empties the tables rather than just the screen — one
athlete's data must not stay readable by the next person to log in on the same
device.

### What is not built yet

Nothing on the app's side of the API. The offline cache, the back office and the
photo all landed; a generated plan persists, and an accepted proposal moves the
session it names.

What is still only exercised against its failure paths, for want of credentials
in this checkout: the Anthropic success paths (methodology, coach, photo
reading) and the Strava consent round-trip.

## The photo

The athlete photographs their scale or their watch; Claude reads the weight and
the resting heart rate off it. `server/photo.mjs` and the card at the top of the
État de forme screen.

**What a model reads does not become the athlete's weight before they have seen
it.** An extraction creates a measurement in state `propose`; it counts for
nothing until confirmed. A blurry scale, a reflection, a comma taken for a
period — those happen, and a wrong training figure entered in silence is worse
than one that is missing.

Three tables, because they are three different facts:

| | |
|---|---|
| `msc_photo` | the file received, keyed by its SHA-256 so the same photo twice is one row |
| `msc_extraction` | what a model believed it read — including **failures**, which are recorded rather than deleted: what the model gets wrong is worth keeping |
| `msc_mesure` | the measurement of record, and whether the athlete has confirmed it |

**The photo is stored before the reading is attempted.** If the model fails, or
the key is missing, the image is still there and the athlete types the numbers
in — the card says so and offers the fields. The other order would lose the
photo on every incident. `check:api` and `check:app` both run precisely that
path, because this checkout has no Anthropic credential: what is exercised is
the degraded one, and the vision call itself is not.

The upload is raw bytes with a content-type, not multipart — one file per
request, and no multipart parser to carry for it. HEIC is refused with a
sentence saying what to do about it, since an iPhone sometimes sends it.

Correcting the numbers before confirming flips the measurement's source from
`photo` to `saisie`, so what the model gets corrected on can be measured later
rather than guessed at.

Photos are served from `/api/photo/:id`, authenticated and athlete-scoped:
`check:api` asserts that one does not open without the cookie.

## Offline

The app is an installed PWA, so it has to be readable in a tunnel and it has to
keep what the athlete types when there is no signal. Two mechanisms, and they do
not have the same status.

**The snapshot is a copy, not a source.** It lives in IndexedDB, is replaced by
every successful reload, and is erased on logout — one athlete's data must not
stay readable by the next person to log in on the device. On boot the network
comes first; only if it fails does the app fall back to the copy, and the header
says « Hors ligne · copie locale » rather than letting stale figures pass for
fresh ones.

**The outbox is not a copy.** It is what the athlete typed and the server has not
received, and it does not get lost. Each write carries the `mutation_id` the
client draws **before sending**, so replaying it is safe. A network failure
queues; a *server* refusal does not — a 400 will not become a 200 by being sent
again, and a queue that retries an impossible write forever is a queue that
retries nothing.

`navigateFallback` sends navigations to the cached `index.html`, with `/api/`
excluded: the service worker has no business caching the API, since the app
keeps its own copy where it can read it back and erase it.

### Two defects the browser check found

**The pending count was hidden while offline.** The indicator showed either
"offline" or "n waiting", never both — so typing three things with no signal
showed nothing about them, which reads as having lost them.

**`mutation()` was not atomic**, and that one matters. It did a `SELECT` and
then an `INSERT`: two concurrent requests with the same id both got past the
`SELECT`, both did the work, and the second failed on the primary key with a
500 — exactly what the table exists to prevent. The claim is now the *first*
write of the transaction, so a second request blocks on the row lock until the
first commits, then reads its response. `check:api` fires two identical
mutations in parallel and asserts one row in the database.

The client also serialises replays: `online` and a session opening can land
together, and the server dedupes them, but making it do the work for nothing is
not a reason to let it happen.

`check:app` cuts the network for real — `setOffline(true)` — reloads, reads the
plan, types a note, restores the network and asserts the note reached MySQL.

## The back office

The **Créer** tab carries two things now, behind a segmented control: building a
plan, and keeping the register of races. A switch rather than a sixth tab — the
bar already has five, and a back office is not a screen you open every day.

### Competitions

Encoded by hand: date, name, place, distance, time, placing, starters. A race
belongs to the athlete and not to the plan, which is what lets results outlive
the plans that aimed at them.

The pace is never typed: it is time ÷ distance, and the distance is on the
competition. An empty time is not a result of zero — it is a race still to come,
and clearing it removes the result rather than storing a zero.

### Two charts, never two axes

Weight is in kilograms and pace in seconds per kilometre. Putting them on two
vertical axes in one frame is the most reliable way to make a reader see a
correlation that is not there, so they are **two cards, one series each**.

Colour therefore carries no identity — the title names the series and there is
no legend to have. Both hues pass the checks that apply to a lone series
(lightness band, chroma floor, 3:1 contrast on white), run through the palette
validator rather than eyeballed; the adjacent-pair checks do not apply, since
the two never meet in the same frame.

**Progression is the 10 km equivalent, not the raw pace.** A half-marathon at
5:00/km and a 10 km at 5:00/km are not the same fitness. Riegel converts them —
the same function the generator already uses to set a block's reference, so
there is one definition of "equivalent" in the codebase rather than two.

A falling weight gets a **neutral** badge, not the green one a falling pace gets.
Losing weight is not automatically good for an endurance athlete, and two of the
plan's own adjustment rules exist because of it.

### What looking at it caught

The palette validator checks colour, not geometry. Rendered and looked at, the
point markers were **ovals**: `preserveAspectRatio="none"` stretches the viewBox
horizontally, which flattens a line correctly and deforms every circle on it.
The chart now measures its container and draws in real pixels.

### Réglages — `msc_param`

Every knob the application has lives in one table, `msc_param`, and the
**Réglages** section (a `coach` or `admin` account) sets them without a
redeploy. The catalogue — keys, types, defaults, labels — is
`server/params.mjs`; `db:migrate` lays it into the table and the table only
carries the value chosen.

Three sources, in this order: the value in the table if set, the environment
variable when the parameter has one, then the code's default. **The table wins
over `.env`, on purpose** — what the screen shows is what applies. Each row
says where its value comes from, because a setting that looks active without
being so is worse than no setting.

What is there today: the engine's tolerances (drift, pace gap, overload), the
form thresholds (resting HR delta, HRV drop), the coach model, the Anthropic
key, the Strava application, the password floor. The browser gets the
non-secret subset in the snapshot (`msc_param`) and reads it through
`db.param(cle, defaut)`; the server reads through `param(cle)` with a
fifteen-second cache that a write invalidates.

A secret (`anthropic.cle`, `strava.client_secret`, `strava.verify_token`) is
sealed with `MSC_SECRET_KEY` like the Strava tokens — never in clear in the
table, never sent back to the screen: the screen knows it is set and sees its
last four characters. Without `MSC_SECRET_KEY` the server refuses to store one
rather than storing it in clear.

### Athlètes, Calendrier, and what the coach was asked

**Athlètes** opens with the club ranking — five axes scored out of 100
(endurance, speed, bike, running, swimming), their mean, and the *niveau de
combat* that goes with it (the mean × 100). Everything is read from what the
database already holds: the last eight weeks of activities for the volumes,
the fastest measured work block over 90 days for speed, the 10 km reference
for running — and each row shows the raw figure its score comes from. Six
transformation tiers sit on the mean (Terrien → Guerrier → Super Guerrier →
2 → 3 → Ultra); the avatar wears them, initials kept as a badge, in the
header, on the cards and in the ranking. What scores 100 on each axis and
where the tiers fall are settings (`msc_param`, group `niveau`).
`GET /api/classement` returns names and scores to any signed-in account.

Below the ranking, one card per athlete the account can see: phase and week,
references, this week's sessions, last RPE and what blocked, the chosen coach,
the form gauge — and, folded, **what they asked the coach**: every thread
(`msc_chat`, keyed by `fil`), the answer, the coach persona that was speaking
(`ton`), the model and its cost. Analyses carry `ton` too.

When an account sees several athletes, the coach's chat context also carries
the **others' form** — score, resting HR and HRV against baseline, load, week
and block, last RPE and what blocked — so "et Léa, elle en est où ?" gets an
answer with those figures and no others. Nothing else of theirs crosses over:
not the journal, not the notes.

**Calendrier** is the club's shared race calendar: every competition of every
athlete, month by month, with the runner's avatar, the distance, the plan's
target and a countdown; past races show the time. `GET /api/calendrier`, any
signed-in account.

### Importing a hand-written plan

Not every plan comes out of the generator. Sam's 44-week plan is a spreadsheet
— a row per week, seven free-text cells (« FRAC / 10m warm / 3×4m @3:55 / 10m
cool »), a « — MUSCU » row under it, the totals, a RACE column. It lives in
`db/plans/` twice: the workbook as received, and the same grid as JSON, read
as is, with what the grid does not say added at the top — the athlete's two
references, where each phase sits between them (`parts`), the competitions
with their discipline and target, and what is still to clarify.

```
npm run db:importer-plan -- db/plans/sam-verheyden-2026-2027.json            # dry run: the report
npm run db:importer-plan -- db/plans/sam-verheyden-2026-2027.json --ecrire   # writes it as the active plan
```

The script translates each cell into a session the engine understands — a
discipline, a type, a duration, a target RPE, zones — and keeps the original
text in the session's detail, because that is what the athlete wrote. Two
things it cannot take as they are: the paces (the classeur writes « @3:55 »,
the engine computes them from the reference and the block's `part`, so the
file states the intent per phase and the displayed pace is the engine's, with
the classeur's beside it), and the races (the RACE column names them, not
always on the right row — the date in the label is what counts, the race
session lands on that day, the Sunday « 🏆 RACE » cell becomes a rest). It is
replayable: the same plan already active is not written twice.

`check:db` asserts the seeded workbook is the active plan; on a database where
this import has run, its plan-shaped assertions fail by construction.

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
| computed by the engine, shown as the gap | `msc_ecart` stats — planned against done, per week |
| returned by the Anthropic API | `msc_analyse`, `msc_adaptation`, `msc_ajustement`, and the prose of `msc_ecart` |
| imported from the workbook | `msc_session`, `msc_week` |
| set once, per athlete | `msc_athlete`, `msc_bloc`, `msc_zone`, `msc_objectif`, `msc_regle` |
| by hand, each day | `msc_journal` (RPE + note, on the Aujourd'hui screen) |

The app resolves "today" from the real date, clamped into the plan's span. The
settings sheet carries a date control so you can walk the thirty weeks.

## What is real, and what is still seeded

Nothing on the four screens runs on a timer any more. The prototype had three,
and all three are gone:

- **Analyser avec Claude** and **Recalculer le plan** call the coach; the server
  persists what comes back and the app re-reads it — see « The coach » above.
- The two chat bars each keep their own thread and reach `/api/coach`.
- **Take my data** is the real OAuth link — see « Linking Strava » above. Its
  card has six states now instead of a boolean, because a boolean could only
  say "connected" and mean nothing by it.

Two things are still seed data, for two different reasons.

**`msc_daily`** — resting heart rate, which two adjustment rules watch — because
Strava does not carry it. That one needs the wearable, not the platform.

**The example `msc_analyse` / `msc_adaptation` / `msc_ajustement` rows**, loaded
by `db:seed`, because a fresh database with no Strava account and no API key
should still have something to show. They are anchored on session 1052 — the plan's first quality
session, semaine 7, "CAP · Seuil — 5 × 3'" — and their figures follow the worked
example in the workbook's "Suivi & ajustement" sheet. A real analysis replaces
the one for its own session or its own week, and takes its proposals with it.

**The plan is no longer one of them.** A generated plan is written into
`msc_session` and becomes the active one; an accepted proposal moves the session
it names, and withdrawing it puts the session back exactly. Both were the same
open question — what happens to the journal attached to what is being replaced —
and the answer the schema gave holds in practice: nothing is lost. A plan is an
entity, the journal points at sessions rather than belonging to them, and the
plan that steps aside keeps everything it had.

The methodology call has been written against the documented API surface but not
executed end to end here — this environment has no Anthropic credential, so the
401 path is tested and the success path is not. The three coach routes are in
exactly the same position, with one more unknown on top: whether Strava's MCP
server accepts the token, which is why they fall back rather than assume.

The same caveat applies to Strava, and to the same extent. There is no Strava
application behind this checkout, so what has actually been exercised is every
route the server exposes — health, state, the authorisation URL, the webhook
handshake with a good and a bad verify token, an event POST, a forged
revocation naming another athlete, and the 400 / 401 / 409 / 501 paths on all
three coach routes — plus the 57 assertions in `check:strava`, which hold the
matcher, every computed figure and every branch of both guard rails against the
real plan. What has not is the round-trip through Strava's own consent screen,
the shape of a live activity payload, and any call that reaches Claude.

## Deviations from the prototype

Six places where the prototype's behaviour was an artefact of the design medium
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
6. **The gap card exists on every week.** It was a seeded row for semaine 7, so
   « Recalculer le plan » could only be pressed there. The gap is arithmetic —
   planned against done, for the sessions that have come due — so it is computed
   for whichever week is on screen, and reads « Semaine tenue » rather than
   « Écart détecté » when there is nothing to recalibrate.

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
