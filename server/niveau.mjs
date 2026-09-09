/* Le classement façon shōnen : cinq axes notés sur 100 — endurance, vitesse,
   vélo, course à pied, natation — leur moyenne, et les paliers de
   transformation qui vont avec. Un niveau de combat, la moyenne × 100 : on
   sait tous à partir de combien on s'inquiète.

   Tout se lit dans ce que la base a déjà : les activités des huit dernières
   semaines pour les volumes, les blocs de travail mesurés pour la vitesse, la
   référence 10 km pour la course. Ce qui vaut 100 sur chaque axe et où
   tombent les paliers se règle dans le back office (msc_param, groupe
   « niveau ») — le classement n'a pas d'avis, il compte.

   C'est un classement de club : tout le monde y est, avec son nom et ses
   scores, et rien d'autre. */

import { lignes } from './bd.mjs';
import { param } from './params.mjs';

export const AXES = ['endurance', 'vitesse', 'velo', 'cap', 'natation'];

export const PALIERS = [
  { n: 1, nom: { fr: 'Terrien', pl: 'Ziemianin' } },
  { n: 2, nom: { fr: 'Guerrier', pl: 'Wojownik' } },
  { n: 3, nom: { fr: 'Super Guerrier', pl: 'Super Wojownik' } },
  { n: 4, nom: { fr: 'Super Guerrier 2', pl: 'Super Wojownik 2' } },
  { n: 5, nom: { fr: 'Super Guerrier 3', pl: 'Super Wojownik 3' } },
  { n: 6, nom: { fr: 'Ultra', pl: 'Ultra' } },
];

const SEMAINES = 8;
const JOURS_VITESSE = 90;

const borne = (x) => Math.max(0, Math.min(100, Math.round(x)));
/* Un score linéaire entre ce qui vaut 0 et ce qui vaut 100. */
const lineaire = (v, zero, cent) => (cent === zero ? 0 : borne(((v - zero) / (cent - zero)) * 100));

/* Les réglages du groupe « niveau », lus une fois par classement. */
async function reglages() {
  const n = async (cle) => Number(await param(cle));
  const r = {
    endurance_h: await n('niveau.endurance_h'),
    velo_h: await n('niveau.velo_h'),
    natation_km: await n('niveau.natation_km'),
    cap_lent_s: await n('niveau.cap_lent_s'),
    cap_rapide_s: await n('niveau.cap_rapide_s'),
    vitesse_lent_s: await n('niveau.vitesse_lent_s'),
    vitesse_rapide_s: await n('niveau.vitesse_rapide_s'),
    seuils: {},
  };
  for (const p of [2, 3, 4, 5, 6]) r.seuils[p] = await n(`niveau.palier_${p}`);
  return r;
}

function palierDe(total, seuils) {
  let palier = 1;
  for (const p of [2, 3, 4, 5, 6]) if (total >= seuils[p]) palier = p;
  return PALIERS.find((x) => x.n === palier);
}

/**
 * Le classement complet, du plus fort au moins fort. Une seule passe sur la
 * base, quelle que soit la taille du club.
 */
export async function classement() {
  const R = await reglages();
  const [athletes, volumes, vitesses] = await Promise.all([
    lignes('SELECT id, nom, prenom, surnom, ref_actuelle_s FROM msc_athlete ORDER BY nom'),
    lignes(
      `SELECT athlete_id, sport, SUM(duree_min) AS minutes, SUM(COALESCE(distance_m, 0)) AS metres
       FROM msc_activity
       WHERE date > DATE_SUB(CURDATE(), INTERVAL :j DAY) AND date <= CURDATE()
       GROUP BY athlete_id, sport`,
      { j: SEMAINES * 7 },
    ),
    lignes(
      `SELECT a.athlete_id, MIN(b.allure_s_km) AS allure
       FROM msc_activity_bloc b JOIN msc_activity a ON a.id = b.activity_id
       WHERE a.date > DATE_SUB(CURDATE(), INTERVAL :j DAY) AND a.date <= CURDATE()
       GROUP BY a.athlete_id`,
      { j: JOURS_VITESSE },
    ),
  ]);

  const parAthlete = new Map();
  for (const v of volumes) {
    if (!parAthlete.has(v.athlete_id)) parAthlete.set(v.athlete_id, {});
    parAthlete.get(v.athlete_id)[v.sport] = { minutes: Number(v.minutes), metres: Number(v.metres) };
  }
  const vitesseDe = new Map(vitesses.map((v) => [v.athlete_id, Number(v.allure)]));

  const lignesClassement = athletes.map((a) => {
    const v = parAthlete.get(a.id) ?? {};
    const minutesTous = Object.values(v).reduce((t, x) => t + x.minutes, 0);
    const heuresSemaine = minutesTous / 60 / SEMAINES;
    const veloHeuresSemaine = (v.bike?.minutes ?? 0) / 60 / SEMAINES;
    const nageKmSemaine = (v.swim?.metres ?? 0) / 1000 / SEMAINES;
    /* Sans bloc mesuré, la zone VMA de la référence : ce que le plan lui
       demande, à défaut de ce qu'il a montré. */
    const allureVitesse = vitesseDe.get(a.id) ?? a.ref_actuelle_s - 10;

    const scores = {
      endurance: lineaire(heuresSemaine, 0, R.endurance_h),
      vitesse: lineaire(allureVitesse, R.vitesse_lent_s, R.vitesse_rapide_s),
      velo: lineaire(veloHeuresSemaine, 0, R.velo_h),
      cap: lineaire(a.ref_actuelle_s, R.cap_lent_s, R.cap_rapide_s),
      natation: lineaire(nageKmSemaine, 0, R.natation_km),
    };
    const total = borne(AXES.reduce((t, k) => t + scores[k], 0) / AXES.length);
    const palier = palierDe(total, R.seuils);
    return {
      id: a.id, nom: a.nom, prenom: a.prenom ?? null, surnom: a.surnom ?? null,
      scores, total, puissance: total * 100, palier,
      /* les chiffres bruts, pour que l'écran puisse dire d'où vient le score */
      brut: {
        heures_semaine: Math.round(heuresSemaine * 10) / 10,
        velo_h_semaine: Math.round(veloHeuresSemaine * 10) / 10,
        nage_km_semaine: Math.round(nageKmSemaine * 10) / 10,
        ref_10k_s: a.ref_actuelle_s,
        vitesse_s: allureVitesse,
        vitesse_mesuree: vitesseDe.has(a.id),
      },
    };
  });

  lignesClassement.sort((x, y) => y.total - x.total || x.nom.localeCompare(y.nom));
  lignesClassement.forEach((l, i) => { l.rang = i + 1; });
  return { athletes: lignesClassement, paliers: PALIERS.map((p) => ({ ...p, seuil: p.n === 1 ? 0 : R.seuils[p.n] })) };
}

/** Le palier d'un athlète — ce que l'en-tête montre. */
export async function palierDeAthlete(athleteId) {
  const { athletes } = await classement();
  return athletes.find((a) => a.id === athleteId)?.palier?.n ?? 1;
}
