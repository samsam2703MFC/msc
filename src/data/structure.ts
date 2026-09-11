/* La semaine type d'un athlète — la matrice que le plan et le coach suivent.

   Sept jours, deux créneaux par jour. Chaque créneau porte un sport fixe et un
   type d'entraînement ; la durée est celle qu'il fait d'habitude, et c'est
   elle qui donne sa part dans le volume de la semaine.

   Trois choses en découlent, et c'est tout l'intérêt :

     la structure   quel jour, quel créneau, quel sport — ce qui ne bouge pas
     le type        ce qu'on y fait — ce qui tourne avec le bloc
     les allures    calculées du type et des références 10 km, jamais stockées

   Les allures ne sont pas dans la table exprès : les stocker, ce serait en
   avoir deux versions dont une fausse le jour où l'athlète progresse. Elles se
   recalculent à chaque affichage, depuis la référence du bloc courant.

   Ce fichier ne connaît ni React ni le serveur : il dit ce qu'un créneau
   signifie, et l'écran comme le générateur s'en servent. */

import type { MscStructure, TypeCode, ZoneCode } from './types';
import type { Lang } from './types';

/** Les sept jours, dans l'ordre où une semaine se lit. */
export const JOURS: Array<{ index: number; court: Record<Lang, string>; long: Record<Lang, string> }> = [
  { index: 0, court: { fr: 'LUN', pl: 'PON' }, long: { fr: 'Lundi', pl: 'Poniedziałek' } },
  { index: 1, court: { fr: 'MAR', pl: 'WTO' }, long: { fr: 'Mardi', pl: 'Wtorek' } },
  { index: 2, court: { fr: 'MER', pl: 'ŚRO' }, long: { fr: 'Mercredi', pl: 'Środa' } },
  { index: 3, court: { fr: 'JEU', pl: 'CZW' }, long: { fr: 'Jeudi', pl: 'Czwartek' } },
  { index: 4, court: { fr: 'VEN', pl: 'PIĄ' }, long: { fr: 'Vendredi', pl: 'Piątek' } },
  { index: 5, court: { fr: 'SAM', pl: 'SOB' }, long: { fr: 'Samedi', pl: 'Sobota' } },
  { index: 6, court: { fr: 'DIM', pl: 'NIE' }, long: { fr: 'Dimanche', pl: 'Niedziela' } },
];

/* Les sports d'une séance — ceux que le plan écrit dans `discipline`, et que
   Strava sait retrouver. « Repos » n'en est pas un : un créneau vide EST le
   repos, et une ligne « repos » se compterait dans le volume. */
export const SPORTS: Array<{ code: string; nom: Record<Lang, string>; icon: string }> = [
  { code: 'Course à pied', nom: { fr: 'Course à pied', pl: 'Bieganie' }, icon: 'footprints' },
  { code: 'Natation', nom: { fr: 'Natation', pl: 'Pływanie' }, icon: 'waves' },
  { code: 'Vélo', nom: { fr: 'Vélo', pl: 'Rower' }, icon: 'bike' },
  { code: 'Hyrox', nom: { fr: 'Hyrox / salle', pl: 'Hyrox / siłownia' }, icon: 'dumbbell' },
];

/* L'épreuve étalon de chaque sport : celle sur laquelle on se mesure, et sur
   laquelle on se donne un objectif de temps. Elle est ici et pas en base
   parce qu'elle ne change pas d'un athlète à l'autre — ce qui change, ce sont
   les deux temps.

   La course à pied a la sienne depuis toujours : les deux références 10 km de
   l'athlète, d'où le moteur tire chaque allure. Son objectif n'est donc pas
   rangé ailleurs, il EST ces deux nombres-là. */
export const EPREUVES: Record<string, { libelle: string; metres: number | null }> = {
  'Course à pied': { libelle: '10 km', metres: 10_000 },
  Natation: { libelle: '1500 m', metres: 1500 },
  'Vélo': { libelle: '40 km', metres: 40_000 },
  Hyrox: { libelle: 'Hyrox', metres: null },
};

