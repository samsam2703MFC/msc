/* Les trois coachs que l'athlète peut choisir. Ce qu'ils disent est le même
   plan ; c'est le ton qui change — et l'avatar. Le ton lui-même vit côté
   serveur (server/coach.mjs, PERSONA) : ici, ce que l'écran en montre. La
   liste des codes est la même que server/depots.mjs (COACHS). */

import type { Lang } from './types';

export const COACHS = ['tortionnaire', 'gentil', 'gros_porc'] as const;
export type CoachCode = (typeof COACHS)[number];

export interface Coach {
  code: CoachCode;
  nom: Record<Lang, string>;
  /** Comment il te parle, en une ligne — pour choisir en connaissance de cause. */
  ton: Record<Lang, string>;
  /** Sa réplique, sous l'avatar. */
  devise: Record<Lang, string>;
  /** Sa méthode, sport par sport : ce qu'il privilégie quand il entraîne.
      Clé = le code du sport (src/data/structure.ts, SPORTS). */
  methode: Record<string, Record<Lang, string>>;
}

export const COACH: Record<CoachCode, Coach> = {
  tortionnaire: {
    code: 'tortionnaire',
    nom: { fr: 'Le tortionnaire', pl: 'Kat' },
    ton: {
      fr: 'Exige, relève chaque écart, ne félicite jamais gratuitement.',
      pl: 'Wymaga, wytyka każde odstępstwo, nie chwali za darmo.',
    },
    devise: { fr: '« Tu appelles ça une séance ? »', pl: '„To ma być trening?”' },
    methode: {
      'Course à pied': {
        fr: 'Du seuil tôt et souvent : deux séances de qualité par semaine dès que la base tient, et la longue ne se négocie pas.',
        pl: 'Próg wcześnie i często: dwie jakościowe w tygodniu, gdy tylko baza wytrzyma, a długie wybieganie jest nienegocjowalne.',
      },
      Natation: {
        fr: 'Des séries courtes et chronométrées, départ toutes les X : la technique se tient aussi quand tu es fatigué, ou elle ne vaut rien.',
        pl: 'Krótkie serie na czas, start co X: technika ma się trzymać także w zmęczeniu, inaczej jest nic niewarta.',
      },
      Vélo: {
        fr: 'De la force en côte, assis, cadence basse. Rouler à plat en groupe ne construit rien.',
        pl: 'Siła na podjeździe, w siodle, niska kadencja. Płaska jazda w grupie niczego nie buduje.',
      },
      Hyrox: {
        fr: 'Lourd et peu de répétitions, puis l’enchaînement sans pause : c’est là que ça se joue, pas à l’échauffement.',
        pl: 'Ciężko i mało powtórzeń, potem obwód bez przerwy: to tam się rozstrzyga, nie na rozgrzewce.',
      },
    },
  },
  gentil: {
    code: 'gentil',
    nom: { fr: 'Le gentil', pl: 'Dobry' },
    ton: {
      fr: 'Encourage d’abord, corrige ensuite, explique toujours pourquoi.',
      pl: 'Najpierw zachęca, potem poprawia, zawsze tłumaczy dlaczego.',
    },
    devise: { fr: '« Regarde le chemin parcouru. »', pl: '„Spójrz, ile już przeszedłeś.”' },
    methode: {
      'Course à pied': {
        fr: 'L’endurance d’abord : du volume facile pendant des semaines, une seule séance dure, et la vitesse quand la base tient.',
        pl: 'Najpierw wytrzymałość: tygodnie spokojnej objętości, jedna mocna jednostka, a szybkość dopiero gdy baza się trzyma.',
      },
      Natation: {
        fr: 'La technique avant le volume : des éducatifs à chaque séance, allure facile, et on compte les coups de bras.',
        pl: 'Technika przed objętością: ćwiczenia techniczne na każdym treningu, spokojne tempo, liczymy ruchy ramion.',
      },
      Vélo: {
        fr: 'Du temps en selle à allure de conversation. L’intensité vient après, quand les heures sont là.',
        pl: 'Czas w siodle na tempie rozmowy. Intensywność przychodzi potem, gdy godziny już są.',
      },
      Hyrox: {
        fr: 'Des mouvements bien faits, des charges modérées, et 2,5 kg de plus à la fois — jamais dix.',
        pl: 'Dobrze wykonane ruchy, umiarkowane ciężary i 2,5 kg więcej na raz — nigdy dziesięć.',
      },
    },
  },
  gros_porc: {
    code: 'gros_porc',
    nom: { fr: 'Le gros porc', pl: 'Gruba świnia' },
    ton: {
      fr: 'Bouffe, canapé et gouaille — et pourtant, les consignes du plan.',
      pl: 'Żarcie, kanapa i jazda — a jednak zalecenia z planu.',
    },
    devise: { fr: '« Bordel, moi j’aurais pris une bière. »', pl: '„Cholera, ja bym wziął piwo.”' },
    methode: {
      'Course à pied': {
        fr: 'Le minimum qui marche : trois sorties, une seule qui pique, et la longue le dimanche — après le petit-déj.',
        pl: 'Minimum, które działa: trzy wybiegania, jedno bolesne, a długie w niedzielę — po śniadaniu.',
      },
      Natation: {
        fr: 'Deux fois par semaine, jamais plus d’une heure, et on sort avant que ça devienne un métier.',
        pl: 'Dwa razy w tygodniu, nigdy dłużej niż godzina, i wychodzimy zanim to stanie się zawodem.',
      },
      Vélo: {
        fr: 'Long, plat, tranquille, avec un arrêt café. Ça s’appelle de l’endurance fondamentale — je vérifie les watts.',
        pl: 'Długo, płasko, spokojnie, z przystankiem na kawę. To się nazywa baza tlenowa — waty i tak sprawdzam.',
      },
      Hyrox: {
        fr: 'Trois exercices, trois séries, et on rentre. Ce qui compte, c’est d’y retourner jeudi.',
        pl: 'Trzy ćwiczenia, trzy serie i do domu. Liczy się to, żeby wrócić tam w czwartek.',
      },
    },
  },
};

/** Le coach d'un code, ou le gentil si le code est inconnu — jamais rien. */
export function coachDe(code: string | null | undefined): Coach {
  return COACH[(COACHS as readonly string[]).includes(code ?? '') ? (code as CoachCode) : 'gentil'];
}
