/* Les comptes, en ligne de commande.

   Il n'y a pas d'écran d'inscription et il n'y en aura pas : MySmartCoach n'est
   pas un service qu'on rejoint, c'est le plan d'un athlète et le back office de
   son coach. Les comptes se créent ici.

       npm run compte -- lister
       npm run compte -- creer sam@exemple.tld "Sam" [--coach]
       npm run compte -- motdepasse sam@exemple.tld
       npm run compte -- athlete "Léa Martin" 4:15 3:50 [lea@exemple.tld]
       npm run compte -- acces sam@exemple.tld 1 ecriture

   Le mot de passe se saisit, il ne se passe pas en argument : la ligne de
   commande est lue par `ps` et gardée par l'historique du shell. */

import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { hacher } from '../server/auth.mjs';
import { bd, fermer, ligne, lignes } from '../server/bd.mjs';

const [commande, ...args] = process.argv.slice(2);

const USAGE = `usage :
  npm run compte -- lister
  npm run compte -- creer <email> <nom> [--coach]
  npm run compte -- motdepasse <email>
  npm run compte -- athlete <nom> <allure_actuelle> <allure_cible> [email]
  npm run compte -- acces <email> <athlete_id> [lecture|ecriture]`;

/* Une allure, en secondes par km. Le moteur ne connaît que ça — c'est le seul
   nombre dont il part. On accepte l'écriture humaine « 4:00 » et les secondes
   brutes « 240 » : la première pour taper vite, la seconde parce qu'un script
   la donne déjà comme ça. */
