/* The Strava half of the plan server.

   It exists for the same reason the Anthropic half does: a client secret
   shipped to a PWA is a secret anyone can read out of the bundle and spend.
   Strava wants the secret on every token exchange and every refresh, so the
   whole OAuth dance happens here and the browser only ever sees activities.

   What crosses that seam is deliberately narrow. This module knows nothing
   about the plan — no sessions, no blocks, no paces, no zones. It fetches what
   the athlete actually did and normalises it to aggregates. Matching an
   activity to a session is the app's job, because that is where the plan
   lives, and duplicating the plan here would give us two of them.

   Aggregates only, never the raw streams: `msc_activity` is a handful of
   numbers per session, and pulling GPS traces we would not display is a cost
   against the athlete's rate limit and their privacy both.

   Depuis que la base existe, les jetons y vivent — une ligne par athlète, dans
   msc_strava_compte, chiffrée par `server/bd.mjs`. Toutes les fonctions qui
   touchent à un compte prennent donc un `athleteId` : il y a plus d'un athlète
   maintenant, et un module qui n'en connaît qu'un finit par mélanger leurs
   activités. */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { bd, desceller, ligne, sceller } from './bd.mjs';
import { paramSync } from './params.mjs';

const AUTORISATION = 'https://www.strava.com/oauth/authorize';
const JETON = 'https://www.strava.com/oauth/token';
const DELIAISON = 'https://www.strava.com/oauth/deauthorize';
const API = 'https://www.strava.com/api/v3';

/* read: the athlete's profile. activity:read_all: their activities, private
   ones included — a training log with the private sessions missing is a
   training log with holes in it. Nothing is ever written back to Strava. */
const PORTEE = 'read,activity:read_all';

/* Strava's access tokens last six hours. Refresh a little early rather than
   discover the expiry mid-request. */
const MARGE_S = 120;

/* An OAuth round-trip that takes longer than this was abandoned. */
const ETAT_TTL_MS = 10 * 60 * 1000;
/* Un lien fabriqué par le coach pour l'envoyer à l'athlète vit plus longtemps :
   il sera ouvert plus tard, sur un autre appareil. */
export const ETAT_TTL_LONG_MS = 24 * 60 * 60 * 1000;

const PAGE = 100;
const PAGES_MAX = 10;

export class StravaError extends Error {
  constructor(message, code = 500) {
    super(message);
    this.code = code;
  }
}

/* ------------------------------------------------------------ configuration */

/* Les identifiants viennent de msc_param (le back office), avec les variables
   d'environnement en repli — `paramSync` sait les deux. L'URL de retour, elle,
   dépend de la machine, pas du réglage : elle reste dans l'environnement. */
export function config() {
  return {
    clientId: String(paramSync('strava.client_id') ?? ''),
    clientSecret: String(paramSync('strava.client_secret') ?? ''),
    redirectUri: process.env.STRAVA_REDIRECT_URI ?? 'http://localhost:8787/api/strava/callback',
    verifyToken: String(paramSync('strava.verify_token') ?? ''),
    /* Where to send the browser once the round-trip is done. */
    retour: process.env.STRAVA_APP_ORIGIN ?? process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  };
}

/* L'adresse de retour est le seul réglage que Strava vérifie de son côté :
   il refuse l'autorisation si le domaine du `redirect_uri` n'est pas celui
   déclaré « Authorization Callback Domain » sur l'application. Une IP nue n'en
   est pas un — Strava n'accepte que des noms. Autant le dire ici plutôt que de
   laisser l'athlète lire « Bad Request » sur strava.com. */
export function rappel() {
  const url = config().redirectUri;
  let u = null;
  try {
    u = new URL(url);
  } catch {
    return { url, domaine: null, souci: 'illisible' };
  }
  const hote = u.hostname;
  const ip = /^\d{1,3}(\.\d{1,3}){3}$/.test(hote) || hote.startsWith('[');
  const local = hote === 'localhost' || hote === '127.0.0.1' || hote === '::1';
  const prod = process.env.NODE_ENV === 'production';
  return {
    url,
    domaine: hote,
    /* `local` en développement n'est pas un souci : Strava l'accepte. */
    souci: local ? (prod ? 'local' : null) : ip ? 'ip' : null,
    /* En développement la page (5173) et l'API (8787) ne sont pas sur la même
       origine, exprès : comparer les deux n'aurait aucun sens là. */
    prod,
  };
}

