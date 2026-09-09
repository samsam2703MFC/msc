/* The Strava seam.

   Two halves live here, and the split is the same one the methodology service
   draws. The server does the part that needs a secret and a network — OAuth,
   the token, the fetch — and hands back what the athlete did, as aggregates.
   This file does the part that needs the plan: deciding which session an
   activity *was*.

   That division is why the server has no idea what a block or a zone is. The
   plan lives in the browser, so the matching lives in the browser too, and
   there is only ever one copy of it. */

import type { MscActivity, MscPlanSession } from './types';
import { formatAllure } from './engine';
import { RACINE_API } from './base';

const BASE = `${RACINE_API}/strava`;

export class StravaError extends Error {}

/* --------------------------------------------------------- ce que le serveur rend */

export type SportStrava = 'run' | 'swim' | 'bike' | 'hyrox' | 'autre';

export interface ActiviteStrava {
  id_strava: number;
  date: string;
  debut: string | null;
  nom: string;
  sport: SportStrava;
  sport_strava: string;
  duree_min: number;
  duree_s: number;
  distance_m: number;
  denivele_m: number;
  allure_s_km?: number;
  fc_moy?: number;
  fc_max?: number;
  cadence_moy?: number;
  effort?: number;
  manuelle: boolean;
  privee: boolean;
}

export interface Lap {
  index: number;
  duree_s: number;
  distance_m: number;
  allure_s_km?: number;
  fc_moy?: number;
}

export interface ActiviteDetaillee extends ActiviteStrava {
  calories?: number;
  laps: Lap[];
}

export interface Quotas {
  fenetre: { utilise: number; limite: number };
  jour: { utilise: number; limite: number };
  lecture: {
    fenetre: { utilise: number; limite: number };
    jour: { utilise: number; limite: number };
  } | null;
}

export interface EtatStrava {
  /** The server has a client id and secret. Without it nothing else is true. */
  configure: boolean;
  /** A verify token is set, so a push subscription is possible. */
  webhook: boolean;
  lie: boolean;
  athlete: { id: number | null; prenom: string; nom: string } | null;
  portee: string | null;
  lie_le: string | null;
  derniere_synchro: string | null;
  evenements: number;
  dernier_evenement: string | null;
  quotas: Quotas | null;
}

/* ------------------------------------------------------------ les appels */

async function appeler<T>(chemin: string, init?: RequestInit): Promise<T> {
  let reponse: Response;
  try {
    reponse = await fetch(BASE + chemin, init);
  } catch {
    throw new StravaError('Le serveur de plan ne répond pas. Lance-le avec « npm run server ».');
  }
  const data = await reponse.json().catch(() => ({}));
  if (!reponse.ok) {
    throw new StravaError(
      (data as { erreur?: string })?.erreur ?? `Le serveur a répondu ${reponse.status}.`,
    );
  }
  return data as T;
}

export function etat(): Promise<EtatStrava> {
  return appeler<EtatStrava>('/etat');
}

/** Where to send the athlete to say yes. The secret never leaves the server. */
export function lienAutorisation(): Promise<{ url: string }> {
  return appeler<{ url: string }>('/lien');
}

export function delier(): Promise<{ lie: boolean }> {
  return appeler<{ lie: boolean }>('/delier', { method: 'POST' });
}

export async function activites(
  depuis?: string,
  jusqua?: string,
): Promise<{ activites: ActiviteStrava[]; quotas: Quotas | null }> {
  const params = new URLSearchParams();
  if (depuis) params.set('depuis', depuis);
  if (jusqua) params.set('jusqua', jusqua);
  const q = params.toString();
  return appeler(`/activites${q ? `?${q}` : ''}`);
}

/** One activity with its laps. A request each, so ask only where it matters. */
export function activite(id: number): Promise<ActiviteDetaillee> {
  return appeler<ActiviteDetaillee>(`/activite/${id}`);
}

/* ------------------------------------------------------- l'appariement */

/* The plan speaks of disciplines; Strava speaks of sports. The server has
   already collapsed Strava's long enum onto these five, so this is the last
   step of the translation and the only one that needs to know the plan. */
const SPORT_DE_DISCIPLINE: Record<string, SportStrava> = {
  'Course à pied': 'run',
  Natation: 'swim',
  Vélo: 'bike',
  Hyrox: 'hyrox',
};

export interface Appariement {
  activites: MscActivity[];
  /** Activities that matched nothing in the plan — a bike ride on a rest day. */
  orphelines: ActiviteStrava[];
}

/**
 * Decides which session each activity was.
 *
 * Strictly same-day: an activity is matched against the sessions planned for
 * the date it happened on, in the athlete's own timezone. Nothing is matched
 * across a day boundary — a Sunday long run moved to Monday is a session
 * missed and a session done, and the coach screen has rules for exactly that.
 * Guessing here would tick off the wrong day and hide the gap.
 *
 * Within a day and a discipline, the best fit by duration wins rather than the
 * earliest — an athlete who jogs 20 minutes in the morning and runs the 68
 * minutes of threshold in the evening has done the threshold session, and
 * chronological order would have handed it to the jog. Each session is claimed
 * once; whatever is left over is orphaned rather than forced onto something.
 */
