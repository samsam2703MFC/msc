/* Le serveur.

   Il existe pour une raison : les secrets ne doivent jamais atteindre le
   navigateur. Une clé Anthropic livrée dans une PWA est une clé que n'importe
   qui lit dans le bundle et dépense, un client secret Strava est le même
   problème, et les identifiants de la base en sont un troisième. Ils vivent
   donc ici, et l'application appelle ça.

     /api/connexion, /api/moi     qui parle, et de quel athlète
     /api/db/instantane           toute la base d'un athlète, en une fois
     /api/journal, /api/mesure    ce que l'application écrit
     /api/competitions            le back office
     /api/analyse, /api/recalcul  ce que Claude fait d'une séance, d'une semaine
     /api/coach                   les barres de chat
     /api/strava/*                l'OAuth, les activités, le webhook
     /api/methode                 la méthodologie d'un plan généré

   Deux routes seulement ne sont pas authentifiées, et ce sont celles que
   Strava appelle : le webhook et le retour d'autorisation. Tout le reste
   traverse `athleteDe`, qui lit le cookie et vérifie msc_acces — jamais le
   paramètre d'URL, qui n'est qu'une demande. */

import { createServer } from 'node:http';
import { AuthError, athleteDe, athletesVisibles, connecter, cookieSession, identifier, ouvrirSession }
  from './auth.mjs';
import { BdError, scellementPret } from './bd.mjs';
import * as depots from './depots.mjs';
import { construireMethode } from './methode.mjs';
import { analyserSeance, recalculerPlan, repondre } from './coach.mjs';
import * as strava from './strava.mjs';