/** Whether the server has what it needs to talk to Strava at all. */
export function configure() {
  const c = config();
  return Boolean(c.clientId && c.clientSecret);
}

/* --------------------------------------------- l'application d'un athlète */

/* Strava limite une application neuve au seul compte qui l'a créée tant
   qu'elle n'a pas été revue. Un club a donc deux voies : faire revoir
   l'application du serveur, ou laisser chaque athlète créer la sienne sur son
   propre compte Strava et la poser ici. Les identifiants d'un athlète valent
   alors pour lui seul — l'autorisation, l'échange du code, le rafraîchissement
   des jetons — et le reste passe par l'application commune. */

async function appDe(athleteId) {
  const r = await ligne(
    'SELECT client_id, client_secret, maj_le FROM msc_strava_app WHERE athlete_id = :a',
    { a: athleteId },
  );
  if (!r) return null;
  let secret = null;
  try {
    secret = desceller(r.client_secret);
  } catch {
    /* Scellé avec une autre MSC_SECRET_KEY : on le dit, on ne s'en sert pas. */
    secret = null;
  }
  return { client_id: r.client_id, client_secret: secret, illisible: secret === null, maj_le: r.maj_le };
}

/** Ce que l'écran peut savoir de l'application d'un athlète : l'ID, jamais le
    secret — et si, faute d'application propre, c'est la commune qui vaut. */
export async function appPublique(athleteId) {
  const a = await appDe(athleteId);
  const c = config();
  return {
    propre: Boolean(a),
    client_id: a?.client_id ?? null,
    secret: Boolean(a?.client_secret),
    illisible: Boolean(a?.illisible),
    maj_le: a?.maj_le ?? null,
    commune: Boolean(c.clientId && c.clientSecret),
    commune_client_id: c.clientId || null,
  };
}

export async function ecrireApp(athleteId, { client_id, client_secret } = {}) {
  const id = String(client_id ?? '').trim();
  if (!/^\d{1,40}$/.test(id)) throw new StravaError('L’ID client Strava est un nombre (celui de strava.com/settings/api).', 400);
  const secret = String(client_secret ?? '').trim();
  if (secret) {
    await bd().execute(
      `INSERT INTO msc_strava_app (athlete_id, client_id, client_secret) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE client_id = VALUES(client_id), client_secret = VALUES(client_secret)`,
      [athleteId, id, sceller(secret)],
    );
  } else {
    /* Sans nouveau secret on garde l'ancien — encore faut-il qu'il y en ait un. */
    const [r] = await bd().execute('UPDATE msc_strava_app SET client_id = ? WHERE athlete_id = ?', [id, athleteId]);
    if (r.affectedRows === 0) throw new StravaError('Le secret client Strava est obligatoire la première fois.', 400);
  }
  return appPublique(athleteId);
}

export async function effacerApp(athleteId) {
  await bd().execute('DELETE FROM msc_strava_app WHERE athlete_id = ?', [athleteId]);
  return appPublique(athleteId);
}

/** Les identifiants qui valent pour cet athlète : les siens s'il en a, sinon
    ceux du serveur. */
export async function configPour(athleteId) {
  const c = config();
  const a = athleteId ? await appDe(athleteId) : null;
  if (a?.client_secret) return { ...c, clientId: a.client_id, clientSecret: a.client_secret, propre: true };
  return { ...c, propre: false };
}

/* -------------------------------------------------------------- le magasin */

/* Les jetons vivent en base, chiffrés, une ligne par athlète. Ils y sont mieux
   qu'à côté du serveur : le compte suit l'athlète, pas la machine, et un second
   serveur derrière un répartiteur voit les mêmes.

   Ce qui sort d'ici n'a de sens que dedans — rien de ce que cette fonction rend
   ne doit atterrir dans une réponse HTTP. */
