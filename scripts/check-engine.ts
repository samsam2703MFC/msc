/* Verifies the engine against the workbook's "Allures" table, cell for cell. */
import { grilleAllures, format10k, reference, charge, evaluer } from '../src/data/engine';

const ATTENDU: Record<string, string[]> = {
  // Récup, EF, End. active, Marathon, Semi, Seuil, 10 km, VMA
  A: ['6:47', '6:27', '6:07', '5:42', '5:26', '5:22', '5:12', '5:02'],
  B: ['6:20', '6:00', '5:40', '5:15', '4:59', '4:55', '4:45', '4:35'],
  C: ['5:44', '5:24', '5:04', '4:39', '4:23', '4:19', '4:09', '3:59'],
  D: ['5:11', '4:51', '4:31', '4:06', '3:50', '3:46', '3:36', '3:26'],
};
const REF_10K: Record<string, string> = { A: '52:00', B: '47:31', C: '41:36', D: '36:00' };

let fails = 0;
for (const [bloc, attendu] of Object.entries(ATTENDU)) {
  const obtenu = grilleAllures(bloc).map((r) => r.allure.replace('/km', ''));
  const ref = format10k(reference(bloc));
  const okRef = ref === REF_10K[bloc];
  if (!okRef) { fails++; console.log(`bloc ${bloc} ref: attendu ${REF_10K[bloc]}, obtenu ${ref}`); }
  attendu.forEach((a, i) => {
    if (obtenu[i] !== a) { fails++; console.log(`bloc ${bloc} zone ${i}: attendu ${a}, obtenu ${obtenu[i]}`); }
  });
  console.log(`bloc ${bloc}  10km=${ref}${okRef ? ' ok' : ' MISMATCH'}  ${obtenu.join('  ')}`);
}

console.log('\ncharge 58min RPE 7 =', charge(58, 7), '(attendu 406)');
if (charge(58, 7) !== 406) fails++;

const feux = evaluer({ rpe_qualite: 9, derive_longue: 12, fc_repos_delta: 6 });
console.log('règles déclenchées:', feux.map((r) => `${r.code}/${r.gravite}`).join(', '));

console.log(fails === 0 ? '\nOK — le moteur reproduit la feuille Allures' : `\n${fails} ÉCARTS`);
process.exit(fails === 0 ? 0 : 1);
