/* Le serveur.

   Il existe pour une raison : les secrets ne doivent jamais atteindre le
   navigateur. Une clé Anthropic livrée dans une PWA est une clé que n'importe
   qui lit dans le bundle et dépense, un client secret Strava est le même
   problème, et les identifiants de la base en sont un troisième. Ils vivent
   donc ici, et l'application appelle ça.

     /api/connexion, /api/moi     qui parle, et de quel athlète
     /api/db/instantane           toute la base d'un athlète, en une fois
     /api/modeles                 les semaines types enregistrées, réutilisables
     /api/fraicheur               l'empreinte des données, pour savoir quand relire
     /api/journal, /api/mesure    ce que l'application écrit
     /api/activites               les activités appariées par le navigateur
     /api/photo, /api/mesure      la photo de la balance, et ce qu'on en tire
     /api/competitions            le back office
     /api/analyse, /api/recalcul  ce que Claude fait d'une séance, d'une semaine
     /api/coach                   les barres de chat
     /api/strava/*                l'OAuth, les activités, le webhook
     /api/methode                 la méthodologie d'un plan généré

   Deux routes seulement ne sont pas authentifiées, et ce sont celles que
   Strava appelle : le webhook et le retour d'autorisation. Tout le reste
   traverse `athleteDe`, qui lit le cookie et vérifie msc_acces — jamais le
   paramètre d'URL, qui n'est qu'une demande. */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { AuthError, athleteDe, athletesVisibles, connecter, cookieSession, identifier, ouvrirSession }
  from './auth.mjs';
import { BdError, scellementPret } from './bd.mjs';
import * as admin from './admin.mjs';
import * as depots from './depots.mjs';
import { construireMethode } from './methode.mjs';
import * as photo from './photo.mjs';
import { analyserSeance, planifierGlissant, recalculerPlan, repondre } from './coach.mjs';
import { classement } from './niveau.mjs';
import * as params from './params.mjs';
import * as strava from './strava.mjs';

const PORT = Number(process.env.PORT ?? 8787);

/* En production, ce serveur sert aussi la PWA. C'est un processus au lieu de
   deux, et surtout c'est la même origine : plus de CORS, un cookie de session
   qui voyage normalement, et le service worker qui contrôle vraiment la page.
   En développement, Vite sert l'app et cette partie dort. */
const DIST = resolve(process.env.MSC_DIST ?? 'dist');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/* Vite hache le nom des fichiers qu'il construit : ceux-là ne changent jamais
   sous un nom donné et peuvent être gardés un an. index.html et le service
   worker, eux, sont les deux fichiers dont dépend la mise à jour de tout le
   reste — les mettre en cache, c'est livrer une version que le navigateur
   refusera de remplacer. */
function cache(chemin) {
  if (/\/(index\.html|sw\.js|registerSW\.js|manifest\.webmanifest)$/.test(chemin)) {
    return 'no-cache';
  }
  return /\/assets\//.test(chemin) ? 'public, max-age=31536000, immutable' : 'public, max-age=3600';
}

async function servirFichier(res, chemin, code = 200) {
  const infos = await stat(chemin);
  if (!infos.isFile()) throw new Error('pas un fichier');
  res.writeHead(code, {
    'content-type': TYPES[extname(chemin)] ?? 'application/octet-stream',
    'content-length': infos.size,
    'cache-control': cache(chemin.split(sep).join('/')),
  });
  createReadStream(chemin).pipe(res);
}

/** La PWA construite, si elle est là. Rend false quand la requête n'est pas
    pour elle, pour que le routeur continue son chemin. */
async function servirPWA(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;

  /* `normalize` d'abord, puis vérification que le résultat est bien sous DIST :
     une requête « /../../etc/passwd » ne doit pas sortir du dossier. */
  const demande = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  const chemin = resolve(join(DIST, demande));
  if (chemin !== DIST && !chemin.startsWith(DIST + sep)) return false;

  try {
    await servirFichier(res, chemin);
    return true;
  } catch {
    /* Une route de l'application, pas un fichier : la PWA est une page unique,
       elle route elle-même. */
    try {
      await servirFichier(res, join(DIST, 'index.html'));
      return true;
    } catch {
      return false;
    }
  }
}

