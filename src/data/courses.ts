/* Les types de course — ce qu'on peut viser, et ce qu'on peut encoder.

   Un objectif et un start disent la même chose : une distance, une
   discipline, un chrono. Les nommer une fois ici évite qu'« un semi » soit
   21,097 km dans un écran et 21,1 dans l'autre, et donne aux deux la même
   liste déroulante.

   `comparable` dit si le chrono se ramène à une allure 10 km (Riegel) : c'est
   vrai d'une course à pied, faux d'un triathlon ou d'une nage — le plan y
   vise la date, pas une allure. */

import type { Lang } from './types';

export type Discipline = 'cap' | 'trail' | 'natation' | 'velo' | 'triathlon' | 'multi';

export interface TypeCourse {
  code: string;
  discipline: Discipline;
  nom: Record<Lang, string>;
  /** La distance officielle, en km — le total pour un enchaînement. */
  distance_km: number;
  /** Le chrono se ramène-t-il à une allure 10 km ? */
  comparable: boolean;
  /** Un ordre de grandeur, pour le champ « Cible » : h:mm:ss ou mm:ss. */
  exemple: string;
}

export const DISCIPLINES: Array<{ code: Discipline; nom: Record<Lang, string>; icon: string }> = [
  { code: 'cap', nom: { fr: 'Course à pied', pl: 'Bieganie' }, icon: 'footprints' },
  { code: 'trail', nom: { fr: 'Trail', pl: 'Trail' }, icon: 'mountain' },
  { code: 'natation', nom: { fr: 'Natation', pl: 'Pływanie' }, icon: 'waves' },
  { code: 'velo', nom: { fr: 'Vélo', pl: 'Rower' }, icon: 'bike' },
  { code: 'triathlon', nom: { fr: 'Triathlon & enchaînements', pl: 'Triathlon i wieloboje' }, icon: 'repeat' },
  { code: 'multi', nom: { fr: 'Hyrox & obstacles', pl: 'Hyrox i przeszkody' }, icon: 'dumbbell' },
];

