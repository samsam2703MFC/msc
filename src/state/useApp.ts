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
import * as api from '../data/api';
import * as cache from '../data/cache';
import type { ApercuAthlete, Lang, ScreenKey, TypeCode } from '../data/types';

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

export type Amorce = 'chargement' | 'connexion' | 'pret' | 'erreur';

export function useApp() {
  const [screen, setScreen] = useState<ScreenKey>('today');

  /* L'amorçage. Aucun écran ne s'affiche avant « pret » : les tables sont vides
     jusqu'à ce que l'instantané arrive, et `db.athlete` crie plutôt que de
     rendre zéro — c'est voulu, une allure de 0:00 affichée sans protester
     serait pire qu'un écran de chargement. */
  const [amorce, setAmorce] = useState<Amorce>('chargement');
  const [identite, setIdentite] = useState<api.Identite | null>(null);
  const [amorceErreur, setAmorceErreur] = useState<string | null>(null);

  /* Where the plan is. Defaults to the real date, clamped into the plan's
     span; the settings sheet lets you move it to walk the thirty weeks. */
  const [date, setDate] = useState('');

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
  const [profilOpen, setProfilOpen] = useState(false);
  const [apercu, setApercu] = useState<ApercuAthlete[] | null>(null);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [typeCode, setTypeCode] = useState<TypeCode | null>(null);

  const [anaErreur, setAnaErreur] = useState<string | null>(null);

  /* Both halves below write into the database behind the accessors, which React
     has no way to notice. Bumping this is what tells it something changed. */
  const [version, setVersion] = useState(0);

  /* La semaine se relit à chaque instantané, pas seulement quand la date bouge :
     passer sur un athlète sans plan garde la même date, et « S2 » resterait
     affiché pour quelqu'un qui n'a pas de semaine 2. */
  const semaine = useMemo(
    () => (db.chargee ? db.positionDuPlan(date).semaine : 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [date, version],
  );

  /* Nothing async may touch state after the hook is gone. */
  const monte = useRef(true);

  /* L'amorçage Strava n'a lieu qu'une fois par session ouverte, et la
     déconnexion le réarme. Déclaré ici parce que les deux moitiés du fichier
     s'en servent. */
  const stravaAmorce = useRef(false);

  /* One analysis at a time — a second press while the first is in flight would
     spend a second call to overwrite the first. */
  const anaRef = useRef(false);
  const [recalcErreur, setRecalcErreur] = useState<string | null>(null);
  const recalcRef = useRef(false);

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

  /* Recharger la base. C'est le geste central du basculement : le serveur est
     la vérité, et tout ce qui écrit se termine par un rechargement plutôt que
     par une écriture parallèle en mémoire. Deux copies divergent toujours. */
  const [enLigne, setEnLigne] = useState(
    () => typeof navigator === 'undefined' || navigator.onLine,
  );
  const [enAttente, setEnAttente] = useState(0);

  const appliquerInstantane = useCallback((instantane: db.Instantane) => {
    db.charger(instantane);
    setDate((actuelle) => db.positionDuPlan(actuelle || db.aujourdhuiISO()).date);
    setVersion((v) => v + 1);
  }, []);

  /* Le serveur d'abord, le cache si le réseau manque.
     La copie locale n'est jamais une source : elle sert à relire son plan dans
     un tunnel, et le premier rechargement réussi la remplace. */
  const recharger = useCallback(
    async (athleteId?: number | null) => {
      try {
        const instantane = await api.instantane(athleteId);
        appliquerInstantane(instantane);
        setEnLigne(true);
        const id = instantane.athlete_id ?? athleteId ?? null;
        if (id) void cache.ecrireInstantane(id, instantane);
        return instantane;
      } catch (e) {
        const id = athleteId ?? db.athleteId;
        if (!api.estReseau(e) || !id) throw e;
        const garde = await cache.lireInstantane(id);
        if (!garde) throw e;
        appliquerInstantane(garde);
        setEnLigne(false);
        return garde;
      }
    },
    [appliquerInstantane],
  );

  /* Ce que l'athlète a tapé sans réseau part dès qu'il y en a. Le serveur
     dédoublonne sur l'identifiant de mutation, donc rejouer est sans risque —
     c'est ce qui permet de le faire sans compter les tentatives. */
  /* Un seul rejeu à la fois. L'événement « online » et l'ouverture de session
     peuvent tomber ensemble ; deux rejeux en parallèle enverraient deux fois la
     même mutation. Le serveur le supporte — il dédoublonne — mais lui faire
     faire le travail pour rien n'est pas une raison de le laisser arriver. */
  const rejeuEnCours = useRef(false);
  const vider = useCallback(async () => {
    if (rejeuEnCours.current) return;
    rejeuEnCours.current = true;
    try {
      const { envoyees, reste } = await api.rejouerFile();
      if (!monte.current) return;
      setEnAttente(reste);
      if (envoyees > 0) await recharger(db.athleteId);
    } finally {
      rejeuEnCours.current = false;
    }
  }, [recharger]);

  useEffect(() => {
    const revenu = () => {
      setEnLigne(true);
      void vider();
    };
    const parti = () => setEnLigne(false);
    window.addEventListener('online', revenu);
    window.addEventListener('offline', parti);
    return () => {
      window.removeEventListener('online', revenu);
      window.removeEventListener('offline', parti);
    };
  }, [vider]);

  const ouvrir = useCallback(
    async (qui: api.Identite) => {
      setIdentite(qui);
      void cache.ecrireIdentite(qui);
      await recharger(qui.athletes[0]?.id ?? null);
      setAmorce('pret');
      /* Ce qui attendait d'une session précédente part maintenant. */
      void vider();
    },
    [recharger, vider],
  );

  /* Au démarrage : qui es-tu, puis ta base. Un 401 n'est pas une erreur, c'est
     l'écran de connexion. */
  useEffect(() => {
    void (async () => {
      try {
        await ouvrir(await api.moi());
      } catch (e) {
        if (!monte.current) return;
        if (e instanceof api.ApiError && e.nonConnecte) {
          setAmorce('connexion');
          return;
        }
        /* Sans réseau, on démarre sur la copie locale plutôt que sur un écran
           d'erreur : c'est exactement la situation où l'athlète veut relire sa
           séance — dans un tunnel, au fond d'une salle. */
        if (api.estReseau(e)) {
          const garde = await cache.dernierInstantane();
          if (garde) {
            appliquerInstantane(garde);
            setIdentite((await cache.lireIdentite<api.Identite>()) ?? null);
            setEnLigne(false);
            setAmorce('pret');
            return;
          }
        }
        setAmorceErreur(message(e));
        setAmorce('erreur');
      }
    })();
    /* Une fois, au montage. */
  }, [appliquerInstantane, ouvrir]);

  const seConnecter = useCallback(
    async (email: string, motDePasse: string) => {
      setAmorceErreur(null);
      /* L'amorce reste sur « connexion » pendant la tentative : basculer sur
         « chargement » démonterait le formulaire, et un mot de passe raté
         rendrait les deux champs vides — il faudrait retaper l'adresse à chaque
         essai. Le formulaire a son propre indicateur pour ça. */
      try {
        await ouvrir(await api.connexion(email, motDePasse));
      } catch (e) {
        if (!monte.current) return;
        setAmorceErreur(message(e));
        throw e;
      }
    },
    [ouvrir],
  );

  const seDeconnecter = useCallback(async () => {
    try {
      await api.deconnexion();
    } catch {
      /* Le cookie est de toute façon oublié côté client juste après. */
    }
    /* Vider les tables, et pas seulement l'écran : les données d'un athlète ne
       doivent pas rester lisibles par le suivant qui se connecte ici. */
    db.vider();
    /* La copie locale part avec : les données d'un athlète ne doivent pas
       rester lisibles par le suivant qui se connecte sur cet appareil. La file
       d'attente, elle, survit — elle appartient à celui qui l'a remplie. */
    void cache.oublierInstantanes();
    stravaAmorce.current = false;
    brutes.current = [];
    details.current.clear();
    vu.current = null;
    setIdentite(null);
    setStravaEtat(null);
    setStravaErreur(null);
    setChats({});
    setVersion((v) => v + 1);
    setAmorce('connexion');
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

  /* L'appariement a besoin du plan, donc il se fait ici ; ce qui en sort part
     au serveur, qui le range. Puis on relit : le serveur est la vérité, même
     quand c'est nous qui venons de la lui donner. */
  const appliquer = useCallback(async () => {
    const sessions = db.select('msc_session');
    const resultat = strava.apparier(brutes.current, sessions, details.current);
    await api.ecrireActivites(resultat.activites);
    await recharger(db.athleteId);
    if (monte.current) setOrphelines(resultat.orphelines);
    return resultat;
  }, [recharger]);

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
      if (monte.current) await appliquer();
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
      await appliquer();
      await rafraichirEtat();
      await completerDetails(db.positionDuPlan(date).semaine);
    } catch (e) {
      if (monte.current) setStravaErreur(message(e));
    } finally {
      if (monte.current) setStravaJob('idle');
    }
  }, [appliquer, completerDetails, date, rafraichirEtat]);

  /* Une fois la base ouverte : que sait le serveur de Strava ? Si l'athlète est
     déjà lié d'une session précédente, ses activités sont là avant qu'il ne
     demande.

     Après l'amorçage, pas avant : /api/strava/etat est une route authentifiée,
     et l'appeler depuis l'écran de connexion ne fait que produire un 401 et
     poser une erreur « Non connecté » qui s'afficherait ensuite dans les
     paramètres. */
  useEffect(() => {
    if (amorce !== 'pret' || stravaAmorce.current) return;
    stravaAmorce.current = true;
    void (async () => {
      const e = await rafraichirEtat();
      if (e?.lie) {
        vu.current = e.dernier_evenement;
        await synchroniser();
      }
    })();
    /* Une seule fois : `synchroniser` capture la date du plan, et parcourir les
       trente semaines ne doit pas retélécharger toute la période à chaque pas.
       Les synchros suivantes sont celles du webhook, ou celles de l'athlète. */
  }, [amorce]);

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
          await recharger(db.athleteId);
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
    setOrphelines([]);
    await recharger(db.athleteId);
    await rafraichirEtat();
  }, [rafraichirEtat, recharger]);

  /* Le RPE et la note. Écrits quand l'athlète quitte le champ, et de nouveau
     juste avant une analyse — c'est le moment où ils comptent, puisque c'est ce
     que le coach lit. */
  const enregistrerJournal = useCallback(async () => {
    if (!db.chargee || db.droit !== 'ecriture') return;
    const session = db.sessionDuJour(date);
    try {
      const r = await api.ecrireJournal({
        date,
        session_id: session?.id ?? null,
        rpe,
        note: note.trim() || undefined,
      });
      if (api.estDiffere(r) && monte.current) setEnAttente((n) => n + 1);
    } catch (e) {
      if (monte.current) setAnaErreur(message(e));
    }
  }, [date, note, rpe]);

  /* Accepter une proposition du coach. L'état optimiste garde le bouton vif ;
     le rechargement dit le vrai. */
  const accepter = useCallback(
    async (table: 'msc_adaptation' | 'msc_ajustement', id: number, applique: boolean) => {
      try {
        await api.proposition(table, id, applique);
        await recharger(db.athleteId);
      } catch (e) {
        if (monte.current) setAnaErreur(message(e));
      }
    },
    [recharger],
  );

  /* --------------------------------------------------------------- le plan */

  const [planJob, setPlanJob] = useState<'idle' | 'envoi' | 'fait'>('idle');
  const [planErreur, setPlanErreur] = useState<string | null>(null);

  /* Enregistrer un plan généré. Le rechargement qui suit n'est pas un
     rafraîchissement de confort : l'application entière lit le plan actif, et
     ce n'est plus le même. */
  const enregistrerPlan = useCallback(
    async (corps: Parameters<typeof api.enregistrerPlan>[0]) => {
      setPlanJob('envoi');
      setPlanErreur(null);
      try {
        const r = await api.enregistrerPlan(corps);
        await recharger(db.athleteId);
        if (monte.current) setPlanJob('fait');
        return r;
      } catch (e) {
        if (monte.current) {
          setPlanErreur(message(e));
          setPlanJob('idle');
        }
        return null;
      }
    },
    [recharger],
  );

  /* --------------------------------------------------------- le back office */

  const [coursesErreur, setCoursesErreur] = useState<string | null>(null);

  const enregistrerCompetition = useCallback(
    async (c: Parameters<typeof api.ecrireCompetition>[0]) => {
      setCoursesErreur(null);
      try {
        await api.ecrireCompetition(c);
        await recharger(db.athleteId);
        return true;
      } catch (e) {
        if (monte.current) setCoursesErreur(message(e));
        return false;
      }
    },
    [recharger],
  );

  const supprimerCompetition = useCallback(
    async (id: number) => {
      setCoursesErreur(null);
      try {
        await api.supprimerCompetition(id);
        await recharger(db.athleteId);
      } catch (e) {
        if (monte.current) setCoursesErreur(message(e));
      }
    },
    [recharger],
  );

  /* ------------------------------------------------------------- la photo */

  const [photoJob, setPhotoJob] = useState<'idle' | 'envoi'>('idle');
  const [photoErreur, setPhotoErreur] = useState<string | null>(null);

  /* La photo part telle quelle et revient lue. Ce que Claude en tire n'est pas
     encore le poids de l'athlète : c'est une proposition, et `confirmerMesure`
     est le seul chemin qui la fait compter. */
  const envoyerPhoto = useCallback(
    async (fichier: File) => {
      if (photoJob === 'envoi') return;
      setPhotoJob('envoi');
      setPhotoErreur(null);
      try {
        const r = await api.envoyerPhoto(fichier, date);
        if (api.estDiffere(r)) setEnAttente((n) => n + 1);
        else await recharger(db.athleteId);
      } catch (e) {
        if (monte.current) setPhotoErreur(message(e));
      } finally {
        if (monte.current) setPhotoJob('idle');
      }
    },
    [date, photoJob, recharger],
  );

  const confirmerMesure = useCallback(
    async (corps: { date: string; poids_kg?: number | null; fc_repos?: number | null; rejeter?: boolean }) => {
      setPhotoErreur(null);
      try {
        const r = await api.confirmerMesure(corps);
        if (api.estDiffere(r)) setEnAttente((n) => n + 1);
        else await recharger(db.athleteId);
      } catch (e) {
        if (monte.current) setPhotoErreur(message(e));
      }
    },
    [recharger],
  );

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
        await enregistrerJournal();

        await coach.demanderAnalyse(session, {
          activite,
          journal,
          suivante,
          lang,
        });
        if (!monte.current) return;
        /* Le serveur a rangé l'analyse et sa proposition ; on relit plutôt que
           d'écrire une seconde copie en mémoire. */
        await recharger(db.athleteId);
        if (!monte.current) return;
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
  }, [date, enregistrerJournal, lang, note, rpe]);

  /* Recalculating the weeks that follow; a second press folds the result away.

     The gap itself is arithmetic and is recomputed on every render — what this
     call buys is the reading of it: what the recalibration changes, over which
     stretch of the plan, and which sessions move. */
  const runRecalc = useCallback(() => {
    if (recalcRef.current) return;
    if (recalc === 'done') {
      setRecalc('idle');
      return;
    }
    recalcRef.current = true;
    setRecalc('running');
    setRecalcErreur(null);

    void (async () => {
      try {
        const calcule = coach.ecartDeSemaine(semaine, date);
        await coach.demanderRecalcul(semaine, calcule, lang);
        if (!monte.current) return;
        await recharger(db.athleteId);
        if (!monte.current) return;
        setRecalc('done');
      } catch (e) {
        if (monte.current) {
          setRecalcErreur(message(e));
          setRecalc('idle');
        }
      } finally {
        recalcRef.current = false;
      }
    })();
  }, [date, lang, recalc, semaine]);

  const pickExcuse = useCallback((code: string) => {
    setExcuse((current) => (current === code ? null : code));
    setExcuseApplied(false);
  }, []);

  const toggleAdjustment = useCallback((id: number) => {
    setApplied((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const allerA = useCallback((iso: string) => setDate(db.positionDuPlan(iso).date), []);

  return {
    /* l'amorçage */
    amorce,
    enLigne,
    enAttente,
    amorceErreur,
    identite,
    seConnecter,
    seDeconnecter,
    recharger,

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
    recalcErreur,
    runRecalc,
    excuse,
    pickExcuse,
    excuseApplied,
    toggleExcuseApplied: useCallback(() => setExcuseApplied((v) => !v), []),
    applied,
    toggleAdjustment,
    enregistrerJournal,
    accepter,

    planJob,
    planErreur,
    enregistrerPlan,

    coursesErreur,
    enregistrerCompetition,
    supprimerCompetition,

    photoJob,
    photoErreur,
    envoyerPhoto,
    confirmerMesure,

    settingsOpen,
    openSettings: useCallback(() => setSettingsOpen(true), []),
    closeSettings: useCallback(() => setSettingsOpen(false), []),

    /* le profil, la vue coach, la bascule d'athlète */
    profilOpen,
    openProfil: useCallback(() => setProfilOpen(true), []),
    closeProfil: useCallback(() => setProfilOpen(false), []),
    apercu,
    chargerApercu: useCallback(async () => {
      try { setApercu((await api.apercu()).athletes); } catch { setApercu([]); }
    }, []),
    basculerAthlete: useCallback(async (id: number) => {
      await recharger(id);
      setScreen('today');
    }, [recharger]),
    majProfil: useCallback(async (corps: Parameters<typeof api.majProfil>[0]) => {
      await api.majProfil(corps, db.athleteId);
      await recharger(db.athleteId);
      setApercu(null);
    }, [recharger]),
    sessionId,
    openSession: useCallback((id: number) => setSessionId(id), []),
    closeSession: useCallback(() => setSessionId(null), []),
    typeCode,
    openType: useCallback((code: TypeCode) => setTypeCode(code), []),
    closeType: useCallback(() => setTypeCode(null), []),
  };
}

export type App = ReturnType<typeof useApp>;
