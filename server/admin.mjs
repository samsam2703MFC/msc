/* Le back office : les comptes, les athlètes, ce qui les relie, et l'état du
   serveur. Réservé au rôle admin — c'est index.mjs qui le vérifie, ici on ne
   fait que le travail.

   Deux règles qu'on ne discute pas à l'écran :
   - un admin ne peut pas se retirer à lui-même le rôle ou l'accès, ni les
     retirer au dernier admin actif : le back office ne doit jamais se fermer
     de l'intérieur ;
   - un mot de passe respecte securite.mdp_min, le même seuil que la ligne de
     commande (scripts/compte.mjs) — le back office n'est pas une porte de
     service. */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hacher } from './auth.mjs';
import { bd, ligne, lignes, scellementPret } from './bd.mjs';
import { etatDemo, retirerDemo } from './demo.mjs';
import * as params from './params.mjs';
import * as strava from './strava.mjs';

export class AdminError extends Error {
  constructor(message, code = 400) {
    super(message);
    this.code = code;
  }
}

const ROLES = ['athlete', 'coach', 'admin'];
const DROITS = ['lecture', 'ecriture'];

/* ------------------------------------------------------------- les comptes */

const SELECT_COMPTES = `
  SELECT c.id, c.email, c.nom, c.role, c.actif, c.cree_le,
         c.mot_de_passe = '!' AS sans_mot_de_passe
  FROM compte c`;

async function athletesParCompte() {
  const acces = await lignes(
    `SELECT x.compte_id, a.id, a.nom, x.droit
     FROM msc_acces x JOIN msc_athlete a ON a.id = x.athlete_id
     ORDER BY a.nom`,
  );
  const par = new Map();
  for (const x of acces) {
    if (!par.has(x.compte_id)) par.set(x.compte_id, []);
    par.get(x.compte_id).push({ id: x.id, nom: x.nom, droit: x.droit });
  }
  return par;
}

function formeCompte(c, athletes) {
  return {
    id: c.id,
    email: c.email,
    nom: c.nom,
    role: c.role,
    actif: Boolean(c.actif),
    sans_mot_de_passe: Boolean(c.sans_mot_de_passe),
    cree_le: c.cree_le,
    athletes: athletes ?? [],
  };
}

export async function comptes() {
  const [cs, par, athletes] = await Promise.all([
    lignes(`${SELECT_COMPTES} ORDER BY c.email`),
    athletesParCompte(),
    lignes(
      `SELECT id, nom, prenom, compte_id, ref_actuelle_s, ref_cible_s, debut
       FROM msc_athlete ORDER BY nom`,
    ),
  ]);
  return {
    comptes: cs.map((c) => formeCompte(c, par.get(c.id))),
    athletes: athletes.map((a) => ({ ...a, compte_id: a.compte_id ?? null })),
  };
}

export async function compte(id) {
  const c = await ligne(`${SELECT_COMPTES} WHERE c.id = :id`, { id });
  if (!c) throw new AdminError(`Aucun compte ${id}.`, 404);
  const par = await athletesParCompte();
  return formeCompte(c, par.get(c.id));
}

function emailPropre(email) {
  const e = String(email ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 190) {
    throw new AdminError('Email illisible.');
  }
  return e;
}

function nomPropre(nom) {
  const n = String(nom ?? '').trim();
  if (!n || n.length > 120) throw new AdminError('Le nom est obligatoire (120 caractères au plus).');
  return n;
}

function rolePropre(role) {
  if (!ROLES.includes(role)) throw new AdminError('Rôle attendu : athlete, coach ou admin.');
  return role;
}

async function motDePasseHache(motDePasse) {
  const mdp = String(motDePasse ?? '');
  const min = Math.max(1, Number(await params.param('securite.mdp_min')) || 12);
  if (mdp.length < min) throw new AdminError(`Mot de passe : ${min} caractères au moins.`);
  if (mdp.length > 200) throw new AdminError('Mot de passe : 200 caractères au plus.');
  return hacher(mdp);
}

function doublon(e) {
  return e?.code === 'ER_DUP_ENTRY';
}

