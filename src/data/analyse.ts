/* The coach's half of the app: what Claude says about a session that happened,
   and what it answers in a chat bar.

   The division is the one the methodology service already draws, applied one
   level down. **Every figure on this screen is computed here.** The drift
   between the first work block and the last, the realised pace against the
   zone the session was written in, the felt RPE against its target, the load
   against what was planned — all of it comes out of `msc_activity`,
   `msc_journal` and the engine, and `check:strava` asserts it.

   What Claude adds is the reading: the verdict, what went well, what to watch,
   and an adjustment expressed as a zone and a fraction of the planned
   duration. `appliquerAdaptation` turns that back into minutes and a pace,
   using the same engine as everything else — so a model that names a zone that
   does not exist, or asks for a session twice as long, cannot put a wrong
   number on the screen. */

import * as db from './db';
import type {
  MscActivity,
  MscAnalyseStat,
  MscAjustement,
  MscEcartStat,
  MscJournal,
  MscPlanSession,
  SeanceAvant,
  Lang,
  ZoneCode,
} from './types';
import { RACINE_API } from './base';

const ENDPOINT_ANALYSE = `${RACINE_API}/analyse`;
const ENDPOINT_COACH = `${RACINE_API}/coach`;
const ENDPOINT_RECALCUL = `${RACINE_API}/recalcul`;

/* Beyond these, the figure is worth a second look rather than a nod. Réglables
   dans le back office (msc_param) ; ces valeurs sont le défaut du code. */
const DERIVE_S = () => db.param('moteur.derive_s', 5);
const ECART_ALLURE_S = () => db.param('moteur.ecart_allure_s', 10);
const SURCHARGE = () => db.param('moteur.surcharge', 1.15);

const OK = '#0A1C33';
const ATTENTION = '#BA7517';
const BON = '#038870';

export class CoachError extends Error {}

/* ------------------------------------------------------- ce que le serveur rend */

export interface AnalyseObservation {
  ton: 'bon' | 'attention';
  lignes: string[];
}

export interface AnalyseAdaptation {
  zone: string;
  part_duree: number;
  pourquoi: string;
}

export interface AnalyseClaude {
  verdict: string;
  observations: AnalyseObservation[];
  adaptation: AnalyseAdaptation | null;
  /** What Claude went and read in Strava beyond what we handed it. */
  strava_lu: string[];
  /** Whether the MCP server was actually reachable for this call. */
  strava: boolean;
  modele: string;
  cout_eur: number;
}

export interface ReponseCoach {
  texte: string;
  strava_lu: string[];
  strava: boolean;
  modele: string;
  cout_eur: number;
}

export interface TourDeChat {
  role: 'user' | 'assistant';
  texte: string;
}

/* ------------------------------------------------------------ les chiffres */

/** Mean of the work blocks, in seconds per km. */
function moyenneBlocs(blocs: number[]): number {
  return blocs.reduce((t, b) => t + b, 0) / blocs.length;
}

/** The zone a session is judged on: the fastest one it was written in. */
function zonePrincipale(session: MscPlanSession): ZoneCode | undefined {
  return session.zones.length ? session.zones[session.zones.length - 1] : undefined;
}

