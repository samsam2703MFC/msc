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
import { cleAnthropic, param } from './params.mjs';

/* La clé et le modèle viennent de msc_param (le back office), l'environnement
   en repli : c'est le seul endroit où le coach les demande. */
async function coachClient() {
  return {
    client: new Anthropic({ apiKey: await cleAnthropic() }),
    MODELE: String((await param('coach.modele')) || 'claude-opus-5'),
  };
}
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

/* Les codes du journal, dits comme un entraîneur les dirait. */
const LIMITE_EN_CLAIR = {
  rien: 'rien',
  jambes: 'les jambes (musculaire)',
  souffle: 'le souffle (cardio-respiratoire)',
  technique: 'la technique',
  mental: 'le mental',
  sommeil: 'le manque de sommeil',
  nutrition: 'la nutrition',
  douleur: 'une douleur',
  chaleur: 'la chaleur',
};

/* Et pourquoi elle n'a pas eu lieu du tout. Le coach n'ajuste pas de la même
   façon selon la réponse : « pas le temps » déplace, « pas envie » se traite
   au moral et à la dose, « douleur » protège. */
const RAISON_EN_CLAIR = {
  pas_envie: 'pas envie',
  pas_le_temps: 'pas le temps',
  fatigue: 'trop fatigué',
  douleur: 'une douleur',
  malade: 'malade',
  meteo: 'la météo',
  voyage: 'en déplacement',
  imprevu: 'un imprévu',
  autrement: 'autre chose à la place',
};

