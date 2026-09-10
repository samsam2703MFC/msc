/* Ce que le seed de démonstration a laissé dans une base vivante, et comment
   le retirer.

   `npm run db:seed` pose, avec le classeur, un petit vécu pour que les écrans
   aient quelque chose à montrer : deux activités Strava inventées (octobre
   2026), un journal, sept FC de repos, deux analyses du coach avec leurs
   propositions — et le plan de trente semaines lui-même, avec ses quatre
   courses. Sur une base où l'athlète vit sa vraie saison, ces lignes
   trompent : une activité datée dans le futur, un 10 km qu'il ne court pas.

     npm run db:demo                  dit ce qu'il y a, ne touche à rien
     npm run db:demo -- retirer       retire le vécu inventé
     npm run db:demo -- retirer --plan   … et le plan de démonstration s'il
                                      n'est plus actif, avec ses courses sans
                                      résultat
     --athlete N                      l'athlète du seed (1 par défaut)

   Les lignes sont reconnues à ce que le seed y écrit — les identifiants Strava
   148120 et 148377, les dates d'octobre 2026, les modèles des analyses —
   jamais à une date « ancienne » : rien de ce que l'athlète a saisi lui-même
   n'y ressemble. */

import { bd, lignes } from '../server/bd.mjs';

const args = process.argv.slice(2);
const retirer = args.includes('retirer');
const avecPlan = args.includes('--plan');
const athlete = Number(args[args.indexOf('--athlete') + 1] || 1) || 1;

const LOTS = [
  {
    quoi: 'activités Strava inventées (octobre 2026)',
    compte: `SELECT COUNT(*) AS n FROM msc_activity WHERE athlete_id = ? AND id_strava IN (148120, 148377)`,
    efface: `DELETE FROM msc_activity WHERE athlete_id = ? AND id_strava IN (148120, 148377)`,
  },
  {
    quoi: 'journal de la séance de démonstration (14/10/2026)',
    compte: `SELECT COUNT(*) AS n FROM msc_journal WHERE athlete_id = ? AND date = '2026-10-14' AND rpe_ressenti = 8
             AND session_id IN (SELECT id FROM msc_session WHERE date = '2026-10-14')`,
    efface: `DELETE FROM msc_journal WHERE athlete_id = ? AND date = '2026-10-14' AND rpe_ressenti = 8
             AND session_id IN (SELECT id FROM msc_session WHERE date = '2026-10-14')`,
  },
  {
    quoi: 'FC de repos importées du classeur (8 → 14/10/2026)',
    compte: `SELECT COUNT(*) AS n FROM msc_mesure WHERE athlete_id = ? AND source = 'import'
             AND date BETWEEN '2026-10-08' AND '2026-10-14' AND poids_kg IS NULL AND hrv_ms IS NULL`,
    efface: `DELETE FROM msc_mesure WHERE athlete_id = ? AND source = 'import'
             AND date BETWEEN '2026-10-08' AND '2026-10-14' AND poids_kg IS NULL AND hrv_ms IS NULL`,
  },
  {
    quoi: 'analyses du coach inventées, et leurs propositions',
    compte: `SELECT COUNT(*) AS n FROM msc_analyse WHERE athlete_id = ? AND modele IN ('haiku-4-5', 'sonnet-5')
             AND date IN ('2026-10-14', '2026-10-18')`,
    efface: `DELETE FROM msc_analyse WHERE athlete_id = ? AND modele IN ('haiku-4-5', 'sonnet-5')
             AND date IN ('2026-10-14', '2026-10-18')`,
  },
];

const q = bd();
let total = 0;
for (const lot of LOTS) {
  const [[{ n }]] = await q.execute(lot.compte, [athlete]);
  total += Number(n);
  if (retirer && n > 0) {
    await q.execute(lot.efface, [athlete]);
    console.log(`− ${lot.quoi} : ${n} retirée(s)`);
  } else {
    console.log(`${n > 0 ? '·' : ' '} ${lot.quoi} : ${n}`);
  }
}

/* Le plan de démonstration : le classeur de trente semaines, et ses courses. */
const plans = await lignes(
  `SELECT id, nom, actif FROM msc_plan WHERE athlete_id = :a AND origine = 'classeur' AND nom LIKE 'Plan 30 semaines%'`,
  { a: athlete },
);
for (const p of plans) {
  const courses = await lignes(
    `SELECT c.id, c.nom, c.date FROM msc_competition c
     WHERE c.athlete_id = :a
       AND EXISTS (SELECT 1 FROM msc_objectif o WHERE o.competition_id = c.id AND o.plan_id = :p)
       AND NOT EXISTS (SELECT 1 FROM msc_objectif o WHERE o.competition_id = c.id AND o.plan_id <> :p)
       AND NOT EXISTS (SELECT 1 FROM msc_resultat r WHERE r.competition_id = c.id)`,
    { a: athlete, p: p.id },
  );
  const etat = p.actif ? 'ACTIF — laissé tel quel' : 'inactif';
  if (retirer && avecPlan && !p.actif) {
    for (const c of courses) await q.execute('DELETE FROM msc_competition WHERE id = ?', [c.id]);
    await q.execute('DELETE FROM msc_plan WHERE id = ?', [p.id]);
    console.log(`− plan de démonstration « ${p.nom} » retiré, avec ${courses.length} course(s) : ${courses.map((c) => `${c.nom} (${c.date})`).join(', ') || '—'}`);
  } else {
    console.log(`· plan de démonstration « ${p.nom} » : ${etat}, ${courses.length} course(s) à lui seul : ${courses.map((c) => `${c.nom} (${c.date})`).join(', ') || '—'}`);
    if (!retirer || !avecPlan) console.log('  (npm run db:demo -- retirer --plan pour le retirer, s’il est inactif)');
  }
}

if (!retirer) console.log(total > 0 || plans.length > 0 ? '\nRien n’a été touché : ajoute « retirer ».' : '\nRien de la démonstration ici.');
await q.end();