async function lire(athleteId) {
  const r = await ligne(
    'SELECT * FROM msc_strava_compte WHERE athlete_id = :a',
    { a: athleteId },
  );
  if (!r) return null;
  return {
    athlete_id: r.athlete_id,
    strava_athlete_id: Number(r.strava_athlete_id),
    prenom: r.prenom ?? '',
    nom: r.nom ?? '',
    access_token: desceller(r.access_token),
    refresh_token: desceller(r.refresh_token),
    expires_at: Math.floor(new Date(r.expires_at).getTime() / 1000),
    portee: r.portee,
    lie_le: r.lie_le,
    derniere_synchro: r.derniere_synchro,
  };
}

async function ecrire(athleteId, etat) {
  await bd().execute(
    `INSERT INTO msc_strava_compte (athlete_id, strava_athlete_id, prenom, nom,
       access_token, refresh_token, expires_at, portee, derniere_synchro)
     VALUES (?, ?, ?, ?, ?, ?, FROM_UNIXTIME(?), ?, ?)
     ON DUPLICATE KEY UPDATE strava_athlete_id = VALUES(strava_athlete_id),
       prenom = VALUES(prenom), nom = VALUES(nom),
       access_token = VALUES(access_token), refresh_token = VALUES(refresh_token),
       expires_at = VALUES(expires_at), portee = VALUES(portee),
       derniere_synchro = VALUES(derniere_synchro)`,
    [athleteId, etat.strava_athlete_id, etat.prenom, etat.nom,
     sceller(etat.access_token), sceller(etat.refresh_token),
     etat.expires_at, etat.portee, etat.derniere_synchro ?? null],
  );
}

async function effacer(athleteId) {
  await bd().execute('DELETE FROM msc_strava_compte WHERE athlete_id = ?', [athleteId]);
}

/** L'athlète MSC derrière un identifiant Strava — c'est ainsi qu'un événement
    de webhook trouve à qui il appartient. */
async function athleteDeStrava(stravaAthleteId) {
  const r = await ligne(
    'SELECT athlete_id FROM msc_strava_compte WHERE strava_athlete_id = :s',
    { s: stravaAthleteId },
  );
  return r?.athlete_id ?? null;
}

/* --------------------------------------------------------------- l'échange */

/* One-shot CSRF states. In memory on purpose: an authorisation still in flight
   across a server restart is an authorisation the athlete should just redo. */
const etats = new Map();

function purgerEtats() {
  const maintenant = Date.now();
  for (const [cle, v] of etats) if (v.ne + (v.ttl ?? ETAT_TTL_MS) < maintenant) etats.delete(cle);
}

/** The URL to send the athlete to. The `state` comes back with them — et il
    porte de quel athlète il s'agit, parce que le retour de Strava est une
    navigation neuve, sans rien de la requête qui l'a demandée. */
export async function lienAutorisation(athleteId, { duree } = {}) {
  const c = await configPour(athleteId);
  if (!(c.clientId && c.clientSecret)) {
    throw new StravaError(
      "Strava n'est pas configuré : ni application propre à cet athlète, ni application commune (Réglages · Strava, ou STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET).",
      501,
    );
  }
  purgerEtats();
  const etat = randomBytes(16).toString('hex');
  const ttl = duree ?? ETAT_TTL_MS;
  etats.set(etat, { athleteId, ne: Date.now(), ttl });

  const params = new URLSearchParams({
    client_id: c.clientId,
    redirect_uri: c.redirectUri,
    response_type: 'code',
    /* `auto` so a re-link of an already-authorised athlete is one click. */
    approval_prompt: 'auto',
    scope: PORTEE,
    state: etat,
  });
  return { url: `${AUTORISATION}?${params}`, etat, expire_le: new Date(Date.now() + ttl).toISOString() };
}

function consommerEtat(etat) {
  purgerEtats();
  const v = etat ? etats.get(etat) : undefined;
  if (!v) {
    throw new StravaError('Requête de liaison inconnue ou expirée. Relance la connexion.', 400);
  }
  etats.delete(etat);
  return v.athleteId;
}