/** Le sport dont l'objectif est la référence de l'athlète, pas une ligne à part. */
export const SPORT_REFERENCE = 'Course à pied';

/* Quels types d'entraînement ont un sens dans quel sport. Une liste déroulante
   qui propose « VMA » à une séance de natation fait perdre du temps à chaque
   ouverture ; celle-ci ne propose que ce qui se fait. */
const TYPES_PAR_SPORT: Record<string, TypeCode[]> = {
  'Course à pied': ['ef', 'recup', 'endactive', 'seuil', 'allure10', 'vma', 'longue', 'montagne', 'test'],
  Natation: ['nage'],
  Vélo: ['velo', 'endactive', 'recup'],
  Hyrox: ['force', 'compromis'],
};

export function typesPour(sport: string): TypeCode[] {
  return TYPES_PAR_SPORT[sport] ?? ['ef'];
}

/** Le type qu'on propose quand on change de sport : le premier de sa liste. */
export function typeParDefaut(sport: string): TypeCode {
  return typesPour(sport)[0];
}

/* Les zones d'allure d'un type — la même règle que le générateur applique en
   posant une séance, et la seule raison pour laquelle une case de la matrice
   peut afficher des allures cibles.

   Hors course à pied, il n'y a pas d'allure au kilomètre à donner : une nage
   se conduit à la sensation et aux séries, un vélo aux watts ou à la FC. Rendre
   un tableau vide est plus honnête que d'afficher une allure de course sur une
   ligne de natation. */
export function zonesDuType(type: TypeCode, sport = 'Course à pied'): ZoneCode[] {
  if (sport !== 'Course à pied') return [];
  switch (type) {
    case 'recup': return ['recup'];
    case 'ef':
    case 'longue': return ['ef'];
    case 'endactive': return ['ef', 'endactive'];
    case 'seuil': return ['ef', 'seuil'];
    case 'allure10': return ['ef', 'allure10'];
    case 'vma': return ['ef', 'vma'];
    case 'montagne': return ['ef'];
    case 'test': return ['allure10'];
    default: return [];
  }
}

/** La semaine type rangée par jour et par créneau, trous compris. */
export function matrice(creneaux: MscStructure[]): Array<Array<MscStructure | null>> {
  return JOURS.map((j) => [1, 2].map(
    (c) => creneaux.find((x) => x.jour === j.index && x.creneau === c) ?? null,
  ));
}

/** Le volume hebdomadaire que la matrice dessine, en minutes. */
export function volumeSemaine(creneaux: MscStructure[]): number {
  return creneaux.reduce((t, c) => t + (c.duree_min ?? 0), 0);
}

/* Un point de départ quand la matrice est vide : la semaine que le générateur
   posait en dur avant qu'elle existe. On ne l'impose pas — on la propose, et
   l'écran a un bouton pour ça. */
export function modele(options: { natation: boolean; velo: boolean; salle: boolean }): MscStructure[] {
  const out: MscStructure[] = [];
  const pose = (jour: number, creneau: 1 | 2, discipline: string, type: TypeCode, duree_min: number) => {
    out.push({ jour, creneau, discipline, type_code: type, duree_min });
  };
  if (options.salle) pose(0, 1, 'Hyrox', 'force', 70);
  if (options.natation) pose(1, 1, 'Natation', 'nage', 55);
  if (options.velo) pose(1, 2, 'Vélo', 'velo', 50);
  pose(2, 1, 'Course à pied', 'seuil', 60);
  if (options.salle) pose(3, 1, 'Hyrox', 'compromis', 55);
  if (options.natation) pose(4, 1, 'Natation', 'nage', 40);
  pose(4, 2, 'Course à pied', 'recup', 45);
  pose(5, 1, 'Course à pied', 'longue', 75);
  return out;
}
