/* Asks Claude for the training methodology the generator should apply.

   Two calls, on purpose:
     1. research   web search on, no output format — Claude actually goes and
                   reads current endurance-training guidance for this athlete's
                   shape of problem, and cites what it used.
     2. synthèse   output format on, no web search — the brief is turned into
                   the strict object the generator consumes.

   What Claude does NOT do here is set a pace, a volume or a date. Those come
   from the engine and the generator, which are deterministic and checkable.
   Claude is given the computed zones and writes the prescriptions against them. */

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

const MODEL = 'claude-opus-5';

const Seance = z.object({
  type: z.string().describe("Le code de type de séance : ef, recup, seuil, allure10, vma, longue, montagne, force, compromis, nage, velo, test, repos, course"),
  titre: z.string().describe('Titre court de la séance, en français, sans allure chiffrée'),
  structure: z.string().describe(
    "Le déroulé prescrit, en une ou deux phrases. Référence les zones par leur nom (EF, Seuil, Allure 10 km…), jamais par une allure chiffrée — l'application calcule les allures.",
  ),
  pourquoi: z.string().describe('Ce que la séance achète, en une phrase'),
  science: z.array(z.string()).describe('Une ou deux lignes de ce que dit la littérature'),
});

const Bloc = z.object({
  code: z.string(),
  intention: z.string().describe("Le nom de la phase, en français, court"),
  focus: z.string().describe('Ce que le bloc travaille en priorité, une phrase'),
});

const Source = z.object({
  titre: z.string(),
  url: z.string(),
});

const Methode = z.object({
  principes: z.array(z.string()).describe(
    'Les principes méthodologiques retenus pour ce plan, 3 à 6 lignes, en français',
  ),
  blocs: z.array(Bloc),
  seances: z.array(Seance).describe('Une entrée par type de séance présent dans le plan'),
  sources: z.array(Source).describe('Les sources effectivement consultées'),
  reserves: z.array(z.string()).describe(
    "Ce qui, dans ce plan, est discutable ou risqué compte tenu du profil. Vide si rien.",
  ),
});

const SYSTEM = `Tu es un entraîneur d'endurance. Tu prépares la méthodologie d'un plan
qui sera instancié par un moteur déterministe.

Règles absolues :
- Tu ne donnes JAMAIS d'allure chiffrée, de durée en minutes, ni de date. Le moteur
  les calcule à partir des références de l'athlète et les impose. Tu décris les
  séances par leurs zones (EF, Récup, Seuil, Allure 10 km, VMA…) et leur structure.
- Tu t'appuies sur la littérature d'entraînement réelle, pas sur des impressions.
- Tu écris en français, en phrases courtes et concrètes. Pas d'emphase creuse.
- Si le plan te paraît risqué pour ce profil, tu le dis dans « reserves ».`;

function brief(athlete, objectifs, contraintes, blocs) {
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
  return `Athlète : ${athlete.nom}.
Référence 10 km actuelle : ${fmt(athlete.ref_actuelle_s * 10)} (${fmt(athlete.ref_actuelle_s)}/km).
Cible : ${fmt(athlete.ref_cible_s * 10)} (${fmt(athlete.ref_cible_s)}/km).
Début : ${athlete.debut}.

Objectifs :
${objectifs.map((o) => `- ${o.nom}, ${o.date}, ${o.distance_km} km, cible ${fmt(o.cible_s)}${o.principal ? ' (OBJECTIF PRINCIPAL)' : ''}`).join('\n')}

Contraintes :
- Plancher de ${contraintes.plancher_heures} h par semaine, ${contraintes.plancher_km_sortie} km minimum par sortie.
- ${contraintes.reamorcage_semaines} semaines de réamorçage avant la première séance de qualité.
- Disciplines disponibles : course${contraintes.natation ? ', natation' : ''}${contraintes.velo ? ', vélo' : ''}${contraintes.salle ? ', salle (Hyrox)' : ''}.
${contraintes.montagne_toutes_les ? `- Une sortie montagne toutes les ${contraintes.montagne_toutes_les} semaines.` : ''}

Blocs déjà calculés par le moteur (tu ne les changes pas, tu les nommes et les expliques) :
${blocs.map((b) => `- ${b.code} : semaines ${b.de} à ${b.a}, référence 10 km ${fmt((athlete.ref_actuelle_s - (athlete.ref_actuelle_s - athlete.ref_cible_s) * b.part) * 10)}`).join('\n')}`;
}

export async function construireMethode({ athlete, objectifs, contraintes, blocs }) {
  const client = new Anthropic();
  const contexte = brief(athlete, objectifs, contraintes, blocs);

  /* 1 — la recherche. Claude va lire ce qui se fait, et cite ce qu'il a lu. */
  const recherche = await client.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    system: SYSTEM,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high' },
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 8 }],
    messages: [
      {
        role: 'user',
        content: `${contexte}

Cherche l'état de l'art sur la planification d'entraînement en endurance pour ce
profil précis : périodisation, distribution d'intensité, progression de charge,
transfert force → course, et le cas particulier d'une reprise après une longue
coupure. Puis propose la méthodologie du plan : les principes retenus, le rôle de
chaque bloc, et le contenu de chaque type de séance.

Cite ce que tu as effectivement consulté.`,
      },
    ],
  }).finalMessage();

  const texte = recherche.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');

  /* 2 — la mise en forme. Pas de recherche ici, juste la structure. */
  const structure = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    messages: [
      { role: 'user', content: contexte },
      {
        role: 'assistant',
        content: [{ type: 'text', text: texte }],
      },
      {
        role: 'user',
        content:
          'Mets cette méthodologie sous la forme demandée. Une entrée « seances » par type présent dans le plan : ef, recup, seuil, allure10, vma, longue, montagne, force, compromis, nage, velo, repos, course.',
      },
    ],
    output_config: { format: zodOutputFormat(Methode) },
  });

  if (!structure.parsed_output) {
    throw new Error("La méthodologie n'a pas pu être structurée.");
  }

  return {
    ...structure.parsed_output,
    usage: {
      recherche: recherche.usage,
      structure: structure.usage,
    },
  };
}