export async function creerCompte(corps) {
  const email = emailPropre(corps.email);
  const nom = nomPropre(corps.nom);
  const role = rolePropre(corps.role ?? 'athlete');
  const hache = await motDePasseHache(corps.mot_de_passe);
  let id;
  try {
    const [r] = await bd().execute(
      'INSERT INTO compte (email, mot_de_passe, nom, role) VALUES (?, ?, ?, ?)',
      [email, hache, nom, role],
    );
    id = r.insertId;
  } catch (e) {
    if (doublon(e)) throw new AdminError(`Un compte existe déjà pour ${email}.`, 409);
    throw e;
  }
  if (corps.athlete_id) {
    await ecrireAcces({ compte_id: id, athlete_id: corps.athlete_id, droit: corps.droit ?? 'ecriture' });
  }
  return compte(id);
}

/** Le nombre d'admins actifs, celui qu'on ne laisse pas tomber à zéro. */
async function adminsActifs() {
  const r = await ligne("SELECT COUNT(*) AS n FROM compte WHERE role = 'admin' AND actif = 1");
  return Number(r?.n ?? 0);
}

/**
 * Modifier un compte : nom, rôle, actif, mot de passe — chacun optionnel.
 * `appelant` est l'id du compte qui demande : il ne peut pas se fermer la
 * porte à lui-même.
 */
export async function modifierCompte(id, corps, appelant) {
  const actuel = await ligne('SELECT id, role, actif FROM compte WHERE id = :id', { id });
  if (!actuel) throw new AdminError(`Aucun compte ${id}.`, 404);

  const champs = [];
  const valeurs = [];
  if (corps.nom !== undefined) { champs.push('nom = ?'); valeurs.push(nomPropre(corps.nom)); }
  if (corps.email !== undefined) { champs.push('email = ?'); valeurs.push(emailPropre(corps.email)); }
  if (corps.role !== undefined) {
    const role = rolePropre(corps.role);
    if (actuel.role === 'admin' && role !== 'admin') {
      if (Number(actuel.id) === Number(appelant)) {
        throw new AdminError('Tu ne peux pas te retirer le rôle admin toi-même : demande-le à un autre admin.', 409);
      }
      if (actuel.actif && (await adminsActifs()) <= 1) {
        throw new AdminError('C’est le dernier admin actif : nomme-en un autre avant.', 409);
      }
    }
    champs.push('role = ?'); valeurs.push(role);
  }
  if (corps.actif !== undefined) {
    const actif = Boolean(corps.actif);
    if (!actif) {
      if (Number(actuel.id) === Number(appelant)) {
        throw new AdminError('Tu ne peux pas désactiver ton propre compte.', 409);
      }
      if (actuel.role === 'admin' && actuel.actif && (await adminsActifs()) <= 1) {
        throw new AdminError('C’est le dernier admin actif : nomme-en un autre avant.', 409);
      }
    }
    champs.push('actif = ?'); valeurs.push(actif ? 1 : 0);
  }
  if (corps.mot_de_passe !== undefined && corps.mot_de_passe !== null && corps.mot_de_passe !== '') {
    champs.push('mot_de_passe = ?'); valeurs.push(await motDePasseHache(corps.mot_de_passe));
  }
  if (champs.length === 0) throw new AdminError('Rien à modifier.');

  try {
    await bd().execute(`UPDATE compte SET ${champs.join(', ')} WHERE id = ?`, [...valeurs, id]);
  } catch (e) {
    if (doublon(e)) throw new AdminError('Un autre compte a déjà cet email.', 409);
    throw e;
  }
  return compte(id);
}

/* ------------------------------------------------------------ les athlètes */

/* Une allure, en secondes par km — « 4:15 » ou « 255 », comme en ligne de
   commande. Entre 2:00 et 15:00 : au-delà c'est une faute de frappe. */
export function secondesParKm(x, libelle = 'allure') {
  const s = String(x ?? '').trim();
  let v;
  if (/^\d+$/.test(s)) v = Number(s);
  else {
    const m = s.match(/^(\d{1,2}):([0-5]\d)$/);
    if (!m) throw new AdminError(`Allure ${libelle} illisible : « ${s} ». Attendu mm:ss (4:15) ou des secondes (255).`);
    v = Number(m[1]) * 60 + Number(m[2]);
  }
  if (v < 120 || v > 900) {
    throw new AdminError(`Allure ${libelle} hors plage (2:00–15:00 /km) : ${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}.`);
  }
  return v;
}

