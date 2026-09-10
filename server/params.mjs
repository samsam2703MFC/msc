/* Les paramètres de l'application, en base : msc_param.

   Jusqu'ici ils étaient éparpillés — des constantes dans le moteur, des seuils
   dans la forme, des clés dans des variables d'environnement. Une table les
   réunit, avec pour chacun un libellé, une aide et un défaut, et le back office
   les règle sans redéployer.

   Trois sources, dans cet ordre : la valeur en base si elle est renseignée,
   sinon la variable d'environnement quand le paramètre en a une, sinon le
   défaut du catalogue. La base gagne sur l'environnement, exprès : ce que le
   back office montre est ce qui s'applique — un .env qui l'emporterait en
   silence ferait mentir l'écran.

   Un secret (clé Anthropic, secret Strava) n'est jamais en clair en base : il
   est scellé avec MSC_SECRET_KEY, comme les jetons Strava, et le back office
   n'en relit que la fin. */

import { bd, desceller, ligne, lignes, sceller, scellementPret } from './bd.mjs';

export class ParamError extends Error {
  constructor(message, statut = 400) {
    super(message);
    this.statut = statut;
  }
}

/* Le catalogue. `env` : la variable d'environnement qui sert de repli. Un
   paramètre absent d'ici n'existe pas — la table ne reçoit pas de clé libre. */
