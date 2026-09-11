/* Où en est son niveau, et où le plan le mène.

   Un niveau, ici, c'est une allure de référence au 10 km — la même unité que
   partout ailleurs dans l'application, celle qui donne les allures de chaque
   séance. Trois choses le font bouger, et ce sont celles qu'on mesure :

     ce qu'il fait          la charge réalisée contre la charge prévue
     comment il récupère    la HRV et la FC de repos contre leur ligne de base
     ce qu'il court         les chronos de course, ramenés au 10 km

   Le plan dit déjà où il devrait en être chaque semaine : la part de son bloc
   place la référence entre son départ et son objectif. Le modèle ne réinvente
   donc pas une trajectoire — il corrige celle-là par ce qui se passe vraiment.
   C'est la seule façon honnête de projeter : une courbe sortie d'une formule
   qui ignore le plan dirait la même chose à quelqu'un qui s'entraîne et à
   quelqu'un qui ne fait rien.

   Ce que le modèle ne prétend pas être : une prédiction de performance. Il dit
   « au rythme où tu exécutes ton plan et où tu récupères, voilà où ta
   référence arrive ». Les repères de compétition sont là pour qu'on voie tout
   de suite si ça suffit. */

import * as db from './db';
import { equivalent10k } from './generateur';

/** Sur combien de semaines on regarde ce qui a été fait, et comment il a
    récupéré. Huit : assez pour qu'une semaine ratée ne fasse pas la loi,
    assez court pour qu'un changement se voie. */
const FENETRE = 8;

export interface PointProgression {
  semaine: number;
  /** Le lundi de la semaine. */
  date: string;
  /** La trajectoire du plan, en secondes par kilomètre. */
  prevu: number;
  /** La même, corrigée par ce qui se passe — à partir de la semaine en cours. */
  projete?: number;
  /** Un niveau mesuré : un chrono de course ramené au 10 km. */
  observe?: number;
  /** Le nom de la course qui a donné ce point. */
  course?: string;
}

export interface Repere {
  date: string;
  semaine: number;
  nom: string;
  /** L'équivalent 10 km du chrono visé, ou undefined si elle n'en a pas. */
  cible?: number;
}

export interface Progression {
  points: PointProgression[];
  reperes: Repere[];
  /** Le niveau d'aujourd'hui, en secondes par kilomètre. */
  niveau: number;
  /** D'où il part et où il va, tels que le profil les pose. */
  depart: number;
  cible: number;
  /** Ce qui corrige la trajectoire : 1 = pile le plan, 0,8 = 20 % plus lent. */
  facteur: number;
  /** Part de la charge prévue réellement faite, sur la fenêtre. */
  execution: number;
  /** 1 = à sa ligne de base ; au-dessus, il récupère mieux que d'habitude. */
  recuperation: number;
  /** Une phrase par facteur, en clair — le chiffre seul n'explique rien. */
  pourquoi: string[];
}

const borne = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

/** Le lundi de la semaine n du plan, depuis la date de début de l'athlète. */
function lundiDe(n: number, debut: string): string {
  const d = new Date(`${debut}T00:00:00Z`);
  const decalage = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() + (-decalage + (n - 1) * 7) * 86_400_000)
    .toISOString().slice(0, 10);
}

