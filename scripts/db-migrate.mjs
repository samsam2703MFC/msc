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

  /* `CREATE TABLE IF NOT EXISTS` ne voit pas une colonne ajoutée après coup : sur
     une base déjà créée, le schéma passe et ne change rien. MySQL 8 n'accepte pas
     `ADD COLUMN IF NOT EXISTS`, alors on demande à information_schema.

     C'est le début du journal que le commentaire en tête promet : une ligne par
     colonne ajoutée depuis, appliquée seulement si elle manque. */
  const AJOUTS = [
    ['msc_adaptation', 'avant', "ADD COLUMN avant JSON NULL AFTER applique_le"],
    ['msc_ajustement', 'avant', "ADD COLUMN avant JSON NULL AFTER applique_le"],
  ];
  for (const [table, colonne, ddl] of AJOUTS) {
    const [[{ n }]] = await cnx.query(
      `SELECT COUNT(*) AS n FROM information_schema.columns
       WHERE table_schema = ? AND table_name = ? AND column_name = ?`,
      [nom, table, colonne],
    );
    if (n === 0) {
      await cnx.query(`ALTER TABLE \`${table}\` ${ddl}`);
      console.log(`+ ${table}.${colonne}`);
    }
  }

  const [tables] = await cnx.query(
    'SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ?',
    [nom],
  );
  console.log(`base « ${nom} » à jour — ${tables.length} tables`);
} finally {
  await cnx.end();
}