export const CATALOGUE = [
  /* le moteur — lus aussi par le navigateur, via l'instantané */
  { cle: 'moteur.derive_s', groupe: 'moteur', type: 'nombre', defaut: 5, unite: 's/km', ordre: 10,
    libelle: { fr: 'Dérive tolérée entre le premier et le dernier bloc', pl: 'Tolerowany spadek między pierwszym a ostatnim blokiem' },
    aide: { fr: 'Au-delà, la dérive de la séance passe en « attention ».', pl: 'Powyżej tej wartości spadek tempa trafia do „uwaga”.' } },
  { cle: 'moteur.ecart_allure_s', groupe: 'moteur', type: 'nombre', defaut: 10, unite: 's/km', ordre: 20,
    libelle: { fr: 'Écart toléré entre l’allure réalisée et la cible', pl: 'Tolerowana różnica między tempem a celem' },
    aide: { fr: 'Trop vite ou trop lent de plus que ça, et le coach le relève.', pl: 'Szybciej lub wolniej o więcej — trener to wytknie.' } },
  { cle: 'moteur.surcharge', groupe: 'moteur', type: 'nombre', defaut: 1.15, unite: '×', ordre: 30,
    libelle: { fr: 'Surcharge tolérée sur la charge prévue', pl: 'Tolerowane przeciążenie względem planu' },
    aide: { fr: '1,15 : une charge réalisée au-delà de 115 % du prévu passe en « attention ».', pl: '1,15: obciążenie powyżej 115 % planu trafia do „uwaga”.' } },

  /* la forme */
  { cle: 'forme.fc_repos_delta', groupe: 'forme', type: 'nombre', defaut: 3, unite: 'bpm', ordre: 10,
    libelle: { fr: 'FC de repos : hausse qui déclenche l’alerte', pl: 'Tętno spoczynkowe: wzrost wywołujący alert' },
    aide: { fr: 'Par rapport à la ligne de base de l’athlète — « stress sympathique ».', pl: 'Względem linii bazowej zawodnika — „stres współczulny”.' } },
  { cle: 'forme.hrv_chute_pct', groupe: 'forme', type: 'nombre', defaut: 10, unite: '%', ordre: 20,
    libelle: { fr: 'HRV : chute qui déclenche l’alerte', pl: 'HRV: spadek wywołujący alert' },
    aide: { fr: 'Par rapport à la moyenne glissante de 30 jours — « fatigue accumulée ».', pl: 'Względem średniej kroczącej z 30 dni — „skumulowane zmęczenie”.' } },

  /* le coach */
  { cle: 'coach.modele', groupe: 'coach', type: 'texte', defaut: 'claude-opus-5', ordre: 10,
    libelle: { fr: 'Modèle du coach', pl: 'Model trenera' },
    aide: { fr: 'Le modèle Claude qui lit les séances, répond et recalcule.', pl: 'Model Claude, który czyta treningi, odpowiada i przelicza.' } },
  { cle: 'anthropic.cle', groupe: 'coach', type: 'secret', defaut: null, env: 'ANTHROPIC_API_KEY', ordre: 20,
    libelle: { fr: 'Clé API Anthropic', pl: 'Klucz API Anthropic' },
    aide: { fr: 'Scellée en base. Sans elle, les routes du coach répondent 401.', pl: 'Zapieczętowany w bazie. Bez niego trasy trenera odpowiadają 401.' } },

  /* Strava */
  { cle: 'strava.client_id', groupe: 'strava', type: 'texte', defaut: null, env: 'STRAVA_CLIENT_ID', ordre: 10,
    libelle: { fr: 'Strava · Client ID', pl: 'Strava · Client ID' },
    aide: { fr: 'L’application créée sur strava.com/settings/api.', pl: 'Aplikacja utworzona na strava.com/settings/api.' } },
  { cle: 'strava.client_secret', groupe: 'strava', type: 'secret', defaut: null, env: 'STRAVA_CLIENT_SECRET', ordre: 20,
    libelle: { fr: 'Strava · Client Secret', pl: 'Strava · Client Secret' },
    aide: { fr: 'Scellé en base.', pl: 'Zapieczętowany w bazie.' } },
  { cle: 'strava.verify_token', groupe: 'strava', type: 'secret', defaut: null, env: 'STRAVA_VERIFY_TOKEN', ordre: 30,
    libelle: { fr: 'Strava · jeton de vérification du webhook', pl: 'Strava · token weryfikacji webhooka' },
    aide: { fr: 'Le mot que Strava renvoie pour valider le callback.', pl: 'Słowo, które Strava odsyła, by potwierdzić callback.' } },

  /* les niveaux — le classement façon shōnen : cinq axes notés sur 100, et
     les paliers de transformation sur la moyenne. Ce qui vaut 100 sur chaque
     axe se règle ici ; le niveau de combat, c'est la moyenne × 100. */
  { cle: 'niveau.endurance_h', groupe: 'niveau', type: 'nombre', defaut: 12, unite: 'h/sem', ordre: 10,
    libelle: { fr: 'Endurance : heures par semaine qui valent 100', pl: 'Wytrzymałość: godziny tygodniowo za 100' },
    aide: { fr: 'Toutes disciplines, moyenne des 8 dernières semaines.', pl: 'Wszystkie dyscypliny, średnia z 8 ostatnich tygodni.' } },
  { cle: 'niveau.velo_h', groupe: 'niveau', type: 'nombre', defaut: 6, unite: 'h/sem', ordre: 20,
    libelle: { fr: 'Vélo : heures par semaine qui valent 100', pl: 'Rower: godziny tygodniowo za 100' }, aide: null },
  { cle: 'niveau.natation_km', groupe: 'niveau', type: 'nombre', defaut: 8, unite: 'km/sem', ordre: 30,
    libelle: { fr: 'Natation : kilomètres par semaine qui valent 100', pl: 'Pływanie: kilometry tygodniowo za 100' }, aide: null },
  { cle: 'niveau.cap_lent_s', groupe: 'niveau', type: 'nombre', defaut: 360, unite: 's/km', ordre: 40,
    libelle: { fr: 'CAP : allure 10 km qui vaut 0', pl: 'Bieg: tempo 10 km za 0' },
    aide: { fr: '360 s/km = 6:00/km, un 10 km en 60 min. Lue sur la référence actuelle de l’athlète.', pl: '360 s/km = 6:00/km, 10 km w 60 min. Z aktualnej referencji zawodnika.' } },
  { cle: 'niveau.cap_rapide_s', groupe: 'niveau', type: 'nombre', defaut: 180, unite: 's/km', ordre: 50,
    libelle: { fr: 'CAP : allure 10 km qui vaut 100', pl: 'Bieg: tempo 10 km za 100' },
    aide: { fr: '180 s/km = 3:00/km, un 10 km en 30 min.', pl: '180 s/km = 3:00/km, 10 km w 30 min.' } },
  { cle: 'niveau.vitesse_lent_s', groupe: 'niveau', type: 'nombre', defaut: 300, unite: 's/km', ordre: 60,
    libelle: { fr: 'Vitesse : allure de bloc qui vaut 0', pl: 'Szybkość: tempo bloku za 0' },
    aide: { fr: 'Le bloc de travail le plus rapide mesuré sur 90 jours ; sans mesure, la zone VMA de la référence.', pl: 'Najszybszy zmierzony blok z 90 dni; bez pomiaru — strefa VO2max z referencji.' } },
  { cle: 'niveau.vitesse_rapide_s', groupe: 'niveau', type: 'nombre', defaut: 165, unite: 's/km', ordre: 70,
    libelle: { fr: 'Vitesse : allure de bloc qui vaut 100', pl: 'Szybkość: tempo bloku za 100' }, aide: null },
  { cle: 'niveau.palier_2', groupe: 'niveau', type: 'nombre', defaut: 20, unite: '/100', ordre: 80,
    libelle: { fr: 'Palier 2 — Guerrier', pl: 'Próg 2 — Wojownik' }, aide: { fr: 'La moyenne des cinq axes à partir de laquelle l’avatar se transforme.', pl: 'Średnia pięciu osi, od której awatar się przemienia.' } },
  { cle: 'niveau.palier_3', groupe: 'niveau', type: 'nombre', defaut: 40, unite: '/100', ordre: 90,
    libelle: { fr: 'Palier 3 — Super Guerrier', pl: 'Próg 3 — Super Wojownik' }, aide: null },
  { cle: 'niveau.palier_4', groupe: 'niveau', type: 'nombre', defaut: 60, unite: '/100', ordre: 100,
    libelle: { fr: 'Palier 4 — Super Guerrier 2', pl: 'Próg 4 — Super Wojownik 2' }, aide: null },
  { cle: 'niveau.palier_5', groupe: 'niveau', type: 'nombre', defaut: 80, unite: '/100', ordre: 110,
    libelle: { fr: 'Palier 5 — Super Guerrier 3', pl: 'Próg 5 — Super Wojownik 3' }, aide: null },
  { cle: 'niveau.palier_6', groupe: 'niveau', type: 'nombre', defaut: 95, unite: '/100', ordre: 120,
    libelle: { fr: 'Palier 6 — Ultra', pl: 'Próg 6 — Ultra' }, aide: null },

  /* la sécurité */
  { cle: 'securite.mdp_min', groupe: 'securite', type: 'nombre', defaut: 12, unite: 'caractères', ordre: 10, env: 'MSC_MDP_MIN',
    libelle: { fr: 'Longueur minimale d’un mot de passe', pl: 'Minimalna długość hasła' },
    aide: { fr: 'Appliquée quand un compte reçoit un mot de passe (npm run compte).', pl: 'Stosowana, gdy konto dostaje hasło (npm run compte).' } },
];

