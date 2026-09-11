/* Vérifie que la base dit la même chose que le classeur, et que ses garde-fous
   mordent vraiment.

   Deux moitiés, pour deux risques différents.

   L'aller-retour : les 243 séances, les quatre blocs, les huit zones et leurs
   écarts ressortent identiques à ce qu'ils sont entrés. Une base qui perd un
   `part` ou arrondit un écart casse le moteur d'allures en silence, et
   `check:engine` ne le verrait pas — il lit les données TypeScript, pas MySQL.

   Les contraintes : une base dont les CHECK et les UNIQUE ne sont pas
   exercés est une base dont on croit qu'ils existent. Chaque garde-fou est
   ici avec l'écriture qu'il doit refuser.

   Il faut une base migrée et semée : npm run db:migrate && npm run db:seed */

import { msc_athlete, msc_bloc, msc_zone } from '../src/data/reference';
import { msc_session, msc_week } from '../src/data/plan.generated';
import { genererPlan } from '../src/data/generateur';
import * as depots from '../server/depots.mjs';
import { bd, desceller, fermer, ligne, lignes, sceller, transaction } from '../server/bd.mjs';

let fails = 0;
const check = (nom: string, ok: boolean, detail = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${nom}${detail ? '  — ' + detail : ''}`);
};

/** Une écriture qui doit être refusée par la base, pas par l'application. */
async function refuse(nom: string, ecriture: () => Promise<unknown>) {
  try {
    await ecriture();
    check(nom, false, 'acceptée alors qu’elle aurait dû être refusée');
  } catch {
    check(nom, true);
  }
}

const un = <T>(rows: unknown): T => (rows as T[])[0];

console.log('=== l’aller-retour ===');

const compte = un<{ n: number }>(await lignes('SELECT COUNT(*) AS n FROM msc_session'));
check('les 243 séances sont là', compte.n === msc_session.length, `${compte.n}`);

const semaines = un<{ n: number }>(await lignes('SELECT COUNT(*) AS n FROM msc_week'));
check('les 30 semaines aussi', semaines.n === msc_week.length, `${semaines.n}`);

/* Le `part` du bloc est la moitié du moteur d'allures. Un DECIMAL(4,3) qui
   arrondirait 0,28 casserait les huit zones du bloc B d'un coup. */
const blocs = (await lignes(
  'SELECT code, part, nature, semaine_de, semaine_a FROM msc_bloc ORDER BY code',
)) as { code: string; part: string; nature: string; semaine_de: number; semaine_a: number }[];
check(
  'les quatre parts de bloc ressortent au millième',
  blocs.every((b, i) => Number(b.part) === msc_bloc[i].part),
  blocs.map((b) => `${b.code} ${b.part}`).join(' '),
);
check(
  'les bornes de semaine des blocs aussi',
  blocs.every((b, i) => b.semaine_de === msc_bloc[i].de && b.semaine_a === msc_bloc[i].a),
);
/* Et leur période : un plan qui a perdu ses natures montre quatre fois
   « Construction » dans le tableau des périodes, ce qui ne se voit pas
   autrement qu'ici. */
check(
  'et la période de chacun',
  blocs.every((b, i) => b.nature === msc_bloc[i].nature),
  blocs.map((b) => `${b.code} ${b.nature}`).join(' '),
);

const zones = (await lignes(
  'SELECT code, ecart_s, ordre FROM msc_zone ORDER BY ordre',
)) as { code: string; ecart_s: number; ordre: number }[];
check(
  'les huit écarts de zone ressortent au signe près',
  zones.every((z, i) => z.code === msc_zone[i].code && z.ecart_s === msc_zone[i].ecart_s),
  zones.map((z) => `${z.code} ${z.ecart_s >= 0 ? '+' : ''}${z.ecart_s}`).join(' '),
);
check(
  'et de la plus lente à la plus rapide',
  zones.every((z, i) => i === 0 || z.ecart_s <= zones[i - 1].ecart_s),
);

/* Le moteur, refait en SQL : référence(bloc) = actuelle − (actuelle − cible) × part.
   Si la base et le classeur divergent, c'est ici que ça se voit. */
const ref = un<{ b: string; ref: string }>(
  await lignes(
    `SELECT b.code AS b,
            a.ref_actuelle_s - (a.ref_actuelle_s - a.ref_cible_s) * b.part AS ref
     FROM msc_bloc b JOIN msc_plan p ON p.id = b.plan_id
     JOIN msc_athlete a ON a.id = p.athlete_id WHERE b.code = 'B'`,
  ),
);
const attendue =
  msc_athlete[0].ref_actuelle_s -
  (msc_athlete[0].ref_actuelle_s - msc_athlete[0].ref_cible_s) * msc_bloc[1].part;
check('la référence du bloc B se recalcule depuis la base', Number(ref.ref) === attendue,
  `${ref.ref} — attendu ${attendue}`);

/* Les zones d'une séance sont une table, donc la question « quelles séances
   sont au seuil » se pose en SQL. C'est la raison d'être de cette table. */
const auSeuil = un<{ n: number }>(
  await lignes("SELECT COUNT(DISTINCT session_id) AS n FROM msc_session_zone WHERE zone_code = 'seuil'"),
);
const attenduSeuil = msc_session.filter((s) => s.zones.includes('seuil')).length;
check('les séances au seuil se comptent en SQL', auSeuil.n === attenduSeuil,
  `${auSeuil.n} / ${attenduSeuil}`);

/* La dérive d'une séance de qualité, en SQL depuis les blocs. */
const derive = un<{ derive: number }>(
  await lignes(
    `SELECT MAX(b.allure_s_km) - MIN(b.allure_s_km) AS derive
     FROM msc_activity a JOIN msc_activity_bloc b ON b.activity_id = a.id
     WHERE a.session_id = 1052`,
  ),
);
check('la dérive du seuil se calcule en SQL', Number(derive.derive) === 12, `${derive.derive} s/km`);

const accents = un<{ titre_fr: string; label_pl: string }>(
  await lignes(
    `SELECT s.titre_fr, (SELECT label_pl FROM msc_zone WHERE code = 'ef') AS label_pl
     FROM msc_session s WHERE s.id = 1052`,
  ),
);
check('les accents et le polonais survivent à l’aller-retour',
  accents.titre_fr.includes('·') && accents.label_pl.includes('ł'),
  `${accents.titre_fr} · ${accents.label_pl}`);

console.log('\n=== ce que la base doit refuser ===');

await refuse('une cible plus lente que la référence actuelle', () =>
  bd().execute(
    `INSERT INTO msc_athlete (nom, ref_actuelle_s, ref_cible_s, debut) VALUES ('X', 216, 312, '2026-01-01')`,
  ),
);

await refuse('un plan qui finit avant de commencer', () =>
  bd().execute(
    `INSERT INTO msc_plan (athlete_id, nom, debut, fin) VALUES (1, 'X', '2027-01-01', '2026-01-01')`,
  ),
);

await refuse('un poids de 900 kg', () =>
  bd().execute(
    `INSERT INTO msc_mesure (athlete_id, date, poids_kg) VALUES (1, '2030-01-01', 900)`,
  ),
);

await refuse('une FC de repos de 8 bpm', () =>
  bd().execute(`INSERT INTO msc_mesure (athlete_id, date, fc_repos) VALUES (1, '2030-01-02', 8)`),
);

await refuse('un RPE de 12', () =>
  bd().execute(
    `INSERT INTO msc_journal (athlete_id, date, rpe_ressenti) VALUES (1, '2030-01-03', 12)`,
  ),
);

await refuse('la même séance faite deux fois', () =>
  bd().execute(
    `INSERT INTO msc_activity (athlete_id, session_id, date, sport, duree_min)
     VALUES (1, 1052, '2026-10-14', 'run', 60)`,
  ),
);

await refuse('une adaptation qui double la séance suivante', () =>
  bd().execute(
    `INSERT INTO msc_adaptation (analyse_id, session_id, part_duree, pourquoi_fr, pourquoi_pl)
     VALUES ((SELECT id FROM msc_analyse LIMIT 1), 1055, 2.0, 'x', 'x')`,
  ),
);

await refuse('un ajustement qui ne vise ni séance ni semaine', () =>
  bd().execute(
    `INSERT INTO msc_ajustement (analyse_id, type_code) VALUES ((SELECT id FROM msc_analyse LIMIT 1), 'ef')`,
  ),
);

await refuse('une analyse de séance sans séance', () =>
  bd().execute(
    `INSERT INTO msc_analyse (athlete_id, type, date, modele, verdict_fr, verdict_pl)
     VALUES (1, 'seance', '2026-10-14', 'x', 'x', 'x')`,
  ),
);

await refuse('une compétition de 0 km', () =>
  bd().execute(
    `INSERT INTO msc_competition (athlete_id, date, nom, distance_km) VALUES (1, '2027-01-01', 'X', 0)`,
  ),
);

await refuse('un type de séance qui n’existe pas', () =>
  bd().execute(
    `INSERT INTO msc_ajustement (analyse_id, semaine, type_code)
     VALUES ((SELECT id FROM msc_analyse LIMIT 1), 9, 'zumba')`,
  ),
);

/* La file d'attente hors-ligne rejoue après une coupure. Sans ce garde-fou,
   elle enregistre deux fois le même RPE et personne ne s'en aperçoit. */
const idMutation = '11111111-2222-3333-4444-555555555555';
await bd().execute('DELETE FROM msc_mutation WHERE id = ?', [idMutation]);
await bd().execute('INSERT INTO msc_mutation (id, athlete_id, operation) VALUES (?, 1, ?)', [
  idMutation, 'journal.ecrire',
]);
await refuse('la même mutation rejouée deux fois', () =>
  bd().execute('INSERT INTO msc_mutation (id, athlete_id, operation) VALUES (?, 1, ?)', [
    idMutation, 'journal.ecrire',
  ]),
);
await bd().execute('DELETE FROM msc_mutation WHERE id = ?', [idMutation]);

console.log('\n=== les jetons Strava ===');

if (!process.env.MSC_SECRET_KEY) {
  console.log('note  MSC_SECRET_KEY absent : le scellement n’est pas exercé');
} else {
  await bd().execute('DELETE FROM msc_strava_compte WHERE strava_athlete_id = 999999');
  await bd().execute(
    `INSERT INTO msc_strava_compte (athlete_id, strava_athlete_id, access_token, refresh_token, expires_at, portee)
     VALUES (1, 999999, ?, ?, '2030-01-01 00:00:00', 'read')`,
    [sceller('jeton-en-clair-interdit'), sceller('rafraichissement')],
  );
  const stocke = (await ligne(
    'SELECT access_token FROM msc_strava_compte WHERE strava_athlete_id = 999999',
  )) as { access_token: Buffer };
  check('le jeton n’est pas lisible en base',
    !stocke.access_token.toString('utf8').includes('jeton-en-clair'));
  check('mais il se descelle', desceller(stocke.access_token) === 'jeton-en-clair-interdit');
  await bd().execute('DELETE FROM msc_strava_compte WHERE strava_athlete_id = 999999');
}

console.log('\n=== remplacer un plan ===');

/* La question que le README laissait ouverte : que devient le journal attaché
   au plan qu'on remplace. Réponse du schéma : rien ne se perd. Les séances
   partent avec leur plan, l'activité reste et se détache. */
await transaction(async (cnx) => {
  const [p] = (await cnx.query(
    `INSERT INTO msc_plan (athlete_id, nom, debut, fin) VALUES (1, 'jetable', '2030-01-01', '2030-06-01')`,
  )) as any;
  const [b] = (await cnx.query(
    `INSERT INTO msc_bloc (plan_id, code, part, semaine_de, semaine_a, nom_fr, nom_pl)
     VALUES (?, 'A', 0, 1, 4, 'x', 'x')`, [p.insertId],
  )) as any;
  const [s] = (await cnx.query(
    `INSERT INTO msc_session (plan_id, semaine, bloc_id, date, jour_long, jour_fr, jour_pl, phase,
       discipline, type_code, duree_min, rpe_cible, charge, titre_fr, titre_pl, titre_court_fr,
       titre_court_pl, meta_fr, meta_pl, detail_fr, detail_pl)
     VALUES (?, 1, ?, '2030-01-02', 'Jeudi', 'JEU', 'CZW', 'x', 'Course à pied', 'ef', 60, 4, 240,
       'x','x','x','x','x','x','x','x')`, [p.insertId, b.insertId],
  )) as any;
  const [a] = (await cnx.query(
    `INSERT INTO msc_activity (athlete_id, session_id, date, sport, duree_min)
     VALUES (1, ?, '2030-01-02', 'run', 58)`, [s.insertId],
  )) as any;
  const [j] = (await cnx.query(
    `INSERT INTO msc_journal (athlete_id, session_id, date, rpe_ressenti)
     VALUES (1, ?, '2030-01-02', 5)`, [s.insertId],
  )) as any;

  await cnx.query('DELETE FROM msc_plan WHERE id = ?', [p.insertId]);

  const [seances] = (await cnx.query('SELECT COUNT(*) AS n FROM msc_session WHERE plan_id = ?', [p.insertId])) as any;
  const [activite] = (await cnx.query('SELECT session_id FROM msc_activity WHERE id = ?', [a.insertId])) as any;
  const [journal] = (await cnx.query('SELECT session_id FROM msc_journal WHERE id = ?', [j.insertId])) as any;

  check('les séances partent avec leur plan', seances[0].n === 0);
  check('l’activité survit et se détache',
    activite.length === 1 && activite[0].session_id === null);
  check('le journal survit et se détache',
    journal.length === 1 && journal[0].session_id === null);

  /* Tout ça était un essai. */
  throw new Error('rollback');
}).catch((e) => {
  if (e.message !== 'rollback') throw e;
});

const restant = un<{ n: number }>(await lignes("SELECT COUNT(*) AS n FROM msc_plan WHERE nom = 'jetable'"));
check('l’essai n’a rien laissé', restant.n === 0);


/* Le classeur reprend un identifiant de plan neuf à chaque `db:seed` — la table
   est vidée, l'auto-incrément non. L'écrire en dur ferait passer ce contrôle sur
   une base fraîche et échouer sur toutes les autres, ce qui est la pire des deux
   façons de se tromper. */
const ATHLETE = 1;
const planActif = un<{ id: number }>(await lignes(
  'SELECT id FROM msc_plan WHERE athlete_id = :a AND actif = 1 ORDER BY debut DESC LIMIT 1',
  { a: ATHLETE })).id;

console.log('\n=== enregistrer un plan généré ===');

/* Le générateur produit un plan entier sans rien appeler ; ce qui se vérifie
   ici est qu'il ressort de la base tel qu'il y est entré, que ce qui se dérive
   est dérivé par le serveur, et que le plan d'avant reste intact. */
const genere = genererPlan(
  { nom: 'Essai', ref_actuelle_s: 336, ref_cible_s: 300, debut: '2030-01-07' },
  [{ date: '2030-04-14', nom: 'Essai — semi', cible_s: 5400, distance_km: 21.1, principal: true }],
  { plancher_heures: 8, plancher_km_sortie: 10, reamorcage_semaines: 6, affutage_semaines: 3,
    natation: true, velo: true, salle: true, montagne_toutes_les: 3 },
);

await transaction(async (cnx) => {
  const range = (await depots.enregistrerPlan(
    ATHLETE,
    { nom: 'jetable-genere', ...genere, objectifs: [
      { date: '2030-04-14', nom: 'Essai — semi', cible_s: 5400, distance_km: 21.1, principal: true },
    ] },
    cnx,
  )) as { plan_id: number; seances: number; objectifs: number; debut: string; fin: string };

  const [seances] = (await cnx.query(
    'SELECT COUNT(*) AS n FROM msc_session WHERE plan_id = ?', [range.plan_id])) as any;
  check('les séances générées sont toutes écrites',
    seances[0].n === genere.sessions.length, `${seances[0].n} / ${genere.sessions.length}`);

  const [blocs] = (await cnx.query(
    'SELECT COUNT(*) AS n FROM msc_bloc WHERE plan_id = ?', [range.plan_id])) as any;
  check('les blocs aussi', blocs[0].n === genere.blocs.length);

  /* `ordre` départage deux séances du même jour : sans lui, la nage du matin et
     le vélo du soir se battraient pour la même clé unique. */
  const [jours] = (await cnx.query(
    `SELECT date, COUNT(*) AS n FROM msc_session WHERE plan_id = ?
     GROUP BY date HAVING n > 1 LIMIT 1`, [range.plan_id])) as any;
  check('deux séances le même jour tiennent côte à côte', jours.length > 0, `${jours[0]?.n ?? 0}`);

  /* La charge et les totaux hebdomadaires se dérivent : le serveur ne range pas
     ce que le navigateur lui aurait dit d'eux. */
  const [charge] = (await cnx.query(
    `SELECT COUNT(*) AS n FROM msc_session WHERE plan_id = ? AND charge <> duree_min * rpe_cible`,
    [range.plan_id])) as any;
  check('la charge est durée × RPE, partout', charge[0].n === 0, `${charge[0].n} écarts`);

  const [totaux] = (await cnx.query(
    `SELECT w.semaine, w.heures, ROUND(SUM(s.duree_min) / 60, 1) AS vrai
     FROM msc_week w JOIN msc_session s ON s.plan_id = w.plan_id AND s.semaine = w.semaine
     WHERE w.plan_id = ? GROUP BY w.semaine, w.heures HAVING w.heures <> vrai`,
    [range.plan_id])) as any;
  check('les heures de chaque semaine sont la somme de ses séances', totaux.length === 0,
    `${totaux.length} semaines fausses`);

  const [zonees] = (await cnx.query(
    `SELECT COUNT(*) AS n FROM msc_session_zone z JOIN msc_session s ON s.id = z.session_id
     WHERE s.plan_id = ?`, [range.plan_id])) as any;
  check('les zones suivent leurs séances',
    zonees[0].n === genere.sessions.reduce((t, x) => t + x.zones.length, 0), `${zonees[0].n}`);

  const [dates] = (await cnx.query(
    'SELECT debut, fin FROM msc_plan WHERE id = ?', [range.plan_id])) as any;
  check('les bornes du plan sont celles de ses séances',
    String(dates[0].debut) === genere.sessions[0].date, `${dates[0].debut}`);

  const [actifs] = (await cnx.query(
    'SELECT COUNT(*) AS n FROM msc_plan WHERE athlete_id = ? AND actif = 1', [ATHLETE])) as any;
  check('un seul plan actif à la fois', actifs[0].n === 1, `${actifs[0].n}`);

  /* Le plan d'avant n'est pas supprimé : c'est toute la réponse à la question
     du journal. Ses séances sont là, et ce qui les vise aussi. */
  const [ancien] = (await cnx.query(
    'SELECT COUNT(*) AS n FROM msc_session WHERE plan_id = ?', [planActif])) as any;
  check('le plan remplacé garde ses séances', ancien[0].n === msc_session.length, `${ancien[0].n}`);

  check('l’objectif retrouve sa semaine dans le plan écrit', range.objectifs === 1);
  const [obj] = (await cnx.query(
    'SELECT semaine FROM msc_objectif WHERE plan_id = ?', [range.plan_id])) as any;
  check('et cette semaine est celle de la course', obj[0]?.semaine > 0, `S${obj[0]?.semaine}`);

  throw new Error('rollback');
}).catch((e) => {
  if (e.message !== 'rollback') throw e;
});

const restantGenere = un<{ n: number }>(
  await lignes("SELECT COUNT(*) AS n FROM msc_plan WHERE nom = 'jetable-genere'"));
check('l’essai n’a rien laissé non plus', restantGenere.n === 0);


console.log('\n=== accepter une proposition ===');

/* Une proposition acceptée déplace vraiment la séance : c'est ce qui distingue
   « accepté » d'une case cochée. Et le retrait la rend exactement. */
await transaction(async (cnx) => {
  const seance = un<{ id: number; duree_min: number; charge: number; semaine: number }>(
    (await cnx.query(
      `SELECT s.id, s.duree_min, s.charge, s.semaine FROM msc_session s
       WHERE s.plan_id = ? AND s.type_code = 'seuil' AND s.duree_min > 0
         AND NOT EXISTS (SELECT 1 FROM msc_analyse a WHERE a.session_id = s.id)
       LIMIT 1`, [planActif]))[0]);
  const heuresAvant = un<{ heures: string }>((await cnx.query(
    'SELECT heures FROM msc_week WHERE plan_id = ? AND semaine = ?', [planActif, seance.semaine]))[0]).heures;

  const [an] = (await cnx.query(
    `INSERT INTO msc_analyse (athlete_id, type, session_id, date, modele, verdict_fr, verdict_pl)
     VALUES (?, 'seance', ?, '2026-10-14', 'essai', 'x', 'x')`, [ATHLETE, seance.id])) as any;
  const [ad] = (await cnx.query(
    `INSERT INTO msc_adaptation (analyse_id, session_id, zone_code, part_duree, pourquoi_fr, pourquoi_pl)
     VALUES (?, ?, 'ef', 0.750, 'x', 'x')`, [an.insertId, seance.id])) as any;

  await depots.appliquer(ATHLETE, 'msc_adaptation', ad.insertId, true, cnx);
  const apres = un<{ duree_min: number; charge: number; adapte_par: string }>((await cnx.query(
    'SELECT duree_min, charge, adapte_par FROM msc_session WHERE id = ?', [seance.id]))[0]);

  check('la séance raccourcit vraiment',
    apres.duree_min === Math.round(seance.duree_min * 0.75), `${seance.duree_min} → ${apres.duree_min}`);
  check('la charge suit la durée', apres.charge === apres.duree_min * (seance.charge / seance.duree_min));
  check('la séance dit qui l’a déplacée', apres.adapte_par === `msc_adaptation:${ad.insertId}`);

  const zonesApres = ((await cnx.query(
    'SELECT zone_code FROM msc_session_zone WHERE session_id = ? ORDER BY ordre',
    [seance.id]))[0] as any).map((z: any) => z.zone_code);
  check('et la zone proposée remplace celle prévue',
    zonesApres.length === 1 && zonesApres[0] === 'ef', zonesApres.join('+'));

  const heuresApres = un<{ heures: string }>((await cnx.query(
    'SELECT heures FROM msc_week WHERE plan_id = ? AND semaine = ?', [planActif, seance.semaine]))[0]).heures;
  check('les heures de la semaine suivent', Number(heuresApres) < Number(heuresAvant),
    `${heuresAvant} → ${heuresApres}`);

  /* Deux propositions sur la même séance se marcheraient dessus. */
  const [ad2] = (await cnx.query(
    `INSERT INTO msc_adaptation (analyse_id, session_id, zone_code, part_duree, pourquoi_fr, pourquoi_pl)
     VALUES (?, ?, NULL, 0.900, 'x', 'x')`, [an.insertId, seance.id])) as any;
  await refuse('une seconde proposition sur la même séance est refusée',
    () => depots.appliquer(ATHLETE, 'msc_adaptation', ad2.insertId, true, cnx));

  /* Accepter deux fois ne raccourcit pas deux fois. */
  await depots.appliquer(ATHLETE, 'msc_adaptation', ad.insertId, true, cnx);
  const rebelote = un<{ duree_min: number }>((await cnx.query(
    'SELECT duree_min FROM msc_session WHERE id = ?', [seance.id]))[0]);
  check('accepter deux fois ne raccourcit qu’une', rebelote.duree_min === apres.duree_min);

  await depots.appliquer(ATHLETE, 'msc_adaptation', ad.insertId, false, cnx);
  const rendue = un<{ duree_min: number; charge: number; adapte_par: string | null }>(
    (await cnx.query(
      'SELECT duree_min, charge, adapte_par FROM msc_session WHERE id = ?', [seance.id]))[0]);
  check('le retrait rend la séance exactement',
    rendue.duree_min === seance.duree_min && rendue.charge === seance.charge
      && rendue.adapte_par === null,
    `${rendue.duree_min} min · ${rendue.charge}`);

  const heuresRendues = un<{ heures: string }>((await cnx.query(
    'SELECT heures FROM msc_week WHERE plan_id = ? AND semaine = ?', [planActif, seance.semaine]))[0]).heures;
  check('et les heures de la semaine avec', heuresRendues === heuresAvant,
    `${heuresRendues} / ${heuresAvant}`);

  throw new Error('rollback');
}).catch((e) => {
  if (e.message !== 'rollback') throw e;
});


console.log('\n=== le garde-fou de zone ===');

/* La zone passe le garde-fou à l'écriture de la proposition, pas à
   l'affichage : ce qui est rangé est déjà ce qui sera montré, et ce qui sera
   écrit sur la séance le jour où l'athlète accepte. L'ordre des zones vient de
   la base — `msc_zone.ordre`, de la plus lente à la plus rapide — donc les deux
   côtés ne peuvent pas diverger sur ce qu'« aiguiser » veut dire. */
{
  const seance = un<{ id: number }>(await lignes(
    `SELECT s.id FROM msc_session s
     WHERE s.plan_id = :p AND s.type_code = 'seuil'
       AND EXISTS (SELECT 1 FROM msc_session_zone z WHERE z.session_id = s.id AND z.zone_code = 'seuil')
     LIMIT 1`, { p: planActif }));
  const cnx = bd();
  const zone = (propose: string | null) => depots.zoneAdmissible(cnx, seance.id, propose);

  check('une zone plus rapide que prévu retombe sur celle prévue',
    (await zone('vma')) === 'seuil', String(await zone('vma')));
  check('une zone que la base ne connaît pas aussi', (await zone('turbo')) === 'seuil');
  check('une zone plus lente passe', (await zone('ef')) === 'ef');
  check('pas de zone proposée, pas de zone rangée', (await zone(null)) === null);

  const nage = un<{ id: number }>(await lignes(
    `SELECT s.id FROM msc_session s WHERE s.plan_id = :p AND s.discipline = 'Natation'
       AND NOT EXISTS (SELECT 1 FROM msc_session_zone z WHERE z.session_id = s.id) LIMIT 1`,
    { p: planActif }));
  check('une séance que le plan n’écrit pas en allures n’en reçoit pas',
    (await depots.zoneAdmissible(cnx, nage.id, 'ef')) === null);
}

await fermer();
console.log(fails === 0 ? '\nOK' : `\n${fails} ÉCHECS`);
process.exit(fails === 0 ? 0 : 1);
