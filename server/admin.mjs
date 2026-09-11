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
import { bd, ligne, lignes, scellementPret, transaction } from './bd.mjs';
import { etatDemoTous, retirerDemo } from './demo.mjs';
import { ecrireObjectifSport } from './depots.mjs';
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

/* Les sports que l'application connaît — ceux de la semaine type. Un athlète
   en fait au moins un, et ce sont eux qui disent ce qu'on lui demande :
   l'allure 10 km n'a de sens que pour celui qui court. */
const SPORTS = ['Course à pied', 'Natation', 'Vélo', 'Hyrox'];
const SPORT_COURSE = 'Course à pied';

function sportsPropres(x) {
  const liste = Array.isArray(x) ? x.map((s) => String(s).trim()).filter((s) => SPORTS.includes(s)) : [];
  /* Rien de coché : on retombe sur la course à pied, qui est le cas courant
     et le seul que l'application savait faire jusqu'ici. */
  return liste.length ? [...new Set(liste)] : [SPORT_COURSE];
}

/**
 * Les deux références 10 km d'un athlète, telles que ses sports les rendent
 * nécessaires. Il court : on les lit et on les vérifie. Il ne court pas —
 * un cycliste, un nageur : il n'y a pas d'allure de course à inventer, et
 * zéro dit « pas de référence » au reste de l'application, qui affiche « — »
 * au lieu d'un chiffre faux.
 */
function referencesDe(source, sports) {
  if (!sports.includes(SPORT_COURSE)) return { actuelle: 0, cible: 0 };
  const actuelle = secondesParKm(source.actuelle, 'actuelle');
  const cible = secondesParKm(source.cible, 'cible');
  if (cible > actuelle) throw new AdminError('L’allure cible doit être au moins aussi rapide que l’actuelle.');
  return { actuelle, cible };
}

/* Les objectifs des autres sports, tels que l'onboarding les propose : un
   temps d'aujourd'hui et un temps visé sur l'épreuve étalon. Vides, ils ne
   valent rien et ne s'écrivent pas — c'est ecrireObjectifSport qui le dit. */
function objectifsPropres(x, sports) {
  if (!Array.isArray(x)) return [];
  return x
    .filter((o) => o && sports.includes(String(o.discipline)) && String(o.discipline) !== SPORT_COURSE)
    .filter((o) => o.actuel_s || o.cible_s)
    .map((o) => ({
      discipline: String(o.discipline),
      actuel_s: o.actuel_s || null,
      cible_s: o.cible_s || null,
    }));
}

export async function creerAthlete(corps) {
  const nom = nomPropre(corps.nom);
  const prenom = corps.prenom ? String(corps.prenom).trim().slice(0, 80) : null;
  const sports = sportsPropres(corps.sports);
  const { actuelle, cible } = referencesDe(corps, sports);
  const objectifs = objectifsPropres(corps.objectifs, sports);
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
  for (const o of objectifs) await ecrireObjectifSport(id, o);
  if (corps.compte_id) {
    await ecrireAcces({ compte_id: corps.compte_id, athlete_id: id, droit: corps.droit ?? 'ecriture' });
  }
  const a = await ligne(
    'SELECT id, nom, prenom, compte_id, ref_actuelle_s, ref_cible_s, debut FROM msc_athlete WHERE id = :id',
    { id },
  );
  return { ...a, compte_id: a.compte_id ?? null };
}

/* ------------------------------------------------- supprimer un athlète

   Une suppression est définitive et emporte tout : le schéma cascade depuis
   msc_athlete — plans, séances, journal, activités, courses, mesures, photos,
   analyses, questions au coach. On ne peut donc pas la proposer d'un bouton
   sec : on dit d'abord ce qu'elle détruit, chiffre par chiffre, et on demande
   le nom de l'athlète écrit à la main. Le serveur le revérifie — une
   confirmation qui ne vit que dans l'écran n'en est pas une. */

