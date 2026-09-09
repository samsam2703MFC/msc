/* La photo : la recevoir, la ranger, la faire lire.

   L'athlète photographie sa balance ou l'écran de sa montre ; Claude en tire le
   poids et la FC de repos. Trois faits distincts, trois tables — le fichier
   reçu, ce qu'un modèle a cru y lire, et la mesure qui fait foi — et ce fichier
   suit ce découpage.

   La règle qui gouverne tout le reste : **ce qu'un modèle lit ne devient pas le
   poids de l'athlète sans qu'il l'ait vu.** Une extraction crée une mesure dans
   l'état « propose » ; elle ne compte qu'une fois confirmée. Une balance floue,
   un reflet, une virgule prise pour un point : ça arrive, et une donnée
   d'entraînement fausse entrée en silence est pire qu'une donnée absente. */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { bd, empreinte, ligne, transaction } from './bd.mjs';
import { cleAnthropic } from './params.mjs';

const MODEL = 'claude-opus-5';

/* Les quatre formats que l'API accepte. Un iPhone envoie du HEIC s'il n'est pas
   converti — le navigateur le fait presque toujours à l'envoi, et quand il ne
   le fait pas, mieux vaut le dire que d'envoyer un fichier illisible. */
const TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const OCTETS_MAX = 12 * 1024 * 1024;

export class PhotoError extends Error {
  constructor(message, code = 400) {
    super(message);
    this.code = code;
  }
}

export function racinePhotos() {
  return resolve(process.env.MSC_PHOTOS_DIR ?? './var/photos');
}

/* ------------------------------------------------------------ la lecture */

const Lecture = z.object({
  poids_kg: z
    .number()
    .nullable()
    .describe('Le poids en kilogrammes, tel qu’il est affiché. null si tu ne le vois pas.'),
  fc_repos: z
    .number()
    .int()
    .nullable()
    .describe('La fréquence cardiaque de repos en battements par minute. null si tu ne la vois pas.'),
  confiance: z
    .enum(['haute', 'moyenne', 'basse'])
    .describe(
      'haute : les chiffres sont nets et sans ambiguïté. moyenne : lisibles mais un chiffre pourrait se discuter. basse : tu devines plus que tu ne lis.',
    ),
  lu: z
    .string()
    .describe('Ce que tu vois écrit, mot pour mot, avec l’unité — « 74,5 kg », « 46 bpm ».'),
});

const SYSTEME = `Tu lis une photo d'un écran de balance ou de montre, et tu en tires
deux nombres : un poids et une fréquence cardiaque de repos.

Règles :
- Tu ne rends que ce que tu VOIS. Si un chiffre est illisible, coupé, ou si tu
  hésites entre deux lectures, tu mets null et tu baisses la confiance. Tu ne
  complètes jamais par ce qui serait plausible.
- Une balance affiche souvent le poids avec une virgule décimale : 74,5 et non
  745. Une montre affiche la FC de repos en bpm, souvent à côté d'un cœur.
- Un écran peut afficher d'autres nombres — masse grasse, IMC, pas, calories.
  Ce ne sont ni le poids ni la FC de repos : tu les ignores.
- « lu » recopie ce qui est écrit, pas ce que tu en conclus.`;

/* Les tarifs publiés d'Opus 5, convertis à taux fixe. Une estimation pour tenir
   l'athlète informé de ce qu'il dépense, pas une facture. */
const USD_PAR_MTOK = { entree: 5, sortie: 25 };
const EUR_PAR_USD = 0.92;

function cout(usage) {
  if (!usage) return 0;
  const entree = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
  const usd = (entree * USD_PAR_MTOK.entree + (usage.output_tokens ?? 0) * USD_PAR_MTOK.sortie) / 1e6;
  return Math.round(usd * EUR_PAR_USD * 10_000) / 10_000;
}

/** Ce que Claude lit sur l'image. Jamais appelé sans que la photo soit rangée :
    on veut pouvoir revenir sur une extraction ratée et regarder l'original. */