export const TYPES_COURSE: TypeCourse[] = [
  /* course à pied — les seules dont le chrono devient une allure */
  { code: 'cap_5', discipline: 'cap', nom: { fr: '5 km', pl: '5 km' }, distance_km: 5, comparable: true, exemple: '21:00' },
  { code: 'cap_10', discipline: 'cap', nom: { fr: '10 km', pl: '10 km' }, distance_km: 10, comparable: true, exemple: '43:00' },
  { code: 'cap_15', discipline: 'cap', nom: { fr: '15 km', pl: '15 km' }, distance_km: 15, comparable: true, exemple: '1:07:00' },
  { code: 'cap_10_miles', discipline: 'cap', nom: { fr: '10 miles (16,1 km)', pl: '10 mil (16,1 km)' }, distance_km: 16.093, comparable: true, exemple: '1:12:00' },
  { code: 'cap_20', discipline: 'cap', nom: { fr: '20 km', pl: '20 km' }, distance_km: 20, comparable: true, exemple: '1:32:00' },
  { code: 'cap_semi', discipline: 'cap', nom: { fr: 'Semi-marathon', pl: 'Półmaraton' }, distance_km: 21.097, comparable: true, exemple: '1:35:00' },
  { code: 'cap_marathon', discipline: 'cap', nom: { fr: 'Marathon', pl: 'Maraton' }, distance_km: 42.195, comparable: true, exemple: '3:20:00' },
  { code: 'cap_100', discipline: 'cap', nom: { fr: '100 km', pl: '100 km' }, distance_km: 100, comparable: true, exemple: '9:30:00' },
  { code: 'cap_cross', discipline: 'cap', nom: { fr: 'Cross', pl: 'Biegi przełajowe' }, distance_km: 8, comparable: true, exemple: '30:00' },
  { code: 'cap_piste_1500', discipline: 'cap', nom: { fr: 'Piste · 1500 m', pl: 'Bieżnia · 1500 m' }, distance_km: 1.5, comparable: true, exemple: '5:10' },
  { code: 'cap_piste_3000', discipline: 'cap', nom: { fr: 'Piste · 3000 m', pl: 'Bieżnia · 3000 m' }, distance_km: 3, comparable: true, exemple: '11:30' },
  { code: 'cap_piste_5000', discipline: 'cap', nom: { fr: 'Piste · 5000 m', pl: 'Bieżnia · 5000 m' }, distance_km: 5, comparable: true, exemple: '20:00' },

  /* trail — un chrono qui dépend du dénivelé, donc pas d'allure à en tirer */
  { code: 'trail_court', discipline: 'trail', nom: { fr: 'Trail court (< 25 km)', pl: 'Trail krótki (< 25 km)' }, distance_km: 20, comparable: false, exemple: '2:10:00' },
  { code: 'trail_long', discipline: 'trail', nom: { fr: 'Trail long (25–50 km)', pl: 'Trail długi (25–50 km)' }, distance_km: 42, comparable: false, exemple: '5:00:00' },
  { code: 'trail_ultra', discipline: 'trail', nom: { fr: 'Ultra-trail (> 50 km)', pl: 'Ultratrail (> 50 km)' }, distance_km: 80, comparable: false, exemple: '12:00:00' },
  { code: 'trail_verticale', discipline: 'trail', nom: { fr: 'Kilomètre vertical', pl: 'Kilometr pionowy' }, distance_km: 5, comparable: false, exemple: '50:00' },

  /* natation */
  { code: 'nat_750', discipline: 'natation', nom: { fr: '750 m', pl: '750 m' }, distance_km: 0.75, comparable: false, exemple: '13:00' },
  { code: 'nat_1500', discipline: 'natation', nom: { fr: '1500 m', pl: '1500 m' }, distance_km: 1.5, comparable: false, exemple: '26:00' },
  { code: 'nat_1900', discipline: 'natation', nom: { fr: '1900 m', pl: '1900 m' }, distance_km: 1.9, comparable: false, exemple: '35:00' },
  { code: 'nat_3800', discipline: 'natation', nom: { fr: '3800 m', pl: '3800 m' }, distance_km: 3.8, comparable: false, exemple: '1:12:00' },
  { code: 'nat_eau_libre_5', discipline: 'natation', nom: { fr: 'Eau libre · 5 km', pl: 'Wody otwarte · 5 km' }, distance_km: 5, comparable: false, exemple: '1:35:00' },
  { code: 'nat_eau_libre_10', discipline: 'natation', nom: { fr: 'Eau libre · 10 km', pl: 'Wody otwarte · 10 km' }, distance_km: 10, comparable: false, exemple: '3:10:00' },

  /* vélo */
  { code: 'velo_cyclo', discipline: 'velo', nom: { fr: 'Cyclosportive', pl: 'Cyklosportowa' }, distance_km: 120, comparable: false, exemple: '4:30:00' },
  { code: 'velo_granfondo', discipline: 'velo', nom: { fr: 'Granfondo (> 150 km)', pl: 'Granfondo (> 150 km)' }, distance_km: 170, comparable: false, exemple: '6:00:00' },
  { code: 'velo_clm', discipline: 'velo', nom: { fr: 'Contre-la-montre', pl: 'Jazda na czas' }, distance_km: 40, comparable: false, exemple: '1:00:00' },
  { code: 'velo_gravel', discipline: 'velo', nom: { fr: 'Gravel', pl: 'Gravel' }, distance_km: 100, comparable: false, exemple: '4:00:00' },
  { code: 'velo_vtt', discipline: 'velo', nom: { fr: 'VTT / marathon VTT', pl: 'MTB / maraton MTB' }, distance_km: 60, comparable: false, exemple: '3:00:00' },

  /* triathlon et enchaînements — la distance est le total des trois */
  { code: 'tri_sprint', discipline: 'triathlon', nom: { fr: 'Triathlon S (0,75 / 20 / 5)', pl: 'Triathlon S (0,75 / 20 / 5)' }, distance_km: 25.75, comparable: false, exemple: '1:15:00' },
  { code: 'tri_olympique', discipline: 'triathlon', nom: { fr: 'Triathlon M · olympique (1,5 / 40 / 10)', pl: 'Triathlon M · olimpijski (1,5 / 40 / 10)' }, distance_km: 51.5, comparable: false, exemple: '2:30:00' },
  { code: 'tri_70_3', discipline: 'triathlon', nom: { fr: 'Half · 70.3 (1,9 / 90 / 21,1)', pl: 'Half · 70.3 (1,9 / 90 / 21,1)' }, distance_km: 113, comparable: false, exemple: '5:30:00' },
  { code: 'tri_ironman', discipline: 'triathlon', nom: { fr: 'Ironman (3,8 / 180 / 42,2)', pl: 'Ironman (3,8 / 180 / 42,2)' }, distance_km: 226, comparable: false, exemple: '12:00:00' },
  { code: 'tri_duathlon', discipline: 'triathlon', nom: { fr: 'Duathlon (10 / 40 / 5)', pl: 'Duatlon (10 / 40 / 5)' }, distance_km: 55, comparable: false, exemple: '2:20:00' },
  { code: 'tri_swimrun', discipline: 'triathlon', nom: { fr: 'Swimrun', pl: 'Swimrun' }, distance_km: 30, comparable: false, exemple: '4:00:00' },
  { code: 'tri_aquathlon', discipline: 'triathlon', nom: { fr: 'Aquathlon (1 / 5)', pl: 'Aquathlon (1 / 5)' }, distance_km: 6, comparable: false, exemple: '35:00' },

  /* hyrox et obstacles */
  { code: 'multi_hyrox', discipline: 'multi', nom: { fr: 'Hyrox', pl: 'Hyrox' }, distance_km: 8, comparable: false, exemple: '1:20:00' },
  { code: 'multi_hyrox_double', discipline: 'multi', nom: { fr: 'Hyrox · doubles', pl: 'Hyrox · pary' }, distance_km: 8, comparable: false, exemple: '1:10:00' },
  { code: 'multi_obstacle', discipline: 'multi', nom: { fr: 'Course à obstacles (OCR)', pl: 'Bieg z przeszkodami (OCR)' }, distance_km: 12, comparable: false, exemple: '1:40:00' },
  { code: 'multi_deka', discipline: 'multi', nom: { fr: 'DekaFit', pl: 'DekaFit' }, distance_km: 5, comparable: false, exemple: '45:00' },
];