const PORT = Number(process.env.PORT ?? 8787);

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

  const { athlete_id } = await athleteDe(req, url, chemin === '/etat' ? 'lecture' : 'ecriture');

  if (chemin === '/etat' && req.method === 'GET') {
    return json(res, 200, await strava.etat(athlete_id));
  }
  if (chemin === '/lien' && req.method === 'GET') {
    return json(res, 200, { url: strava.lienAutorisation(athlete_id).url });
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

/* ------------------------------------------------------------- les routes */

async function router(req, res, url) {
  const chemin = url.pathname;

  /* Ce que le serveur sait de lui-même, sans authentification : de quoi
     diagnostiquer une installation avant même d'avoir un compte. */
  if (chemin === '/api/sante') {
    return json(res, 200, {
      ok: true,
      cle: Boolean(process.env.ANTHROPIC_API_KEY),
      strava: strava.configure(),
      scellement: scellementPret(),
    });
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

  if (chemin.startsWith('/api/strava')) {
    return routesStrava(req, res, url, chemin.replace(/^\/api\/strava/, '') || '/');
  }

  /* Tout ce qui suit est au nom d'un athlète. */
  if (chemin === '/api/db/instantane' && req.method === 'GET') {
    const { athlete_id, visibles, droit } = await athleteDe(req, url);
    const base = await depots.instantane(athlete_id);
    return json(res, 200, { ...base, athlete_id, droit, athletes: visibles ?? null });
  }

  if (chemin === '/api/journal' && req.method === 'POST') {
    const { athlete_id } = await athleteDe(req, url, 'ecriture');
    const corps = await lireCorps(req, 16_000);
    return json(res, 200, await depots.mutation(athlete_id, corps.mutation_id, 'journal', (cnx) =>
      depots.ecrireJournal(athlete_id, corps, cnx)));
  }

  if (chemin === '/api/mesure' && req.method === 'POST') {
    const { athlete_id } = await athleteDe(req, url, 'ecriture');
    const corps = await lireCorps(req, 16_000);
    return json(res, 200, await depots.mutation(athlete_id, corps.mutation_id, 'mesure', (cnx) =>
      depots.ecrireMesure(athlete_id, corps, cnx)));
  }

  if (chemin === '/api/proposition' && req.method === 'POST') {
    const { athlete_id } = await athleteDe(req, url, 'ecriture');
    const { table, id, applique } = await lireCorps(req, 4_000);
    return json(res, 200, await depots.appliquer(athlete_id, table, id, applique));
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
    const reponse = await analyserSeance({
      ...corps, jeton_strava: await strava.jetonCourant(athlete_id),
    });
    const range = await depots.enregistrerAnalyse(athlete_id, {
      session_id: corps.session.id, date: corps.session.date,
      modele: reponse.modele, cout_eur: reponse.cout_eur, strava: reponse.strava,
      verdict: reponse.verdict, observations: reponse.observations, stats: corps.stats,
      adaptation: reponse.adaptation, suivante_id: corps.session.suivante?.id,
      langue: corps.langue,
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
      ...corps, jeton_strava: await strava.jetonCourant(athlete_id),
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
    const { athlete_id } = await athleteDe(req, url, 'ecriture');
    const { jeton_strava: _c, ...corps } = await lireCorps(req);
    if (!corps.question) return json(res, 400, { erreur: 'champ manquant : question' });
    const reponse = await repondre({
      ...corps, jeton_strava: await strava.jetonCourant(athlete_id),
    });
    if (corps.fil) {
      await depots.ajouterAuChat(athlete_id, String(corps.fil).slice(0, 48), [
        { role: 'user', texte: corps.question },
        { role: 'assistant', texte: reponse.texte, modele: reponse.modele, cout_eur: reponse.cout_eur },
      ]);
    }
    return json(res, 200, reponse);
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
  res.setHeader('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('vary', 'origin');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();

  try {
    return await router(req, res, url);
  } catch (e) {
    /* Le message peut porter le détail de la requête : il va aux logs, et la
       réponse ne porte que la forme — sauf pour nos propres erreurs, qui sont
       écrites pour être lues. */
    console.error('[serveur]', url.pathname, e);
    if (res.headersSent) return undefined;
    if (e instanceof AuthError) return json(res, e.code, { erreur: e.message });
    if (e instanceof strava.StravaError) return json(res, e.code, { erreur: e.message });
    if (e instanceof BdError) return json(res, 500, { erreur: e.message });

    /* Le SDK lève avant la requête quand il ne résout aucun credential, donc
       ce cas n'atteint jamais un 401 de l'API. */
    const sansCle =
      e?.status === 401 || /resolve authentication method/i.test(String(e?.message ?? ''));
    if (sansCle) {
      return json(res, 401, {
        erreur:
          "Clé Anthropic absente ou invalide. Exporte ANTHROPIC_API_KEY puis relance le serveur (voir .env.example).",
      });
    }
    if (/ECONNREFUSED|ER_ACCESS_DENIED|ER_BAD_DB_ERROR|ENOTFOUND/.test(String(e?.code ?? e?.message))) {
      return json(res, 503, {
        erreur: 'La base de données ne répond pas. Vérifie MSC_DB_* et lance npm run db:migrate.',
      });
    }
    return json(res, 500, { erreur: 'La requête a échoué. Voir les logs du serveur.' });
  }
});

server.listen(PORT, () => {
  console.log(`plan server → http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('⚠  ANTHROPIC_API_KEY non défini : les routes du coach renverront 401.');
  }
  if (!strava.configure()) {
    console.warn(
      '⚠  STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET non définis : la liaison Strava renverra 501.',
    );
  }
  if (!scellementPret()) {
    console.warn(
      '⚠  MSC_SECRET_KEY absent : ni les sessions ni les jetons Strava ne peuvent être signés.\n' +
        '   node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }
  if (process.env.MSC_ATHLETE_ID) {
    console.warn(
      `⚠  MSC_ATHLETE_ID=${process.env.MSC_ATHLETE_ID} : l'authentification est court-circuitée. ` +
        'Développement seulement.',
    );
  }
});
