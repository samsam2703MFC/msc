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

import type { Instantane } from './vives';
import type { MscActivity, MscCompetition } from './types';

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

const BASE = '/api';

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
}

export function ecrireJournal(corps: EcritureJournal): Promise<{ journal_id: number }> {
  return appeler('/journal', {
    method: 'POST',
    body: JSON.stringify({ ...corps, mutation_id: idMutation() }),
  });
}

export interface EcritureMesure {
  date: string;
  poids_kg?: number;
  fc_repos?: number;
  source?: 'photo' | 'saisie' | 'import';
  etat?: 'propose' | 'confirme' | 'rejete';
  note?: string;
}

export function ecrireMesure(corps: EcritureMesure): Promise<{ date: string }> {
  return appeler('/mesure', {
    method: 'POST',
    body: JSON.stringify({ ...corps, mutation_id: idMutation() }),
  });
}

/** Les activités appariées par le navigateur, rangées par le serveur. */
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