async function postJeton(corps) {
  const reponse = await fetch(JETON, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corps),
  });
  const data = await reponse.json().catch(() => ({}));
  if (!reponse.ok) {
    /* Strava's own message names the field it disliked; it can carry the code
       we just sent, so it goes to the logs and not to the browser. */
    console.error('[strava] jeton', reponse.status, data);
    if (reponse.status === 400 || reponse.status === 401) {
      throw new StravaError(
        "Strava a refusé l'échange. Vérifie STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET et le domaine de callback de l'application.",
        502,
      );
    }
    throw new StravaError(`Strava a répondu ${reponse.status}.`, 502);
  }
  return data;
}

/** Exchanges the code Strava sent back for a token pair, and stores it. */
export async function echangerCode(code, etat) {
  const athleteId = consommerEtat(etat);
  if (!code) throw new StravaError('Code d’autorisation absent.', 400);
  const c = await configPour(athleteId);

  const data = await postJeton({
    client_id: c.clientId,
    client_secret: c.clientSecret,
    code,
    grant_type: 'authorization_code',
  });

  const athlete = data.athlete ?? {};
  if (!athlete.id) throw new StravaError("Strava n'a pas renvoyé d'athlète.", 502);
  await ecrire(athleteId, {
    strava_athlete_id: athlete.id,
    prenom: athlete.firstname ?? '',
    nom: athlete.lastname ?? '',
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at,
    /* Strava returns the scopes it actually granted, which can be narrower
       than what we asked for if the athlete unticked a box. */
    portee: data.scope ?? PORTEE,
  });
  return { athlete_id: athleteId, strava_athlete_id: athlete.id, prenom: athlete.firstname ?? '' };
}

/** A valid access token, refreshed if it is about to expire. */
async function jeton(athleteId) {
  const etat = await lire(athleteId);
  if (!etat) throw new StravaError('Strava n’est pas connecté.', 409);

  const dans = (etat.expires_at ?? 0) - Math.floor(Date.now() / 1000);
  if (dans > MARGE_S) return etat.access_token;

  const c = await configPour(athleteId);
  const data = await postJeton({
    client_id: c.clientId,
    client_secret: c.clientSecret,
    refresh_token: etat.refresh_token,
    grant_type: 'refresh_token',
  });
  /* Strava rotates the refresh token on some refreshes and not others; it
     returns whichever one is now current, so always take what it gives back. */
  await ecrire(athleteId, {
    ...etat,
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? etat.refresh_token,
    expires_at: data.expires_at,
  });
  return data.access_token;
}

/** A valid access token, or null when nobody is linked.

    The coach service needs it to hand to Strava's MCP server; nothing else
    outside this module may see it, and it never reaches an HTTP response. */
export async function jetonCourant(athleteId) {
  if (!(await lire(athleteId))) return null;
  try {
    return await jeton(athleteId);
  } catch (e) {
    console.warn('[strava] jeton indisponible :', e?.message ?? e);
    return null;
  }
}

/** Revokes the token at Strava, then forgets it here. */
export async function delier(athleteId) {
  const etat = await lire(athleteId);
  if (!etat) return { lie: false };
  try {
    await fetch(DELIAISON, {
      method: 'POST',
      headers: { authorization: `Bearer ${etat.access_token}` },
    });
  } catch (e) {
    /* The athlete asked to be unlinked. Failing to reach Strava is not a
       reason to keep their token on our disk — drop it either way. */
    console.error('[strava] déliaison', e);
  }
  await effacer(athleteId);
  return { lie: false };
}

/* ------------------------------------------------------------ les quotas */

/* Strava answers every request with what is left of the athlete's quota.
   Reading it is how we stop before a 429 rather than after one. */
let quotas = null;

function noterQuotas(reponse) {
  const paire = (v) => {
    const [court, jour] = String(v ?? '').split(',').map(Number);
    return Number.isFinite(court) && Number.isFinite(jour) ? { court, jour } : null;
  };
  const limite = paire(reponse.headers.get('x-ratelimit-limit'));
  const usage = paire(reponse.headers.get('x-ratelimit-usage'));
  const limiteL = paire(reponse.headers.get('x-readratelimit-limit'));
  const usageL = paire(reponse.headers.get('x-readratelimit-usage'));
  if (!limite || !usage) return;
  quotas = {
    /* The 15-minute window and the daily one, for the overall quota and the
       read-only one Strava tracks separately. */
    fenetre: { utilise: usage.court, limite: limite.court },
    jour: { utilise: usage.jour, limite: limite.jour },
    lecture: limiteL && usageL
      ? { fenetre: { utilise: usageL.court, limite: limiteL.court }, jour: { utilise: usageL.jour, limite: limiteL.jour } }
      : null,
  };
}