export function apparier(
  brutes: ActiviteStrava[],
  sessions: MscPlanSession[],
  details?: Map<number, ActiviteDetaillee>,
): Appariement {
  const cle = (date: string, sport: string) => `${date}|${sport}`;

  const seancesPar = new Map<string, MscPlanSession[]>();
  for (const s of sessions) {
    const sport = SPORT_DE_DISCIPLINE[s.discipline];
    /* Rest days map to no sport, so nothing can ever land on one. */
    if (!sport) continue;
    const k = cle(s.date, sport);
    const liste = seancesPar.get(k);
    if (liste) liste.push(s);
    else seancesPar.set(k, [s]);
  }

  const activitesPar = new Map<string, ActiviteStrava[]>();
  for (const a of brutes) {
    const k = cle(a.date, a.sport);
    const liste = activitesPar.get(k);
    if (liste) liste.push(a);
    else activitesPar.set(k, [a]);
  }

  const activites: MscActivity[] = [];
  const orphelines: ActiviteStrava[] = [];

  for (const [k, groupe] of activitesPar) {
    const candidates = seancesPar.get(k) ?? [];

    /* Every pairing the day allows, closest duration first. The groups are two
       or three items, so a greedy pass over the sorted pairs is the assignment
       — and it is stable, which a check can assert. */
    const paires: { a: ActiviteStrava; s: MscPlanSession; ecart: number }[] = [];
    for (const a of groupe) {
      for (const s of candidates) {
        paires.push({ a, s, ecart: Math.abs(s.duree_min - a.duree_min) });
      }
    }
    paires.sort(
      (x, y) =>
        x.ecart - y.ecart ||
        (x.a.debut ?? '').localeCompare(y.a.debut ?? '') ||
        x.s.id - y.s.id,
    );

    const prisesA = new Set<number>();
    const prisesS = new Set<number>();
    for (const p of paires) {
      if (prisesA.has(p.a.id_strava) || prisesS.has(p.s.id)) continue;
      prisesA.add(p.a.id_strava);
      prisesS.add(p.s.id);
      activites.push(ligne(p.a, p.s, details?.get(p.a.id_strava)));
    }
    for (const a of groupe) if (!prisesA.has(a.id_strava)) orphelines.push(a);
  }

  activites.sort((x, y) => x.date.localeCompare(y.date) || x.id_strava - y.id_strava);
  return { activites, orphelines };
}

/** One `msc_activity` row — the shape the screens already read. */
function ligne(
  a: ActiviteStrava,
  session: MscPlanSession | undefined,
  detail?: ActiviteDetaillee,
): MscActivity {
  const blocs = detail ? blocsDeQualite(detail) : undefined;
  return {
    id_strava: a.id_strava,
    session_id: session?.id,
    date: a.date,
    sport: a.sport,
    duree_min: a.duree_min,
    statut: 'fait',
    /* A pace on a swim or a bike ride is not the pace the plan is written in,
       so only running carries one. */
    allure_moy: a.sport === 'run' && a.allure_s_km ? formatAllure(a.allure_s_km) : undefined,
    fc_moy: a.fc_moy,
    splits_blocs: blocs,
  };
}

/* Below this, the laps are all one effort and there is no interval structure
   to find. A jogged recovery sits a minute or two per km off the work; a
   steady run's laps sit within a few seconds of each other. */
const ECART_BLOC_S = 15;

/* An interval shorter than this is the gap between pressing lap twice. */
const BLOC_MIN_S = 45;

/**
 * The per-interval paces of a quality session, in seconds per km.
 *
 * A heuristic, and worth naming as one. The laps of a structured session fall
 * into two groups — the work and everything else — separated by a wide gap in
 * pace, so the widest gap in the sorted lap paces is the split. Requiring that
 * gap to be real is what stops a steady run from reporting its faster half as
 * intervals.
 *
 * It reads the laps the watch recorded, so it is only as structured as the
 * athlete's watch was: a session run without pressing lap gives nothing back,
 * and nothing back is the honest answer rather than a fabricated one.
 */
export function blocsDeQualite(detail: ActiviteDetaillee): number[] | undefined {
  const laps = detail.laps.filter(
    (l): l is Lap & { allure_s_km: number } =>
      Boolean(l.allure_s_km) && l.duree_s >= BLOC_MIN_S,
  );
  if (laps.length < 3) return undefined;

  const triees = [...laps].sort((x, y) => x.allure_s_km - y.allure_s_km);
  let coupe = -1;
  let ecart = 0;
  for (let i = 0; i < triees.length - 1; i += 1) {
    const d = triees[i + 1].allure_s_km - triees[i].allure_s_km;
    if (d > ecart) {
      ecart = d;
      coupe = i;
    }
  }
  if (ecart < ECART_BLOC_S) return undefined;

  const travail = triees.slice(0, coupe + 1);
  if (travail.length < 2) return undefined;
  return travail
    .sort((x, y) => x.index - y.index)
    .map((l) => Math.round(l.allure_s_km));
}

/** The sessions worth spending a detail request on: the ones with intervals. */
export function seancesDeQualite(activites: MscActivity[], sessions: MscPlanSession[]): number[] {
  const parId = new Map(sessions.map((s) => [s.id, s]));
  return activites
    .filter((a) => {
      const s = a.session_id === undefined ? undefined : parId.get(a.session_id);
      return a.sport === 'run' && (s?.zones?.length ?? 0) > 1;
    })
    .map((a) => a.id_strava);
}
