/* Exerce l'API par HTTP, contre une vraie base.

   Les dépôts se testent bien en les appelant directement, et c'est justement ce
   qu'il ne faut pas faire : ce qui casse une API, ce sont les couches qu'un
   appel direct saute — le cookie, le contrôle d'accès, la forme JSON, le code
   de retour. Ce script lance donc le serveur et lui parle comme le navigateur
   lui parlera.

   Il faut une base migrée et semée, et MSC_SECRET_KEY :
     npm run db:migrate && npm run db:seed && npm run check:api */

import { spawn } from 'node:child_process';
import { msc_session } from '../src/data/plan.generated';
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
await bd().execute('DELETE FROM compte WHERE email IN (?, ?)', [EMAIL, `autre-${EMAIL}`]);
await bd().execute('DELETE FROM msc_athlete WHERE nom = ?', ['Athlète du contrôle']);

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
  const inst = await c.appel('/api/db/instantane');
  check('il répond une fois connecté', inst.statut === 200, String(inst.statut));
  const base = inst.corps;
  check('les 243 séances sont là', base.msc_session?.length === msc_session.length,
    `${base.msc_session?.length}`);
  check('les huit zones, dans l’ordre', base.msc_zone?.length === 8 &&
    base.msc_zone[0].code === 'recup' && base.msc_zone[7].code === 'vma');
  check('les libellés sont en deux langues',
    Boolean(base.msc_ui?.fr?.anaIdle && base.msc_ui?.pl?.anaIdle));

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
    env: { ...process.env, PORT: String(PORT + 1), NODE_ENV: 'production', MSC_ATHLETE_ID: '1' },
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
  await bd().execute('DELETE FROM compte WHERE email IN (?, ?)', [EMAIL, `autre-${EMAIL}`]);
  await bd().execute('DELETE FROM msc_athlete WHERE nom = ?', ['Athlète du contrôle']);
  await fermer();
}

if (fails > 0) console.log(`\n--- journal du serveur ---\n${journalServeur.slice(-1500)}`);
console.log(fails === 0 ? '\nOK' : `\n${fails} ÉCHECS`);
process.exit(fails === 0 ? 0 : 1);
