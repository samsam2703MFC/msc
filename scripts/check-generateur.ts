/* Generates a plan for Sam's own inputs and checks it against the rules and
   against the reference workbook's shape. */
import { depuis10k, equivalent10k, genererPlan, verifierEcartQualite } from '../src/data/generateur';
import type { Contraintes, Objectif, ProfilAthlete } from '../src/data/generateur';
import type { MscStructure } from '../src/data/types';
import { msc_week as REF } from '../src/data/plan.generated';
import { msc_objectif as OBJECTIFS } from '../src/data/reference';

const athlete: ProfilAthlete = {
  nom: 'Sam',
  ref_actuelle_s: 312,
  ref_cible_s: 216,
  debut: '2026-08-31',
};

/* The objectives as the database holds them, so the check exercises the same
   inputs the app does. */
const objectifs: Objectif[] = OBJECTIFS.map((o) => ({
  date: o.date,
  nom: o.nom.fr,
  cible_s: o.cible_s,
  cible_haute_s: o.cible_haute_s,
  distance_km: o.distance_km,
  principal: o.principal,
}));

const contraintes: Contraintes = {
  plancher_heures: 8,
  plancher_km_sortie: 10,
  reamorcage_semaines: 6,
  affutage_semaines: 3,
  natation: true,
  velo: true,
  salle: true,
  montagne_toutes_les: 3,
};

/* La semaine type de Sam, celle que la migration pose : c'est elle que le
   plan doit reproduire — ses jours, ses sports, et ses durées une fois le
   réamorçage terminé. Sans elle, le contrôle validerait un générateur qui
   ignore la matrice. */
const STRUCTURE: MscStructure[] = [
  { jour: 0, creneau: 1, discipline: 'Hyrox', type_code: 'force', duree_min: 70 },
  { jour: 1, creneau: 1, discipline: 'Natation', type_code: 'nage', duree_min: 55 },
  { jour: 1, creneau: 2, discipline: 'Vélo', type_code: 'velo', duree_min: 50 },
  { jour: 2, creneau: 1, discipline: 'Course à pied', type_code: 'seuil', duree_min: 60 },
  { jour: 3, creneau: 1, discipline: 'Hyrox', type_code: 'compromis', duree_min: 55 },
  { jour: 4, creneau: 1, discipline: 'Natation', type_code: 'nage', duree_min: 40 },
  { jour: 4, creneau: 2, discipline: 'Course à pied', type_code: 'recup', duree_min: 45 },
  { jour: 5, creneau: 1, discipline: 'Course à pied', type_code: 'longue', duree_min: 75 },
];
const HEURES_POSEES = STRUCTURE.reduce((t, c) => t + (c.duree_min ?? 45), 0) / 60;

