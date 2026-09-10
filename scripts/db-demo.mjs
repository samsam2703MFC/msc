/* Ce que le seed de démonstration a laissé dans une base vivante, et comment
   le retirer. La logique est dans server/demo.mjs — la même que celle du
   back office (Système) ; ici, la ligne de commande.

     npm run db:demo                  dit ce qu'il y a, ne touche à rien
     npm run db:demo -- retirer       retire le vécu inventé
     npm run db:demo -- retirer --plan   … et le plan de démonstration s'il
                                      n'est plus actif, avec ses courses sans
                                      résultat
     --athlete N                      un seul athlète ; sans lui, tous ceux
                                      de la base — le seed crée le sien en
                                      auto-incrément, rien ne dit qu'il est
                                      le numéro 1 */

import { fermer } from '../server/bd.mjs';
import { etatDemo, etatDemoTous, retirerDemo } from '../server/demo.mjs';

const args = process.argv.slice(2);
const retirer = args.includes('retirer');
const avecPlan = args.includes('--plan');
const unSeul = args.includes('--athlete') ? Number(args[args.indexOf('--athlete') + 1]) : null;

function montrer(e) {
  console.log(`athlète #${e.athlete_id}${e.nom ? ` « ${e.nom} »` : ''}`);
  for (const l of e.lots) console.log(`${l.n > 0 ? '·' : ' '} ${l.quoi.fr} : ${l.n}`);
  for (const p of e.plans) {
    console.log(`· plan de démonstration « ${p.nom} » : ${p.actif ? 'ACTIF — laissé tel quel' : 'inactif'}, ${p.courses.length} course(s) à lui seul : ${p.courses.map((c) => `${c.nom} (${c.date})`).join(', ') || '—'}`);
  }
}

function montrerRetrait(r) {
  console.log(`athlète #${r.athlete_id}`);
  for (const l of r.retires) console.log(`${l.n > 0 ? '−' : ' '} ${l.quoi.fr} : ${l.n}${l.n > 0 ? ' retirée(s)' : ''}`);
  for (const p of r.plans) {
    console.log(p.retire
      ? `− plan de démonstration « ${p.nom} » retiré, avec ${p.courses.length} course(s) : ${p.courses.map((c) => `${c.nom} (${c.date})`).join(', ') || '—'}`
      : `· plan de démonstration « ${p.nom} » : ACTIF — laissé tel quel`);
  }
}

try {
  if (unSeul != null && !(Number.isInteger(unSeul) && unSeul > 0)) throw new Error('--athlete attend un numéro.');
  const etats = unSeul != null ? [await etatDemo(unSeul)] : (await etatDemoTous()).athletes;
  if (retirer) {
    if (etats.length === 0) console.log('Rien de la démonstration ici.');
    for (const e of etats) montrerRetrait(await retirerDemo(e.athlete_id, { plan: avecPlan }));
    if (etats.length > 0 && !avecPlan) console.log('  (npm run db:demo -- retirer --plan pour retirer aussi le plan de démonstration, s’il est inactif)');
  } else {
    for (const e of etats) montrer(e);
    console.log(etats.some((e) => e.total > 0) ? '\nRien n’a été touché : ajoute « retirer ».' : 'Rien de la démonstration ici.');
  }
} catch (e) {
  console.error(e?.message ?? e);
  process.exitCode = 1;
} finally {
  await fermer();
}
