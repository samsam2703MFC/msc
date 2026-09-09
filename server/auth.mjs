/* Qui parle, et de quel athlète.

   Le schéma porte des comptes et une table d'accès depuis qu'il y a plus d'un
   athlète : un athlète voit le sien, un coach en voit plusieurs. L'API doit
   donc savoir qui appelle avant de répondre quoi que ce soit, et c'est ce
   fichier.

   Deux choix qui méritent d'être dits plutôt que subis.

   Le hachage est scrypt, celui de Node. argon2id serait un cran au-dessus mais
   demande une dépendance native qui se compile mal ; scrypt est dans la
   bibliothèque standard, il est à mémoire dure, et il vaut infiniment mieux
   qu'un bcrypt mal paramétré ou qu'un SHA salé.

   La session est un jeton signé, sans table. C'est plus simple et sans requête,
   au prix d'une chose qu'il faut assumer : on ne peut pas révoquer une session
   avant son expiration. Le jour où ça compte — un appareil perdu, un compte
   partagé — il faudra une table de sessions et ce commentaire deviendra faux. */

import { createHmac, hkdfSync, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { ligne } from './bd.mjs';

const SCRYPT = { N: 16384, r: 8, p: 1, longueur: 32 };
const SESSION_JOURS = 30;
const COOKIE = 'msc_session';

export class AuthError extends Error {
  constructor(message, code = 401) {
    super(message);
    this.code = code;
  }
}

/* --------------------------------------------------------- les mots de passe */

export function hacher(motDePasse) {
  const sel = randomBytes(16);
  const hache = scryptSync(String(motDePasse), sel, SCRYPT.longueur, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${sel.toString('base64')}$${hache.toString('base64')}`;
}

export function verifier(motDePasse, stocke) {
  const parties = String(stocke ?? '').split('$');
  if (parties.length !== 6 || parties[0] !== 'scrypt') return false;
  const [, N, r, p, sel, attendu] = parties;
  const hache = scryptSync(String(motDePasse), Buffer.from(sel, 'base64'), SCRYPT.longueur, {
    N: Number(N), r: Number(r), p: Number(p),
  });
  const cible = Buffer.from(attendu, 'base64');
  /* Comparaison à temps constant, et sur des longueurs égales par construction. */
  return hache.length === cible.length && timingSafeEqual(hache, cible);
}

/* ------------------------------------------------------------- les sessions */

/* La clé de session est dérivée de MSC_SECRET_KEY plutôt que d'être une seconde
   variable à gérer — HKDF avec une étiquette distincte, donc signer une session
   et sceller un jeton Strava n'utilisent jamais la même clé. */
function cleSession() {
  const brut = process.env.MSC_SECRET_KEY;
  if (!brut) throw new AuthError('MSC_SECRET_KEY absent : aucune session ne peut être signée.', 500);
  const maitre = Buffer.from(brut, brut.length === 64 ? 'hex' : 'base64');
  if (maitre.length !== 32) throw new AuthError('MSC_SECRET_KEY doit faire 32 octets.', 500);
  return Buffer.from(hkdfSync('sha256', maitre, Buffer.alloc(0), 'msc-session-v1', 32));
}

function signer(charge) {
  const corps = Buffer.from(JSON.stringify(charge)).toString('base64url');
  const sceau = createHmac('sha256', cleSession()).update(corps).digest('base64url');
  return `${corps}.${sceau}`;
}

function verifierJeton(jeton) {
  const [corps, sceau] = String(jeton ?? '').split('.');
  if (!corps || !sceau) return null;
  const attendu = createHmac('sha256', cleSession()).update(corps).digest('base64url');
  const a = Buffer.from(sceau);
  const b = Buffer.from(attendu);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const charge = JSON.parse(Buffer.from(corps, 'base64url').toString('utf8'));
    if (!charge?.exp || charge.exp < Math.floor(Date.now() / 1000)) return null;
    return charge;
  } catch {
    return null;
  }
}

export function ouvrirSession(compteId) {
  return signer({
    compte: compteId,
    exp: Math.floor(Date.now() / 1000) + SESSION_JOURS * 86400,
  });
}

export function cookieSession(jeton) {
  /* `Secure` interdit au navigateur de renvoyer le cookie ailleurs que sur
     HTTPS. C'est la bonne valeur par défaut, et elle reste le défaut.
     Mais sur une adresse IP nue il n'y a pas de HTTPS possible — Let's Encrypt
     ne certifie pas les adresses — et le drapeau ne protège alors plus rien :
     il rend la connexion impossible. Le symptôme est cruel, parce que tout a
     l'air de marcher : le serveur répond, la connexion renvoie 200, et la
     requête suivante est anonyme.
     MSC_SANS_TLS le lève, explicitement, en sachant ce qu'il en coûte — le
     cookie de session voyage alors en clair sur le réseau, et qui le lit prend
     la session. À ne poser que sur un serveur d'essai. */
  /* Plusieurs écritures acceptées : un drapeau qui ne prend que « 1 »
     échoue en silence sur « true », et le symptôme est une connexion qui
     ne s'ouvre pas, sans un mot pour dire pourquoi. */
  const sansTls = /^(1|true|oui|yes)$/i.test((process.env.MSC_SANS_TLS ?? '').trim());
  const secure = process.env.NODE_ENV === 'production' && !sansTls ? '; Secure' : '';
  const age = jeton ? SESSION_JOURS * 86400 : 0;
  return `${COOKIE}=${jeton ?? ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure}`;
}

function cookies(req) {
  const brut = req.headers?.cookie ?? '';
  const out = {};
  for (const morceau of brut.split(';')) {
    const i = morceau.indexOf('=');
    if (i > 0) out[morceau.slice(0, i).trim()] = decodeURIComponent(morceau.slice(i + 1).trim());
  }
  return out;
}

/* ----------------------------------------------------------- l'identification */

/** Se connecter. Le même message pour un email inconnu et un mot de passe faux :
    la différence dirait qui a un compte ici. */
export async function connecter(email, motDePasse) {
  const c = await ligne(
    'SELECT id, email, nom, role, mot_de_passe, actif FROM compte WHERE email = :email',
    { email: String(email ?? '').trim().toLowerCase() },
  );
  const echec = new AuthError('Email ou mot de passe incorrect.');
  if (!c || !c.actif) {
    /* Un hachage à vide quand même, pour que « compte inconnu » et « mauvais
       mot de passe » prennent le même temps. */
    verifier(motDePasse, `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${'A'.repeat(24)}$${'A'.repeat(44)}`);
    throw echec;
  }
  if (!verifier(motDePasse, c.mot_de_passe)) throw echec;
  return { id: c.id, email: c.email, nom: c.nom, role: c.role };
}

/**
 * Le compte qui appelle, ou null.
 *
 * En développement seulement, MSC_ATHLETE_ID court-circuite tout ça : l'app
 * n'a pas encore d'écran de connexion sur tous les chemins, et travailler sans
 * se reconnecter à chaque redémarrage est utile. En production c'est refusé,
 * bruyamment, parce qu'une porte de service oubliée est une porte ouverte.
 */
export async function identifier(req) {
  const bypass = process.env.MSC_ATHLETE_ID;
  if (bypass) {
    if (process.env.NODE_ENV === 'production') {
      throw new AuthError('MSC_ATHLETE_ID est refusé en production.', 500);
    }
    const a = await ligne('SELECT id, nom, compte_id FROM msc_athlete WHERE id = :id', {
      id: Number(bypass),
    });
    if (!a) throw new AuthError(`MSC_ATHLETE_ID=${bypass} ne correspond à aucun athlète.`, 500);
    return { compte: { id: a.compte_id, nom: a.nom, role: 'athlete' }, athlete_id: a.id, bypass: true };
  }

  const charge = verifierJeton(cookies(req)[COOKIE]);
  if (!charge) return null;
  const c = await ligne('SELECT id, email, nom, role, actif FROM compte WHERE id = :id', {
    id: charge.compte,
  });
  if (!c || !c.actif) return null;
  return { compte: { id: c.id, email: c.email, nom: c.nom, role: c.role }, athlete_id: null };
}

/** Les athlètes qu'un compte peut voir, dans l'ordre. */
export async function athletesVisibles(compteId) {
  const { lignes } = await import('./bd.mjs');
  return lignes(
    `SELECT a.id, a.nom, x.droit
     FROM msc_acces x JOIN msc_athlete a ON a.id = x.athlete_id
     WHERE x.compte_id = :compte ORDER BY a.nom`,
    { compte: compteId },
  );
}

/**
 * L'athlète d'une requête, avec le droit vérifié.
 *
 * Le client peut nommer un athlète (`?athlete=3`) — c'est ce dont le back
 * office d'un coach a besoin — mais c'est msc_acces qui tranche, jamais le
 * paramètre. Sans paramètre, le premier athlète visible.
 */
export async function athleteDe(req, url, droit = 'lecture') {
  const identite = await identifier(req);
  if (!identite) throw new AuthError('Non connecté.');
  if (identite.bypass) return { ...identite, droit: 'ecriture' };

  const visibles = await athletesVisibles(identite.compte.id);
  if (visibles.length === 0) throw new AuthError('Aucun athlète accessible à ce compte.', 403);

  const demande = url?.searchParams?.get('athlete');
  const choisi = demande
    ? visibles.find((a) => String(a.id) === String(demande))
    : visibles[0];
  if (!choisi) throw new AuthError('Cet athlète ne vous est pas accessible.', 403);
  if (droit === 'ecriture' && choisi.droit !== 'ecriture') {
    throw new AuthError('Accès en lecture seule sur cet athlète.', 403);
  }
  return { ...identite, athlete_id: choisi.id, droit: choisi.droit, visibles };
}