export function derniersQuotas() {
  return quotas;
}

function quotaEpuise() {
  if (!quotas) return false;
  const q = quotas.lecture ?? quotas;
  return q.fenetre.utilise >= q.fenetre.limite || q.jour.utilise >= q.jour.limite;
}

async function api(athleteId, chemin, params) {
  if (quotaEpuise()) {
    throw new StravaError(
      'Quota Strava atteint. La fenêtre se rouvre dans moins de 15 minutes.',
      429,
    );
  }
  const url = new URL(API + chemin);
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const reponse = await fetch(url, { headers: { authorization: `Bearer ${await jeton(athleteId)}` } });
  noterQuotas(reponse);

  if (reponse.status === 429) {
    throw new StravaError('Quota Strava atteint. Réessaie dans quelques minutes.', 429);
  }
  if (reponse.status === 401) {
    throw new StravaError('Strava a rejeté le jeton. Reconnecte le compte.', 401);
  }
  if (!reponse.ok) {
    console.error('[strava] api', chemin, reponse.status);
    throw new StravaError(`Strava a répondu ${reponse.status}.`, 502);
  }
  return reponse.json();
}

/* ------------------------------------------------------- les activités */

/* Strava's sport_type is a long enum; the plan has five disciplines. This
   collapses one onto the other and leaves everything it does not recognise as
   `autre`, so an unmapped sport shows up as unmatched rather than as a wrong
   session ticked off. */
const SPORTS = {
  Run: 'run', TrailRun: 'run', VirtualRun: 'run', Treadmill: 'run',
  Swim: 'swim',
  Ride: 'bike', VirtualRide: 'bike', GravelRide: 'bike', MountainBikeRide: 'bike', EBikeRide: 'bike', Handcycle: 'bike', Velomobile: 'bike',
  WeightTraining: 'hyrox', Workout: 'hyrox', Crossfit: 'hyrox', HighIntensityIntervalTraining: 'hyrox', Elliptical: 'hyrox', StairStepper: 'hyrox', Rowing: 'hyrox',
};

/** Seconds per km from Strava's metres per second. */
function allureParKm(vitesseMs) {
  if (!vitesseMs || vitesseMs <= 0) return undefined;
  return 1000 / vitesseMs;
}

/* The date the athlete trained on, in their own timezone. `start_date` is UTC,
   so a 22:00 session in Paris would land on the next day and be matched
   against the wrong session; `start_date_local` is the one that means "the day
   this happened". Strava writes it as an ISO string with a fake Z. */
function jourLocal(activite) {
  return String(activite.start_date_local ?? activite.start_date ?? '').slice(0, 10);
}

function normaliser(a) {
  const type = a.sport_type ?? a.type ?? '';
  const mobile = a.moving_time ?? a.elapsed_time ?? 0;
  return {
    id_strava: a.id,
    date: jourLocal(a),
    debut: a.start_date_local ?? a.start_date ?? null,
    nom: a.name ?? '',
    sport: SPORTS[type] ?? 'autre',
    sport_strava: type,
    duree_min: Math.round(mobile / 60),
    duree_s: mobile,
    distance_m: Math.round(a.distance ?? 0),
    denivele_m: Math.round(a.total_elevation_gain ?? 0),
    allure_s_km: allureParKm(a.average_speed),
    fc_moy: a.average_heartrate ? Math.round(a.average_heartrate) : undefined,
    fc_max: a.max_heartrate ? Math.round(a.max_heartrate) : undefined,
    cadence_moy: a.average_cadence ? Math.round(a.average_cadence) : undefined,
    /* Strava's own "how hard was that" score, when the athlete has a HR zone
       setup. It is not our RPE — that stays the athlete's, in msc_journal. */
    effort: a.suffer_score ?? undefined,
    manuelle: Boolean(a.manual),
    privee: Boolean(a.private),
  };
}

