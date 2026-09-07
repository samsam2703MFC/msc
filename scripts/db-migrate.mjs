/* Applique db/schema.sql.

   Le schéma est idempotent — chaque table est CREATE TABLE IF NOT EXISTS — donc
   relancer ce script ne casse rien et ne change rien. Ce n'est pas encore un
   système de migrations versionnées, et ça n'a pas à l'être tant que le schéma
   n'est pas en production : le jour où il l'est, ce fichier devient
   db/migrations/0001-initial.sql et ce script tient un journal de ce qu'il a
   appliqué. Le dire ici plutôt que de faire semblant.

       npm run db:migrate
       npm run db:migrate -- --reset      # détruit et recrée. Demande confirmation.
*/

import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import mysql from 'mysql2/promise';
import { config } from '../server/bd.mjs';

const reset = process.argv.includes('--reset');
const oui = process.argv.includes('--oui');

const { database, uri, ...connexion } = config();
const nom = database ?? new URL(uri ?? 'mysql://x/msc').pathname.slice(1);

if (reset && !oui) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const reponse = await rl.question(
    `Détruire la base « ${nom} » et tout ce qu'elle contient ? Tape le nom pour confirmer : `,
  );
  rl.close();
  if (reponse.trim() !== nom) {
    console.error('Annulé.');
    process.exit(1);
  }
}

/* multipleStatements seulement ici : le schéma est un fichier de nous, pas une
   entrée d'utilisateur, et le reste de l'application n'en a pas besoin. */
const cnx = await mysql.createConnection({ ...connexion, multipleStatements: true });

try {
  if (reset) {
    await cnx.query(`DROP DATABASE IF EXISTS \`${nom}\``);
    console.log(`base « ${nom} » détruite`);
  }
  await cnx.query(
    `CREATE DATABASE IF NOT EXISTS \`${nom}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  await cnx.changeUser({ database: nom });

  const schema = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
  await cnx.query(schema);

  const [tables] = await cnx.query(
    'SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ?',
    [nom],
  );
  console.log(`base « ${nom} » à jour — ${tables.length} tables`);
} finally {
  await cnx.end();
}
