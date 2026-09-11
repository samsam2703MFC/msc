/* Exerce l'API par HTTP, contre une vraie base.

   Les dépôts se testent bien en les appelant directement, et c'est justement ce
   qu'il ne faut pas faire : ce qui casse une API, ce sont les couches qu'un
   appel direct saute — le cookie, le contrôle d'accès, la forme JSON, le code
   de retour. Ce script lance donc le serveur et lui parle comme le navigateur
   lui parlera.

   Il faut une base migrée et semée, et MSC_SECRET_KEY :
     npm run db:migrate && npm run db:seed && npm run check:api */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { msc_session } from '../src/data/plan.generated';
import { genererPlan } from '../src/data/generateur';
import { bd, fermer } from '../server/bd.mjs';
import { hacher } from '../server/auth.mjs';

const PORT = Number(process.env.MSC_CHECK_PORT ?? 8899);
const BASE = `http://127.0.0.1:${PORT}`;
const EMAIL = 'controle@mysmartcoach.local';
const MOT_DE_PASSE = 'un-mot-de-passe-de-controle';

let fails = 0;
const check = (nom: string, ok: boolean, detail = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${nom}${detail ? '  — ' + detail : ''}`);
};

/* Un client qui garde son cookie, comme un navigateur. */
function client() {
  let cookie = '';
  return {
    get cookie() { return cookie; },
    set cookie(v: string) { cookie = v; },
    async appel(chemin: string, init: RequestInit = {}) {
      const r = await fetch(BASE + chemin, {
        ...init,
        headers: {
          ...(init.body ? { 'content-type': 'application/json' } : {}),
          ...(cookie ? { cookie } : {}),
          ...(init.headers ?? {}),
        },
      });
      const pose = r.headers.get('set-cookie');
      if (pose) cookie = pose.split(';')[0];
      const corps = await r.json().catch(() => ({}));
      return { statut: r.status, corps: corps as any };
    },
  };
}

/* ------------------------------------------------------ préparer le terrain */

/* Deux comptes et deux athlètes : sans un second, « ce qui ne m'appartient pas
   m'est refusé » n'est pas testable, et c'est la seule assertion qui compte
   vraiment dans un contrôle d'accès. */
await bd().execute('DELETE FROM compte WHERE email IN (?, ?, ?, ?, ?, ?)',
  [EMAIL, `autre-${EMAIL}`, `cree-${EMAIL}`, `inscrit-${EMAIL}`, `libre-${EMAIL}`, `libre2-${EMAIL}`]);
await bd().execute('DELETE FROM msc_athlete WHERE nom IN (?, ?, ?, ?)',
  ['Athlète du contrôle', 'Athlète créé du contrôle', 'Inscrit du contrôle', 'Libre du contrôle']);

const [c1] = (await bd().execute(
  'INSERT INTO compte (email, mot_de_passe, nom, role) VALUES (?, ?, ?, ?)',
  [EMAIL, hacher(MOT_DE_PASSE), 'Contrôle', 'athlete'],
)) as any;
const [c2] = (await bd().execute(
  'INSERT INTO compte (email, mot_de_passe, nom, role) VALUES (?, ?, ?, ?)',
  [`autre-${EMAIL}`, hacher(MOT_DE_PASSE), 'Autre', 'athlete'],
)) as any;
const [a2] = (await bd().execute(
  `INSERT INTO msc_athlete (compte_id, nom, ref_actuelle_s, ref_cible_s, debut)
   VALUES (?, 'Athlète du contrôle', 300, 250, '2026-01-01')`,
  [c2.insertId],
)) as any;
await bd().execute("INSERT INTO msc_acces (compte_id, athlete_id, droit) VALUES (?, 1, 'ecriture')", [
  c1.insertId,
]);
await bd().execute("INSERT INTO msc_acces (compte_id, athlete_id, droit) VALUES (?, ?, 'ecriture')", [
  c2.insertId, a2.insertId,
]);

/* ------------------------------------------------------------ le serveur */

const serveur = spawn(process.execPath, ['server/index.mjs'], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: 'test', MSC_ATHLETE_ID: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let journalServeur = '';
serveur.stdout.on('data', (d) => { journalServeur += d; });
serveur.stderr.on('data', (d) => { journalServeur += d; });

async function attendre() {
  for (let i = 0; i < 100; i += 1) {
    try {
      const r = await fetch(`${BASE}/api/sante`);
      if (r.ok) return true;
    } catch { /* pas encore */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

try {
  check('le serveur démarre', await attendre());

  const c = client();

  console.log('\n=== avant d’être connecté ===');
  const sante = await c.appel('/api/sante');
  check('la santé répond sans cookie', sante.statut === 200 && sante.corps.ok === true);
  check('elle dit si le scellement est prêt', typeof sante.corps.scellement === 'boolean',
    String(sante.corps.scellement));
  check('et l’état de la clé Anthropic : présente, d’où, lisible',
    typeof sante.corps.cle === 'boolean' && 'cle_source' in sante.corps
      && typeof sante.corps.cle_illisible === 'boolean',
    JSON.stringify({ cle: sante.corps.cle, source: sante.corps.cle_source, illisible: sante.corps.cle_illisible }));

  const refuse = await c.appel('/api/db/instantane');
  check('l’instantané est refusé sans cookie', refuse.statut === 401, String(refuse.statut));

  const moi401 = await c.appel('/api/moi');
  check('« moi » aussi', moi401.statut === 401);

  console.log('\n=== la connexion ===');
  const inconnu = await c.appel('/api/connexion', {
    method: 'POST', body: JSON.stringify({ email: 'personne@nulle.part', mot_de_passe: 'x' }),
  });
  const faux = await c.appel('/api/connexion', {
    method: 'POST', body: JSON.stringify({ email: EMAIL, mot_de_passe: 'pas le bon' }),
  });
  check('un email inconnu est refusé', inconnu.statut === 401);
  check('un mauvais mot de passe aussi', faux.statut === 401);
  check('et les deux disent exactement la même chose',
    inconnu.corps.erreur === faux.corps.erreur, inconnu.corps.erreur);

  const ok = await c.appel('/api/connexion', {
    method: 'POST', body: JSON.stringify({ email: EMAIL, mot_de_passe: MOT_DE_PASSE }),
  });
  check('le bon mot de passe ouvre une session', ok.statut === 200 && Boolean(c.cookie));
  check('le cookie est HttpOnly', !c.cookie.includes('HttpOnly') && c.cookie.startsWith('msc_session='),
    c.cookie.slice(0, 20) + '…');
  check('la réponse ne contient aucun hachage',
    !JSON.stringify(ok.corps).includes('scrypt'));

  console.log('\n=== l’instantané ===');
  /* Une activité d'il y a trois jours, à la main : les activités du seed sont
     datées dans le futur (octobre 2026) et n'ont pas eu lieu — les courbes de
     forme doivent les ignorer, pas s'arrêter dessus. */
  await bd().execute(
    `INSERT INTO msc_activity (athlete_id, id_strava, session_id, date, nom, sport, duree_min, manuelle, statut)
     VALUES (1, NULL, NULL, DATE_SUB(CURDATE(), INTERVAL 3 DAY), 'contrôle', 'run', 40, 1, 'fait')`,
  );
  const inst = await c.appel('/api/db/instantane');
  check('il répond une fois connecté', inst.statut === 200, String(inst.statut));
  const base = inst.corps;
  check('les 243 séances sont là', base.msc_session?.length === msc_session.length,
    `${base.msc_session?.length}`);
  check('les huit zones, dans l’ordre', base.msc_zone?.length === 8 &&
    base.msc_zone[0].code === 'recup' && base.msc_zone[7].code === 'vma');
  check('les libellés sont en deux langues',
    Boolean(base.msc_ui?.fr?.anaIdle && base.msc_ui?.pl?.anaIdle));
  /* Les courbes de forme : calculées par le serveur sur les activités du
     seed, jamais stockées. La base d'une activité lissée sur 42 jours vaut
     durée × RPE / 42 le premier jour — strictement plus que zéro. */
  const courbes = base.courbes;
  check('les courbes de forme voyagent avec l’instantané',
    Array.isArray(courbes?.charge) && Array.isArray(courbes?.hrv) && courbes?.tau?.base === 42
      && courbes?.tau?.fatigue === 7 && courbes?.tau?.hrv_base === 30,
    JSON.stringify(courbes?.tau));
  const aujourdhuiIso = new Date().toISOString().slice(0, 10);
  check('la base endurance se construit sur les activités, jusqu’à aujourd’hui',
    courbes?.charge.length >= 4 && courbes.charge[courbes.charge.length - 1].base > 0
      && courbes.charge.at(-1)?.date === aujourdhuiIso
      && courbes.charge.every((d: any) => d.fatigue >= 0 && typeof d.date === 'string'),
    `${courbes?.charge.length} jours · dernier ${courbes?.charge.at(-1)?.date} · base ${courbes?.charge.at(-1)?.base}`);
  check('et les activités datées dans le futur n’y sont pas',
    courbes?.charge.every((d: any) => d.date <= aujourdhuiIso));

  /* L'empreinte : elle voyage avec l'instantané, et /api/fraicheur rend la
     même tant que rien n'a bougé. C'est ce qui permet au téléphone de savoir,
     pour quelques octets, qu'un entraînement modifié au back office l'attend. */
  const fraiche = await c.appel('/api/fraicheur');
  check('la fraîcheur répond la même empreinte que l’instantané',
    fraiche.statut === 200 && typeof base.empreinte === 'string' && base.empreinte.length > 0
      && fraiche.corps.empreinte === base.empreinte,
    `${fraiche.statut} · ${fraiche.corps?.empreinte}`);
  const [[premiere]]: any = await bd().execute(
    `SELECT s.id FROM msc_session s JOIN msc_plan p ON p.id = s.plan_id
     WHERE p.athlete_id = 1 AND p.actif = 1 ORDER BY s.date, s.ordre LIMIT 1`,
  );
  await bd().execute(
    'UPDATE msc_session SET maj_le = NOW(3) + INTERVAL 1 SECOND WHERE id = ?',
    [premiere.id],
  );
  const empreinteApres = await c.appel('/api/fraicheur');
  check('et elle change dès qu’un entraînement bouge en base',
    empreinteApres.statut === 200 && empreinteApres.corps.empreinte !== base.empreinte,
    `${base.empreinte} → ${empreinteApres.corps?.empreinte}`);

  const apercu = await c.appel('/api/apercu');
  check('la vue coach porte les mêmes courbes',
    apercu.statut === 200 && Array.isArray(apercu.corps.athletes?.[0]?.courbes?.charge)
      && apercu.corps.athletes[0].courbes.charge.length === courbes?.charge.length,
    `${apercu.statut} · ${apercu.corps.athletes?.[0]?.courbes?.charge?.length}`);

  const seuil = base.msc_session.find((s: any) => s.id === 1052);
  check('la séance du classeur ressort entière',
    seuil?.duree_min === 68 && seuil?.charge === 476 &&
    JSON.stringify(seuil?.zones) === JSON.stringify(['ef', 'seuil']) &&
    seuil?.titre?.fr?.includes('Seuil'),
    `${seuil?.duree_min} min · ${seuil?.zones}`);

  /* La règle qui traverse tout : aucune allure prescrite ne sort du serveur.
     Les seules exceptions admises sont deux phrases de prose du classeur, dans
     le déroulé d'une séance — pas un champ que l'application affiche comme une
     allure de travail. */
  const structure = base.msc_session.map((s: any) => ({ ...s, detail: undefined }));
  const allures = JSON.stringify(structure).match(/\d+[:h]\d\d\s*\/?\s*km/gi) ?? [];
  check('aucune allure prescrite dans les champs structurés', allures.length === 0,
    allures.slice(0, 3).join(' '));

  /* La consigne « EF 06:27 » du classeur était l'allure du jour de l'import.
     Là où la séance a des zones, le serveur ne la sert plus : le moteur la
     recompose côté navigateur, et elle glisse avec la référence. */
  const figees = base.msc_session.filter((s: any) => s.zones.length > 0 && s.consigne);
  check('aucune consigne figée là où le moteur sait calculer', figees.length === 0,
    `${figees.length} séances`);
  const prose = base.msc_session.filter((s: any) => s.zones.length === 0 && s.consigne);
  check('la consigne en prose survit là où il n’y a pas de zone', prose.length > 0,
    `${prose.length} séances`);
  const adaptations = base.msc_adaptation ?? [];
  check('une adaptation est rendue en zone et en part, pas en minutes',
    adaptations.every((a: any) => a.part_duree !== undefined && a.session_apres === undefined),
    JSON.stringify(adaptations[0] ?? {}).slice(0, 70));

  check('aucun jeton ni hachage dans l’instantané',
    !JSON.stringify(base).includes('scrypt') && !JSON.stringify(base).includes('access_token'));

  console.log('\n=== ce que l’application écrit ===');
  const jour = '2026-10-20';
  const ecriture = await c.appel('/api/journal', {
    method: 'POST',
    body: JSON.stringify({
      mutation_id: '00000000-0000-4000-8000-00000000cafe',
      date: jour, session_id: null, rpe: 6, sommeil: 7.5, note: 'jambes lourdes',
      douleurs: ['mollet'],
    }),
  });
  check('le journal s’écrit', ecriture.statut === 200, JSON.stringify(ecriture.corps));

  const rejoue = await c.appel('/api/journal', {
    method: 'POST',
    body: JSON.stringify({
      mutation_id: '00000000-0000-4000-8000-00000000cafe',
      date: jour, rpe: 9, note: 'ne doit pas passer',
    }),
  });
  check('la même mutation rejouée est reconnue', rejoue.corps.rejoue === true);

  /* Deux rejeux en parallèle du même identifiant : c'est ce qu'une file
     d'attente produit quand « online » et une relance manuelle tombent
     ensemble. Le travail doit être fait une fois, pas deux. */
  const jumelles = await Promise.all([
    c.appel('/api/journal', {
      method: 'POST',
      body: JSON.stringify({
        mutation_id: '00000000-0000-4000-8000-0000000dbeef',
        date: '2026-10-21', rpe: 4, note: 'une seule fois',
      }),
    }),
    c.appel('/api/journal', {
      method: 'POST',
      body: JSON.stringify({
        mutation_id: '00000000-0000-4000-8000-0000000dbeef',
        date: '2026-10-21', rpe: 4, note: 'une seule fois',
      }),
    }),
  ]);
  check('deux envois simultanés réussissent tous les deux',
    jumelles.every((r) => r.statut === 200), jumelles.map((r) => r.statut).join(' '));
  check('et un seul a fait le travail',
    jumelles.filter((r) => r.corps.rejoue === true).length === 1,
    JSON.stringify(jumelles.map((r) => r.corps)));
  const [comptees] = (await bd().execute(
    'SELECT COUNT(*) AS n FROM msc_journal WHERE athlete_id = 1 AND date = ?', ['2026-10-21'],
  )) as any;
  check('une seule ligne en base', comptees[0].n === 1, String(comptees[0].n));

  const apres = await c.appel('/api/db/instantane');
  const entree = apres.corps.msc_journal.find((j: any) => j.date === jour);
  check('elle apparaît dans l’instantané suivant', entree?.rpe_ressenti === 6, `RPE ${entree?.rpe_ressenti}`);
  check('et le rejeu n’a rien écrasé', entree?.note === 'jambes lourdes', entree?.note);
  check('les douleurs remontent', JSON.stringify(entree?.douleurs) === JSON.stringify(['mollet']));

  /* La coche « faite » : sur une séance, écrite seule ; puis une écriture sans
     elle (le RPE du soir) ne la défait pas ; puis null l'efface. */
  const seanceCochee = msc_session.find((s) => s.type !== 'repos')!;
  const ecrireCoche = (corps: Record<string, unknown>) => c.appel('/api/journal', {
    method: 'POST', body: JSON.stringify({ date: seanceCochee.date, session_id: seanceCochee.id, ...corps }),
  });
  const coche = await ecrireCoche({ rpe: 6, fait: true });
  check('la coche « faite » s’écrit sur une séance', coche.statut === 200, JSON.stringify(coche.corps));
  await ecrireCoche({ rpe: 7, note: 'sans la coche' });
  const relu = (await c.appel('/api/db/instantane')).corps.msc_journal.find((j: any) => j.session_id === seanceCochee.id);
  check('et une écriture sans coche la laisse en place', relu?.fait === true && relu?.rpe_ressenti === 7, JSON.stringify(relu));
  await ecrireCoche({ rpe: 7, fait: false });
  const relu2 = (await c.appel('/api/db/instantane')).corps.msc_journal.find((j: any) => j.session_id === seanceCochee.id);
  check('« pas faite » s’écrit aussi', relu2?.fait === false, JSON.stringify(relu2?.fait));
  await ecrireCoche({ rpe: 7, fait: null });
  const relu3 = (await c.appel('/api/db/instantane')).corps.msc_journal.find((j: any) => j.session_id === seanceCochee.id);
  check('et null l’efface', relu3 !== undefined && relu3.fait === undefined, JSON.stringify(relu3?.fait));

  /* Pourquoi elle n'a pas eu lieu : le vocabulaire fermé du bilan de séance.
     Un mot inventé tombe, le tableau vide efface, et les deux vocabulaires
     ne se marchent pas dessus. */
  await ecrireCoche({ fait: false, raisons: ['pas_envie', 'meteo', 'parce_que'] });
  const relu4 = (await c.appel('/api/db/instantane')).corps.msc_journal.find((j: any) => j.session_id === seanceCochee.id);
  check('les motifs d’une séance sautée se rangent, hors vocabulaire exclu',
    JSON.stringify(relu4?.raisons) === JSON.stringify(['meteo', 'pas_envie']), JSON.stringify(relu4?.raisons));
  await ecrireCoche({ fait: true, raisons: [], limites: ['jambes'] });
  const relu5 = (await c.appel('/api/db/instantane')).corps.msc_journal.find((j: any) => j.session_id === seanceCochee.id);
  check('« finalement si » les efface, et ce qui a bloqué prend la place',
    JSON.stringify(relu5?.raisons) === '[]' && JSON.stringify(relu5?.limites) === JSON.stringify(['jambes']),
    JSON.stringify({ raisons: relu5?.raisons, limites: relu5?.limites }));

  /* La semaine type : sept jours, deux créneaux, et c'est la matrice entière
     qui s'écrit — un créneau retiré de l'envoi disparaît, un « repos » ne se
     range pas (un jour sans rien EST le repos). */
  const semaineType = await c.appel('/api/structure', {
    method: 'POST',
    body: JSON.stringify({ creneaux: [
      { jour: 1, creneau: 1, discipline: 'Natation', type_code: 'nage', duree_min: 55 },
      { jour: 2, creneau: 1, discipline: 'Course à pied', type_code: 'seuil', duree_min: 60 },
      { jour: 2, creneau: 2, discipline: 'Hyrox', type_code: 'force', duree_min: 45 },
      { jour: 6, creneau: 1, discipline: 'Repos', type_code: 'repos', duree_min: 0 },
      { jour: 9, creneau: 1, discipline: 'Course à pied', type_code: 'ef', duree_min: 40 },
    ] }),
  });
  check('la semaine type s’écrit, sans le repos ni un jour qui n’existe pas',
    semaineType.statut === 200 && semaineType.corps.creneaux === 3,
    JSON.stringify(semaineType.corps));
  const avecStructure = await c.appel('/api/db/instantane');
  const matrice = avecStructure.corps.msc_structure ?? [];
  check('et l’instantané la porte, rangée par jour et par créneau',
    matrice.length === 3 && matrice[0].jour === 1 && matrice[0].type_code === 'nage'
      && matrice[2].jour === 2 && matrice[2].creneau === 2 && matrice[2].duree_min === 45,
    JSON.stringify(matrice));
  const videe = await c.appel('/api/structure', { method: 'POST', body: JSON.stringify({ creneaux: [] }) });
  const apresVidage = (await c.appel('/api/db/instantane')).corps.msc_structure ?? [];
  check('l’envoyer vide l’efface : la matrice est remplacée, pas fusionnée',
    videe.statut === 200 && apresVidage.length === 0, JSON.stringify(apresVidage));

  const moiAvant = (await c.appel('/api/db/instantane')).corps.msc_athlete?.[0];
  /* Les objectifs par discipline : deux temps sur l'épreuve étalon du sport.
     Celui de la course à pied n'est pas rangé à part — il atterrit dans les
     deux références de l'athlète, d'où le moteur tire chaque allure. */
  const objNage = await c.appel('/api/athlete/objectifs', {
    method: 'POST', body: JSON.stringify({ discipline: 'Natation', actuel_s: 1620, cible_s: 1500 }),
  });
  const avecObjectif = await c.appel('/api/db/instantane');
  const nage = (avecObjectif.corps.msc_objectif_sport ?? []).find((o: any) => o.discipline === 'Natation');
  check('un objectif de discipline s’écrit et revient dans l’instantané',
    objNage.statut === 200 && nage?.actuel_s === 1620 && nage?.cible_s === 1500,
    JSON.stringify(nage));
  /* Les références de l'athlète 1 sont celles que le classeur vérifie : on les
     reprend telles quelles après l'avoir prouvé, sinon check:db et check:app
     liraient les allures d'un autre athlète. */
  const refsAvant = { actuelle: moiAvant?.ref_actuelle_s, cible: moiAvant?.ref_cible_s };
  const objCap = await c.appel('/api/athlete/objectifs', {
    method: 'POST', body: JSON.stringify({ discipline: 'Course à pied', actuel_s: 2700, cible_s: 2400 }),
  });
  const apresCap = await c.appel('/api/db/instantane');
  const moiApres = apresCap.corps.msc_athlete?.[0];
  check('le 10 km, lui, écrit les références de l’athlète — pas une seconde ligne',
    objCap.statut === 200 && moiApres?.ref_actuelle_s === 270 && moiApres?.ref_cible_s === 240
      && !(apresCap.corps.msc_objectif_sport ?? []).some((o: any) => o.discipline === 'Course à pied'),
    `${moiApres?.ref_actuelle_s} → ${moiApres?.ref_cible_s}`);
  await bd().execute('UPDATE msc_athlete SET ref_actuelle_s = ?, ref_cible_s = ? WHERE id = 1',
    [refsAvant.actuelle, refsAvant.cible]);
  const objVide = await c.appel('/api/athlete/objectifs', {
    method: 'POST', body: JSON.stringify({ discipline: 'Natation', actuel_s: null, cible_s: null }),
  });
  const apresVide = await c.appel('/api/db/instantane');
  check('deux temps vides retirent l’objectif : une ligne vide n’en est pas un',
    objVide.statut === 200 && !(apresVide.corps.msc_objectif_sport ?? []).some((o: any) => o.discipline === 'Natation'),
    JSON.stringify(apresVide.corps.msc_objectif_sport));
  const objFou = await c.appel('/api/athlete/objectifs', {
    method: 'POST', body: JSON.stringify({ discipline: 'Vélo', actuel_s: 3, cible_s: 2 }),
  });
  check('un temps invraisemblable est refusé', objFou.statut >= 400, String(objFou.statut));

  /* Les modèles de semaine type sont l'outil du coach : un athlète ne les
     voit pas, et n'en pose pas. */
  const modeleRefuse = await c.appel('/api/modeles', {
    method: 'POST', body: JSON.stringify({ nom: 'Interdit', creneaux: [] }),
  });
  check('les modèles de semaine sont refusés à un athlète',
    modeleRefuse.statut === 403, String(modeleRefuse.statut));

  /* Les sept prochains jours : la route vérifie sa forme, puis demande au
     coach — sans clé Anthropic ici, c'est le 401 qui dit lequel des trois cas
     on est ; avec une clé, une replanification rangée. */
  const glissantVide = await c.appel('/api/glissant', { method: 'POST', body: JSON.stringify({}) });
  check('la replanification refuse un corps vide', glissantVide.statut === 400, String(glissantVide.statut));
  const glissant = await c.appel('/api/glissant', {
    method: 'POST',
    body: JSON.stringify({
      langue: 'fr', aujourdhui: new Date().toISOString().slice(0, 10), jour: 'Jeudi', semaine: 1, bloc: 'A',
      athlete: { nom: 'Contrôle', ref_actuelle: '52:00', ref_cible: '38:00' },
      passees: [], prochains: [], regles: [],
    }),
  });
  check('et sans clé Anthropic elle dit laquelle des trois pannes (ou replanifie, avec une clé)',
    (glissant.statut === 401 && /Anthropic/.test(String(glissant.corps.erreur))) || glissant.statut === 200,
    `${glissant.statut} · ${String(glissant.corps.erreur ?? 'ok').slice(0, 80)}`);

  const mesure = await c.appel('/api/mesure', {
    method: 'POST',
    body: JSON.stringify({ date: jour, poids_kg: 74.5, fc_repos: 46, source: 'saisie' }),
  });
  check('une mesure s’écrit', mesure.statut === 200);
  const apres2 = await c.appel('/api/db/instantane');
  check('la FC de repos rejoint la série',
    apres2.corps.msc_daily.some((d: any) => d.date === jour && d.fc_repos === 46));

  await c.appel('/api/mesure', {
    method: 'POST', body: JSON.stringify({ date: jour, poids_kg: 900 }),
  }).then((r) => check('un poids absurde est refusé par la base', r.statut >= 400, String(r.statut)));

  console.log('\n=== la photo ===');

  /* Un PNG minuscule mais valide. Sans clé Anthropic la lecture échoue, et
     c'est justement le chemin qui compte : la photo doit être rangée quand
     même, sinon un incident du modèle la perd. */
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAABlBMVEX///+/v7+jQ3Y5AAAADklEQVQI12P4AIX8EAgALgAD/aNpbtEAAAAASUVORK5CYII=',
    'base64',
  );
  const envoi = await fetch(`${BASE}/api/photo?date=2030-02-02`, {
    method: 'POST',
    headers: { 'content-type': 'image/png', cookie: c.cookie },
    body: png,
  });
  const lue = (await envoi.json()) as any;
  check('une photo est acceptée', envoi.status === 200 && lue.photo_id > 0, String(envoi.status));
  check('elle est rangée même quand la lecture échoue',
    lue.photo_id > 0 && (lue.echec === null || typeof lue.echec === 'string'));
  check("aucun détail interne ne remonte au navigateur",
    !JSON.stringify(lue).includes('resolve authentication'),
    String(lue.echec).slice(0, 40));

  const heic = await fetch(`${BASE}/api/photo`, {
    method: 'POST',
    headers: { 'content-type': 'image/heic', cookie: c.cookie },
    body: png,
  });
  check('un format que l’API ne lit pas est refusé et le dit',
    heic.status === 400 && /HEIC/.test(((await heic.json()) as any).erreur ?? ''));

  const attente = await c.appel('/api/db/instantane');
  check('la mesure attend la confirmation de l’athlète',
    attente.corps.mesures_attente?.some((m: any) => m.date === '2030-02-02'),
    JSON.stringify(attente.corps.mesures_attente?.[0] ?? {}).slice(0, 60));
  check('et elle ne compte dans aucune série avant',
    !attente.corps.msc_daily.some((d: any) => d.date === '2030-02-02'));

  const sansCookie = await fetch(`${BASE}/api/photo/${lue.photo_id}`);
  check('une photo ne s’ouvre pas sans cookie', sansCookie.status === 401,
    String(sansCookie.status));

  const confirmee = await c.appel('/api/mesure/confirmer', {
    method: 'POST',
    body: JSON.stringify({ date: '2030-02-02', poids_kg: 74.5, fc_repos: 46 }),
  });
  check('la confirmation la fait compter', confirmee.corps.etat === 'confirme');
  /* L'athlète a saisi ce que le modèle n'avait pas lu : la source le dit, pour
     qu'on puisse un jour mesurer ce que le modèle se fait corriger. */
  check('une correction est notée comme telle', confirmee.corps.corrige === true);

  const apresPhoto = await c.appel('/api/db/instantane');
  check('la FC rejoint la série une fois confirmée',
    apresPhoto.corps.msc_daily.some((d: any) => d.date === '2030-02-02' && d.fc_repos === 46));
  check('et elle ne figure plus en attente',
    !apresPhoto.corps.mesures_attente?.some((m: any) => m.date === '2030-02-02'));

  console.log('\n=== le back office ===');
  const creee = await c.appel('/api/competitions', {
    method: 'POST',
    body: JSON.stringify({
      date: '2026-12-06', nom: 'Corrida du contrôle', lieu: 'Nulle part', distance_km: 10,
      resultat: { temps_s: 2820, classement: 42, partants: 900 },
    }),
  });
  check('une compétition s’encode', creee.statut === 200 && creee.corps.id > 0);

  const liste = await c.appel('/api/competitions');
  const ajoutee = liste.corps.competitions.find((x: any) => x.id === creee.corps.id);
  check('elle ressort avec son résultat', ajoutee?.resultat?.temps_s === 2820);
  /* L'allure d'un résultat n'est pas stockée : temps ÷ distance, et la distance
     est sur la compétition. 2820 s sur 10 km = 282 s/km. */
  check('son allure est calculée, pas stockée', ajoutee?.resultat?.allure_s_km === 282,
    `${ajoutee?.resultat?.allure_s_km} s/km`);

  const suppr = await c.appel(`/api/competitions?id=${creee.corps.id}`, { method: 'DELETE' });
  check('elle se supprime', suppr.statut === 200);

  console.log('\n=== enregistrer un plan, et le déplacer ===');

  /* Tout ce bloc se passe chez le second athlète. Il écrit un plan et raccourcit
     une séance : rien de ça ne doit toucher au classeur que les autres sections
     lisent, et tout part avec l'athlète au nettoyage. */
  const c2c = client();
  await c2c.appel('/api/connexion', {
    method: 'POST',
    body: JSON.stringify({ email: `autre-${EMAIL}`, mot_de_passe: MOT_DE_PASSE }),
  });

  const genere = genererPlan(
    { nom: 'Contrôle', ref_actuelle_s: 336, ref_cible_s: 300, debut: '2031-01-06' },
    [{ date: '2031-04-13', nom: 'Semi du contrôle', cible_s: 5400, distance_km: 21.1, principal: true }],
    { plancher_heures: 8, plancher_km_sortie: 10, reamorcage_semaines: 6, affutage_semaines: 3,
      natation: true, velo: true, salle: true, montagne_toutes_les: 3 },
  );

  const pose = await c2c.appel('/api/plan', {
    method: 'POST',
    body: JSON.stringify({
      nom: 'Plan du contrôle',
      /* Les deux références sur lesquelles le plan est bâti : elles doivent
         devenir celles de l'athlète. */
      athlete: { ref_actuelle_s: 336, ref_cible_s: 300, debut: '2031-01-06' },
      blocs: genere.blocs, semaines: genere.semaines, sessions: genere.sessions,
      objectifs: [{ date: '2031-04-13', nom: 'Semi du contrôle', cible_s: 5400,
        distance_km: 21.1, principal: true, type_course: 'cap_semi' }],
    }),
  });
  check('un plan généré s’enregistre',
    pose.statut === 200 && pose.corps.seances === genere.sessions.length,
    `${pose.statut} · ${pose.corps.seances ?? pose.corps.erreur}`);

  const vu = await c2c.appel('/api/db/instantane');
  check('et l’instantané le sert comme plan actif',
    vu.corps.plan?.origine === 'genere' && vu.corps.msc_session.length === genere.sessions.length,
    `${vu.corps.plan?.origine} · ${vu.corps.msc_session.length}`);
  check('avec ses objectifs', vu.corps.msc_objectif.length === 1);
  check('et son type de course', vu.corps.msc_objectif[0]?.type_course === 'cap_semi');
  const [[refs]] = (await bd().execute(
    'SELECT ref_actuelle_s, ref_cible_s FROM msc_athlete WHERE id = ?', [a2.insertId],
  )) as any;
  check('les références du plan deviennent celles de l’athlète',
    Number(refs?.ref_actuelle_s) === 336 && Number(refs?.ref_cible_s) === 300, JSON.stringify(refs));

  /* Un refus de forme est une réponse, pas une panne : il doit se lire. */
  const vide = await c2c.appel('/api/plan', {
    method: 'POST', body: JSON.stringify({ blocs: [], sessions: [] }),
  });
  check('un plan sans bloc est refusé, et le dit',
    vide.statut === 400 && /bloc/i.test(String(vide.corps.erreur)),
    `${vide.statut} · ${vide.corps.erreur}`);

  /* Une proposition sur une séance de ce plan, posée en base comme le coach la
     poserait, puis acceptée par HTTP. */
  const cible = vu.corps.msc_session.find((x: any) => x.zones?.length > 0 && x.duree_min > 0);
  await bd().execute(
    `INSERT INTO msc_analyse (athlete_id, type, session_id, date, modele, verdict_fr, verdict_pl)
     VALUES (?, 'seance', ?, '2031-01-08', 'controle', 'x', 'x')`,
    [a2.insertId, cible.id],
  );
  const [an] = (await bd().execute('SELECT LAST_INSERT_ID() AS id')) as any;
  await bd().execute(
    `INSERT INTO msc_adaptation (analyse_id, session_id, zone_code, part_duree, pourquoi_fr, pourquoi_pl)
     VALUES (?, ?, 'ef', 0.700, 'x', 'x')`,
    [an[0].id, cible.id],
  );

  const avant = await c2c.appel('/api/db/instantane');
  const prop = avant.corps.msc_adaptation[0];
  check('la proposition remonte dans l’instantané', prop?.part_duree === 0.7, String(prop?.part_duree));

  const acceptee = await c2c.appel('/api/proposition', {
    method: 'POST',
    body: JSON.stringify({ table: 'msc_adaptation', id: prop.id, applique: true }),
  });
  check('accepter répond que la séance a bougé',
    acceptee.statut === 200 && acceptee.corps.seance === true,
    `${acceptee.statut} · ${JSON.stringify(acceptee.corps)}`);

  const apresAccept = await c2c.appel('/api/db/instantane');
  const deplacee = apresAccept.corps.msc_session.find((x: any) => x.id === cible.id);
  check('et la séance a vraiment bougé dans la base',
    deplacee.duree_min === Math.round(cible.duree_min * 0.7),
    `${cible.duree_min} → ${deplacee.duree_min}`);
  check('la charge a suivi', deplacee.charge === deplacee.duree_min * deplacee.rpe_cible);
  check('la proposition se souvient d’où elle vient',
    apresAccept.corps.msc_adaptation[0].avant?.duree_min === cible.duree_min,
    JSON.stringify(apresAccept.corps.msc_adaptation[0].avant));

  /* La proposition d'un autre athlète : le premier client n'y touche pas. */
  const vol = await c.appel('/api/proposition', {
    method: 'POST',
    body: JSON.stringify({ table: 'msc_adaptation', id: prop.id, applique: false }),
  });
  check('la proposition d’un autre athlète m’est refusée', vol.statut === 404, String(vol.statut));
  const intacte = await c2c.appel('/api/db/instantane');
  check('et elle n’a pas bougé pour autant',
    intacte.corps.msc_session.find((x: any) => x.id === cible.id).duree_min === deplacee.duree_min);

  const retiree = await c2c.appel('/api/proposition', {
    method: 'POST',
    body: JSON.stringify({ table: 'msc_adaptation', id: prop.id, applique: false }),
  });
  const rendue = await c2c.appel('/api/db/instantane');
  check('le retrait rend la séance',
    retiree.statut === 200
      && rendue.corps.msc_session.find((x: any) => x.id === cible.id).duree_min === cible.duree_min,
    String(rendue.corps.msc_session.find((x: any) => x.id === cible.id).duree_min));

  /* Un enchaînement se vise partie par partie, et les parties se relisent.
     En dernier : enregistrer un plan remplace l'actif, et tout ce qui précède
     lit les séances du premier. */
  const multi = await c2c.appel('/api/plan', {
    method: 'POST',
    body: JSON.stringify({
      nom: 'Plan multi du contrôle',
      blocs: genere.blocs, semaines: genere.semaines, sessions: genere.sessions,
      objectifs: [{
        date: '2031-04-13', nom: 'Triathlon du contrôle', cible_s: 9000, distance_km: 51.5,
        principal: true, type_course: 'tri_olympique',
        parties: [
          { discipline: 'natation', cible_s: 1560 },
          { discipline: 'velo', cible_s: 4080 },
          { discipline: 'cap', cible_s: 2700 },
        ],
      }],
    }),
  });
  const vuMulti = await c2c.appel('/api/db/instantane');
  const objMulti = vuMulti.corps.msc_objectif?.[0];
  check('un objectif d’enchaînement garde le chrono de chaque partie',
    multi.statut === 200 && objMulti?.type_course === 'tri_olympique'
      && objMulti?.parties?.length === 3 && objMulti.parties[2].cible_s === 2700
      && objMulti.parties[2].discipline === 'cap',
    JSON.stringify(objMulti?.parties));


  /* Le back office de l'admin — ce que `npm run compte` fait en ligne de
     commande, par l'API. Le rôle se lit en base à chaque requête : on promeut
     le compte de contrôle par SQL, sans se reconnecter. */
  /* L'application Strava propre à un athlète : l'ID se lit, le secret jamais,
     et sans elle c'est l'application commune qui vaut. */
  /* La synchro de l'application ne touche qu'à sa fenêtre : l'historique plus
     ancien que le plan, tiré par le coach, lui survit. */
  /* Le type de course : un start le porte, un objectif aussi, et l'un se
     relie à l'autre. */
  console.log('\n=== les types de course, et le lien start ↔ objectif ===');
  const start = await c.appel('/api/competitions', {
    method: 'POST',
    body: JSON.stringify({ date: '2027-05-02', nom: 'Half de contrôle', type_course: 'tri_70_3', distance_km: 113, discipline: 'Triathlon & enchaînements' }),
  });
  const apresStart = await c.appel('/api/competitions');
  const encodee = apresStart.corps.competitions?.find((x: any) => x.nom === 'Half de contrôle');
  check('un start s’encode avec son type de course', start.statut === 200 && encodee?.type_course === 'tri_70_3'
    && Number(encodee?.distance_km) === 113, JSON.stringify(encodee ?? {}).slice(0, 120));
  const instantTypes = await c.appel('/api/db/instantane');
  const objectif = instantTypes.corps.msc_objectif?.[0];
  const lien = objectif
    ? await c.appel('/api/objectif/lien', { method: 'PUT', body: JSON.stringify({ objectif_id: objectif.id, competition_id: encodee?.id }) })
    : { statut: 0, corps: {} as any };
  check('et se relie à un objectif du plan, qui change de semaine',
    Boolean(objectif) && lien.statut === 200 && lien.corps.competition_id === encodee?.id && lien.corps.semaine > 0,
    JSON.stringify(lien.corps));
  const lienFaux = await c.appel('/api/objectif/lien', { method: 'PUT', body: JSON.stringify({ objectif_id: 999999, competition_id: encodee?.id }) });
  check('un objectif qui n’est pas au plan de cet athlète est refusé', lienFaux.statut === 404, String(lienFaux.statut));
  if (encodee?.id) await c.appel(`/api/competitions?id=${encodee.id}`, { method: 'DELETE' });

  console.log('\n=== l’historique et la fenêtre de synchro ===');
  await bd().execute('DELETE FROM msc_activity WHERE athlete_id = 1 AND id_strava IN (777001, 777002)');
  await bd().execute(
    `INSERT INTO msc_activity (athlete_id, id_strava, date, nom, sport, duree_min, duree_s, distance_m, statut)
     VALUES (1, 777001, '2020-01-05', 'Sortie d’avant le plan', 'run', 50, 3000, 10000, 'fait')`,
  );
  const idSynchro = randomUUID();
  const synchro = await c.appel('/api/activites', {
    method: 'POST',
    body: JSON.stringify({
      mutation_id: idSynchro, depuis: '2026-10-01',
      activites: [{ id_strava: 777002, date: '2026-10-22', sport: 'run', duree_min: 30, statut: 'fait' }],
    }),
  });
  const [[survie]] = (await bd().execute(
    'SELECT COUNT(*) AS n, SUM(distance_m) AS m FROM msc_activity WHERE athlete_id = 1 AND id_strava IN (777001, 777002)',
  )) as any;
  check('une synchro bornée à sa fenêtre laisse l’historique plus ancien en place',
    synchro.statut === 200 && Number(survie.n) === 2 && Number(survie.m) === 10000,
    `${synchro.statut} · lignes ${survie.n} · distance gardée ${survie.m}`);
  const instantHist = await c.appel('/api/db/instantane');
  const ancienne = instantHist.corps.msc_activity?.find((a: any) => a.id_strava === 777001);
  check('et l’instantané porte la distance et le nom de l’historique',
    ancienne?.distance_km === 10 && ancienne?.nom === 'Sortie d’avant le plan' && ancienne?.duree_s === 3000,
    JSON.stringify(ancienne));
  await bd().execute('DELETE FROM msc_activity WHERE athlete_id = 1 AND id_strava IN (777001, 777002)');
  await bd().execute('DELETE FROM msc_mutation WHERE id = ?', [idSynchro]);
  const histRefuse = await c.appel('/api/strava/historique', { method: 'POST', body: JSON.stringify({}) });
  check('tirer l’historique d’un athlète sans Strava relié est refusé, pas planté',
    histRefuse.statut === 409 || histRefuse.statut === 501, `${histRefuse.statut} ${histRefuse.corps.erreur ?? ''}`);

  console.log('\n=== l’application Strava d’un athlète ===');
  const appAvant = await c.appel('/api/strava/app');
  check('sans application propre, l’athlète passe par la commune', appAvant.statut === 200 && appAvant.corps.propre === false,
    JSON.stringify(appAvant.corps));
  const appIllisible = await c.appel('/api/strava/app', { method: 'PUT', body: JSON.stringify({ client_id: 'abc', client_secret: 'x' }) });
  check('un ID client qui n’est pas un nombre est refusé', appIllisible.statut === 400, appIllisible.corps.erreur);
  const appSansSecret = await c.appel('/api/strava/app', { method: 'PUT', body: JSON.stringify({ client_id: '424242' }) });
  check('et la première fois, le secret est obligatoire', appSansSecret.statut === 400, appSansSecret.corps.erreur);
  const appPosee = await c.appel('/api/strava/app', { method: 'PUT', body: JSON.stringify({ client_id: '424242', client_secret: 'secret-de-controle' }) });
  check('une application propre se pose : l’ID revient, le secret non',
    appPosee.statut === 200 && appPosee.corps.propre === true && appPosee.corps.client_id === '424242'
      && appPosee.corps.secret === true && !JSON.stringify(appPosee.corps).includes('secret-de-controle'),
    JSON.stringify(appPosee.corps));
  const etatPropre = await c.appel('/api/strava/etat');
  check('l’état Strava dit alors « configuré », par l’application propre',
    etatPropre.statut === 200 && etatPropre.corps.configure === true && etatPropre.corps.app_propre === true,
    JSON.stringify({ configure: etatPropre.corps.configure, propre: etatPropre.corps.app_propre }));
  const lienPropre = await c.appel('/api/strava/lien?duree=longue');
  check('et le lien d’autorisation porte cet ID, valable un jour',
    lienPropre.statut === 200 && /client_id=424242/.test(lienPropre.corps.url ?? '') && typeof lienPropre.corps.expire_le === 'string'
      && Date.parse(lienPropre.corps.expire_le) - Date.now() > 20 * 3600 * 1000,
    `${lienPropre.statut} ${lienPropre.corps.expire_le ?? lienPropre.corps.erreur ?? ''}`);
  const appEffacee = await c.appel('/api/strava/app', { method: 'DELETE' });
  check('l’effacer ramène à l’application commune', appEffacee.statut === 200 && appEffacee.corps.propre === false);

  /* L'adresse de retour : le seul réglage que Strava juge chez lui. L'état la
     porte pour que l'écran puisse dire « redirect_uri invalid » AVANT le clic,
     et non strava.com après. En développement elle vaut localhost — accepté. */
  const rappel = etatPropre.corps.rappel;
  check('l’état porte l’adresse de retour et son verdict',
    typeof rappel?.url === 'string' && rappel.url.endsWith('/api/strava/callback')
      && typeof rappel.domaine === 'string' && rappel.souci === null,
    JSON.stringify(rappel));

  console.log('\n=== le back office ===');
  const refuseAdmin = await c.appel('/api/admin/comptes');
  check('les comptes sont refusés à un athlète', refuseAdmin.statut === 403, String(refuseAdmin.statut));
  await bd().execute("UPDATE compte SET role = 'admin' WHERE email = ?", [EMAIL]);
  const comptes = await c.appel('/api/admin/comptes');
  const moiAdmin = comptes.corps.comptes?.find((x: any) => x.email === EMAIL);
  check('… et listés à un admin, chacun avec ses athlètes',
    comptes.statut === 200 && moiAdmin?.role === 'admin'
      && moiAdmin.athletes.some((a: any) => a.id === 1 && a.droit === 'ecriture')
      && Array.isArray(comptes.corps.athletes),
    JSON.stringify(moiAdmin?.athletes));
  const court = await c.appel('/api/admin/comptes', {
    method: 'POST',
    body: JSON.stringify({ email: `cree-${EMAIL}`, nom: 'Créé', role: 'coach', mot_de_passe: 'court' }),
  });
  check('un mot de passe trop court est refusé', court.statut === 400, court.corps.erreur);
  const cree = await c.appel('/api/admin/comptes', {
    method: 'POST',
    body: JSON.stringify({
      email: `Cree-${EMAIL}`, nom: 'Créé', role: 'coach', mot_de_passe: MOT_DE_PASSE, athlete_id: 1, droit: 'lecture',
    }),
  });
  check('un compte se crée, relié à un athlète, l’email mis en minuscules',
    cree.statut === 200 && cree.corps.compte?.email === `cree-${EMAIL}` && cree.corps.compte.role === 'coach'
      && cree.corps.compte.athletes[0]?.id === 1 && cree.corps.compte.athletes[0]?.droit === 'lecture',
    JSON.stringify(cree.corps).slice(0, 120));
  const doublon = await c.appel('/api/admin/comptes', {
    method: 'POST',
    body: JSON.stringify({ email: `cree-${EMAIL}`, nom: 'Créé', role: 'coach', mot_de_passe: MOT_DE_PASSE }),
  });
  check('le même email une seconde fois : 409', doublon.statut === 409, doublon.corps.erreur);
  const creeId = cree.corps.compte?.id;
  const modif = await c.appel(`/api/admin/comptes/${creeId}`, {
    method: 'PUT', body: JSON.stringify({ role: 'athlete', actif: false, nom: 'Créé, puis renommé' }),
  });
  check('un compte se modifie : rôle, actif, nom',
    modif.statut === 200 && modif.corps.compte?.role === 'athlete' && modif.corps.compte.actif === false
      && modif.corps.compte.nom === 'Créé, puis renommé',
    JSON.stringify(modif.corps).slice(0, 120));
  const suicide = await c.appel(`/api/admin/comptes/${moiAdmin?.id}`, {
    method: 'PUT', body: JSON.stringify({ actif: false }),
  });
  check('un admin ne peut pas se désactiver lui-même', suicide.statut === 409, suicide.corps.erreur);
  const demission = await c.appel(`/api/admin/comptes/${moiAdmin?.id}`, {
    method: 'PUT', body: JSON.stringify({ role: 'athlete' }),
  });
  check('ni se retirer le rôle', demission.statut === 409, demission.corps.erreur);
  const mdp = await c.appel(`/api/admin/comptes/${creeId}`, {
    method: 'PUT', body: JSON.stringify({ mot_de_passe: `autre-${MOT_DE_PASSE}`, actif: true }),
  });
  check('un mot de passe se remplace', mdp.statut === 200 && mdp.corps.compte?.actif === true);
  const c3 = client();
  const ouvre = await c3.appel('/api/connexion', {
    method: 'POST', body: JSON.stringify({ email: `cree-${EMAIL}`, mot_de_passe: `autre-${MOT_DE_PASSE}` }),
  });
  check('… et il ouvre la porte', ouvre.statut === 200, ouvre.corps.erreur);
  const lecture = await c3.appel('/api/journal', {
    method: 'POST', body: JSON.stringify({ session_id: 1, date: '2026-10-20', note: 'x' }),
  });
  check('en lecture seule, comme demandé', lecture.statut === 403, String(lecture.statut));
  const horsPlage = await c.appel('/api/admin/athletes', {
    method: 'POST', body: JSON.stringify({ nom: 'Athlète créé du contrôle', actuelle: '1:30', cible: '1:20' }),
  });
  check('une allure hors plage est refusée', horsPlage.statut === 400, horsPlage.corps.erreur);
  const athlete = await c.appel('/api/admin/athletes', {
    method: 'POST',
    body: JSON.stringify({ nom: 'Athlète créé du contrôle', prenom: 'Contrôle', actuelle: '4:15', cible: '3:50', compte_id: creeId, droit: 'ecriture' }),
  });
  check('un athlète se crée (4:15 → 255 s/km), relié à un compte qui devient le sien',
    athlete.statut === 200 && athlete.corps.athlete?.ref_actuelle_s === 255 && athlete.corps.athlete.ref_cible_s === 230
      && athlete.corps.athlete.compte_id === creeId,
    JSON.stringify(athlete.corps).slice(0, 120));
  /* Un athlète et son compte d'un seul geste — tout ou rien. */
  const inscritRien = await c.appel('/api/admin/inscription', { method: 'POST', body: JSON.stringify({}) });
  check('une inscription sans athlète ni compte est refusée', inscritRien.statut === 400, inscritRien.corps.erreur);
  const inscritRate = await c.appel('/api/admin/inscription', {
    method: 'POST',
    body: JSON.stringify({
      athlete: { nom: 'Inscrit du contrôle', actuelle: '9:99', cible: '3:50' },
      compte: { email: `inscrit-${EMAIL}`, role: 'athlete', mot_de_passe: MOT_DE_PASSE },
    }),
  });
  const [[fantome]] = (await bd().execute('SELECT COUNT(*) AS n FROM compte WHERE email = ?', [`inscrit-${EMAIL}`])) as any;
  check('une allure fausse refuse le tout : pas de compte orphelin', inscritRate.statut === 400 && Number(fantome.n) === 0,
    `${inscritRate.corps.erreur} · comptes : ${fantome.n}`);
  const inscrit = await c.appel('/api/admin/inscription', {
    method: 'POST',
    body: JSON.stringify({
      athlete: { nom: 'Inscrit du contrôle', prenom: 'Léa', actuelle: '4:30', cible: '4:00' },
      compte: { email: `inscrit-${EMAIL}`, role: 'athlete', mot_de_passe: MOT_DE_PASSE },
      droit: 'ecriture',
    }),
  });
  check('un athlète et son compte se créent ensemble, reliés, le compte nommé d’après l’athlète',
    inscrit.statut === 200 && inscrit.corps.compte?.nom === 'Léa Inscrit du contrôle'
      && inscrit.corps.athlete?.compte_id === inscrit.corps.compte?.id
      && inscrit.corps.compte.athletes?.[0]?.id === inscrit.corps.athlete?.id
      && inscrit.corps.compte.athletes[0].droit === 'ecriture',
    JSON.stringify(inscrit.corps).slice(0, 160));
  const retireAcces = await c.appel('/api/admin/acces', {
    method: 'PUT', body: JSON.stringify({ compte_id: creeId, athlete_id: athlete.corps.athlete?.id, droit: null }),
  });
  check('un accès se retire', retireAcces.statut === 200 && retireAcces.corps.acces?.droit === null);

  /* Supprimer un athlète : on dit d'abord ce que ça détruit, le nom tapé doit
     correspondre, et tout part ensemble — le schéma cascade. */
  const aSupprimer = inscrit.corps.athlete?.id as number;
  const resume = await c.appel(`/api/admin/athletes/${aSupprimer}`);
  check('le résumé d’une suppression dit ce qu’elle emporterait, et qui le voit',
    resume.statut === 200 && resume.corps.athlete?.id === aSupprimer
      && typeof resume.corps.compte?.seances === 'number'
      && resume.corps.comptes?.some((x: any) => x.email === `inscrit-${EMAIL}` && x.seulement_lui === true),
    JSON.stringify({ compte: resume.corps.compte, comptes: resume.corps.comptes?.length }));
  const mauvaisNom = await c.appel(`/api/admin/athletes/${aSupprimer}`, {
    method: 'DELETE', body: JSON.stringify({ nom: 'pas le bon nom' }),
  });
  check('sans le nom exact, rien n’est supprimé', mauvaisNom.statut === 409, mauvaisNom.corps.erreur);
  const [[avantSuppression]] = (await bd().execute('SELECT COUNT(*) AS n FROM msc_athlete WHERE id = ?', [aSupprimer])) as any;
  const supprime = await c.appel(`/api/admin/athletes/${aSupprimer}`, {
    /* Les accents et la casse ne comptent pas : c'est le nom qu'on vérifie,
       pas la dactylographie. */
    method: 'DELETE', body: JSON.stringify({ nom: 'inscrit du controle', compte: true }),
  });
  const [[apresSuppression]] = (await bd().execute('SELECT COUNT(*) AS n FROM msc_athlete WHERE id = ?', [aSupprimer])) as any;
  const [[compteParti]] = (await bd().execute('SELECT COUNT(*) AS n FROM compte WHERE email = ?', [`inscrit-${EMAIL}`])) as any;
  check('le nom écrit à la main supprime l’athlète, et le compte qui ne voyait que lui',
    supprime.statut === 200 && Number(avantSuppression.n) === 1 && Number(apresSuppression.n) === 0
      && Number(compteParti.n) === 0,
    `${supprime.statut} · athlète ${avantSuppression.n}→${apresSuppression.n} · compte ${compteParti.n}`);
  const disparu = await c.appel(`/api/admin/athletes/${aSupprimer}`);
  check('et il n’existe plus', disparu.statut === 404, String(disparu.statut));
  const systeme = await c.appel('/api/admin/systeme');
  check('le système se décrit : version servie, clé, Strava, scellement, base, démo',
    systeme.statut === 200 && 'version' in systeme.corps && typeof systeme.corps.cle === 'boolean'
      && typeof systeme.corps.cle_illisible === 'boolean' && systeme.corps.base?.ok === true
      && Array.isArray(systeme.corps.demo?.athletes) && typeof systeme.corps.demo?.scannes === 'number',
    JSON.stringify({ version: systeme.corps.version, base: systeme.corps.base?.version }));
  /* Strava, athlète par athlète : l'admin voit tout le monde, un jeton nulle part. */
  const parAthlete = await c.appel('/api/admin/strava');
  const moiStrava = parAthlete.corps.athletes?.find((x: any) => x.id === 1);
  check('Strava se lit athlète par athlète : liaison, application, activités reçues',
    parAthlete.statut === 200 && typeof moiStrava?.strava?.lie === 'boolean'
      && typeof moiStrava.app?.propre === 'boolean' && typeof moiStrava.activites?.n === 'number'
      && !JSON.stringify(parAthlete.corps).includes('token'),
    JSON.stringify(moiStrava?.strava));
  const sansAthlete = await c.appel('/api/admin/demo', { method: 'POST', body: JSON.stringify({ plan: false }) });
  check('retirer la démonstration exige de nommer l’athlète', sansAthlete.statut === 400, sansAthlete.corps.erreur);
  /* L'inscription libre : un athlète crée son compte, et sa session s'ouvre.
     L'admin peut la fermer, ou la garder derrière un code — les deux se
     règlent dans msc_param, donc par l'API, cache compris. */
  console.log('\n=== l’inscription libre ===');
  const libre = client();
  const corpsLibre = { prenom: 'Léa', nom: 'Libre du contrôle', email: `Libre-${EMAIL}`, mot_de_passe: MOT_DE_PASSE, actuelle: '5:30', cible: '5:00' };
  const court2 = await libre.appel('/api/inscription', { method: 'POST', body: JSON.stringify({ ...corpsLibre, mot_de_passe: 'court' }) });
  check('un mot de passe trop court est refusé à l’inscription', court2.statut === 400, court2.corps.erreur);
  const inscrit2 = await libre.appel('/api/inscription', { method: 'POST', body: JSON.stringify(corpsLibre) });
  check('un athlète s’inscrit seul : son compte, son athlète, sa session',
    inscrit2.statut === 200 && inscrit2.corps.compte?.role === 'athlete' && inscrit2.corps.athletes?.[0]?.droit === 'ecriture'
      && inscrit2.corps.athlete?.ref_actuelle_s === 330 && /msc_session=/.test(libre.cookie),
    JSON.stringify(inscrit2.corps).slice(0, 140));
  const moiLibre = await libre.appel('/api/moi');
  check('… et « moi » le reconnaît aussitôt', moiLibre.statut === 200 && moiLibre.corps.compte?.email === `libre-${EMAIL}`);
  const doublon2 = await client().appel('/api/inscription', { method: 'POST', body: JSON.stringify(corpsLibre) });
  check('le même email une seconde fois : 409', doublon2.statut === 409, doublon2.corps.erreur);
  const fermer = await c.appel('/api/param', { method: 'PUT', body: JSON.stringify({ cle: 'securite.inscription_ouverte', valeur: false }) });
  const ferme = await client().appel('/api/inscription', { method: 'POST', body: JSON.stringify({ ...corpsLibre, email: `libre2-${EMAIL}` }) });
  check('inscriptions fermées par l’admin : 403', fermer.statut === 200 && ferme.statut === 403, ferme.corps.erreur);
  await c.appel('/api/param', { method: 'PUT', body: JSON.stringify({ cle: 'securite.inscription_ouverte', valeur: null }) });
  const codePose = await c.appel('/api/param', { method: 'PUT', body: JSON.stringify({ cle: 'securite.code_invitation', valeur: 'CLUB-2026' }) });
  const sansCode = await client().appel('/api/inscription', { method: 'POST', body: JSON.stringify({ ...corpsLibre, email: `libre2-${EMAIL}` }) });
  const avecCode = await client().appel('/api/inscription', { method: 'POST', body: JSON.stringify({ ...corpsLibre, email: `libre2-${EMAIL}`, code: 'CLUB-2026' }) });
  check('un code d’invitation posé est exigé, et suffit',
    codePose.statut === 200 && sansCode.statut === 403 && avecCode.statut === 200, `${sansCode.statut} / ${avecCode.statut} ${sansCode.corps.erreur ?? ''}`);

  /* Les modèles : la même matrice, rangée sous un nom et sans athlète, pour la
     reposer sur le suivant. Les poser ne touche à personne — c'est la semaine
     type qui écrit chez l'athlète. */
  const modeleEcrit = await c.appel('/api/modeles', {
    method: 'POST',
    body: JSON.stringify({ nom: '  Contrôle  ', creneaux: [
      { jour: 0, creneau: 1, discipline: 'Hyrox', type_code: 'force', duree_min: 70 },
      { jour: 3, creneau: 1, discipline: 'Course à pied', type_code: 'vma', duree_min: 55 },
      { jour: 5, creneau: 1, discipline: 'Repos', type_code: 'repos', duree_min: 0 },
    ] }),
  });
  check('un modèle s’enregistre sous son nom, sans le repos',
    modeleEcrit.statut === 200 && modeleEcrit.corps.nom === 'Contrôle' && modeleEcrit.corps.creneaux === 2,
    JSON.stringify(modeleEcrit.corps));
  const catalogue = await c.appel('/api/modeles');
  const leModele = (catalogue.corps.modeles ?? []).find((m: any) => m.nom === 'Contrôle');
  check('et il se relit avec ses créneaux, prêt à être reposé ailleurs',
    catalogue.statut === 200 && leModele?.creneaux?.length === 2
      && leModele.creneaux[0].jour === 0 && leModele.creneaux[1].type_code === 'vma',
    JSON.stringify(leModele));
  const structureIntacte = (await c.appel('/api/db/instantane')).corps.msc_structure ?? [];
  check('enregistrer un modèle n’écrit rien chez l’athlète',
    structureIntacte.length === 0, JSON.stringify(structureIntacte));
  const modeleVide = await c.appel('/api/modeles', {
    method: 'POST', body: JSON.stringify({ nom: 'Vide', creneaux: [] }),
  });
  check('un modèle sans créneau est refusé', modeleVide.statut === 400, String(modeleVide.statut));
  const modeleSansNom = await c.appel('/api/modeles', {
    method: 'POST', body: JSON.stringify({ nom: '   ', creneaux: [
      { jour: 0, creneau: 1, discipline: 'Hyrox', type_code: 'force', duree_min: 70 },
    ] }),
  });
  check('et un modèle sans nom aussi', modeleSansNom.statut === 400, String(modeleSansNom.statut));
  await c.appel('/api/modeles?nom=Contr%C3%B4le', { method: 'DELETE' });
  const catalogueApres = await c.appel('/api/modeles');
  check('supprimer un modèle le retire du catalogue',
    !(catalogueApres.corps.modeles ?? []).some((m: any) => m.nom === 'Contrôle'),
    JSON.stringify(catalogueApres.corps.modeles));

  await c.appel('/api/param', { method: 'PUT', body: JSON.stringify({ cle: 'securite.code_invitation', valeur: null }) });
  await bd().execute("UPDATE compte SET role = 'athlete' WHERE email = ?", [EMAIL]);
  const redevenu = await c.appel('/api/admin/systeme');
  check('redevenu athlète, la porte se referme', redevenu.statut === 403);

  console.log('\n=== ce qui ne m’appartient pas ===');
  const autre = await c.appel(`/api/db/instantane?athlete=${a2.insertId}`);
  check('un athlète que je ne vois pas m’est refusé', autre.statut === 403, String(autre.statut));

  const inexistant = await c.appel('/api/db/instantane?athlete=999999');
  check('un athlète qui n’existe pas aussi', inexistant.statut === 403);

  const sain = c.cookie;
  c.cookie = `${sain.slice(0, -2)}xy`;
  const trafique = await c.appel('/api/db/instantane');
  check('un cookie dont la signature est trafiquée est rejeté', trafique.statut === 401,
    String(trafique.statut));
  c.cookie = sain;

  const deco = await c.appel('/api/deconnexion', { method: 'POST' });
  check('la déconnexion vide le cookie', deco.statut === 200 && c.cookie === 'msc_session=');
  const apresDeco = await c.appel('/api/db/instantane');
  check('et l’instantané redevient inaccessible', apresDeco.statut === 401);

  console.log('\n=== ce qui n’existe pas ===');
  const rien = await c.appel('/api/nimporte-quoi');
  check('une route d’API inconnue répond 404 en JSON', rien.statut === 404 && Boolean(rien.corps.erreur));

  console.log('\n=== la posture de production ===');

  /* La porte de service du développement doit être condamnée en production, et
     le cookie de session doit porter Secure. Les deux se vérifient en lançant
     un second serveur, parce que ce sont des propriétés du démarrage. */
  const prod = spawn(process.execPath, ['server/index.mjs'], {
    /* MSC_SANS_TLS vidé explicitement : hérité d'un .env, il lèverait le
       drapeau que la ligne suivante prétend vérifier, et le contrôle passerait
       en ne contrôlant rien. */
    env: { ...process.env, PORT: String(PORT + 1), NODE_ENV: 'production',
           MSC_ATHLETE_ID: '1', MSC_SANS_TLS: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    const baseProd = `http://127.0.0.1:${PORT + 1}`;
    for (let i = 0; i < 100; i += 1) {
      try { if ((await fetch(`${baseProd}/api/sante`)).ok) break; } catch { /* pas encore */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    const bypass = await fetch(`${baseProd}/api/db/instantane`);
    check('MSC_ATHLETE_ID est refusé en production', bypass.status === 500,
      String(bypass.status));

    const cx = await fetch(`${baseProd}/api/connexion`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, mot_de_passe: MOT_DE_PASSE }),
    });
    const pose = cx.headers.get('set-cookie') ?? '';
    check('le cookie de session est Secure en production', /Secure/.test(pose), pose.slice(-40));
    check('et HttpOnly, et SameSite', /HttpOnly/.test(pose) && /SameSite=Lax/.test(pose));

    /* La PWA construite est servie par le même processus : même origine, donc
       pas de CORS et un service worker qui contrôle vraiment la page. */
    const page = await fetch(`${baseProd}/`);
    check('la PWA est servie à la racine',
      page.ok && (page.headers.get('content-type') ?? '').includes('text/html'),
      String(page.status));
    check('index.html n’est pas mis en cache',
      (page.headers.get('cache-control') ?? '').includes('no-cache'),
      page.headers.get('cache-control') ?? '');

    const evasion = await fetch(`${baseProd}/../../../../etc/passwd`);
    const corpsEvasion = await evasion.text();
    check('une traversée de répertoire ne sort pas de dist',
      !corpsEvasion.includes('root:'), corpsEvasion.slice(0, 24));
  } finally {
    prod.kill('SIGTERM');
  }
} finally {
  serveur.kill('SIGTERM');
  await bd().execute('DELETE FROM msc_journal WHERE date IN (?, ?)', ['2026-10-20', '2026-10-21']);
  await bd().execute('DELETE FROM msc_journal WHERE athlete_id = 1 AND session_id = ?',
    [msc_session.find((s) => s.type !== 'repos')!.id]);
  await bd().execute("DELETE FROM msc_activity WHERE athlete_id = 1 AND manuelle = 1 AND nom = 'contrôle'");
  await bd().execute('DELETE FROM msc_mesure WHERE date = ?', ['2030-02-02']);
  /* Les photos que ce contrôle a envoyées, et rien d'autre : celles auxquelles
     plus aucune mesure ne renvoie. */
  await bd().execute(
    `DELETE FROM msc_photo WHERE athlete_id = 1
       AND id NOT IN (SELECT photo_id FROM msc_mesure WHERE photo_id IS NOT NULL)`,
  );
  await bd().execute('DELETE FROM msc_mesure WHERE date = ?', ['2026-10-20']);
  await bd().execute('DELETE FROM msc_mutation WHERE id IN (?, ?)', [
    '00000000-0000-4000-8000-00000000cafe', '00000000-0000-4000-8000-0000000dbeef',
  ]);
  await bd().execute('DELETE FROM compte WHERE email IN (?, ?, ?, ?, ?, ?)',
    [EMAIL, `autre-${EMAIL}`, `cree-${EMAIL}`, `inscrit-${EMAIL}`, `libre-${EMAIL}`, `libre2-${EMAIL}`]);
  await bd().execute('DELETE FROM msc_athlete WHERE nom IN (?, ?, ?, ?)',
    ['Athlète du contrôle', 'Athlète créé du contrôle', 'Inscrit du contrôle', 'Libre du contrôle']);
  await bd().execute("UPDATE msc_param SET valeur = NULL, scelle = NULL WHERE cle IN ('securite.inscription_ouverte', 'securite.code_invitation')");
  await fermer();
}

if (fails > 0) console.log(`\n--- journal du serveur ---\n${journalServeur.slice(-1500)}`);
console.log(fails === 0 ? '\nOK' : `\n${fails} ÉCHECS`);
process.exit(fails === 0 ? 0 : 1);
