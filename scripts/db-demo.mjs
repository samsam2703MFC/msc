/* Ce que le seed de démonstration a laissé dans une base vivante, et comment
   le retirer. La logique est dans server/demo.mjs — la même que celle du
   back office (Système) ; ici, la ligne de commande.

     npm run db:demo                  dit ce qu'il y a, ne touche à rien
     npm run db:demo -- retirer       retire le vécu inventé
     npm run db:demo -- retirer --plan   … et le plan de démonstration s'il
                                      n'est plus actif, avec ses courses sans
                                      résultat
     --athlete N                      l'athlète du seed (1 par défaut) */

import { fermer } from '../server/bd.mjs';
import { etatDemo, retirerDemo } from '../server/demo.mjs';

const args = process.argv.slice(2);
const retirer = args.includes('retirer');
const avecPlan = args.includes('--plan');
const athlete = Number(args[args.indexOf('--athlete') + 1] || 1) || 1;

try {
  if (retirer) {
    const r = await retirerDemo(athlete, { plan: avecPlan });
    for (const l of r.retires) console.log(`${l.n > 0 ? '−' : ' '} ${l.quoi.fr} : ${l.n}${l.n > 0 ? ' retirée(s)' : ''}`);
    for (const p of r.plans) {
      console.log(p.retire
        ? `− plan de démonstration « ${p.nom} » retiré, avec ${p.courses.length} course(s) : ${p.courses.map((c) => `${c.nom} (${c.date})`).join(', ') || '—'}`
        : `· plan de démonstration « ${p.nom} » : ACTIF — laissé tel quel`);
    }
    if (!avecPlan) console.log('  (npm run db:demo -- retirer --plan pour retirer aussi le plan de démonstration, s’il est inactif)');
  } else {
    const e = await etatDemo(athlete);
    for (const l of e.lots) console.log(`${l.n > 0 ? '·' : ' '} ${l.quoi.fr} : ${l.n}`);
    for (const p of e.plans) {
      console.log(`· plan de démonstration « ${p.nom} » : ${p.actif ? 'ACTIF — laissé tel quel' : 'inactif'}, ${p.courses.length} course(s) à lui seul : ${p.courses.map((c) => `${c.nom} (${c.date})`).join(', ') || '—'}`);
    }
    console.log(e.total > 0 ? '\nRien n’a été touché : ajoute « retirer ».' : '\nRien de la démonstration ici.');
  }
} catch (e) {
  console.error(e?.message ?? e);
  process.exitCode = 1;
} finally {
  await fermer();
}
