/* Checks the one piece of the Strava integration that has a right answer:
   deciding which session an activity was.

   The rest of it — OAuth, the token refresh, the webhook — is Strava's own
   behaviour and can only be tested against Strava. The matcher is ours, it is
   pure, and getting it wrong is how a plan starts ticking off sessions the
   athlete never did. So it runs against the real plan, not a fixture. */

import { apparier, blocsDeQualite, seancesDeQualite } from '../src/data/strava';
import type { ActiviteDetaillee, ActiviteStrava } from '../src/data/strava';
import { msc_session as PLAN } from '../src/data/plan.generated';

let fails = 0;
const check = (nom: string, ok: boolean, detail = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${nom}${detail ? '  — ' + detail : ''}`);
};

/** A summary activity, with everything the matcher does not look at defaulted. */
function activite(p: Partial<ActiviteStrava> & Pick<ActiviteStrava, 'date' | 'sport'>): ActiviteStrava {
  return {
    id_strava: Math.floor(Math.random() * 1e9),
    debut: `${p.date}T07:00:00Z`,
    nom: 'Séance',
    sport_strava: 'Run',
    duree_min: 60,
    duree_s: 3600,
    distance_m: 12_000,
    denivele_m: 0,
    manuelle: false,
    privee: false,
    ...p,
  };
}

/* The workbook's semaine 7, the week every seeded example is anchored on:
   mardi swim 70' + vélo 45', mercredi seuil 68', jeudi Hyrox 75'. */
const MARDI = '2026-10-13';
const MERCREDI = '2026-10-14';

console.log('=== appariement ===');

const nage = activite({ date: MARDI, sport: 'swim', duree_min: 70, sport_strava: 'Swim' });
const velo = activite({ date: MARDI, sport: 'bike', duree_min: 45, sport_strava: 'Ride' });
const seuil = activite({ date: MERCREDI, sport: 'run', duree_min: 68, allure_s_km: 296, fc_moy: 168 });

const base = apparier([nage, velo, seuil], PLAN);
const par = (id: number) => base.activites.find((a) => a.id_strava === id);

check('la nage du mardi tombe sur la séance de nage', par(nage.id_strava)?.session_id === 1050,
  String(par(nage.id_strava)?.session_id));
check('le vélo du mardi tombe sur la séance de vélo', par(velo.id_strava)?.session_id === 1051,
  String(par(velo.id_strava)?.session_id));
check('le seuil du mercredi tombe sur la séance de seuil', par(seuil.id_strava)?.session_id === 1052,
  String(par(seuil.id_strava)?.session_id));
check('rien n’est orphelin', base.orphelines.length === 0, `${base.orphelines.length}`);

/* Only running is written in paces; a swim carrying "4:56/km" would be a lie. */
check('la course porte une allure', par(seuil.id_strava)?.allure_moy === '4:56/km',
  String(par(seuil.id_strava)?.allure_moy));
check('la nage n’en porte pas', par(nage.id_strava)?.allure_moy === undefined);
check('la FC remonte', par(seuil.id_strava)?.fc_moy === 168);

/* The realistic collision: the athlete jogs 20 minutes in the morning and runs
   the session in the evening. Chronological order would hand the session to
   the jog; duration decides instead. */
console.log('\n=== deux activités, une séance ===');
const footingMatin = activite({ date: MERCREDI, sport: 'run', duree_min: 22, debut: `${MERCREDI}T06:30:00Z` });
const seanceSoir = activite({ date: MERCREDI, sport: 'run', duree_min: 68, debut: `${MERCREDI}T18:00:00Z` });
const collision = apparier([footingMatin, seanceSoir], PLAN);
check('la séance du soir prend la séance de seuil',
  collision.activites.find((a) => a.id_strava === seanceSoir.id_strava)?.session_id === 1052);
check('le footing du matin reste orphelin',
  collision.orphelines.length === 1 && collision.orphelines[0].id_strava === footingMatin.id_strava);

/* The workbook plan never puts two sessions of one discipline on one day, but
   a generated plan can, so the tie-break is checked against a fixture. */
console.log('\n=== un jour, deux séances de la même discipline ===');
const matin = { ...PLAN[0], id: 90_001, date: MARDI, discipline: 'Natation', duree_min: 70 };
const soir = { ...PLAN[0], id: 90_002, date: MARDI, discipline: 'Natation', duree_min: 40 };
const nageLongue = activite({ date: MARDI, sport: 'swim', duree_min: 68, sport_strava: 'Swim' });
const nageCourte = activite({ date: MARDI, sport: 'swim', duree_min: 38, sport_strava: 'Swim' });
const deux = apparier([nageCourte, nageLongue], [matin, soir]);
const ids = deux.activites.map((a) => a.session_id);
check('chaque séance est prise une fois', new Set(ids).size === ids.length && ids.length === 2, ids.join(' '));
check('la longue va sur la longue',
  deux.activites.find((a) => a.id_strava === nageLongue.id_strava)?.session_id === 90_001);
check('la courte va sur la courte',
  deux.activites.find((a) => a.id_strava === nageCourte.id_strava)?.session_id === 90_002);

console.log('\n=== ce qui ne doit pas s’apparier ===');

/* Strictly same-day. A long run moved to Monday is a session missed and a
   session done, and the coach screen has rules for exactly that — guessing
   here would tick the wrong box and hide the gap. */
const veille = apparier([activite({ date: '2026-10-13', sport: 'run', duree_min: 68 })], PLAN);
check('une course la veille ne prend pas la séance du lendemain',
  veille.activites.every((a) => a.session_id !== 1052));

const repos = PLAN.find((s) => s.discipline === 'Repos');
if (repos) {
  const r = apparier([activite({ date: repos.date, sport: 'bike', duree_min: 40 })], PLAN);
  check('un vélo un jour de repos est orphelin', r.orphelines.length === 1 && r.activites.length === 0);
}

const yoga = apparier([activite({ date: MERCREDI, sport: 'autre', duree_min: 45 })], PLAN);
check('un sport hors plan est orphelin', yoga.orphelines.length === 1 && yoga.activites.length === 0);

const horsPlan = apparier([activite({ date: '2025-01-01', sport: 'run' })], PLAN);
check('une course hors du plan est orpheline', horsPlan.orphelines.length === 1);

console.log('\n=== les blocs d’une séance de qualité ===');

/* 20' warm-up, 5 × 3' at threshold with 1'30 jogged, 15' cool-down — the
   session the seeded analysis is written against. The work sits 60 s/km clear
   of everything else, which is the gap the split looks for. */
const laps = [
  { index: 1, duree_s: 1200, distance_m: 3300, allure_s_km: 364 },
  ...[292, 293, 295, 299, 304].flatMap((allure, i) => [
    { index: 2 + i * 2, duree_s: 180, distance_m: 617, allure_s_km: allure },
    { index: 3 + i * 2, duree_s: 90, distance_m: 220, allure_s_km: 409 },
  ]),
  { index: 12, duree_s: 900, distance_m: 2400, allure_s_km: 375 },
];
const detail: ActiviteDetaillee = { ...seuil, calories: 700, laps };

check('les cinq blocs ressortent, les récups non',
  JSON.stringify(blocsDeQualite(detail)) === JSON.stringify([292, 293, 295, 299, 304]),
  JSON.stringify(blocsDeQualite(detail)));

const avecLaps = apparier([seuil], PLAN, new Map([[seuil.id_strava, detail]]));
check('ils arrivent sur la ligne msc_activity',
  JSON.stringify(avecLaps.activites[0]?.splits_blocs) === JSON.stringify([292, 293, 295, 299, 304]));

/* A footing has no intervals to find, and inventing some would draw a chart of
   nothing. */
const footing: ActiviteDetaillee = {
  ...seuil,
  laps: [{ index: 1, duree_s: 3600, distance_m: 10_000, allure_s_km: 360 }],
};
check('un footing ne rend pas de blocs', blocsDeQualite(footing) === undefined);

/* Eight kilometre laps within a few seconds of each other: a steady run, not a
   session of eight intervals. */
const regulier: ActiviteDetaillee = {
  ...seuil,
  laps: [352, 349, 351, 347, 350, 348, 353, 346].map((allure, i) => ({
    index: i + 1,
    duree_s: allure,
    distance_m: 1000,
    allure_s_km: allure,
  })),
};
check('une sortie régulière ne rend pas de blocs', blocsDeQualite(regulier) === undefined,
  JSON.stringify(blocsDeQualite(regulier)));

console.log('\n=== quelles activités méritent une requête de détail ===');
const aDetailler = seancesDeQualite(base.activites, PLAN);
check('le seuil oui', aDetailler.includes(seuil.id_strava));
check('la nage non', !aDetailler.includes(nage.id_strava));
check('le vélo non', !aDetailler.includes(velo.id_strava));

console.log(`\n${PLAN.length} séances au plan`);
console.log(fails === 0 ? '\nOK' : `\n${fails} ÉCHECS`);
process.exit(fails === 0 ? 0 : 1);
