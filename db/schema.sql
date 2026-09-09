-- MySmartCoach — le schéma.
--
-- Écrit pour MySQL 8 ; validé aussi sur MariaDB 10.11, d'où l'absence de
-- utf8mb4_0900_ai_ci et des quelques tournures propres à l'un ou à l'autre.
--
-- Quatre domaines, dans cet ordre : qui s'entraîne, ce que le plan prévoit, ce
-- qui s'est réellement passé, et ce que le coach en dit. Le back office lit les
-- deux derniers.
--
-- Deux règles tenues d'un bout à l'autre du fichier :
--
--   1. Aucune allure, aucune charge, aucun total n'est stocké s'il se calcule.
--      Le moteur dérive chaque allure de deux nombres portés par l'athlète, et
--      `check:engine` le vérifie contre le classeur, cellule par cellule. Une
--      allure en base serait une seconde vérité, et c'est celle qui se
--      trompe. Ce qui est stocké est ce qui est mesuré ou décidé.
--
--   2. Relationnel pour ce qui se filtre ou se joint, JSON pour ce qui ne se
--      relit qu'en bloc. « Quelles séances sont au seuil » et « quels jours
--      avec douleur tendineuse » sont des questions que le plan pose vraiment
--      — ce sont des tables. Les blocs d'affichage produits par Claude ne se
--      relisent jamais qu'entiers — c'est du JSON.
--
-- Tout texte destiné à l'athlète existe en deux colonnes, _fr et _pl.

SET NAMES utf8mb4;
SET time_zone = '+00:00';


-- ===========================================================================
-- 0. Comptes et accès
-- ===========================================================================