const PAR_CODE = new Map(TYPES_COURSE.map((t) => [t.code, t]));

export function typeCourse(code: string | null | undefined): TypeCourse | null {
  return code ? PAR_CODE.get(code) ?? null : null;
}

/** Le libellé d'un type, ou la distance seule quand il n'y en a pas — une
    course encodée avant que les types existent. */
export function nomDuType(code: string | null | undefined, lang: Lang, distanceKm?: number): string {
  const t = typeCourse(code);
  if (t) return t.nom[lang];
  return distanceKm ? `${distanceKm} km` : '—';
}

/** Le chrono d'un type se ramène-t-il à une allure 10 km ? Sans type — les
    courses d'avant — on suppose que oui : c'était le cas de toutes. */
export function comparableAuDixKm(code: string | null | undefined): boolean {
  const t = typeCourse(code);
  return t ? t.comparable : true;
}

/** La discipline telle que msc_competition la stocke, pour les écrans qui la
    lisent en clair. */
export function disciplineEnClair(code: string | null | undefined, lang: Lang): string {
  const t = typeCourse(code);
  const d = DISCIPLINES.find((x) => x.code === (t?.discipline ?? 'cap'));
  return d ? d.nom[lang] : '';
}

/** Les types groupés par discipline, dans l'ordre du catalogue : ce qu'une
    liste déroulante affiche. */
export function typesGroupes(lang: Lang): Array<{ discipline: string; types: Array<{ code: string; nom: string }> }> {
  return DISCIPLINES.map((d) => ({
    discipline: d.nom[lang],
    types: TYPES_COURSE.filter((t) => t.discipline === d.code).map((t) => ({ code: t.code, nom: t.nom[lang] })),
  })).filter((g) => g.types.length > 0);
}
