/* Ce que le seed de démonstration a laissé dans une base vivante, et comment
   le retirer — la même logique pour la ligne de commande (scripts/db-demo.mjs)
   et pour le back office (Système).

   Les lignes sont reconnues à ce que le seed y écrit — les identifiants Strava
   148120 et 148377, les dates d'octobre 2026, les modèles des analyses, le nom
   du plan de trente semaines — jamais à une date « ancienne » : rien de ce que
   l'athlète a saisi lui-même n'y ressemble. */

import { bd, lignes } from './bd.mjs';

const LOTS = [
  {
    code: 'activites',
    quoi: { fr: 'activités Strava inventées (octobre 2026)', pl: 'wymyślone aktywności Strava (październik 2026)' },
    compte: `SELECT COUNT(*) AS n FROM msc_activity WHERE athlete_id = ? AND id_strava IN (148120, 148377)`,
    efface: `DELETE FROM msc_activity WHERE athlete_id = ? AND id_strava IN (148120, 148377)`,
  },
  {
    code: 'journal',
    quoi: { fr: 'journal de la séance de démonstration (14/10/2026)', pl: 'dziennik treningu demo (14.10.2026)' },
    compte: `SELECT COUNT(*) AS n FROM msc_journal WHERE athlete_id = ? AND date = '2026-10-14' AND rpe_ressenti = 8
             AND session_id IN (SELECT id FROM msc_session WHERE date = '2026-10-14')`,
    efface: `DELETE FROM msc_journal WHERE athlete_id = ? AND date = '2026-10-14' AND rpe_ressenti = 8
             AND session_id IN (SELECT id FROM msc_session WHERE date = '2026-10-14')`,
  },
  {
    code: 'mesures',
    quoi: { fr: 'FC de repos importées du classeur (8 → 14/10/2026)', pl: 'tętno spoczynkowe z arkusza (8 → 14.10.2026)' },
    compte: `SELECT COUNT(*) AS n FROM msc_mesure WHERE athlete_id = ? AND source = 'import'
             AND date BETWEEN '2026-10-08' AND '2026-10-14' AND poids_kg IS NULL AND hrv_ms IS NULL`,
    efface: `DELETE FROM msc_mesure WHERE athlete_id = ? AND source = 'import'
             AND date BETWEEN '2026-10-08' AND '2026-10-14' AND poids_kg IS NULL AND hrv_ms IS NULL`,
  },
  {
    code: 'analyses',
    quoi: { fr: 'analyses du coach inventées, et leurs propositions', pl: 'wymyślone analizy trenera i ich propozycje' },
    compte: `SELECT COUNT(*) AS n FROM msc_analyse WHERE athlete_id = ? AND modele IN ('haiku-4-5', 'sonnet-5')
             AND date IN ('2026-10-14', '2026-10-18')`,
    efface: `DELETE FROM msc_analyse WHERE athlete_id = ? AND modele IN ('haiku-4-5', 'sonnet-5')
             AND date IN ('2026-10-14', '2026-10-18')`,
  },
];

async function planDemo(athleteId) {
  const plans = await lignes(
    `SELECT id, nom, actif FROM msc_plan WHERE athlete_id = :a AND origine = 'classeur' AND nom LIKE 'Plan 30 semaines%'`,
    { a: athleteId },
  );
  const sortie = [];
  for (const p of plans) {
    const courses = await lignes(
      `SELECT c.id, c.nom, c.date FROM msc_competition c
       WHERE c.athlete_id = :a
         AND EXISTS (SELECT 1 FROM msc_objectif o WHERE o.competition_id = c.id AND o.plan_id = :p)
         AND NOT EXISTS (SELECT 1 FROM msc_objectif o WHERE o.competition_id = c.id AND o.plan_id <> :p)
         AND NOT EXISTS (SELECT 1 FROM msc_resultat r WHERE r.competition_id = c.id)`,
      { a: athleteId, p: p.id },
    );
    sortie.push({ id: p.id, nom: p.nom, actif: Boolean(p.actif), courses: courses.map((c) => ({ id: c.id, nom: c.nom, date: c.date })) });
  }
  return sortie;
}

/** Ce qu'il y a, sans rien toucher. */
export async function etatDemo(athleteId = 1) {
  const q = bd();
  const lots = [];
  for (const lot of LOTS) {
    const [[{ n }]] = await q.execute(lot.compte, [athleteId]);
    lots.push({ code: lot.code, quoi: lot.quoi, n: Number(n) });
  }
  const plans = await planDemo(athleteId);
  return { athlete_id: athleteId, lots, plans, total: lots.reduce((t, l) => t + l.n, 0) + plans.length };
}

/** Retire le vécu inventé ; avec `plan`, le plan de démonstration aussi, s'il
    n'est pas actif, et les courses que lui seul nomme et qui n'ont pas de
    résultat. */
export async function retirerDemo(athleteId = 1, { plan = false } = {}) {
  const q = bd();
  const retires = [];
  for (const lot of LOTS) {
    const [[{ n }]] = await q.execute(lot.compte, [athleteId]);
    if (Number(n) > 0) await q.execute(lot.efface, [athleteId]);
    retires.push({ code: lot.code, quoi: lot.quoi, n: Number(n) });
  }
  const plans = [];
  if (plan) {
    for (const p of await planDemo(athleteId)) {
      if (p.actif) { plans.push({ ...p, retire: false }); continue; }
      for (const c of p.courses) await q.execute('DELETE FROM msc_competition WHERE id = ?', [c.id]);
      await q.execute('DELETE FROM msc_plan WHERE id = ?', [p.id]);
      plans.push({ ...p, retire: true });
    }
  }
  return { athlete_id: athleteId, retires, plans };
}
