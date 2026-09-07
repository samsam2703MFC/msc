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
  /* Le texte d'une erreur de console ne porte pas l'URL — « Failed to load
     resource » et rien de plus. On écoute donc les requêtes, où elle est. */
  page.on('pageerror', (e) => erreurs.push(`exception : ${e}`));
  page.on('requestfailed', (r) => {
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

  await page.click('text=Coach');
  await page.waitForTimeout(600);
  check("l'écart de la semaine est calculé",
    /réalisation|Semaine tenue|Écart détecté/i.test(await page.locator('body').innerText()));

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
  await bd().execute('DELETE FROM compte WHERE email = ?', [EMAIL]);
  await fermer();
}

if (fails > 0) console.log(`\n--- journal du serveur ---\n${journal.slice(-1200)}`);
console.log(fails === 0 ? '\nOK' : `\n${fails} ÉCHECS`);
process.exit(fails === 0 ? 0 : 1);
