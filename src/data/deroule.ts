/* Le déroulé d'une séance : ce qu'on fait, dans l'ordre, à quelle allure et à
   quelle fréquence cardiaque.

   Avant, une séance disait « 60 min · RPE 6 · seuil » et une phrase de détail.
   C'est assez pour savoir quoi faire quand on sait déjà quoi faire. Pour
   quelqu'un qui regarde son téléphone à 6 h du matin, ça ne dit ni combien de
   temps s'échauffer, ni combien de fois, ni à quoi ressemble la récupération
   entre deux blocs.

   Rien de nouveau n'est stocké : le déroulé se calcule du type de la séance,
   de sa durée et de la référence de son bloc — exactement comme les allures.
   Le stocker, ce serait en avoir deux versions dont une fausse le jour où
   l'athlète progresse ou le jour où le coach raccourcit la séance.

   Les fréquences cardiaques, elles, viennent de la réserve cardiaque
   (Karvonen) : FC = repos + part × (max − repos). La FC max est estimée par
   Tanaka — 208 − 0,7 × âge — plus juste que 220 − âge au-delà de quarante ans,
   et l'année de naissance est dans le profil. Sans elle, le déroulé donne les
   allures et se tait sur la FC plutôt que d'inventer une plage. */

import * as db from './db';
import type { MscPlanSession, TypeCode, ZoneCode, Lang } from './types';

export interface Etape {
  /** Durée en minutes. Zéro pour une consigne sans durée propre. */
  minutes: number;
  libelle: Record<Lang, string>;
  /** La zone d'allure de l'étape, quand elle en a une. */
  zone?: ZoneCode;
  /** L'allure affichée, déjà calculée — « 4:12/km », ou une rampe. */
  allure?: string;
  /** La plage de FC, quand on peut l'estimer. */
  fc?: [number, number];
  /** Répétée : « ×6 » sur un bloc de fractionné. */
  repetitions?: number;
  /** Ce que l'étape est : l'écran s'en sert pour la mettre en avant. */
  role: 'echauffement' | 'travail' | 'recuperation' | 'retour';
}

export interface Deroule {
  etapes: Etape[];
  /** La FC max estimée, et d'où elle vient — ou null si on ne peut pas. */
  fcMax: number | null;
  fcRepos: number | null;
  total: number;
}

const l = (fr: string, pl: string): Record<Lang, string> => ({ fr, pl });

/* La part de la réserve cardiaque par zone. Ce sont les fourchettes usuelles
   du modèle de Karvonen, rangées ici plutôt qu'en base : elles ne dépendent
   pas de l'athlète, seulement de la zone. */
const RESERVE: Partial<Record<ZoneCode, [number, number]>> = {
  recup: [0.5, 0.6],
  ef: [0.6, 0.7],
  endactive: [0.7, 0.78],
  marathon: [0.78, 0.84],
  semi: [0.84, 0.88],
  seuil: [0.85, 0.9],
  allure10: [0.88, 0.92],
  vma: [0.92, 0.97],
};

/** La FC max estimée : Tanaka, 208 − 0,7 × âge. */
export function fcMaxEstimee(anneeNaissance?: number | null): number | null {
  if (!anneeNaissance) return null;
  const age = new Date().getUTCFullYear() - anneeNaissance;
  if (age < 10 || age > 100) return null;
  return Math.round(208 - 0.7 * age);
}

/* La FC de repos telle que les mesures la donnent : la médiane des trente
   derniers jours, pas la dernière — une mauvaise nuit ne redéfinit pas une
   ligne de base. */
function fcReposHabituelle(): number | null {
  const valeurs = db
    .select('msc_daily', (d) => d.fc_repos != null)
    .slice(-30)
    .map((d) => d.fc_repos as number)
    .sort((a, b) => a - b);
  return valeurs.length >= 3 ? valeurs[Math.floor(valeurs.length / 2)] : null;
}

/* Le squelette d'une séance, par type. Les durées sont des parts de la séance
   quand elles dépendent d'elle, des minutes fixes quand elles n'en dépendent
   pas — un échauffement ne dure pas une demi-heure parce que la sortie est
   longue. `travail` reçoit ce qui reste une fois l'échauffement et le retour
   au calme retirés. */
type Recette = {
  echauffement: number;
  retour: number;
  /** Le corps de séance : une suite de blocs, éventuellement répétés. */
  corps: (minutes: number) => Array<{
    minutes: number; zone: ZoneCode; repetitions?: number;
    role: 'travail' | 'recuperation'; libelle: Record<Lang, string>;
  }>;
};

const CONTINU = (zone: ZoneCode, nom: Record<Lang, string>): Recette['corps'] => (m) => [
  { minutes: m, zone, role: 'travail', libelle: nom },
];