const Analyse = z.object({
  verdict: z.string().describe(
    "Une à deux phrases : ce qui s'est passé dans cette séance. Tu peux citer les chiffres qui te sont donnés, jamais en inventer.",
  ),
  observations: z.array(Observation).describe('Un bloc « bon », un bloc « attention ». Au plus deux.'),
  plan: z.string().nullable().describe(
    "Ce que cette séance change pour l'équilibre du plan, en une à trois phrases : ce qu'elle a coûté ou protégé, et ce que ça veut dire pour la suite de la semaine. Si l'athlète est allé plus vite ou plus fort que prescrit, c'est ici que tu expliques pourquoi ça déséquilibre le plan. null si la séance s'est déroulée comme prévue.",
  ),
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
- Quand l'athlète est allé plus vite ou plus fort que ce qui était prescrit, tu le
  dis sans détour, et tu expliques ce que ça coûte au plan : une séance facile
  courue trop vite n'est plus une séance facile — elle entame la récupération que
  la prochaine séance de qualité devait trouver, décale la fatigue sur la semaine,
  et travaille l'allure du jour au lieu de la référence 10 km d'où le plan tire
  toutes ses allures. Le plan tient par l'écart entre facile et dur ; aller vite le
  jour facile ferme cet écart. Tu le dis avec les chiffres fournis, pas d'autres.
- Ce que l'athlète dit avoir bloqué (jambes, souffle, technique, mental…) nomme
  le système à protéger ou à travailler ; ton ajustement en tient compte.
- Si les données ne permettent pas de conclure, tu le dis plutôt que de meubler.`;

/* The app is FR / PL throughout, so the coach is too — one call in the language
   on screen, rather than a French answer machine-translated afterwards. */
const LANGUE = {
  fr: 'Tu écris en français.',
  pl: 'Piszesz po polsku. (Tu écris en polonais.)',
};

/* Le coach que l'athlète a choisi. Trois figures, un ton chacune — ce qu'elles
   disent est le même plan ; c'est comment elles le disent qui change. Le
   fond (aucun chiffre inventé, aucune séance rattrapée) ne se négocie pas. */
export const COACHS = ['tortionnaire', 'gentil', 'gros_porc'];
const PERSONA = {
  tortionnaire: `Ton personnage : LE TORTIONNAIRE. Tu ne félicites jamais gratuitement. Tu
exiges, tu relèves chaque écart, tu parles court et sec, tu ne t'excuses pas. La
motivation vient du défi : tu mets l'athlète au pied du mur et tu attends mieux la
prochaine fois. Une séance sautée, tu la nommes ; une séance trop rapide, tu la
nommes aussi — l'indiscipline dans les deux sens. Dur, jamais méchant : pas
d'insulte, pas d'humiliation, pas de menace. Quand c'est bien fait, tu le dis en
trois mots, pas plus.`,
  gentil: `Ton personnage : LE GENTIL. Tu encourages d'abord, tu corriges ensuite, et tu
expliques toujours pourquoi. Chaleureux, patient, tu rassures sans mentir : une
séance manquée n'est pas grave, mais tu dis ce qu'elle a coûté. La motivation vient
du progrès visible — tu le montres avec les chiffres fournis. Le suivi : tu
proposes, tu ne réclames pas.`,
  gros_porc: `Ton personnage : LE GROS PORC. Tu parles bouffe, canapé et bière, avec gouaille et
autodérision ; tu rigoles de tout, de toi d'abord, de l'athlète ensuite — jamais de
sa santé, de son corps ou d'une douleur. Tu joues la mauvaise influence, et pourtant
tes consignes sont exactement celles du plan : c'est ça, la blague. La motivation
vient du rire. Le suivi : tu remarques tout, l'air de rien. Familier et un peu
vulgaire (« bordel », « merde »), jamais d'injure envers l'athlète, jamais
d'alcool ou de bouffe conseillés pour de vrai.`,
};

function systeme(langue, coach) {
  const persona = PERSONA[COACHS.includes(coach) ? coach : 'gentil'];
  return `${SYSTEM}\n- ${LANGUE[langue] ?? LANGUE.fr}\n\n${persona}\nLe personnage change le ton, jamais le fond : les règles ci-dessus passent avant lui.`;
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
    if (journal.limites?.length) {
      lignes.push(
        journal.limites.includes('rien')
          ? '  Ce qui a bloqué : rien, d’après lui.'
          : `  Ce qui a bloqué : ${journal.limites.map((l) => LIMITE_EN_CLAIR[l] ?? l).join(', ')}. C’est le point d’entrée de ton ajustement : ce qui a bloqué dit quel système protéger la prochaine fois.`,
      );
    }
    if (journal.note) lignes.push(`  Note : ${journal.note}`);
  }
  if (journal?.limites_recentes?.length) {
    lignes.push(`  Sur les séances précédentes, ce qui a bloqué : ${journal.limites_recentes.map((l) => LIMITE_EN_CLAIR[l] ?? l).join(', ')}.`);
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
  const { client, MODELE } = await coachClient();
  const langue = corps.langue === 'pl' ? 'pl' : 'fr';
  const contexte = contexteSeance(corps);

  const { reponse, strava } = await avecRepli(
    client,
    {
      model: MODELE,
      max_tokens: 8000,
      system: systeme(langue, corps.coach),
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium', format: zodOutputFormat(Analyse) },
      messages: [
        {
          role: 'user',
          content: `${contexte}

Lis cette séance. Si tu as accès à Strava, va voir ce que les chiffres ci-dessus
ne disent pas — la forme de l'effort dans la séance, et comment elle se compare
aux semaines précédentes. Puis donne ton verdict, ce qui s'est bien passé, ce qui
mérite d'être surveillé, ce que la séance change pour l'équilibre du plan — si
l'athlète est allé trop vite ou trop fort, pourquoi ça le déséquilibre — et
l'ajustement de la séance suivante s'il en faut un.`,
        },
      ],
    },
    corps.jeton_strava,
  );

  if (!reponse.parsed_output) throw new Error("L'analyse n'a pas pu être structurée.");
  return {
    ...reponse.parsed_output,
    strava,
    modele: MODELE,
    cout_eur: cout(reponse.usage),
    usage: reponse.usage,
  };
}

/* ------------------------------------------------------------- la barre de chat */

const Reponse = z.object({
  texte: z.string().describe('La réponse, en français, deux à quatre phrases. Tu réponds à la question posée, tu ne récites pas le plan.'),
  strava_lu: z.array(z.string()).describe("Ce que tu es allé chercher dans Strava. Vide si tu n'y es pas allé."),
});

export async function repondre({ question, contexte, historique = [], jeton_strava, langue, coach }) {
  if (typeof question !== 'string' || question.trim() === '') {
    throw new Error('question vide');
  }
  const { client, MODELE } = await coachClient();

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
      model: MODELE,
      max_tokens: 4000,
      system: `${systeme(langue === 'pl' ? 'pl' : 'fr', coach)}

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
    modele: MODELE,
    cout_eur: cout(reponse.usage),
    usage: reponse.usage,
  };
}

/* ======================================================================
   La semaine — « Recalculer le plan »

   Same shape as the session analysis, one scope up, and with one doctrine of
   the plan's own written into the prompt: a missed session is never made up
   for. The plan recalibrates; it does not ask the athlete to catch up. That is
   the workbook's rule, not a preference, and a model left to itself proposes
   catch-up sessions because that is what the internet is full of. */

const AjustementPropose = z.object({
  session_id: z
    .number()
    .nullable()
    .describe(
      "L'id d'une séance de la liste fournie. null pour un ajustement à l'échelle d'une semaine.",
    ),
  semaine: z
    .number()
    .nullable()
    .describe("Le numéro de semaine, pour un ajustement de semaine. null sinon."),
  part: z
    .number()
    .nullable()
    .describe(
      "La quantité de la séance — sa durée, ou ses mètres si c'est une nage — en fraction de ce qui était prévu. 1 = inchangée, 0,8 = réduite d'un cinquième, 1,2 = augmentée d'un cinquième. Entre 0,5 et 1,25. null pour un ajustement de semaine.",
    ),
  texte: z
    .string()
    .nullable()
    .describe(
      "Pour un ajustement de semaine seulement : ce qui change, en une ligne, sans aucun chiffre de volume, d'allure ou de durée.",
    ),
  type: z
    .string()
    .nullable()
    .describe(
      'Pour un ajustement de semaine seulement : le code de type concerné — ef, recup, endactive, seuil, allure10, vma, longue, montagne, force, compromis, nage, velo, test, repos, course.',
    ),
});

const Recalcul = z.object({
  ecart: z
    .string()
    .describe(
      "Ce que la semaine a laissé filer, en une ou deux phrases. Tu cites les chiffres fournis et tu n'en produis aucun autre.",
    ),
  recalcul: z
    .array(
      z.object({
        portee: z.string().describe('La portée, courte : « S8 », « S9–S12 ».'),
        texte: z
          .string()
          .describe(
            "Ce qui change sur cette portée, en une ligne. Aucun chiffre de volume, d'allure ou de durée : tu dis quoi et pourquoi, le moteur dit combien.",
          ),
      }),
    )
    .describe('Deux à quatre portées, de la plus proche à la plus lointaine.'),
  verdict: z.string().describe('Le verdict de la semaine, une à deux phrases.'),
  observations: z.array(Observation).describe('Un bloc « bon », un bloc « attention ». Au plus deux.'),
  ajustements: z
    .array(AjustementPropose)
    .describe("Deux à quatre ajustements concrets. Chacun nomme une séance de la liste, ou une semaine."),
  strava_lu: z.array(z.string()).describe("Ce que tu es allé chercher dans Strava. Vide si tu n'y es pas allé."),
});

const DOCTRINE = `Deux règles du plan que tu ne discutes pas :
- Une séance sautée n'est JAMAIS rattrapée. Le plan se réétalonne ; il ne fait pas
  rattraper. Ne propose jamais de séance de rattrapage.
- Quand il faut sacrifier, l'ordre est : le vélo d'abord, puis le second Hyrox,
  puis la nage. La séance de qualité et la sortie longue se protègent.`;

function contexteSemaine({ athlete, semaine, bloc, ecart, seances, suite, regles }) {
  const lignes = [
    `Athlète : ${athlete.nom}. Référence 10 km actuelle ${athlete.ref_actuelle} → cible ${athlete.ref_cible}.`,
    `Semaine ${semaine}, bloc ${bloc}.`,
    '',
    'L’écart, déjà calculé — cite-le tel quel :',
    `  volume en retard ${ecart.retard} · ${ecart.sautees} séance(s) sautée(s) · réalisation ${ecart.realisation}`,
    `  (${ecart.fait_min} min faites sur ${ecart.du_min} min dues)`,
    '',
    'Les séances de la semaine. Un ajustement ne peut nommer qu’un de ces id :',
  ];
  for (const s of seances ?? []) {
    lignes.push(
      `  ${s.id}  ${s.jour} ${s.date} · ${s.titre} · ${s.discipline} · ${s.type} · ${s.duree_min} min${s.natation_m ? ` · ${s.natation_m} m` : ''} · ${s.faite ? 'FAITE' : 'non faite'}`,
    );
  }

  if (suite?.length) {
    lignes.push('', 'Les semaines qui suivent, si un déplacement doit atterrir quelque part :');
    for (const w of suite) lignes.push(`  S${w.semaine} · ${w.phase} · bloc ${w.bloc} · ${w.heures} h`);
  }

  if (regles?.length) {
    lignes.push('', 'Les règles d’ajustement du plan, telles qu’elles sont écrites :');
    for (const r of regles) lignes.push(`  ${r}`);
  }

  return lignes.join('\n');
}

export async function recalculerPlan(corps) {
  const { client, MODELE } = await coachClient();
  const langue = corps.langue === 'pl' ? 'pl' : 'fr';

  const { reponse, strava } = await avecRepli(
    client,
    {
      model: MODELE,
      max_tokens: 12000,
      system: `${systeme(langue, corps.coach)}\n\n${DOCTRINE}`,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high', format: zodOutputFormat(Recalcul) },
      messages: [
        {
          role: 'user',
          content: `${contexteSemaine(corps)}

Réétalonne. Si tu as accès à Strava, regarde ce que l'athlète a réellement fait
cette semaine et les précédentes — la tendance compte plus que la semaine seule.

Puis donne : ce que la semaine a laissé filer, ce que le réétalonnage change et
sur quelles portées, le verdict de la semaine, et les ajustements concrets.
Chaque ajustement nomme une séance de la liste par son id et une fraction de sa
quantité, ou une semaine et ce qui s'y déplace.`,
        },
      ],
    },
    corps.jeton_strava,
  );

  if (!reponse.parsed_output) throw new Error("Le réétalonnage n'a pas pu être structuré.");
  return {
    ...reponse.parsed_output,
    strava,
    modele: MODELE,
    cout_eur: cout(reponse.usage),
    usage: reponse.usage,
  };
}

