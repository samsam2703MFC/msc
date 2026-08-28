/* The reference data the training mechanic runs on, transcribed from the
   workbook's "Allures", "Lisez-moi" and "Suivi & ajustement" sheets.

   Nothing here is a pace: paces are computed. This file holds the two
   references, the block progression, and the offsets — the engine derives the
   rest (see ./engine). That is what makes the week-5 time trial recalibrate the
   whole plan by changing one number. */

import type {
  Lang,
  MscAthlete,
  MscBloc,
  MscObjectif,
  MscRegle,
  MscRpe,
  MscZoneDef,
} from './types';

const l = (s: string): Record<Lang, string> => ({ fr: s, pl: s });

/* ------------------------------------------------------------------ athlète */

/** The two references everything slides between, and the measured baseline. */
export const msc_athlete: MscAthlete[] = [
  {
    id: 1,
    nom: 'Sam',
    /* 10 km in 52:00 — measured on a ~55 min reference run (Garmin). */
    ref_actuelle_s: 312,
    /* 10 km in 36:00 — the objective of 21/03/2027. */
    ref_cible_s: 216,
    fc_repos: 44,
    fc_repos_moy7: 45,
    fc_moy_reference: 147,
    derive_reference_pct: 14,
    plancher_heures: 8,
    plancher_km_sortie: 10,
    debut: '2026-08-31',
    note: {
      fr: "Douze mois d'arrêt avant le plan. Réamorçage de six semaines, première séance de qualité en semaine 7.",
      pl: "Douze mois d'arrêt avant le plan. Réamorçage de six semaines, première séance de qualité en semaine 7.",
    },
  },
];

/* -------------------------------------------------------------------- blocs */

/** `part` is how far along the way from the current reference to the target
    the block sits. The block's reference pace is interpolated from it. */
export const msc_bloc: MscBloc[] = [
  { code: 'A', de: 1, a: 6, part: 0, nom: l('Réamorçage'),
    quoi: l("Ton niveau actuel. Aucune allure imposée avant le test de la semaine 5.") },
  { code: 'B', de: 7, a: 13, part: 0.28, nom: l('Construction semi'),
    quoi: l("Le semi du 22/11 et le 10 km du 29/11 se courent à cette référence.") },
  { code: 'C', de: 14, a: 23, part: 0.65, nom: l('Bloc vitesse'),
    quoi: l("Le fractionné du mercredi vise cette allure, pas 3:36.") },
  { code: 'D', de: 24, a: 29, part: 1, nom: l('Bloc final'),
    quoi: l("La cible. C'est seulement ici que 3:36/km devient l'allure de travail.") },
];

/* -------------------------------------------------------------------- zones */

/** Each zone is an offset in seconds per km from the block's 10 km reference.
    Eight zones, one table, valid for every block. */
export const msc_zone: MscZoneDef[] = [
  { code: 'recup', ecart_s: 95, icon: 'leaf', label: { fr: 'Récupération', pl: 'Regeneracja' },
    usage: l('Footings de récupération, retours au calme') },
  { code: 'ef', ecart_s: 75, icon: 'footprints', label: { fr: 'Endurance fondamentale', pl: 'Wytrzymałość podstawowa' },
    usage: l('Sorties longues, footings, base du volume') },
  { code: 'endactive', ecart_s: 55, icon: 'wind', label: { fr: 'Endurance active', pl: 'Wytrzymałość aktywna' },
    usage: l('Blocs en fin de sortie longue, phase de réamorçage') },
  { code: 'marathon', ecart_s: 30, icon: 'route', label: { fr: 'Allure marathon', pl: 'Tempo maratonu' },
    usage: l('Blocs sur les sorties longues du bloc vitesse') },
  { code: 'semi', ecart_s: 14, icon: 'gauge', label: { fr: 'Allure semi', pl: 'Tempo półmaratonu' },
    usage: l('Blocs spécifiques S9 à S12, semi du 22/11') },
  { code: 'seuil', ecart_s: 10, icon: 'gauge', label: { fr: 'Seuil', pl: 'Próg' },
    usage: l("Séances de seuil : 3', 8', 10', 15'") },
  { code: 'allure10', ecart_s: 0, icon: 'timer', label: { fr: 'Allure 10 km', pl: 'Tempo 10 km' },
    usage: l('Fractionné du mercredi, et les quatre courses') },
  { code: 'vma', ecart_s: -10, icon: 'zap', label: { fr: 'Allure 5 km / VMA', pl: 'Tempo 5 km / VO2max' },
    usage: l('5 × 1000 m, 10 × 800 m, 12 × 400 m') },
];

/* --------------------------------------------------------------- objectifs */

export const msc_objectif: MscObjectif[] = [
  { id: 1, date: '2026-11-22', semaine: 12, principal: false, distance_km: 21.1, cible_s: 6300, cible_haute_s: 6720,
    nom: l('Semi-marathon'), cible: l('1h45 à 1h52'),
    role: l("Course d'allure et repère. À la référence du bloc B, le semi se court vers 5:00/km.") },
  { id: 2, date: '2026-11-29', semaine: 13, principal: false, distance_km: 10, cible_s: 2760, cible_haute_s: 2880,
    nom: l('10 km n°1'), cible: l('46 à 48 min'),
    role: l('Reconnaissance.') },
  { id: 3, date: '2027-02-14', semaine: 24, principal: false, distance_km: 10, cible_s: 2400, cible_haute_s: 2520,
    nom: l('10 km n°2'), cible: l('40 à 42 min'),
    role: l("Juge de paix : sous 40 min ici, 36:30 en mars tient.") },
  { id: 4, date: '2027-03-21', semaine: 29, principal: true, distance_km: 10, cible_s: 2160, cible_haute_s: 2190,
    nom: l('10 km n°3'), cible: l('36:00 à 36:30'),
    role: l("L'objectif. Seize minutes gagnées en trente semaines : une reconstruction, pas une progression.") },
];