const PAR_CLE = new Map(CATALOGUE.map((p) => [p.cle, p]));
const TYPES = new Set(['nombre', 'texte', 'booleen', 'secret']);

function definition(cle) {
  const def = PAR_CLE.get(cle);
  if (!def) throw new ParamError(`paramètre inconnu : ${cle}`, 404);
  return def;
}

/** Un texte brut (base ou environnement) dans le type du paramètre. */
function typer(def, brut) {
  if (brut == null || brut === '') return null;
  switch (def.type) {
    case 'nombre': {
      const n = Number(String(brut).replace(',', '.'));
      return Number.isFinite(n) ? n : null;
    }
    case 'booleen':
      return /^(1|true|oui|yes|tak)$/i.test(String(brut).trim());
    default:
      return String(brut);
  }
}

/* ---------------------------------------------------------------- lecture */

/* Quinze secondes de cache : une analyse lit cinq paramètres, pas cinq
   requêtes. L'écriture l'invalide, donc le back office se voit tout de suite. */
const cache = { a: 0, valeurs: null, illisibles: null };
let manqueSignale = false;

async function charger() {
  if (cache.valeurs && Date.now() - cache.a < 15_000) return cache.valeurs;
  const valeurs = new Map();
  const illisibles = new Set();
  try {
    for (const l of await lignes('SELECT cle, type, valeur, scelle FROM msc_param')) {
      const def = PAR_CLE.get(l.cle);
      if (!def) continue;
      if (def.type === 'secret') {
        /* Un secret scellé qui ne se relit pas n'est pas absent : il est là, et
           personne ne peut l'ouvrir — MSC_SECRET_KEY a changé depuis qu'il a
           été rangé, ou elle manque. Le faire passer pour absent envoie
           l'utilisateur vérifier un écran qui lui dira « renseigné »… ou
           « absent », selon l'endroit. On le garde à part, et on le dit une
           fois dans le journal. */
        if (!l.scelle) continue;
        if (!scellementPret()) {
          illisibles.add(l.cle);
          if (!cache.illisibles?.has(l.cle)) console.warn(`[params] ${l.cle} : scellé, mais MSC_SECRET_KEY manque — illisible`);
          continue;
        }
        try {
          valeurs.set(l.cle, desceller(l.scelle));
        } catch {
          illisibles.add(l.cle);
          if (!cache.illisibles?.has(l.cle)) {
            console.warn(`[params] ${l.cle} : scellé avec une autre MSC_SECRET_KEY — illisible, à ressaisir dans Réglages`);
          }
        }
      } else {
        valeurs.set(l.cle, typer(def, l.valeur));
      }
    }
    manqueSignale = false;
  } catch (e) {
    /* Avant db:migrate, la table n'existe pas : l'environnement et les défauts
       suffisent, et on le dit une fois plutôt qu'à chaque appel. */
    if (!manqueSignale) {
      manqueSignale = true;
      console.warn('[params] msc_param illisible, environnement et défauts seuls :', e?.message ?? e);
    }
  }
  cache.valeurs = valeurs;
  cache.illisibles = illisibles;
  cache.a = Date.now();
  return valeurs;
}

