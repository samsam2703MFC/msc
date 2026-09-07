/* The coach. What Claude says about a session that has already happened, and
   what it answers when the athlete asks something in a chat bar.

   This is the half of the app where a model belongs: reading a session back and
   saying what it means. The other half — the sync that fills `msc_activity` —
   deliberately has no model in it, because the pace engine computes against
   those numbers and `check:engine` asserts them to the second.

   The same line runs through this file. **Claude does not produce a figure
   here either.** The drift, the average pace, the RPE against its target: the
   app computes all of them from the activity it already synced, and passes
   them in. Claude is given the numbers and writes the reading of them — the
   verdict, what went well, what to watch — plus an adaptation expressed as a
   zone and a fraction of the planned duration, which the engine then turns
   back into a pace and a number of minutes.

   Strava's MCP server is attached when the athlete is linked, so Claude can go
   past the aggregates the app holds — the streams, the splits, the weeks
   before — rather than being limited to what one sync happened to keep. */

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

const MODEL = 'claude-opus-5';
const MCP_STRAVA = process.env.STRAVA_MCP_URL ?? 'https://mcp.strava.com/mcp';
const MCP_BETA = 'mcp-client-2025-11-20';

/* Only what a coach needs. Claude has no business reading the athlete's clubs
   or their gear to tell them how Wednesday's threshold went, and an allowlist
   is cheaper to reason about than a deny list that grows with the server. */
const OUTILS_STRAVA = ['list_activities', 'get_activity_performance', 'get_activity_streams'];

const ZONES = 'recup, ef, endactive, marathon, semi, seuil, allure10, vma';

/* The screen shows what the analysis cost. A fixed estimate at published Opus 5
   rates, converted at a fixed rate — it is a figure to keep the athlete honest
   about what they are spending, not an invoice. */
const USD_PAR_MTOK = { entree: 5, sortie: 25 };
const EUR_PAR_USD = 0.92;

function cout(usage) {
  if (!usage) return 0;
  const entree = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
  const sortie = usage.output_tokens ?? 0;
  const usd = (entree * USD_PAR_MTOK.entree + sortie * USD_PAR_MTOK.sortie) / 1_000_000;
  return Math.round(usd * EUR_PAR_USD * 10_000) / 10_000;
}

const Observation = z.object({
  ton: z.enum(['bon', 'attention']).describe(
    "« bon » pour ce qui s'est bien passé, « attention » pour ce qui mérite d'être surveillé",
  ),
  lignes: z.array(z.string()).describe(
    'Une à trois lignes, en français, courtes et concrètes. Pas de chiffre que tu aurais calculé toi-même : cite ceux qui te sont donnés.',
  ),
});

const Adaptation = z.object({
  zone: z.string().describe(`La zone à appliquer à la séance suivante : ${ZONES}`),
  part_duree: z
    .number()
    .describe(
      "La durée de la séance suivante, en fraction de celle prévue. 1 = inchangée, 0,75 = trois quarts. Reste entre 0,5 et 1 — tu ne rallonges jamais une séance après une séance dure.",
    ),
  pourquoi: z.string().describe('Une phrase : ce que l’ajustement protège.'),
});

const Analyse = z.object({
  verdict: z.string().describe(
    "Une à deux phrases : ce qui s'est passé dans cette séance. Tu peux citer les chiffres qui te sont donnés, jamais en inventer.",
  ),
  observations: z.array(Observation).describe('Un bloc « bon », un bloc « attention ». Au plus deux.'),
  adaptation: Adaptation.nullable().describe(
    "L'ajustement de la séance suivante, ou null si elle n'a pas besoin de bouger.",
  ),
  strava_lu: z.array(z.string()).describe(
    "Ce que tu es allé chercher dans Strava au-delà de ce qui t'a été fourni. Vide si tu n'y es pas allé.",
  ),
});

