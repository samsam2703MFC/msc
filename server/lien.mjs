/* Le lien de connexion à usage unique.

   Un athlète a perdu son mot de passe, ou n'en a jamais eu. Jusqu'ici il
   fallait aller sur le serveur — `npm run compte -- motdepasse` — puis lui
   dire son nouveau mot de passe de vive voix. Ça ne tient pas quand les
   athlètes ne sont plus trois.

   L'admin engendre donc un lien depuis la liste des athlètes, l'envoie comme
   il veut (message, mail, papier), et l'athlète entre en le touchant, puis
   pose son mot de passe.

   Trois règles, et elles ne sont pas négociables :

   - le jeton n'est pas en base. Son empreinte SHA-256 y est, comme un mot de
     passe. Qui lit la base — une sauvegarde, un dump, un poste de
     développement — ne peut pas entrer avec ;
   - il vaut une fois. La consommation marque l'usage dans la même requête que
     la vérification, donc deux clics simultanés ne l'ouvrent pas deux fois ;
   - il périme. Quelques heures, réglables, parce qu'un lien qui traîne dans
     une conversation est un mot de passe qui traîne dans une conversation.

   Un compte désactivé n'entre pas, lien ou pas : c'est le même refus que la
   connexion normale. */

import { createHash, randomBytes } from 'node:crypto';
import { bd, ligne } from './bd.mjs';
import { param } from './params.mjs';

export class LienError extends Error {
  constructor(message, code = 400) {
    super(message);
    this.code = code;
  }
}

const empreinteDe = (jeton) => createHash('sha256').update(String(jeton)).digest('hex');

/**
 * Un lien pour ce compte. Le jeton en clair ne sort qu'ici, une fois : il
 * n'est ni stocké, ni relisible, et un second appel en engendre un autre — en
 * annulant le précédent, parce que deux liens vivants pour un même compte,
 * c'est une porte de plus sans raison.
 */
export async function creerLien(compteId) {
  const c = await ligne('SELECT id, email, actif FROM compte WHERE id = :id', { id: Number(compteId) });
  if (!c) throw new LienError(`Aucun compte ${compteId}.`, 404);
  if (!c.actif) throw new LienError('Ce compte est désactivé : réactive-le avant de lui envoyer un lien.');

  const heures = Number(await param('securite.lien_heures')) || 48;
  const jeton = randomBytes(32).toString('base64url');
  await bd().execute('DELETE FROM msc_lien WHERE compte_id = ? AND utilise_le IS NULL', [c.id]);
  await bd().execute(
    'INSERT INTO msc_lien (compte_id, empreinte, expire_le) VALUES (?, ?, DATE_ADD(NOW(3), INTERVAL ? HOUR))',
    [c.id, empreinteDe(jeton), heures],
  );
  const l = await ligne(
    'SELECT expire_le FROM msc_lien WHERE compte_id = :c AND utilise_le IS NULL ORDER BY id DESC LIMIT 1',
    { c: c.id },
  );
  return { jeton, email: c.email, expire_le: l?.expire_le ?? null, heures };
}

/**
 * Consommer un lien : il ouvre la session une fois, et plus jamais.
 *
 * L'UPDATE porte la vérification — `utilise_le IS NULL AND expire_le > NOW()`
 * — donc c'est la base qui tranche, en une opération. Vérifier puis marquer en
 * deux temps laisserait deux requêtes simultanées passer toutes les deux.
 */
export async function consommerLien(jeton) {
  const refus = new LienError('Ce lien n’est plus valable. Demande-en un autre.', 401);
  if (!jeton || typeof jeton !== 'string') throw refus;
  const [r] = await bd().execute(
    `UPDATE msc_lien SET utilise_le = NOW(3)
     WHERE empreinte = ? AND utilise_le IS NULL AND expire_le > NOW(3)`,
    [empreinteDe(jeton)],
  );
  if (r.affectedRows === 0) throw refus;
  const c = await ligne(
    `SELECT c.id, c.email, c.nom, c.role, c.actif
     FROM compte c JOIN msc_lien l ON l.compte_id = c.id
     WHERE l.empreinte = :e`,
    { e: empreinteDe(jeton) },
  );
  if (!c || !c.actif) throw refus;
  return { id: c.id, email: c.email, nom: c.nom, role: c.role };
}