/**
 * The athlete's activities since `depuis` (an ISO date or an epoch in seconds).
 * Summaries only — one or two requests for a month of training. `pagesMax`
 * borne le nombre de pages : dix pour la synchro d'un plan, bien plus pour
 * l'historique complet qu'un coach tire une fois.
 */
export async function activites(athleteId, { depuis, jusqua, pagesMax = PAGES_MAX } = {}) {
  const after = epoch(depuis);
  const before = epoch(jusqua);
  const out = [];
  for (let page = 1; page <= pagesMax; page += 1) {
    const lot = await api(athleteId, '/athlete/activities', { after, before, page, per_page: PAGE });
    if (!Array.isArray(lot) || lot.length === 0) break;
    out.push(...lot.map(normaliser));
    if (lot.length < PAGE) break;
  }

  await bd().execute(
    'UPDATE msc_strava_compte SET derniere_synchro = NOW(3) WHERE athlete_id = ?', [athleteId],
  );
  return out;
}

function epoch(valeur) {
  if (valeur === undefined || valeur === null || valeur === '') return undefined;
  if (typeof valeur === 'number') return Math.floor(valeur);
  const t = Date.parse(String(valeur).length === 10 ? `${valeur}T00:00:00Z` : String(valeur));
  return Number.isFinite(t) ? Math.floor(t / 1000) : undefined;
}

/**
 * One activity with its laps — the per-interval paces a quality session is
 * read on. A separate call because it costs a request each, and only a
 * handful of sessions in a week are ones where the splits mean anything.
 */
export async function activite(athleteId, id) {
  const a = await api(athleteId, `/activities/${Number(id)}`, { include_all_efforts: false });
  const laps = Array.isArray(a.laps) ? a.laps : [];
  return {
    ...normaliser(a),
    calories: a.calories ?? undefined,
    /* Seconds per km per lap, rounded — the shape the drift is read from. */
    laps: laps.map((l) => ({
      index: l.lap_index,
      duree_s: l.moving_time ?? l.elapsed_time ?? 0,
      distance_m: Math.round(l.distance ?? 0),
      allure_s_km: Math.round(allureParKm(l.average_speed) ?? 0) || undefined,
      fc_moy: l.average_heartrate ? Math.round(l.average_heartrate) : undefined,
    })),
  };
}

/* ---------------------------------------------------------- les webhooks */

/* Strava pushes an event when an activity lands, so the app does not have to
   poll for one. Two rules, both from Strava's side: the GET validation must be
   answered in under two seconds, and so must every event POST — which is why
   nothing here does any work beyond remembering that something happened. */

const EVENEMENTS_MAX = 50;
let evenements = [];

/** The GET Strava sends once, to prove we own the callback URL. */
export function verifierWebhook(query) {
  const attendu = config().verifyToken;
  if (!attendu) throw new StravaError('STRAVA_VERIFY_TOKEN non défini sur le serveur.', 501);
  if (query.get('hub.mode') !== 'subscribe') throw new StravaError('hub.mode inattendu.', 400);
  if (!egal(query.get('hub.verify_token') ?? '', attendu)) {
    throw new StravaError('hub.verify_token invalide.', 403);
  }
  const defi = query.get('hub.challenge');
  if (!defi) throw new StravaError('hub.challenge absent.', 400);
  return { 'hub.challenge': defi };
}

/* timingSafeEqual throws on a length mismatch, and returning early on one
   leaks the length. Digesting first makes both sides the same size. */
function egal(a, b) {
  const digest = (v) => createHash('sha256').update(String(v)).digest();
  return timingSafeEqual(digest(a), digest(b));
}