const SYSTEM = `Tu es l'entraîneur d'endurance de cet athlète. Tu lis une séance qui a
déjà eu lieu et tu dis ce qu'elle vaut.

Règles absolues :
- Tu ne CALCULES aucun chiffre. Les allures, les dérives, les charges et les écarts
  te sont donnés : l'application les calcule depuis la base et les vérifie. Tu les
  cites, tu ne les recomposes pas, et tu n'en inventes aucun autre.
- L'ajustement que tu proposes s'exprime par une zone (${ZONES}) et une fraction de
  la durée prévue. Le moteur en tire l'allure et les minutes. Tu n'écris jamais
  « 45 min à 6:20/km ».
- Tu parles à l'athlète, pas de lui, en phrases courtes.
- Une séance ratée est une information, pas une faute. Tu ne moralises pas.
- Si les données ne permettent pas de conclure, tu le dis plutôt que de meubler.`;

/* The app is FR / PL throughout, so the coach is too — one call in the language
   on screen, rather than a French answer machine-translated afterwards. */
const LANGUE = {
  fr: 'Tu écris en français.',
  pl: 'Piszesz po polsku. (Tu écris en polonais.)',
};

function systeme(langue) {
  return `${SYSTEM}\n- ${LANGUE[langue] ?? LANGUE.fr}`;
}

/* --------------------------------------------------------------- le repli */

function brancherStrava(jeton) {
  if (!jeton) return null;
  return {
    betas: [MCP_BETA],
    mcp_servers: [{ type: 'url', url: MCP_STRAVA, name: 'strava', authorization_token: jeton }],
    tools: [
      {
        type: 'mcp_toolset',
        mcp_server_name: 'strava',
        default_config: { enabled: false },
        configs: Object.fromEntries(OUTILS_STRAVA.map((nom) => [nom, { enabled: true }])),
      },
    ],
  };
}

/**
 * One call, at most twice.
 *
 * Whether Strava's MCP server accepts the access token our own OAuth obtained
 * is not knowable from here — it may run its own authorisation server, in
 * which case that token is not its currency. So the first attempt attaches it
 * and the second does without. The answer is poorer without the streams, not
 * absent: everything the app already synced is in the prompt either way.
 */
async function avecRepli(client, requete, jeton) {
  const mcp = brancherStrava(jeton);
  if (mcp) {
    try {
      const reponse = await client.beta.messages.parse({ ...requete, ...mcp });
      return { reponse, strava: true };
    } catch (e) {
      /* A genuine error — a bad key, a malformed request — will fail the same
         way on the retry, and that second failure is the one that propagates. */
      console.warn('[coach] MCP Strava indisponible, repli sans :', e?.message ?? e);
    }
  }
  return { reponse: await client.messages.parse(requete), strava: false };
}

/* ------------------------------------------------------- l'analyse d'une séance */

function contexteSeance({ athlete, session, allures, activite, journal, stats }) {
  const lignes = [
    `Athlète : ${athlete.nom}. Référence 10 km actuelle ${athlete.ref_actuelle} → cible ${athlete.ref_cible}.`,
    '',
    `Séance prévue : ${session.titre}`,
    `  ${session.date} · semaine ${session.semaine} · bloc ${session.bloc} · ${session.discipline} · type ${session.type}`,
    `  ${session.duree_min} min · RPE cible ${session.rpe_cible} · charge prévue ${session.charge}`,
    `  Déroulé : ${session.detail}`,
  ];

  if (allures?.length) {
    lignes.push('', 'Allures de la séance, calculées par le moteur pour ce bloc :');
    for (const a of allures) lignes.push(`  ${a.zone} ${a.valeur}`);
  }

  if (activite) {
    lignes.push('', 'Ce que Strava a enregistré :');
    lignes.push(`  ${activite.duree_min} min${activite.allure_moy ? ` · ${activite.allure_moy} de moyenne` : ''}${activite.fc_moy ? ` · FC moyenne ${activite.fc_moy}` : ''}`);
    if (activite.splits_blocs?.length) {
      lignes.push(`  Blocs de travail, en secondes par km : ${activite.splits_blocs.join(', ')}`);
    }
    lignes.push(`  id Strava ${activite.id_strava} — tu peux aller y lire le détail.`);
  } else {
    lignes.push('', 'Aucune activité Strava appariée à cette séance.');
  }

  if (journal) {
    lignes.push('', 'Ce que l’athlète a noté :');
    lignes.push(`  RPE ressenti ${journal.rpe_ressenti}${journal.sommeil ? ` · ${journal.sommeil} h de sommeil` : ''}`);
    if (journal.douleurs?.length) lignes.push(`  Douleurs : ${journal.douleurs.join(', ')}`);
    if (journal.note) lignes.push(`  Note : ${journal.note}`);
  }

  if (stats?.length) {
    lignes.push('', 'Les écarts, déjà calculés — cite-les tels quels :');
    for (const s of stats) lignes.push(`  ${s.label} : ${s.valeur}`);
  }

  if (session.suivante) {
    lignes.push(
      '',
      `Séance suivante, celle que ton ajustement viserait : ${session.suivante.titre}, ${session.suivante.duree_min} min, type ${session.suivante.type}, prévue en zone ${session.suivante.zones?.join(' + ') || '—'}.`,
    );
  }

  return lignes.join('\n');
}