export function progression(
  /** La semaine du plan où l'athlète en est — l'application la tient. */
  semaineCourante: number,
  lang: 'fr' | 'pl' = 'fr',
): Progression | null {
  const athlete = db.athlete;
  const semaines = db.select('msc_week');
  if (semaines.length === 0) return null;

  const depart = athlete.ref_actuelle_s;
  const cible = athlete.ref_cible_s;
  const ecart = depart - cible;
  const fr = lang === 'fr';
  const courante = Math.max(semaineCourante, 1);

  /* --------------------------------------------------- ce qu'il a fait */

  const faites = db.etatDesSeances().faites;
  const fenetre = semaines.filter((w) => w.semaine < courante && w.semaine >= courante - FENETRE);
  const prevue = fenetre.reduce((t, w) => t + w.charge, 0);
  const realisee = db
    .select('msc_session', (s) => s.semaine < courante && s.semaine >= courante - FENETRE)
    .filter((s) => faites.has(s.id))
    .reduce((t, s) => t + s.charge, 0);
  /* Sans semaine écoulée, on ne sait rien : le plan vaut pour lui-même. */
  const execution = prevue > 0 ? borne(realisee / prevue, 0, 1.25) : 1;

  /* ------------------------------------------------ comment il récupère */

  /* La HRV contre sa propre ligne de base — pas contre une norme : une HRV de
     40 ms n'est basse que pour quelqu'un dont la base est 55. */
  const hrv = db.courbes?.hrv ?? [];
  const dernierHrv = hrv[hrv.length - 1];
  const ecartHrv = dernierHrv?.base
    ? (dernierHrv.hrv - dernierHrv.base) / dernierHrv.base
    : 0;

  /* La FC de repos joue dans l'autre sens : elle monte quand la fatigue
     s'installe. On la compare à la médiane des trente derniers jours. */
  const repos = db.select('msc_daily', (d) => d.fc_repos != null)
    .slice(-30)
    .map((d) => d.fc_repos as number);
  const medianeRepos = repos.length >= 5
    ? [...repos].sort((a, b) => a - b)[Math.floor(repos.length / 2)]
    : null;
  const dernierRepos = repos[repos.length - 1] ?? null;
  const ecartRepos = medianeRepos && dernierRepos
    ? (dernierRepos - medianeRepos) / medianeRepos
    : 0;

  /* Une HRV 10 % au-dessus de sa base vaut +5 % de progression ; une FC de
     repos 10 % au-dessus de sa médiane en coûte 5. Bornes serrées : ces deux
     signaux orientent, ils ne décident pas. */
  const recuperation = borne(1 + ecartHrv * 0.5 - ecartRepos * 0.5, 0.85, 1.1);

  /* ------------------------------------------------------- le facteur */

  /* Ne rien faire ne fait pas reculer — ça ne fait pas avancer. D'où le
     plancher à 0,55 : même à l'arrêt, le niveau de départ reste acquis un
     temps, et c'est la progression qui s'annule, pas le niveau. */
  const facteur = borne((0.55 + 0.45 * execution) * recuperation, 0.5, 1.15);

  /* ----------------------------------------------- ce qu'il a couru */

  /* Un chrono de course est la seule mesure directe du niveau : elle prime sur
     tout ce que le modèle peut déduire. */
  const observes = new Map<number, { valeur: number; nom: string }>();
  for (const c of db.select('msc_competition')) {
    if (!c.resultat?.temps_s || c.resultat.abandon) continue;
    const n = semaineDe(c.date, athlete.debut);
    if (n < 1) continue;
    observes.set(n, {
      valeur: equivalent10k(c.resultat.temps_s, Number(c.distance_km)),
      nom: c.nom,
    });
  }

  /* -------------------------------------------------------- la courbe */

  /* La part d'un bloc vaut pour sa dernière semaine : c'est là que sa
     référence est atteinte. Entre deux blocs, le niveau monte semaine après
     semaine — sans quoi la courbe est un escalier, et on ne progresse pas par
     marches. La référence des allures, elle, reste celle du bloc : c'est une
     consigne d'entraînement, pas une mesure. */
  const blocs = db.blocs();
  const partDe = (n: number) => {
    const i = blocs.findIndex((b) => n >= b.de && n <= b.a);
    /* Une semaine hors des bornes des blocs : avant le premier, on n'a encore
       rien gagné ; après le dernier, on a tout gagné. Retomber sur le dernier
       bloc dans les deux cas faisait partir la courbe du haut — le plan avait
       l'air d'être déjà atteint la première semaine. */
    if (i < 0) {
      if (blocs.length === 0) return 0;
      return n < blocs[0].de ? 0 : blocs[blocs.length - 1].part;
    }
    const b = blocs[i];
    const avant = i === 0 ? 0 : blocs[i - 1].part;
    const duree = Math.max(b.a - b.de + 1, 1);
    return avant + (b.part - avant) * ((n - b.de + 1) / duree);
  };

  const points: PointProgression[] = semaines.map((w) => {
    const part = partDe(w.semaine);
    const prevu = depart - ecart * part;
    const vu = observes.get(w.semaine);
    return {
      semaine: w.semaine,
      date: lundiDe(w.semaine, athlete.debut),
      prevu,
      projete: w.semaine >= courante ? depart - ecart * part * facteur : undefined,
      observe: vu?.valeur,
      course: vu?.nom,
    };
  });

  /* Le niveau d'aujourd'hui : le dernier chrono s'il y en a un, sinon la
     trajectoire corrigée là où il en est. */
  const dernierObserve = [...observes.entries()].sort((a, b) => a[0] - b[0]).pop();
  const projeteCourant = points.find((p) => p.semaine === courante)?.projete
    ?? points[points.length - 1]?.projete
    ?? depart;
  const niveau = dernierObserve && dernierObserve[0] >= courante - FENETRE
    ? dernierObserve[1].valeur
    : projeteCourant;

  /* --------------------------------------------------- les repères */

  const reperes: Repere[] = db.select('msc_competition')
    .filter((c) => semaineDe(c.date, athlete.debut) >= 1)
    .map((c) => ({
      date: c.date,
      semaine: semaineDe(c.date, athlete.debut),
      nom: c.nom,
      cible: c.cible_s ? equivalent10k(c.cible_s, Number(c.distance_km)) : undefined,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  /* ------------------------------------------------------- pourquoi */

  const pct = (v: number) => `${Math.round(v * 100)} %`;
  const pourquoi: string[] = [];
  pourquoi.push(prevue > 0
    ? (fr
      ? `${pct(execution)} de la charge prévue faite sur ${fenetre.length} semaines.`
      : `${pct(execution)} planowanego obciążenia wykonane w ${fenetre.length} tyg.`)
    : (fr ? 'Pas encore de semaine écoulée : la projection suit le plan.' : 'Brak minionego tygodnia: projekcja idzie za planem.'));
  if (dernierHrv?.base) {
    pourquoi.push(fr
      ? `HRV ${ecartHrv >= 0 ? '+' : '−'}${Math.abs(Math.round(ecartHrv * 100))} % de sa ligne de base.`
      : `HRV ${ecartHrv >= 0 ? '+' : '−'}${Math.abs(Math.round(ecartHrv * 100))} % względem bazy.`);
  }
  if (medianeRepos && dernierRepos) {
    pourquoi.push(fr
      ? `FC de repos ${dernierRepos} bpm, médiane ${medianeRepos}.`
      : `Tętno spoczynkowe ${dernierRepos}, mediana ${medianeRepos}.`);
  }
  pourquoi.push(fr
    ? `La projection avance à ${pct(facteur)} de la trajectoire du plan.`
    : `Projekcja idzie w ${pct(facteur)} tempa planu.`);

  return {
    points, reperes, niveau, depart, cible, facteur, execution, recuperation, pourquoi,
  };
}

/** La semaine du plan où tombe une date. */
function semaineDe(date: string, debut: string): number {
  const d = new Date(`${debut}T00:00:00Z`);
  const lundi = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000);
  return Math.floor((Date.parse(`${date}T00:00:00Z`) - lundi.getTime()) / (7 * 86_400_000)) + 1;
}