CREATE TABLE IF NOT EXISTS compte (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  email           VARCHAR(190) NOT NULL,
  mot_de_passe    VARCHAR(255) NOT NULL COMMENT 'argon2id ou bcrypt — jamais le mot de passe',
  nom             VARCHAR(120) NOT NULL,
  role            ENUM('athlete','coach','admin') NOT NULL DEFAULT 'athlete',
  actif           TINYINT(1) NOT NULL DEFAULT 1,
  cree_le         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  maj_le          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_compte_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Les deux références 10 km d'où sortent toutes les allures du plan, et les
-- planchers que le générateur ne franchit pas.
CREATE TABLE IF NOT EXISTS msc_athlete (
  id                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  compte_id            INT UNSIGNED NULL COMMENT 'null : un athlète encodé par un coach, sans login à lui',
  nom                  VARCHAR(120) NOT NULL,
  prenom               VARCHAR(80) NULL COMMENT 'le profil — « nom » reste ce que l''application affiche partout',
  annee_naissance      SMALLINT UNSIGNED NULL,
  surnom               VARCHAR(40) NULL COMMENT 'ce qui s''affiche sous l''avatar, et rien d''autre',
  ref_actuelle_s       SMALLINT UNSIGNED NOT NULL COMMENT 'allure 10 km actuelle, s/km — le test de 30 min la réécrit',
  ref_cible_s          SMALLINT UNSIGNED NOT NULL COMMENT 'allure 10 km visée, s/km',
  fc_repos             TINYINT UNSIGNED NULL,
  fc_repos_moy7        TINYINT UNSIGNED NULL,
  fc_moy_reference     TINYINT UNSIGNED NULL,
  derive_reference_pct DECIMAL(4,1) NULL COMMENT 'dérive cardiaque de référence sur la longue, %',
  plancher_heures      DECIMAL(4,1) NOT NULL DEFAULT 8.0,
  plancher_km_sortie   DECIMAL(4,1) NOT NULL DEFAULT 10.0,
  debut                DATE NOT NULL,
  note_fr              TEXT NULL,
  note_pl              TEXT NULL,
  cree_le              DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  maj_le               DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_athlete_compte (compte_id),
  CONSTRAINT fk_athlete_compte FOREIGN KEY (compte_id) REFERENCES compte (id) ON DELETE SET NULL,
  CONSTRAINT ck_athlete_refs CHECK (ref_cible_s <= ref_actuelle_s)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Ce qu'un compte peut voir. Un athlète a le sien ; un coach en a plusieurs.
CREATE TABLE IF NOT EXISTS msc_acces (
  compte_id   INT UNSIGNED NOT NULL,
  athlete_id  INT UNSIGNED NOT NULL,
  droit       ENUM('lecture','ecriture') NOT NULL DEFAULT 'lecture',
  cree_le     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (compte_id, athlete_id),
  KEY ix_acces_athlete (athlete_id),
  CONSTRAINT fk_acces_compte FOREIGN KEY (compte_id) REFERENCES compte (id) ON DELETE CASCADE,
  CONSTRAINT fk_acces_athlete FOREIGN KEY (athlete_id) REFERENCES msc_athlete (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ===========================================================================
-- 1. Le vocabulaire — partagé par tous les athlètes
-- ===========================================================================

-- Les quinze types de séance, avec ce que chacun achète et ce que dit la
-- littérature. C'est ce que la feuille « type » affiche.
CREATE TABLE IF NOT EXISTS msc_type (
  code      VARCHAR(16) NOT NULL,
  icon      VARCHAR(48) NOT NULL COMMENT 'nom d''icône Lucide',
  couleur   CHAR(7) NOT NULL,
  ordre     TINYINT UNSIGNED NOT NULL DEFAULT 0,
  label_fr  VARCHAR(80) NOT NULL,
  label_pl  VARCHAR(80) NOT NULL,
  gain_fr   VARCHAR(160) NOT NULL,
  gain_pl   VARCHAR(160) NOT NULL,
  why_fr    TEXT NOT NULL,
  why_pl    TEXT NOT NULL,
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Une ou deux lignes de littérature par type et par langue : une liste, donc
-- une table, parce qu'une liste dans une colonne se relit mal et se corrige mal.
CREATE TABLE IF NOT EXISTS msc_type_science (
  type_code VARCHAR(16) NOT NULL,
  langue    ENUM('fr','pl') NOT NULL,
  ordre     TINYINT UNSIGNED NOT NULL,
  texte     TEXT NOT NULL,
  PRIMARY KEY (type_code, langue, ordre),
  CONSTRAINT fk_science_type FOREIGN KEY (type_code) REFERENCES msc_type (code) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Les huit zones, en écart de secondes par km sur la référence 10 km du bloc.
-- C'est la moitié du moteur d'allures ; l'autre moitié est la part du bloc.
CREATE TABLE IF NOT EXISTS msc_zone (
  code      VARCHAR(16) NOT NULL,
  ordre     TINYINT UNSIGNED NOT NULL COMMENT 'de la plus lente à la plus rapide — l''ordre qui rend « pas plus rapide que prévu » comparable',
  ecart_s   SMALLINT NOT NULL COMMENT 'écart en s/km sur la référence 10 km du bloc : Récup +95 … VMA −10',
  icon      VARCHAR(48) NOT NULL,
  label_fr  VARCHAR(80) NOT NULL,
  label_pl  VARCHAR(80) NOT NULL,
  usage_fr  VARCHAR(190) NOT NULL,
  usage_pl  VARCHAR(190) NOT NULL,
  PRIMARY KEY (code),
  UNIQUE KEY uq_zone_ordre (ordre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS msc_statut (
  code     VARCHAR(16) NOT NULL,
  icon     VARCHAR(48) NOT NULL,
  couleur  CHAR(7) NOT NULL,
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- L'échelle de RPE, telle que l'athlète la lit sur l'écran Aujourd'hui.
CREATE TABLE IF NOT EXISTS msc_rpe (
  de       TINYINT UNSIGNED NOT NULL,
  a        TINYINT UNSIGNED NOT NULL,
  label_fr VARCHAR(80) NOT NULL,
  label_pl VARCHAR(80) NOT NULL,
  quoi_fr  VARCHAR(190) NOT NULL,
  quoi_pl  VARCHAR(190) NOT NULL,
  PRIMARY KEY (de),
  CONSTRAINT ck_rpe_intervalle CHECK (a >= de)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Les cinq raisons réelles pour lesquelles une journée dérape, et la réponse
-- du coach à chacune.
CREATE TABLE IF NOT EXISTS msc_excuse (
  code            VARCHAR(24) NOT NULL,
  icon            VARCHAR(48) NOT NULL,
  type_code       VARCHAR(16) NOT NULL COMMENT 'le type de la séance de remplacement',
  session_exemple INT UNSIGNED NULL COMMENT 'la séance sur laquelle la réponse a été écrite — un exemple, pas une clé étrangère : le vocabulaire ne dépend pas d''un plan',
  ordre           TINYINT UNSIGNED NOT NULL DEFAULT 0,
  label_fr        VARCHAR(120) NOT NULL,
  label_pl        VARCHAR(120) NOT NULL,
  reponse_fr      TEXT NOT NULL,
  reponse_pl      TEXT NOT NULL,
  remplacement_fr VARCHAR(190) NOT NULL,
  remplacement_pl VARCHAR(190) NOT NULL,
  PRIMARY KEY (code),
  CONSTRAINT fk_excuse_type FOREIGN KEY (type_code) REFERENCES msc_type (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Les règles d'ajustement, en données et pas en prose : chacune nomme le
-- signal qu'elle surveille, le comparateur et le seuil qui la déclenchent, et
-- l'effet. `evaluer(signaux)` les exécute au lieu qu'un humain les relise.
CREATE TABLE IF NOT EXISTS msc_regle (
  code          VARCHAR(32) NOT NULL,
  signal_code   VARCHAR(32) NOT NULL COMMENT 'rpe_qualite, derive_longue, fc_repos_delta… — SIGNAL est un mot réservé',
  operateur     ENUM('>','>=','<=','<') NOT NULL,
  seuil         DECIMAL(6,2) NOT NULL,
  jours         TINYINT UNSIGNED NULL COMMENT 'nombre de jours consécutifs où le signal doit tenir, là où ça compte',
  gravite       ENUM('ajuste','allege','stop') NOT NULL,
  ordre         TINYINT UNSIGNED NOT NULL DEFAULT 0,
  effet         JSON NOT NULL COMMENT 'l''effet, en six formes possibles — { type: "allure", secondes } … { type: "sacrifice", ordre } — relu en bloc par evaluer()',
  si_fr         VARCHAR(190) NOT NULL,
  si_pl         VARCHAR(190) NOT NULL,
  alors_fr      VARCHAR(190) NOT NULL,
  alors_pl      VARCHAR(190) NOT NULL,
  pourquoi_fr   TEXT NOT NULL,
  pourquoi_pl   TEXT NOT NULL,
  PRIMARY KEY (code),
  KEY ix_regle_signal (signal_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Les sources de données et les états de leur carte. Une ligne par source ;
-- Strava est la seule pour l'instant.
CREATE TABLE IF NOT EXISTS msc_source (
  code            VARCHAR(24) NOT NULL,
  canal           VARCHAR(24) NOT NULL COMMENT 'OAuth, MCP…',
  titre_absent_fr VARCHAR(120) NOT NULL, titre_absent_pl VARCHAR(120) NOT NULL,
  sous_absent_fr  VARCHAR(190) NOT NULL, sous_absent_pl  VARCHAR(190) NOT NULL,
  titre_off_fr    VARCHAR(120) NOT NULL, titre_off_pl    VARCHAR(120) NOT NULL,
  sous_off_fr     VARCHAR(190) NOT NULL, sous_off_pl     VARCHAR(190) NOT NULL,
  titre_liaison_fr VARCHAR(120) NOT NULL, titre_liaison_pl VARCHAR(120) NOT NULL,
  sous_liaison_fr VARCHAR(190) NOT NULL, sous_liaison_pl VARCHAR(190) NOT NULL,
  titre_on_fr     VARCHAR(120) NOT NULL, titre_on_pl     VARCHAR(120) NOT NULL,
  sous_on_fr      VARCHAR(190) NOT NULL, sous_on_pl      VARCHAR(190) NOT NULL,
  sous_synchro_fr VARCHAR(190) NOT NULL, sous_synchro_pl VARCHAR(190) NOT NULL,
  jamais_fr       VARCHAR(120) NOT NULL, jamais_pl       VARCHAR(120) NOT NULL,
  webhook_on_fr   VARCHAR(120) NOT NULL, webhook_on_pl   VARCHAR(120) NOT NULL,
  webhook_off_fr  VARCHAR(120) NOT NULL, webhook_off_pl  VARCHAR(120) NOT NULL,
  orphelines_fr   VARCHAR(120) NOT NULL, orphelines_pl   VARCHAR(120) NOT NULL,
  delier_fr       VARCHAR(80) NOT NULL,  delier_pl       VARCHAR(80) NOT NULL,
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Les quatre métriques de l'écran État de forme : leur définition seulement.
-- La valeur et la série de 28 jours se calculent depuis les activités et le
-- journal — les stocker, ce serait les laisser diverger de leur formule.
CREATE TABLE IF NOT EXISTS msc_metric (
  code       VARCHAR(24) NOT NULL,
  icon       VARCHAR(48) NOT NULL,
  couleur    CHAR(7) NOT NULL,
  ordre      TINYINT UNSIGNED NOT NULL DEFAULT 0,
  seuil      DECIMAL(6,2) NULL COMMENT 'au-delà, la barre passe en alerte',
  nom_fr     VARCHAR(80) NOT NULL, nom_pl     VARCHAR(80) NOT NULL,
  formule_fr VARCHAR(190) NOT NULL, formule_pl VARCHAR(190) NOT NULL,
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Les libellés de l'interface. Une ligne par langue, une colonne par chaîne —
-- une table clé/valeur se relirait en trente requêtes ou en une jointure de
-- trente lignes pour afficher un écran.
CREATE TABLE IF NOT EXISTS msc_ui (
  langue  ENUM('fr','pl') NOT NULL,
  chaines JSON NOT NULL COMMENT 'l''objet MscUiStrings tel quel : lu en bloc, jamais filtré',
  maj_le  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (langue)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ===========================================================================
-- 2. Le plan
--
-- Le plan est une entité à part entière, ce qu'il n'était pas tant qu'il n'y
-- avait qu'un athlète et qu'un classeur. Un athlète peut en avoir plusieurs :
-- celui du classeur, puis celui que le générateur produit. Un seul est actif.
--
-- C'est aussi ce qui répond à la question laissée ouverte — que devient le
-- journal attaché au plan qu'on remplace : rien. Le journal et les activités
-- appartiennent à l'athlète et pointent vers des séances ; remplacer un plan
-- crée des séances neuves et laisse les anciennes, et leur histoire avec.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS msc_plan (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  athlete_id  INT UNSIGNED NOT NULL,
  nom         VARCHAR(160) NOT NULL,
  origine     ENUM('classeur','genere') NOT NULL DEFAULT 'genere',
  debut       DATE NOT NULL,
  fin         DATE NOT NULL,
  actif       TINYINT(1) NOT NULL DEFAULT 0,
  methode     JSON NULL COMMENT 'la méthodologie renvoyée par Claude : principes, sources, réserves — relue en bloc',
  cree_le     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  maj_le      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_plan_athlete (athlete_id, actif),
  CONSTRAINT fk_plan_athlete FOREIGN KEY (athlete_id) REFERENCES msc_athlete (id) ON DELETE CASCADE,
  CONSTRAINT ck_plan_dates CHECK (fin >= debut)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Les blocs, et leur `part` : où le bloc se situe sur le chemin de la
-- référence actuelle vers la cible. A 0 · B 0,28 · C 0,65 · D 1,0. La
-- référence du bloc s'en déduit, elle ne se stocke pas.
CREATE TABLE IF NOT EXISTS msc_bloc (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  plan_id     INT UNSIGNED NOT NULL,
  code        VARCHAR(4) NOT NULL,
  part        DECIMAL(4,3) NOT NULL,
  semaine_de  SMALLINT UNSIGNED NOT NULL,
  semaine_a   SMALLINT UNSIGNED NOT NULL,
  nom_fr      VARCHAR(120) NOT NULL,
  nom_pl      VARCHAR(120) NOT NULL,
  focus_fr    VARCHAR(190) NULL,
  focus_pl    VARCHAR(190) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bloc_plan_code (plan_id, code),
  CONSTRAINT fk_bloc_plan FOREIGN KEY (plan_id) REFERENCES msc_plan (id) ON DELETE CASCADE,
  CONSTRAINT ck_bloc_part CHECK (part BETWEEN 0 AND 1),
  CONSTRAINT ck_bloc_semaines CHECK (semaine_a >= semaine_de)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Les totaux hebdomadaires tels que le classeur les pose. Le réalisé ne figure
-- pas ici : il se calcule depuis msc_activity, et deux vérités sur le même
-- nombre, c'est une de trop.
CREATE TABLE IF NOT EXISTS msc_week (
  id        INT UNSIGNED NOT NULL AUTO_INCREMENT,
  plan_id   INT UNSIGNED NOT NULL,
  semaine   SMALLINT UNSIGNED NOT NULL,
  bloc_id   INT UNSIGNED NOT NULL,
  phase     VARCHAR(120) NOT NULL,
  heures    DECIMAL(4,1) NOT NULL,
  km        DECIMAL(5,1) NULL,
  natation_m MEDIUMINT UNSIGNED NULL,
  charge    MEDIUMINT UNSIGNED NULL COMMENT 'charge prévue de la semaine : somme des durée × RPE cible',
  PRIMARY KEY (id),
  UNIQUE KEY uq_week_plan_semaine (plan_id, semaine),
  KEY ix_week_bloc (bloc_id),
  CONSTRAINT fk_week_plan FOREIGN KEY (plan_id) REFERENCES msc_plan (id) ON DELETE CASCADE,
  CONSTRAINT fk_week_bloc FOREIGN KEY (bloc_id) REFERENCES msc_bloc (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Les 243 séances. Aucune allure ici : les zones disent dans quoi la séance se
-- court, le moteur dit à quelle allure pour le bloc où elle tombe.
CREATE TABLE IF NOT EXISTS msc_session (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  plan_id      INT UNSIGNED NOT NULL,
  semaine      SMALLINT UNSIGNED NOT NULL,
  bloc_id      INT UNSIGNED NOT NULL,
  date         DATE NOT NULL,
  ordre        TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'départage deux séances du même jour : nage le matin, vélo le soir',
  jour_long    VARCHAR(48) NOT NULL,
  jour_fr      VARCHAR(8) NOT NULL,
  jour_pl      VARCHAR(8) NOT NULL,
  phase        VARCHAR(120) NOT NULL,
  discipline   VARCHAR(32) NOT NULL COMMENT 'Course à pied, Natation, Vélo, Hyrox, Repos',
  type_code    VARCHAR(16) NOT NULL,
  duree_min    SMALLINT UNSIGNED NOT NULL,
  rpe_cible    TINYINT UNSIGNED NOT NULL,
  charge       SMALLINT UNSIGNED NOT NULL COMMENT 'charge prévue = durée × RPE cible, dénormalisée depuis le classeur et vérifiée par check:engine',
  distance_km  DECIMAL(5,2) NULL,
  natation_m   MEDIUMINT UNSIGNED NULL,
  titre_fr     VARCHAR(190) NOT NULL, titre_pl       VARCHAR(190) NOT NULL,
  titre_court_fr VARCHAR(120) NOT NULL, titre_court_pl VARCHAR(120) NOT NULL,
  meta_fr      VARCHAR(120) NOT NULL, meta_pl        VARCHAR(120) NOT NULL,
  detail_fr    TEXT NOT NULL,        detail_pl      TEXT NOT NULL,
  consigne_fr  VARCHAR(190) NULL,    consigne_pl    VARCHAR(190) NULL,
  but_fr       VARCHAR(190) NULL,    but_pl         VARCHAR(190) NULL,
  reussite_fr  VARCHAR(190) NULL,    reussite_pl    VARCHAR(190) NULL,
  adapte_par   VARCHAR(64) NULL COMMENT 'la règle ou l''analyse qui a modifié la séance, si elle l''a été',
  maj_le       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_session_plan_jour (plan_id, date, ordre),
  KEY ix_session_plan_semaine (plan_id, semaine),
  KEY ix_session_date (date),
  KEY ix_session_type (type_code),
  KEY ix_session_bloc (bloc_id),
  CONSTRAINT fk_session_plan FOREIGN KEY (plan_id) REFERENCES msc_plan (id) ON DELETE CASCADE,
  CONSTRAINT fk_session_bloc FOREIGN KEY (bloc_id) REFERENCES msc_bloc (id) ON DELETE CASCADE,
  CONSTRAINT fk_session_type FOREIGN KEY (type_code) REFERENCES msc_type (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Les zones d'une séance. Une table et pas un tableau : « quelles séances sont
-- au seuil » est une question que le plan pose pour de bon, et l'ajustement du
-- coach compare l'ordre des zones pour refuser d'aiguiser une séance.
CREATE TABLE IF NOT EXISTS msc_session_zone (
  session_id INT UNSIGNED NOT NULL,
  zone_code  VARCHAR(16) NOT NULL,
  ordre      TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (session_id, zone_code),
  KEY ix_session_zone_zone (zone_code),
  CONSTRAINT fk_sz_session FOREIGN KEY (session_id) REFERENCES msc_session (id) ON DELETE CASCADE,
  CONSTRAINT fk_sz_zone FOREIGN KEY (zone_code) REFERENCES msc_zone (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Les étapes d'une séance, quand la feuille de séance les détaille.
CREATE TABLE IF NOT EXISTS msc_session_step (
  session_id INT UNSIGNED NOT NULL,
  ordre      TINYINT UNSIGNED NOT NULL,
  duree      VARCHAR(24) NOT NULL,
  icon       VARCHAR(48) NOT NULL,
  detail_fr  VARCHAR(190) NOT NULL,
  detail_pl  VARCHAR(190) NOT NULL,
  PRIMARY KEY (session_id, ordre),
  CONSTRAINT fk_step_session FOREIGN KEY (session_id) REFERENCES msc_session (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ---------------------------------------------------------------------------
-- Les compétitions — encodées au back office, visées par le plan
--
-- Une compétition est une course, courue ou à courir : elle appartient à
-- l'athlète, pas au plan. Un objectif est ce qu'un plan en vise ; un résultat
-- est ce qu'elle a donné. C'est cette séparation qui rend les graphiques
-- d'évolution possibles : les résultats survivent aux plans qui les visaient.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS msc_competition (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  athlete_id  INT UNSIGNED NOT NULL,
  date        DATE NOT NULL,
  nom         VARCHAR(190) NOT NULL,
  lieu        VARCHAR(160) NULL,
  pays        CHAR(2) NULL,
  discipline  VARCHAR(32) NOT NULL DEFAULT 'Course à pied',
  distance_km DECIMAL(6,3) NOT NULL,
  denivele_m  MEDIUMINT NULL,
  officielle  TINYINT(1) NOT NULL DEFAULT 1 COMMENT '0 : une sortie chronométrée qui sert de repère sans être une course',
  note        TEXT NULL,
  cree_le     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  maj_le      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_competition_athlete_date (athlete_id, date),
  CONSTRAINT fk_competition_athlete FOREIGN KEY (athlete_id) REFERENCES msc_athlete (id) ON DELETE CASCADE,
  CONSTRAINT ck_competition_distance CHECK (distance_km > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Ce qu'une compétition a donné. L'allure ne figure pas : temps / distance,
-- et la distance est sur la compétition.
CREATE TABLE IF NOT EXISTS msc_resultat (
  competition_id       INT UNSIGNED NOT NULL,
  temps_s              MEDIUMINT UNSIGNED NOT NULL,
  classement           MEDIUMINT UNSIGNED NULL,
  classement_categorie MEDIUMINT UNSIGNED NULL,
  categorie            VARCHAR(24) NULL,
  partants             MEDIUMINT UNSIGNED NULL,
  fc_moy               TINYINT UNSIGNED NULL,
  abandon              TINYINT(1) NOT NULL DEFAULT 0,
  activity_id          BIGINT UNSIGNED NULL COMMENT 'l''activité Strava correspondante, si elle a été appariée',
  note                 TEXT NULL,
  cree_le              DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  maj_le               DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (competition_id),
  CONSTRAINT fk_resultat_competition FOREIGN KEY (competition_id) REFERENCES msc_competition (id) ON DELETE CASCADE,
  CONSTRAINT ck_resultat_temps CHECK (temps_s > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Ce qu'un plan vise sur une compétition. La cible est une fourchette : le
-- générateur prend le milieu pour un jalon et le bas pour l'objectif principal.
CREATE TABLE IF NOT EXISTS msc_objectif (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  plan_id        INT UNSIGNED NOT NULL,
  competition_id INT UNSIGNED NOT NULL,
  semaine        SMALLINT UNSIGNED NOT NULL,
  principal      TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'la course dont le plan est compté à rebours',
  cible_s        MEDIUMINT UNSIGNED NOT NULL COMMENT 'le bas de la fourchette, en secondes',
  cible_haute_s  MEDIUMINT UNSIGNED NOT NULL COMMENT 'le haut',
  cible_fr       VARCHAR(80) NOT NULL, cible_pl VARCHAR(80) NOT NULL,
  role_fr        TEXT NULL, role_pl TEXT NULL COMMENT 'ce que la course joue dans le plan : jalon, juge de paix, objectif',
  PRIMARY KEY (id),
  UNIQUE KEY uq_objectif_plan_competition (plan_id, competition_id),
  KEY ix_objectif_competition (competition_id),
  CONSTRAINT fk_objectif_plan FOREIGN KEY (plan_id) REFERENCES msc_plan (id) ON DELETE CASCADE,
  CONSTRAINT fk_objectif_competition FOREIGN KEY (competition_id) REFERENCES msc_competition (id) ON DELETE CASCADE,
  CONSTRAINT ck_objectif_cibles CHECK (cible_haute_s >= cible_s)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ===========================================================================
-- 3. Ce qui s'est réellement passé
-- ===========================================================================

-- Le compte Strava d'un athlète. Les jetons sont chiffrés par l'application
-- (AES-256-GCM, clé hors base) : une base de données est sauvegardée, répliquée
-- et lue par plus de monde qu'un fichier 0600, et un jeton OAuth en clair y est
-- un jeton qui finit dans un dump.
CREATE TABLE IF NOT EXISTS msc_strava_compte (
  athlete_id        INT UNSIGNED NOT NULL,
  strava_athlete_id BIGINT UNSIGNED NOT NULL,
  prenom            VARCHAR(120) NULL,
  nom               VARCHAR(120) NULL,
  access_token      VARBINARY(512) NOT NULL COMMENT 'scellé : iv || tag || chiffré',
  refresh_token     VARBINARY(512) NOT NULL,
  expires_at        DATETIME NOT NULL,
  portee            VARCHAR(120) NOT NULL COMMENT 'les portées réellement accordées, qui peuvent être plus étroites que demandées',
  lie_le            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  derniere_synchro  DATETIME(3) NULL,
  PRIMARY KEY (athlete_id),
  UNIQUE KEY uq_strava_athlete (strava_athlete_id),
  CONSTRAINT fk_strava_athlete FOREIGN KEY (athlete_id) REFERENCES msc_athlete (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Les événements poussés par le webhook. Strava ne les signe pas, alors on
-- garde qui les a envoyés : un événement qui ne nomme pas l'athlète dont on
-- détient le jeton n'est pas le nôtre.
CREATE TABLE IF NOT EXISTS msc_strava_evenement (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  strava_athlete_id BIGINT UNSIGNED NOT NULL,
  objet             VARCHAR(16) NOT NULL COMMENT 'activity | athlete',
  aspect            VARCHAR(16) NOT NULL COMMENT 'create | update | delete',
  objet_id          BIGINT UNSIGNED NULL,
  revoque           TINYINT(1) NOT NULL DEFAULT 0,
  charge_utile      JSON NULL,
  recu_le           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  traite_le         DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY ix_evenement_athlete (strava_athlete_id, recu_le),
  KEY ix_evenement_a_traiter (traite_le)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Ce que Strava renvoie : des agrégats, jamais les streams bruts. Tirer des
-- traces GPS qu'on n'affiche pas coûte du quota à l'athlète et de la vie privée
-- pour rien ; le coach va les lire à la demande, par le serveur MCP.
--
-- session_id est nullable, et c'est le cœur de l'appariement : une sortie vélo
-- un jour de repos n'est pas une séance faite, c'est une activité orpheline.
CREATE TABLE IF NOT EXISTS msc_activity (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  athlete_id    INT UNSIGNED NOT NULL,
  id_strava     BIGINT UNSIGNED NULL COMMENT 'null : une activité saisie à la main',
  session_id    INT UNSIGNED NULL,
  date          DATE NOT NULL COMMENT 'le jour local de l''athlète — start_date_local, pas l''UTC',
  debut         DATETIME NULL,
  nom           VARCHAR(190) NULL,
  sport         VARCHAR(16) NOT NULL COMMENT 'run | swim | bike | hyrox | autre',
  sport_strava  VARCHAR(48) NULL,
  duree_min     SMALLINT UNSIGNED NOT NULL,
  duree_s       MEDIUMINT UNSIGNED NULL,
  distance_m    MEDIUMINT UNSIGNED NULL,
  denivele_m    MEDIUMINT NULL,
  allure_s_km   SMALLINT UNSIGNED NULL COMMENT 'mesurée, pas prescrite — la seule allure que la base stocke',
  fc_moy        TINYINT UNSIGNED NULL,
  fc_max        TINYINT UNSIGNED NULL,
  cadence_moy   TINYINT UNSIGNED NULL,
  effort        SMALLINT UNSIGNED NULL COMMENT 'le suffer score de Strava — ce n''est pas le RPE, qui reste à l''athlète',
  manuelle      TINYINT(1) NOT NULL DEFAULT 0,
  privee        TINYINT(1) NOT NULL DEFAULT 0,
  statut        VARCHAR(16) NOT NULL DEFAULT 'fait',
  maj_le        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_activity_strava (athlete_id, id_strava),
  UNIQUE KEY uq_activity_session (session_id) COMMENT 'une séance est faite une fois — l''appariement ne peut pas la donner deux fois',
  KEY ix_activity_athlete_date (athlete_id, date),
  CONSTRAINT fk_activity_athlete FOREIGN KEY (athlete_id) REFERENCES msc_athlete (id) ON DELETE CASCADE,
  CONSTRAINT fk_activity_session FOREIGN KEY (session_id) REFERENCES msc_session (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Les blocs de travail d'une séance de qualité, en secondes par km. Une table
-- et pas un tableau : la dérive du premier au dernier est ce que deux règles
-- d'ajustement surveillent, et elle se calcule en SQL.
CREATE TABLE IF NOT EXISTS msc_activity_bloc (
  activity_id BIGINT UNSIGNED NOT NULL,
  ordre       TINYINT UNSIGNED NOT NULL,
  allure_s_km SMALLINT UNSIGNED NOT NULL,
  duree_s     MEDIUMINT UNSIGNED NULL,
  distance_m  MEDIUMINT UNSIGNED NULL,
  fc_moy      TINYINT UNSIGNED NULL,
  PRIMARY KEY (activity_id, ordre),
  CONSTRAINT fk_bloc_activity FOREIGN KEY (activity_id) REFERENCES msc_activity (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Le journal : le RPE ressenti et la note, saisis à la main chaque jour. C'est
-- la moitié de la charge de Foster, et la seule que Strava ne donnera jamais.
CREATE TABLE IF NOT EXISTS msc_journal (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  athlete_id   INT UNSIGNED NOT NULL,
  session_id   INT UNSIGNED NULL,
  date         DATE NOT NULL,
  rpe_ressenti TINYINT UNSIGNED NULL,
  sommeil_h    DECIMAL(3,1) NULL,
  note         TEXT NULL,
  maj_le       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_journal_seance (athlete_id, date, session_id),
  KEY ix_journal_athlete_date (athlete_id, date),
  CONSTRAINT fk_journal_athlete FOREIGN KEY (athlete_id) REFERENCES msc_athlete (id) ON DELETE CASCADE,
  CONSTRAINT fk_journal_session FOREIGN KEY (session_id) REFERENCES msc_session (id) ON DELETE SET NULL,
  CONSTRAINT ck_journal_rpe CHECK (rpe_ressenti IS NULL OR rpe_ressenti BETWEEN 1 AND 10)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Les douleurs déclarées. Une table, parce que « douleur tendineuse deux jours
-- de suite » est exactement ce qu'une règle surveille, et qu'une liste dans une
-- colonne ne se compte pas sur deux jours.
CREATE TABLE IF NOT EXISTS msc_journal_douleur (
  journal_id BIGINT UNSIGNED NOT NULL,
  douleur    VARCHAR(48) NOT NULL,
  PRIMARY KEY (journal_id, douleur),
  KEY ix_douleur (douleur),
  CONSTRAINT fk_douleur_journal FOREIGN KEY (journal_id) REFERENCES msc_journal (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ---------------------------------------------------------------------------
-- La photo, le poids et la FC de repos
--
-- L'app envoie une photo — la balance, l'écran de la montre — et Claude la lit.
-- Trois tables plutôt qu'une, parce que ce sont trois faits différents :
-- le fichier reçu, ce qu'un modèle a cru y lire, et la mesure qui fait foi.
--
-- Ce qu'un modèle lit sur une balance floue ne devient pas le poids de
-- l'athlète sans qu'il l'ait vu : msc_mesure.etat vaut « propose » jusqu'à ce
-- qu'il confirme. Une extraction ratée est une extraction rejetée, pas une
-- ligne effacée — on veut savoir sur quoi le modèle se trompe.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS msc_photo (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  athlete_id  INT UNSIGNED NOT NULL,
  chemin      VARCHAR(255) NOT NULL COMMENT 'relatif à la racine de stockage — jamais un chemin absolu en base',
  mime        VARCHAR(64) NOT NULL,
  octets      INT UNSIGNED NOT NULL,
  largeur     SMALLINT UNSIGNED NULL,
  hauteur     SMALLINT UNSIGNED NULL,
  sha256      BINARY(32) NOT NULL COMMENT 'la même photo envoyée deux fois est la même ligne',
  prise_le    DATETIME NULL COMMENT 'l''EXIF, quand il y en a — sinon la réception fait foi',
  cree_le     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_photo_sha (athlete_id, sha256),
  KEY ix_photo_athlete (athlete_id, cree_le),
  CONSTRAINT fk_photo_athlete FOREIGN KEY (athlete_id) REFERENCES msc_athlete (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS msc_extraction (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  photo_id    BIGINT UNSIGNED NOT NULL,
  modele      VARCHAR(64) NOT NULL,
  poids_kg    DECIMAL(5,2) NULL,
  fc_repos    TINYINT UNSIGNED NULL,
  confiance   ENUM('haute','moyenne','basse') NULL,
  lu          TEXT NULL COMMENT 'ce que le modèle dit avoir lu, mot pour mot — de quoi comprendre une erreur',
  cout_eur    DECIMAL(8,4) NOT NULL DEFAULT 0,
  echec       VARCHAR(190) NULL COMMENT 'renseigné quand le modèle n''a rien pu lire ; la ligne reste, l''échec s''étudie',
  cree_le     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_extraction_photo (photo_id),
  CONSTRAINT fk_extraction_photo FOREIGN KEY (photo_id) REFERENCES msc_photo (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- La mesure qui fait foi. Une par athlète et par jour ; elle remplace
-- msc_daily, qui ne portait que la FC de repos.
CREATE TABLE IF NOT EXISTS msc_mesure (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  athlete_id    INT UNSIGNED NOT NULL,
  date          DATE NOT NULL,
  poids_kg      DECIMAL(5,2) NULL,
  fc_repos      TINYINT UNSIGNED NULL,
  hrv_ms        SMALLINT UNSIGNED NULL COMMENT 'variabilité cardiaque du matin, ms — avec la FC de repos, ce dont la forme se déduit',
  source        ENUM('photo','saisie','import') NOT NULL DEFAULT 'photo',
  etat          ENUM('propose','confirme','rejete') NOT NULL DEFAULT 'propose',
  photo_id      BIGINT UNSIGNED NULL,
  extraction_id BIGINT UNSIGNED NULL,
  confirme_le   DATETIME(3) NULL,
  note          VARCHAR(190) NULL,
  maj_le        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_mesure_jour (athlete_id, date),
  KEY ix_mesure_etat (athlete_id, etat),
  CONSTRAINT fk_mesure_athlete FOREIGN KEY (athlete_id) REFERENCES msc_athlete (id) ON DELETE CASCADE,
  CONSTRAINT fk_mesure_photo FOREIGN KEY (photo_id) REFERENCES msc_photo (id) ON DELETE SET NULL,
  CONSTRAINT fk_mesure_extraction FOREIGN KEY (extraction_id) REFERENCES msc_extraction (id) ON DELETE SET NULL,
  CONSTRAINT ck_mesure_poids CHECK (poids_kg IS NULL OR poids_kg BETWEEN 25 AND 300),
  CONSTRAINT ck_mesure_fc CHECK (fc_repos IS NULL OR fc_repos BETWEEN 25 AND 120)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ===========================================================================
-- 4. Ce que le coach en dit
--
-- Ici et seulement ici, du JSON. Les statistiques d'une analyse et les blocs
-- d'observation sont des charges d'affichage : produits en une fois, relus
-- entiers, jamais filtrés ni joints. Les éclater en tables coûterait quatre
-- jointures pour peindre une carte, sans qu'aucune requête ne s'en serve.
--
-- Les chiffres qu'ils contiennent, eux, ne viennent pas du modèle : la dérive,
-- l'allure contre la zone, la charge de Foster sont calculées par le moteur et
-- données à Claude pour qu'il les cite.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS msc_analyse (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  athlete_id  INT UNSIGNED NOT NULL,
  type        ENUM('seance','hebdo') NOT NULL,
  session_id  INT UNSIGNED NULL COMMENT 'renseigné pour une analyse de séance',
  plan_id     INT UNSIGNED NULL,
  semaine     SMALLINT UNSIGNED NULL COMMENT 'renseigné pour un verdict hebdomadaire',
  date        DATE NOT NULL,
  modele      VARCHAR(64) NOT NULL,
  cout_eur    DECIMAL(8,4) NOT NULL DEFAULT 0,
  strava_lu   TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'le serveur MCP a-t-il répondu pour cet appel',
  verdict_fr  TEXT NOT NULL, verdict_pl TEXT NOT NULL,
  stats       JSON NULL COMMENT 'les chiffres calculés par le moteur, figés tels qu''affichés',
  blocs       JSON NULL COMMENT 'les observations « bon » / « attention »',
  sources     JSON NULL COMMENT 'ce que Claude est allé lire dans Strava au-delà du contexte fourni',
  cree_le     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_analyse_seance (session_id),
  UNIQUE KEY uq_analyse_hebdo (plan_id, semaine),
  KEY ix_analyse_athlete (athlete_id, date),
  CONSTRAINT fk_analyse_athlete FOREIGN KEY (athlete_id) REFERENCES msc_athlete (id) ON DELETE CASCADE,
  CONSTRAINT fk_analyse_session FOREIGN KEY (session_id) REFERENCES msc_session (id) ON DELETE CASCADE,
  CONSTRAINT fk_analyse_plan FOREIGN KEY (plan_id) REFERENCES msc_plan (id) ON DELETE CASCADE,
  CONSTRAINT ck_analyse_portee CHECK (
    (type = 'seance' AND session_id IS NOT NULL) OR
    (type = 'hebdo'  AND semaine IS NOT NULL AND plan_id IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- L'adaptation de la séance suivante, après une séance. Une proposition, jamais
-- une écriture directe : `applique_le` dit si l'athlète l'a acceptée.
--
-- La zone et la part sont stockées, pas l'allure ni les minutes : c'est ce que
-- le modèle a choisi, et le moteur en tire « 44 min · 6:20/km » à l'affichage.
-- Changer la référence 10 km de l'athlète doit faire glisser cette ligne comme
-- il fait glisser tout le reste.
CREATE TABLE IF NOT EXISTS msc_adaptation (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  analyse_id   BIGINT UNSIGNED NOT NULL,
  session_id   INT UNSIGNED NOT NULL COMMENT 'la séance visée',
  zone_code    VARCHAR(16) NULL COMMENT 'null pour une séance que le plan n''écrit pas en allures : Hyrox, nage, vélo',
  part_duree   DECIMAL(4,3) NOT NULL DEFAULT 1.000,
  pourquoi_fr  TEXT NOT NULL, pourquoi_pl TEXT NOT NULL,
  applique_le  DATETIME(3) NULL,
  avant        JSON NULL COMMENT 'la séance telle qu''elle était juste avant l''acceptation — relue en bloc, pour « 68 min → 54 min » et pour le retrait',
  cree_le      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_adaptation_analyse (analyse_id),
  KEY ix_adaptation_session (session_id),
  CONSTRAINT fk_adaptation_analyse FOREIGN KEY (analyse_id) REFERENCES msc_analyse (id) ON DELETE CASCADE,
  CONSTRAINT fk_adaptation_session FOREIGN KEY (session_id) REFERENCES msc_session (id) ON DELETE CASCADE,
  CONSTRAINT fk_adaptation_zone FOREIGN KEY (zone_code) REFERENCES msc_zone (code),
  CONSTRAINT ck_adaptation_part CHECK (part_duree BETWEEN 0.500 AND 1.000)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Les ajustements d'un réétalonnage hebdomadaire, acceptés un par un. Soit une
-- séance et une part de sa quantité, soit une semaine et ce qui s'y déplace.
CREATE TABLE IF NOT EXISTS msc_ajustement (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  analyse_id   BIGINT UNSIGNED NOT NULL,
  session_id   INT UNSIGNED NULL,
  semaine      SMALLINT UNSIGNED NULL,
  type_code    VARCHAR(16) NOT NULL,
  part         DECIMAL(4,3) NULL COMMENT 'la quantité de la séance — sa durée, ou ses mètres pour une nage — en fraction du prévu',
  texte_fr     VARCHAR(190) NULL, texte_pl VARCHAR(190) NULL COMMENT 'pour un ajustement de semaine : ce qui bouge, sans chiffre',
  applique_le  DATETIME(3) NULL,
  avant        JSON NULL COMMENT 'la séance telle qu''elle était juste avant l''acceptation — voir msc_adaptation.avant',
  cree_le      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_ajustement_analyse (analyse_id),
  KEY ix_ajustement_session (session_id),
  CONSTRAINT fk_ajustement_analyse FOREIGN KEY (analyse_id) REFERENCES msc_analyse (id) ON DELETE CASCADE,
  CONSTRAINT fk_ajustement_session FOREIGN KEY (session_id) REFERENCES msc_session (id) ON DELETE CASCADE,
  CONSTRAINT fk_ajustement_type FOREIGN KEY (type_code) REFERENCES msc_type (code),
  CONSTRAINT ck_ajustement_part CHECK (part IS NULL OR part BETWEEN 0.500 AND 1.250),
  CONSTRAINT ck_ajustement_portee CHECK (session_id IS NOT NULL OR semaine IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- L'écart d'une semaine. Les trois chiffres sont arithmétiques et se
-- recalculent à chaque affichage ; ce qui se stocke est la lecture qu'en fait
-- Claude, et les portées du réétalonnage.
CREATE TABLE IF NOT EXISTS msc_ecart (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  analyse_id BIGINT UNSIGNED NOT NULL,
  plan_id    INT UNSIGNED NOT NULL,
  semaine    SMALLINT UNSIGNED NOT NULL,
  texte_fr   TEXT NOT NULL, texte_pl TEXT NOT NULL,
  recalcul   JSON NOT NULL COMMENT 'les portées et ce qui y change — de la prose, sans chiffre',
  cree_le    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_ecart_semaine (plan_id, semaine),
  KEY ix_ecart_analyse (analyse_id),
  CONSTRAINT fk_ecart_analyse FOREIGN KEY (analyse_id) REFERENCES msc_analyse (id) ON DELETE CASCADE,
  CONSTRAINT fk_ecart_plan FOREIGN KEY (plan_id) REFERENCES msc_plan (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Les fils de discussion des deux barres de chat : celle du Coach et celle de
-- chaque séance.
CREATE TABLE IF NOT EXISTS msc_chat (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  athlete_id INT UNSIGNED NOT NULL,
  fil        VARCHAR(48) NOT NULL COMMENT '« coach » ou « session:1052 »',
  ordre      INT UNSIGNED NOT NULL,
  role       ENUM('user','assistant') NOT NULL,
  texte      TEXT NOT NULL,
  modele     VARCHAR(64) NULL,
  cout_eur   DECIMAL(8,4) NULL,
  cree_le    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_chat_tour (athlete_id, fil, ordre),
  CONSTRAINT fk_chat_athlete FOREIGN KEY (athlete_id) REFERENCES msc_athlete (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ===========================================================================
-- 5. La synchronisation
--
-- L'app est une PWA installée : elle doit rester lisible sans réseau, et ce que
-- l'athlète tape hors ligne — un RPE, une note, une mesure — doit partir au
-- retour. Deux choses le rendent sûr.
--
-- `maj_le` sur toute table qu'un client lit : l'app demande ce qui a changé
-- depuis sa dernière synchro au lieu de tout retélécharger.
--
-- `msc_mutation` pour ce qu'il écrit : le client génère un identifiant par
-- mutation avant de l'envoyer, et le serveur le refuse s'il l'a déjà vu. Sans
-- ça, une file d'attente qui rejoue après une coupure enregistre deux fois le
-- même RPE, et personne ne s'en aperçoit.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS msc_mutation (
  id         CHAR(36) NOT NULL COMMENT 'UUID généré par le client, avant l''envoi',
  athlete_id INT UNSIGNED NOT NULL,
  operation  VARCHAR(48) NOT NULL,
  reponse    JSON NULL COMMENT 'la réponse rendue la première fois — rejouée telle quelle à un doublon',
  cree_le    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_mutation_athlete (athlete_id, cree_le),
  CONSTRAINT fk_mutation_athlete FOREIGN KEY (athlete_id) REFERENCES msc_athlete (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
