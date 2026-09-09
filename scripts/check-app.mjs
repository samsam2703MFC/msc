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

/* Un compte qui voit l'athlète 1 — celui que le seed installe. */
await bd().execute('DELETE FROM compte WHERE email = ?', [EMAIL]);
const [c] = await bd().execute(
  'INSERT INTO compte (email, mot_de_passe, nom, role) VALUES (?, ?, ?, ?)',
  [EMAIL, hacher(MOT_DE_PASSE), 'Navigateur', 'athlete'],
);
await bd().execute(
  "INSERT INTO msc_acces (compte_id, athlete_id, droit) VALUES (?, 1, 'ecriture')",
  [c.insertId],
);

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

  console.log('\n=== le bon ===');
  await page.fill('input[type=password]', MOT_DE_PASSE);
  await page.click('button[type=submit]');
  await page.waitForSelector('nav', { timeout: 20000 });
  check("l'application s'ouvre", await page.locator('nav').isVisible());

  /* Le matin : la FC de repos et la HRV avant tout le reste. Le panneau bloque,
     le bouton ne part pas sans les deux, et il disparaît une fois la mesure
     rangée — y compris après un rechargement, puisqu'elle est en base. */
  console.log('\n=== le matin ===');
  const matin = page.getByRole('dialog');
  await matin.waitFor({ timeout: 10000 });
  check('le panneau FC repos + HRV bloque l’entrée', (await matin.count()) === 1);
  const entrer = matin.getByRole('button', { name: /Enregistrer et entrer/ });
  check('sans les deux chiffres, il ne part pas', await entrer.isDisabled());
  await matin.locator('input').nth(0).fill('44');
  check('avec la FC seule non plus', await entrer.isDisabled());
  await matin.locator('input').nth(1).fill('68');
  check('avec les deux, il part', !(await entrer.isDisabled()));
  await entrer.click();
  await page.waitForFunction(() => !document.querySelector('[role=dialog]'), null, { timeout: 15000 });
  check('et il disparaît une fois la mesure rangée', (await page.getByRole('dialog').count()) === 0);

  const aujourdhui = await page.locator('body').innerText();
  check('le plan vient de la base', /S\d+/.test(aujourdhui),
    aujourdhui.split('\n').slice(0, 2).join(' · '));

  console.log('\n=== les écrans ===');
  await page.click('text=Semaine');
  await page.waitForTimeout(600);
  const semaine = await page.locator('body').innerText();
  check('la semaine montre des séances',
    /Natation|Course|Hyrox|Vélo|Repos/.test(semaine));
  /* Les allures ne sont pas en base : si elles s'affichent, c'est que le moteur
     tourne sur des données venues du serveur. */
  check('et des allures que le moteur a calculées', /\d+:\d\d\/km/.test(semaine),
    semaine.match(/\d+:\d\d\/km/g)?.slice(0, 3).join(' ') ?? '');

  await page.click('text=Forme');
  await page.waitForTimeout(500);
  check('une métrique sans données le dit au lieu d’inventer un chiffre',
    /Pas encore assez de données|—/.test(await page.locator('body').innerText()));

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

  await page.click('text=Coach');
  await page.waitForTimeout(600);
  check("l'écart de la semaine est calculé",
    /réalisation|Semaine tenue|Écart détecté/i.test(await page.locator('body').innerText()));

  /* Le générateur : le plan se fabrique dans le navigateur, et le bouton qui
     l'enregistre dit ce qu'il remplace AVANT qu'on appuie.

     Ce contrôle ne l'enfonce pas : appuyer remplacerait le plan de l'athlète 1,
     que les autres sections lisent. Que la route écrive vraiment, `check:api`
     le prouve — sur un second athlète, justement pour ça. */
  console.log('\n=== enregistrer un plan ===');
  await page.locator('nav button').last().click();
  await page.waitForTimeout(700);
  const createur = await page.locator('body').innerText();
  check('l’écran Créer montre le plan généré',
    /Plan généré/i.test(createur) && /semaines/i.test(createur));
  check('et propose de l’enregistrer',
    /Enregistrer et activer/i.test(createur),
    createur.split('\n').find((l) => /Enregistrer/i.test(l)) ?? '');
  check('en disant ce que ça remplace',
    /L'ancien n'est pas supprimé|L’ancien n’est pas supprimé/.test(createur),
    createur.split('\n').find((l) => /ancien/i.test(l))?.slice(0, 80) ?? '');
  check('et combien de séances deviennent actives',
    /\d+ séances du \d{4}-\d{2}-\d{2} au \d{4}-\d{2}-\d{2}/.test(createur),
    createur.split('\n').find((l) => /séances du/.test(l))?.slice(0, 80) ?? '');

  /* Le vrai test du hors-ligne : couper, relire, écrire, remettre, vérifier que
     ce qui a été tapé est arrivé. Sans ça, « ça marche hors ligne » n'est
     qu'une intention. */
  /* Le back office : encoder une course, la voir apparaître, et voir la courbe
     se tracer une fois qu'il y a deux résultats à comparer. */
  console.log('\n=== le back office ===');
  await page.locator('nav button').last().click();
  await page.waitForTimeout(600);
  await page.click('text=Courses');
  await page.waitForTimeout(600);
  /* Les intitulés de section sont mis en majuscules par le CSS, et innerText
     rend le texte affiché. */
  check('la section Courses s’ouvre',
    /compétitions/i.test(await page.locator('body').innerText()));

  const tracesAvant = await page.locator('svg[role=img]').count();

  const encoder = async (nom, date, distance, temps) => {
    await page.click('text=Encoder une course');
    await page.waitForTimeout(400);
    await page.fill('input[type=date]', date);
    const champs = page.locator('input:not([type=date])');
    await champs.nth(0).fill(String(distance));   // distance
    await champs.nth(1).fill(nom);                // nom
    await champs.nth(3).fill(temps);              // temps
    await page.click('text=Enregistrer');
    await page.waitForTimeout(1400);
  };

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
  await page.click('[aria-label=Paramètres]');
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
  await bd().execute('DELETE FROM compte WHERE email = ?', [EMAIL]);
  await fermer();
}

if (fails > 0) console.log(`\n--- journal du serveur ---\n${journal.slice(-1200)}`);
console.log(fails === 0 ? '\nOK' : `\n${fails} ÉCHECS`);
process.exit(fails === 0 ? 0 : 1);