/** Ce qu'une suppression emporterait. Lu avant, montré avant. */
export async function resumeAthlete(id) {
  const a = await unAthlete(id);
  if (!a) throw new AdminError(`Aucun athlète ${id}.`, 404);
  const n = await ligne(
    `SELECT
       (SELECT COUNT(*) FROM msc_plan WHERE athlete_id = :a) AS plans,
       (SELECT COUNT(*) FROM msc_session s JOIN msc_plan p ON p.id = s.plan_id WHERE p.athlete_id = :a) AS seances,
       (SELECT COUNT(*) FROM msc_activity WHERE athlete_id = :a) AS activites,
       (SELECT COUNT(*) FROM msc_journal WHERE athlete_id = :a) AS journal,
       (SELECT COUNT(*) FROM msc_competition WHERE athlete_id = :a) AS courses,
       (SELECT COUNT(*) FROM msc_mesure WHERE athlete_id = :a) AS mesures,
       (SELECT COUNT(*) FROM msc_photo WHERE athlete_id = :a) AS photos,
       (SELECT COUNT(*) FROM msc_analyse WHERE athlete_id = :a) AS analyses,
       (SELECT COUNT(*) FROM msc_chat WHERE athlete_id = :a) AS questions,
       (SELECT COUNT(*) FROM msc_strava_compte WHERE athlete_id = :a) AS strava`,
    { a: id },
  );
  /* Les comptes qui ne voient que lui : les supprimer avec est une option,
     parce qu'un login sans athlète ne sert plus à rien — mais c'est un choix,
     pas une conséquence qu'on subit. */
  const comptes = await lignes(
    `SELECT c.id, c.email, c.nom, c.role,
            (SELECT COUNT(*) FROM msc_acces y WHERE y.compte_id = c.id) AS athletes
     FROM msc_acces x JOIN compte c ON c.id = x.compte_id
     WHERE x.athlete_id = :a ORDER BY c.email`,
    { a: id },
  );
  return {
    athlete: a,
    compte: Object.fromEntries(Object.entries(n ?? {}).map(([k, v]) => [k, Number(v ?? 0)])),
    comptes: comptes.map((c) => ({
      id: c.id, email: c.email, nom: c.nom, role: c.role,
      /* Vrai quand cet athlète est le seul qu'il voit. */
      seulement_lui: Number(c.athletes) <= 1,
    })),
  };
}

/**
 * Supprime un athlète, et ce qui ne vaut que par lui.
 *
 *   { nom }     le nom tapé à la main, qui doit correspondre
 *   { compte }  supprimer aussi les comptes qui ne voyaient que lui
 *
 * Jamais le compte qui appelle, jamais le dernier admin actif : le back office
 * ne doit pas pouvoir se fermer de l'intérieur, ici comme ailleurs.
 */