/* ------------------------------------------- les sept prochains jours */

/* L'adaptation à jours glissants : le matin dit ce que le corps autorise, la
   semaine jusqu'ici dit ce qui a été fait, sauté ou déplacé, et le coach
   replanifie les sept jours qui viennent — pas la semaine du calendrier, les
   sept jours à partir d'aujourd'hui. Chaque ligne est une action que le
   moteur sait appliquer (une part de la quantité, un autre jour) ou une
   décision notée (garder, sauter) ; jamais une allure ou des minutes que le
   modèle aurait posées lui-même. */

const JourGlissant = z.object({
  date: z.string().describe('Le jour, en ISO AAAA-MM-JJ — un des sept jours annoncés.'),
  session_id: z
    .number()
    .nullable()
    .describe("L'id de la séance prévue ce jour-là, pris dans la liste fournie. null pour un jour sans séance."),
  action: z
    .enum(['garder', 'reduire', 'allonger', 'deplacer', 'sauter', 'repos'])
    .describe(
      "Ce que devient la séance : garder telle quelle ; réduire ou allonger sa quantité ; la déplacer à un autre des sept jours ; la sauter ; « repos » pour un jour sans séance.",
    ),
  part: z
    .number()
    .nullable()
    .describe('Pour réduire ou allonger seulement : la quantité en fraction du prévu, entre 0,5 et 1,25. null sinon.'),
  vers_date: z
    .string()
    .nullable()
    .describe('Pour déplacer seulement : le jour où la séance atterrit, un des sept jours, en ISO. null sinon.'),
  titre: z.string().describe('La séance en deux ou trois mots, telle que la liste la nomme.'),
  format: z
    .string()
    .describe(
      "Ce qu'on fait : le format tel qu'il t'est donné (« 2 × 3 min », « Z2 montagne », « 10 × 100 m ») avec les allures fournies. Tu n'en calcules aucune.",
    ),
  note: z
    .string()
    .describe(
      'Le mot du coach pour ce jour, court : « GO », « plan normal », « déplacée au jeudi », « compensation », « à valider samedi », « sautée ».',
    ),
});