function json(res, code, body) {
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function html(res, code, body) {
  res.writeHead(code, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function lireCorps(req, maxOctets = 256_000) {
  const morceaux = [];
  let total = 0;
  for await (const morceau of req) {
    total += morceau.length;
    if (total > maxOctets) throw new Error('corps trop volumineux');
    morceaux.push(morceau);
  }
  return JSON.parse(Buffer.concat(morceaux).toString('utf8') || '{}');
}

async function lireOctets(req, maxOctets) {
  const morceaux = [];
  let total = 0;
  for await (const morceau of req) {
    total += morceau.length;
    if (total > maxOctets) throw new photo.PhotoError('Photo trop lourde.', 413);
    morceaux.push(morceau);
  }
  return Buffer.concat(morceaux);
}

function echapper(v) {
  return String(v).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/* The page Strava lands the athlete on once they have said yes. The app is on
   another origin, so it cannot read this window — it polls /api/strava/etat
   and sees the link appear. This page just has to say so and get out of the
   way. */
function pageRetour({ ok, message, retour }) {
  const titre = ok ? 'Strava connecté' : 'Liaison interrompue';
  return `<!doctype html>
<html lang="fr">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${titre} · MySmartCoach</title>
<style>
  :root { color-scheme: light }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
         background:#F6F9F8; color:#0A1C33;
         font:15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif }
  .carte { max-width:22rem; margin:1.5rem; padding:1.75rem; border-radius:14px;
           background:#fff; border:1px solid #DDE6E4; text-align:center }
  .pastille { width:44px; height:44px; margin:0 auto 1rem; border-radius:11px;
              display:grid; place-items:center; font-size:20px;
              background:${ok ? '#E6FAF5' : '#FDECEC'}; color:${ok ? '#02A988' : '#C0392B'} }
  h1 { margin:0 0 .5rem; font-size:1.05rem; letter-spacing:-.01em }
  p { margin:0 0 1.25rem; font-size:.85rem; color:#5A6B6B }
  a { display:inline-block; padding:.6rem 1.1rem; border-radius:999px;
      background:#02C9A0; color:#04231D; text-decoration:none; font-weight:600; font-size:.85rem }
</style>
<div class="carte">
  <div class="pastille">${ok ? '✓' : '!'}</div>
  <h1>${titre}</h1>
  <p>${echapper(message)}</p>
  <a href="${echapper(retour)}">Revenir à MySmartCoach</a>
</div>`;
}

/* --------------------------------------------------------- Strava et le webhook */

/* Ces deux-là sont appelées par Strava, pas par le navigateur : pas de cookie,
   pas d'athlète connecté. L'identité vient de l'état OAuth pour le retour, et
   de la table pour l'événement. */
async function routesPubliquesStrava(req, res, url, chemin) {
  if (chemin === '/webhook') {
    if (req.method === 'GET') return json(res, 200, strava.verifierWebhook(url.searchParams));
    if (req.method === 'POST') {
      /* Acknowledge first, think later — Strava retries anything slow. */
      json(res, 200, { ok: true });
      try {
        await strava.recevoirEvenement(await lireCorps(req, 32_000));
      } catch (e) {
        console.error('[strava] événement', e);
      }
      return undefined;
    }
    return json(res, 405, { erreur: 'méthode non autorisée' });
  }

  if (chemin === '/callback' && req.method === 'GET') {
    const retour = strava.config().retour;
    if (url.searchParams.get('error')) {
      return html(res, 200, pageRetour({
        ok: false, message: "L'autorisation a été refusée. Rien n'a été connecté.", retour,
      }));
    }
    try {
      const { prenom } = await strava.echangerCode(
        url.searchParams.get('code'), url.searchParams.get('state'),
      );
      return html(res, 200, pageRetour({
        ok: true,
        message: `${prenom ? `${prenom}, tes` : 'Tes'} activités remonteront maintenant dans le plan.`,
        retour,
      }));
    } catch (e) {
      console.error('[strava] callback', e);
      return html(res, e?.code === 400 ? 400 : 502, pageRetour({
        ok: false,
        message: e instanceof strava.StravaError ? e.message : 'La liaison a échoué.',
        retour,
      }));
    }
  }
  return null;
}

async function routesStrava(req, res, url, chemin) {
  const publique = await routesPubliquesStrava(req, res, url, chemin);
  if (publique !== null) return publique;

  const lecture = req.method === 'GET' && (chemin === '/etat' || chemin === '/app');
  const { athlete_id } = await athleteDe(req, url, lecture ? 'lecture' : 'ecriture');

  if (chemin === '/etat' && req.method === 'GET') {
    return json(res, 200, await strava.etat(athlete_id));
  }
  /* `duree=longue` : un lien que le coach envoie à l'athlète, valable un jour
     plutôt que dix minutes — il sera ouvert plus tard, ailleurs. */
  if (chemin === '/lien' && req.method === 'GET') {
    const longue = url.searchParams.get('duree') === 'longue';
    const lien = await strava.lienAutorisation(athlete_id, { duree: longue ? strava.ETAT_TTL_LONG_MS : undefined });
    return json(res, 200, { url: lien.url, expire_le: lien.expire_le });
  }
  /* Tout l'historique, tiré par le serveur et rangé tel quel : ce dont un
     coach part pour écrire un plan. Deux ans par défaut. */
  if (chemin === '/historique' && req.method === 'POST') {
    const corps = await lireCorps(req, 4_000);
    const depuis = /^\d{4}-\d{2}-\d{2}$/.test(String(corps.depuis ?? ''))
      ? corps.depuis
      : new Date(Date.now() - 2 * 365 * 86400 * 1000).toISOString().slice(0, 10);
    const activites = await strava.activites(athlete_id, { depuis, pagesMax: 80 });
    const resultat = await depots.importerHistorique(athlete_id, activites);
    return json(res, 200, { ...resultat, depuis, recues: activites.length, quotas: strava.derniersQuotas() });
  }
  /* L'application Strava propre à l'athlète — l'ID se lit, le secret jamais. */
  if (chemin === '/app') {
    if (req.method === 'GET') return json(res, 200, await strava.appPublique(athlete_id));
    if (req.method === 'PUT') return json(res, 200, await strava.ecrireApp(athlete_id, await lireCorps(req, 4_000)));
    if (req.method === 'DELETE') return json(res, 200, await strava.effacerApp(athlete_id));
    return json(res, 405, { erreur: 'méthode non autorisée' });
  }
  if (chemin === '/activites' && req.method === 'GET') {
    return json(res, 200, {
      activites: await strava.activites(athlete_id, {
        depuis: url.searchParams.get('depuis') ?? undefined,
        jusqua: url.searchParams.get('jusqua') ?? undefined,
      }),
      quotas: strava.derniersQuotas(),
    });
  }
  const detail = chemin.match(/^\/activite\/(\d+)$/);
  if (detail && req.method === 'GET') {
    return json(res, 200, await strava.activite(athlete_id, detail[1]));
  }
  if (chemin === '/evenements' && req.method === 'GET') {
    return json(res, 200, {
      evenements: strava.evenementsDepuis(athlete_id, url.searchParams.get('depuis') ?? undefined),
    });
  }
  if (chemin === '/delier' && req.method === 'POST') {
    return json(res, 200, await strava.delier(athlete_id));
  }
  return json(res, 404, { erreur: 'route inconnue' });
}

/* ---------------------------------------------------- les inscriptions */

/* Derrière un relais, l'adresse du client est dans X-Forwarded-For ; sinon
   c'est la prise. Ce n'est qu'un frein, pas une authentification. */
function adresseDe(req) {
  const relais = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
  return relais || req.socket?.remoteAddress || '?';
}

const INSCRIPTIONS_MAX = 5;
const INSCRIPTIONS_FENETRE_MS = 60 * 60 * 1000;
const inscriptions = new Map();

function inscriptionPermise(adresse) {
  const limite = Date.now() - INSCRIPTIONS_FENETRE_MS;
  const recentes = (inscriptions.get(adresse) ?? []).filter((t) => t > limite);
  inscriptions.set(adresse, recentes);
  return recentes.length < INSCRIPTIONS_MAX;
}

function noterInscription(adresse) {
  inscriptions.set(adresse, [...(inscriptions.get(adresse) ?? []), Date.now()]);
}

/* ------------------------------------------------------------- les routes */

async function router(req, res, url) {
  /* Derrière un relais monté sous /msc, une URL configurée avec sa barre
     finale arrive ici en « //api/sante » : c'est la même route. */
  const chemin = url.pathname.replace(/\/{2,}/g, '/');

  /* Ce que le serveur sait de lui-même, sans authentification : de quoi
     diagnostiquer une installation avant même d'avoir un compte. */
  if (chemin === '/api/sante') {
    /* La clé Anthropic en trois états, parce qu'un seul « absente » cachait
       trois pannes : pas de clé, une clé que l'API refuse, ou une clé scellée
       avec une autre MSC_SECRET_KEY que personne ne peut relire. */
    const cle = await params.etatDe('anthropic.cle');
    return json(res, 200, {
      ok: true,
      cle: cle.renseigne,
      cle_source: cle.source,
      cle_illisible: cle.illisible,
      strava: strava.configure(),
      scellement: scellementPret(),
    });
  }

  /* L'inscription libre : un athlète crée son compte depuis l'écran de
     connexion — c'est un service qu'on rejoint, et son coach est l'IA.
     L'admin peut la fermer (securite.inscription_ouverte) ou la garder
     derrière un code (securite.code_invitation). Tout est validé et écrit
     d'un coup — l'athlète, son compte, son accès — puis la session s'ouvre,
     comme après une connexion. Cinq par heure et par adresse : de quoi
     inscrire une famille, pas de quoi remplir la base. */
  if (chemin === '/api/inscription' && req.method === 'POST') {
    if (!(await params.param('securite.inscription_ouverte'))) {
      return json(res, 403, { erreur: 'Les inscriptions sont fermées. Demande un compte à l’admin.' });
    }
    const adresse = adresseDe(req);
    if (!inscriptionPermise(adresse)) {
      return json(res, 429, { erreur: 'Trop d’inscriptions depuis cette adresse. Réessaie dans une heure.' });
    }
    const corps = await lireCorps(req, 8_000);
    const code = await params.param('securite.code_invitation');
    if (code && String(corps.code ?? '').trim() !== String(code).trim()) {
      return json(res, 403, { erreur: 'Code d’invitation incorrect.' });
    }
    const nom = String(corps.nom ?? '').trim();
    const prenom = String(corps.prenom ?? '').trim();
    const r = await admin.inscrire({
      athlete: { nom, prenom: prenom || null, actuelle: corps.actuelle, cible: corps.cible, debut: corps.debut },
      compte: { email: corps.email, nom: [prenom, nom].filter(Boolean).join(' '), role: 'athlete', mot_de_passe: corps.mot_de_passe },
      droit: 'ecriture',
    });
    noterInscription(adresse);
    const compte = await connecter(corps.email, corps.mot_de_passe);
    res.setHeader('set-cookie', cookieSession(ouvrirSession(compte.id)));
    return json(res, 200, { compte, athletes: await athletesVisibles(compte.id), athlete: r.athlete });
  }

  if (chemin === '/api/connexion' && req.method === 'POST') {
    const { email, mot_de_passe } = await lireCorps(req, 4_000);
    const compte = await connecter(email, mot_de_passe);
    res.setHeader('set-cookie', cookieSession(ouvrirSession(compte.id)));
    return json(res, 200, { compte, athletes: await athletesVisibles(compte.id) });
  }

  if (chemin === '/api/deconnexion' && req.method === 'POST') {
    res.setHeader('set-cookie', cookieSession(null));
    return json(res, 200, { ok: true });
  }

  if (chemin === '/api/moi' && req.method === 'GET') {
    const identite = await identifier(req);
    if (!identite) return json(res, 401, { erreur: 'Non connecté.' });
    return json(res, 200, {
      compte: identite.compte,
      athletes: identite.bypass
        ? [{ id: identite.athlete_id, nom: identite.compte.nom, droit: 'ecriture' }]
        : await athletesVisibles(identite.compte.id),
    });
  }

  /* La vue coach : chaque athlète visible en un coup d'œil. Même règle que
     /api/moi pour la liste — msc_acces tranche, ou la porte de service. */
  if (chemin === '/api/apercu' && req.method === 'GET') {
    const identite = await identifier(req);
    if (!identite) return json(res, 401, { erreur: 'Non connecté.' });
    const athletes = identite.bypass
      ? [{ id: identite.athlete_id, nom: identite.compte.nom, droit: 'ecriture' }]
      : await athletesVisibles(identite.compte.id);
    return json(res, 200, { athletes: await depots.apercu(athletes) });
  }

  /* Le classement du club : cinq axes, une moyenne, un palier — pour tout
     compte connecté. Noms et scores, rien d'autre. */
  if (chemin === '/api/classement' && req.method === 'GET') {
    const identite = await identifier(req);
    if (!identite) return json(res, 401, { erreur: 'Non connecté.' });
    return json(res, 200, await classement());
  }

  /* Le calendrier commun des compétitions : tout compte connecté le voit en
     entier — c'est un calendrier de club. */
  if (chemin === '/api/calendrier' && req.method === 'GET') {
    const identite = await identifier(req);
    if (!identite) return json(res, 401, { erreur: 'Non connecté.' });
    return json(res, 200, { competitions: await depots.calendrier() });
  }

  /* Les réglages (msc_param) : lecture et écriture pour un coach ou un admin.
     La porte de service (MSC_ATHLETE_ID) passe aussi — c'est le poste de
     développement, sans compte. */
  if (chemin === '/api/param' && (req.method === 'GET' || req.method === 'PUT')) {
    const identite = await identifier(req);
    if (!identite) return json(res, 401, { erreur: 'Non connecté.' });
    if (!identite.bypass && !['coach', 'admin'].includes(identite.compte.role)) {
      return json(res, 403, { erreur: 'Réservé à un compte coach ou admin.' });
    }
    if (req.method === 'GET') return json(res, 200, { params: await params.tous() });
    const corps = await lireCorps(req, 8_000);
    if (!corps.cle) return json(res, 400, { erreur: 'champ manquant : cle' });
    return json(res, 200, { param: await params.ecrire(String(corps.cle), corps.valeur ?? null) });
  }

  /* Les modèles de semaine type : du vocabulaire de club, pas la donnée d'un
     athlète — d'où une route à part, et pas l'instantané. Les lire, les
     écrire et les supprimer est réservé au coach et à l'admin : c'est lui qui
     décide de la structure d'une semaine. */
  if (chemin === '/api/modeles') {
    const identite = await identifier(req);
    if (!identite) return json(res, 401, { erreur: 'Non connecté.' });
    if (!identite.bypass && !['coach', 'admin'].includes(identite.compte.role)) {
      return json(res, 403, { erreur: 'Réservé à un compte coach ou admin.' });
    }
    if (req.method === 'GET') return json(res, 200, await depots.modeles());
    if (req.method === 'POST') {
      const corps = await lireCorps(req, 16_000);
      /* Un nom vide ou une matrice dont aucun créneau ne tient debout : c'est
         la demande qui est mauvaise, pas le serveur — 400, et on le dit. */
      const nom = String(corps.nom ?? '').trim();
      if (!nom || depots.creneauxValides(corps.creneaux).length === 0) {
        return json(res, 400, { erreur: 'Un modèle a besoin d’un nom et d’au moins un créneau.' });
      }
      return json(res, 200, await depots.ecrireModele(nom, corps.creneaux));
    }
    if (req.method === 'DELETE') {
      return json(res, 200, await depots.supprimerModele(url.searchParams.get('nom')));
    }
  }

  /* Strava, athlète par athlète : pour un coach ses athlètes, pour un admin
     tous. L'état de la liaison, l'application propre, les activités reçues —
     jamais un jeton ni un secret. */
  if (chemin === '/api/admin/strava' && req.method === 'GET') {
    const identite = await identifier(req);
    if (!identite) return json(res, 401, { erreur: 'Non connecté.' });
    if (!identite.bypass && !['coach', 'admin'].includes(identite.compte.role)) {
      return json(res, 403, { erreur: 'Réservé à un compte coach ou admin.' });
    }
    const athletes = identite.bypass
      ? [{ id: identite.athlete_id, nom: identite.compte.nom, droit: 'ecriture' }]
      : identite.compte.role === 'admin'
        ? await admin.tousLesAthletes()
        : await athletesVisibles(identite.compte.id);
    return json(res, 200, { athletes: await admin.stravaParAthlete(athletes) });
  }

  /* Le back office : les comptes, les athlètes, les accès, l'état du serveur.
     Réservé au rôle admin — un coach a Réglages et Athlètes, pas les mots de
     passe des autres. La porte de service (MSC_ATHLETE_ID) passe aussi, comme
     pour /api/param : c'est le poste de développement. */
  if (chemin.startsWith('/api/admin/')) {
    const identite = await identifier(req);
    if (!identite) return json(res, 401, { erreur: 'Non connecté.' });
    if (!identite.bypass && identite.compte.role !== 'admin') {
      return json(res, 403, { erreur: 'Réservé à un compte admin.' });
    }
    const appelant = identite.compte.id;
    if (chemin === '/api/admin/comptes' && req.method === 'GET') {
      return json(res, 200, await admin.comptes());
    }
    if (chemin === '/api/admin/comptes' && req.method === 'POST') {
      return json(res, 200, { compte: await admin.creerCompte(await lireCorps(req, 8_000)) });
    }
    const unCompte = chemin.match(/^\/api\/admin\/comptes\/(\d+)$/);
    if (unCompte && req.method === 'PUT') {
      const corps = await lireCorps(req, 8_000);
      return json(res, 200, { compte: await admin.modifierCompte(Number(unCompte[1]), corps, appelant) });
    }
    if (chemin === '/api/admin/inscription' && req.method === 'POST') {
      return json(res, 200, await admin.inscrire(await lireCorps(req, 8_000)));
    }
    if (chemin === '/api/admin/athletes' && req.method === 'POST') {
      return json(res, 200, { athlete: await admin.creerAthlete(await lireCorps(req, 8_000)) });
    }
    /* Ce qu'une suppression détruirait, puis la suppression elle-même. Deux
       routes et pas une : on montre avant de détruire, et le nom tapé se
       revérifie ici — une confirmation qui ne vit que dans l'écran n'en est
       pas une. */
    const unAthlete = chemin.match(/^\/api\/admin\/athletes\/(\d+)$/);
    if (unAthlete && req.method === 'GET') {
      return json(res, 200, await admin.resumeAthlete(Number(unAthlete[1])));
    }
    if (unAthlete && req.method === 'DELETE') {
      const corps = await lireCorps(req, 4_000);
      return json(res, 200, await admin.supprimerAthlete(Number(unAthlete[1]), corps, appelant));
    }
    if (chemin === '/api/admin/acces' && req.method === 'PUT') {
      return json(res, 200, { acces: await admin.ecrireAcces(await lireCorps(req, 4_000)) });
    }
    if (chemin === '/api/admin/systeme' && req.method === 'GET') {
      return json(res, 200, await admin.systeme(DIST));
    }
    if (chemin === '/api/admin/demo' && req.method === 'POST') {
      const corps = await lireCorps(req, 2_000);
      const athleteId = Number(corps.athlete_id);
      if (!Number.isInteger(athleteId) || athleteId <= 0) return json(res, 400, { erreur: 'champ manquant : athlete_id' });
      return json(res, 200, await admin.retirerDemo(athleteId, { plan: Boolean(corps.plan) }));
    }
    return json(res, 404, { erreur: 'route inconnue' });
  }

  if (chemin === '/api/athlete/profil' && req.method === 'PUT') {
    const { athlete_id } = await athleteDe(req, url, 'ecriture');
    const corps = await lireCorps(req, 16_000);
    return json(res, 200, await depots.mutation(athlete_id, corps.mutation_id, 'profil', (cnx) =>
      depots.ecrireProfil(athlete_id, corps, cnx)));
  }

  if (chemin.startsWith('/api/strava')) {
    return routesStrava(req, res, url, chemin.replace(/^\/api\/strava/, '') || '/');
  }

  /* Tout ce qui suit est au nom d'un athlète. */

  /* La fraîcheur : une empreinte, et rien d'autre. Le téléphone la compare à
     celle de son instantané ; si elle a bougé, il redemande l'instantané.
     C'est la réponse la moins chère à « quelque chose a-t-il changé ? », et
     c'est ce qui fait qu'un entraînement modifié au back office arrive dans la
     main de l'athlète sans qu'il recharge quoi que ce soit. */
  if (chemin === '/api/fraicheur' && req.method === 'GET') {
    const { athlete_id } = await athleteDe(req, url);
    return json(res, 200, await depots.fraicheur(athlete_id));
  }

  if (chemin === '/api/db/instantane' && req.method === 'GET') {
    const { athlete_id, visibles, droit } = await athleteDe(req, url);
    /* L'empreinte part avec l'instantané : l'application sait ainsi de quelle
       version elle tient ses tables, et /api/fraicheur lui dit ensuite quand
       cette version est dépassée. */
    const [base, { empreinte }] = await Promise.all([
      depots.instantane(athlete_id),
      depots.fraicheur(athlete_id),
    ]);
    return json(res, 200, { ...base, empreinte, athlete_id, droit, athletes: visibles ?? null });
  }

  if (chemin === '/api/journal' && req.method === 'POST') {
    const { athlete_id } = await athleteDe(req, url, 'ecriture');
    const corps = await lireCorps(req, 16_000);
    return json(res, 200, await depots.mutation(athlete_id, corps.mutation_id, 'journal', (cnx) =>
      depots.ecrireJournal(athlete_id, corps, cnx)));
  }

  /* La semaine type : sept jours, deux créneaux, un sport et un type par
     créneau. Écrite d'un bloc — c'est une matrice, pas une liste de gestes. */
  if (chemin === '/api/structure' && req.method === 'POST') {
    const { athlete_id } = await athleteDe(req, url, 'ecriture');
    const corps = await lireCorps(req, 16_000);
    return json(res, 200, await depots.mutation(athlete_id, corps.mutation_id, 'structure', (cnx) =>
      depots.ecrireStructure(athlete_id, corps.creneaux, cnx)));
  }

  if (chemin === '/api/mesure' && req.method === 'POST') {
    const { athlete_id } = await athleteDe(req, url, 'ecriture');
    const corps = await lireCorps(req, 16_000);
    return json(res, 200, await depots.mutation(athlete_id, corps.mutation_id, 'mesure', (cnx) =>
      depots.ecrireMesure(athlete_id, corps, cnx)));
  }

  if (chemin === '/api/activites' && req.method === 'POST') {
    const { athlete_id } = await athleteDe(req, url, 'ecriture');
    const corps = await lireCorps(req, 2_000_000);
    return json(res, 200, await depots.mutation(athlete_id, corps.mutation_id, 'activites', (cnx) =>
      depots.ecrireActivites(athlete_id, corps.activites, cnx, { depuis: corps.depuis })));
  }

  /* La photo arrive en octets bruts avec son content-type, pas en multipart :
     un seul fichier par requête, et pas d'analyseur multipart à embarquer pour
     ça. Le navigateur envoie l'objet File tel quel. */
  if (chemin === '/api/photo' && req.method === 'POST') {
    const { athlete_id } = await athleteDe(req, url, 'ecriture');
    const octets = await lireOctets(req, 13 * 1024 * 1024);
    return json(res, 200, await photo.recevoir(athlete_id, {
      octets,
      mime: (req.headers['content-type'] ?? '').split(';')[0].trim(),
      date: url.searchParams.get('date') ?? undefined,
    }));
  }

  const image = chemin.match(/^\/api\/photo\/(\d+)$/);
  if (image && req.method === 'GET') {
    const { athlete_id } = await athleteDe(req, url);
    const { absolu, mime } = await photo.chemin(athlete_id, image[1]);
    const infos = await stat(absolu);
    res.writeHead(200, {
      'content-type': mime,
      'content-length': infos.size,
      /* Une photo ne change jamais sous son identifiant, et elle est privée :
         le cache du navigateur, pas celui d'un intermédiaire. */
      'cache-control': 'private, max-age=31536000, immutable',
    });
    return createReadStream(absolu).pipe(res);
  }

  if (chemin === '/api/mesure/confirmer' && req.method === 'POST') {
    const { athlete_id } = await athleteDe(req, url, 'ecriture');
    const corps = await lireCorps(req, 8_000);
    return json(res, 200, await depots.mutation(athlete_id, corps.mutation_id, 'mesure.confirmer',
      () => photo.confirmer(athlete_id, corps)));
  }

  /* Un plan généré, rangé. Le générateur tourne dans le navigateur — il est
     déterministe et n'appelle rien — et le serveur écrit ce qu'il a produit.
     Le plan d'avant est désactivé, pas supprimé : le journal et les activités
     qui visent ses séances restent entiers. */
  if (chemin === '/api/plan' && req.method === 'POST') {
    const { athlete_id } = await athleteDe(req, url, 'ecriture');
    const corps = await lireCorps(req, 4_000_000);
    return json(res, 200, await depots.mutation(athlete_id, corps.mutation_id, 'plan', (cnx) =>
      depots.enregistrerPlan(athlete_id, corps, cnx)));
  }

  /* Les sept prochains jours, replanifiés à partir du signal du matin. Le
     navigateur envoie la semaine jusqu'ici et les sept jours du plan (avec
     les allures que le moteur a calculées) ; le serveur y joint la mesure
     du matin et sa lecture, et range ce que le coach propose. */
  if (chemin === '/api/glissant' && req.method === 'POST') {
    const { athlete_id } = await athleteDe(req, url, 'ecriture');
    const { jeton_strava: _g, ...corps } = await lireCorps(req, 200_000);
    for (const champ of ['athlete', 'aujourdhui', 'prochains']) {
      if (corps[champ] === undefined) return json(res, 400, { erreur: `champ manquant : ${champ}` });
    }
    const plan = await depots.planActif(athlete_id);
    if (!plan) return json(res, 409, { erreur: 'Pas de plan actif : rien à replanifier.' });
    const coach = await depots.coachDe(athlete_id);
    const reponse = await planifierGlissant({
      ...corps, coach,
      matin: await depots.signalDuMatin(athlete_id),
      jeton_strava: await strava.jetonCourant(athlete_id),
    });
    const jours = Array.isArray(reponse.jours) ? reponse.jours : [];
    const range = await depots.enregistrerGlissant(athlete_id, {
      plan_id: plan.id, date: String(corps.aujourdhui).slice(0, 10),
      modele: reponse.modele, cout_eur: reponse.cout_eur, strava: reponse.strava, ton: coach,
      implication: reponse.implication, observations: reponse.observations,
      glissant: { signal: reponse.signal, implication: reponse.implication, jours, decision: reponse.decision ?? null },
      ajustements: jours
        .filter((j) => j.session_id && j.action !== 'garder' && j.action !== 'repos')
        .map((j) => ({
          session_id: j.session_id,
          part: j.action === 'reduire' || j.action === 'allonger' ? j.part : null,
          vers_date: j.action === 'deplacer' ? j.vers_date : null,
          texte: j.note,
        })),
      langue: corps.langue,
    });
    return json(res, 200, { ...reponse, range });
  }

  if (chemin === '/api/proposition' && req.method === 'POST') {
    const { athlete_id } = await athleteDe(req, url, 'ecriture');
    const { table, id, applique } = await lireCorps(req, 4_000);
    return json(res, 200, await depots.appliquer(athlete_id, table, id, applique));
  }

  /* Relier un start à un objectif du plan : « cette course, c'est celle-là ». */
  if (chemin === '/api/objectif/lien' && req.method === 'PUT') {
    const { athlete_id } = await athleteDe(req, url, 'ecriture');
    const corps = await lireCorps(req, 2_000);
    return json(res, 200, await depots.relierObjectif(athlete_id, corps));
  }

  if (chemin === '/api/competitions') {
    const { athlete_id } = await athleteDe(req, url, req.method === 'GET' ? 'lecture' : 'ecriture');
    if (req.method === 'GET') {
      const base = await depots.instantane(athlete_id);
      return json(res, 200, { competitions: base.msc_competition });
    }
    if (req.method === 'POST') {
      return json(res, 200, await depots.ecrireCompetition(athlete_id, await lireCorps(req, 32_000)));
    }
    if (req.method === 'DELETE') {
      const id = Number(url.searchParams.get('id'));
      return json(res, 200, await depots.supprimerCompetition(athlete_id, id));
    }
    return json(res, 405, { erreur: 'méthode non autorisée' });
  }

  /* Le coach. Les trois routes remettent à Claude le jeton Strava pour qu'il
     puisse lire au-delà des agrégats que la synchro a gardés — et le jeton est
     cherché ici, jamais pris dans la requête : un navigateur qui pourrait
     nommer son propre credential pourrait emprunter celui d'un autre. */
  if (chemin === '/api/analyse' && req.method === 'POST') {
    const { athlete_id } = await athleteDe(req, url, 'ecriture');
    const { jeton_strava: _a, ...corps } = await lireCorps(req);
    for (const champ of ['athlete', 'session']) {
      if (!corps[champ]) return json(res, 400, { erreur: `champ manquant : ${champ}` });
    }
    const coach = await depots.coachDe(athlete_id);
    const reponse = await analyserSeance({
      ...corps, coach,
      jeton_strava: await strava.jetonCourant(athlete_id),
    });
    /* Ce que la séance change au plan se range avec les observations, comme un
       troisième bloc : le schéma n'a pas à bouger pour une ligne de plus. */
    const observations = [
      ...(reponse.observations ?? []),
      ...(reponse.plan ? [{ ton: 'plan', lignes: [reponse.plan] }] : []),
    ];
    const range = await depots.enregistrerAnalyse(athlete_id, {
      session_id: corps.session.id, date: corps.session.date,
      modele: reponse.modele, cout_eur: reponse.cout_eur, strava: reponse.strava,
      verdict: reponse.verdict, observations, stats: corps.stats,
      adaptation: reponse.adaptation, suivante_id: corps.session.suivante?.id,
      langue: corps.langue, ton: coach,
    });
    return json(res, 200, { ...reponse, ...range });
  }

  if (chemin === '/api/recalcul' && req.method === 'POST') {
    const { athlete_id } = await athleteDe(req, url, 'ecriture');
    const { jeton_strava: _r, ...corps } = await lireCorps(req);
    for (const champ of ['athlete', 'semaine', 'ecart']) {
      if (corps[champ] === undefined) return json(res, 400, { erreur: `champ manquant : ${champ}` });
    }
    const reponse = await recalculerPlan({
      ...corps, coach: await depots.coachDe(athlete_id),
      jeton_strava: await strava.jetonCourant(athlete_id),
    });
    const base = await depots.instantane(athlete_id);
    const range = base.plan
      ? await depots.enregistrerRecalcul(athlete_id, {
          plan_id: base.plan.id, semaine: corps.semaine,
          date: new Date().toISOString().slice(0, 10),
          modele: reponse.modele, cout_eur: reponse.cout_eur, strava: reponse.strava,
          verdict: reponse.verdict, observations: reponse.observations,
          ecart: reponse.ecart, recalcul: reponse.recalcul,
          ajustements: reponse.ajustements, langue: corps.langue,
        })
      : {};
    return json(res, 200, { ...reponse, ...range });
  }

  if (chemin === '/api/coach' && req.method === 'POST') {
    const identite = await athleteDe(req, url, 'ecriture');
    const { athlete_id } = identite;
    const { jeton_strava: _c, ...corps } = await lireCorps(req);
    if (!corps.question) return json(res, 400, { erreur: 'champ manquant : question' });
    const coach = await depots.coachDe(athlete_id);
    /* Quand le compte voit plusieurs athlètes, le coach connaît la forme des
       autres — de quoi répondre à « et Léa, elle en est où ? ». Leur forme et
       leur charge, rien de plus : pas leur journal, pas leurs notes. */
    const contexte = [corps.contexte, await depots.formeDesAutres(identite, athlete_id)]
      .filter(Boolean).join('\n\n');
    const reponse = await repondre({
      ...corps, contexte, coach,
      jeton_strava: await strava.jetonCourant(athlete_id),
    });
    if (corps.fil) {
      await depots.ajouterAuChat(athlete_id, String(corps.fil).slice(0, 48), [
        { role: 'user', texte: corps.question },
        { role: 'assistant', texte: reponse.texte, modele: reponse.modele, cout_eur: reponse.cout_eur, ton: coach },
      ]);
    }
    return json(res, 200, reponse);
  }

  /* Les conversations d'un athlète avec le coach, pour le back office. */
  if (chemin === '/api/athlete/conversations' && req.method === 'GET') {
    const { athlete_id } = await athleteDe(req, url, 'lecture');
    return json(res, 200, { fils: await depots.conversations(athlete_id) });
  }

  if (chemin === '/api/methode' && req.method === 'POST') {
    await athleteDe(req, url, 'ecriture');
    const corps = await lireCorps(req);
    for (const champ of ['athlete', 'objectifs', 'contraintes', 'blocs']) {
      if (!corps[champ]) return json(res, 400, { erreur: `champ manquant : ${champ}` });
    }
    return json(res, 200, await construireMethode(corps));
  }

  return json(res, 404, { erreur: 'route inconnue' });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  /* En développement, l'app est servie par Vite sur un autre port. Le cookie de
     session voyage donc en cross-origin, ce qui exige une origine nommée — pas
     « * » — et allow-credentials. Les appels de Strava, eux, ne sont pas des
     requêtes de navigateur et ignorent tout ça. */
  res.setHeader('access-control-allow-origin', process.env.CORS_ORIGIN ?? 'http://localhost:5173');
  res.setHeader('access-control-allow-credentials', 'true');
  res.setHeader('access-control-allow-headers', 'content-type');
  res.setHeader('access-control-allow-methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('vary', 'origin');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();

  try {
    if (!url.pathname.startsWith('/api/')) {
      if (await servirPWA(req, res, url)) return undefined;
      return json(res, 404, { erreur: 'route inconnue' });
    }
    return await router(req, res, url);
  } catch (e) {
    /* Le message peut porter le détail de la requête : il va aux logs, et la
       réponse ne porte que la forme — sauf pour nos propres erreurs, qui sont
       écrites pour être lues. */
    console.error('[serveur]', url.pathname, e);
    if (res.headersSent) return undefined;
    if (e instanceof AuthError) return json(res, e.code, { erreur: e.message });
    if (e instanceof strava.StravaError) return json(res, e.code, { erreur: e.message });
    if (e instanceof photo.PhotoError) return json(res, e.code, { erreur: e.message });
    if (e instanceof depots.DepotError) return json(res, e.code, { erreur: e.message });
    if (e instanceof admin.AdminError) return json(res, e.code, { erreur: e.message });
    if (e instanceof BdError) return json(res, 500, { erreur: e.message });
    if (e instanceof params.ParamError) return json(res, e.statut, { erreur: e.message });

    const anthropic = await erreurAnthropic(e);
    if (anthropic) return json(res, anthropic.code, { erreur: anthropic.erreur });
    if (/ECONNREFUSED|ER_ACCESS_DENIED|ER_BAD_DB_ERROR|ENOTFOUND/.test(String(e?.code ?? e?.message))) {
      return json(res, 503, {
        erreur: 'La base de données ne répond pas. Vérifie MSC_DB_* et lance npm run db:migrate.',
      });
    }
    return json(res, 500, { erreur: 'La requête a échoué. Voir les logs du serveur.' });
  }
});

/**
 * Ce que l'API Anthropic a répondu, dit pour être lu sur l'écran.
 *
 * Un seul message couvrait « absente ou invalide », et il envoyait vérifier
 * Réglages quelqu'un dont la clé y était bel et bien : c'est l'API qui la
 * refusait. Trois pannes, trois phrases — et pour chacune, le geste qui
 * répare.
 *
 * Le SDK lève avant toute requête quand il ne trouve aucun credential (« could
 * not resolve authentication method ») ; ce cas n'atteint donc jamais un 401
 * de l'API, qui, lui, veut dire : une clé a été envoyée, et elle est refusée.
 */
async function erreurAnthropic(e) {
  const detail = String(e?.error?.error?.message ?? e?.message ?? '');
  if (/resolve authentication method/i.test(detail)) {
    const etat = await params.etatDe('anthropic.cle');
    return {
      code: 401,
      erreur: etat.illisible
        ? 'La clé Anthropic de Réglages a été scellée avec une autre MSC_SECRET_KEY et ne se relit plus : ressaisis-la dans Créer → Réglages.'
        : 'Aucune clé Anthropic : renseigne-la dans Créer → Réglages (compte coach), ou exporte ANTHROPIC_API_KEY sur le serveur (voir .env.example).',
    };
  }
  /* Une erreur du SDK porte un statut HTTP et le corps de la réponse ; une
     erreur de chez nous n'a ni l'un ni l'autre. */
  const statut = typeof e?.status === 'number' && (e?.error !== undefined || e?.headers !== undefined) ? e.status : null;
  if (statut === null) return null;
  if (statut === 401) {
    const etat = await params.etatDe('anthropic.cle');
    const laquelle = etat.source === 'base' ? 'celle de Réglages' : 'ANTHROPIC_API_KEY du serveur';
    return {
      code: 401,
      erreur: `L'API Anthropic refuse la clé (${laquelle}) : invalide ou révoquée. Génère-en une nouvelle sur console.anthropic.com → API keys, et colle-la dans Créer → Réglages.`,
    };
  }
  if (statut === 400 && /credit balance/i.test(detail)) {
    return { code: 402, erreur: 'Le compte Anthropic de cette clé n’a plus de crédit : recharge-le sur console.anthropic.com → Billing.' };
  }
  if (statut === 403) return { code: 403, erreur: `L'API Anthropic refuse l'accès à cette clé : ${detail}` };
  if (statut === 404) {
    return { code: 404, erreur: `L'API Anthropic ne connaît pas ce modèle : vérifie « Modèle du coach » dans Réglages (${detail}).` };
  }
  if (statut === 429) return { code: 429, erreur: 'L’API Anthropic limite le débit : réessaie dans une minute.' };
  if (statut === 529 || statut >= 500) return { code: 503, erreur: 'L’API Anthropic est indisponible pour le moment : réessaie.' };
  return null;
}

server.listen(PORT, async () => {
  console.log(`plan server → http://localhost:${PORT}`);
  stat(join(DIST, 'index.html')).then(
    () => console.log(`PWA servie depuis ${DIST}`),
    () => console.log(`pas de build dans ${DIST} — l'API seule (npm run build pour en produire un)`),
  );
  /* Les réglages d'abord : la configuration Strava les lit sans attendre. */
  await params.precharger();
  const cle = await params.etatDe('anthropic.cle');
  if (cle.illisible) {
    console.warn('⚠  Clé Anthropic illisible : scellée avec une autre MSC_SECRET_KEY — à ressaisir dans Réglages. Les routes du coach renverront 401.');
  } else if (!cle.renseigne) {
    console.warn('⚠  Clé Anthropic absente (back office → Réglages, ou ANTHROPIC_API_KEY) : les routes du coach renverront 401.');
  }
  if (!strava.configure()) {
    console.warn(
      '⚠  Strava non configuré (back office → Réglages, ou STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET) : la liaison renverra 501.',
    );
  }
  if (!scellementPret()) {
    console.warn(
      '⚠  MSC_SECRET_KEY absent : ni les sessions ni les jetons Strava ne peuvent être signés.\n' +
        '   node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }
  console.log(`photos → ${photo.racinePhotos()}`);
  if (process.env.MSC_ATHLETE_ID) {
    console.warn(
      `⚠  MSC_ATHLETE_ID=${process.env.MSC_ATHLETE_ID} : l'authentification est court-circuitée. ` +
        'Développement seulement.',
    );
  }
});