/** Un fractionné : n fois (travail, récupération). */
function fractionne(
  travail: number, recup: number, zone: ZoneCode, nom: Record<Lang, string>,
): Recette['corps'] {
  return (m) => {
    const repetitions = Math.max(1, Math.round(m / (travail + recup)));
    return [
      { minutes: travail, zone, role: 'travail', repetitions, libelle: nom },
      {
        minutes: recup, zone: 'recup', role: 'recuperation', repetitions,
        libelle: l('Récupération entre les blocs', 'Regeneracja między blokami'),
      },
    ];
  };
}

const RECETTES: Partial<Record<TypeCode, Recette>> = {
  ef: { echauffement: 0, retour: 0, corps: CONTINU('ef', l('Endurance fondamentale', 'Wytrzymałość podstawowa')) },
  recup: { echauffement: 0, retour: 0, corps: CONTINU('recup', l('Footing de récupération', 'Bieg regeneracyjny')) },
  endactive: { echauffement: 10, retour: 10, corps: CONTINU('endactive', l('Endurance active', 'Wytrzymałość aktywna')) },
  longue: {
    echauffement: 0,
    retour: 0,
    corps: (m) => [
      { minutes: Math.round(m * 0.75), zone: 'ef', role: 'travail', libelle: l('Sortie longue, à l’aise', 'Długie wybieganie, spokojnie') },
      { minutes: m - Math.round(m * 0.75), zone: 'marathon', role: 'travail', libelle: l('Fin en allure marathon', 'Końcówka w tempie maratonu') },
    ],
  },
  seuil: { echauffement: 15, retour: 10, corps: fractionne(8, 3, 'seuil', l('Bloc au seuil', 'Blok progowy')) },
  allure10: { echauffement: 15, retour: 10, corps: fractionne(5, 2, 'allure10', l('Bloc à l’allure 10 km', 'Blok w tempie 10 km')) },
  vma: { echauffement: 15, retour: 10, corps: fractionne(3, 3, 'vma', l('Bloc VMA, volontaire', 'Blok VO2max, mocno')) },
  montagne: { echauffement: 15, retour: 10, corps: CONTINU('endactive', l('Montée, à l’effort constant', 'Podbieg, stały wysiłek')) },
  test: { echauffement: 20, retour: 10, corps: CONTINU('allure10', l('Test chronométré', 'Test na czas')) },
  course: { echauffement: 20, retour: 10, corps: CONTINU('allure10', l('La course', 'Zawody')) },
};

/** Ce que la séance demande, étape par étape. */
export function deroule(session: MscPlanSession): Deroule | null {
  const recette = RECETTES[session.type];
  const fcMax = fcMaxEstimee(db.athlete.annee_naissance);
  const fcRepos = fcReposHabituelle();
  if (!recette || session.duree_min <= 0) {
    return null;
  }

  const fc = (zone: ZoneCode): [number, number] | undefined => {
    const part = RESERVE[zone];
    if (!part || !fcMax || !fcRepos) return undefined;
    return [
      Math.round(fcRepos + part[0] * (fcMax - fcRepos)),
      Math.round(fcRepos + part[1] * (fcMax - fcRepos)),
    ];
  };

  const echauffement = Math.min(recette.echauffement, Math.floor(session.duree_min / 3));
  const retour = Math.min(recette.retour, Math.floor(session.duree_min / 4));
  const corps = Math.max(session.duree_min - echauffement - retour, 1);

  const etapes: Etape[] = [];
  if (echauffement > 0) {
    etapes.push({
      minutes: echauffement,
      libelle: l('Échauffement, en montant progressivement', 'Rozgrzewka, stopniowo'),
      zone: 'ef',
      /* Une rampe, pas une allure : on part plus lentement que l'endurance et
         on y arrive. C'est ce que « @6:45 → 6:00 » veut dire. */
      allure: `${db.allure('recup', session.bloc)} → ${db.allure('ef', session.bloc)}`,
      fc: fc('ef'),
      role: 'echauffement',
    });
  }

  for (const bloc of recette.corps(corps)) {
    etapes.push({
      minutes: bloc.minutes,
      libelle: bloc.libelle,
      zone: bloc.zone,
      allure: db.allure(bloc.zone, session.bloc),
      fc: fc(bloc.zone),
      repetitions: bloc.repetitions,
      role: bloc.role,
    });
  }

  if (retour > 0) {
    etapes.push({
      minutes: retour,
      libelle: l('Retour au calme', 'Schłodzenie'),
      zone: 'recup',
      allure: db.allure('recup', session.bloc),
      fc: fc('recup'),
      role: 'retour',
    });
  }

  return {
    etapes,
    fcMax,
    fcRepos,
    total: etapes.reduce((t, e) => t + e.minutes * (e.repetitions ?? 1), 0),
  };
}