const Glissant = z.object({
  signal: z.object({
    titre: z.string().describe('Le signal du matin en trois mots : « Très bon signal », « Signal moyen », « Corps fatigué ».'),
    lignes: z
      .array(z.string())
      .describe('Deux ou trois lignes qui citent les chiffres fournis — HRV contre sa base, FC de repos contre sa base, le score sur dix. Aucun autre chiffre.'),
    verdict: z
      .enum(['journee_dure_ok', 'qualite_ok', 'facile', 'repos'])
      .describe("Ce que ce matin autorise aujourd'hui : une journée dure, une séance de qualité, du facile seulement, du repos."),
  }),
  implication: z
    .string()
    .describe('Ce que ça implique pour les sept jours, en une ou deux phrases : ce qui part tel quel, ce qui bouge, et pourquoi.'),
  jours: z
    .array(JourGlissant)
    .describe(
      "Une ligne par séance prévue sur les sept prochains jours, dans l'ordre des dates, en commençant par aujourd'hui ; un jour sans séance a une ligne « repos ». Les sept jours y sont, sans exception.",
    ),
  decision: z
    .object({
      quand: z.string().describe('Quand on tranche : « samedi 22 h ».'),
      regle: z.string().describe('La règle, en une phrase, avec les seuils fournis : « si la HRV du samedi tient au-dessus de sa base, la sortie longue part ; sinon 75 min facile ».'),
    })
    .nullable()
    .describe("Si une séance clé dépend d'une condition à vérifier plus tard. null sinon."),
  observations: z.array(Observation).describe('Un bloc « bon », un bloc « attention ». Au plus deux.'),
  strava_lu: z.array(z.string()).describe("Ce que tu es allé chercher dans Strava. Vide si tu n'y es pas allé."),
});

