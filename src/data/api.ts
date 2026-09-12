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
import { athleteId } from './vives';
import type { Instantane } from './vives';
import type { CalendrierEntree, Classement, Conversation, MscActivity, MscCompetition, MscParam } from './types';
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

/* De quel athlète on parle.

   Le serveur le lit dans `?athlete=` et, à défaut, prend le PREMIER athlète
   visible du compte. Sur un compte qui n'en voit qu'un, la différence ne se
   voit pas ; sur celui du coach, elle se voit très bien : la liste affichée
   venait de l'instantané (qui, lui, portait l'athlète), et l'écriture partait
   chez quelqu'un d'autre. Supprimer une course de l'athlète affiché répondait
   alors « Compétition inconnue », et une course ajoutée n'apparaissait nulle
   part — elle avait été créée chez le premier de la liste.

   Une seule couture, ici : toute requête dit de qui elle parle. Les routes qui
   ne dépendent d'aucun athlète (santé, paramètres, classement) reçoivent le
   paramètre et l'ignorent. */
export function avecAthlete(chemin: string): string {
  if (!athleteId || /[?&]athlete=/.test(chemin)) return chemin;
  return `${chemin}${chemin.includes('?') ? '&' : '?'}athlete=${athleteId}`;
}

async function appeler<T>(chemin: string, init: RequestInit = {}): Promise<T> {
  let reponse: Response;
  try {
    reponse = await fetch(BASE + avecAthlete(chemin), {
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
      /* L'athlète est gelé ici, pas au rejeu : la file peut repartir alors que
         le coach en regarde un autre, et une écriture n'a qu'un destinataire. */
      chemin: avecAthlete(chemin),
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
  role: 'athlete' | 'coach' | 'admin' | 'fournisseur';
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

/** S'inscrire : l'athlète, son compte, son accès, et la session ouverte —
    la même réponse qu'une connexion. */
export function inscription(corps: {
  prenom: string; nom: string; email: string; mot_de_passe: string;
  actuelle: string; cible: string; debut?: string; code?: string;
}): Promise<Identite> {
  return appeler<Identite>('/inscription', { method: 'POST', body: JSON.stringify(corps) });
}

/** Entrer par un lien à usage unique. La réponse dit qu'il reste un mot de
    passe à poser : c'est la raison d'être du lien. */
export function connexionParLien(jeton: string): Promise<Identite & { poser_mot_de_passe?: boolean }> {
  return appeler<Identite & { poser_mot_de_passe?: boolean }>('/connexion/lien', {
    method: 'POST', body: JSON.stringify({ jeton }),
  });
}

/** Son propre mot de passe — sans passer par l'admin, qui ne doit connaître
    celui de personne. */
export function changerMonMotDePasse(mot_de_passe: string): Promise<{ ok: boolean }> {
  return appeler<{ ok: boolean }>('/moi/motdepasse', {
    method: 'POST', body: JSON.stringify({ mot_de_passe }),
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

/** L'empreinte des données d'un athlète : elle change quand la base change.
    Deux cents octets au lieu de tout l'instantané — assez peu pour la
    redemander pendant que l'application est à l'écran. */
export function fraicheur(athleteId?: number | null): Promise<{ empreinte: string }> {
  const q = athleteId ? `?athlete=${athleteId}` : '';
  return appeler<{ empreinte: string }>(`/fraicheur${q}`);
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
  /** Pourquoi elle n'a pas eu lieu — codes de `RAISONS`. */
  raisons?: string[];
  /** La coche « faite » : vrai, faux, ou null pour ne pas y toucher. */
  fait?: boolean | null;
}

export function ecrireJournal(corps: EcritureJournal) {
  return ecrire<{ journal_id: number }>('/journal', corps, 'journal');
}

/** La semaine type, écrite d'un bloc : ce qui est envoyé remplace ce qui est
    rangé. Un créneau vide ne s'envoie pas — un jour sans rien, c'est le repos. */
export function ecrireStructure(creneaux: Array<{
  jour: number; creneau: 1 | 2; discipline: string; type_code: string; duree_min?: number;
}>) {
  return ecrire<{ creneaux: number }>('/structure', { creneaux }, 'structure');
}

/** Un objectif de discipline : deux temps sur l'épreuve étalon du sport.
    Le 10 km passe par la même route et atterrit dans les références de
    l'athlète — c'est de là que le moteur tire ses allures. */
export function ecrireObjectifSport(corps: {
  discipline: string; actuel_s: number | null; cible_s: number | null;
}) {
  return ecrire<{ discipline: string }>('/athlete/objectifs', corps, 'objectif_sport');
}

/** Un modèle de semaine type : un nom et ses créneaux, sans athlète. */
export interface Modele {
  nom: string;
  creneaux: Array<{
    jour: number; creneau: number; discipline: string; type_code: string; duree_min: number | null;
  }>;
}

/* Les modèles ne sont à personne : ils ne voyagent pas dans l'instantané d'un
   athlète, ils se demandent quand on ouvre la semaine type. Et ils ne passent
   pas par la file d'attente hors ligne : poser un modèle est un geste de
   bureau, devant sa base. */
export function modeles(): Promise<{ modeles: Modele[] }> {
  return appeler<{ modeles: Modele[] }>('/modeles');
}

export function ecrireModele(nom: string, creneaux: Modele['creneaux']) {
  return appeler<{ nom: string; creneaux: number }>('/modeles', {
    method: 'POST', body: JSON.stringify({ nom, creneaux }),
  });
}

export function supprimerModele(nom: string) {
  return appeler<{ supprime: boolean }>(`/modeles?nom=${encodeURIComponent(nom)}`, { method: 'DELETE' });
}

export interface EcritureMesure {
  date: string;
  poids_kg?: number;
  fc_repos?: number;
  hrv_ms?: number;
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
export function ecrireActivites(activites: MscActivity[], depuis?: string): Promise<{ ecrites: number }> {
  return appeler('/activites', {
    method: 'POST',
    /* `depuis` : la fenêtre synchronisée. Le serveur n'y touche qu'à
       l'intérieur — l'historique plus ancien reste. */
    body: JSON.stringify({ activites, depuis, mutation_id: idMutation() }),
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
  /** Les références sur lesquelles le plan est bâti : elles deviennent celles
      de l'athlète, sinon les allures affichées ne seraient pas celles du plan. */
  athlete?: { ref_actuelle_s: number; ref_cible_s: number; debut?: string };
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

/** Relier un start à un objectif du plan : cet objectif vise cette course. */
export function relierObjectif(objectif_id: number, competition_id: number): Promise<{ objectif_id: number; competition_id: number; semaine: number }> {
  return appeler('/objectif/lien', { method: 'PUT', body: JSON.stringify({ objectif_id, competition_id }) });
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
/** Les conversations d'un athlète avec le coach — le back office les relit. */
export function conversations(athleteId?: number | null): Promise<{ fils: Conversation[] }> {
  const q = athleteId ? `?athlete=${athleteId}` : '';
  return appeler<{ fils: Conversation[] }>(`/athlete/conversations${q}`);
}

/** Le classement du club : cinq axes, une moyenne, un palier. */
export function classement(): Promise<Classement> {
  return appeler<Classement>('/classement');
}

/** Le calendrier commun : toutes les compétitions, de tous les athlètes. */
export function calendrier(): Promise<{ competitions: CalendrierEntree[] }> {
  return appeler<{ competitions: CalendrierEntree[] }>('/calendrier');
}

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

/* ------------------------------------------------------------ le back office */

/* Les comptes, les athlètes, ce qui les relie, l'état du serveur. Réservé au
   rôle admin — le serveur tranche (403 sinon), l'écran ne fait que le montrer. */
export interface CompteAdmin {
  id: number;
  email: string;
  nom: string;
  role: 'athlete' | 'coach' | 'admin' | 'fournisseur';
  actif: boolean;
  sans_mot_de_passe: boolean;
  cree_le: string;
  athletes: AthleteVisible[];
}

export interface AthleteAdmin {
  id: number;
  nom: string;
  prenom: string | null;
  compte_id: number | null;
  ref_actuelle_s: number;
  ref_cible_s: number;
  debut: string;
}

export function adminComptes(): Promise<{ comptes: CompteAdmin[]; athletes: AthleteAdmin[] }> {
  return appeler<{ comptes: CompteAdmin[]; athletes: AthleteAdmin[] }>('/admin/comptes');
}

export function creerCompte(corps: {
  email: string; nom: string; role: CompteAdmin['role']; mot_de_passe: string;
  athlete_id?: number | null; droit?: AthleteVisible['droit'];
}): Promise<{ compte: CompteAdmin }> {
  return appeler<{ compte: CompteAdmin }>('/admin/comptes', { method: 'POST', body: JSON.stringify(corps) });
}

export function majCompte(
  id: number,
  corps: { nom?: string; email?: string; role?: CompteAdmin['role']; actif?: boolean; mot_de_passe?: string },
): Promise<{ compte: CompteAdmin }> {
  return appeler<{ compte: CompteAdmin }>(`/admin/comptes/${id}`, { method: 'PUT', body: JSON.stringify(corps) });
}

export function creerAthlete(corps: {
  nom: string; prenom?: string | null; actuelle: string; cible: string; debut?: string;
  compte_id?: number | null; droit?: AthleteVisible['droit'];
}): Promise<{ athlete: AthleteAdmin }> {
  return appeler<{ athlete: AthleteAdmin }>('/admin/athletes', { method: 'POST', body: JSON.stringify(corps) });
}

/** Ce qu'une suppression d'athlète emporterait : les comptes qui le voient,
    et le décompte de ce qui disparaîtrait avec lui. */
export interface ResumeAthlete {
  athlete: AthleteAdmin;
  compte: {
    plans: number; seances: number; activites: number; journal: number; courses: number;
    mesures: number; photos: number; analyses: number; questions: number; strava: number;
  };
  comptes: Array<{ id: number; email: string; nom: string; role: CompteAdmin['role']; seulement_lui: boolean }>;
}

export function resumeAthlete(id: number): Promise<ResumeAthlete> {
  return appeler<ResumeAthlete>(`/admin/athletes/${id}`);
}

/** Supprimer un athlète. `nom` doit être son nom, écrit à la main : le serveur
    le revérifie. `compte` emporte les logins qui ne voyaient que lui. */
export function supprimerAthlete(id: number, corps: { nom: string; compte?: boolean }): Promise<{
  supprime: { id: number; nom: string }; fichiers: number; comptes_supprimes: string[];
}> {
  return appeler(`/admin/athletes/${id}`, { method: 'DELETE', body: JSON.stringify(corps) });
}

/** Un athlète et son compte d'un seul geste — ou l'un des deux, relié à
    l'autre s'il existe déjà. Tout ou rien : le serveur écrit en transaction. */
export function inscrire(corps: {
  athlete?: {
    nom: string; prenom?: string | null;
    /* Vides quand il ne court pas : il n'y a alors pas de référence 10 km. */
    actuelle: string; cible: string; debut?: string;
    /** Ses sports — ce sont eux qui disent si les allures ont un sens. */
    sports?: string[];
    /** Où il en est sur l'épreuve étalon des autres sports, en secondes. */
    objectifs?: Array<{ discipline: string; actuel_s: number | null; cible_s: number | null }>;
  } | null;
  compte?: { email: string; nom?: string; role: CompteAdmin['role']; mot_de_passe: string } | null;
  droit?: AthleteVisible['droit'];
  compte_id?: number | null;
  athlete_id?: number | null;
}): Promise<{ compte: CompteAdmin | null; athlete: AthleteAdmin | null }> {
  return appeler('/admin/inscription', { method: 'POST', body: JSON.stringify(corps) });
}

/** Un lien de connexion à usage unique pour ce compte. Le jeton ne revient
    qu'ici, une fois : l'écran en fabrique l'adresse, et l'admin l'envoie. */
export function lienDeConnexion(compteId: number): Promise<{
  jeton: string; email: string; expire_le: string | null; heures: number;
}> {
  return appeler(`/admin/comptes/${compteId}/lien`, { method: 'POST' });
}

/* ------------------------------------------------------- les partenaires */

export interface Sponsor {
  id: number; nom: string; ville: string | null; url: string | null; actif: boolean;
  /** Le compte fournisseur qui le tient, s'il en a un. */
  compte_id?: number | null;
}
export interface Offre {
  id: number; sponsor_id: number; titre: string; lot: string | null; voucher: string | null;
  regle_pct: number; debut: string; fin: string; tirage_le: string | null;
  gagnant: { id: number; nom: string } | null; participations: number;
}
export type SponsorAvecOffres = Sponsor & { offres: Offre[] };
export interface OffrePourMoi {
  id: number; sponsor: Sponsor; titre: string; lot: string | null; voucher: string | null;
  regle_pct: number; debut: string; fin: string;
  participe: boolean; tire: boolean; gagnant: boolean; eligible: boolean;
}
export interface AnalysePartenaires {
  sponsors: Array<{ id: number; nom: string; ville: string | null; actif: boolean; offres: number; vues: number; participations: number; gagnants: number; clics: number }>;
  athletes: Array<{ id: number; nom: string; prenom: string | null; participations: number; gagnes: number; clics: number; dernier_clic: string | null }>;
}

/** Les offres en cours, vues de l'athlète affiché, et sa semaine telle que
    le plan la compte — c'est elle qui dit s'il peut participer. */
export function partenaires(): Promise<{ offres: OffrePourMoi[]; semaine: { prevues: number; faites: number; part: number } }> {
  return appeler('/partenaires');
}
export function participer(offreId: number): Promise<{ ok: boolean }> {
  return appeler(`/partenaires/${offreId}/participer`, { method: 'POST' });
}
/** Une vue (une par jour) ou un clic vers la boutique — ce qui se compte. */
export function noterPartenaire(corps: { sponsor_id: number; offre_id?: number; type: 'vue' | 'clic' }): Promise<{ ok: boolean }> {
  return appeler('/partenaires/evenement', { method: 'POST', body: JSON.stringify(corps) });
}
export function adminPartenaires(): Promise<{ sponsors: SponsorAvecOffres[] }> {
  return appeler('/admin/partenaires');
}
export function ecrireSponsor(corps: {
  id?: number; nom: string; ville?: string; url?: string; actif?: boolean; compte_id?: number | null;
}): Promise<{ sponsor: Sponsor }> {
  return appeler('/admin/partenaires/sponsor', { method: 'POST', body: JSON.stringify(corps) });
}
export function ecrireOffre(corps: {
  id?: number; sponsor_id: number; titre: string; lot?: string; voucher?: string; regle_pct?: number; debut?: string; fin: string;
}): Promise<{ offre: Offre }> {
  return appeler('/admin/partenaires/offre', { method: 'POST', body: JSON.stringify(corps) });
}
export function tirerOffre(offreId: number): Promise<{ offre: Offre; gagnant: { id: number; nom: string; prenom: string | null }; participants: number }> {
  return appeler(`/admin/partenaires/offre/${offreId}/tirer`, { method: 'POST' });
}
/* ------------------------------------------------------- le fournisseur */

export interface OffreFournisseur extends Offre { vues: number; clics: number }
export interface VueFournisseur {
  sponsor: Sponsor;
  offres: OffreFournisseur[];
  audience: {
    athletes: number; vues: number; clics: number; cliqueurs: number;
    sports: Array<{ nom: string; n: number }>;
    ages: Array<{ tranche: string; n: number }>;
  };
}

/** Son sponsor, ses offres, son audience — et rien d'autre. */
export function fournisseur(): Promise<VueFournisseur> {
  return appeler<VueFournisseur>('/fournisseur');
}
export function ecrireOffreFournisseur(corps: {
  id?: number; titre: string; lot?: string; voucher?: string; regle_pct?: number; debut?: string; fin: string;
}): Promise<{ offre: Offre }> {
  return appeler('/fournisseur/offre', { method: 'POST', body: JSON.stringify(corps) });
}
export function tirerOffreFournisseur(offreId: number): Promise<{ gagnant: { id: number; nom: string } }> {
  return appeler(`/fournisseur/offre/${offreId}/tirer`, { method: 'POST' });
}

export function analysePartenaires(): Promise<AnalysePartenaires> {
  return appeler('/admin/partenaires/analyse');
}

/** droit null : retirer l'accès. */
export function majAcces(corps: {
  compte_id: number; athlete_id: number; droit: AthleteVisible['droit'] | null;
}): Promise<{ acces: { compte_id: number; athlete_id: number; droit: AthleteVisible['droit'] | null } }> {
  return appeler('/admin/acces', { method: 'PUT', body: JSON.stringify(corps) });
}

/* Strava, athlète par athlète — la vue du coach ou de l'admin. */
export interface StravaAthlete {
  id: number;
  nom: string;
  droit: AthleteVisible['droit'];
  strava: {
    configure: boolean;
    app_propre: boolean;
    lie: boolean;
    athlete: { id: number; prenom: string; nom: string } | null;
    portee: string | null;
    lie_le: string | null;
    derniere_synchro: string | null;
  };
  app: {
    propre: boolean;
    client_id: string | null;
    secret: boolean;
    illisible: boolean;
    maj_le: string | null;
    commune: boolean;
    commune_client_id: string | null;
  };
  activites: { n: number; derniere: string | null };
}

export function stravaParAthlete(): Promise<{ athletes: StravaAthlete[] }> {
  return appeler<{ athletes: StravaAthlete[] }>('/admin/strava');
}

export interface LotDemo {
  code: string;
  quoi: Record<'fr' | 'pl', string>;
  n: number;
}

export interface PlanDemo {
  id: number;
  nom: string;
  actif: boolean;
  courses: Array<{ id: number; nom: string; date: string }>;
  retire?: boolean;
}

export interface EtatDemoAthlete {
  athlete_id: number;
  nom: string;
  lots: LotDemo[];
  plans: PlanDemo[];
  total: number;
}

/** Ce que le seed a laissé, athlète par athlète — seuls ceux chez qui il reste
    quelque chose sont là. */
export interface EtatDemo {
  athletes: EtatDemoAthlete[];
  scannes: number;
  total: number;
  erreur?: string;
}

export interface Systeme {
  version: string | null;
  node: string;
  env: string;
  sans_tls: boolean;
  demarre_le: string;
  cle: boolean;
  cle_source: 'base' | 'env' | 'defaut' | null;
  cle_illisible: boolean;
  strava: boolean;
  scellement: boolean;
  base: { ok: boolean; version: string | null; erreur: string | null };
  demo: EtatDemo | null;
}

export function systeme(): Promise<Systeme> {
  return appeler<Systeme>('/admin/systeme');
}

export function retirerDemo(athleteId: number, plan: boolean): Promise<{ retires: LotDemo[]; plans: PlanDemo[] }> {
  return appeler<{ retires: LotDemo[]; plans: PlanDemo[] }>('/admin/demo', {
    method: 'POST', body: JSON.stringify({ athlete_id: athleteId, plan }),
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
