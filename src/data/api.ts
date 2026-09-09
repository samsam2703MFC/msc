/* Le client de l'API.

   Une seule règle traverse ce fichier : le navigateur ne détient rien. Il
   demande un instantané, il l'affiche, il envoie ce que l'athlète tape. Les
   identifiants voyagent dans un cookie que le JavaScript ne peut pas lire —
   HttpOnly — donc `credentials: 'include'` sur chaque appel et rien à ranger
   ici.

   Les écritures portent un `mutation_id` que le client tire avant d'envoyer. Le
   serveur dédoublonne dessus : c'est ce qui rendra la file d'attente hors-ligne
   sûre le jour où elle existera, et en attendant ça protège déjà du double clic
   et du renvoi après une coupure. */

import * as cache from './cache';
import type { Instantane } from './vives';
import type { MscActivity, MscCompetition, MscParam } from './types';
import { RACINE_API } from './base';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly statut: number,
  ) {
    super(message);
  }
  /** Vrai quand il faut se reconnecter, pas quand quelque chose a mal tourné. */
  get nonConnecte() {
    return this.statut === 401;
  }
}

const BASE = RACINE_API;

async function appeler<T>(chemin: string, init: RequestInit = {}): Promise<T> {
  let reponse: Response;
  try {
    reponse = await fetch(BASE + chemin, {
      ...init,
      /* Le cookie de session. Sans ça, chaque appel repart anonyme. */
      credentials: 'include',
      headers: {
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError('Le serveur ne répond pas. Vérifie ta connexion.', 0);
  }
  const data = (await reponse.json().catch(() => ({}))) as { erreur?: string };
  if (!reponse.ok) {
    throw new ApiError(data?.erreur ?? `Le serveur a répondu ${reponse.status}.`, reponse.status);
  }
  return data as T;
}

function idMutation(): string {
  return crypto.randomUUID();
}

/** Vrai quand ce qui a échoué est le réseau, pas le serveur. */
export function estReseau(e: unknown): boolean {
  return e instanceof ApiError && e.statut === 0;
}

export interface Differe {
  differe: true;
  mutation_id: string;
}

export function estDiffere(v: unknown): v is Differe {
  return Boolean(v && typeof v === 'object' && (v as Differe).differe === true);
}

/**
 * Une écriture, ou une écriture en attente.
 *
 * Si le réseau manque, elle part dans la file plutôt que de se perdre — et
 * l'identifiant de mutation est tiré **avant** l'envoi, donc le rejeu ne
 * produira pas de doublon : le serveur reconnaît ce qu'il a déjà vu.
 *
 * Un refus du serveur, lui, n'est pas mis en file : un 400 ne deviendra pas un
 * 200 en le renvoyant, et une file qui rejoue indéfiniment une écriture
 * impossible est une file qui ne rejoue plus rien.
 */
async function ecrire<T>(
  chemin: string,
  corps: unknown,
  operation: string,
  init?: { type?: string; brut?: Blob },
): Promise<T | Differe> {
  const mutation_id = idMutation();
  const charge = init?.brut ?? { ...(corps as object), mutation_id };
  try {
    return await appeler<T>(chemin, {
      method: 'POST',
      ...(init?.brut
        ? { headers: { 'content-type': init.type ?? 'application/octet-stream' }, body: init.brut }
        : { body: JSON.stringify(charge) }),
    });
  } catch (e) {
    if (!estReseau(e)) throw e;
    await cache.filer({
      id: mutation_id,
      chemin,
      corps: charge,
      type: init?.type,
      operation,
      cree_le: Date.now(),
    });
    return { differe: true, mutation_id };
  }
}

/**
 * Rejoue ce qui attend, dans l'ordre.
 *
 * S'arrête au premier échec réseau — inutile d'insister, et l'ordre compte.
 * Une mutation refusée par le serveur est marquée et laissée de côté : elle ne
 * bloque pas les suivantes, et l'application peut dire qu'elle a été perdue
 * plutôt que de la faire disparaître en silence.
 */
export async function rejouerFile(): Promise<{ envoyees: number; refusees: number; reste: number }> {
  const attente = await cache.enAttente();
  let envoyees = 0;
  let refusees = 0;

  for (const m of attente) {
    if (m.refus) continue;
    try {
      const brut = m.corps instanceof Blob;
      await appeler(m.chemin, {
        method: 'POST',
        ...(brut
          ? { headers: { 'content-type': m.type ?? 'application/octet-stream' }, body: m.corps as Blob }
          : { body: JSON.stringify(m.corps) }),
      });
      await cache.retirer(m.id);
      envoyees += 1;
    } catch (e) {
      if (estReseau(e)) break;
      await cache.marquerRefus(m, e instanceof ApiError ? e.message : String(e));
      refusees += 1;
    }
  }

  const { attente: reste } = await cache.etatFile();
  return { envoyees, refusees, reste };
}

/* --------------------------------------------------------------- la session */

export interface Compte {
  id: number;
  email?: string;
  nom: string;
  role: 'athlete' | 'coach' | 'admin';
}

export interface AthleteVisible {
  id: number;
  nom: string;
  droit: 'lecture' | 'ecriture';
}

export interface Identite {
  compte: Compte;
  athletes: AthleteVisible[];
}

export function moi(): Promise<Identite> {
  return appeler<Identite>('/moi');
}

export function connexion(email: string, mot_de_passe: string): Promise<Identite> {
  return appeler<Identite>('/connexion', {
    method: 'POST',
    body: JSON.stringify({ email, mot_de_passe }),
  });
}

export function deconnexion(): Promise<{ ok: boolean }> {
  return appeler<{ ok: boolean }>('/deconnexion', { method: 'POST' });
}

/* ------------------------------------------------------------ la lecture */

/** Toute la base d'un athlète. Un appel, et les écrans restent synchrones. */
export function instantane(athleteId?: number | null): Promise<Instantane> {
  const q = athleteId ? `?athlete=${athleteId}` : '';
  return appeler<Instantane>(`/db/instantane${q}`);
}

export interface Sante {
  ok: boolean;
  cle: boolean;
  strava: boolean;
  scellement: boolean;
}

export function sante(): Promise<Sante> {
  return appeler<Sante>('/sante');
}

/* ----------------------------------------------------------- les écritures */

export interface EcritureJournal {
  date: string;
  session_id?: number | null;
  rpe?: number;
  sommeil?: number;
  note?: string;
  douleurs?: string[];
  /** Ce qui a bloqué — codes de `LIMITES` ; `['rien']` quand rien n'a bloqué. */
  limites?: string[];
}

export function ecrireJournal(corps: EcritureJournal) {
  return ecrire<{ journal_id: number }>('/journal', corps, 'journal');
}

export interface EcritureMesure {
  date: string;
  poids_kg?: number;
  fc_repos?: number;
  source?: 'photo' | 'saisie' | 'import';
  etat?: 'propose' | 'confirme' | 'rejete';
  note?: string;
}

export function ecrireMesure(corps: EcritureMesure) {
  return ecrire<{ date: string }>('/mesure', corps, 'mesure');
}

/** Les activités appariées par le navigateur, rangées par le serveur.

    Celles-ci ne vont PAS dans la file : elles viennent de Strava, qui n'était
    joignable que s'il y avait du réseau. Les mettre en attente rejouerait un
    appariement périmé sur des données que la synchro suivante refera mieux. */
export function ecrireActivites(activites: MscActivity[]): Promise<{ ecrites: number }> {
  return appeler('/activites', {
    method: 'POST',
    body: JSON.stringify({ activites, mutation_id: idMutation() }),
  });
}

/** Accepter ou retirer une proposition du coach. */
export function proposition(
  table: 'msc_adaptation' | 'msc_ajustement',
  id: number,
  applique: boolean,
): Promise<{ id: number; applique: boolean }> {
  return appeler('/proposition', {
    method: 'POST',
    body: JSON.stringify({ table, id, applique }),
  });
}

/* ------------------------------------------------------------- la photo */

export interface LecturePhoto {
  photo_id: number;
  date: string;
  poids_kg: number | null;
  fc_repos: number | null;
  confiance: 'haute' | 'moyenne' | 'basse' | null;
  lu: string | null;
  cout_eur: number;
  /** Renseigné quand le modèle n'a rien pu lire — la photo est rangée quand même. */
  echec: string | null;
}

/**
 * Envoie la photo telle quelle, en octets bruts.
 *
 * Pas de multipart : un seul fichier par requête, et le serveur n'a donc pas
 * d'analyseur multipart à embarquer pour ça. Le type vient de l'en-tête.
 */
export function envoyerPhoto(fichier: File, date?: string) {
  const q = date ? `?date=${date}` : '';
  /* Une photo prise sans réseau attend dans la file comme le reste — c'est même
     le cas le plus probable : on se pèse le matin, pas devant sa box. */
  return ecrire<LecturePhoto>(`/photo${q}`, null, 'photo', {
    type: fichier.type,
    brut: fichier,
  });
}

/** L'URL d'une photo rangée. Authentifiée : elle ne s'ouvre qu'avec le cookie. */
export function urlPhoto(id: number): string {
  return `${BASE}/photo/${id}`;
}

export function confirmerMesure(corps: {
  date: string;
  poids_kg?: number | null;
  fc_repos?: number | null;
  rejeter?: boolean;
}) {
  return ecrire<{ date: string; etat: string; corrige?: boolean }>(
    '/mesure/confirmer', corps, 'mesure.confirmer',
  );
}

/* ---------------------------------------------------------- le plan */

export interface PlanEnregistre {
  plan_id: number;
  seances: number;
  semaines: number;
  blocs: number;
  objectifs: number;
  debut: string;
  fin: string;
}

/**
 * Range un plan généré, et le rend actif.
 *
 * Le générateur tourne dans le navigateur : il est déterministe, il n'appelle
 * rien, et le serveur écrit ce qu'il a produit — en dérivant lui-même ce qui se
 * dérive (la charge, les totaux de semaine).
 *
 * Celui-ci ne va PAS dans la file hors-ligne. Un plan est une décision, pas une
 * saisie : le rejouer une heure plus tard remplacerait le plan actif d'alors,
 * qui n'est peut-être plus celui qu'on regardait en appuyant.
 */
export function enregistrerPlan(corps: {
  nom: string;
  methode?: unknown;
  blocs: unknown[];
  semaines: unknown[];
  sessions: unknown[];
  objectifs?: unknown[];
}): Promise<PlanEnregistre> {
  return appeler('/plan', {
    method: 'POST',
    body: JSON.stringify({ ...corps, mutation_id: idMutation() }),
  });
}

/* ------------------------------------------------------- le back office */

export function competitions(): Promise<{ competitions: MscCompetition[] }> {
  return appeler('/competitions');
}

export function ecrireCompetition(c: Partial<MscCompetition>): Promise<{ id: number }> {
  return appeler('/competitions', { method: 'POST', body: JSON.stringify(c) });
}

export function supprimerCompetition(id: number): Promise<{ id: number }> {
  return appeler(`/competitions?id=${id}`, { method: 'DELETE' });
}

/* ------------------------------------------------------------ la vue coach */

import type { ApercuAthlete } from './types';

/** Chaque athlète visible, en un coup d'œil. */
export function apercu(): Promise<{ athletes: ApercuAthlete[] }> {
  return appeler<{ athletes: ApercuAthlete[] }>('/apercu');
}

/** Le profil : prénom, nom, surnom, année de naissance. */
/* Les réglages du back office. Lecture et écriture réservées aux comptes coach
   ou admin — le serveur tranche, l'écran ne fait que le montrer. */
export function params(): Promise<{ params: MscParam[] }> {
  return appeler<{ params: MscParam[] }>('/param');
}

export function majParam(cle: string, valeur: string | number | boolean | null): Promise<{ param: MscParam }> {
  return appeler<{ param: MscParam }>('/param', {
    method: 'PUT',
    body: JSON.stringify({ cle, valeur }),
  });
}

export function majProfil(
  corps: { prenom?: string | null; nom: string; surnom?: string | null; annee_naissance?: number | null; coach?: string },
  athleteId?: number | null,
): Promise<{ id: number }> {
  const q = athleteId ? `?athlete=${athleteId}` : '';
  return appeler<{ id: number }>(`/athlete/profil${q}`, {
    method: 'PUT',
    body: JSON.stringify({ ...corps, mutation_id: crypto.randomUUID() }),
  });
}