function signe(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

/**
 * The stats the analysis panel shows, computed from what was actually done.
 *
 * Which pace is compared to which zone is the one judgement here, and it
 * follows the session's shape: an interval session is judged on its work
 * blocks against the hard zone it was written in — comparing a whole session
 * average, warm-up included, to a threshold pace would report every athlete as
 * slow. A session run at one effort is judged on its average.
 */
export function statsDeSeance(
  session: MscPlanSession,
  activite?: MscActivity,
  journal?: MscJournal,
): MscAnalyseStat[] {
  const stats: MscAnalyseStat[] = [];
  const blocs = activite?.splits_blocs ?? [];
  const zone = zonePrincipale(session);

  /* Drift: what the last work block cost against the first. It is the number
     the adjustment rules watch, and it only exists on a session with blocks. */
  if (blocs.length >= 2) {
    const derive = Math.round(blocs[blocs.length - 1] - blocs[0]);
    stats.push({
      valeur: `${signe(derive)} s/km`,
      icon: derive > 0 ? 'trending-down' : 'trending-up',
      couleur: derive > DERIVE_S() ? ATTENTION : BON,
      label: {
        fr: `dérive B1 → B${blocs.length}`,
        pl: `spadek B1 → B${blocs.length}`,
      },
    });
  }

  /* Pace against the zone the session was written in. */
  if (zone && activite) {
    const cible = db.allureSecondes(zone, session.bloc);
    const realise = blocs.length
      ? moyenneBlocs(blocs)
      : activite.allure_moy
        ? secondesDAllure(activite.allure_moy)
        : undefined;
    if (realise !== undefined) {
      const ecart = Math.round(realise - cible);
      stats.push({
        valeur: db.formatAllure(realise),
        icon: 'gauge',
        couleur: Math.abs(ecart) > ECART_ALLURE_S() ? ATTENTION : OK,
        label: {
          fr: `${blocs.length ? 'blocs' : 'moyenne'} · cible ${db.formatAllure(cible)}`,
          pl: `${blocs.length ? 'bloki' : 'średnia'} · cel ${db.formatAllure(cible)}`,
        },
      });
    }
  }

  /* Felt RPE against the target the plan set. */
  if (journal) {
    stats.push({
      valeur: String(journal.rpe_ressenti),
      icon: 'activity',
      couleur: journal.rpe_ressenti > session.rpe_cible ? ATTENTION : OK,
      label: {
        fr: `RPE · cible ${session.rpe_cible}`,
        pl: `RPE · cel ${session.rpe_cible}`,
      },
    });

    /* Foster's session-RPE, against what the plan budgeted for the day. */
    if (activite) {
      const charge = db.charge(activite.duree_min, journal.rpe_ressenti);
      stats.push({
        valeur: String(charge),
        icon: 'flame',
        couleur: charge > session.charge * SURCHARGE() ? ATTENTION : OK,
        label: {
          fr: `charge · prévue ${session.charge}`,
          pl: `obciążenie · plan ${session.charge}`,
        },
      });
    }
  }

  return stats;
}

/** "4:56/km" back to 296. */
export function secondesDAllure(allure: string): number {
  const [min, sec] = allure.split('/')[0].split(':').map(Number);
  return min * 60 + (sec || 0);
}

/* ------------------------------------------------- l'ajustement, en chiffres */

/* Slowest to fastest — the order the engine's offsets are written in, and the
   order that makes "no faster than planned" an index comparison. */
const ZONES: ZoneCode[] = [
  'recup', 'ef', 'endactive', 'marathon', 'semi', 'seuil', 'allure10', 'vma',
];

function estZone(code: string): code is ZoneCode {
  return (ZONES as string[]).includes(code);
}

const PART_MIN = 0.5;
const PART_MAX = 1;

/**
 * Turns Claude's adjustment into the line the screen shows.
 *
 * This is the guard rail, and it holds in two directions.
 *
 * A zone the engine does not know falls back to the one the session was
 * written in — and so does a zone *faster* than that one. An adjustment made
 * after a hard session protects the athlete; it does not sharpen the next
 * session. Deciding when to go hard is the plan's job, and the plan already
 * did it. The zones are ordered slowest to fastest, so that is an index
 * comparison.
 *
 * The fraction is clamped to what an adjustment can sensibly be: never longer
 * than planned, never less than half.
 *
 * Between the two, a model cannot put a number on this screen. It can only
 * choose among the ones the engine is willing to compute.
 */
export function appliquerAdaptation(
  adaptation: { zone?: string; part_duree: number; applique?: boolean; avant?: SeanceAvant },
  suivante: MscPlanSession,
): { session_avant: string; session_apres: string; zone?: ZoneCode; duree_min: number } {
  /* Une fois la proposition acceptée, il n'y a plus rien à calculer : la séance
     PORTE la durée et la zone proposées, et `avant` dit ce qu'elle était. La
     recalculer ici la réduirait une seconde fois à chaque affichage. */
  const avant = adaptation.applique ? adaptation.avant : undefined;
  if (avant) {
    const zone = zonePrincipale(suivante);
    return {
      session_avant: `${avant.duree_min} min`,
      session_apres: zone
        ? `${suivante.duree_min} min · ${db.allure(zone, suivante.bloc)}`
        : `${suivante.duree_min} min`,
      zone,
      duree_min: suivante.duree_min,
    };
  }

  const part = Number.isFinite(adaptation.part_duree)
    ? Math.min(PART_MAX, Math.max(PART_MIN, adaptation.part_duree))
    : PART_MAX;
  const duree_min = Math.round(suivante.duree_min * part);
  const session_avant = `${suivante.duree_min} min`;

  /* A Hyrox session, a swim, a ride: the plan writes no zone on them because
     they are not run in paces. The adjustment is then a duration and nothing
     else — printing "6:00/km" under a Hyrox circuit would be the same lie as
     putting a pace on a swim. */
  const planifiee = zonePrincipale(suivante);
  if (!planifiee) return { session_avant, session_apres: `${duree_min} min`, duree_min };

  const propose = adaptation.zone ?? '';
  const connue = estZone(propose) ? propose : planifiee;
  const zone = ZONES.indexOf(connue) > ZONES.indexOf(planifiee) ? planifiee : connue;

  return {
    session_avant,
    session_apres: `${duree_min} min · ${db.allure(zone, suivante.bloc)}`,
    zone,
    duree_min,
  };
}

/**
 * The session an adjustment would land on: the next one in the plan that is
 * actually trained. Adjusting a rest day is not an adjustment.
 */
export function prochaineSeance(session: MscPlanSession): MscPlanSession | undefined {
  return db
    .select('msc_session')
    .filter((s) => s.discipline !== 'Repos')
    .find((s) => s.date > session.date || (s.date === session.date && s.id > session.id));
}

/* ------------------------------------------------------------ les appels */

async function appeler<T>(chemin: string, corps: unknown): Promise<T> {
  let reponse: Response;
  try {
    reponse = await fetch(chemin, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corps),
    });
  } catch {
    throw new CoachError('Le serveur de plan ne répond pas. Lance-le avec « npm run server ».');
  }
  const data = await reponse.json().catch(() => ({}));
  if (!reponse.ok) {
    throw new CoachError(
      (data as { erreur?: string })?.erreur ?? `Le serveur a répondu ${reponse.status}.`,
    );
  }
  return data as T;
}