const plan = genererPlan(athlete, objectifs, contraintes);
let fails = 0;
const check = (nom: string, ok: boolean, detail = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${nom}${detail ? '  — ' + detail : ''}`);
};

console.log('=== blocs ===');
for (const b of plan.blocs) {
  const ref = 312 - (312 - 216) * b.part;
  console.log(
    `  ${b.code}  S${b.de}–S${b.a}  part ${b.part.toFixed(3)}  réf ${Math.floor(ref * 10 / 60)}:${String(Math.floor(ref * 10) % 60).padStart(2, '0')}  ${b.nom.fr}`,
  );
}

console.log('\n=== volume hebdo (généré vs référence) ===');
for (const w of plan.semaines) {
  const r = REF.find((x) => x.semaine === w.semaine);
  console.log(
    String(w.semaine).padStart(2), w.bloc,
    (w.heures.toFixed(1) + 'h').padStart(6),
    '  réf ' + ((r?.heures ?? 0).toFixed(1) + 'h').padStart(6),
    '  ' + '█'.repeat(Math.round(w.heures)),
  );
}

console.log('\n=== contrôles ===');
const semainesDeCourse = new Set(
  objectifs.map((o) => plan.sessions.find((s) => s.date === o.date)?.semaine),
);
const affutage = plan.blocs.find((b) => b.nature === 'affutage');
/* L'affûtage passe sous le plancher exprès : c'est ce qu'on lui demande. */
const horsCourse = plan.semaines.filter((w) => !semainesDeCourse.has(w.semaine) && w.semaine > 6
  && !(affutage && w.semaine >= affutage.de));
check('plancher de 8h tenu hors semaines de course et hors affûtage',
  horsCourse.every((w) => w.heures >= 7.9),
  horsCourse.filter((w) => w.heures < 7.9).map((w) => `S${w.semaine}=${w.heures}h`).join(' '));

const natures = plan.blocs.map((b) => b.nature);
check('les quatre périodes y sont, dans l’ordre',
  natures[0] === 'reamorcage' && natures[natures.length - 1] === 'affutage'
  && natures[natures.length - 2] === 'pic'
  && natures.slice(1, -2).every((n) => n === 'construction'),
  natures.join(' → '));

const pic = plan.blocs.find((b) => b.nature === 'pic');
check('l’affûtage garde l’allure du pic, il ne ralentit pas',
  !!pic && !!affutage && pic.part === affutage.part,
  `pic ${pic?.part} · affûtage ${affutage?.part}`);

/* Hors la semaine de course, qui a sa propre règle : chaque semaine d'affûtage
   pèse moins que celle d'avant. Un affûtage qui remonte n'en est pas un. */
const semainesAffutage = affutage
  ? plan.semaines.filter((w) => w.semaine >= affutage.de && !semainesDeCourse.has(w.semaine))
  : [];
check('l’affûtage descend, semaine après semaine',
  semainesAffutage.length > 0 && semainesAffutage.every((w, i) => {
    const avant = plan.semaines.find((x) => x.semaine === w.semaine - 1);
    return i === 0 ? !!avant && w.heures < avant.heures : w.heures < semainesAffutage[i - 1].heures;
  }),
  semainesAffutage.map((w) => `S${w.semaine}=${w.heures}h`).join(' '));

const courses = plan.sessions.filter((s) => s.type === 'course');
check('les 4 courses sont dans le plan', courses.length === 4,
  courses.map((c) => `${c.date}`).join(' '));

check('la dernière semaine finit sur l’objectif',
  plan.sessions.some((s) => s.date === '2027-03-21' && s.type === 'course'));

const ecarts = verifierEcartQualite(plan.sessions);
check('aucune séance dure à moins de 48 h', ecarts.length === 0, ecarts.slice(0, 3).join(' | '));

const courses10 = plan.sessions.filter(
  (s) => s.discipline === 'Course à pied' && s.distance_km !== undefined,
);
check('plancher de 10 km par sortie tenu',
  courses10.every((s) => (s.distance_km ?? 0) >= 9.9),
  courses10.filter((s) => (s.distance_km ?? 0) < 9.9).slice(0, 3).map((s) => `${s.date}:${s.distance_km}km`).join(' '));

const qualite = plan.sessions.filter((s) => ['seuil', 'allure10', 'vma'].includes(s.type));
check('aucune qualité avant la fin du réamorçage',
  qualite.every((s) => s.semaine > 6),
  `première: S${qualite[0]?.semaine}`);

/* Les codes de bloc sont uniques — la base l'exige (uq_bloc_plan_code), et un
   bloc fondu laisse un trou dans la suite des lettres. Le plan de Sam en fond
   un : c'est exactement le cas qui rendait deux « E ». */
const codesUniques = new Set(plan.blocs.map((b) => b.code));
check('chaque période a son propre code',
  codesUniques.size === plan.blocs.length,
  plan.blocs.map((b) => b.code).join(' '));

/* Un objectif qui tombe trois semaines après la course d'avant : le bloc final
   ne peut pas céder trois semaines d'affûtage. Il en cède une — un affûtage
   court vaut mieux que pas d'affûtage, et le plan le dit. */
const serre = genererPlan(
  athlete,
  [
    { date: '2027-02-28', nom: 'Course d’avant', cible_s: 2400, distance_km: 10, principal: false },
    { date: '2027-03-21', nom: 'Objectif', cible_s: 2160, distance_km: 10, principal: true },
  ],
  contraintes,
);
const court = serre.blocs.find((b) => b.nature === 'affutage');
check('un bloc final court raccourcit l’affûtage au lieu de l’annuler',
  !!court && court.a - court.de + 1 === 1
  && serre.avertissements.some((a) => /affûtage ramené à 1/.test(a)),
  serre.blocs.map((b) => `${b.nature} S${b.de}–S${b.a}`).join(' · '));

/* Les deux sens de la conversion se referment l'un sur l'autre : c'est ce qui
   permet de proposer un chrono au lieu de laisser chacun le calculer — et deux
   courses finir à la même allure au kilomètre, ce qui est impossible. */
const allerRetour = [10, 21.0975, 42.195].every((d) => {
  const t = depuis10k(226, d);
  return Math.abs(equivalent10k(t, d) - 226) < 0.01;
});
check('un chrono proposé pour une distance revient à la même allure 10 km',
  allerRetour,
  [10, 21.0975, 42.195].map((d) => `${d}km ${Math.round(depuis10k(226, d))}s`).join(' · '));

/* Et un semi se court plus vite qu'un marathon, pour le même niveau. */
check('à niveau égal, le semi se court plus vite que le marathon',
  depuis10k(226, 21.0975) / 21.0975 < depuis10k(226, 42.195) / 42.195,
  `${(depuis10k(226, 21.0975) / 21.0975).toFixed(1)} s/km · ${(depuis10k(226, 42.195) / 42.195).toFixed(1)} s/km`);

/* --------------------------------------------- le plan suit la semaine type */
const surMesure = genererPlan(
  athlete,
  objectifs,
  { ...contraintes, plancher_heures: HEURES_POSEES },
  STRUCTURE,
);
/* La dernière semaine du réamorçage vaut exactement la semaine posée : c'est
   le point où « ma semaine normale » et « ce que le plan me demande » se
   rejoignent, avant que la construction ne monte au-dessus. */
const REPERE = contraintes.reamorcage_semaines;
const semaineRepere = surMesure.sessions.filter((x) => x.semaine === REPERE);
const posesDuJour = (jour: number) => STRUCTURE.filter((c) => c.jour === jour);

check('les jours et les sports du plan sont ceux de la semaine type',
  [0, 1, 2, 3, 4, 5, 6].every((jour) => {
    const attendu = posesDuJour(jour).map((c) => c.discipline).sort();
    const obtenu = semaineRepere
      .filter((x) => (new Date(`${x.date}T00:00:00Z`).getUTCDay() + 6) % 7 === jour)
      .filter((x) => x.discipline !== 'Repos')
      .map((x) => x.discipline).sort();
    return attendu.join('|') === obtenu.join('|');
  }),
  semaineRepere.filter((x) => x.discipline !== 'Repos').map((x) => `${x.jour.fr} ${x.discipline}`).join(' · '));

/* Les durées : hors course à pied, qui a son plancher de kilomètres et peut
   donc être allongée, la séance dure ce qui a été posé. */
const horsCap = semaineRepere.filter((x) => x.discipline !== 'Course à pied' && x.discipline !== 'Repos');
check('et ses durées, une fois le réamorçage fini',
  horsCap.length > 0 && horsCap.every((x) => {
    const jour = (new Date(`${x.date}T00:00:00Z`).getUTCDay() + 6) % 7;
    const pose = posesDuJour(jour).find((c) => c.discipline === x.discipline);
    return !!pose && Math.abs(x.duree_min - (pose.duree_min ?? 45)) <= 2;
  }),
  horsCap.map((x) => `${x.discipline} ${x.duree_min}′`).join(' · '));

console.log('\n=== références de bloc : généré vs classeur ===');
const CLASSEUR: Record<string, string> = { A: '52:00', B: '47:31', C: '41:36', D: '36:00' };
plan.blocs.forEach((b, i) => {
  const ref = 312 - (312 - 216) * b.part;
  const t = Math.floor(ref * 10);
  const gen = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  const attendu = CLASSEUR[Object.keys(CLASSEUR)[i]] ?? '—';
  console.log(`  bloc ${i + 1}  généré ${gen}   classeur ${attendu}`);
});

console.log(`\n${plan.sessions.length} séances · ${plan.semaines.length} semaines · ${plan.blocs.length} blocs`);
if (plan.avertissements.length) {
  console.log('\navertissements:');
  for (const a of plan.avertissements) console.log('  -', a);
}
console.log(fails === 0 ? '\nOK' : `\n${fails} ÉCHECS`);
process.exit(fails === 0 ? 0 : 1);