/* ------------------------------------------------------------------- règles */

/** The adjustment rules, applied without discussion. Each carries the signal
    and threshold that fires it, so the engine can evaluate them rather than
    leaving them as prose. */
export const msc_regle: MscRegle[] = [
  { code: 'rpe_haut', signal: 'rpe_qualite', op: '>', seuil: 8, gravite: 'ajuste',
    si: l('RPE du mercredi > 8'),
    alors: l('Tu ralentis de 10 s/km la séance suivante.'),
    pourquoi: l("Le RPE cible du fractionné est 7-8. Au-dessus, tu cours l'allure de la semaine 20 en semaine 15."),
    effet: { type: 'allure', secondes: 10 } },
  { code: 'rpe_bas', signal: 'rpe_qualite', op: '<=', seuil: 6, gravite: 'ajuste',
    si: l('RPE du mercredi ≤ 6'),
    alors: l('Tu peux accélérer de 5 s/km.'),
    pourquoi: l("Capacité disponible : c'est le seul cas où on avance le curseur plus vite que le plan."),
    effet: { type: 'allure', secondes: -5 } },
  { code: 'derive', signal: 'derive_longue', op: '>', seuil: 8, gravite: 'ajuste',
    si: l('Dérive cardiaque > 8 % sur la sortie longue'),
    alors: l("Tu ralentis l'endurance de 15 s/km pendant deux semaines."),
    pourquoi: l('Signe que la base aérobie ne suit pas encore le volume.'),
    effet: { type: 'allure', secondes: 15, semaines: 2, zone: 'ef' } },
  { code: 'fc_repos', signal: 'fc_repos_delta', op: '>=', seuil: 5, jours: 3, gravite: 'allege',
    si: l('FC au repos +5 bpm sur 3 jours'),
    alors: l('Semaine allégée immédiate : on coupe le vélo et Hyrox n°2.'),
    pourquoi: l('Le meilleur indicateur de surcharge que tu aies, et tu l’as déjà au poignet.'),
    effet: { type: 'coupe', disciplines: ['Vélo', 'Hyrox'] } },
  { code: 'sensation', signal: 'sensation_dure', op: '>=', seuil: 2, gravite: 'allege',
    si: l('Sensation « dur » deux semaines de suite'),
    alors: l('Décharge anticipée, on avance la semaine allégée suivante.'),
    pourquoi: l("Ce n'est pas de la faiblesse, c'est le mécanisme du plan."),
    effet: { type: 'decharge' } },
  { code: 'tendon', signal: 'douleur_tendineuse', op: '>=', seuil: 2, jours: 2, gravite: 'stop',
    si: l('Douleur tendineuse 2 jours de suite'),
    alors: l('STOP course 5 jours. Natation et Hyrox haut du corps seulement.'),
    pourquoi: l("Le volume perdu se rattrape. Une tendinopathie, non — et c'est ton risque n°1."),
    effet: { type: 'stop', jours: 5, sauf: ['Natation', 'Hyrox'] } },
  { code: 'sommeil', signal: 'nuits_courtes', op: '>=', seuil: 2, gravite: 'ajuste',
    si: l("Deux nuits courtes d'affilée"),
    alors: l('La séance de qualité devient un footing.'),
    pourquoi: l('Sans discussion.'),
    effet: { type: 'remplace', par: 'ef' } },
  { code: 'sautee', signal: 'seance_sautee', op: '>=', seuil: 1, gravite: 'ajuste',
    si: l('Une séance saute'),
    alors: l("Elle ne se rattrape jamais. On reprend où le plan en est."),
    pourquoi: l("Ordre de sacrifice : vélo, puis Hyrox n°2, puis natation du vendredi. Jamais la longue, jamais la qualité."),
    effet: { type: 'sacrifice', ordre: ['Vélo', 'Hyrox n°2', 'Natation'] } },
];

/* ---------------------------------------------------------------- échelle RPE */

/** Charge = durée (min) × RPE. Read week over week, never in absolute. */
export const msc_rpe: MscRpe[] = [
  { de: 1, a: 2, label: { fr: 'Très facile', pl: 'Bardzo łatwo' }, quoi: l('Récupération, nage souple') },
  { de: 3, a: 4, label: { fr: 'Facile', pl: 'Łatwo' }, quoi: l('Endurance fondamentale') },
  { de: 5, a: 6, label: { fr: 'Modéré', pl: 'Umiarkowanie' }, quoi: l('Endurance active') },
  { de: 7, a: 7, label: { fr: 'Difficile', pl: 'Trudno' }, quoi: l('Seuil') },
  { de: 8, a: 8, label: { fr: 'Très difficile', pl: 'Bardzo trudno' }, quoi: l('Allure 10 km, VMA') },
  { de: 9, a: 9, label: { fr: 'Quasi maximal', pl: 'Prawie maksymalnie' }, quoi: l('Test, 400 m') },
  { de: 10, a: 10, label: { fr: 'Maximal', pl: 'Maksymalnie' }, quoi: l('Course') },
];
