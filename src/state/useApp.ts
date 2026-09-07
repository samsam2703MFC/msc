/* App state. Mirrors the prototype's state machine one-for-one:
   the analysis and the plan recalculation are the two async steps, everything
   else is a toggle.

   With one thing that is no longer a toggle: Strava. In the prototype "Take my
   data" flipped a boolean and the connected state was a picture of itself.
   Here it is the real link — the server holds the token, this holds what came
   back, and `db.setActivites` is where it lands. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as db from '../data/db';
import * as strava from '../data/strava';
import type { Lang, ScreenKey, TypeCode } from '../data/types';

const ANALYSE_MS = 1400;
const RECALC_MS = 1500;
const LANG_KEY = 'msc.lang';

/* While the athlete is on Strava's consent screen. Their window is on Strava's
   origin, so we cannot read it — we watch the server for the link instead. */
const SONDAGE_MS = 2000;
const LIAISON_MAX_MS = 3 * 60 * 1000;

/* How often the app asks its own server whether the webhook has heard
   anything. This is a local request, not a Strava one: it costs no quota. */
const VEILLE_MS = 60_000;

/* Laps cost one Strava request each, so they are fetched for the week on
   screen, not for the whole plan. */
const DETAILS_MAX = 4;

export type Job = 'idle' | 'running' | 'done';
export type StravaJob = 'idle' | 'liaison' | 'synchro';

function storedLang(): Lang {
  try {
    const v = localStorage.getItem(LANG_KEY);
    if (v === 'fr' || v === 'pl') return v;
  } catch {
    /* private mode, or storage disabled — fall through to the default */
  }
  return 'fr';
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : 'Erreur inconnue.';
}

