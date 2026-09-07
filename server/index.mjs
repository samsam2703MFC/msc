/* The plan server.

   It exists for one reason: the secrets must never reach the browser. An
   Anthropic key shipped in a PWA is a key anyone can read out of the bundle
   and spend, and a Strava client secret is the same problem — so both live
   here, and the app calls this.

   Two halves, and they do not know about each other:
     /api/methode      asks Claude for the training methodology
     /api/analyse      what Claude makes of a session that has happened
     /api/coach        the chat bars
     /api/recalcul     « Recalculer le plan » — the week, not the session
     /api/strava/*     the OAuth round-trip, the activities, the webhook

   The two coach routes attach Strava's MCP server to their Claude call, using
   the token the OAuth half already holds — so the model can read past what the
   sync kept. */

import { createServer } from 'node:http';
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

/* The page Strava lands the athlete on once they have said yes. The app is on
   another origin, so it cannot read this window — it polls /api/strava/etat
   and sees the link appear. This page just has to say so and get out of the
   way. */
function echapper(v) {
  return String(v).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

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

/* ------------------------------------------------------------- les routes */

async function routerStrava(req, res, url) {
  const chemin = url.pathname.replace(/^\/api\/strava/, '') || '/';

  /* Strava calls this one, not the browser: the GET proves we own the URL, the
     POST delivers events. Both must be answered in under two seconds. */
  if (chemin === '/webhook') {
    if (req.method === 'GET') {
      return json(res, 200, strava.verifierWebhook(url.searchParams));
    }
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

  /* Where Strava sends the athlete back. A top-level navigation, so it answers
     with a page rather than JSON. */
  if (chemin === '/callback' && req.method === 'GET') {
    const retour = strava.config().retour;
    const refus = url.searchParams.get('error');
    if (refus) {
      return html(res, 200, pageRetour({
        ok: false,
        message: "L'autorisation a été refusée. Rien n'a été connecté.",
        retour,
      }));
    }
    try {
      const { prenom } = await strava.echangerCode(
        url.searchParams.get('code'),
        url.searchParams.get('state'),
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

  if (chemin === '/etat' && req.method === 'GET') {
    return json(res, 200, await strava.etat());
  }

  if (chemin === '/lien' && req.method === 'GET') {
    return json(res, 200, { url: strava.lienAutorisation().url });
  }

  if (chemin === '/activites' && req.method === 'GET') {
    return json(res, 200, {
      activites: await strava.activites({
        depuis: url.searchParams.get('depuis') ?? undefined,
        jusqua: url.searchParams.get('jusqua') ?? undefined,
      }),
      quotas: strava.derniersQuotas(),
    });
  }

  const detail = chemin.match(/^\/activite\/(\d+)$/);
  if (detail && req.method === 'GET') {
    return json(res, 200, await strava.activite(detail[1]));
  }

  if (chemin === '/evenements' && req.method === 'GET') {
    return json(res, 200, {
      evenements: strava.evenementsDepuis(url.searchParams.get('depuis') ?? undefined),
    });
  }

  if (chemin === '/delier' && req.method === 'POST') {
    return json(res, 200, await strava.delier());
  }

  return json(res, 404, { erreur: 'route inconnue' });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  /* Dev only: the app is served from Vite on another port. Strava's own calls
     — the webhook and the callback — are not browser fetches and ignore this. */
  res.setHeader('access-control-allow-origin', process.env.CORS_ORIGIN ?? 'http://localhost:5173');
  res.setHeader('access-control-allow-headers', 'content-type');
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();

  try {
    if (url.pathname === '/api/sante') {
      return json(res, 200, {
        ok: true,
        cle: Boolean(process.env.ANTHROPIC_API_KEY),
        strava: strava.configure(),
      });
    }

    if (url.pathname.startsWith('/api/strava')) {
      return await routerStrava(req, res, url);
    }

    /* The coach. Both routes hand Claude the Strava token so it can read past
       the aggregates the app synced — and the token is fetched here, never
       taken from the request: a browser that could name its own credential
       would be a browser that could borrow someone else's. */
    if (req.method === 'POST' && url.pathname === '/api/analyse') {
      const { jeton_strava: _jetonAnalyse, ...corps } = await lireCorps(req);
      for (const champ of ['athlete', 'session']) {
        if (!corps[champ]) return json(res, 400, { erreur: `champ manquant : ${champ}` });
      }
      return json(res, 200, await analyserSeance({ ...corps, jeton_strava: await strava.jetonCourant() }));
    }

    if (req.method === 'POST' && url.pathname === '/api/recalcul') {
      const { jeton_strava: _jeton, ...corps } = await lireCorps(req);
      for (const champ of ['athlete', 'semaine', 'ecart']) {
        if (corps[champ] === undefined) return json(res, 400, { erreur: `champ manquant : ${champ}` });
      }
      return json(res, 200, await recalculerPlan({ ...corps, jeton_strava: await strava.jetonCourant() }));
    }

    if (req.method === 'POST' && url.pathname === '/api/coach') {
      const { jeton_strava: _jetonCoach, ...corps } = await lireCorps(req);
      if (!corps.question) return json(res, 400, { erreur: 'champ manquant : question' });
      return json(res, 200, await repondre({ ...corps, jeton_strava: await strava.jetonCourant() }));
    }

    if (req.method === 'POST' && url.pathname === '/api/methode') {
      const corps = await lireCorps(req);
      for (const champ of ['athlete', 'objectifs', 'contraintes', 'blocs']) {
        if (!corps[champ]) return json(res, 400, { erreur: `champ manquant : ${champ}` });
      }
      return json(res, 200, await construireMethode(corps));
    }

    return json(res, 404, { erreur: 'route inconnue' });
  } catch (e) {
    /* The message can carry request detail, so log it and return the shape
       only — except for our own errors, which are written to be read. */
    console.error('[serveur]', url.pathname, e);
    if (e instanceof strava.StravaError) return json(res, e.code, { erreur: e.message });

    /* The SDK throws before the request when it cannot resolve a credential,
       so that case never reaches a 401 from the API. */
    const sansCle =
      e?.status === 401 || /resolve authentication method/i.test(String(e?.message ?? ''));
    if (sansCle) {
      return json(res, 401, {
        erreur:
          "Clé Anthropic absente ou invalide. Exporte ANTHROPIC_API_KEY puis relance le serveur (voir .env.example).",
      });
    }
    return json(res, 500, { erreur: 'La requête a échoué. Voir les logs du serveur.' });
  }
});

server.listen(PORT, () => {
  console.log(`plan server → http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn(
      '⚠  ANTHROPIC_API_KEY non défini : /api/methode renverra 401.\n' +
        '   export ANTHROPIC_API_KEY=sk-ant-...  puis relance.',
    );
  }
  if (!strava.configure()) {
    console.warn(
      '⚠  STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET non définis : la liaison Strava renverra 501.\n' +
        '   https://www.strava.com/settings/api  puis voir .env.example.',
    );
  }
});