/** An event POST. Records it and returns; the app pulls the activity itself. */
export async function recevoirEvenement(corps) {
  const e = {
    type: corps?.object_type ?? '',
    aspect: corps?.aspect_type ?? '',
    id: corps?.object_id ?? null,
    athlete_id: corps?.owner_id ?? null,
    /* Strava sends `updates: { authorized: "false" }` when an athlete revokes
       our access from their side. That is the one event with a consequence
       here: the token we hold is already dead. */
    revoque: String(corps?.updates?.authorized ?? '') === 'false',
    recu_le: new Date().toISOString(),
  };

  /* Strava does not sign its deliveries, so anyone who learns the callback URL
     can post to it. Un événement qui ne nomme aucun athlète que nous
     connaissons n'est pas le nôtre : l'enregistrer dépenserait le quota de
     quelqu'un sur une synchro, et honorer son drapeau de révocation jetterait
     un jeton encore bon.

     La table est la seule autorité ici : c'est elle qui dit si cet identifiant
     Strava correspond à un athlète que nous suivons. */
  const athleteId = e.athlete_id === null ? null : await athleteDeStrava(e.athlete_id);
  if (!athleteId) return { ...e, ignore: true };
  e.msc_athlete_id = athleteId;

  evenements = [e, ...evenements].slice(0, EVENEMENTS_MAX);
  await bd().execute(
    `INSERT INTO msc_strava_evenement (strava_athlete_id, objet, aspect, objet_id, revoque, charge_utile)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [e.athlete_id, e.type, e.aspect, e.id, e.revoque ? 1 : 0, JSON.stringify(corps ?? {})],
  );
  if (e.revoque) await effacer(athleteId);
  return e;
}

/** What the app polls: has anything landed since it last synced? */
export function evenementsDepuis(athleteId, iso) {
  const siens = evenements.filter((e) => e.msc_athlete_id === athleteId);
  return iso ? siens.filter((e) => e.recu_le > iso) : siens;
}

/* ------------------------------------------------------------- l'état */

/** Everything the app is allowed to know. No token ever appears here. */
export async function etat(athleteId) {
  const c = await configPour(athleteId);
  const s = await lire(athleteId);
  return {
    configure: Boolean(c.clientId && c.clientSecret),
    app_propre: c.propre,
    rappel: rappel(),
    webhook: Boolean(c.verifyToken),
    lie: Boolean(s),
    athlete: s ? { id: s.strava_athlete_id, prenom: s.prenom, nom: s.nom } : null,
    portee: s?.portee ?? null,
    lie_le: s?.lie_le ?? null,
    derniere_synchro: s?.derniere_synchro ?? null,
    evenements: evenements.filter((e) => e.msc_athlete_id === athleteId).length,
    dernier_evenement:
      evenements.find((e) => e.msc_athlete_id === athleteId)?.recu_le ?? null,
    quotas,
  };
}

/* ------------------------------------------- l'abonnement aux webhooks */

/* Managed by scripts/strava-webhook.mjs rather than at startup: creating a
   subscription needs a callback URL Strava can reach from the internet, which
   a laptop on `npm run dev` is not. */

export async function abonnements() {
  const c = config();
  const url = new URL(`${API}/push_subscriptions`);
  url.searchParams.set('client_id', c.clientId);
  url.searchParams.set('client_secret', c.clientSecret);
  const reponse = await fetch(url);
  if (!reponse.ok) throw new StravaError(`Strava a répondu ${reponse.status}.`, 502);
  return reponse.json();
}

export async function abonner(callbackUrl) {
  const c = config();
  if (!c.verifyToken) throw new StravaError('STRAVA_VERIFY_TOKEN non défini.', 501);
  const reponse = await fetch(`${API}/push_subscriptions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: c.clientId,
      client_secret: c.clientSecret,
      callback_url: callbackUrl,
      verify_token: c.verifyToken,
    }),
  });
  const data = await reponse.json().catch(() => ({}));
  if (!reponse.ok) {
    /* Strava validates the callback URL synchronously, inside this request —
       so its errors here are usually about our own endpoint, not theirs. */
    throw new StravaError(
      `Strava a refusé l'abonnement (${reponse.status}) : ${JSON.stringify(data)}`,
      502,
    );
  }
  return data;
}

export async function desabonner(id) {
  const c = config();
  const url = new URL(`${API}/push_subscriptions/${Number(id)}`);
  url.searchParams.set('client_id', c.clientId);
  url.searchParams.set('client_secret', c.clientSecret);
  const reponse = await fetch(url, { method: 'DELETE' });
  if (!reponse.ok && reponse.status !== 204) {
    throw new StravaError(`Strava a répondu ${reponse.status}.`, 502);
  }
  return { supprime: Number(id) };
}