export async function lire(octets, mime) {
  const client = new Anthropic({ apiKey: await cleAnthropic() });
  const reponse = await client.messages.parse({
    model: MODEL,
    max_tokens: 2000,
    system: SYSTEME,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'low', format: zodOutputFormat(Lecture) },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mime, data: octets.toString('base64') } },
          { type: 'text', text: 'Lis le poids et la fréquence cardiaque de repos sur cet écran.' },
        ],
      },
    ],
  });
  if (!reponse.parsed_output) throw new PhotoError("La lecture n'a pas pu être structurée.", 502);
  return { ...reponse.parsed_output, modele: MODEL, cout_eur: cout(reponse.usage) };
}

/* ------------------------------------------------------------ la réception */

/**
 * Range une photo et en propose une mesure.
 *
 * La photo est rangée d'abord, la lecture ensuite : si le modèle échoue ou si
 * la clé manque, l'image est quand même là et l'athlète peut saisir les
 * chiffres à la main. L'inverse perdrait la photo à chaque incident.
 */
export async function recevoir(athleteId, { octets, mime, date }) {
  if (!TYPES[mime]) {
    throw new PhotoError(
      `Format non accepté (${mime || 'inconnu'}). JPEG, PNG, WebP ou GIF. ` +
        'Un iPhone envoie parfois du HEIC : partage la photo plutôt que de la joindre telle quelle.',
    );
  }
  if (!octets?.length) throw new PhotoError('Photo vide.');
  if (octets.length > OCTETS_MAX) {
    throw new PhotoError(`Photo trop lourde (${Math.round(octets.length / 1e6)} Mo, maximum 12).`);
  }

  const sha = empreinte(octets);
  const nom = sha.toString('hex');
  /* Deux niveaux de sous-dossiers : quelques milliers de photos dans un seul
     répertoire, et le moindre `ls` devient une punition. */
  const chemin = join(nom.slice(0, 2), nom.slice(2, 4), nom + TYPES[mime]);
  const absolu = join(racinePhotos(), chemin);
  await mkdir(dirname(absolu), { recursive: true });
  await writeFile(absolu, octets);

  /* La même photo envoyée deux fois est la même ligne — l'unicité est sur
     (athlete_id, sha256), et deux athlètes peuvent envoyer la même image. */
  const deja = await ligne(
    'SELECT id FROM msc_photo WHERE athlete_id = :a AND sha256 = :s',
    { a: athleteId, s: sha },
  );
  let photoId = deja?.id;
  if (!photoId) {
    const [r] = await bd().execute(
      'INSERT INTO msc_photo (athlete_id, chemin, mime, octets, sha256) VALUES (?, ?, ?, ?, ?)',
      [athleteId, chemin, mime, octets.length, sha],
    );
    photoId = r.insertId;
  }

  let lecture = null;
  let echec = null;
  let echecPourLAthlete = null;
  try {
    lecture = await lire(octets, mime);
  } catch (e) {
    /* Une extraction ratée est enregistrée, pas effacée : savoir sur quoi le
       modèle se trompe vaut la ligne qu'elle coûte. Le message brut reste en
       base et dans les logs ; ce qui remonte au navigateur est une phrase, pas
       le détail d'une pile d'appels ou d'une configuration serveur. */
    echec = String(e?.message ?? e).slice(0, 190);
    console.error('[photo] lecture', e);
    echecPourLAthlete = /resolve authentication method|api[_ -]?key|401/i.test(echec)
      ? "La lecture automatique n'est pas configurée sur le serveur."
      : "Claude n'a pas pu lire cette photo.";
  }

  const [ex] = await bd().execute(
    `INSERT INTO msc_extraction (photo_id, modele, poids_kg, fc_repos, confiance, lu, cout_eur, echec)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [photoId, lecture?.modele ?? MODEL, lecture?.poids_kg ?? null, lecture?.fc_repos ?? null,
     lecture?.confiance ?? null, lecture?.lu ?? null, lecture?.cout_eur ?? 0, echec],
  );

  const jour = date ?? new Date().toISOString().slice(0, 10);
  await bd().execute(
    `INSERT INTO msc_mesure (athlete_id, date, poids_kg, fc_repos, source, etat, photo_id, extraction_id)
     VALUES (?, ?, ?, ?, 'photo', 'propose', ?, ?)
     ON DUPLICATE KEY UPDATE poids_kg = VALUES(poids_kg), fc_repos = VALUES(fc_repos),
       source = 'photo', etat = 'propose', photo_id = VALUES(photo_id),
       extraction_id = VALUES(extraction_id), confirme_le = NULL`,
    [athleteId, jour, lecture?.poids_kg ?? null, lecture?.fc_repos ?? null, photoId, ex.insertId],
  );

  return {
    photo_id: photoId,
    date: jour,
    poids_kg: lecture?.poids_kg ?? null,
    fc_repos: lecture?.fc_repos ?? null,
    confiance: lecture?.confiance ?? null,
    lu: lecture?.lu ?? null,
    cout_eur: lecture?.cout_eur ?? 0,
    echec: echecPourLAthlete,
  };
}

/** Les mesures en attente de confirmation. */
export async function enAttente(athleteId) {
  const { lignes } = await import('./bd.mjs');
  return lignes(
    `SELECT m.date, m.poids_kg, m.fc_repos, m.photo_id,
            e.confiance, e.lu, e.echec
     FROM msc_mesure m LEFT JOIN msc_extraction e ON e.id = m.extraction_id
     WHERE m.athlete_id = :a AND m.etat = 'propose' ORDER BY m.date DESC`,
    { a: athleteId },
  );
}

/**
 * Confirmer une mesure, corrigée ou non.
 *
 * Les valeurs viennent du client, pas de l'extraction : l'athlète a pu corriger
 * ce que le modèle a lu, et c'est sa correction qui fait foi. La source passe à
 * « saisie » quand il a changé quelque chose, pour qu'on puisse plus tard
 * mesurer ce que le modèle se fait corriger.
 */
export async function confirmer(athleteId, { date, poids_kg, fc_repos, rejeter }) {
  return transaction(async (cnx) => {
    const [[mesure]] = await cnx.execute(
      'SELECT poids_kg, fc_repos, source FROM msc_mesure WHERE athlete_id = ? AND date = ?',
      [athleteId, date],
    );
    if (!mesure) throw new PhotoError('Aucune mesure proposée ce jour-là.', 404);

    if (rejeter) {
      await cnx.execute(
        "UPDATE msc_mesure SET etat = 'rejete' WHERE athlete_id = ? AND date = ?",
        [athleteId, date],
      );
      return { date, etat: 'rejete' };
    }

    const corrige =
      Number(mesure.poids_kg) !== Number(poids_kg ?? mesure.poids_kg) ||
      Number(mesure.fc_repos) !== Number(fc_repos ?? mesure.fc_repos);

    await cnx.execute(
      `UPDATE msc_mesure SET poids_kg = ?, fc_repos = ?, etat = 'confirme',
         source = ?, confirme_le = NOW(3)
       WHERE athlete_id = ? AND date = ?`,
      [poids_kg ?? mesure.poids_kg, fc_repos ?? mesure.fc_repos,
       corrige ? 'saisie' : mesure.source, athleteId, date],
    );
    return { date, etat: 'confirme', corrige };
  });
}

/** Le chemin d'une photo, si elle appartient bien à cet athlète. */
export async function chemin(athleteId, photoId) {
  const p = await ligne(
    'SELECT chemin, mime FROM msc_photo WHERE id = :i AND athlete_id = :a',
    { i: Number(photoId), a: athleteId },
  );
  if (!p) throw new PhotoError('Photo inconnue.', 404);
  return { absolu: join(racinePhotos(), p.chemin), mime: p.mime };
}