export function invalider() {
  cache.a = 0;
  cache.valeurs = null;
}

/** L'état d'un paramètre, pour /api/sante et les messages d'erreur : s'il
    s'applique, d'où il vient, et — pour un secret — s'il est là sans pouvoir
    être relu. */
export async function etatDe(cle) {
  const def = definition(cle);
  const enBase = (await charger()).get(cle);
  const source = enBase != null && enBase !== ''
    ? 'base'
    : def.env && process.env[def.env] ? 'env' : null;
  return { renseigne: source !== null, source, illisible: Boolean(cache.illisibles?.has(cle)) };
}

/** Remplit le cache au démarrage, pour que `paramSync` ait quelque chose. */
export async function precharger() {
  await charger();
}

/** La même lecture, sans attendre : ce que le cache a — au pire quinze
    secondes de retard, et un rafraîchissement lancé en arrière-plan. Pour
    les endroits synchrones (la configuration Strava) où une promesse ne
    passe pas. */
export function paramSync(cle) {
  const def = definition(cle);
  if (!cache.valeurs || Date.now() - cache.a >= 15_000) void charger().catch(() => {});
  const v = cache.valeurs?.get(cle);
  if (v != null && v !== '') return v;
  if (def.env && process.env[def.env]) return typer(def, process.env[def.env]);
  return def.defaut ?? null;
}

/** La clé Anthropic qui s'applique, ou undefined : le SDK cherche alors
    ANTHROPIC_API_KEY lui-même. */
export async function cleAnthropic() {
  return (await param('anthropic.cle')) ?? undefined;
}

/** La valeur qui s'applique : base, sinon environnement, sinon défaut. */
export async function param(cle) {
  const def = definition(cle);
  const v = (await charger()).get(cle);
  if (v != null && v !== '') return v;
  if (def.env && process.env[def.env]) return typer(def, process.env[def.env]);
  return def.defaut ?? null;
}