/** Everything the server needs about a session, and nothing it does not. */
function briefDeSeance(session: MscPlanSession, lang: Lang = 'fr') {
  return {
    id: session.id,
    date: session.date,
    semaine: session.semaine,
    bloc: session.bloc,
    discipline: session.discipline,
    type: session.type,
    duree_min: session.duree_min,
    rpe_cible: session.rpe_cible,
    charge: session.charge,
    zones: session.zones,
    titre: session.titre[lang],
    detail: session.detail[lang],
  };
}

export function demanderAnalyse(
  session: MscPlanSession,
  options: {
    activite?: MscActivity;
    /* `limites_recentes` : ce qui a bloqué sur les séances d'avant, pour que
       le coach voie « les jambes, trois fois de suite » sans relire le journal. */
    journal?: MscJournal & { note?: string; limites_recentes?: string[] };
    suivante?: MscPlanSession;
    lang?: Lang;
  } = {},
): Promise<AnalyseClaude> {
  const lang = options.lang ?? 'fr';
  const stats = statsDeSeance(session, options.activite, options.journal);

  return appeler<AnalyseClaude>(ENDPOINT_ANALYSE, {
    langue: lang,
    athlete: {
      nom: db.athlete.nom,
      ref_actuelle: db.format10k(db.athlete.ref_actuelle_s),
      ref_cible: db.format10k(db.athlete.ref_cible_s),
    },
    session: {
      ...briefDeSeance(session, lang),
      suivante: options.suivante ? briefDeSeance(options.suivante, lang) : undefined,
    },
    /* The computed pace grid, so Claude names zones against real numbers. */
    allures: session.zones.map((code) => ({
      zone: db.zone(code).label[lang],
      valeur: db.allure(code, session.bloc),
    })),
    activite: options.activite,
    journal: options.journal,
    stats: stats.map((s) => ({ label: s.label[lang], valeur: s.valeur })),
  });
}

export function demanderCoach(
  question: string,
  options: { contexte?: string; historique?: TourDeChat[]; lang?: Lang } = {},
): Promise<ReponseCoach> {
  return appeler<ReponseCoach>(ENDPOINT_COACH, {
    question,
    contexte: options.contexte,
    historique: options.historique,
    langue: options.lang ?? 'fr',
  });
}

