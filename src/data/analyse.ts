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
  MscAdaptation,
  MscAnalyse,
  MscAnalyseStat,
  MscJournal,
  MscPlanSession,
  Lang,
  ZoneCode,
} from './types';

const ENDPOINT_ANALYSE = '/api/analyse';
const ENDPOINT_COACH = '/api/coach';

/* Beyond these, the figure is worth a second look rather than a nod. */
const DERIVE_S = 5;
const ECART_ALLURE_S = 10;
const SURCHARGE = 1.15;

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
      couleur: derive > DERIVE_S ? ATTENTION : BON,
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
        couleur: Math.abs(ecart) > ECART_ALLURE_S ? ATTENTION : OK,
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
        couleur: charge > session.charge * SURCHARGE ? ATTENTION : OK,
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
  adaptation: AnalyseAdaptation,
  suivante: MscPlanSession,
): { session_apres: string; zone?: ZoneCode; duree_min: number } {
  const part = Number.isFinite(adaptation.part_duree)
    ? Math.min(PART_MAX, Math.max(PART_MIN, adaptation.part_duree))
    : PART_MAX;
  const duree_min = Math.round(suivante.duree_min * part);

  /* A Hyrox session, a swim, a ride: the plan writes no zone on them because
     they are not run in paces. The adjustment is then a duration and nothing
     else — printing "6:00/km" under a Hyrox circuit would be the same lie as
     putting a pace on a swim. */
  const planifiee = zonePrincipale(suivante);
  if (!planifiee) return { session_apres: `${duree_min} min`, duree_min };

  const propose = adaptation.zone;
  const connue = estZone(propose) ? propose : planifiee;
  const zone = ZONES.indexOf(connue) > ZONES.indexOf(planifiee) ? planifiee : connue;

  return {
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

/**
 * Turns Claude's reading into the two rows the Aujourd'hui screen renders.
 *
 * The stats are recomputed here rather than taken from the response — they were
 * only ever sent to Claude so it could cite them, and the screen must show what
 * the engine says, not what came back over the wire.
 *
 * Both language keys carry the same text: the call was made in one language,
 * and inventing the other by machine would be worse than repeating it. Ask
 * again with the switch flipped and the answer comes back in the other one.
 */
export function enregistrerAnalyse(
  reponse: AnalyseClaude,
  session: MscPlanSession,
  options: {
    activite?: MscActivity;
    journal?: MscJournal;
    suivante?: MscPlanSession;
  } = {},
): void {
  const id = db.prochainAnalyseId();
  const deux = (v: string) => ({ fr: v, pl: v });

  const analyse: MscAnalyse = {
    id,
    date: session.date,
    type: 'seance',
    session_id: session.id,
    modele: reponse.modele,
    cout_eur: reponse.cout_eur,
    verdict: deux(reponse.verdict),
    stats: statsDeSeance(session, options.activite, options.journal),
    blocs: reponse.observations.map((o) => ({
      icon: o.ton === 'bon' ? 'circle-check' : 'triangle-alert',
      couleur: o.ton === 'bon' ? BON : ATTENTION,
      items: { fr: o.lignes, pl: o.lignes },
    })),
  };

  let adaptation: MscAdaptation | undefined;
  if (reponse.adaptation && options.suivante) {
    const suivante = options.suivante;
    const { session_apres } = appliquerAdaptation(reponse.adaptation, suivante);
    adaptation = {
      id: db.prochainAdaptationId(),
      analyse_id: id,
      session_id: suivante.id,
      type: suivante.type,
      session_avant: deux(`${suivante.titre_court.fr} · ${suivante.duree_min} min`),
      session_apres,
      pourquoi: deux(reponse.adaptation.pourquoi),
    };
  }

  db.setAnalyse(analyse, adaptation);
}

export function demanderAnalyse(
  session: MscPlanSession,
  options: {
    activite?: MscActivity;
    journal?: MscJournal & { note?: string };
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