/** D'où vient la valeur qui s'applique — ce que le back office affiche. */
async function sourceDe(def, enBase) {
  if (enBase != null && enBase !== '') return 'base';
  if (def.env && process.env[def.env]) return 'env';
  return 'defaut';
}

/** Tout le catalogue avec ce qui s'applique, pour le back office. Un secret
    ne sort jamais : seulement s'il est renseigné, et ses quatre derniers
    caractères pour reconnaître lequel. */
export async function tous() {
  const enBase = await charger();
  const sortie = [];
  for (const def of CATALOGUE) {
    const base = enBase.get(def.cle);
    const source = await sourceDe(def, base);
    const effective = base != null && base !== ''
      ? base
      : def.env && process.env[def.env] ? typer(def, process.env[def.env]) : def.defaut ?? null;
    const commun = {
      cle: def.cle, groupe: def.groupe, type: def.type, unite: def.unite ?? null, ordre: def.ordre ?? 0,
      libelle: def.libelle, aide: def.aide ?? null, defaut: def.defaut ?? null, env: def.env ?? null, source,
    };
    if (def.type === 'secret') {
      const s = effective ? String(effective) : '';
      sortie.push({
        ...commun, valeur: null, renseigne: s.length > 0, apercu: s ? `…${s.slice(-4)}` : null,
        illisible: Boolean(cache.illisibles?.has(def.cle)),
      });
    } else {
      sortie.push({ ...commun, valeur: effective, renseigne: effective != null });
    }
  }
  return sortie;
}

/** Les paramètres que le navigateur peut lire — jamais un secret. */
export async function publics() {
  const sortie = [];
  for (const def of CATALOGUE) {
    if (def.type === 'secret') continue;
    sortie.push({ cle: def.cle, valeur: await param(def.cle) });
  }
  return sortie;
}

/* --------------------------------------------------------------- écriture */

/** Écrit une valeur ; `null` ou vide efface (retour à l'environnement ou au
    défaut). Un secret est scellé — sans MSC_SECRET_KEY, refusé plutôt que
    rangé en clair. */
export async function ecrire(cle, valeur) {
  const def = definition(cle);
  if (!TYPES.has(def.type)) throw new ParamError(`type inconnu : ${def.type}`, 500);
  const vide = valeur == null || String(valeur).trim() === '';

  let texte = null;
  let scelle = null;
  if (!vide) {
    if (def.type === 'secret') {
      if (!scellementPret()) throw new ParamError('MSC_SECRET_KEY absente : impossible de sceller un secret.', 503);
      scelle = sceller(String(valeur).trim());
    } else if (def.type === 'nombre') {
      const n = typer(def, valeur);
      if (n == null) throw new ParamError(`« ${valeur} » n'est pas un nombre.`);
      texte = String(n);
    } else if (def.type === 'booleen') {
      texte = typer(def, valeur) ? '1' : '0';
    } else {
      texte = String(valeur).trim().slice(0, 500);
    }
  }

  const q = bd();
  const [r] = await q.execute('UPDATE msc_param SET valeur = ?, scelle = ? WHERE cle = ?', [texte, scelle, cle]);
  if (r.affectedRows === 0) {
    /* La ligne du catalogue manque (base d'avant ce paramètre) : on la pose. */
    await q.execute(
      `INSERT INTO msc_param (cle, groupe, type, valeur, scelle, defaut, unite, ordre, libelle_fr, libelle_pl, aide_fr, aide_pl)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [cle, def.groupe, def.type, texte, scelle, def.defaut == null ? null : String(def.defaut), def.unite ?? null,
       def.ordre ?? 0, def.libelle.fr, def.libelle.pl, def.aide?.fr ?? null, def.aide?.pl ?? null],
    );
  }
  invalider();
  return (await tous()).find((p) => p.cle === cle);
}

/** Existe pour les scripts qui n'ont pas de serveur : la même lecture, une fois. */
export async function existe() {
  return Boolean(await ligne("SELECT 1 AS un FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'msc_param'"));
}
