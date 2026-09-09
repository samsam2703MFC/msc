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
  },
  gentil: {
    code: 'gentil',
    nom: { fr: 'Le gentil', pl: 'Dobry' },
    ton: {
      fr: 'Encourage d’abord, corrige ensuite, explique toujours pourquoi.',
      pl: 'Najpierw zachęca, potem poprawia, zawsze tłumaczy dlaczego.',
    },
    devise: { fr: '« Regarde le chemin parcouru. »', pl: '„Spójrz, ile już przeszedłeś.”' },
  },
  gros_porc: {
    code: 'gros_porc',
    nom: { fr: 'Le gros porc', pl: 'Gruba świnia' },
    ton: {
      fr: 'Bouffe, canapé et gouaille — et pourtant, les consignes du plan.',
      pl: 'Żarcie, kanapa i jazda — a jednak zalecenia z planu.',
    },
    devise: { fr: '« Bordel, moi j’aurais pris une bière. »', pl: '„Cholera, ja bym wziął piwo.”' },
  },
};

/** Le coach d'un code, ou le gentil si le code est inconnu — jamais rien. */
export function coachDe(code: string | null | undefined): Coach {
  return COACH[(COACHS as readonly string[]).includes(code ?? '') ? (code as CoachCode) : 'gentil'];
}
