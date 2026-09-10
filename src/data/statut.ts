/* Le statut d'une séance, tel que les écrans le montrent : une icône et une
   teinte (les lignes msc_statut, avec un repli pour un instantané en cache
   d'avant les deux derniers statuts), et le mot qui va avec — jamais la
   couleur seule. */

import * as db from './db';
import type { Lang, StatutCode } from './types';

const MOT: Record<Lang, Record<StatutCode, string>> = {
  fr: {
    fait: 'faite', partiel: 'autrement', manque: 'manquée', aujourdhui: 'aujourd’hui',
    prevu: 'à venir', repos: 'repos', adapte: 'adaptée',
  },
  pl: {
    fait: 'zrobiony', partiel: 'inaczej', manque: 'pominięty', aujourdhui: 'dzisiaj',
    prevu: 'zaplanowany', repos: 'odpoczynek', adapte: 'dostosowany',
  },
};

export function motDuStatut(code: StatutCode, lang: Lang): string {
  return MOT[lang][code] ?? code;
}

/* Les mêmes teintes que les lignes semées dans msc_statut. */
const REPLI: Partial<Record<StatutCode, { icon: string; couleur: string }>> = {
  partiel: { icon: 'circle-minus', couleur: '#BA7517' },
  manque: { icon: 'circle-x', couleur: '#D85A30' },
};

export function visuelDuStatut(code: StatutCode): { icon: string; couleur: string } {
  return db.one('msc_statut', (r) => r.code === code)
    ?? REPLI[code]
    ?? db.mustOne('msc_statut', (r) => r.code === 'prevu');
}
