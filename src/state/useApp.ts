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
import * as coach from '../data/analyse';
import type { Lang, ScreenKey, TypeCode } from '../data/types';

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

  const [anaErreur, setAnaErreur] = useState<string | null>(null);

  /* Both halves below write into the database behind the accessors, which React
     has no way to notice. Bumping this is what tells it something changed. */
  const [version, setVersion] = useState(0);

  /* Nothing async may touch state after the hook is gone. */
  const monte = useRef(true);

  /* One analysis at a time — a second press while the first is in flight would
     spend a second call to overwrite the first. */
  const anaRef = useRef(false);
  const recalcTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(recalcTimer.current), []);

  /* The chat bars. Two of them — the Coach screen's and the one on each session
     sheet — so the threads are keyed and each keeps its own history. */
  const [chats, setChats] = useState<Record<string, coach.TourDeChat[]>>({});
  const [chatEnCours, setChatEnCours] = useState<string | null>(null);
  const [chatErreur, setChatErreur] = useState<string | null>(null);

  const demanderCoach = useCallback(
    async (cle: string, question: string, contexte?: string) => {
      const q = question.trim();
      if (!q || chatEnCours) return;
      const historique = chats[cle] ?? [];
      setChatErreur(null);
      setChats((prev) => ({ ...prev, [cle]: [...(prev[cle] ?? []), { role: 'user', texte: q }] }));
      setChatEnCours(cle);
      try {
        const r = await coach.demanderCoach(q, { contexte, historique, lang });
        if (!monte.current) return;
        setChats((prev) => ({
          ...prev,
          [cle]: [...(prev[cle] ?? []), { role: 'assistant', texte: r.texte }],
        }));
      } catch (e) {
        if (monte.current) setChatErreur(message(e));
      } finally {
        if (monte.current) setChatEnCours(null);
      }
    },
    [chatEnCours, chats, lang],
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


  /* The last bulk fetch, and the laps we have already paid a request for.
     Both are caches, so re-matching after the week changes costs nothing. */
  const brutes = useRef<strava.ActiviteStrava[]>([]);
  const details = useRef(new Map<number, strava.ActiviteDetaillee>());
  const liaison = useRef<number | undefined>(undefined);
  const vu = useRef<string | null>(null);

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

  /* Claude reads the session back and answers.

     What it is given is what the app already knows — the session, its computed
     zones, the synced activity, the journal — plus, through Strava's MCP
     server, the ability to go and look at what the sync did not keep. What
     comes back is prose and a zone; every figure on the panel is still the
     engine's. */
  const runAnalyse = useCallback(() => {
    if (anaRef.current) return;
    anaRef.current = true;
    setAna('running');
    setAnaErreur(null);

    void (async () => {
      try {
        const session = db.sessionDuJour(date);
        if (!session) throw new Error('Aucune séance ce jour-là.');

        const activite = db.one('msc_activity', (a) => a.session_id === session.id);
        const seed = db.one('msc_journal', (j) => j.session_id === session.id);
        const journal = {
          date: session.date,
          session_id: session.id,
          rpe_ressenti: rpe,
          sommeil: seed?.sommeil ?? 0,
          douleurs: seed?.douleurs ?? [],
          note: note.trim() || undefined,
        };
        const suivante = coach.prochaineSeance(session);

        const reponse = await coach.demanderAnalyse(session, {
          activite,
          journal,
          suivante,
          lang,
        });
        if (!monte.current) return;
        coach.enregistrerAnalyse(reponse, session, { activite, journal, suivante });
        setVersion((v) => v + 1);
        setAna('done');
      } catch (e) {
        if (monte.current) {
          setAnaErreur(message(e));
          setAna('idle');
        }
      } finally {
        anaRef.current = false;
      }
    })();
  }, [date, lang, note, rpe]);

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
    anaErreur,
    runAnalyse,

    chats,
    chatEnCours,
    chatErreur,
    demanderCoach,
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