/* ============================================================================
   La semaine — « Recalculer le plan »

   Same split, one scope up. The gap between what the week planned and what the
   week got is arithmetic, so it is computed here; what to do about it is a
   reading, so it is Claude's. The plan itself is not rewritten — the
   adjustments are proposals the athlete accepts one at a time, which is what
   the Coach screen has always done with them. */

/* A weekly rebalance may lengthen a session as well as shorten one — a swim
   picking up what a missed run gave back. It may not double it. */
const PART_SEMAINE_MIN = 0.5;
const PART_SEMAINE_MAX = 1.25;

/** 97 → "1h37", 45 → "45 min". The gap card's own dialect. */
function hm(minutes: number): string {
  const m = Math.round(Math.abs(minutes));
  const h = Math.floor(m / 60);
  return h ? `${h}h${String(m % 60).padStart(2, '0')}` : `${m} min`;
}

/** 2600 → "2 600" — the workbook's thousands separator. */
function milliers(n: number): string {
  return Math.round(n).toLocaleString('fr-FR').replace(/ | /g, ' ');
}

export interface EcartCalcule {
  semaine: number;
  /** Planned minutes that came due and were not done. Never negative. */
  retard_min: number;
  sautees: number;
  realisation_pct: number;
  du: { minutes: number; seances: number };
  fait: { minutes: number; seances: number };
  stats: MscEcartStat[];
}

/**
 * What the week owes, as of a date.
 *
 * Only sessions that have already come due count. The settings sheet lets you
 * walk the thirty weeks, and a week still in the future would otherwise report
 * every one of its sessions as skipped and 0 % realised — a gap the athlete
 * has not had the chance to open yet.
 *
 * Rest days are not sessions and cannot be missed.
 */
export function ecartDeSemaine(semaine: number, jusquA: string): EcartCalcule {
  const du = db
    .sessionsDeSemaine(semaine)
    .filter((s) => s.discipline !== 'Repos' && s.date <= jusquA);

  const faites = new Set(
    db
      .select('msc_activity')
      .map((a) => a.session_id)
      .filter((id): id is number => id !== undefined),
  );
  const fait = du.filter((s) => faites.has(s.id));

  const minutes = (rows: MscPlanSession[]) => rows.reduce((t, s) => t + s.duree_min, 0);
  const duMin = minutes(du);
  const faitMin = minutes(fait);
  const retard_min = Math.max(0, duMin - faitMin);
  const realisation_pct = duMin === 0 ? 100 : Math.round((faitMin / duMin) * 100);
  const sautees = du.length - fait.length;

  return {
    semaine,
    retard_min,
    sautees,
    realisation_pct,
    du: { minutes: duMin, seances: du.length },
    fait: { minutes: faitMin, seances: fait.length },
    stats: [
      {
        valeur: retard_min ? `−${hm(retard_min)}` : hm(0),
        icon: 'clock',
        label: { fr: 'volume en retard', pl: 'zaległej objętości' },
      },
      {
        valeur: String(sautees),
        icon: 'calendar-x',
        label: { fr: 'séances sautées', pl: 'opuszczone treningi' },
      },
      {
        valeur: `${realisation_pct} %`,
        icon: 'percent',
        label: { fr: 'réalisation', pl: 'realizacja' },
      },
    ],
  };
}

/* ------------------------------------------------------ ce que Claude propose */

export interface AjustementPropose {
  /** A session to resize. Mutually exclusive with `semaine`. */
  session_id: number | null;
  /** A week-scoped note — a move, a reordering. */
  semaine: number | null;
  /** The session's headline quantity, as a fraction of what was planned. */
  part: number | null;
  /** The week-scoped note's text, and its session type for the chip. */
  texte: string | null;
  type: string | null;
}

export interface RecalculClaude {
  ecart: string;
  recalcul: { portee: string; texte: string }[];
  verdict: string;
  observations: AnalyseObservation[];
  ajustements: AjustementPropose[];
  strava_lu: string[];
  strava: boolean;
  modele: string;
  cout_eur: number;
}

