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
import { CATALOGUE } from '../server/params.mjs';

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
    /* Le type de course : le catalogue de src/data/courses.ts, partagé par un
       objectif et le start qui le réalise. */
    ['msc_competition', 'type_course', "ADD COLUMN type_course VARCHAR(24) NULL AFTER discipline"],
    ['msc_objectif', 'type_course', "ADD COLUMN type_course VARCHAR(24) NULL AFTER cible_haute_s"],
    ['msc_adaptation', 'avant', "ADD COLUMN avant JSON NULL AFTER applique_le"],
    ['msc_ajustement', 'avant', "ADD COLUMN avant JSON NULL AFTER applique_le"],
    /* Le profil et la forme. Le poids vit déjà dans les mesures ; la HRV les
       rejoint, à côté de la FC de repos dont elle est l'autre moitié. */
    ['msc_athlete', 'prenom', "ADD COLUMN prenom VARCHAR(80) NULL AFTER nom"],
    ['msc_athlete', 'annee_naissance', "ADD COLUMN annee_naissance SMALLINT UNSIGNED NULL AFTER prenom"],
    ['msc_athlete', 'surnom', "ADD COLUMN surnom VARCHAR(40) NULL AFTER annee_naissance"],
    ['msc_athlete', 'coach', "ADD COLUMN coach VARCHAR(16) NOT NULL DEFAULT 'gentil' AFTER surnom"],
    ['msc_mesure', 'hrv_ms', "ADD COLUMN hrv_ms SMALLINT UNSIGNED NULL AFTER fc_repos"],
    /* Le coach qui parlait, sur chaque réponse et chaque analyse : le back
       office montre le ton avec le texte. */
    ['msc_chat', 'ton', "ADD COLUMN ton VARCHAR(16) NULL AFTER cout_eur"],
    ['msc_analyse', 'ton', "ADD COLUMN ton VARCHAR(16) NULL AFTER strava_lu"],
    /* La coche « séance faite » de l'athlète, à côté de ce que Strava dit. */
    ['msc_journal', 'fait',
      "ADD COLUMN fait TINYINT(1) NULL COMMENT '1 : l''athlète l''a dite faite ; 0 : pas faite ; NULL : rien dit — Strava compte à part' AFTER sommeil_h"],
    /* L'adaptation à jours glissants : les sept jours proposés, et un
       déplacement de séance qui atterrit un autre jour. */
    ['msc_analyse', 'glissant',
      "ADD COLUMN glissant JSON NULL COMMENT 'type glissant : le signal du matin, l’implication, les sept prochains jours ligne par ligne, la décision à valider' AFTER sources"],
    ['msc_ajustement', 'vers_date',
      "ADD COLUMN vers_date DATE NULL COMMENT 'un déplacement : le jour où la séance atterrit à l’acceptation' AFTER part"],
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
  /* msc_analyse.type gagne « glissant », et la contrainte de portée le connaît.
     Lus dans information_schema avant d'y toucher : une base créée depuis
     schema.sql les a déjà. */
  const [[colType]] = await cnx.query(
    `SELECT COLUMN_TYPE AS t FROM information_schema.columns
     WHERE table_schema = ? AND table_name = 'msc_analyse' AND column_name = 'type'`,
    [nom],
  );
  if (colType && !/glissant/.test(String(colType.t))) {
    await cnx.query(`ALTER TABLE msc_analyse MODIFY type ENUM('seance','hebdo','glissant') NOT NULL`);
    console.log('+ msc_analyse.type : glissant');
  }
  const [[ck]] = await cnx.query(
    `SELECT CHECK_CLAUSE AS c FROM information_schema.check_constraints
     WHERE constraint_schema = ? AND constraint_name = 'ck_analyse_portee'`,
    [nom],
  );
  if (!ck || !/glissant/.test(String(ck.c))) {
    if (ck) await cnx.query('ALTER TABLE msc_analyse DROP CONSTRAINT ck_analyse_portee');
    await cnx.query(
      `ALTER TABLE msc_analyse ADD CONSTRAINT ck_analyse_portee CHECK (
         (type = 'seance' AND session_id IS NOT NULL) OR
         (type = 'hebdo'  AND semaine IS NOT NULL AND plan_id IS NOT NULL) OR
         (type = 'glissant' AND plan_id IS NOT NULL))`,
    );
    console.log('+ ck_analyse_portee : glissant');
  }

  const LIGNES = [
    /* [table, colonne clé, valeur, INSERT, condition] — la condition dit si les
       parents existent : sur une base vierge (les contrôles, un premier
       déploiement), msc_type est vide jusqu'au seed, et le seed pose déjà ce
       motif depuis tables.ts. Ici, c'est pour la base vivante d'avant. */
    ['msc_excuse', 'code', 'trop_mange',
      `INSERT INTO msc_excuse (code, icon, type_code, session_exemple, ordre,
         label_fr, label_pl, reponse_fr, reponse_pl, remplacement_fr, remplacement_pl)
       VALUES ('trop_mange', 'utensils', 'recup', NULL, 5,
         'J’ai mangé comme un porc, j’arrive même plus à bouger',
         'Zjadłem jak świnia, nie mogę się ruszyć',
         'La digestion prend le sang que les jambes réclament. On laisse passer deux heures, puis vingt-cinq minutes très faciles : la qualité attend demain, la routine ne casse pas.',
         'Trawienie zabiera krew, o którą proszą nogi. Odczekujemy dwie godziny, potem 25 minut bardzo lekko: jakość czeka do jutra, rutyna się nie łamie.',
         'Récup 25 min · 6:30/km, deux heures après le repas',
         'Regeneracja 25 min · 6:30/km, dwie godziny po posiłku')`,
      "SELECT 1 FROM msc_type WHERE code = 'recup'"],
    /* Les deux statuts qui manquaient à la semaine : faite autrement (orange)
       et manquée (rouge). Sans parent : pas de condition. */
    ['msc_statut', 'code', 'partiel',
      "INSERT INTO msc_statut (code, icon, couleur) VALUES ('partiel', 'circle-minus', '#BA7517')"],
    ['msc_statut', 'code', 'manque',
      "INSERT INTO msc_statut (code, icon, couleur) VALUES ('manque', 'circle-x', '#D85A30')"],
  ];
  for (const [table, cle, valeur, sql, condition] of LIGNES) {
    const [[{ n }]] = await cnx.query(`SELECT COUNT(*) AS n FROM \`${table}\` WHERE \`${cle}\` = ?`, [valeur]);
    if (n !== 0) continue;
    if (condition) {
      const [parents] = await cnx.query(condition);
      if (parents.length === 0) {
        console.log(`· ${table} ${cle}=${valeur} : attend le vocabulaire (seed)`);
        continue;
      }
    }
    await cnx.query(sql);
    console.log(`+ ${table} ${cle}=${valeur}`);
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

  /* Le catalogue des paramètres : chaque clé posée si elle manque, et ses
     libellés, son défaut, son unité remis à jour à chaque passage. La valeur
     choisie et le secret scellé ne sont jamais touchés — c'est ce qu'on règle
     dans le back office, pas ce que le code décide. */
  /* Compté avant/après plutôt que par affectedRows : avec le drapeau
     FOUND_ROWS, une ligne identique compte pour 1 elle aussi. */
  const [[{ avant }]] = await cnx.query('SELECT COUNT(*) AS avant FROM msc_param');
  for (const p of CATALOGUE) {
    await cnx.query(
      `INSERT INTO msc_param (cle, groupe, type, defaut, unite, ordre, libelle_fr, libelle_pl, aide_fr, aide_pl)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE groupe = VALUES(groupe), type = VALUES(type), defaut = VALUES(defaut),
         unite = VALUES(unite), ordre = VALUES(ordre), libelle_fr = VALUES(libelle_fr),
         libelle_pl = VALUES(libelle_pl), aide_fr = VALUES(aide_fr), aide_pl = VALUES(aide_pl)`,
      [p.cle, p.groupe, p.type, p.defaut == null ? null : String(p.defaut), p.unite ?? null, p.ordre ?? 0,
       p.libelle.fr, p.libelle.pl, p.aide?.fr ?? null, p.aide?.pl ?? null],
    );
  }
  const [[{ apres }]] = await cnx.query('SELECT COUNT(*) AS apres FROM msc_param');
  if (apres > avant) console.log(`+ msc_param : ${apres - avant} paramètre(s) posé(s)`);

  const [tables] = await cnx.query(
    'SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ?',
    [nom],
  );
  console.log(`base « ${nom} » à jour — ${tables.length} tables`);
} finally {
  await cnx.end();
}