function secondesParKm(x) {
  const s = String(x).trim();
  if (/^\d+$/.test(s)) return Number(s);
  const m = s.match(/^(\d{1,2}):([0-5]\d)$/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  throw new Error(`Allure illisible : « ${x} ». Attendu des secondes (240) ou mm:ss (4:00).`);
}

function mmss(s) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

async function demanderMotDePasse() {
  /* Sans terminal — un pipe, un script de déploiement — les deux questions
     posées l'une après l'autre ne se répondent jamais : readline a déjà vidé le
     flux. On lit alors les deux lignes d'un coup, au lieu d'attendre à jamais
     sur une entrée qui est déjà arrivée. */
  const [a, b] = stdin.isTTY ? await demanderDeuxFois() : await deuxLignes();
  if (a !== b) throw new Error('Les deux saisies diffèrent.');
  /* Douze par défaut. Réglable par MSC_MDP_MIN pour un serveur d'essai qui
     assume un code court — mais le défaut sûr est ce qui part en production, on
     ne l'abaisse pas dans le code. Un code à 7 chiffres, c'est dix millions de
     possibilités : sur du HTTP en clair, cassable. À ne faire que sur un bac à
     sable, et à relever avant d'y mettre de vraies données. */
  const min = Math.max(1, Number(process.env.MSC_MDP_MIN ?? 12) || 12);
  if (a.length < min) throw new Error(`${min} caractères au moins.`);
  return a;
}

async function demanderDeuxFois() {
  const rl = createInterface({ input: stdin, output: stdout });
  const a = await rl.question('Mot de passe : ');
  const b = await rl.question('Encore une fois : ');
  rl.close();
  return [a, b];
}

async function deuxLignes() {
  let brut = '';
  for await (const morceau of stdin) brut += morceau;
  const lignes = brut.split('\n');
  /* Une seule ligne : le mot de passe n'est pas confirmé, il est donné. */
  return lignes.length > 1 && lignes[1] !== '' ? [lignes[0], lignes[1]] : [lignes[0], lignes[0]];
}

try {
  if (commande === 'lister') {
    const comptes = await lignes(
      `SELECT c.id, c.email, c.nom, c.role, c.actif,
              GROUP_CONCAT(CONCAT(a.nom, ' (', x.droit, ')') SEPARATOR ', ') AS athletes,
              c.mot_de_passe = '!' AS sans_mot_de_passe
       FROM compte c
       LEFT JOIN msc_acces x ON x.compte_id = c.id
       LEFT JOIN msc_athlete a ON a.id = x.athlete_id
       GROUP BY c.id ORDER BY c.email`,
    );
    if (comptes.length === 0) console.log('Aucun compte.');
    for (const c of comptes) {
      console.log(
        `#${c.id}  ${c.email}  ${c.nom}  [${c.role}]` +
          `${c.sans_mot_de_passe ? '  ⚠ sans mot de passe' : ''}` +
          `${c.athletes ? `\n      ${c.athletes}` : '\n      aucun athlète'}`,
      );
    }
  } else if (commande === 'creer') {
    const [email, nom, ...reste] = args;
    if (!email || !nom) throw new Error(USAGE);
    const role = reste.includes('--coach') ? 'coach' : 'athlete';
    const motDePasse = await demanderMotDePasse();
    const [r] = await bd().execute(
      'INSERT INTO compte (email, mot_de_passe, nom, role) VALUES (?, ?, ?, ?)',
      [email.trim().toLowerCase(), hacher(motDePasse), nom, role],
    );
    console.log(`compte #${r.insertId} créé (${role}). Donne-lui un athlète avec « acces ».`);
  } else if (commande === 'motdepasse') {
    const [email] = args;
    if (!email) throw new Error(USAGE);
    const motDePasse = await demanderMotDePasse();
    const [r] = await bd().execute('UPDATE compte SET mot_de_passe = ? WHERE email = ?', [
      hacher(motDePasse), email.trim().toLowerCase(),
    ]);
    if (r.affectedRows === 0) throw new Error(`Aucun compte pour ${email}.`);
    console.log('mot de passe changé');
  } else if (commande === 'athlete') {
    const [nom, actuelle, cible, email] = args;
    if (!nom || !actuelle || !cible) throw new Error(USAGE);
    const a = secondesParKm(actuelle);
    const c = secondesParKm(cible);
    /* Une allure de course tient entre 2:00 et 15:00 au km. Hors de là, c'est
       une faute de frappe — des secondes prises pour des minutes, le plus
       souvent — et il vaut mieux la refuser que semer un athlète intenable. */
    for (const [libelle, v] of [['actuelle', a], ['cible', c]]) {
      if (v < 120 || v > 900) {
        throw new Error(`Allure ${libelle} hors plage (2:00–15:00 /km) : ${mmss(v)}.`);
      }
    }
    /* compte_id NULL : un athlète existe par lui-même, un login se rattache
       après (msc_acces). Le schéma le prévoit — « un athlète encodé par un
       coach, sans login à lui ». `debut` par défaut à aujourd'hui. */
    const debut = new Date().toISOString().slice(0, 10);
    const [r] = await bd().execute(
      `INSERT INTO msc_athlete (compte_id, nom, ref_actuelle_s, ref_cible_s, debut)
       VALUES (NULL, ?, ?, ?, ?)`,
      [nom, a, c, debut],
    );
    const id = r.insertId;
    console.log(`athlète #${id} « ${nom} » — actuelle ${mmss(a)}, cible ${mmss(c)} /km`);
    if (email) {
      const compte = await ligne('SELECT id FROM compte WHERE email = :e', {
        e: email.trim().toLowerCase(),
      });
      if (compte) {
        await bd().execute(
          `INSERT INTO msc_acces (compte_id, athlete_id, droit) VALUES (?, ?, 'ecriture')
           ON DUPLICATE KEY UPDATE droit = VALUES(droit)`,
          [compte.id, id],
        );
        console.log(`  relié à ${email} (écriture)`);
      } else {
        console.log(`  ⚠ aucun compte « ${email} » — crée-le d'abord (creer), puis : acces ${email} ${id}`);
      }
    } else {
      console.log(`  sans login à lui. Pour lui en donner un : acces <email> ${id}`);
    }
  } else if (commande === 'acces') {
    const [email, athleteId, droit = 'ecriture'] = args;
    if (!email || !athleteId) throw new Error(USAGE);
    const c = await ligne('SELECT id FROM compte WHERE email = :e', {
      e: email.trim().toLowerCase(),
    });
    if (!c) throw new Error(`Aucun compte pour ${email}.`);
    const a = await ligne('SELECT id, nom FROM msc_athlete WHERE id = :i', { i: Number(athleteId) });
    if (!a) throw new Error(`Aucun athlète ${athleteId}.`);
    await bd().execute(
      `INSERT INTO msc_acces (compte_id, athlete_id, droit) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE droit = VALUES(droit)`,
      [c.id, a.id, droit === 'lecture' ? 'lecture' : 'ecriture'],
    );
    console.log(`${email} → ${a.nom} (${droit})`);
  } else {
    console.error(USAGE);
    process.exitCode = 1;
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await fermer();
}