export async function supprimerAthlete(id, corps = {}, appelant) {
  const resume = await resumeAthlete(id);
  const nu = (x) => String(x ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  const attendu = resume.athlete.nom;
  if (nu(corps.nom) !== nu(attendu)) {
    throw new AdminError(`Pour supprimer, écris son nom exactement : « ${attendu} ».`, 409);
  }

  /* Les fichiers d'abord : une photo orpheline sur le disque ne se retrouve
     plus, la ligne qui la nommait ayant disparu avec la cascade. */
  const photos = await lignes('SELECT chemin FROM msc_photo WHERE athlete_id = :a', { a: id });
  let fichiers = 0;
  if (photos.length) {
    const { racinePhotos } = await import('./photo.mjs');
    const { rm } = await import('node:fs/promises');
    for (const p of photos) {
      try {
        await rm(join(racinePhotos(), p.chemin), { force: true });
        fichiers += 1;
      } catch {
        /* Un fichier déjà parti n'empêche pas la suppression de la base. */
      }
    }
  }

  const comptesASupprimer = corps.compte
    ? resume.comptes.filter((c) => c.seulement_lui && c.id !== appelant)
    : [];
  if (comptesASupprimer.some((c) => c.role === 'admin')) {
    const [{ n: admins }] = await lignes("SELECT COUNT(*) AS n FROM compte WHERE role = 'admin' AND actif = 1");
    const restants = Number(admins) - comptesASupprimer.filter((c) => c.role === 'admin').length;
    if (restants < 1) throw new AdminError('C’est le dernier admin actif : il resterait personne pour ouvrir le back office.', 409);
  }

  await transaction(async (cnx) => {
    await cnx.execute('DELETE FROM msc_athlete WHERE id = ?', [id]);
    for (const c of comptesASupprimer) {
      await cnx.execute('DELETE FROM compte WHERE id = ?', [c.id]);
    }
  });

  return {
    supprime: { id, nom: attendu },
    fichiers,
    comptes_supprimes: comptesASupprimer.map((c) => c.email),
  };
}

/* --------------------------------------------- un athlète et son compte */

async function unAthlete(id) {
  const a = await ligne(
    'SELECT id, nom, prenom, compte_id, ref_actuelle_s, ref_cible_s, debut FROM msc_athlete WHERE id = :id',
    { id },
  );
  return a ? { ...a, compte_id: a.compte_id ?? null } : null;
}

/**
 * Un athlète et son compte d'un seul geste — ou l'un des deux, relié à l'autre
 * s'il existe déjà. Tout se valide avant d'écrire, et tout s'écrit dans une
 * transaction : pas de compte orphelin parce que l'allure était fausse.
 *
 *   { athlete: { nom, prenom, actuelle, cible, debut } | null,
 *     compte:  { email, nom, role, mot_de_passe } | null,
 *     droit, compte_id (un compte existant pour l'athlète),
 *     athlete_id (un athlète existant pour le compte) }
 */
export async function inscrire(corps = {}) {
  const avecAthlete = Boolean(corps.athlete && typeof corps.athlete === 'object');
  const avecCompte = Boolean(corps.compte && typeof corps.compte === 'object');
  if (!avecAthlete && !avecCompte) throw new AdminError('Rien à créer : ni athlète, ni compte.');
  const droit = DROITS.includes(corps.droit) ? corps.droit : 'ecriture';

  let a = null;
  if (avecAthlete) {
    const sports = sportsPropres(corps.athlete.sports);
    const { actuelle, cible } = referencesDe(corps.athlete, sports);
    a = {
      nom: nomPropre(corps.athlete.nom),
      prenom: corps.athlete.prenom ? String(corps.athlete.prenom).trim().slice(0, 80) : null,
      actuelle, cible,
      objectifs: objectifsPropres(corps.athlete.objectifs, sports),
      debut: /^\d{4}-\d{2}-\d{2}$/.test(String(corps.athlete.debut ?? ''))
        ? corps.athlete.debut
        : new Date().toISOString().slice(0, 10),
    };
  }
  let c = null;
  if (avecCompte) {
    c = {
      email: emailPropre(corps.compte.email),
      nom: nomPropre(corps.compte.nom || [a?.prenom, a?.nom].filter(Boolean).join(' ')),
      role: rolePropre(corps.compte.role ?? 'athlete'),
      hache: await motDePasseHache(corps.compte.mot_de_passe),
    };
  }
  /* Relier à l'existant : on vérifie avant, pour répondre 404 plutôt qu'une
     erreur de clé étrangère. */
  let compteId = null;
  let athleteId = null;
  if (!avecCompte && corps.compte_id) {
    const x = await ligne('SELECT id FROM compte WHERE id = :id', { id: Number(corps.compte_id) });
    if (!x) throw new AdminError(`Aucun compte ${corps.compte_id}.`, 404);
    compteId = x.id;
  }
  if (!avecAthlete && corps.athlete_id) {
    const x = await ligne('SELECT id FROM msc_athlete WHERE id = :id', { id: Number(corps.athlete_id) });
    if (!x) throw new AdminError(`Aucun athlète ${corps.athlete_id}.`, 404);
    athleteId = x.id;
  }

  try {
    await transaction(async (cnx) => {
      if (c) {
        const [r] = await cnx.execute(
          'INSERT INTO compte (email, mot_de_passe, nom, role) VALUES (?, ?, ?, ?)',
          [c.email, c.hache, c.nom, c.role],
        );
        compteId = r.insertId;
      }
      if (a) {
        const [r] = await cnx.execute(
          `INSERT INTO msc_athlete (compte_id, nom, prenom, ref_actuelle_s, ref_cible_s, debut)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [compteId && droit === 'ecriture' ? compteId : null, a.nom, a.prenom, a.actuelle, a.cible, a.debut],
        );
        athleteId = r.insertId;
        for (const o of a.objectifs) await ecrireObjectifSport(athleteId, o, cnx);
      }
      if (compteId && athleteId) {
        await cnx.execute(
          `INSERT INTO msc_acces (compte_id, athlete_id, droit) VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE droit = VALUES(droit)`,
          [compteId, athleteId, droit],
        );
        if (droit === 'ecriture') {
          await cnx.execute('UPDATE msc_athlete SET compte_id = ? WHERE id = ? AND compte_id IS NULL', [compteId, athleteId]);
        }
      }
    });
  } catch (e) {
    if (doublon(e)) throw new AdminError(`Un compte existe déjà pour ${c?.email}.`, 409);
    throw e;
  }
  return {
    compte: compteId ? await compte(compteId) : null,
    athlete: athleteId ? await unAthlete(athleteId) : null,
  };
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

/* ---------------------------------------------------- Strava, par athlète */

export async function tousLesAthletes() {
  return lignes("SELECT id, nom, 'ecriture' AS droit FROM msc_athlete ORDER BY nom");
}

/** Pour chaque athlète : la liaison, l'application qui vaut pour lui, et ce
    qui est déjà arrivé de Strava. Rien qui ressemble à un jeton. */
export async function stravaParAthlete(athletes) {
  const sortie = [];
  for (const a of athletes) {
    const e = await strava.etat(a.id);
    const app = await strava.appPublique(a.id);
    const recu = await ligne(
      'SELECT COUNT(*) AS n, MAX(date) AS derniere FROM msc_activity WHERE athlete_id = :a AND manuelle = 0',
      { a: a.id },
    );
    sortie.push({
      id: a.id,
      nom: a.nom,
      droit: a.droit,
      strava: {
        configure: e.configure,
        app_propre: e.app_propre,
        lie: e.lie,
        athlete: e.athlete,
        portee: e.portee,
        lie_le: e.lie_le,
        derniere_synchro: e.derniere_synchro,
      },
      app,
      activites: { n: Number(recu?.n ?? 0), derniere: recu?.derniere ?? null },
    });
  }
  return sortie;
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
    demo = await etatDemoTous();
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