/**
 * Le libellé d'un ajustement, rendu au moment de l'afficher.
 *
 * La base garde une séance et une part de sa quantité ; « Sortie longue
 * 1h37 → 1h20 » se recompose ici. Un ajustement de semaine n'a pas de
 * quantité : il porte sa phrase, et c'est elle qui s'affiche.
 *
 * Rend undefined quand l'ajustement nomme une séance absente du plan — une
 * carte qui n'apparaît pas plutôt qu'une carte fausse.
 */
export function libelleAjustement(
  a: MscAjustement,
  lang: Lang = 'fr',
): { quoi: string; quand: string } | undefined {
  if (a.session_id === undefined) {
    const texte = a.texte?.[lang];
    if (!a.semaine || !texte) return undefined;
    return { quoi: texte, quand: lang === 'fr' ? `Semaine ${a.semaine}` : `Tydzień ${a.semaine}` };
  }

  const session = db.one('msc_session', (s) => s.id === a.session_id);
  if (!session) return undefined;

  /* Accepté : la séance porte déjà la nouvelle quantité, et `avant` dit d'où
     elle vient. Pas accepté : la quantité proposée se calcule. Dans les deux
     cas la flèche dit vrai — c'est tout ce qu'on lui demande. */
  const avant = a.applique ? a.avant : undefined;
  const part = Number.isFinite(a.part)
    ? Math.min(PART_SEMAINE_MAX, Math.max(PART_SEMAINE_MIN, a.part as number))
    : 1;

  /* Une nage est écrite en mètres et une course en minutes : chacune parle du
     nombre dont elle est faite. */
  const enMetres = Boolean(session.natation_m ?? avant?.natation_m);
  const quantite = (s: { duree_min: number; natation_m?: number | null }) =>
    enMetres ? (s.natation_m ?? 0) : s.duree_min;

  const de = quantite(avant ?? session);
  const vers = avant ? quantite(session) : quantite(session) * part;

  const quoi = enMetres
    ? `${session.titre_court[lang]} ${milliers(de)} → ${milliers(vers)} m`
    : `${session.titre_court[lang]} ${hm(de)} → ${hm(vers)}`;

  return {
    quoi,
    quand: lang === 'fr'
      ? `${session.jour_long} · S${session.semaine}`
      : `${session.jour[lang]} · T${session.semaine}`,
  };
}

/* --------------------------------------------------------------- les appels */

export function demanderRecalcul(
  semaine: number,
  calcule: EcartCalcule,
  lang: Lang = 'fr',
): Promise<RecalculClaude> {
  const sessions = db.sessionsDeSemaine(semaine);
  const faites = new Set(
    db
      .select('msc_activity')
      .map((a) => a.session_id)
      .filter((id): id is number => id !== undefined),
  );

  return appeler<RecalculClaude>(ENDPOINT_RECALCUL, {
    langue: lang,
    semaine,
    athlete: {
      nom: db.athlete.nom,
      ref_actuelle: db.format10k(db.athlete.ref_actuelle_s),
      ref_cible: db.format10k(db.athlete.ref_cible_s),
    },
    bloc: db.blocDeSemaine(semaine).code,
    ecart: {
      retard: calcule.stats[0].valeur,
      sautees: calcule.sautees,
      realisation: calcule.stats[2].valeur,
      du_min: calcule.du.minutes,
      fait_min: calcule.fait.minutes,
    },
    /* Every session of the week and whether it happened — the set Claude may
       name a `session_id` from, and nothing outside it. */
    seances: sessions.map((s) => ({
      id: s.id,
      date: s.date,
      jour: s.jour_long,
      titre: s.titre_court[lang],
      discipline: s.discipline,
      type: s.type,
      duree_min: s.duree_min,
      natation_m: s.natation_m,
      zones: s.zones,
      faite: faites.has(s.id),
    })),
    /* The weeks that follow, so a move has somewhere to land. */
    suite: db
      .select('msc_week', (w) => w.semaine > semaine && w.semaine <= semaine + 4)
      .map((w) => ({ semaine: w.semaine, phase: w.phase, bloc: w.bloc, heures: w.heures })),
    /* The adjustment rules as prose, so the recalculation reasons the way the
       plan does rather than inventing its own doctrine. */
    regles: db.select('msc_regle').map((r) => `${r.si[lang]} → ${r.alors[lang]} (${r.gravite})`),
  });
}
