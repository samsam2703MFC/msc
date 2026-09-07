/* Les comptes, en ligne de commande.

   Il n'y a pas d'écran d'inscription et il n'y en aura pas : MySmartCoach n'est
   pas un service qu'on rejoint, c'est le plan d'un athlète et le back office de
   son coach. Les comptes se créent ici.

       npm run compte -- lister
       npm run compte -- creer sam@exemple.tld "Sam" [--coach]
       npm run compte -- motdepasse sam@exemple.tld
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
  npm run compte -- acces <email> <athlete_id> [lecture|ecriture]`;

async function demanderMotDePasse() {
  const rl = createInterface({ input: stdin, output: stdout });
  const a = await rl.question('Mot de passe : ');
  const b = await rl.question('Encore une fois : ');
  rl.close();
  if (a !== b) throw new Error('Les deux saisies diffèrent.');
  if (a.length < 12) throw new Error('Douze caractères au moins.');
  return a;
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