export async function analyserSeance(corps) {
  const client = new Anthropic();
  const langue = corps.langue === 'pl' ? 'pl' : 'fr';
  const contexte = contexteSeance(corps);

  const { reponse, strava } = await avecRepli(
    client,
    {
      model: MODEL,
      max_tokens: 8000,
      system: systeme(langue),
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium', format: zodOutputFormat(Analyse) },
      messages: [
        {
          role: 'user',
          content: `${contexte}

Lis cette séance. Si tu as accès à Strava, va voir ce que les chiffres ci-dessus
ne disent pas — la forme de l'effort dans la séance, et comment elle se compare
aux semaines précédentes. Puis donne ton verdict, ce qui s'est bien passé, ce qui
mérite d'être surveillé, et l'ajustement de la séance suivante s'il en faut un.`,
        },
      ],
    },
    corps.jeton_strava,
  );

  if (!reponse.parsed_output) throw new Error("L'analyse n'a pas pu être structurée.");
  return {
    ...reponse.parsed_output,
    strava,
    modele: MODEL,
    cout_eur: cout(reponse.usage),
    usage: reponse.usage,
  };
}

/* ------------------------------------------------------------- la barre de chat */

const Reponse = z.object({
  texte: z.string().describe('La réponse, en français, deux à quatre phrases. Tu réponds à la question posée, tu ne récites pas le plan.'),
  strava_lu: z.array(z.string()).describe("Ce que tu es allé chercher dans Strava. Vide si tu n'y es pas allé."),
});

export async function repondre({ question, contexte, historique = [], jeton_strava, langue }) {
  if (typeof question !== 'string' || question.trim() === '') {
    throw new Error('question vide');
  }
  const client = new Anthropic();

  /* The history is the athlete's own turns and ours, so it is replayed as
     messages rather than folded into the prompt — that is what keeps a
     follow-up question ("et si je la décale ?") legible. */
  const messages = [
    ...historique
      .filter((m) => m && typeof m.texte === 'string' && (m.role === 'user' || m.role === 'assistant'))
      .slice(-8)
      .map((m) => ({ role: m.role, content: m.texte })),
    { role: 'user', content: `${contexte ? `${contexte}\n\n` : ''}Question de l'athlète : ${question}` },
  ];

  const { reponse, strava } = await avecRepli(
    client,
    {
      model: MODEL,
      max_tokens: 4000,
      system: `${systeme(langue === 'pl' ? 'pl' : 'fr')}

Ici tu réponds à une question posée dans l'application. Tu es bref. Si la question
porte sur ce que l'athlète a réellement fait et que tu as accès à Strava, va voir
plutôt que de supposer.`,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low', format: zodOutputFormat(Reponse) },
      messages,
    },
    jeton_strava,
  );

  if (!reponse.parsed_output) throw new Error("La réponse n'a pas pu être structurée.");
  return {
    ...reponse.parsed_output,
    strava,
    modele: MODEL,
    cout_eur: cout(reponse.usage),
    usage: reponse.usage,
  };
}
