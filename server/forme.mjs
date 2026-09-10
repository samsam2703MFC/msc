/* Les courbes de forme : la base endurance et la récupération.

   Deux lectures que la jauge de forme ne donnait pas, parce qu'elle ne
   regarde qu'un matin : ce que l'entraînement a construit sur des semaines,
   et ce que la HRV dit jour après jour contre sa ligne de base.

   La base endurance est la charge de Foster (durée × RPE, la seule unité
   que le classeur connaisse) lissée par une moyenne mobile exponentielle :

       base(j)    = base(j−1)    + (charge(j) − base(j−1))    / τ_base
       fatigue(j) = fatigue(j−1) + (charge(j) − fatigue(j−1)) / τ_fatigue

   avec τ_base = 42 jours et τ_fatigue = 7 par défaut — Banister, dans la
   forme que tout le monde lit depuis vingt ans. Un jour sans activité
   compte zéro, et fait descendre les deux. Les deux constantes se règlent
   (msc_param, groupe « forme »).

   La récupération est la HRV du matin contre la moyenne des trente jours
   qui précèdent la mesure, celle-ci exclue — la même ligne de base que la
   jauge — et le point sous le seuil de chute est marqué comme tel.

   Tout est calculé, rien n'est stocké : la même fonction sert l'instantané
   de l'athlète et la vue coach du back office. */

/** La charge de chaque jour, à partir des activités : le RPE ressenti du
    journal ce jour-là, sinon le RPE cible de la séance appariée, sinon 5. */
export function chargeParJour({ activites, journal, sessions = [] }) {
  const rpeDuJour = new Map();
  for (const j of journal) if (j.rpe_ressenti) rpeDuJour.set(j.date, j.rpe_ressenti);
  const rpeCible = new Map(sessions.map((s) => [s.id, s.rpe_cible]));
  const parJour = new Map();
  for (const a of activites) {
    const rpe = rpeDuJour.get(a.date) || (a.session_id != null && rpeCible.get(a.session_id)) || 5;
    parJour.set(a.date, (parJour.get(a.date) ?? 0) + a.duree_min * rpe);
  }
  return parJour;
}

function iso(d) {
  return d.toISOString().slice(0, 10);
}

function plusJours(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

/**
 * Les deux courbes.
 *
 * `aujourdhui` borne la fenêtre ; une activité datée après (un jeu de démo
 * dans le futur) la repousse jusqu'à elle, pour que la courbe montre ce qu'il
 * y a plutôt que rien.
 */
export function courbesDeForme(
  { activites, journal, mesures, sessions = [] },
  { tauBase = 42, tauFatigue = 7, jours = 84, hrvBaseJours = 30, hrvChute = 0.1, aujourdhui = iso(new Date()) } = {},
) {
  const parJour = chargeParJour({ activites, journal, sessions });
  const dates = [...parJour.keys()].sort();

  /* La charge, lissée depuis la première activité — pas depuis le bord de la
     fenêtre, sinon la courbe démarre de zéro sous les yeux de l'athlète. */
  const charge = [];
  if (dates.length > 0) {
    const fin = dates[dates.length - 1] > aujourdhui ? dates[dates.length - 1] : aujourdhui;
    const debutFenetre = plusJours(fin, -(jours - 1));
    let base = 0;
    let fatigue = 0;
    for (let d = dates[0]; d <= fin; d = plusJours(d, 1)) {
      const c = parJour.get(d) ?? 0;
      base += (c - base) / tauBase;
      fatigue += (c - fatigue) / tauFatigue;
      if (d >= debutFenetre) {
        charge.push({ date: d, charge: c, base: Math.round(base), fatigue: Math.round(fatigue) });
      }
    }
  }

  /* La HRV : chaque matin mesuré, contre la moyenne des trente jours d'avant. */
  const avecHrv = mesures
    .filter((m) => m.hrv_ms != null && m.etat !== 'rejete' && m.etat !== 'propose')
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const hrv = [];
  if (avecHrv.length > 0) {
    const derniere = avecHrv[avecHrv.length - 1].date;
    const fin = derniere > aujourdhui ? derniere : aujourdhui;
    const debutFenetre = plusJours(fin, -(jours / 2 - 1));
    for (let i = 0; i < avecHrv.length; i += 1) {
      const m = avecHrv[i];
      if (m.date < debutFenetre) continue;
      const depuis = plusJours(m.date, -hrvBaseJours);
      const avant = avecHrv.slice(0, i).filter((x) => x.date >= depuis);
      const ligne = avant.length
        ? Math.round(avant.reduce((t, x) => t + Number(x.hrv_ms), 0) / avant.length)
        : null;
      hrv.push({
        date: m.date,
        hrv: Number(m.hrv_ms),
        base: ligne,
        sous: ligne != null && Number(m.hrv_ms) <= ligne * (1 - hrvChute),
      });
    }
  }

  return { charge, hrv, tau: { base: tauBase, fatigue: tauFatigue, hrv_base: hrvBaseJours } };
}
