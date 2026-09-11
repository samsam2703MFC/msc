/* Ouvre l'application dans un vrai navigateur et s'en sert.

   C'est le seul contrôle qui exerce le client. Les autres prouvent que le
   moteur calcule juste, que la base garde ce qu'on lui donne et que l'API
   répond — aucun ne dirait que l'écran de connexion s'affiche, que le plan
   arrive derrière, ou qu'un mot de passe raté ne vide pas le formulaire. Il a
   trouvé ces deux-là en étant écrit.

   Il lui faut une base migrée et semée, et un build :
     npm run db:migrate && npm run db:seed && npm run build && npm run check:app */

import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { hacher } from '../server/auth.mjs';
import { bd, fermer } from '../server/bd.mjs';

const PORT = Number(process.env.MSC_CHECK_PORT ?? 8898);
const URL = `http://127.0.0.1:${PORT}`;
const EMAIL = 'navigateur@mysmartcoach.local';
const MOT_DE_PASSE = 'un-mot-de-passe-de-controle';

let fails = 0;
const check = (nom, ok, detail = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${nom}${detail ? '  — ' + detail : ''}`);
};

/* Le matin est un parcours : le signal, la séance d'hier restée sans réponse,
   celle du jour et le mot du coach, puis « Entrer ». Le contrôle le traverse
   comme l'athlète — d'un bout à l'autre, sans sauter d'étape. */
async function traverserLeMatin(page, fc = '44', hrv = '68') {
  const sheet = page.getByRole('dialog');
  if (!(await sheet.count())) return;
  const champs = sheet.locator('input[inputmode="decimal"]');
  if (await champs.count()) {
    await champs.nth(0).fill(fc);
    await champs.nth(1).fill(hrv);
    await sheet.locator('button[type=submit]').click();
    await page.waitForTimeout(1800);
  }
  /* Les étapes suivantes se passent : « Continuer » jusqu'au bout, puis
     « Entrer ». Six tours suffisent — il y en a trois au plus. */
  for (let i = 0; i < 6 && (await page.getByRole('dialog').count()); i += 1) {
    const entrer = page.getByRole('dialog').getByRole('button', { name: /^Entrer$/ });
    if (await entrer.count()) { await entrer.click(); await page.waitForTimeout(900); break; }
    const continuer = page.getByRole('dialog').getByRole('button', { name: /^Continuer$/ });
    if (!(await continuer.count())) break;
    await continuer.click();
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(400);
}

/* Deux tailles, deux applications. Le téléphone est celle de l'athlète —
   cinq onglets, une main, et aucun accès au back office. Le back office est
   le bureau : à partir de 1024 px, un menu à gauche. Le contrôle passe de
   l'une à l'autre comme l'utilisateur change d'appareil. */
const BUREAU = { width: 1280, height: 900 };
const TELEPHONE = { width: 420, height: 900 };

async function redimensionner(page, taille) {
  const actuelle = page.viewportSize();
  if (actuelle && actuelle.width === taille.width) return;
  await page.setViewportSize(taille);
  await page.waitForTimeout(700);
}

/* Les onglets de l'athlète se prennent dans la barre du bas : « Coach »
   apparaît aussi au milieu des cartes, et `text=Coach` tomberait dessus. */
async function ouvrirOnglet(page, nom) {
  await redimensionner(page, TELEPHONE);
  await page.locator('nav button').filter({ hasText: nom }).first().click();
  await page.waitForTimeout(700);
}

/* Le back office a deux niveaux, et ces deux fonctions sont le chemin : une
   section du menu (ce qui vaut pour le club ou pour l'application), ou la
   fiche d'un athlète (tout ce qui lui appartient, sous son nom).

   Le contrôle les emprunte comme un humain, plutôt que de cliquer un onglet
   qui n'existe qu'ici : si le plan du back office change encore, c'est ici
   que ça se voit, en deux fonctions et pas en douze clics. */
async function ouvrirSection(page, nom) {
  await redimensionner(page, BUREAU);
  const menu = page.getByRole('navigation', { name: 'Back office' });
  await menu.getByRole('button', { name: nom, ...(typeof nom === 'string' ? { exact: true } : {}) }).first().click();
  await page.waitForTimeout(900);
}

/* Et « Moi » : le cinquième onglet de l'application, où l'athlète tient ce qui
   est à lui — son plan, ses starts, son profil, sa Strava. Rien à voir avec le
   back office : c'est son application, pas celle du club. */
async function ouvrirMoi(page, chip) {
  await redimensionner(page, TELEPHONE);
  await page.locator('nav button').last().click();
  await page.waitForTimeout(700);
  await page.getByRole('tab', { name: chip, exact: true }).first().click();
  await page.waitForTimeout(900);
}

async function ouvrirFiche(page, onglet) {
  /* Le compte qui ne voit que lui n'a pas de liste à traverser : sa section
     s'appelle « Mon entraînement » et s'ouvre directement sur sa fiche. */
  await ouvrirSection(page, /^(Athlètes|Mon entraînement)$/);
  /* Le bouton porte le nom de l'athlète dans son aria-label : « Ouvrir Léa
     Martin ». On vise le début, pas l'égalité. */
  const ouvrir = page.getByRole('button', { name: /^Ouvrir\b/ }).first();
  if (await ouvrir.count()) {
    await ouvrir.click();
    await page.waitForTimeout(1200);
  }
  await page.getByRole('tab', { name: onglet, exact: true }).click();
  await page.waitForTimeout(900);
}

/* Un compte qui voit l'athlète 1 — celui que le seed installe. */
await bd().execute('DELETE FROM compte WHERE email IN (?, ?)', [EMAIL, `libre-${EMAIL}`]);
await bd().execute('DELETE FROM msc_athlete WHERE nom = ?', ['Libre du navigateur']);
const [c] = await bd().execute(
  'INSERT INTO compte (email, mot_de_passe, nom, role) VALUES (?, ?, ?, ?)',
  [EMAIL, hacher(MOT_DE_PASSE), 'Navigateur', 'athlete'],
);
await bd().execute(
  "INSERT INTO msc_acces (compte_id, athlete_id, droit) VALUES (?, 1, 'ecriture')",
  [c.insertId],
);

/* La semaine type de l'athlète 1 : l'écran Semaine la met en tête, et elle
   n'existe que si quelqu'un l'a posée. Le contrôle la pose donc lui-même —
   sinon il n'exercerait la carte qu'un jour sur deux, selon ce que le contrôle
   d'avant a laissé. */
await bd().execute('DELETE FROM msc_structure WHERE athlete_id = 1');
for (const [jour, creneau, discipline, type, duree] of [
  [1, 1, 'Natation', 'nage', 55],
  [2, 1, 'Course à pied', 'seuil', 60],
  [4, 2, 'Course à pied', 'recup', 45],
  [5, 1, 'Course à pied', 'longue', 75],
]) {
  await bd().execute(
    `INSERT INTO msc_structure (athlete_id, jour, creneau, discipline, type_code, duree_min)
     VALUES (1, ?, ?, ?, ?, ?)`,
    [jour, creneau, discipline, type, duree],
  );
}

/* Ce contrôle encode des courses ; il doit partir d'une table propre, sinon
   « un seul résultat » n'est vrai qu'à la première exécution. */
await bd().execute("DELETE FROM msc_competition WHERE nom LIKE '%de contrôle'");
/* Et il passe par le panneau du matin : la mesure saisie du jour, s'il y en a
   une d'une exécution précédente, doit s'effacer pour que le panneau revienne. */
await bd().execute(
  "DELETE FROM msc_mesure WHERE athlete_id = 1 AND date = CURDATE() AND source = 'saisie'",
);

const serveur = spawn(process.execPath, ['server/index.mjs'], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: 'test', MSC_ATHLETE_ID: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let journal = '';
serveur.stdout.on('data', (d) => { journal += d; });
serveur.stderr.on('data', (d) => { journal += d; });

let nav;
try {
  for (let i = 0; i < 100; i += 1) {
    try { if ((await fetch(`${URL}/api/sante`)).ok) break; } catch { /* pas encore */ }
    await new Promise((r) => setTimeout(r, 100));
  }

  nav = await chromium.launch(
    process.env.MSC_CHROMIUM ? { executablePath: process.env.MSC_CHROMIUM } : {},
  );
  const page = await nav.newPage({ viewport: { width: 420, height: 900 } });

  const erreurs = [];
  /* Pendant la coupure volontaire, les échecs réseau sont ce qu'on teste. */
  let coupe = false;
  /* Le texte d'une erreur de console ne porte pas l'URL — « Failed to load
     resource » et rien de plus. On écoute donc les requêtes, où elle est. */
  page.on('pageerror', (e) => erreurs.push(`exception : ${e}`));
  page.on('requestfailed', (r) => {
    if (coupe) return;
    /* Les polices viennent d'un CDN : une machine sans sortie internet n'y
       accède pas, et ce n'est pas un défaut de l'application. */
    if (/fonts\.(googleapis|gstatic)\.com/.test(r.url())) return;
    /* Une requête coupée par notre propre rechargement (version.txt en vol
       quand on recharge) n'est pas un défaut de l'application. */
    if (/ERR_ABORTED/.test(r.failure()?.errorText ?? '')) return;
    erreurs.push(`échec : ${r.url()} ${r.failure()?.errorText ?? ''}`);
  });
  page.on('response', (r) => {
    /* Le 401 sur /api/moi EST le chemin « pas encore connecté », et celui sur
       /api/connexion est le mauvais mot de passe qu'on envoie exprès. */
    if (r.status() === 401 && /\/api\/(moi|connexion)$/.test(r.url())) return;
    if (r.status() >= 400) erreurs.push(`HTTP ${r.status()} ${r.url()}`);
  });

  await page.goto(URL, { waitUntil: 'networkidle' });

  console.log('=== avant la connexion ===');
  check("l'écran de connexion s'affiche", await page.getByText('Connecte-toi').isVisible());
  check('le plan n’est pas visible', (await page.locator('nav').count()) === 0);

  console.log('\n=== un mot de passe raté ===');
  await page.fill('input[type=email]', EMAIL);
  await page.fill('input[type=password]', 'ce n’est pas le bon');
  await page.click('button[type=submit]');
  await page.waitForSelector('[role=alert]', { timeout: 10000 });
  check('il est refusé et le dit',
    await page.getByRole('alert').isVisible(),
    (await page.getByRole('alert').textContent()) ?? '');
  /* Le formulaire ne doit pas se démonter pendant la tentative : sinon les deux
     champs se vident et il faut retaper l'adresse à chaque essai. */
  check('l’adresse survit à l’échec',
    (await page.inputValue('input[type=email]')) === EMAIL);

  /* L'inscription libre : un athlète qui installe l'application crée son
     compte ici même, et entre. Puis il ressort, pour laisser la place au
     compte de contrôle. */
  console.log('\n=== s’inscrire ===');
  await page.click('text=Créer mon compte');
  await page.waitForTimeout(400);
  await page.getByLabel('Prénom', { exact: true }).fill('Léa');
  await page.getByLabel('Nom', { exact: true }).fill('Libre du navigateur');
  await page.fill('input[type=email]', `libre-${EMAIL}`);
  await page.fill('input[type=password]', MOT_DE_PASSE);
  await page.getByRole('button', { name: 'Créer mon compte' }).click();
  await page.waitForSelector('nav', { timeout: 20000 });
  /* Le premier matin : deux chiffres avant d'entrer, comme pour tout le
     monde. */
  await page.getByRole('dialog').waitFor({ timeout: 10000 });
  await traverserLeMatin(page, '52', '60');
  const inscritTexte = await page.locator('body').innerText();
  check('un athlète crée son compte depuis l’écran de connexion, et entre',
    (await page.locator('nav').count()) === 1 && /Aujourd'hui/.test(inscritTexte),
    inscritTexte.split('\n').slice(0, 3).join(' · '));
  const [[cree]] = await bd().execute(
    `SELECT c.role, a.ref_actuelle_s, x.droit FROM compte c
       JOIN msc_acces x ON x.compte_id = c.id JOIN msc_athlete a ON a.id = x.athlete_id
     WHERE c.email = ?`, [`libre-${EMAIL}`],
  );
  check('avec son athlète en écriture, aux allures saisies',
    cree?.role === 'athlete' && Number(cree?.ref_actuelle_s) === 330 && cree?.droit === 'ecriture', JSON.stringify(cree));
  await page.click('[aria-label="Mon application"]');
  await page.waitForTimeout(500);
  await page.click('text=Déconnexion');
  await page.waitForTimeout(900);
  check('et ressort par la même porte', await page.getByText('Connecte-toi').isVisible());

  console.log('\n=== le bon ===');
  /* L'écran s'est remonté après la déconnexion : l'adresse est à retaper. */
  await page.fill('input[type=email]', EMAIL);
  await page.fill('input[type=password]', MOT_DE_PASSE);
  await page.click('button[type=submit]');
  await page.waitForSelector('nav', { timeout: 20000 });
  check("l'application s'ouvre", await page.locator('nav').isVisible());

  /* La PWA : le manifeste avec ses deux sortes d'icônes, le service worker
     enregistré — 127.0.0.1 est un contexte sûr, comme HTTPS le sera. */
  console.log('\n=== la PWA ===');
  const manifeste = await (await fetch(`${URL}/manifest.webmanifest`)).json().catch(() => null);
  check('le manifeste est servi', Boolean(manifeste?.name === 'MySmartCoach' && manifeste.display === 'standalone'));
  check('avec une icône « any » et une « maskable » de 512',
    ['any', 'maskable'].every((p) => manifeste?.icons?.some((i) => i.purpose === p && i.sizes === '512x512')),
    JSON.stringify(manifeste?.icons?.map((i) => `${i.sizes} ${i.purpose}`)));
  const version = await (await fetch(`${URL}/version.txt`)).text().catch(() => '');
  check('la version du build est servie (commit · heure)', /^[0-9a-f]{7}|^dev/.test(version.trim()), version.trim());
  for (const f of ['icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png', 'icon.svg', 'sw.js']) {
    const r = await fetch(`${URL}/${f}`);
    check(`${f} est servi`, r.ok, String(r.status));
  }
  const sw = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return 'absent';
    const r = await Promise.race([
      navigator.serviceWorker.ready.then((x) => (x.active ? 'actif' : 'enregistré')),
      new Promise((res) => setTimeout(() => res('pas prêt'), 8000)),
    ]);
    return r;
  });
  check('le service worker est enregistré et actif', sw === 'actif', String(sw));

  /* Le matin : la FC de repos et la HRV avant tout le reste. Le panneau bloque,
     le bouton ne part pas sans les deux, et il disparaît une fois la mesure
     rangée — y compris après un rechargement, puisqu'elle est en base. */
  console.log('\n=== le matin ===');
  const matin = page.getByRole('dialog');
  await matin.waitFor({ timeout: 10000 });
  check('le parcours du matin bloque l’entrée', (await matin.count()) === 1);
  const suite = matin.locator('button[type=submit]');
  check('sans les deux chiffres, il ne part pas', await suite.isDisabled());
  await matin.locator('input[inputmode="decimal"]').nth(0).fill('44');
  check('avec la FC seule non plus', await suite.isDisabled());
  await matin.locator('input[inputmode="decimal"]').nth(1).fill('68');
  check('avec les deux, il part', !(await suite.isDisabled()));
  await suite.click();
  await page.waitForTimeout(1800);
  const apresSignal = await page.getByRole('dialog').innerText();
  check('le signal enchaîne sur la suite du parcours, il ne referme pas tout',
    /Étape 2/.test(apresSignal) && /(Et hier|Aujourd’hui)/.test(apresSignal),
    apresSignal.split('\n').slice(0, 3).join(' · '));
  check('et la séance du jour y est, avec le mot du coach à demander',
    /Demander au coach/.test(apresSignal) || /Et hier/.test(apresSignal));
  await traverserLeMatin(page);
  check('« Entrer » ferme le parcours', (await page.getByRole('dialog').count()) === 0);

  const aujourdhui = await page.locator('body').innerText();
  check('le plan vient de la base', /S\d+/.test(aujourdhui),
    aujourdhui.split('\n').slice(0, 2).join(' · '));
  /* Hier n'existe pas avant le deuxième jour d'un plan : sur une base où le
     plan commence aujourd'hui (ou plus tard — la date se cale sur son
     premier jour), la carte n'a rien à montrer et c'est juste. */
  check('et la séance d’hier est là, avec son état — ou le plan commence',
    (/\bhier\b/i.test(aujourdhui) && /(faite|autrement|manquée|repos|adaptée)/i.test(aujourdhui)) || /S1\b/.test(aujourdhui),
    aujourdhui.split('\n').find((l) => /hier/i.test(l)) ?? 'S1');

  console.log('\n=== les écrans ===');
  await ouvrirOnglet(page, 'Semaine');
  const semaine = await page.locator('body').innerText();
  check('la semaine montre des séances',
    /Natation|Course|Hyrox|Vélo|Repos/.test(semaine));
  check('et le plan sur l’année, en tête', /le plan sur l’année · \d+ semaines/i.test(semaine));
  check('et dit ce que veulent dire ses trois couleurs', /faite/.test(semaine) && /autrement/.test(semaine) && /manquée/.test(semaine));
  /* La semaine réelle porte la semaine type : sept jours, le sport de chaque
     créneau, et une phrase qui dit si la semaine s'y tient. */
  check('la semaine porte la semaine type de l’athlète, et dit ce qui s’en écarte',
    /Ma semaine type/i.test(semaine)
      && /(suit ta semaine type|s’écarte|s’écartent)/.test(semaine),
    semaine.split('\n').find((l) => /semaine type|écarte/.test(l))?.slice(0, 90) ?? '');

  /* Les allures ne sont pas en base : si la fiche d'une séance de course en
     affiche, c'est que le moteur les a calculées depuis la référence du bloc.
     Elles sont dans la fiche, et plus en grille sur la semaine : une liste
     d'allures qu'aucune séance ne demande n'aide personne à courir. */
  const [[course]] = await bd().execute(
    `SELECT s.titre_court_fr AS titre FROM msc_session s JOIN msc_plan p ON p.id = s.plan_id
     WHERE p.athlete_id = 1 AND p.actif = 1 AND s.discipline = 'Course à pied'
       AND s.semaine = (SELECT s2.semaine FROM msc_session s2 JOIN msc_plan p2 ON p2.id = s2.plan_id
                        WHERE p2.athlete_id = 1 AND p2.actif = 1
                        ORDER BY ABS(DATEDIFF(s2.date, CURDATE())), s2.ordre LIMIT 1)
     ORDER BY s.date LIMIT 1`,
  );
  await page.locator('button.msc-hover-surface').filter({ hasText: course.titre }).first().click();
  await page.waitForTimeout(900);
  const ficheCourse = await page.locator('body').innerText();
  check('et la fiche d’une séance de course porte les allures que le moteur calcule',
    /\d+:\d\d\/km/.test(ficheCourse),
    ficheCourse.match(/\d+:\d\d\/km/g)?.slice(0, 3).join(' ') ?? '');
  await page.getByRole('button', { name: /^Fermer$/ }).last().click();
  await page.waitForTimeout(500);

  /* Le bilan d'une séance passée : les deux voies, et la bonne question sous
     chacune. « Pas faite » demande pourquoi ; « faite » ouvre Strava et le
     ressenti. C'est le geste de l'athlète le dimanche soir. */
  await page.locator('button.msc-hover-surface').nth(1).click();
  await page.waitForTimeout(900);
  const fiche = await page.locator('body').innerText();
  check('une séance passée s’ouvre sur son bilan, en deux voies',
    /Comment ça s’est passé/.test(fiche) && /Je l’ai faite/.test(fiche) && /Pas faite/.test(fiche),
    fiche.split('\n').find((l) => /Comment ça/.test(l)) ?? '');
  const pasFaite = page.getByRole('button', { name: /^Pas faite$/ });
  if (await pasFaite.getAttribute('aria-pressed') !== 'true') {
    await pasFaite.click();
    await page.waitForTimeout(1200);
  }
  const sautee = await page.locator('body').innerText();
  check('« pas faite » demande pourquoi, dans un vocabulaire fermé',
    /Pourquoi \?/.test(sautee) && /Pas envie/.test(sautee) && /Pas le temps/.test(sautee));
  await page.getByRole('button', { name: /Je l’ai faite/ }).click();
  await page.waitForTimeout(1200);
  const faite = await page.locator('body').innerText();
  check('« faite » ouvre Strava, le ressenti et ce qui a bloqué',
    /Strava/.test(faite) && /Ton ressenti/.test(faite) && /Quelque chose a bloqué/.test(faite)
      && !/Pourquoi \?/.test(faite));
  await page.getByRole('button', { name: /^Fermer$/ }).last().click();
  await page.waitForTimeout(500);

  /* La forme et le coach ne font qu'un écran : une seule question — où j'en
     suis, et qu'est-ce que j'en fais. */
  await ouvrirOnglet(page, 'Coach');
  const ecranForme = await page.locator('body').innerText();
  check('une métrique sans données le dit au lieu d’inventer un chiffre',
    /Pas encore assez de données|—/.test(ecranForme));
  check('les deux courbes de forme sont là : base endurance et récupération HRV',
    /Base endurance/.test(ecranForme) && /Récupération · HRV/.test(ecranForme));

  /* La photo, de bout en bout, dans le navigateur : l'entrée fichier est
     cachée derrière un bouton, la carte de proposition apparaît, l'athlète
     corrige, et la mesure rejoint la série. Sans clé Anthropic la lecture
     échoue — c'est le chemin dégradé, et c'est celui qu'il faut voir marcher. */
  console.log('\n=== la photo ===');
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAABlBMVEX///+/v7+jQ3Y5AAAADklEQVQI12P4AIX8EAgALgAD/aNpbtEAAAAASUVORK5CYII=',
    'base64',
  );
  await page.setInputFiles('input[type=file]', {
    name: 'balance.png', mimeType: 'image/png', buffer: png,
  });
  await page.waitForSelector('text=Lu sur la photo', { timeout: 30000 });
  check('la proposition apparaît après l’envoi', true);
  check('la photo envoyée est affichée en vignette',
    await page.locator('img[src*="/api/photo/"]').isVisible());

  const champs = page.locator('input[inputmode]');
  await champs.nth(0).fill('74,5');
  await champs.nth(1).fill('46');
  await page.click('text=Confirmer');
  await page.waitForTimeout(1500);
  const forme = await page.locator('body').innerText();
  check('une fois confirmée, elle s’affiche comme la mesure du jour',
    forme.includes('74.5 kg') || forme.includes('74,5 kg'),
    forme.split('\n').find((l) => /kg/.test(l)) ?? '');
  check('et la carte de proposition a disparu', !forme.includes('Lu sur la photo'));

  check('les sept prochains jours attendent le signal du matin',
    /7 prochains jours/i.test(await page.locator('body').innerText())
      && (await page.getByRole('button', { name: /Replanifier/ }).count()) === 1);
  check("l'écart de la semaine est calculé",
    /réalisation|Semaine tenue|Écart détecté/i.test(await page.locator('body').innerText()));

  /* Dupki : le club et le niveau de chacun. C'est le seul écran du téléphone
     qui parle des autres, et il ne dit d'eux qu'un nom et des scores. */
  await ouvrirOnglet(page, 'Dupki');
  const dupki = await page.locator('body').innerText();
  check('Dupki montre le club et le niveau de chacun',
    /Niveaux de combat/i.test(dupki) && /Endurance/.test(dupki) && /puissance/i.test(dupki),
    dupki.split('\n').find((l) => /Niveaux de combat/i.test(l)) ?? '');
  check('et la barre du bas porte les cinq onglets de l’athlète, sans back office',
    (await page.locator('nav button').count()) === 5
      && /Dupki/.test(await page.locator('nav').innerText())
      && (await page.getByRole('button', { name: /^Back office$/ }).count()) === 0,
    (await page.locator('nav').innerText()).replace(/\n/g, ' · '));

  /* Le coach modifie un entraînement ; l'athlète a son téléphone ouvert. Il
     doit le voir sans rien recharger. On change la séance en base, on simule
     le retour à l'écran — ce que fait le navigateur quand on revient sur
     l'application — et on la regarde changer. */
  console.log('\n=== la base bouge sous l’application ===');
  await ouvrirOnglet(page, 'Semaine');
  const [[seance]] = await bd().execute(
    `SELECT s.id, s.titre_fr, s.titre_court_fr FROM msc_session s
     JOIN msc_plan p ON p.id = s.plan_id
     WHERE p.athlete_id = 1 AND p.actif = 1
     ORDER BY ABS(DATEDIFF(s.date, CURDATE())), s.ordre LIMIT 1`,
  );
  const marque = `Modifié par le coach ${Date.now()}`;
  await bd().execute(
    'UPDATE msc_session SET titre_fr = ?, titre_court_fr = ? WHERE id = ?',
    [marque, marque, seance.id],
  );
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(2500);
  check('un entraînement modifié en base apparaît sans rechargement',
    (await page.locator('body').innerText()).includes(marque), marque);
  await bd().execute(
    'UPDATE msc_session SET titre_fr = ?, titre_court_fr = ? WHERE id = ?',
    [seance.titre_fr, seance.titre_court_fr, seance.id],
  );

  /* Le générateur : le plan se fabrique dans le navigateur, et le bouton qui
     l'enregistre dit ce qu'il remplace AVANT qu'on appuie.

     Ce contrôle ne l'enfonce pas : appuyer remplacerait le plan de l'athlète 1,
     que les autres sections lisent. Que la route écrive vraiment, `check:api`
     le prouve — sur un second athlète, justement pour ça. */
  console.log('\n=== enregistrer un plan ===');
  /* Mon plan est à moi : cinquième onglet, « Mon plan ». Le plan d'un AUTRE
     athlète, lui, se règle dans le back office — deux chemins, parce que ce
     sont deux choses. */
  await ouvrirMoi(page, 'Mon plan');
  const createur = await page.locator('body').innerText();
  /* La périodisation : les quatre périodes du plan actif, ce qu'elles pèsent,
     et où elles placent l'athlète entre sa référence et son objectif. */
  check('le plan montre ses périodes, leur part de l’objectif et leur rampe',
    /Les périodes du plan/i.test(createur) && /Réamorçage/i.test(createur)
      && /%\s*\n?\s*/.test(createur) && /\/sem/.test(createur),
    createur.split('\n').find((l) => /Réamorçage/i.test(l))?.slice(0, 70) ?? '');
  /* Et il les nomme par leur nature, pas par le nom du bloc : le plan du
     classeur s'ouvre sur un réamorçage et finit sur un pic. */
  check('et il nomme chaque période — réamorçage, construction, pic',
    /Réamorçage/i.test(createur) && /Construction/i.test(createur) && /\bPic\b/i.test(createur),
    createur.split('\n').filter((l) => /^(Réamorçage|Construction|Pic|Affûtage)/i.test(l.trim()))
      .join(' · ').slice(0, 80));
  check('l’écran Créer montre le plan généré',
    /Plan généré/i.test(createur) && /semaines/i.test(createur));
  /* Le plan se bâtit sur la semaine type de l'athlète, et le dit : sans cette
     phrase, une séance raccourcie par le réamorçage passe pour un bug. */
  check('et dit qu’il est bâti sur la semaine type de l’athlète',
    /Bâti sur sa semaine type/i.test(createur),
    createur.split('\n').find((l) => /Bâti sur sa semaine type/i.test(l))?.slice(0, 90) ?? '');
  check('et, en tête, l’historique Strava d’où l’on part',
    /Historique Strava/i.test(createur), createur.split('\n').find((l) => /Historique/i.test(l)) ?? '');
  check('et propose de l’enregistrer',
    /Enregistrer et activer/i.test(createur),
    createur.split('\n').find((l) => /Enregistrer/i.test(l)) ?? '');
  check('en disant ce que ça remplace',
    /L'ancien plan n'est pas supprimé|L’ancien plan n’est pas supprimé/.test(createur),
    createur.split('\n').find((l) => /ancien/i.test(l))?.slice(0, 80) ?? '');
  check('et que les deux références deviennent celles de l’athlète',
    /références 10\s?km deviennent celles de l’athlète|références 10 km deviennent celles de l'athlète/.test(createur),
    createur.split('\n').find((l) => /références/i.test(l))?.slice(0, 90) ?? '');
  check('et combien de séances deviennent actives',
    /\d+ séances du \d{4}-\d{2}-\d{2} au \d{4}-\d{2}-\d{2}/.test(createur),
    createur.split('\n').find((l) => /séances du/.test(l))?.slice(0, 80) ?? '');

  /* Le vrai test du hors-ligne : couper, relire, écrire, remettre, vérifier que
     ce qui a été tapé est arrivé. Sans ça, « ça marche hors ligne » n'est
     qu'une intention. */
  /* Le back office : encoder une course, la voir apparaître, et voir la courbe
     se tracer une fois qu'il y a deux résultats à comparer. */
  console.log('\n=== le back office ===');
  /* Les objectifs par discipline : l'athlète les remplit depuis son téléphone,
     dans son profil — le même écran que le coach ouvre dans la fiche. */
  await ouvrirMoi(page, 'Mon profil');
  const profil = await page.locator('body').innerText();
  check('le profil porte les objectifs par discipline, avec leur épreuve étalon',
    /Objectifs par discipline/i.test(profil) && /10 km/.test(profil) && /1500 m/.test(profil)
      && /40 km/.test(profil),
    profil.split('\n').find((l) => /Objectifs par/.test(l)) ?? profil.split('\n').slice(0, 4).join(' · '));
  await bd().execute('DELETE FROM msc_objectif_sport WHERE athlete_id = 1');
  await page.getByLabel(/^Natation aujourd/).fill('27:00');
  await page.getByLabel(/^Natation visé$/).fill('25:00');
  await page.getByRole('button', { name: 'Enregistrer Natation' }).click();
  await page.waitForTimeout(1500);
  const [[objectif]] = await bd().execute(
    "SELECT actuel_s, cible_s FROM msc_objectif_sport WHERE athlete_id = 1 AND discipline = 'Natation'",
  );
  check('l’athlète pose son objectif de natation depuis le PWA, et il part en base',
    Number(objectif?.actuel_s) === 1620 && Number(objectif?.cible_s) === 1500,
    JSON.stringify(objectif ?? null));

  await ouvrirMoi(page, 'Mes starts');
  /* Les intitulés de section sont mis en majuscules par le CSS, et innerText
     rend le texte affiché. */
  check('la section Starts s’ouvre sur les compétitions de l’athlète',
    /compétitions/i.test(await page.locator('body').innerText()));

  const tracesAvant = await page.locator('svg[role=img]').count();

  /* Les courses sont un tableau : la dernière ligne est celle à ajouter, on
     la remplit sur place et ✓ (Enregistrer) l'envoie. */
  const encoder = async (nom, date, distance, temps) => {
    await page.click('text=Encoder une course');
    await page.waitForTimeout(400);
    const nouvelle = page.locator('table tbody tr').last();
    await nouvelle.locator('input[type=date]').fill(date);
    await nouvelle.getByLabel('Nom', { exact: true }).fill(nom);
    await nouvelle.getByLabel('Distance (km)', { exact: true }).fill(String(distance));
    await nouvelle.getByLabel('Temps (h:mm:ss)', { exact: true }).fill(temps);
    await nouvelle.getByRole('button', { name: 'Enregistrer' }).click();
    await page.waitForTimeout(1400);
  };

  /* Le type de course pose la distance : un semi fait 21,097 km sans qu'on
     le retape. */
  const nouvelle = page.locator('table tbody tr').last();
  await nouvelle.getByLabel('Type', { exact: true }).selectOption('cap_semi');
  await page.waitForTimeout(300);
  check('le type de course pose la distance officielle',
    (await nouvelle.getByLabel('Distance (km)', { exact: true }).inputValue()) === '21.097',
    await nouvelle.getByLabel('Distance (km)', { exact: true }).inputValue());
  await nouvelle.getByLabel('Type', { exact: true }).selectOption('');

  await encoder('Corrida de contrôle', '2026-03-01', 10, '0:44:00');
  check('la course encodée apparaît',
    (await page.locator('body').innerText()).includes('Corrida de contrôle'));
  check('et son allure est calculée, pas saisie',
    /4:24\/km/.test(await page.locator('body').innerText()),
    (await page.locator('body').innerText()).match(/\d:\d\d\/km/g)?.join(' ') ?? '');

  /* Un seul résultat n'a pas de pente à montrer, mais il a une valeur : la
     montrer vaut mieux que refuser de rien dire. La carte du poids, elle, a
     déjà de quoi tracer — on regarde donc la carte de progression seule. */
  /* Compter les tracés de la page est plus robuste que deviner quelle carte
     est laquelle dans un DOM sans classes : le poids en a déjà un, la
     progression n'en aura un qu'au deuxième résultat. */
  const tracesApres1 = await page.locator('svg[role=img]').count();
  check('un seul résultat affiche sa valeur sans tracer de pente',
    /4:24\/km/.test(await page.locator('body').innerText()) && tracesApres1 === tracesAvant,
    `${tracesAvant} → ${tracesApres1}`);

  await encoder('Semi de contrôle', '2026-06-01', 21.1, '1:36:00');
  await page.waitForTimeout(600);
  const tracesApres2 = await page.locator('svg[role=img]').count();
  check('avec deux résultats, la courbe se trace', tracesApres2 === tracesApres1 + 1,
    `${tracesApres1} → ${tracesApres2}`);
  /* Riegel : un semi en 1h36 vaut mieux qu'un 10 km en 44 min. La courbe doit
     donc descendre, et le badge afficher un progrès. */
  const bo = await page.locator('body').innerText();
  check('les distances sont ramenées à l’équivalent 10 km',
    /−\d:\d\d/.test(bo), bo.match(/[−+]\d:\d\d/g)?.join(' ') ?? '');

  /* Le back office de l'admin : le même onglet, renommé, avec Comptes et
     Système en plus. Le serveur relit le rôle à chaque requête, mais l'écran
     l'a appris à la connexion : on promeut par SQL, puis on recharge. */
  console.log('\n=== le back office de l’admin ===');
  await bd().execute("UPDATE compte SET role = 'admin' WHERE email = ?", [EMAIL]);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('nav', { timeout: 20000 });
  await page.waitForTimeout(800);
  /* Devenu admin, le compte gagne une porte — pas un onglet : la barre du bas
     reste son application, « Moi » compris. */
  check('la barre du bas ne change pas de rôle : c’est toujours mon application',
    /Moi/.test(await page.locator('nav').innerText()) && !/Admin/.test(await page.locator('nav').innerText()),
    (await page.locator('nav').innerText()).replace(/\n/g, ' · '));
  check('et le téléphone n’a pas de back office du tout : c’est mon application',
    (await page.getByRole('button', { name: /^Back office$/ }).count()) === 0);
  await ouvrirSection(page, 'Comptes');
  const comptesTexte = await page.locator('body').innerText();
  check('Comptes liste le compte connecté, avec son athlète et son droit',
    comptesTexte.includes(EMAIL) && /\(écriture\)/.test(comptesTexte),
    comptesTexte.split('\n').find((l) => l.includes(EMAIL)) ?? '');
  check('et, pour un compte seul, l’assistant part de l’étape Compte',
    /Nouveau compte/i.test(comptesTexte) && /Un compte seul/.test(comptesTexte) && !/ONBOARDING/.test(comptesTexte));

  /* Le club : la liste des athlètes, et l'assistant qui en crée un avec son
     compte — pas à pas, sans laisser passer une étape invalide. */
  await ouvrirSection(page, 'Athlètes');
  const hubTexte = await page.locator('body').innerText();
  /* Le nom de l'athlète semé change d'une base à l'autre : on regarde la
     forme de la liste, pas qui elle nomme. */
  check('Athlètes liste les athlètes visibles, avec « Ouvrir »',
    /ATHLÈTES · \d/i.test(hubTexte) && /Ouvrir|en cours/i.test(hubTexte),
    hubTexte.split('\n').find((l) => /ATHLÈTES · /i.test(l)) ?? '');
  check('et porte l’onboarding pas à pas — un athlète et son compte, une fois',
    /Onboarding/i.test(hubTexte) && /Un athlète et son compte/.test(hubTexte));
  await page.getByRole('button', { name: 'Suivant' }).click();
  await page.waitForTimeout(300);
  const suivant = page.getByRole('button', { name: 'Suivant' });
  check('l’étape Athlète ne laisse pas passer une fiche vide', await suivant.isDisabled());
  await page.getByLabel('Nom', { exact: true }).last().fill('Assistant de contrôle');
  await page.getByLabel('Allure 10 km actuelle', { exact: true }).fill('4:30');
  await page.getByLabel('Allure 10 km visée', { exact: true }).fill('4:00');
  await page.waitForTimeout(200);
  check('… et passe une fois l’athlète renseigné', !(await suivant.isDisabled()));
  /* Strava est à l'athlète : sa liaison, son historique, son application à
     lui. Les paramètres de l'application — la clé, l'application Strava
     commune — sont réunis dans Réglages. */
  await ouvrirFiche(page, 'Strava');
  const stravaTexte = await page.locator('body').innerText();
  check('Strava, pour l’athlète affiché : sa liaison et son application à lui',
    /Strava · non connecté|Strava · connecté/.test(stravaTexte) && /Application Strava de cet athlète/i.test(stravaTexte),
    stravaTexte.split('\n').find((l) => /Strava · /.test(l)) ?? '');
  /* Le réglage que Strava juge chez lui, et qui rate en silence ici : l'écran
     le montre avant le clic, plutôt que « Bad Request » sur strava.com. */
  check('et l’adresse de retour, celle que Strava vérifie',
    /Adresse de retour/i.test(stravaTexte) && /\/api\/strava\/callback/.test(stravaTexte),
    stravaTexte.split('\n').find((l) => /callback/.test(l)) ?? '');
  await page.getByRole('button', { name: /Renseigner une application propre/ }).first().click();
  await page.waitForTimeout(400);
  check('et l’application propre se saisit là',
    (await page.getByLabel('ID client', { exact: true }).count()) >= 1);
  await page.getByRole('tab', { name: 'Profil' }).click();
  await page.waitForTimeout(900);
  /* On est déjà dans la fiche : Profil en est un onglet. */
  await page.getByRole('button', { name: 'Vérifier la connexion' }).click();
  await page.waitForTimeout(900);
  const profilTexte = await page.locator('body').innerText();
  check('Profil vérifie la connexion Strava d’un bouton',
    /Connexion Strava/i.test(profilTexte) && /non connecté|connecté|non configuré/i.test(profilTexte),
    profilTexte.split('\n').find((l) => /non connecté|connecté|non configuré/i.test(l)) ?? '');
  await ouvrirSection(page, 'Paramètres');
  const reglagesTexte = await page.locator('body').innerText();
  check('les paramètres de l’application sont réunis dans Paramètres : clé Anthropic, application Strava commune',
    /Clé API Anthropic/i.test(reglagesTexte) && /Strava · Client ID/i.test(reglagesTexte));
  await ouvrirSection(page, 'Système');
  const systemeTexte = await page.locator('body').innerText();
  check('Système montre la version de la page et celle du serveur',
    /cette page/i.test(systemeTexte) && /le serveur/i.test(systemeTexte) && /à jour/i.test(systemeTexte),
    systemeTexte.split('\n').find((l) => /à jour|plus récente/i.test(l)) ?? '');
  check('et l’état des services', /Clé Anthropic/i.test(systemeTexte) && /Base de données/i.test(systemeTexte)
    && /Strava/.test(systemeTexte) && /Scellement/i.test(systemeTexte));
  check('et ce que la démonstration a laissé', /Données de démonstration/i.test(systemeTexte));
  /* Un service se règle dans Paramètres, pas deux fois : Système y renvoie. */
  check('et renvoie vers Paramètres plutôt que de dupliquer les champs',
    (await page.getByRole('button', { name: /→ Paramètres/ }).count()) >= 1
      && (await page.locator('input[type=password]').count()) === 0);
  /* Le bureau : sur un écran large, un coach ou un admin a le menu à gauche
     et la page large ; sur un téléphone, le même compte garde les onglets. */
  console.log('\n=== le bureau ===');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('nav', { timeout: 20000 });
  await page.waitForTimeout(800);
  const menu = page.getByRole('navigation', { name: 'Back office' });
  const menuTexte = (await menu.count()) ? await menu.innerText() : '';
  /* Le menu ne porte que ce qui ne dépend de personne : deux familles, six
     entrées. Ce qui appartient à quelqu'un — son suivi, son plan, son
     Strava — est dans sa fiche, pas ici ; et mon entraînement à moi n'est pas
     dans le back office du tout. */
  check('sur un écran large, l’admin a le bureau : deux familles — entraînement, application',
    (await menu.count()) === 1 && /Entraînement/i.test(menuTexte) && /Application/i.test(menuTexte)
      && /Athlètes/.test(menuTexte) && /Calendrier/.test(menuTexte) && /Classement/.test(menuTexte)
      && /Paramètres/.test(menuTexte) && /Comptes/.test(menuTexte) && /Système/.test(menuTexte),
    menuTexte.replace(/\n+/g, ' · ').slice(0, 200));
  check('et rien qui dépende d’un athlète choisi ailleurs',
    !/Suivi/.test(menuTexte) && !/Starts/.test(menuTexte) && !/Strava/.test(menuTexte),
    menuTexte.replace(/\n+/g, ' · ').slice(0, 120));
  /* Le back office est au coach, et à lui seul : mon entraînement n'y est
     pas, pas même derrière une bascule. Il est sur mon téléphone. */
  check('et rien de mon entraînement : ni bascule, ni mes cinq écrans',
    !/Le club/.test(menuTexte) && !/Mon entraînement/.test(menuTexte)
      && !/Dupki/.test(menuTexte) && !/Aujourd'hui/.test(menuTexte),
    menuTexte.replace(/\n+/g, ' · ').slice(0, 160));
  check('et plus de barre d’onglets', (await page.locator('nav button').count()) > 5);
  check('le hub des athlètes est un tableau sur le bureau', (await page.locator('main table').count()) >= 1);
  /* Et la fiche : tout ce qui est à un athlète, sous son nom, en cinq
     onglets — le second niveau, et le seul. */
  await menu.getByRole('button', { name: 'Athlètes' }).click();
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: /^Ouvrir\b/ }).first().click();
  await page.waitForTimeout(1200);
  const ficheTexte = await page.locator('main').innerText();
  check('ouvrir un athlète donne sa fiche : suivi, plan, starts, profil, Strava',
    /Suivi/.test(ficheTexte) && /Plan/.test(ficheTexte) && /Starts/.test(ficheTexte)
      && /Profil/.test(ficheTexte) && /Strava/.test(ficheTexte)
      && /Tous les athlètes/.test(ficheTexte),
    ficheTexte.split('\n').slice(0, 3).join(' · '));
  /* La semaine type : la matrice que le coach suit. Sept jours, deux créneaux,
     un sport et un type par créneau, et les allures qui en découlent. */
  await page.getByRole('tab', { name: 'Semaine type', exact: true }).click();
  await page.waitForTimeout(1000);
  const matrice = await page.locator('main').innerText();
  check('la semaine type est une matrice : sept jours, deux créneaux',
    /LUNDI/.test(matrice) && /DIMANCHE/.test(matrice)
      && /1er créneau/.test(matrice) && /2e créneau/.test(matrice)
      && (await page.getByRole('combobox').count()) >= 28,
    `${await page.getByRole('combobox').count()} listes déroulantes`);
  await page.getByRole('button', { name: /Semaine de départ/ }).click();
  await page.waitForTimeout(600);
  const remplie = await page.locator('main').innerText();
  check('le modèle remplit la grille, avec les allures cibles des créneaux à pied',
    /Volume de la semaine type/.test(remplie) && /Allures cibles/.test(remplie)
      && /\d+:\d\d\/km/.test(remplie),
    remplie.split('\n').find((l) => /Allures cibles/.test(l))?.slice(0, 90) ?? '');
  await page.getByRole('button', { name: /Enregistrer la semaine type/ }).click();
  await page.waitForTimeout(1500);
  const [[rangee]] = await bd().execute('SELECT COUNT(*) AS n FROM msc_structure WHERE athlete_id = 1');
  check('et elle s’enregistre, créneau par créneau', Number(rangee.n) >= 5, `${rangee.n} créneaux`);

  /* Le modèle : la même semaine, rangée sous un nom, pour la reposer sur le
     suivant. On l'enregistre, on vide la grille, on la repose. */
  await bd().execute('DELETE FROM msc_modele WHERE nom = ?', ['Contrôle navigateur']);
  await page.getByLabel('Nom du modèle').fill('Contrôle navigateur');
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: /Enregistrer comme modèle/ }).click();
  await page.waitForTimeout(1200);
  const [[modeleRange]] = await bd().execute(
    'SELECT COUNT(*) AS n FROM msc_modele WHERE nom = ?', ['Contrôle navigateur'],
  );
  check('la semaine type s’enregistre comme modèle, sous son nom',
    Number(modeleRange.n) >= 5, `${modeleRange.n} créneaux`);
  check('… et le modèle apparaît, prêt à être reposé',
    (await page.getByRole('button', { name: /^Contrôle navigateur/ }).count()) >= 1);
  /* Le reposer remplit la grille à l'écran, et rien d'autre : ce qui est rangé
     chez l'athlète ne bouge qu'en enregistrant la semaine type. Deux gestes,
     parce que ce sont deux décisions. */
  await page.getByRole('button', { name: /^Contrôle navigateur/ }).first().click();
  await page.waitForTimeout(600);
  const reposee = await page.locator('main').innerText();
  const [[inchangee]] = await bd().execute('SELECT COUNT(*) AS n FROM msc_structure WHERE athlete_id = 1');
  check('le reposer remplit la grille, sans rien écrire chez l’athlète',
    /[1-9]\d*h\d\d\s*\n?\s*Volume de la semaine type/.test(reposee)
      && Number(inchangee.n) === Number(rangee.n),
    `${inchangee.n} créneaux en base`);
  await page.getByRole('button', { name: /Supprimer Contrôle navigateur/ }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /^Supprimer \?$/ }).click();
  await page.waitForTimeout(900);
  const [[modeleParti]] = await bd().execute(
    'SELECT COUNT(*) AS n FROM msc_modele WHERE nom = ?', ['Contrôle navigateur'],
  );
  check('et le supprimer demande confirmation, puis le retire',
    Number(modeleParti.n) === 0, `${modeleParti.n} créneaux restants`);

  /* Et la sortie définitive : dans SA fiche, sous son profil, jamais d'un
     seul bouton — on dit ce qui sera détruit, et le nom se tape. */
  await page.getByRole('tab', { name: 'Profil', exact: true }).click();
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: /Supprimer cet athlète…/ }).click();
  await page.waitForTimeout(1200);
  const zone = await page.locator('main').innerText();
  check('supprimer un athlète dit d’abord ce que ça détruit, et demande son nom',
    /Ce qui sera détruit/i.test(zone) && /Écris son nom pour confirmer/i.test(zone)
      && (await page.getByRole('button', { name: /Supprimer définitivement/ }).isDisabled()),
    zone.split('\n').find((l) => /Écris son nom/.test(l)) ?? '');
  await page.getByRole('button', { name: /^Annuler$/ }).click();
  await page.waitForTimeout(500);

  await menu.getByRole('button', { name: 'Système' }).click();
  await page.waitForTimeout(900);
  check('une section s’ouvre depuis le menu', /cette page/i.test(await page.locator('body').innerText()));
  /* Mon entraînement, lui, est resté sur le téléphone — et le même compte l'y
     retrouve entier. */
  await page.setViewportSize({ width: 420, height: 900 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('nav', { timeout: 20000 });
  await page.waitForTimeout(800);
  check('sur un téléphone, le même compte retrouve ses cinq onglets', (await page.locator('nav button').count()) === 5);
  await bd().execute("UPDATE compte SET role = 'athlete' WHERE email = ?", [EMAIL]);

  console.log('\n=== sans réseau ===');
  coupe = true;
  await page.context().setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('nav', { timeout: 20000 });
  const horsLigne = await page.locator('body').innerText();
  check("l'application démarre sur la copie locale", await page.locator('nav').isVisible());
  check('et elle le dit', /Hors ligne/.test(horsLigne),
    horsLigne.split('\n').slice(0, 2).join(' · '));

  await page.locator('nav button').first().click();
  await page.waitForTimeout(500);
  check('le plan reste lisible', /S\d+/.test(await page.locator('body').innerText()));

  /* Une note tapée sans réseau doit attendre, pas disparaître. */
  const note = `sans réseau ${Date.now()}`;
  const champNote = page.locator('textarea, input[placeholder*="Sommeil"]').first();
  await champNote.fill(note);
  await champNote.blur();
  await page.waitForTimeout(800);
  check('ce qui est tapé part en file d’attente',
    /en attente d’envoi/.test(await page.locator('body').innerText()),
    (await page.locator('body').innerText()).split('\n')[0]);

  console.log('\n=== le réseau revient ===');
  await page.context().setOffline(false);
  coupe = false;
  /* L'événement « online » ne part pas tout seul quand c'est Playwright qui
     rebranche : on le déclenche comme le ferait le navigateur. */
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(2500);
  check('la file se vide', !/en attente d’envoi/.test(await page.locator('body').innerText()));

  const [journal] = await bd().execute(
    'SELECT note FROM msc_journal WHERE athlete_id = 1 AND note = ?', [note],
  );
  check('et la note est bien arrivée en base', journal.length === 1, note);

  console.log('\n=== la déconnexion ===');
  await page.click('[aria-label="Mon application"]');
  await page.waitForTimeout(500);
  check('les paramètres nomment le compte connecté',
    (await page.locator('body').innerText()).includes(EMAIL));
  await page.click('text=Déconnexion');
  await page.waitForTimeout(900);
  check('on retourne à la connexion', await page.getByText('Connecte-toi').isVisible());
  check('et le plan a disparu de l’écran', (await page.locator('nav').count()) === 0);

  console.log('');
  check('aucune erreur en chemin', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));

  if (process.env.MSC_CAPTURE) await page.screenshot({ path: process.env.MSC_CAPTURE });
} finally {
  if (nav) await nav.close();
  serveur.kill('SIGTERM');
  await bd().execute("DELETE FROM msc_competition WHERE nom LIKE '%de contrôle'");
  await bd().execute('DELETE FROM compte WHERE email IN (?, ?)', [EMAIL, `libre-${EMAIL}`]);
  await bd().execute('DELETE FROM msc_athlete WHERE nom = ?', ['Libre du navigateur']);
  await fermer();
}

if (fails > 0) console.log(`\n--- journal du serveur ---\n${journal.slice(-1200)}`);
console.log(fails === 0 ? '\nOK' : `\n${fails} ÉCHECS`);
process.exit(fails === 0 ? 0 : 1);
