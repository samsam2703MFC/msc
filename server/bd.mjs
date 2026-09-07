/* L'accès à la base.

   Un pool, quelques aides, et le scellement des jetons OAuth.

   Ce dernier point mérite son paragraphe. Tant que les jetons Strava vivaient
   dans un fichier 0600 à côté du serveur, les protéger était une affaire de
   permissions Unix. Une base de données est sauvegardée, répliquée, restaurée
   sur un poste de développement et lue par plus de monde qu'un fichier : un
   jeton en clair dedans est un jeton qui finit dans un dump. Ils sont donc
   chiffrés par l'application, avec une clé qui n'est pas dans la base — celui
   qui obtient l'une n'obtient pas l'autre. */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import mysql from 'mysql2/promise';

const ALGO = 'aes-256-gcm';
const IV_OCTETS = 12;
const TAG_OCTETS = 16;

export class BdError extends Error {}

/* ------------------------------------------------------------- le pool */

let pool;

export function config() {
  const url = process.env.MSC_DATABASE_URL;
  if (url) return { uri: url };
  return {
    host: process.env.MSC_DB_HOST ?? '127.0.0.1',
    port: Number(process.env.MSC_DB_PORT ?? 3306),
    user: process.env.MSC_DB_USER ?? 'msc',
    password: process.env.MSC_DB_PASSWORD ?? '',
    database: process.env.MSC_DB_NAME ?? 'msc',
    socketPath: process.env.MSC_DB_SOCKET || undefined,
  };
}

export function bd() {
  if (!pool) {
    pool = mysql.createPool({
      ...config(),
      waitForConnections: true,
      connectionLimit: Number(process.env.MSC_DB_POOL ?? 10),
      charset: 'utf8mb4',
      /* Les dates sont des dates, pas des instants : msc_session.date est un
         jour du plan et doit ressortir « 2026-10-14 », pas un Date décalé par
         le fuseau du serveur. */
      dateStrings: ['DATE'],
      timezone: 'Z',
      namedPlaceholders: true,
    });
  }
  return pool;
}

export async function fermer() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

/** Les lignes d'une requête. */
export async function lignes(sql, params) {
  const [rows] = await bd().execute(sql, params ?? {});
  return rows;
}

/** La première ligne, ou undefined. */
export async function ligne(sql, params) {
  const rows = await lignes(sql, params);
  return rows[0];
}

/** La première ligne, ou une erreur — pour ce dont l'appelant ne peut pas se passer. */
export async function ligneObligatoire(sql, params) {
  const r = await ligne(sql, params);
  if (!r) throw new BdError('aucune ligne ne correspond');
  return r;
}

export async function executer(sql, params) {
  const [resultat] = await bd().execute(sql, params ?? {});
  return resultat;
}

/** Une transaction. Le callback reçoit la connexion ; un jet annule tout. */
export async function transaction(travail) {
  const cnx = await bd().getConnection();
  try {
    await cnx.beginTransaction();
    const resultat = await travail(cnx);
    await cnx.commit();
    return resultat;
  } catch (e) {
    await cnx.rollback();
    throw e;
  } finally {
    cnx.release();
  }
}

/* --------------------------------------------------- le scellement des jetons */

function cle() {
  const brut = process.env.MSC_SECRET_KEY;
  if (!brut) {
    throw new BdError(
      'MSC_SECRET_KEY absent : les jetons Strava ne peuvent pas être chiffrés. ' +
        'Génère-la avec « node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))" ».',
    );
  }
  const octets = Buffer.from(brut, brut.length === 64 ? 'hex' : 'base64');
  if (octets.length !== 32) {
    throw new BdError(`MSC_SECRET_KEY doit faire 32 octets, pas ${octets.length}.`);
  }
  return octets;
}

/** Chiffre une valeur pour la colonne VARBINARY qui l'attend. */
export function sceller(texte) {
  const iv = randomBytes(IV_OCTETS);
  const chiffreur = createCipheriv(ALGO, cle(), iv);
  const chiffre = Buffer.concat([chiffreur.update(String(texte), 'utf8'), chiffreur.final()]);
  return Buffer.concat([iv, chiffreur.getAuthTag(), chiffre]);
}

/** L'inverse. Une valeur trafiquée lève plutôt que de rendre du n'importe quoi. */
export function desceller(scelle) {
  const octets = Buffer.isBuffer(scelle) ? scelle : Buffer.from(scelle);
  if (octets.length < IV_OCTETS + TAG_OCTETS) throw new BdError('valeur scellée tronquée');
  const dechiffreur = createDecipheriv(ALGO, cle(), octets.subarray(0, IV_OCTETS));
  dechiffreur.setAuthTag(octets.subarray(IV_OCTETS, IV_OCTETS + TAG_OCTETS));
  return Buffer.concat([
    dechiffreur.update(octets.subarray(IV_OCTETS + TAG_OCTETS)),
    dechiffreur.final(),
  ]).toString('utf8');
}

/** Whether the server can seal at all — checked at startup, not at first write. */
export function scellementPret() {
  try {
    cle();
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------- utilitaires */

/** Le SHA-256 d'un fichier reçu, pour que la même photo envoyée deux fois soit
    la même ligne plutôt que deux. */
export function empreinte(octets) {
  return createHash('sha256').update(octets).digest();
}

/** `{ fr, pl }` depuis deux colonnes `x_fr` / `x_pl`. */
export function localise(ligneSql, prefixe) {
  return { fr: ligneSql[`${prefixe}_fr`], pl: ligneSql[`${prefixe}_pl`] };
}
