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
    /* Le profil et la forme. Le poids vit déjà dans les mesures ; la HRV les
       rejoint, à côté de la FC de repos dont elle est l'autre moitié. */
    ['msc_athlete', 'prenom', "ADD COLUMN prenom VARCHAR(80) NULL AFTER nom"],
    ['msc_athlete', 'annee_naissance', "ADD COLUMN annee_naissance SMALLINT UNSIGNED NULL AFTER prenom"],
    ['msc_athlete', 'surnom', "ADD COLUMN surnom VARCHAR(40) NULL AFTER annee_naissance"],
    ['msc_athlete', 'coach', "ADD COLUMN coach VARCHAR(16) NOT NULL DEFAULT 'gentil' AFTER surnom"],
    ['msc_mesure', 'hrv_ms', "ADD COLUMN hrv_ms SMALLINT UNSIGNED NULL AFTER fc_repos"],
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

  /* Même journal pour le vocabulaire ajouté après coup. Le seed ne repasse
     jamais sur une base vivante, alors un motif de plus s'insère ici, s'il
     manque — le même texte que src/data/tables.ts, à garder identique. */
  const LIGNES = [
    ['msc_excuse', 'code', 'trop_mange',
      `INSERT INTO msc_excuse (code, icon, type_code, session_exemple, ordre,
         label_fr, label_pl, reponse_fr, reponse_pl, remplacement_fr, remplacement_pl)
       VALUES ('trop_mange', 'utensils', 'recup', NULL, 5,
         'J’ai mangé comme un porc, j’arrive même plus à bouger',
         'Zjadłem jak świnia, nie mogę się ruszyć',
         'La digestion prend le sang que les jambes réclament. On laisse passer deux heures, puis vingt-cinq minutes très faciles : la qualité attend demain, la routine ne casse pas.',
         'Trawienie zabiera krew, o którą proszą nogi. Odczekujemy dwie godziny, potem 25 minut bardzo lekko: jakość czeka do jutra, rutyna się nie łamie.',
         'Récup 25 min · 6:30/km, deux heures après le repas',
         'Regeneracja 25 min · 6:30/km, dwie godziny po posiłku')`],
  ];
  for (const [table, cle, valeur, sql] of LIGNES) {
    const [[{ n }]] = await cnx.query(`SELECT COUNT(*) AS n FROM \`${table}\` WHERE \`${cle}\` = ?`, [valeur]);
    if (n === 0) {
      await cnx.query(sql);
      console.log(`+ ${table} ${cle}=${valeur}`);
    }
  }

  /* Les libellés d'écran vivent dans msc_ui — un JSON par langue, copié de
     src/data/tables.ts au seed. Ceux qui changent après coup se rejouent ici,
     clé par clé ; les mêmes textes que tables.ts, à garder identiques. */
  const LIBELLES = [
    ['fr', { anaLabel: 'Le coach', anaIdle: 'Il en pense quoi le coach ?',
             anaRunning: 'Le coach lit ta séance…', anaDoneBtn: 'Redemander au coach' }],
    ['pl', { anaLabel: 'Trener', anaIdle: 'Co na to trener?',
             anaRunning: 'Trener czyta twój trening…', anaDoneBtn: 'Zapytaj trenera ponownie' }],
  ];
  for (const [langue, cles] of LIBELLES) {
    const paires = Object.entries(cles).flatMap(([k, v]) => [`$.${k}`, v]);
    const [r] = await cnx.query(
      `UPDATE msc_ui SET chaines = JSON_SET(chaines, ${Object.keys(cles).map(() => '?, ?').join(', ')})
       WHERE langue = ?`,
      [...paires, langue],
    );
    if (r.changedRows) console.log(`~ msc_ui ${langue} : ${Object.keys(cles).join(', ')}`);
  }

  const [tables] = await cnx.query(
    'SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ?',
    [nom],
  );
  console.log(`base « ${nom} » à jour — ${tables.length} tables`);
} finally {
  await cnx.end();
}