export async function creerAthlete(corps) {
  const nom = nomPropre(corps.nom);
  const prenom = corps.prenom ? String(corps.prenom).trim().slice(0, 80) : null;
  const actuelle = secondesParKm(corps.actuelle, 'actuelle');
  const cible = secondesParKm(corps.cible, 'cible');
  if (cible > actuelle) throw new AdminError('L’allure cible doit être au moins aussi rapide que l’actuelle.');
  const debut = /^\d{4}-\d{2}-\d{2}$/.test(String(corps.debut ?? ''))
    ? corps.debut
    : new Date().toISOString().slice(0, 10);
  /* compte_id NULL : un athlète existe par lui-même, un login se rattache
     après (msc_acces). */
  const [r] = await bd().execute(
    `INSERT INTO msc_athlete (compte_id, nom, prenom, ref_actuelle_s, ref_cible_s, debut)
     VALUES (NULL, ?, ?, ?, ?, ?)`,
    [nom, prenom, actuelle, cible, debut],
  );
  const id = r.insertId;
  if (corps.compte_id) {
    await ecrireAcces({ compte_id: corps.compte_id, athlete_id: id, droit: corps.droit ?? 'ecriture' });
  }
  const a = await ligne(
    'SELECT id, nom, prenom, compte_id, ref_actuelle_s, ref_cible_s, debut FROM msc_athlete WHERE id = :id',
    { id },
  );
  return { ...a, compte_id: a.compte_id ?? null };
}

/* -------------------------------------------------------------- les accès */

/** droit null : retirer l'accès. */
export async function ecrireAcces({ compte_id, athlete_id, droit }) {
  const c = await ligne('SELECT id FROM compte WHERE id = :id', { id: Number(compte_id) });
  if (!c) throw new AdminError(`Aucun compte ${compte_id}.`, 404);
  const a = await ligne('SELECT id, nom, compte_id FROM msc_athlete WHERE id = :id', { id: Number(athlete_id) });
  if (!a) throw new AdminError(`Aucun athlète ${athlete_id}.`, 404);
  if (droit === null || droit === undefined || droit === '') {
    await bd().execute('DELETE FROM msc_acces WHERE compte_id = ? AND athlete_id = ?', [c.id, a.id]);
    return { compte_id: c.id, athlete_id: a.id, droit: null };
  }
  if (!DROITS.includes(droit)) throw new AdminError('Droit attendu : lecture ou ecriture.');
  await bd().execute(
    `INSERT INTO msc_acces (compte_id, athlete_id, droit) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE droit = VALUES(droit)`,
    [c.id, a.id, droit],
  );
  /* Le premier compte en écriture d'un athlète sans login devient « le sien » :
     c'est ce que athletesVisibles ouvre en premier. */
  if (a.compte_id == null && droit === 'ecriture') {
    await bd().execute('UPDATE msc_athlete SET compte_id = ? WHERE id = ? AND compte_id IS NULL', [c.id, a.id]);
  }
  return { compte_id: c.id, athlete_id: a.id, droit };
}

/* -------------------------------------------------------------- le système */

/** La version que le serveur sert (dist/version.txt), ou null avant un build. */
export async function versionServie(dist) {
  try {
    return (await readFile(join(dist, 'version.txt'), 'utf8')).trim() || null;
  } catch {
    return null;
  }
}

export async function systeme(dist) {
  const cle = await params.etatDe('anthropic.cle');
  let base = { ok: false, version: null, erreur: null };
  try {
    const v = await ligne('SELECT VERSION() AS v');
    base = { ok: true, version: v?.v ?? null, erreur: null };
  } catch (e) {
    base = { ok: false, version: null, erreur: e?.message ?? String(e) };
  }
  let demo = null;
  try {
    demo = await etatDemo(1);
  } catch (e) {
    demo = { erreur: e?.message ?? String(e) };
  }
  return {
    version: await versionServie(dist),
    node: process.version,
    env: process.env.NODE_ENV ?? 'development',
    sans_tls: /^(1|true|oui|yes)$/i.test((process.env.MSC_SANS_TLS ?? '').trim()),
    demarre_le: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    cle: cle.renseigne,
    cle_source: cle.source,
    cle_illisible: cle.illisible,
    strava: strava.configure(),
    scellement: scellementPret(),
    base,
    demo,
  };
}

export { retirerDemo };
