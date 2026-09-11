/* Les cinq onglets de l'application de l'athlète : leur ordre, leur icône,
   leur nom dans la barre et le titre de la page.

   Ils vivaient dans msc_ui, en base, avec une migration pour les renommer.
   Cinq mots ne méritent pas ça : les voici en clair. Le bureau ne les lit
   pas — c'est le back office, et l'entraînement de l'athlète n'y est pas. */

import type { Lang, ScreenKey } from './types';

/** L'ordre de la barre du bas. */
export const ORDRE: ScreenKey[] = ['today', 'week', 'coach', 'dupki', 'moi'];

export const ICONES: Record<ScreenKey, string> = {
  today: 'sun',
  week: 'calendar-days',
  coach: 'bot',
  dupki: 'flame',
  moi: 'user',
};

/** Le mot sous l'icône : court, il n'a que la largeur d'un cinquième. */
export const ONGLET: Record<ScreenKey, Record<Lang, string>> = {
  today: { fr: "Aujourd'hui", pl: 'Dzisiaj' },
  week: { fr: 'Semaine', pl: 'Tydzień' },
  coach: { fr: 'Coach', pl: 'Trener' },
  dupki: { fr: 'Dupki', pl: 'Dupki' },
  moi: { fr: 'Moi', pl: 'Ja' },
};

/** Le titre de la page : il a la place de dire la même chose en entier. */
export const TITRE: Record<ScreenKey, Record<Lang, string>> = {
  today: { fr: "Aujourd'hui", pl: 'Dzisiaj' },
  week: { fr: 'La semaine', pl: 'Tydzień' },
  coach: { fr: 'Forme & coach', pl: 'Forma i trener' },
  dupki: { fr: 'Dupki', pl: 'Dupki' },
  moi: { fr: 'Mon entraînement', pl: 'Mój trening' },
};