const DOCTRINE_GLISSANTE = `${DOCTRINE}
- Compenser, c'est allonger une sortie longue ou déplacer une séance dans les sept
  jours — jamais ajouter une séance. La charge des sept jours ne dépasse pas ce que
  le plan prévoyait pour eux.
- Le signal du matin décide de la journée : un corps fatigué ne fait pas de qualité,
  quelle que soit la case du plan. Un très bon signal n'ajoute rien : il autorise.
- Une séance clé qui dépend de la forme d'un jour à venir se tranche ce jour-là :
  tu donnes la règle et le moment, tu ne devines pas.`;

const ETAT_EN_CLAIR = {
  fait: 'FAITE', partiel: 'FAITE AUTREMENT', manque: 'MANQUÉE', aujourdhui: 'AUJOURD’HUI', prevu: 'à venir', repos: 'repos',
};

function contexteGlissant({ athlete, aujourdhui, jour, semaine, bloc, matin, passees, prochains, regles }) {
  const lignes = [
    `Athlète : ${athlete.nom}. Référence 10 km actuelle ${athlete.ref_actuelle} → cible ${athlete.ref_cible}.`,
    `Aujourd'hui : ${jour} ${aujourdhui} · semaine ${semaine} · bloc ${bloc}.`,
    '',
    'Le signal du matin, déjà calculé — cite-le tel quel :',
  ];
  const m = matin?.mesure;
  if (!m || (m.fc_repos == null && m.hrv_ms == null)) {
    lignes.push("  Pas de mesure ce matin : tu le dis, et tu replanifies sur la semaine seule.");
  } else {
    if (m.date !== aujourdhui) lignes.push(`  (dernière mesure : ${m.date}, pas ce matin)`);
    if (m.fc_repos != null) {
      const b = matin.base?.fc_repos;
      lignes.push(`  FC de repos ${m.fc_repos} bpm${b != null ? ` (base ${b}, ${m.fc_repos - b >= 0 ? '+' : ''}${m.fc_repos - b})` : ''}`);
    }
    if (m.hrv_ms != null) {
      const b = matin.base?.hrv_ms;
      const pct = b ? Math.round(((m.hrv_ms - b) / b) * 100) : null;
      lignes.push(`  HRV ${m.hrv_ms} ms${b ? ` (base ${b}, ${pct >= 0 ? '+' : ''}${pct} %)` : ''}`);
    }
    if (matin.forme) {
      lignes.push(`  Score de forme ${matin.forme.score}/10 — ${matin.forme.niveau}${matin.forme.alertes?.length ? ` · alertes : ${matin.forme.alertes.join(', ')}` : ''}`);
    } else {
      lignes.push('  Pas de score : rien à quoi comparer la mesure.');
    }
  }

  lignes.push('', 'La semaine jusqu’ici, séance par séance :');
  if (!passees?.length) lignes.push('  (la semaine commence aujourd’hui)');
  for (const s of passees ?? []) {
    const etat = ETAT_EN_CLAIR[s.statut] ?? s.statut;
    const strava = s.activite
      ? ` (Strava : ${s.activite.duree_min} min${s.activite.allure_moy ? ` · ${s.activite.allure_moy}` : ''}${s.activite.sport && s.activite.sport !== 'run' ? ` · ${s.activite.sport}` : ''})`
      : '';
    const rpe = s.rpe ? ` · RPE ressenti ${s.rpe}` : '';
    const bloque = s.limites?.length
      ? ` · a bloqué : ${s.limites.map((l) => LIMITE_EN_CLAIR[l] ?? l).join(', ')}`
      : '';
    const pourquoi = s.raisons?.length
      ? ` · pas faite parce que : ${s.raisons.map((r) => RAISON_EN_CLAIR[r] ?? r).join(', ')}`
      : '';
    lignes.push(`  ${s.id}  ${s.jour} ${s.date} · ${s.titre} · ${s.type} · prévu ${s.duree_min} min${s.natation_m ? ` · ${s.natation_m} m` : ''} · ${etat}${strava}${rpe}${bloque}${pourquoi}`);
  }

  lignes.push('', 'Les sept prochains jours, tels que le plan les prévoit. Une ligne ne peut nommer qu’un de ces id :');
  for (const s of prochains ?? []) {
    lignes.push(`  ${s.id}  ${s.jour} ${s.date} · ${s.titre} · ${s.discipline} · ${s.type} · ${s.duree_min} min${s.natation_m ? ` · ${s.natation_m} m` : ''} · RPE cible ${s.rpe_cible}${s.allures ? ` · ${s.allures}` : ''}`);
  }
  const avecSeance = new Set((prochains ?? []).map((s) => s.date));
  const sans = [];
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(`${aujourdhui}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    if (!avecSeance.has(iso)) sans.push(iso);
  }
  if (sans.length) lignes.push(`  Jours sans séance : ${sans.join(', ')}.`);

  if (regles?.length) {
    lignes.push('', 'Les règles d’ajustement du plan, telles qu’elles sont écrites :');
    for (const r of regles) lignes.push(`  ${r}`);
  }
  return lignes.join('\n');
}

export async function planifierGlissant(corps) {
  const { client, MODELE } = await coachClient();
  const langue = corps.langue === 'pl' ? 'pl' : 'fr';

  const { reponse, strava } = await avecRepli(
    client,
    {
      model: MODELE,
      max_tokens: 12000,
      system: `${systeme(langue, corps.coach)}\n\n${DOCTRINE_GLISSANTE}`,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high', format: zodOutputFormat(Glissant) },
      messages: [
        {
          role: 'user',
          content: `${contexteGlissant(corps)}

Replanifie les sept prochains jours à partir de ce matin. Si tu as accès à Strava,
regarde ce que l'athlète a réellement fait cette semaine et les précédentes.

Donne : le signal du matin (un titre, deux ou trois lignes avec les chiffres fournis,
ce qu'il autorise aujourd'hui) ; l'implication pour les sept jours ; puis, jour par
jour à partir d'aujourd'hui, une ligne par séance prévue — garder, réduire ou allonger
(une fraction), déplacer (vers un des sept jours), sauter — avec le format tel qu'il
t'est donné et ton mot pour ce jour ; enfin, si une séance clé dépend d'une condition
à vérifier plus tard, la décision : quand, et la règle.`,
        },
      ],
    },
    corps.jeton_strava,
  );

  if (!reponse.parsed_output) throw new Error("La replanification n'a pas pu être structurée.");
  return {
    ...reponse.parsed_output,
    strava,
    modele: MODELE,
    cout_eur: cout(reponse.usage),
    usage: reponse.usage,
  };
}