function lendemain(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function useApp() {
  const [screen, setScreen] = useState<ScreenKey>('today');

  /* Where the plan is. Defaults to the real date, clamped into the plan's
     span; the settings sheet lets you move it to walk the thirty weeks. */
  const [date, setDate] = useState(() => db.positionDuPlan(db.aujourdhuiISO()).date);
  const semaine = useMemo(() => db.positionDuPlan(date).semaine, [date]);

  const [lang, setLangState] = useState<Lang>(storedLang);

  /* Today */
  const [done, setDone] = useState(true);
  const [rpe, setRpe] = useState(8);
  const [note, setNote] = useState('');
  const [ana, setAna] = useState<Job>('done');
  const [nextApplied, setNextApplied] = useState(false);

  /* Coach */
  const [recalc, setRecalc] = useState<Job>('idle');
  const [excuse, setExcuse] = useState<string | null>(null);
  const [excuseApplied, setExcuseApplied] = useState(false);
  const [applied, setApplied] = useState<Record<number, boolean>>({});

  /* Overlays */
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [typeCode, setTypeCode] = useState<TypeCode | null>(null);

  const anaTimer = useRef<number | undefined>(undefined);
  const recalcTimer = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      window.clearTimeout(anaTimer.current);
      window.clearTimeout(recalcTimer.current);
    },
    [],
  );

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(LANG_KEY, next);
    } catch {
      /* preference just won't survive a reload */
    }
  }, []);

  /* ------------------------------------------------------------- Strava */

  const [stravaEtat, setStravaEtat] = useState<strava.EtatStrava | null>(null);
  const [stravaJob, setStravaJob] = useState<StravaJob>('idle');
  const [stravaErreur, setStravaErreur] = useState<string | null>(null);
  const [orphelines, setOrphelines] = useState<strava.ActiviteStrava[]>([]);

  /* `db.setActivites` mutates the table behind the accessors, which React has
     no way to notice. This is what tells it something changed. */
  const [version, setVersion] = useState(0);

  /* The last bulk fetch, and the laps we have already paid a request for.
     Both are caches, so re-matching after the week changes costs nothing. */
  const brutes = useRef<strava.ActiviteStrava[]>([]);
  const details = useRef(new Map<number, strava.ActiviteDetaillee>());
  const liaison = useRef<number | undefined>(undefined);
  const vu = useRef<string | null>(null);
  const monte = useRef(true);

  useEffect(() => {
    monte.current = true;
    return () => {
      monte.current = false;
      window.clearInterval(liaison.current);
    };
  }, []);

  const rafraichirEtat = useCallback(async () => {
    try {
      const e = await strava.etat();
      if (monte.current) setStravaEtat(e);
      return e;
    } catch (e) {
      if (monte.current) setStravaErreur(message(e));
      return null;
    }
  }, []);

  /* Pure: re-derives the activity table from what we already hold. */
  const appliquer = useCallback(() => {
    const sessions = db.select('msc_session');
    const resultat = strava.apparier(brutes.current, sessions, details.current);
    db.setActivites(resultat.activites);
    setOrphelines(resultat.orphelines);
    setVersion((v) => v + 1);
    return resultat;
  }, []);

  /* Laps for the quality runs of one week — the only place splits are read. */
  const completerDetails = useCallback(
    async (n: number) => {
      const sessions = db.select('msc_session');
      const semaineIds = new Set(sessions.filter((s) => s.semaine === n).map((s) => s.id));
      const dansLaSemaine = db
        .select('msc_activity')
        .filter((a) => a.session_id !== undefined && semaineIds.has(a.session_id));

      const manquants = strava
        .seancesDeQualite(dansLaSemaine, sessions)
        .filter((id) => !details.current.has(id))
        .slice(0, DETAILS_MAX);
      if (manquants.length === 0) return;

      for (const id of manquants) {
        try {
          details.current.set(id, await strava.activite(id));
        } catch {
          /* One activity without its laps is a chart that does not draw, not a
             failed sync. Leave it out and carry on. */
        }
      }
      if (monte.current) appliquer();
    },
    [appliquer],
  );

  /* The whole plan span in one go: ~250 activities over thirty weeks, which is
     three requests against a quota of a hundred. A window would cost more
     round-trips than it saves. */
  const synchroniser = useCallback(async () => {
    const sessions = db.select('msc_session');
    if (sessions.length === 0) return;
    setStravaJob('synchro');
    setStravaErreur(null);
    try {
      const { activites } = await strava.activites(
        sessions[0].date,
        lendemain(sessions[sessions.length - 1].date),
      );
      if (!monte.current) return;
      brutes.current = activites;
      appliquer();
      await rafraichirEtat();
      await completerDetails(db.positionDuPlan(date).semaine);
    } catch (e) {
      if (monte.current) setStravaErreur(message(e));
    } finally {
      if (monte.current) setStravaJob('idle');
    }
  }, [appliquer, completerDetails, date, rafraichirEtat]);

  /* On load: what does the server know? If the athlete is already linked from
     a previous run, their activities are there before they ask. */
  useEffect(() => {
    void (async () => {
      const e = await rafraichirEtat();
      if (e?.lie) {
        vu.current = e.dernier_evenement;
        await synchroniser();
      }
    })();
    /* Deliberately once, at mount: `synchroniser` closes over the plan date,
       and walking the thirty weeks must not re-fetch the whole span each time.
       Later syncs are the webhook's, or the athlete's. */
  }, []);

  /* Walking to another week wants that week's laps, and nothing else. */
  useEffect(() => {
    if (stravaEtat?.lie) void completerDetails(semaine);
  }, [semaine, stravaEtat?.lie, completerDetails]);

  /* The webhook lands on the server, not here. Ask it, cheaply, whether
     anything arrived — and only then spend a Strava request. */
  useEffect(() => {
    if (!stravaEtat?.lie) return undefined;
    const t = window.setInterval(() => {
      void (async () => {
        const e = await rafraichirEtat();
        if (!e) return;
        if (!e.lie) {
          /* The athlete revoked us from Strava's side; the webhook told the
             server, and the server has already dropped the token. */
          db.reinitialiserActivites();
          setVersion((v) => v + 1);
          return;
        }
        if (e.dernier_evenement && e.dernier_evenement !== vu.current) {
          vu.current = e.dernier_evenement;
          await synchroniser();
        }
      })();
    }, VEILLE_MS);
    return () => window.clearInterval(t);
  }, [stravaEtat?.lie, rafraichirEtat, synchroniser]);

  const lierStrava = useCallback(async () => {
    setStravaErreur(null);
    let url: string;
    try {
      ({ url } = await strava.lienAutorisation());
    } catch (e) {
      setStravaErreur(message(e));
      return;
    }

    setStravaJob('liaison');
    const fenetre = window.open(url, 'msc-strava', 'width=520,height=760');
    if (!fenetre) {
      /* Popup blocked — go there in this tab instead. Nothing is lost: the
         only state that outlives a reload is the language, and it is stored. */
      window.location.assign(url);
      return;
    }

    /* Strava's page is on their origin, so the popup is opaque to us. Watch
       the server for the token appearing instead. */
    const debut = Date.now();
    window.clearInterval(liaison.current);
    liaison.current = window.setInterval(() => {
      void (async () => {
        const e = await rafraichirEtat();
        const expire = Date.now() - debut > LIAISON_MAX_MS;
        if (e?.lie || expire || fenetre.closed) {
          window.clearInterval(liaison.current);
          if (!monte.current) return;
          setStravaJob('idle');
          if (e?.lie) {
            vu.current = e.dernier_evenement;
            fenetre.close();
            await synchroniser();
          } else if (expire) {
            setStravaErreur('La liaison a expiré. Relance la connexion.');
          }
        }
      })();
    }, SONDAGE_MS);
  }, [rafraichirEtat, synchroniser]);

  const delierStrava = useCallback(async () => {
    setStravaErreur(null);
    try {
      await strava.delier();
    } catch (e) {
      setStravaErreur(message(e));
    }
    brutes.current = [];
    details.current.clear();
    vu.current = null;
    db.reinitialiserActivites();
    setOrphelines([]);
    setVersion((v) => v + 1);
    await rafraichirEtat();
  }, [rafraichirEtat]);

  /* ------------------------------------------------------------ le reste */

  /* Claude reads the session back and answers; re-running replays it. */
  const runAnalyse = useCallback(() => {
    setAna((current) => {
      if (current === 'running') return current;
      window.clearTimeout(anaTimer.current);
      anaTimer.current = window.setTimeout(() => setAna('done'), ANALYSE_MS);
      return 'running';
    });
  }, []);

  /* Recalculating the remaining 27 weeks; a second press folds the result away. */
  const runRecalc = useCallback(() => {
    setRecalc((current) => {
      if (current === 'running') return current;
      if (current === 'done') return 'idle';
      window.clearTimeout(recalcTimer.current);
      recalcTimer.current = window.setTimeout(() => setRecalc('done'), RECALC_MS);
      return 'running';
    });
  }, []);

  const pickExcuse = useCallback((code: string) => {
    setExcuse((current) => (current === code ? null : code));
    setExcuseApplied(false);
  }, []);

  const toggleAdjustment = useCallback((id: number) => {
    setApplied((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const allerA = useCallback((iso: string) => setDate(db.positionDuPlan(iso).date), []);

  return {
    screen,
    setScreen,
    date,
    semaine,
    allerA,
    lang,
    setLang,

    /* Strava */
    strava: stravaEtat,
    stravaOn: stravaEtat?.lie ?? false,
    stravaJob,
    stravaErreur,
    stravaOrphelines: orphelines,
    lierStrava,
    delierStrava,
    synchroniser,
    /* Bumped whenever the activity table is rewritten, so screens re-read. */
    version,

    done,
    toggleDone: useCallback(() => setDone((v) => !v), []),
    rpe,
    setRpe,
    note,
    setNote,
    ana,
    runAnalyse,
    nextApplied,
    toggleNextApplied: useCallback(() => setNextApplied((v) => !v), []),

    recalc,
    runRecalc,
    excuse,
    pickExcuse,
    excuseApplied,
    toggleExcuseApplied: useCallback(() => setExcuseApplied((v) => !v), []),
    applied,
    toggleAdjustment,

    settingsOpen,
    openSettings: useCallback(() => setSettingsOpen(true), []),
    closeSettings: useCallback(() => setSettingsOpen(false), []),
    sessionId,
    openSession: useCallback((id: number) => setSessionId(id), []),
    closeSession: useCallback(() => setSessionId(null), []),
    typeCode,
    openType: useCallback((code: TypeCode) => setTypeCode(code), []),
    closeType: useCallback(() => setTypeCode(null), []),
  };
}

export type App = ReturnType<typeof useApp>;
