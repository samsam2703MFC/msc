/* The plan server.

   It exists for one reason: the Anthropic API key must never reach the browser.
   A key shipped to a PWA is a key anyone can read out of the bundle and spend.
   So the key lives here, and the app calls this. */

import { createServer } from 'node:http';
import { construireMethode } from './methode.mjs';

const PORT = Number(process.env.PORT ?? 8787);

function json(res, code, body) {
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
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

const server = createServer(async (req, res) => {
  /* Dev only: the app is served from Vite on another port. */
  res.setHeader('access-control-allow-origin', process.env.CORS_ORIGIN ?? 'http://localhost:5173');
  res.setHeader('access-control-allow-headers', 'content-type');
  res.setHeader('access-control-allow-methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();

  if (req.url === '/api/sante') {
    return json(res, 200, { ok: true, cle: Boolean(process.env.ANTHROPIC_API_KEY) });
  }

  if (req.method !== 'POST' || req.url !== '/api/methode') {
    return json(res, 404, { erreur: 'route inconnue' });
  }

  try {
    const corps = await lireCorps(req);
    for (const champ of ['athlete', 'objectifs', 'contraintes', 'blocs']) {
      if (!corps[champ]) return json(res, 400, { erreur: `champ manquant : ${champ}` });
    }
    const methode = await construireMethode(corps);
    return json(res, 200, methode);
  } catch (e) {
    /* The message can carry request detail, so log it and return the shape only. */
    console.error('[methode]', e);

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
    return json(res, 500, { erreur: 'La génération a échoué. Voir les logs du serveur.' });
  }
});

server.listen(PORT, () => {
  const cle = process.env.ANTHROPIC_API_KEY;
  console.log(`plan server → http://localhost:${PORT}`);
  if (!cle) {
    console.warn(
      '⚠  ANTHROPIC_API_KEY non défini : /api/methode renverra 401.\n' +
        '   export ANTHROPIC_API_KEY=sk-ant-...  puis relance.',
    );
  }
});
