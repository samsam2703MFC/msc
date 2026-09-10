/* Les dépôts : ce que la base rend, dans les formes que l'application déclare.

   Un seul point d'entrée en lecture, `instantane(athleteId)`, qui rend toute la
   base d'un athlète en une fois. C'est délibéré. L'application tient déjà ses
   tables en mémoire et ses écrans les lisent de façon synchrone (`db.select`,
   `db.one`) ; un instantané les remplit sans qu'un seul écran change, et c'est
   aussi exactement ce qu'un cache hors-ligne veut stocker. Une API par table
   obligerait chaque écran à devenir asynchrone pour aucun gain : le plan fait
   243 séances, pas 243 000.

   Deux principes tenus ici comme dans le schéma.

   Aucun nombre calculable n'est renvoyé calculé par le serveur si le moteur
   sait le faire — les allures restent au navigateur, avec le plan. Une
   adaptation est donc rendue en zone et en part, pas en « 44 min · 6:20/km » :
   c'est ce qui fait qu'écrire une nouvelle référence 10 km fait glisser les
   propositions du coach comme elle fait glisser le reste.

   Et les écritures passent toutes par `mutation()`, qui dédoublonne sur
   l'identifiant que le client génère avant d'envoyer. Sans ça, une file
   d'attente hors-ligne qui rejoue après une coupure enregistre deux fois le
   même RPE. */

import { lignes, ligne, transaction } from './bd.mjs';
import { chargeParJour, courbesDeForme } from './forme.mjs';
import { palierDeAthlete } from './niveau.mjs';
import { param, publics as paramsPublics } from './params.mjs';

/**
 * Un refus que l'athlète doit lire.
 *
 * Le serveur masque le détail de ce qui casse — un message d'erreur peut porter
 * une requête — et ne rend que la forme. Une proposition déjà appliquée sur la
 * séance, un plan sans séance : ce ne sont pas des pannes, ce sont des réponses,
 * et elles sont écrites pour être lues.
 */
export class DepotError extends Error {
  constructor(message, code = 400) {
    super(message);
    this.code = code;
  }
}

const L = (r, prefixe) => ({ fr: r[`${prefixe}_fr`], pl: r[`${prefixe}_pl`] });
const Lnul = (r, prefixe) =>
  r[`${prefixe}_fr`] === null && r[`${prefixe}_pl`] === null ? undefined : L(r, prefixe);

const nombre = (v) => (v === null || v === undefined ? undefined : Number(v));
const json = (v) => (v === null || v === undefined ? undefined : typeof v === 'string' ? JSON.parse(v) : v);

/* ============================================================ la lecture */

async function vocabulaire() {
  const [types, science, zones, statuts, rpe, excuses, regles, metriques, sources, ui] =
    await Promise.all([
      lignes('SELECT * FROM msc_type ORDER BY ordre'),
      lignes('SELECT * FROM msc_type_science ORDER BY type_code, langue, ordre'),
      lignes('SELECT * FROM msc_zone ORDER BY ordre'),
      lignes('SELECT * FROM msc_statut'),
      lignes('SELECT * FROM msc_rpe ORDER BY de'),
      lignes('SELECT * FROM msc_excuse ORDER BY ordre'),
      lignes('SELECT * FROM msc_regle ORDER BY ordre'),
      lignes('SELECT * FROM msc_metric ORDER BY ordre'),
      lignes('SELECT * FROM msc_source'),
      lignes('SELECT * FROM msc_ui'),
    ]);

  const sci = new Map();
  for (const s of science) {
    const cle = s.type_code;
    if (!sci.has(cle)) sci.set(cle, { fr: [], pl: [] });
    sci.get(cle)[s.langue].push(s.texte);
  }

  return {
    msc_type: types.map((t) => ({
      code: t.code, icon: t.icon, color: t.couleur,
      label: L(t, 'label'), gain: L(t, 'gain'), why: L(t, 'why'),
      sci: sci.get(t.code) ?? { fr: [], pl: [] },
    })),
    msc_zone: zones.map((z) => ({
      code: z.code, ecart_s: z.ecart_s, icon: z.icon,
      label: L(z, 'label'), usage: L(z, 'usage'),
    })),
    msc_statut: statuts.map((s) => ({ code: s.code, icon: s.icon, couleur: s.couleur })),
    msc_rpe: rpe.map((r) => ({ de: r.de, a: r.a, label: L(r, 'label'), quoi: L(r, 'quoi') })),
    msc_excuse: excuses.map((e) => ({
      code: e.code, icon: e.icon, type: e.type_code, session_id: e.session_exemple,
      label: L(e, 'label'), reponse: L(e, 'reponse'), remplacement: L(e, 'remplacement'),
    })),
    msc_regle: regles.map((r) => ({
      code: r.code, signal: r.signal_code, op: r.operateur, seuil: Number(r.seuil),
      jours: nombre(r.jours), gravite: r.gravite, effet: json(r.effet),
      si: L(r, 'si'), alors: L(r, 'alors'), pourquoi: L(r, 'pourquoi'),
    })),
    /* `valeur` et `serie` ne sont pas en base : ils se calculent. Ils sont
       remplis plus bas, à partir des activités et des mesures, et restent
       absents quand il n'y a pas encore de quoi les calculer. */
    msc_metric: metriques.map((m) => ({
      code: m.code, icon: m.icon, couleur: m.couleur, seuil: nombre(m.seuil),
      nom: L(m, 'nom'), formule: L(m, 'formule'),
    })),
    msc_source: sources.map((s) => ({
      code: s.code, etat: 'off', canal: s.canal,
      titre_absent: L(s, 'titre_absent'), sous_absent: L(s, 'sous_absent'),
      titre_off: L(s, 'titre_off'), sous_off: L(s, 'sous_off'),
      titre_liaison: L(s, 'titre_liaison'), sous_liaison: L(s, 'sous_liaison'),
      titre_on: L(s, 'titre_on'), sous_on: L(s, 'sous_on'),
      sous_synchro: L(s, 'sous_synchro'), jamais: L(s, 'jamais'),
      webhook_on: L(s, 'webhook_on'), webhook_off: L(s, 'webhook_off'),
      orphelines: L(s, 'orphelines'), delier: L(s, 'delier'),
    })),
    msc_ui: Object.fromEntries(ui.map((u) => [u.langue, json(u.chaines)])),
    /* Les réglages que le moteur du navigateur lit — jamais un secret. */
    msc_param: await paramsPublics(),
  };
}

export async function planActif(athleteId) {
  return ligne(
    'SELECT * FROM msc_plan WHERE athlete_id = :a AND actif = 1 ORDER BY debut DESC LIMIT 1',
    { a: athleteId },
  );
}

async function lePlan(planId) {
  const [blocs, semaines, seances, zonesDeSeance, objectifs] = await Promise.all([
    lignes('SELECT * FROM msc_bloc WHERE plan_id = :p ORDER BY semaine_de', { p: planId }),
    lignes('SELECT w.*, b.code AS bloc_code FROM msc_week w JOIN msc_bloc b ON b.id = w.bloc_id WHERE w.plan_id = :p ORDER BY w.semaine', { p: planId }),
    lignes('SELECT s.*, b.code AS bloc_code FROM msc_session s JOIN msc_bloc b ON b.id = s.bloc_id WHERE s.plan_id = :p ORDER BY s.date, s.ordre', { p: planId }),
    lignes('SELECT z.* FROM msc_session_zone z JOIN msc_session s ON s.id = z.session_id WHERE s.plan_id = :p ORDER BY z.ordre', { p: planId }),
    lignes(
      `SELECT o.*, c.date, c.nom, c.distance_km, COALESCE(o.type_course, c.type_course) AS type_course
       FROM msc_objectif o JOIN msc_competition c ON c.id = o.competition_id
       WHERE o.plan_id = :p ORDER BY c.date`, { p: planId }),
  ]);

  const parSeance = new Map();
  for (const z of zonesDeSeance) {
    if (!parSeance.has(z.session_id)) parSeance.set(z.session_id, []);
    parSeance.get(z.session_id).push(z.zone_code);
  }

  return {
    msc_bloc: blocs.map((b) => ({
      code: b.code, de: b.semaine_de, a: b.semaine_a, part: Number(b.part),
      nom: L(b, 'nom'), quoi: Lnul(b, 'focus') ?? { fr: '', pl: '' },
    })),
    msc_week: semaines.map((w) => ({
      semaine: w.semaine, phase: w.phase, bloc: w.bloc_code,
      heures: Number(w.heures), km: nombre(w.km),
      natation_m: nombre(w.natation_m), charge: nombre(w.charge),
    })),
    msc_session: seances.map((s) => ({
      id: s.id, semaine: s.semaine, phase: s.phase, bloc: s.bloc_code, date: s.date,
      jour: L(s, 'jour'), jour_long: s.jour_long, discipline: s.discipline, type: s.type_code,
      duree_min: s.duree_min, rpe_cible: s.rpe_cible, charge: s.charge,
      zones: parSeance.get(s.id) ?? [],
      titre: L(s, 'titre'), titre_court: L(s, 'titre_court'), meta: L(s, 'meta'),
      detail: L(s, 'detail'),
      /* La consigne du classeur est « EF 06:27 » : un nom de zone et l'allure
         que cette zone valait le jour de l'import. Là où la séance porte des
         zones, elle est donc redondante avec le moteur et fausse dès que le
         test de 30 minutes réécrit la référence — le serveur ne la sert pas, et
         le navigateur la recompose. Là où il n'y en a pas, elle est de la prose
         (« À l'effort, pas à l'allure ») et elle passe telle quelle. */
      consigne: (parSeance.get(s.id) ?? []).length ? undefined : Lnul(s, 'consigne'),
      but: Lnul(s, 'but'), reussite: Lnul(s, 'reussite'),
      distance_km: nombre(s.distance_km), natation_m: nombre(s.natation_m),
      adapte_par: s.adapte_par ?? undefined,
    })),
    msc_objectif: objectifs.map((o) => ({
      id: o.id, date: o.date, semaine: o.semaine, principal: Boolean(o.principal),
      distance_km: Number(o.distance_km), cible_s: o.cible_s, cible_haute_s: o.cible_haute_s,
      type_course: o.type_course ?? undefined, competition_id: o.competition_id,
      parties: Array.isArray(o.parties) ? o.parties : undefined,
      nom: { fr: o.nom, pl: o.nom }, cible: L(o, 'cible'),
      role: Lnul(o, 'role') ?? { fr: '', pl: '' },
    })),
  };
}

async function leVecu(athleteId) {
  const [activites, blocs, journal, douleurs, limites, mesures, attente] = await Promise.all([
    lignes('SELECT * FROM msc_activity WHERE athlete_id = :a ORDER BY date, id', { a: athleteId }),
    lignes(
      `SELECT b.* FROM msc_activity_bloc b JOIN msc_activity a ON a.id = b.activity_id
       WHERE a.athlete_id = :a ORDER BY b.activity_id, b.ordre`, { a: athleteId }),
    lignes('SELECT * FROM msc_journal WHERE athlete_id = :a ORDER BY date', { a: athleteId }),
    lignes(
      `SELECT d.* FROM msc_journal_douleur d JOIN msc_journal j ON j.id = d.journal_id
       WHERE j.athlete_id = :a`, { a: athleteId }),
    lignes(
      `SELECT l.* FROM msc_journal_limite l JOIN msc_journal j ON j.id = l.journal_id
       WHERE j.athlete_id = :a ORDER BY l.limite`, { a: athleteId }),
    lignes(
      "SELECT * FROM msc_mesure WHERE athlete_id = :a AND etat = 'confirme' ORDER BY date",
      { a: athleteId }),
    lignes(
      `SELECT m.date, m.poids_kg, m.fc_repos, m.photo_id, e.confiance, e.lu, e.echec
       FROM msc_mesure m LEFT JOIN msc_extraction e ON e.id = m.extraction_id
       WHERE m.athlete_id = :a AND m.etat = 'propose' ORDER BY m.date DESC`,
      { a: athleteId }),
  ]);

  const parActivite = new Map();
  for (const b of blocs) {
    if (!parActivite.has(b.activity_id)) parActivite.set(b.activity_id, []);
    parActivite.get(b.activity_id).push(b.allure_s_km);
  }
  const parJournal = new Map();
  for (const d of douleurs) {
    if (!parJournal.has(d.journal_id)) parJournal.set(d.journal_id, []);
    parJournal.get(d.journal_id).push(d.douleur);
  }
  const limitesPar = new Map();
  for (const l of limites) {
    if (!limitesPar.has(l.journal_id)) limitesPar.set(l.journal_id, []);
    limitesPar.get(l.journal_id).push(l.limite);
  }

  return {
    msc_activity: activites.map((a) => ({
      id_strava: Number(a.id_strava ?? a.id),
      session_id: a.session_id ?? undefined,
      date: a.date, sport: a.sport, duree_min: a.duree_min,
      allure_moy: a.allure_s_km ? formatAllure(a.allure_s_km) : undefined,
      fc_moy: nombre(a.fc_moy),
      splits_blocs: parActivite.get(a.id),
      statut: a.statut,
      /* Ce que l'historique apporte : de quoi compter des kilomètres. */
      nom: a.nom ?? undefined,
      distance_km: a.distance_m ? Number(a.distance_m) / 1000 : undefined,
      duree_s: a.duree_s ?? undefined,
    })),
    msc_journal: journal.map((j) => ({
      date: j.date, session_id: j.session_id ?? 0,
      rpe_ressenti: j.rpe_ressenti ?? 0,
      sommeil: Number(j.sommeil_h ?? 0),
      douleurs: parJournal.get(j.id) ?? [],
      limites: limitesPar.get(j.id) ?? [],
      note: j.note ?? undefined,
      fait: j.fait == null ? undefined : Boolean(j.fait),
    })),
    /* msc_daily n'existe plus comme table : la FC de repos vit dans les
       mesures, à côté du poids qui vient de la même photo. La forme que les
       écrans lisent, elle, ne change pas. */
    msc_daily: mesures
      .filter((m) => m.fc_repos !== null)
      .map((m) => ({ date: m.date, fc_repos: m.fc_repos })),
    msc_mesure: mesures.map((m) => ({
      date: m.date, poids_kg: nombre(m.poids_kg), fc_repos: nombre(m.fc_repos),
      hrv_ms: nombre(m.hrv_ms), source: m.source, etat: m.etat,
    })),
    /* Ce qu'un modèle a lu et que l'athlète n'a pas encore vu. Séparé des
       mesures confirmées : tant que ce n'est pas confirmé, ça ne compte dans
       aucune métrique et ça ne s'affiche que comme une question. */
    mesures_attente: attente.map((m) => ({
      date: m.date, poids_kg: nombre(m.poids_kg), fc_repos: nombre(m.fc_repos),
      photo_id: m.photo_id, confiance: m.confiance ?? undefined,
      lu: m.lu ?? undefined,
      /* Le détail de l'échec reste en base ; l'écran a seulement besoin de
         savoir qu'il y en a eu un pour proposer la saisie à la main. */
      echec: m.echec ? true : undefined,
    })),
  };
}

/** mm:ss/km — la seule mise en forme que le serveur se permet, parce que
    `msc_activity.allure_moy` est une allure mesurée, pas une allure prescrite. */
function formatAllure(secondes) {
  const s = Math.floor(secondes);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}/km`;
}

async function leCoach(athleteId, planId) {
  const [analyses, adaptations, ajustements, ecarts, chats] = await Promise.all([
    lignes('SELECT * FROM msc_analyse WHERE athlete_id = :a ORDER BY date, id', { a: athleteId }),
    lignes(
      `SELECT d.* FROM msc_adaptation d JOIN msc_analyse n ON n.id = d.analyse_id
       WHERE n.athlete_id = :a`, { a: athleteId }),
    lignes(
      `SELECT j.* FROM msc_ajustement j JOIN msc_analyse n ON n.id = j.analyse_id
       WHERE n.athlete_id = :a`, { a: athleteId }),
    planId
      ? lignes('SELECT * FROM msc_ecart WHERE plan_id = :p ORDER BY semaine', { p: planId })
      : Promise.resolve([]),
    lignes('SELECT * FROM msc_chat WHERE athlete_id = :a ORDER BY fil, ordre', { a: athleteId }),
  ]);

  const fils = {};
  for (const c of chats) {
    (fils[c.fil] ??= []).push({ role: c.role, texte: c.texte });
  }

  return {
    msc_analyse: analyses.map((a) => ({
      id: a.id, date: a.date, type: a.type,
      session_id: a.session_id ?? undefined, semaine: nombre(a.semaine),
      modele: a.modele, cout_eur: Number(a.cout_eur), ton: a.ton ?? undefined,
      verdict: L(a, 'verdict'), stats: json(a.stats), blocs: json(a.blocs),
      glissant: json(a.glissant) ?? undefined,
    })),
    /* Une zone et une part, pas des minutes et une allure : le navigateur les
       rend avec le moteur, comme il rend tout le reste. */
    msc_adaptation: adaptations.map((d) => ({
      id: d.id, analyse_id: d.analyse_id, session_id: d.session_id,
      zone: d.zone_code ?? undefined, part_duree: Number(d.part_duree),
      pourquoi: L(d, 'pourquoi'), applique: Boolean(d.applique_le),
      /* Ce que la séance était avant l'acceptation. La séance, elle, porte
         maintenant ce que la proposition en a fait : sans ce souvenir, la carte
         écrirait « 54 min → 54 min ». */
      avant: d.applique_le ? json(d.avant) : undefined,
    })),
    msc_ajustement: ajustements.map((j) => ({
      id: j.id, analyse_id: j.analyse_id,
      session_id: j.session_id ?? undefined, semaine: nombre(j.semaine),
      type: j.type_code, part: nombre(j.part), texte: Lnul(j, 'texte'),
      vers_date: j.vers_date ? String(j.vers_date).slice(0, 10) : undefined,
      applique: Boolean(j.applique_le),
      avant: j.applique_le ? json(j.avant) : undefined,
    })),
    msc_ecart: ecarts.map((e) => ({
      semaine: e.semaine, texte: L(e, 'texte'), recalcul: json(e.recalcul),
    })),
    msc_chat: fils,
  };
}

async function lesCompetitions(athleteId) {
  const rows = await lignes(
    `SELECT c.*, r.temps_s, r.classement, r.classement_categorie, r.categorie,
            r.partants, r.fc_moy AS resultat_fc, r.abandon, r.note AS resultat_note
     FROM msc_competition c LEFT JOIN msc_resultat r ON r.competition_id = c.id
     WHERE c.athlete_id = :a ORDER BY c.date`,
    { a: athleteId },
  );
  return rows.map((c) => ({
    id: c.id, date: c.date, nom: c.nom, lieu: c.lieu ?? undefined, pays: c.pays ?? undefined,
    discipline: c.discipline, type_course: c.type_course ?? undefined, distance_km: Number(c.distance_km),
    denivele_m: nombre(c.denivele_m), officielle: Boolean(c.officielle),
    note: c.note ?? undefined,
    resultat: c.temps_s === null || c.temps_s === undefined ? undefined : {
      temps_s: c.temps_s,
      /* L'allure ne se stocke pas : temps / distance, et la distance est ici. */
      allure_s_km: Math.round(c.temps_s / Number(c.distance_km)),
      classement: nombre(c.classement),
      classement_categorie: nombre(c.classement_categorie),
      categorie: c.categorie ?? undefined,
      partants: nombre(c.partants),
      fc_moy: nombre(c.resultat_fc),
      abandon: Boolean(c.abandon),
      note: c.resultat_note ?? undefined,
    },
  }));
}

/* ------------------------------------------------------- les métriques */

/* Ce que le schéma refuse de stocker, il faut bien le calculer quelque part.
   Deux des quatre métriques le sont ici, à partir de ce que la base contient
   vraiment ; les deux autres restent sans valeur tant que la donnée n'est pas
   là, plutôt que d'afficher un chiffre inventé. */
function metriques(base) {
  /* La même charge par jour que les courbes de forme : le RPE ressenti, sinon
     celui que la séance appariée visait, sinon 5. Rien après aujourd'hui. */
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const parJour = chargeParJour({
    activites: base.msc_activity.filter((a) => a.date <= aujourdhui),
    journal: base.msc_journal,
    sessions: base.msc_session,
  });

  const jours = [...parJour.keys()].sort();
  const serieCharge = jours.map((j) => parJour.get(j) ?? 0);
  const moyenne = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

  const acwr = serieCharge.length >= 28
    ? (moyenne(serieCharge.slice(-7)) * 7) / (moyenne(serieCharge.slice(-28)) * 7)
    : null;

  const fc = base.msc_daily.filter((d) => d.date <= aujourdhui).map((d) => d.fc_repos);
  const fcMoy7 = fc.length >= 3 ? moyenne(fc.slice(-7)) : null;

  return base.msc_metric.map((m) => {
    if (m.code === 'acwr' && acwr !== null) {
      return { ...m, valeur: acwr.toFixed(2).replace('.', ','), serie: serieCharge.slice(-28) };
    }
    if (m.code === 'fc_repos' && fcMoy7 !== null) {
      return { ...m, valeur: `${Math.round(fcMoy7)} bpm`, serie: fc.slice(-28) };
    }
    /* Pas assez de données. Le dire vaut mieux que le peindre. */
    return m;
  });
}

/** Toute la base d'un athlète, dans les formes que les écrans lisent déjà. */
export async function instantane(athleteId) {
  const [athlete, plan, vocab] = await Promise.all([
    ligne('SELECT * FROM msc_athlete WHERE id = :a', { a: athleteId }),
    planActif(athleteId),
    vocabulaire(),
  ]);
  if (!athlete) throw new Error(`athlète ${athleteId} inconnu`);

  const [contenu, vecu, coach, competitions] = await Promise.all([
    plan ? lePlan(plan.id) : Promise.resolve({ msc_bloc: [], msc_week: [], msc_session: [], msc_objectif: [] }),
    leVecu(athleteId),
    leCoach(athleteId, plan?.id),
    lesCompetitions(athleteId),
  ]);

  const base = {
    ...vocab, ...contenu, ...vecu, ...coach,
    msc_athlete: [{
      id: athlete.id, nom: athlete.nom,
      prenom: athlete.prenom ?? null, surnom: athlete.surnom ?? null,
      annee_naissance: athlete.annee_naissance ?? null,
      coach: athlete.coach ?? 'gentil',
      /* le palier de transformation, pour l'avatar de l'en-tête */
      niveau: await palierDeAthlete(athleteId),
      ref_actuelle_s: athlete.ref_actuelle_s, ref_cible_s: athlete.ref_cible_s,
      fc_repos: athlete.fc_repos, fc_repos_moy7: athlete.fc_repos_moy7,
      fc_moy_reference: athlete.fc_moy_reference,
      derive_reference_pct: Number(athlete.derive_reference_pct ?? 0),
      plancher_heures: Number(athlete.plancher_heures),
      plancher_km_sortie: Number(athlete.plancher_km_sortie),
      debut: athlete.debut, note: L(athlete, 'note'),
    }],
    msc_competition: competitions,
    plan: plan ? { id: plan.id, nom: plan.nom, origine: plan.origine, debut: plan.debut, fin: plan.fin } : null,
  };

  return {
    ...base,
    msc_metric: metriques(base),
    courbes: courbesDeForme(
      { activites: base.msc_activity, journal: base.msc_journal, mesures: base.msc_mesure, sessions: base.msc_session },
      await reglagesDesCourbes(),
    ),
    servi_le: new Date().toISOString(),
  };
}

/** Les constantes des courbes de forme, telles que le back office les règle. */
async function reglagesDesCourbes() {
  const n = async (cle, defaut) => Number(await param(cle)) || defaut;
  return {
    tauBase: await n('forme.base_jours', 42),
    tauFatigue: await n('forme.fatigue_jours', 7),
    jours: await n('forme.courbe_jours', 84),
    hrvBaseJours: await n('forme.hrv_base_jours', 30),
    hrvChute: (await n('forme.hrv_chute_pct', 10)) / 100,
  };
}

/* ============================================================ la vue coach */

/**
 * Un athlète en un coup d'œil, pour le back office : la phase et la semaine,
 * les allures, ce qui est fait cette semaine, la dernière mesure et ce qu'elle
 * dit de la forme, la charge derrière et devant. Tout est déduit de ce que la
 * base a déjà — rien n'est stocké pour l'afficher.
 */
export async function apercu(athletes) {
  return Promise.all(athletes.map((x) => apercuDe(x)));
}

/**
 * Le signal du matin : la dernière mesure confirmée (au plus tard aujourd'hui —
 * une mesure datée dans le futur, un seed, une saisie mal datée, ne dit rien de
 * la forme de ce matin), sa ligne de base, et ce que la jauge en lit. Sert la
 * vue coach et la replanification des sept prochains jours.
 */
export async function signalDuMatin(athleteId) {
  const [a, mesure, reglages] = await Promise.all([
    ligne('SELECT fc_repos, fc_repos_moy7 FROM msc_athlete WHERE id = :a', { a: athleteId }),
    ligne(
      `SELECT date, poids_kg, fc_repos, hrv_ms FROM msc_mesure
       WHERE athlete_id = :a AND etat = 'confirme' AND date <= CURDATE()
       ORDER BY date DESC LIMIT 1`,
      { a: athleteId },
    ),
    reglagesDesCourbes(),
  ]);
  if (!a) throw new Error(`athlète ${athleteId} inconnu`);
  /* La HRV n'a pas de ligne de base sur l'athlète comme la FC de repos : elle
     se lit sur les jours qui précèdent la dernière mesure, celle-ci exclue —
     sinon la mesure se comparerait à elle-même. */
  const hrvBase = mesure
    ? (await ligne(
        `SELECT AVG(hrv_ms) AS h FROM msc_mesure
         WHERE athlete_id = :a AND etat = 'confirme' AND hrv_ms IS NOT NULL
           AND date < :d1 AND date >= DATE_SUB(:d2, INTERVAL :n DAY)`,
        { a: athleteId, d1: mesure.date, d2: mesure.date, n: reglages.hrvBaseJours },
      ))?.h
    : null;
  const base = {
    fc_repos: a.fc_repos_moy7 ?? a.fc_repos ?? null,
    hrv_ms: hrvBase == null ? null : Math.round(Number(hrvBase)),
  };
  return {
    mesure: mesure
      ? {
          date: mesure.date,
          poids_kg: mesure.poids_kg == null ? null : Number(mesure.poids_kg),
          fc_repos: mesure.fc_repos ?? null,
          hrv_ms: mesure.hrv_ms ?? null,
        }
      : null,
    base,
    forme: forme(mesure, base, await seuilsForme()),
    reglages,
  };
}

async function apercuDe({ id, droit }) {
  const [a, plan, matin, rpe] = await Promise.all([
    ligne('SELECT * FROM msc_athlete WHERE id = :a', { a: id }),
    planActif(id),
    signalDuMatin(id),
    ligne(
      `SELECT id, rpe_ressenti, date FROM msc_journal
       WHERE athlete_id = :a AND rpe_ressenti IS NOT NULL AND date <= CURDATE()
       ORDER BY date DESC LIMIT 1`,
      { a: id },
    ),
  ]);
  if (!a) throw new Error(`athlète ${id} inconnu`);
  const { mesure, base, reglages } = matin;
  /* Ce qui a bloqué sur cette dernière séance : la ligne que le coach lit
     avant le chiffre. */
  const limitesRpe = rpe
    ? (await lignes('SELECT limite FROM msc_journal_limite WHERE journal_id = :j ORDER BY limite', { j: rpe.id }))
        .map((l) => l.limite)
    : [];



  let semaine = 1;
  let total = 0;
  let bloc = null;
  let cette = { prevues: 0, faites: 0, volume_prevu_min: 0, volume_realise_min: 0 };
  if (plan) {
    /* La semaine courante : celle de la dernière séance datée d'aujourd'hui ou
       avant — la même lecture que l'application, qui part de la date. */
    const [derniere, tot] = await Promise.all([
      ligne(
        `SELECT semaine FROM msc_session WHERE plan_id = :p AND date <= CURDATE()
         ORDER BY date DESC, ordre DESC LIMIT 1`,
        { p: plan.id },
      ),
      ligne('SELECT MAX(semaine) AS n FROM msc_session WHERE plan_id = :p', { p: plan.id }),
    ]);
    total = Number(tot?.n ?? 0);
    semaine = Math.min(Math.max(Number(derniere?.semaine ?? 1), 1), Math.max(total, 1));

    const [b, prevu, faites, bornes] = await Promise.all([
      ligne(
        `SELECT code, part, semaine_de, semaine_a, nom_fr, nom_pl FROM msc_bloc
         WHERE plan_id = :p AND :s BETWEEN semaine_de AND semaine_a`,
        { p: plan.id, s: semaine },
      ),
      ligne(
        `SELECT COUNT(*) AS n, COALESCE(SUM(duree_min), 0) AS v FROM msc_session
         WHERE plan_id = :p AND semaine = :s`,
        { p: plan.id, s: semaine },
      ),
      /* Faite : une activité appariée, ou la coche de l'athlète — la même
         règle que la semaine à l'écran. Un RPE saisi n'est pas une séance
         faite. */
      ligne(
        `SELECT COUNT(*) AS n FROM msc_session s
         WHERE s.plan_id = :p AND s.semaine = :s
           AND (EXISTS (SELECT 1 FROM msc_activity a WHERE a.session_id = s.id)
             OR EXISTS (SELECT 1 FROM msc_journal j WHERE j.session_id = s.id AND j.fait = 1))`,
        { p: plan.id, s: semaine },
      ),
      ligne(
        `SELECT MIN(date) AS d1, MAX(date) AS d2 FROM msc_session
         WHERE plan_id = :p AND semaine = :s`,
        { p: plan.id, s: semaine },
      ),
    ]);
    const realise = bornes?.d1
      ? await ligne(
          `SELECT COALESCE(SUM(duree_min), 0) AS v FROM msc_activity
           WHERE athlete_id = :a AND date BETWEEN :d1 AND :d2`,
          { a: id, d1: bornes.d1, d2: bornes.d2 },
        )
      : null;
    bloc = b
      ? { code: b.code, part: Number(b.part), de: b.semaine_de, a: b.semaine_a, nom: L(b, 'nom') }
      : null;
    cette = {
      prevues: Number(prevu?.n ?? 0),
      faites: Number(faites?.n ?? 0),
      volume_prevu_min: Number(prevu?.v ?? 0),
      volume_realise_min: Number(realise?.v ?? 0),
    };
  }

  /* La charge : celle des sept jours passés, faite ; celle des sept à venir,
     prévue. La même unité — durée × RPE cible, celle du plan — pour que les
     deux barres se comparent. */
  const [passee, aVenir] = plan
    ? await Promise.all([
        ligne(
          `SELECT COALESCE(SUM(s.charge), 0) AS c FROM msc_session s
           WHERE s.plan_id = :p
             AND s.date BETWEEN DATE_SUB(CURDATE(), INTERVAL 6 DAY) AND CURDATE()
             AND (EXISTS (SELECT 1 FROM msc_activity a WHERE a.session_id = s.id)
               OR EXISTS (SELECT 1 FROM msc_journal j WHERE j.session_id = s.id AND j.fait = 1))`,
          { p: plan.id },
        ),
        ligne(
          `SELECT COALESCE(SUM(charge), 0) AS c FROM msc_session
           WHERE plan_id = :p
             AND date BETWEEN DATE_ADD(CURDATE(), INTERVAL 1 DAY) AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)`,
          { p: plan.id },
        ),
      ])
    : [null, null];

  return {
    id,
    droit,
    nom: a.nom,
    prenom: a.prenom ?? null,
    surnom: a.surnom ?? null,
    annee_naissance: a.annee_naissance ?? null,
    ref_actuelle_s: a.ref_actuelle_s,
    ref_cible_s: a.ref_cible_s,
    plan: plan ? { nom: plan.nom, debut: plan.debut, fin: plan.fin } : null,
    semaine,
    total,
    bloc,
    cette_semaine: cette,
    coach: a.coach ?? 'gentil',
    niveau: await palierDeAthlete(id),
    dernier_rpe: rpe ? { valeur: rpe.rpe_ressenti, date: rpe.date, limites: limitesRpe } : null,
    mesure,
    base,
    forme: matin.forme,
    charge: { passee_7j: Number(passee?.c ?? 0), a_venir_7j: Number(aVenir?.c ?? 0) },
    /* Les deux courbes, pour la carte du back office — lues de la même
       façon que pour l'athlète lui-même. */
    courbes: courbesDeForme(await vecuPourLesCourbes(id, plan?.id), reglages),
  };
}

/** Ce que les courbes lisent, sans passer par tout l'instantané. */
async function vecuPourLesCourbes(athleteId, planId) {
  const [activites, journal, mesures, sessions] = await Promise.all([
    lignes('SELECT date, session_id, duree_min FROM msc_activity WHERE athlete_id = :a', { a: athleteId }),
    lignes('SELECT date, rpe_ressenti FROM msc_journal WHERE athlete_id = :a', { a: athleteId }),
    lignes("SELECT date, hrv_ms, etat FROM msc_mesure WHERE athlete_id = :a AND etat = 'confirme'", { a: athleteId }),
    planId ? lignes('SELECT id, rpe_cible FROM msc_session WHERE plan_id = :p', { p: planId }) : Promise.resolve([]),
  ]);
  return { activites, journal, mesures, sessions };
}

/**
 * Ce que le coach sait des autres athlètes du compte, en quelques lignes de
 * prompt : leur forme, leur charge, où ils en sont — de quoi répondre à
 * « et Léa, elle en est où ? ». Rien d'autre : pas leur journal, pas leurs
 * notes. Vide quand le compte ne voit qu'un athlète, ou passe par la porte
 * de service.
 */
export async function formeDesAutres(identite, athleteId) {
  const autres = (identite?.visibles ?? []).filter((a) => a.id !== athleteId);
  if (autres.length === 0) return '';
  const lignesTexte = ['Les autres athlètes que ce compte suit — tu peux répondre sur leur forme, avec ces chiffres et pas d’autres :'];
  for (const a of await apercu(autres)) {
    const nom = [a.prenom, a.nom].filter(Boolean).join(' ') + (a.surnom ? ` (« ${a.surnom} »)` : '');
    const morceaux = [];
    if (a.forme) morceaux.push(`forme ${a.forme.score}/10 (${a.forme.niveau}${a.forme.alertes.length ? ` — ${a.forme.alertes.join(', ')}` : ''})`);
    else morceaux.push('forme non lisible (pas de mesure du matin à comparer)');
    if (a.mesure?.fc_repos != null) morceaux.push(`FC de repos ${a.mesure.fc_repos}${a.base.fc_repos != null ? ` (base ${a.base.fc_repos})` : ''}`);
    if (a.mesure?.hrv_ms != null) morceaux.push(`HRV ${a.mesure.hrv_ms} ms${a.base.hrv_ms != null ? ` (base ${a.base.hrv_ms})` : ''}`);
    morceaux.push(`charge 7 j passés ${a.charge.passee_7j} / 7 j à venir ${a.charge.a_venir_7j}`);
    if (a.plan) morceaux.push(`semaine ${a.semaine}/${a.total}${a.bloc ? `, bloc ${a.bloc.code} (${a.bloc.nom.fr})` : ''}, ${a.cette_semaine.faites}/${a.cette_semaine.prevues} séances faites`);
    else morceaux.push('sans plan actif');
    if (a.dernier_rpe) {
      morceaux.push(`dernier RPE ${a.dernier_rpe.valeur} le ${a.dernier_rpe.date}${a.dernier_rpe.limites?.length ? `, ce qui a bloqué : ${a.dernier_rpe.limites.join(', ')}` : ''}`);
    }
    lignesTexte.push(`  - ${nom} : ${morceaux.join(' · ')}`);
  }
  return lignesTexte.join('\n');
}

/* La forme, d'après la FC de repos et la HRV du matin, relatives à la ligne de
   base de l'athlète — pas des seuils absolus : un cœur à 41 et un cœur à 55
   n'ont pas le même « +3 ». Score sur dix, quatre niveaux, et les deux alertes
   du protocole : FC de repos à +3 (stress sympathique), HRV en chute de 10 %
   (fatigue accumulée). Sans mesure, pas de score — plutôt rien qu'un chiffre
   inventé. */
/* Les deux seuils du protocole, réglables dans le back office (msc_param). */
async function seuilsForme() {
  return {
    fc: Number(await param('forme.fc_repos_delta')) || 3,
    hrv: (Number(await param('forme.hrv_chute_pct')) || 10) / 100,
  };
}

function forme(mesure, base, seuils = { fc: 3, hrv: 0.1 }) {
  if (!mesure) return null;
  const fc = mesure.fc_repos ?? null;
  const hrv = mesure.hrv_ms ?? null;
  if (fc == null && hrv == null) return null;
  let score = 10;
  let compare = 0;
  const alertes = [];
  if (fc != null && base.fc_repos != null) {
    compare += 1;
    const d = fc - base.fc_repos;
    if (d >= 5) score -= 6;
    else if (d >= 3) score -= 3;
    else if (d >= 1) score -= 1;
    if (d >= seuils.fc) alertes.push('fc_repos_haute');
  }
  if (hrv != null && base.hrv_ms) {
    compare += 1;
    const p = (hrv - base.hrv_ms) / base.hrv_ms;
    if (p <= -0.2) score -= 6;
    else if (p <= -0.08) score -= 3;
    else if (p < 0.08) score -= 1;
    if (p <= -seuils.hrv) alertes.push('hrv_chute');
  }
  /* Une mesure sans rien à quoi la comparer ne dit pas « en forme » : elle ne
     dit rien. Un 10 par défaut serait un mensonge rassurant. */
  if (compare === 0) return null;
  score = Math.max(0, Math.min(10, score));
  const niveau = score >= 8 ? 'excellent' : score >= 6 ? 'bon' : score >= 4 ? 'attention' : 'fatigue';
  return { score, niveau, alertes };
}

/* ============================================================ l'écriture */

/**
 * Une écriture, une seule fois.
 *
 * Le client génère un identifiant avant d'envoyer ; si le serveur l'a déjà vu,
 * il rend la réponse d'alors sans rien réécrire. C'est ce qui rend une file
 * d'attente hors-ligne sûre : elle peut rejouer, le double n'arrive pas.
 */
export async function mutation(athleteId, id, operation, travail) {
  if (!id) return (await transaction(travail)) ?? {};

  /* La réservation de l'identifiant est la PREMIÈRE écriture de la transaction,
     pas une lecture qui la précède.
     
     Un « SELECT puis INSERT » laisse deux requêtes concurrentes franchir le
     SELECT toutes les deux, faire le travail deux fois, et la seconde échouer
     sur la clé primaire — ce que cette table existe précisément pour empêcher.
     Ici, la seconde bloque sur le verrou de ligne jusqu'au commit de la
     première, puis échoue en doublon et lit la réponse qui vient d'être
     écrite. Une file d'attente hors-ligne qui rejoue deux fois en parallèle —
     l'événement « online » et une relance manuelle, par exemple — n'enregistre
     donc rien deux fois. */
  try {
    return await transaction(async (cnx) => {
      await cnx.execute(
        'INSERT INTO msc_mutation (id, athlete_id, operation) VALUES (?, ?, ?)',
        [id, athleteId, operation],
      );
      const reponse = (await travail(cnx)) ?? {};
      await cnx.execute('UPDATE msc_mutation SET reponse = ? WHERE id = ?', [
        JSON.stringify(reponse), id,
      ]);
      return reponse;
    });
  } catch (e) {
    if (e?.code !== 'ER_DUP_ENTRY') throw e;
    const deja = await ligne('SELECT reponse FROM msc_mutation WHERE id = :id', { id });
    return { ...(json(deja?.reponse) ?? {}), rejoue: true };
  }
}

/** Le RPE et la note du jour. Une ligne par athlète, jour et séance. */
/* Le vocabulaire de « ce qui a bloqué ». Fermé : une règle compte sur ces
   codes, et un mot libre irait dans la note. */
export const LIMITES = ['rien', 'jambes', 'souffle', 'technique', 'mental', 'sommeil', 'nutrition', 'douleur', 'chaleur'];

export async function ecrireJournal(athleteId, { date, session_id, rpe, sommeil, note, douleurs, limites, fait }, cnx) {
  const q = cnx ?? { execute: (...a) => import('./bd.mjs').then((m) => m.bd().execute(...a)) };
  /* La coche « faite » : vrai, faux, null pour l'effacer — et absente du
     corps pour ne pas y toucher. Une écriture du RPE ne doit pas défaire ce
     que l'athlète a coché la veille. */
  const faitDefini = fait !== undefined;
  const faitValeur = fait == null ? null : fait ? 1 : 0;
  const [r] = await q.execute(
    `INSERT INTO msc_journal (athlete_id, session_id, date, rpe_ressenti, sommeil_h, note, fait)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE rpe_ressenti = VALUES(rpe_ressenti),
       sommeil_h = VALUES(sommeil_h), note = VALUES(note),
       fait = IF(?, VALUES(fait), fait)`,
    [athleteId, session_id ?? null, date, rpe ?? null, sommeil ?? null, note ?? null, faitValeur, faitDefini ? 1 : 0],
  );
  const journalId = r.insertId || (await ligne(
    'SELECT id FROM msc_journal WHERE athlete_id = :a AND date = :d AND session_id <=> :s',
    { a: athleteId, d: date, s: session_id ?? null },
  ))?.id;

  if (journalId && Array.isArray(douleurs)) {
    await q.execute('DELETE FROM msc_journal_douleur WHERE journal_id = ?', [journalId]);
    for (const d of douleurs) {
      await q.execute('INSERT INTO msc_journal_douleur (journal_id, douleur) VALUES (?, ?)', [
        journalId, String(d).slice(0, 48),
      ]);
    }
  }
  /* « rien » est une réponse, pas une absence de réponse : il se range aussi,
     pour que l'écran sache que la question a été posée. Il exclut les autres. */
  if (journalId && Array.isArray(limites)) {
    const admises = [...new Set(limites.map(String).filter((l) => LIMITES.includes(l)))];
    const gardees = admises.includes('rien') ? ['rien'] : admises;
    await q.execute('DELETE FROM msc_journal_limite WHERE journal_id = ?', [journalId]);
    for (const l of gardees) {
      await q.execute('INSERT INTO msc_journal_limite (journal_id, limite) VALUES (?, ?)', [journalId, l]);
    }
  }
  return { journal_id: journalId };
}

/** Le poids et la FC de repos du jour. */
export async function ecrireMesure(athleteId, { date, poids_kg, fc_repos, hrv_ms, source, etat, note }, cnx) {
  const q = cnx ?? (await import('./bd.mjs')).bd();
  await q.execute(
    `INSERT INTO msc_mesure (athlete_id, date, poids_kg, fc_repos, hrv_ms, source, etat, note, confirme_le)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE poids_kg = VALUES(poids_kg), fc_repos = VALUES(fc_repos),
       hrv_ms = VALUES(hrv_ms),
       source = VALUES(source), etat = VALUES(etat), note = VALUES(note),
       confirme_le = VALUES(confirme_le)`,
    [athleteId, date, poids_kg ?? null, fc_repos ?? null, hrv_ms ?? null, source ?? 'saisie',
     etat ?? 'confirme', note ?? null, (etat ?? 'confirme') === 'confirme' ? new Date() : null],
  );
  return { date };
}

/** Le profil : ce qu'on voit en touchant l'avatar. `nom` reste l'affichage. */
/* Les trois coachs que l'athlète peut choisir. La même liste vit dans
   server/coach.mjs (le ton) et src/data/coachs.ts (l'avatar) : à garder alignées. */
export const COACHS = ['tortionnaire', 'gentil', 'gros_porc'];

/** Le coach choisi par l'athlète — ce que /api/analyse, /api/coach et
    /api/recalcul donnent au modèle pour son ton. */
export async function coachDe(athleteId) {
  const a = await ligne('SELECT coach FROM msc_athlete WHERE id = :a', { a: athleteId });
  return COACHS.includes(a?.coach) ? a.coach : 'gentil';
}

export async function ecrireProfil(athleteId, { prenom, nom, surnom, annee_naissance, coach }, cnx) {
  const q = cnx ?? (await import('./bd.mjs')).bd();
  const nomNet = texte(nom, 120).trim();
  if (!nomNet) throw new DepotError('Le nom ne peut pas être vide.');
  if (coach != null && !COACHS.includes(coach)) throw new DepotError('Coach inconnu.');
  const annee = annee_naissance == null || annee_naissance === '' ? null : Number(annee_naissance);
  const cetteAnnee = new Date().getFullYear();
  if (annee != null && (!Number.isInteger(annee) || annee < cetteAnnee - 100 || annee > cetteAnnee - 5)) {
    throw new DepotError('Année de naissance invraisemblable.');
  }
  const prenomNet = prenom ? texte(prenom, 80).trim() || null : null;
  const surnomNet = surnom ? texte(surnom, 40).trim() || null : null;
  await q.execute(
    `UPDATE msc_athlete SET prenom = ?, nom = ?, surnom = ?, annee_naissance = ?,
       coach = COALESCE(?, coach) WHERE id = ?`,
    [prenomNet, nomNet, surnomNet, annee, coach ?? null, athleteId],
  );
  return { id: athleteId, prenom: prenomNet, nom: nomNet, surnom: surnomNet, annee_naissance: annee, coach: coach ?? undefined };
}

/**
 * Les activités que le navigateur a appariées.
 *
 * L'appariement a besoin du plan, donc il se fait dans le navigateur ; ce qui
 * en sort atterrit ici. Un remplacement plutôt qu'une fusion : la synchro
 * renvoie l'état complet de la fenêtre demandée, et une activité qui a disparu
 * de Strava — supprimée par l'athlète — doit disparaître d'ici aussi.
 *
 * Ce qui n'est pas touché : les activités saisies à la main, qui n'ont pas
 * d'identifiant Strava et que Strava ne peut donc pas confirmer.
 */
/* Ce que l'application a apparié, rangé dans la fenêtre qu'elle a synchronisée
   — les dates du plan — et rien au-delà. Avant, tout ce qui venait de Strava
   était effacé puis réécrit : l'historique tiré par le coach (plus ancien que
   le plan) ne survivait pas à la première synchro du téléphone. Maintenant :
   dans la fenêtre, ce que Strava n'a plus disparaît, le reste se met à jour ;
   hors de la fenêtre, rien ne bouge. Les colonnes que l'appariement ne porte
   pas (distance, nom, durée exacte) restent telles que l'import les a posées. */
export async function ecrireActivites(athleteId, activites, cnx, { depuis } = {}) {
  const q = cnx ?? (await import('./bd.mjs')).bd();
  const lot = (activites ?? []).filter((a) => a?.id_strava);
  const fenetre = /^\d{4}-\d{2}-\d{2}$/.test(String(depuis ?? ''))
    ? depuis
    : lot.map((a) => a.date).filter(Boolean).sort()[0] ?? null;
  if (fenetre) {
    /* Une séance est faite une fois (uq_activity_session) : on libère toutes
       celles de la fenêtre avant de reposer l'appariement. */
    await q.execute(
      'UPDATE msc_activity SET session_id = NULL WHERE athlete_id = ? AND id_strava IS NOT NULL AND date >= ?',
      [athleteId, fenetre],
    );
    const ids = lot.map((a) => Number(a.id_strava));
    await q.execute(
      `DELETE FROM msc_activity WHERE athlete_id = ? AND id_strava IS NOT NULL AND date >= ?
       ${ids.length ? `AND id_strava NOT IN (${ids.map(() => '?').join(',')})` : ''}`,
      [athleteId, fenetre, ...ids],
    );
  }
  let ecrites = 0;
  for (const a of lot) {
    const [r] = await q.execute(
      `INSERT INTO msc_activity (athlete_id, id_strava, session_id, date, sport, duree_min,
         allure_s_km, fc_moy, statut)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), session_id = VALUES(session_id),
         date = VALUES(date), sport = VALUES(sport), duree_min = VALUES(duree_min),
         allure_s_km = COALESCE(VALUES(allure_s_km), allure_s_km),
         fc_moy = COALESCE(VALUES(fc_moy), fc_moy), statut = VALUES(statut)`,
      [athleteId, a.id_strava, a.session_id ?? null, a.date, a.sport, a.duree_min,
       a.allure_moy ? secondesDAllure(a.allure_moy) : null, a.fc_moy ?? null, a.statut ?? 'fait'],
    );
    await q.execute('DELETE FROM msc_activity_bloc WHERE activity_id = ?', [r.insertId]);
    for (const [ordre, allure] of (a.splits_blocs ?? []).entries()) {
      await q.execute(
        'INSERT INTO msc_activity_bloc (activity_id, ordre, allure_s_km) VALUES (?, ?, ?)',
        [r.insertId, ordre, allure],
      );
    }
    ecrites += 1;
  }
  return { ecrites };
}

/** « 2026-09-09T18:02:11Z » (le local de Strava, avec un faux Z) → DATETIME. */
function dateHeure(iso) {
  const m = String(iso ?? '').match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/);
  return m ? `${m[1]} ${m[2]}` : null;
}

/**
 * L'historique Strava d'un athlète, tel que le serveur l'a tiré : chaque
 * activité avec ses colonnes riches — distance, dénivelé, durée exacte, FC,
 * cadence, effort. Une activité déjà connue est complétée, jamais dépariée :
 * l'appariement aux séances reste ce que l'application en a fait.
 */
export async function importerHistorique(athleteId, activites) {
  const q = (await import('./bd.mjs')).bd();
  let importees = 0;
  let premiere = null;
  let derniere = null;
  for (const a of activites ?? []) {
    if (!a?.id_strava || !a.date) continue;
    await q.execute(
      `INSERT INTO msc_activity (athlete_id, id_strava, session_id, date, debut, nom, sport, sport_strava,
         duree_min, duree_s, distance_m, denivele_m, allure_s_km, fc_moy, fc_max, cadence_moy, effort,
         manuelle, privee, statut)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'fait')
       ON DUPLICATE KEY UPDATE date = VALUES(date), debut = VALUES(debut), nom = VALUES(nom),
         sport = VALUES(sport), sport_strava = VALUES(sport_strava), duree_min = VALUES(duree_min),
         duree_s = VALUES(duree_s), distance_m = VALUES(distance_m), denivele_m = VALUES(denivele_m),
         allure_s_km = VALUES(allure_s_km), fc_moy = VALUES(fc_moy), fc_max = VALUES(fc_max),
         cadence_moy = VALUES(cadence_moy), effort = VALUES(effort), privee = VALUES(privee)`,
      [athleteId, a.id_strava, a.date, dateHeure(a.debut), String(a.nom ?? '').slice(0, 190), a.sport,
       String(a.sport_strava ?? '').slice(0, 48) || null, a.duree_min ?? 0, a.duree_s ?? null,
       a.distance_m ?? null, a.denivele_m ?? null, a.allure_s_km ? Math.round(a.allure_s_km) : null,
       a.fc_moy ?? null, a.fc_max ?? null, a.cadence_moy ?? null, a.effort ?? null, a.privee ? 1 : 0],
    );
    importees += 1;
    if (!premiere || a.date < premiere) premiere = a.date;
    if (!derniere || a.date > derniere) derniere = a.date;
  }
  return { importees, premiere, derniere };
}

/** « 4:56/km » → 296. L'inverse de `formatAllure`. */
function secondesDAllure(allure) {
  const [min, sec] = String(allure).split('/')[0].split(':').map(Number);
  return min * 60 + (sec || 0);
}

/* ------------------------------------- accepter, et déplacer la séance */

/* Une proposition acceptée déplace la séance.

   C'est tout le point. Tant qu'accepter ne posait qu'une date sur la
   proposition, l'écran disait « accepté » au-dessus d'une séance qui n'avait
   pas bougé d'une minute — et le lendemain le plan redemandait les 68 minutes
   que le coach venait de ramener à 54.

   Ce qui bouge : la quantité de la séance. Sa durée, et avec elle la distance,
   les mètres et la charge, qui sont la même quantité dite dans trois unités —
   une séance à 80 % est à 80 % de chacune. Et, pour une adaptation, la zone
   dans laquelle elle se court. Aucune allure n'est écrite : le moteur la dérive
   de la zone et du bloc, ici comme partout ailleurs.

   Ce qui est gardé : `avant`, la séance telle qu'elle était juste avant. C'est
   le seul fait de cette opération qui ne se recalcule pas — la séance a été
   écrasée — et c'est lui qui rend le retrait exact et qui garde le
   « 68 min → 54 min » vrai une fois la proposition acceptée. */

const PART_MIN = 0.5;
const PART_MAX = 1.25;

/** La ligne « 68 min · 12 km · RPE 7 », recomposée. Le classeur l'écrit ainsi,
    le générateur aussi ; c'est le seul endroit qui la fabrique. */
function composerMeta(duree, distance, metres, rpe) {
  return (
    [
      duree ? `${duree} min` : '',
      distance ? `${Number(distance)} km` : '',
      metres ? `${metres} m` : '',
      rpe ? `RPE ${rpe}` : '',
    ]
      .filter(Boolean)
      .join(' · ') || 'repos'
  );
}

/* Les totaux d'une semaine sont la somme de ses séances. Dès qu'une séance
   bouge ils sont périmés par construction, alors ils suivent — sans quoi
   l'écart de la semaine se mesurerait contre un volume qui n'existe plus.

   Sans `semaine`, toutes celles du plan : c'est ce qu'un plan qu'on vient
   d'écrire demande. */
async function recalculerSemaines(cnx, planId, semaine = null) {
  const filtre = semaine === null ? '' : ' AND semaine = ?';
  await cnx.execute(
    `UPDATE msc_week w
       JOIN (SELECT plan_id, semaine,
                    ROUND(SUM(duree_min) / 60, 1)          AS heures,
                    NULLIF(ROUND(SUM(COALESCE(distance_km, 0)), 1), 0) AS km,
                    NULLIF(SUM(COALESCE(natation_m, 0)), 0) AS metres,
                    SUM(charge)                             AS charge
             FROM msc_session WHERE plan_id = ?${filtre}
             GROUP BY plan_id, semaine) t
         ON t.plan_id = w.plan_id AND t.semaine = w.semaine
     SET w.heures = t.heures, w.km = t.km, w.natation_m = t.metres, w.charge = t.charge`,
    semaine === null ? [planId] : [planId, semaine],
  );
}

async function zonesDe(cnx, sessionId) {
  const [rows] = await cnx.execute(
    `SELECT z.code, z.ordre FROM msc_session_zone s JOIN msc_zone z ON z.code = s.zone_code
     WHERE s.session_id = ? ORDER BY s.ordre`,
    [sessionId],
  );
  return rows;
}

/**
 * Le garde-fou de zone, tenu là où la proposition s'écrit.
 *
 * Une zone que la base ne connaît pas, ou une zone *plus rapide* que celle
 * prévue, retombe sur celle de la séance : une adaptation faite après une
 * séance dure protège, elle n'aiguise pas, et décider quand aller vite est le
 * travail du plan — il l'a déjà fait. `msc_zone.ordre` va de la plus lente à la
 * plus rapide, donc c'est une comparaison d'entiers.
 *
 * Le tenir à l'écriture plutôt qu'à l'affichage a une conséquence qui vaut la
 * peine : ce qui est rangé est déjà ce qui sera montré, et ce qui sera
 * appliqué. Il n'y a pas une version affichable et une version stockée.
 */
export async function zoneAdmissible(cnx, sessionId, propose) {
  if (!propose) return null;
  const zones = await zonesDe(cnx, sessionId);
  const prevue = zones[zones.length - 1];
  /* Hyrox, nage, vélo : le plan n'écrit pas d'allure dessus, l'adaptation n'en
     reçoit pas non plus. */
  if (!prevue) return null;
  const [[p]] = await cnx.execute('SELECT code, ordre FROM msc_zone WHERE code = ?', [propose]);
  if (!p) return prevue.code;
  return p.ordre > prevue.ordre ? prevue.code : p.code;
}

/** Écrit la séance, et rend ce qu'elle était. */
/* Les jours, tels que les séances les portent : le long, le court, le polonais. */
const JOURS = [
  ['Lundi', 'LUN', 'PON'], ['Mardi', 'MAR', 'WT'], ['Mercredi', 'MER', 'ŚR'], ['Jeudi', 'JEU', 'CZW'],
  ['Vendredi', 'VEN', 'PT'], ['Samedi', 'SAM', 'SOB'], ['Dimanche', 'DIM', 'ND'],
];
function jourDe(date) {
  return JOURS[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7];
}

/**
 * Une séance change de jour. La semaine et le bloc suivent la nouvelle date
 * (la semaine du plan qui contient ce jour, lue sur les séances qui y sont
 * déjà), l'ordre du jour se range après ce qui s'y trouve, et les libellés du
 * jour se réécrivent. Les totaux des deux semaines sont refaits par l'appelant.
 */
async function changerDeJour(cnx, s, versDate) {
  const [[voisine]] = await cnx.execute(
    `SELECT semaine, bloc_id FROM msc_session
     WHERE plan_id = ? AND YEARWEEK(date, 3) = YEARWEEK(?, 3) LIMIT 1`,
    [s.plan_id, versDate],
  );
  const semaine = voisine?.semaine ?? s.semaine;
  const blocId = voisine?.bloc_id ?? s.bloc_id;
  const [[suivant]] = await cnx.execute(
    'SELECT COALESCE(MAX(ordre), -1) + 1 AS n FROM msc_session WHERE plan_id = ? AND date = ?',
    [s.plan_id, versDate],
  );
  const [long, fr, pl] = jourDe(versDate);
  await cnx.execute(
    `UPDATE msc_session SET date = ?, semaine = ?, bloc_id = ?, ordre = ?, jour_long = ?, jour_fr = ?, jour_pl = ?
     WHERE id = ?`,
    [versDate, semaine, blocId, Number(suivant.n), long, fr, pl, s.id],
  );
}

async function deplacerSeance(cnx, sessionId, { part, zone, source, versDate = null }) {
  const [[s]] = await cnx.execute(
    `SELECT id, plan_id, semaine, bloc_id, date, ordre, jour_long, jour_fr, jour_pl,
            duree_min, rpe_cible, charge, distance_km, natation_m,
            meta_fr, meta_pl, adapte_par
     FROM msc_session WHERE id = ? FOR UPDATE`,
    [sessionId],
  );
  if (!s) throw new DepotError('Séance inconnue.', 404);
  /* Deux propositions acceptées sur la même séance se marcheraient dessus : la
     seconde partirait de ce que la première a écrit, et retirer la première
     effacerait la seconde. Une à la fois, et on dit laquelle tient. */
  if (s.adapte_par && s.adapte_par !== source) {
    throw new DepotError('Cette séance porte déjà une autre proposition acceptée.', 409);
  }

  const zonesAvant = await zonesDe(cnx, sessionId);
  const avant = {
    duree_min: s.duree_min,
    distance_km: s.distance_km === null ? null : Number(s.distance_km),
    natation_m: s.natation_m === null ? null : Number(s.natation_m),
    charge: s.charge,
    meta_fr: s.meta_fr,
    meta_pl: s.meta_pl,
    zones: zonesAvant.map((z) => z.code),
    /* Le jour d'avant, pour un déplacement : retirer la proposition ramène la
       séance là où elle était. */
    date: s.date, semaine: s.semaine, bloc_id: s.bloc_id, ordre: s.ordre,
    jour_long: s.jour_long, jour_fr: s.jour_fr, jour_pl: s.jour_pl,
  };

  const f = Number.isFinite(part) ? Math.min(PART_MAX, Math.max(PART_MIN, part)) : 1;
  const duree = s.duree_min ? Math.max(1, Math.round(s.duree_min * f)) : 0;
  const distance = avant.distance_km === null ? null : Math.round(avant.distance_km * f * 10) / 10;
  /* Une nage s'écrit en centaines de mètres, dans le classeur comme dans le
     générateur. 2 400 × 0,8 = 1 920 se range à 1 900, pas à 1 920. */
  const metres = avant.natation_m === null ? null : Math.round((avant.natation_m * f) / 100) * 100;
  const meta = composerMeta(duree, distance, metres, s.rpe_cible);

  await cnx.execute(
    `UPDATE msc_session SET duree_min = ?, distance_km = ?, natation_m = ?, charge = ?,
       meta_fr = ?, meta_pl = ?, adapte_par = ? WHERE id = ?`,
    [duree, distance, metres, duree * s.rpe_cible, meta, meta, source, sessionId],
  );

  /* La zone n'est réécrite que si elle change. Sans ça, accepter une adaptation
     qui garde la zone prévue réduirait « échauffement EF puis seuil » à
     « seuil » — la séance perdrait son échauffement pour rien. */
  const principale = avant.zones[avant.zones.length - 1];
  if (zone && zone !== principale) {
    await cnx.execute('DELETE FROM msc_session_zone WHERE session_id = ?', [sessionId]);
    await cnx.execute(
      'INSERT INTO msc_session_zone (session_id, zone_code, ordre) VALUES (?, ?, 0)',
      [sessionId, zone],
    );
  }

  if (versDate && versDate !== s.date) {
    await changerDeJour(cnx, s, versDate);
    await recalculerSemaines(cnx, s.plan_id, null);
  } else {
    await recalculerSemaines(cnx, s.plan_id, s.semaine);
  }
  return avant;
}

/** Remet la séance comme elle était. Rend faux si elle a changé de main depuis. */
async function restaurerSeance(cnx, sessionId, avant, source) {
  const [[s]] = await cnx.execute(
    'SELECT id, plan_id, semaine, adapte_par FROM msc_session WHERE id = ? FOR UPDATE',
    [sessionId],
  );
  /* La séance n'est plus celle que cette proposition a écrite — un plan
     regénéré, une autre proposition. On retire l'acceptation sans toucher à la
     séance : restaurer écraserait le travail de quelqu'un d'autre. */
  if (!s || !avant || s.adapte_par !== source) return false;

  await cnx.execute(
    `UPDATE msc_session SET duree_min = ?, distance_km = ?, natation_m = ?, charge = ?,
       meta_fr = ?, meta_pl = ?, adapte_par = NULL WHERE id = ?`,
    [avant.duree_min, avant.distance_km ?? null, avant.natation_m ?? null, avant.charge,
     avant.meta_fr, avant.meta_pl, sessionId],
  );
  await cnx.execute('DELETE FROM msc_session_zone WHERE session_id = ?', [sessionId]);
  for (const [i, z] of (avant.zones ?? []).entries()) {
    await cnx.execute(
      'INSERT INTO msc_session_zone (session_id, zone_code, ordre) VALUES (?, ?, ?)',
      [sessionId, z, i],
    );
  }
  if (avant.date) {
    /* Elle avait changé de jour : elle y retourne, avec sa semaine, son bloc,
       son rang et ses libellés d'alors. */
    await cnx.execute(
      `UPDATE msc_session SET date = ?, semaine = ?, bloc_id = ?, ordre = ?, jour_long = ?, jour_fr = ?, jour_pl = ?
       WHERE id = ?`,
      [avant.date, avant.semaine ?? s.semaine, avant.bloc_id ?? null, avant.ordre ?? 0,
       avant.jour_long, avant.jour_fr, avant.jour_pl, sessionId],
    );
    await recalculerSemaines(cnx, s.plan_id, null);
  } else {
    await recalculerSemaines(cnx, s.plan_id, s.semaine);
  }
  return true;
}

/** Accepter ou retirer une proposition du coach. */
export async function appliquer(athleteId, table, id, applique, cnx) {
  if (table !== 'msc_adaptation' && table !== 'msc_ajustement') {
    throw new DepotError('Table de proposition inconnue.', 400);
  }
  return cnx
    ? faireAppliquer(cnx, athleteId, table, id, applique)
    : transaction((c) => faireAppliquer(c, athleteId, table, id, applique));
}

async function faireAppliquer(cnx, athleteId, table, id, applique) {
  const source = `${table}:${id}`;

  {
    const [[p]] = await cnx.execute(
      `SELECT p.* FROM ${table} p JOIN msc_analyse n ON n.id = p.analyse_id
       WHERE p.id = ? AND n.athlete_id = ? FOR UPDATE`,
      [id, athleteId],
    );
    if (!p) throw new DepotError('Proposition inconnue.', 404);

    /* Déjà dans l'état demandé : ne rien faire. Un double clic, ou un rejeu de
       la file hors-ligne, ne doit pas raccourcir la séance deux fois. */
    const deja = p.applique_le !== null;
    if (Boolean(applique) === deja) return { id, applique: deja, seance: false };

    const part =
      table === 'msc_adaptation'
        ? Number(p.part_duree)
        : p.part === null || p.part === undefined
          ? 1
          : Number(p.part);
    const versDate = table === 'msc_ajustement' && p.vers_date ? String(p.vers_date).slice(0, 10) : null;
    /* Une ligne qui nomme une séance sans rien lui faire — « sautée », une
       consigne — est une décision notée, pas une écriture sur la séance. */
    const rienASeance = table === 'msc_ajustement' && p.session_id
      && (p.part === null || p.part === undefined) && !versDate;

    if (!applique) {
      /* Un ajustement de semaine n'a pas de séance : il porte sa phrase, et
         l'accepter n'est qu'une décision notée. */
      const rendue = p.session_id && !rienASeance
        ? await restaurerSeance(cnx, p.session_id, json(p.avant), source)
        : false;
      await cnx.execute(`UPDATE ${table} SET applique_le = NULL WHERE id = ?`, [id]);
      return { id, applique: false, seance: rendue };
    }

    const avant = p.session_id && !rienASeance
      ? await deplacerSeance(cnx, p.session_id, {
          part,
          zone: table === 'msc_adaptation' ? p.zone_code : null,
          source,
          versDate,
        })
      : null;
    await cnx.execute(`UPDATE ${table} SET applique_le = ?, avant = ? WHERE id = ?`, [
      new Date(),
      avant ? JSON.stringify(avant) : null,
      id,
    ]);
    return { id, applique: true, seance: Boolean(avant) };
  }
}

/* ------------------------------------------------- ce que le coach produit */

/* Ce qui est stocké ici est ce que le modèle a écrit ou choisi : la prose, la
   zone, la part. Les statistiques viennent du navigateur, qui les a calculées
   avec le moteur avant de les donner à Claude pour qu'il les cite — le serveur
   range ce qu'on lui a remis, il ne recalcule rien. */

export async function enregistrerAnalyse(athleteId, { session_id, date, modele, cout_eur, strava,
  verdict, observations, stats, adaptation, suivante_id, langue = 'fr', ton = null }) {
  return transaction(async (cnx) => {
    await cnx.execute('DELETE FROM msc_analyse WHERE session_id = ?', [session_id]);
    const [r] = await cnx.execute(
      `INSERT INTO msc_analyse (athlete_id, type, session_id, date, modele, cout_eur, strava_lu, ton,
         verdict_fr, verdict_pl, stats, blocs)
       VALUES (?, 'seance', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [athleteId, session_id, date, modele, cout_eur ?? 0, strava ? 1 : 0, ton,
       ...deuxLangues(verdict, langue),
       stats ? JSON.stringify(stats) : null,
       observations ? JSON.stringify(observations) : null],
    );

    if (adaptation && suivante_id) {
      await cnx.execute(
        `INSERT INTO msc_adaptation (analyse_id, session_id, zone_code, part_duree, pourquoi_fr, pourquoi_pl)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [r.insertId, suivante_id,
         /* La zone passe le garde-fou avant d'être rangée, pas au moment de
            l'afficher : ce qui est en base est déjà ce qui sera montré, et ce
            qui sera écrit sur la séance le jour où l'athlète accepte. */
         await zoneAdmissible(cnx, suivante_id, adaptation.zone),
         borner(adaptation.part_duree, 0.5, 1), ...deuxLangues(adaptation.pourquoi, langue)],
      );
    }
    return { analyse_id: r.insertId };
  });
}

export async function enregistrerRecalcul(athleteId, { plan_id, semaine, date, modele, cout_eur,
  strava, verdict, observations, ecart, recalcul, ajustements = [], langue = 'fr' }) {
  return transaction(async (cnx) => {
    await cnx.execute('DELETE FROM msc_analyse WHERE plan_id = ? AND semaine = ?', [plan_id, semaine]);
    const [r] = await cnx.execute(
      `INSERT INTO msc_analyse (athlete_id, type, plan_id, semaine, date, modele, cout_eur,
         strava_lu, verdict_fr, verdict_pl, blocs)
       VALUES (?, 'hebdo', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [athleteId, plan_id, semaine, date, modele, cout_eur ?? 0, strava ? 1 : 0,
       ...deuxLangues(verdict, langue), observations ? JSON.stringify(observations) : null],
    );

    await cnx.execute(
      `INSERT INTO msc_ecart (analyse_id, plan_id, semaine, texte_fr, texte_pl, recalcul)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [r.insertId, plan_id, semaine, ...deuxLangues(ecart, langue), JSON.stringify(recalcul ?? [])],
    );

    /* Une proposition qui nomme une séance hors du plan, ou un type que la base
       ne connaît pas, est écartée ici plutôt que refusée par une clé étrangère
       en plein milieu de la transaction. Le reste passe. */
    let gardes = 0;
    for (const a of ajustements) {
      const type = a.type_code ?? a.type;
      const connu = await ligne('SELECT code FROM msc_type WHERE code = :c', { c: type ?? '' });
      if (!connu) continue;
      if (a.session_id) {
        const s = await ligne(
          'SELECT id FROM msc_session WHERE id = :i AND plan_id = :p',
          { i: a.session_id, p: plan_id },
        );
        if (!s) continue;
      } else if (!a.semaine) continue;

      await cnx.execute(
        `INSERT INTO msc_ajustement (analyse_id, session_id, semaine, type_code, part, texte_fr, texte_pl)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [r.insertId, a.session_id ?? null, a.semaine ?? null, type,
         a.part === null || a.part === undefined ? null : borner(a.part, 0.5, 1.25),
         ...deuxLangues(a.texte, langue, true)],
      );
      gardes += 1;
    }
    return { analyse_id: r.insertId, ajustements: gardes, ecartes: ajustements.length - gardes };
  });
}

/**
 * Les sept prochains jours, tels que le coach les a replanifiés. Une seule
 * replanification vivante par plan : la précédente s'efface, ses propositions
 * avec elle — celles déjà acceptées ont déjà écrit la séance, et gardent leur
 * trace sur elle (adapte_par).
 */
export async function enregistrerGlissant(athleteId, { plan_id, date, modele, cout_eur, strava, ton = null,
  implication, observations, glissant, ajustements = [], langue = 'fr' }) {
  return transaction(async (cnx) => {
    await cnx.execute("DELETE FROM msc_analyse WHERE plan_id = ? AND type = 'glissant'", [plan_id]);
    const [r] = await cnx.execute(
      `INSERT INTO msc_analyse (athlete_id, type, plan_id, date, modele, cout_eur, strava_lu, ton,
         verdict_fr, verdict_pl, blocs, glissant)
       VALUES (?, 'glissant', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [athleteId, plan_id, date, modele, cout_eur ?? 0, strava ? 1 : 0, ton,
       ...deuxLangues(implication ?? '', langue),
       observations ? JSON.stringify(observations) : null,
       JSON.stringify(glissant ?? null)],
    );

    /* Une proposition nomme une séance de ce plan, ou elle est écartée. Le type
       est celui de la séance ; la date d'arrivée d'un déplacement doit tomber
       dans les sept jours annoncés, sinon elle est ignorée et la ligne reste
       une note. */
    let gardes = 0;
    const jours = new Set((glissant?.jours ?? []).map((j) => j.date));
    for (const a of ajustements) {
      if (!a.session_id) continue;
      const s = await ligne(
        'SELECT id, type_code, date FROM msc_session WHERE id = :i AND plan_id = :p',
        { i: a.session_id, p: plan_id },
      );
      if (!s) continue;
      const versDate = a.vers_date && jours.has(a.vers_date) && a.vers_date !== s.date ? a.vers_date : null;
      const part = a.part === null || a.part === undefined ? null : borner(a.part, 0.5, 1.25);
      await cnx.execute(
        `INSERT INTO msc_ajustement (analyse_id, session_id, type_code, part, vers_date, texte_fr, texte_pl)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [r.insertId, s.id, s.type_code, part === 1 ? null : part, versDate, ...deuxLangues(a.texte, langue, true)],
      );
      gardes += 1;
    }
    return { analyse_id: r.insertId, ajustements: gardes };
  });
}

/** Un tour de chat, ajouté au bout de son fil. */
export async function ajouterAuChat(athleteId, fil, tours) {
  return transaction(async (cnx) => {
    const [[dernier]] = await cnx.execute(
      'SELECT COALESCE(MAX(ordre), -1) AS n FROM msc_chat WHERE athlete_id = ? AND fil = ?',
      [athleteId, fil],
    );
    let ordre = Number(dernier.n) + 1;
    for (const t of tours) {
      await cnx.execute(
        `INSERT INTO msc_chat (athlete_id, fil, ordre, role, texte, modele, cout_eur, ton)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [athleteId, fil, ordre++, t.role, t.texte, t.modele ?? null, t.cout_eur ?? null, t.ton ?? null],
      );
    }
    return { fil, tours: tours.length };
  });
}

/**
 * Les conversations d'un athlète avec le coach, pour le back office : chaque
 * fil (le coach de la semaine, ou une séance) avec ses tours, le ton qui
 * parlait, le modèle, le coût. Le fil le plus récent d'abord.
 */
export async function conversations(athleteId) {
  const tours = await lignes(
    `SELECT c.fil, c.ordre, c.role, c.texte, c.modele, c.cout_eur, c.ton, c.cree_le,
            s.titre_court_fr, s.titre_court_pl, s.date AS session_date
     FROM msc_chat c
     LEFT JOIN msc_session s ON c.fil = CONCAT('session:', s.id)
     WHERE c.athlete_id = :a
     ORDER BY c.fil, c.ordre`,
    { a: athleteId },
  );
  const fils = new Map();
  for (const t of tours) {
    if (!fils.has(t.fil)) {
      fils.set(t.fil, {
        fil: t.fil,
        titre: t.titre_court_fr
          ? { fr: `${t.titre_court_fr} · ${t.session_date}`, pl: `${t.titre_court_pl ?? t.titre_court_fr} · ${t.session_date}` }
          : { fr: 'Le coach · questions générales', pl: 'Trener · pytania ogólne' },
        tours: [],
        dernier: null,
      });
    }
    const f = fils.get(t.fil);
    f.tours.push({
      role: t.role, texte: t.texte, modele: t.modele ?? null,
      cout_eur: t.cout_eur == null ? null : Number(t.cout_eur), ton: t.ton ?? null,
      date: t.cree_le instanceof Date ? t.cree_le.toISOString() : String(t.cree_le),
    });
    f.dernier = f.tours[f.tours.length - 1].date;
  }
  return [...fils.values()].sort((x, y) => String(y.dernier).localeCompare(String(x.dernier)));
}

/* --------------------------------------------- le back office : compétitions */

/* --------------------------------------------- enregistrer un plan généré */

/* Le générateur produit un plan entier — blocs, semaines, séances — sans appeler
   quoi que ce soit. Jusqu'ici il s'affichait et disparaissait avec l'onglet.

   Ce qui est écrit ici est ce que le générateur a décidé : les dates, les
   durées, les zones, les titres. Ce qui NE l'est pas : la charge, qui est
   durée × RPE et se dérive donc plutôt que de se croire, et les totaux
   hebdomadaires, qui sont la somme des séances de la semaine. Le serveur range
   ce qu'on lui remet, mais il ne range pas deux fois le même nombre.

   Le plan d'avant est désactivé, pas supprimé, et rien de ce que l'athlète a
   vécu ne bouge : le journal et les activités appartiennent à l'athlète et
   pointent vers des séances. Un plan neuf, ce sont des séances neuves ; les
   anciennes restent, et leur histoire avec. C'est la réponse que le schéma
   donnait déjà, et c'est ici qu'elle se vérifie. */

const MAX_BLOCS = 12;
const MAX_SEMAINES = 120;
const MAX_SEANCES = 1200;

function texte(v, max) {
  return String(v ?? '').slice(0, max);
}

function entier(v, min, max, defaut = 0) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return defaut;
  return Math.min(max, Math.max(min, n));
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function enregistrerPlan(athleteId, plan, cnx) {
  /* Sur la connexion de `mutation()` quand il y en a une : la réservation de
     l'identifiant et l'écriture du plan sont alors la même transaction, et un
     rejeu de la file hors-ligne ne peut pas semer un second plan. */
  return cnx
    ? ecrirePlan(cnx, athleteId, plan)
    : transaction((c) => ecrirePlan(c, athleteId, plan));
}

async function ecrirePlan(cnx, athleteId, { nom, athlete, methode, blocs, semaines, sessions, objectifs = [], origine }) {
  /* Le plan est bâti sur deux références 10 km. Les poser sur l'athlète est
     la moitié du geste : sans ça, les séances afficheraient des allures que
     le plan n'a pas utilisées. Les bornes sont celles du reste (2:00–15:00
     au km, cible au moins aussi rapide). */
  if (athlete && Number.isFinite(Number(athlete.ref_actuelle_s)) && Number.isFinite(Number(athlete.ref_cible_s))) {
    const actuelle = entier(athlete.ref_actuelle_s, 120, 900, 0);
    const cible = entier(athlete.ref_cible_s, 120, 900, 0);
    if (actuelle && cible && cible <= actuelle) {
      await cnx.execute(
        'UPDATE msc_athlete SET ref_actuelle_s = ?, ref_cible_s = ? WHERE id = ?',
        [actuelle, cible, athleteId],
      );
    }
  }
  if (!Array.isArray(blocs) || blocs.length === 0) throw new DepotError('Plan sans bloc.');
  if (!Array.isArray(sessions) || sessions.length === 0) throw new DepotError('Plan sans séance.');
  if (blocs.length > MAX_BLOCS) throw new DepotError(`Plus de ${MAX_BLOCS} blocs.`);
  if ((semaines?.length ?? 0) > MAX_SEMAINES) throw new DepotError(`Plus de ${MAX_SEMAINES} semaines.`);
  if (sessions.length > MAX_SEANCES) throw new DepotError(`Plus de ${MAX_SEANCES} séances.`);
  for (const x of sessions) {
    if (!ISO.test(String(x.date))) throw new DepotError(`Date de séance illisible : ${x.date}`);
  }

  const dates = sessions.map((x) => x.date).sort();

  {
    /* Un seul plan actif à la fois. Les autres restent lisibles en base ; ils
       ne sont simplement plus celui que l'application sert. */
    await cnx.execute('UPDATE msc_plan SET actif = 0 WHERE athlete_id = ?', [athleteId]);
    /* « classeur » pour un plan importé tel qu'écrit par l'athlète ou son coach,
       « genere » pour ce que le générateur fabrique. */
    const [r] = await cnx.execute(
      `INSERT INTO msc_plan (athlete_id, nom, origine, debut, fin, actif, methode)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
      [athleteId, texte(nom || 'Plan généré', 160), origine === 'classeur' ? 'classeur' : 'genere',
       dates[0], dates[dates.length - 1], methode ? JSON.stringify(methode) : null],
    );
    const planId = r.insertId;

    const idDeBloc = new Map();
    for (const b of blocs) {
      const [rb] = await cnx.execute(
        `INSERT INTO msc_bloc (plan_id, code, part, semaine_de, semaine_a,
           nom_fr, nom_pl, focus_fr, focus_pl)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [planId, texte(b.code, 4), Math.min(1, Math.max(0, Number(b.part) || 0)),
         entier(b.de, 0, 999), entier(b.a, 0, 999),
         texte(b.nom?.fr, 120), texte(b.nom?.pl ?? b.nom?.fr, 120),
         b.quoi?.fr ? texte(b.quoi.fr, 190) : null,
         b.quoi?.fr ? texte(b.quoi.pl ?? b.quoi.fr, 190) : null],
      );
      idDeBloc.set(b.code, rb.insertId);
    }

    /* Une séance dont le bloc n'existe pas n'est pas devinée : elle est
       rattachée au dernier, et le plan reste cohérent plutôt que troué. */
    const dernierBloc = idDeBloc.get(blocs[blocs.length - 1].code);
    const blocDe = (code) => idDeBloc.get(code) ?? dernierBloc;

    for (const w of semaines ?? []) {
      await cnx.execute(
        `INSERT INTO msc_week (plan_id, semaine, bloc_id, phase, heures, km, natation_m, charge)
         VALUES (?, ?, ?, ?, 0, NULL, NULL, NULL)`,
        [planId, entier(w.semaine, 0, 999), blocDe(w.bloc), texte(w.phase, 120)],
      );
    }

    /* `ordre` départage deux séances du même jour — la nage du matin et le vélo
       du soir. Il se compte ici : c'est une propriété du plan écrit, pas une
       donnée que le navigateur aurait à tenir. */
    const parJour = new Map();
    for (const x of sessions) {
      const ordre = parJour.get(x.date) ?? 0;
      parJour.set(x.date, ordre + 1);

      const duree = entier(x.duree_min, 0, 600);
      const rpe = entier(x.rpe_cible, 0, 10);
      const [rs] = await cnx.execute(
        `INSERT INTO msc_session (plan_id, semaine, bloc_id, date, ordre, jour_long, jour_fr,
           jour_pl, phase, discipline, type_code, duree_min, rpe_cible, charge, distance_km,
           natation_m, titre_fr, titre_pl, titre_court_fr, titre_court_pl, meta_fr, meta_pl,
           detail_fr, detail_pl, consigne_fr, consigne_pl, but_fr, but_pl, reussite_fr, reussite_pl)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [planId, entier(x.semaine, 0, 999), blocDe(x.bloc), x.date, ordre,
         texte(x.jour_long, 48), texte(x.jour?.fr, 8), texte(x.jour?.pl ?? x.jour?.fr, 8),
         texte(x.phase, 120), texte(x.discipline, 32), texte(x.type, 16),
         duree, rpe,
         /* La charge est durée × RPE. Elle se dérive, donc elle ne se croit pas. */
         duree * rpe,
         x.distance_km === undefined || x.distance_km === null ? null : Number(x.distance_km),
         x.natation_m === undefined || x.natation_m === null ? null : entier(x.natation_m, 0, 100000),
         texte(x.titre?.fr, 190), texte(x.titre?.pl ?? x.titre?.fr, 190),
         texte(x.titre_court?.fr, 120), texte(x.titre_court?.pl ?? x.titre_court?.fr, 120),
         texte(x.meta?.fr, 120), texte(x.meta?.pl ?? x.meta?.fr, 120),
         String(x.detail?.fr ?? ''), String(x.detail?.pl ?? x.detail?.fr ?? ''),
         x.consigne?.fr ? texte(x.consigne.fr, 190) : null,
         x.consigne?.fr ? texte(x.consigne.pl ?? x.consigne.fr, 190) : null,
         x.but?.fr ? texte(x.but.fr, 190) : null,
         x.but?.fr ? texte(x.but.pl ?? x.but.fr, 190) : null,
         x.reussite?.fr ? texte(x.reussite.fr, 190) : null,
         x.reussite?.fr ? texte(x.reussite.pl ?? x.reussite.fr, 190) : null],
      );

      for (const [i, z] of (x.zones ?? []).slice(0, 8).entries()) {
        await cnx.execute(
          'INSERT INTO msc_session_zone (session_id, zone_code, ordre) VALUES (?, ?, ?)',
          [rs.insertId, texte(z, 16), i],
        );
      }
    }

    await recalculerSemaines(cnx, planId);

    /* Les objectifs suivent le plan, les compétitions non : une course
       appartient à l'athlète. On retrouve la sienne à la date et au nom, et on
       ne la crée que si elle manque — sinon regénérer un plan sèmerait des
       doublons dans le back office. */
    const semaineDe = new Map(sessions.map((x) => [x.date, entier(x.semaine, 0, 999)]));
    let vises = 0;
    for (const o of objectifs) {
      if (!ISO.test(String(o.date)) || !o.nom) continue;
      let [[c]] = await cnx.execute(
        'SELECT id FROM msc_competition WHERE athlete_id = ? AND date = ? AND nom = ?',
        [athleteId, o.date, texte(o.nom, 160)],
      );
      if (!c) {
        /* Une cyclosportive est une compétition comme une autre : la discipline
           vient de l'objectif quand il la donne, la course à pied sinon. */
        const [rc] = await cnx.execute(
          `INSERT INTO msc_competition (athlete_id, date, nom, discipline, type_course, distance_km, officielle)
           VALUES (?, ?, ?, ?, ?, ?, 1)`,
          [athleteId, o.date, texte(o.nom, 160), texte(o.discipline || 'Course à pied', 32),
           o.type_course ? texte(o.type_course, 24) : null, Number(o.distance_km) || 10],
        );
        c = { id: rc.insertId };
      }
      /* Une course encodée avant que les types existent, ou dont le type
         change dans le formulaire : l'objectif le pose sur la course. */
      if (o.type_course) {
        await cnx.execute(
          'UPDATE msc_competition SET type_course = ?, distance_km = ? WHERE id = ? AND athlete_id = ?',
          [texte(o.type_course, 24), Number(o.distance_km) || 10, c.id, athleteId],
        );
      }
      const basse = entier(o.cible_s, 1, 86400, 3600);
      const haute = Math.max(basse, entier(o.cible_haute_s ?? o.cible_s, 1, 86400, basse));
      /* Le libellé de la cible tel que le plan l'écrit (« 38–39 min », « finir »),
         sinon le chrono bas en mm:ss. */
      const libelle = o.cible?.fr
        ? texte(o.cible.fr, 80)
        : `${Math.floor(basse / 60)}:${String(basse % 60).padStart(2, '0')}`;
      await cnx.execute(
        `INSERT INTO msc_objectif (plan_id, competition_id, semaine, principal,
           cible_s, cible_haute_s, type_course, parties, cible_fr, cible_pl)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE semaine = VALUES(semaine), type_course = VALUES(type_course),
           parties = VALUES(parties)`,
        /* La semaine de l'objectif est celle de la séance qui tombe ce jour-là.
           Elle se déduit du plan qu'on vient d'écrire ; la demander au
           formulaire serait demander un nombre qu'on connaît déjà. */
        [planId, c.id, semaineDe.get(o.date) ?? 0, o.principal ? 1 : 0,
         basse, haute, o.type_course ? texte(o.type_course, 24) : null,
         /* Les parties d'un enchaînement, telles que le formulaire les vise :
            un tableau de { discipline, cible_s }, dans l'ordre du catalogue. */
         Array.isArray(o.parties) && o.parties.length > 0
           ? JSON.stringify(o.parties.slice(0, 6).map((x) => ({
             discipline: texte(x.discipline ?? '', 16),
             cible_s: entier(x.cible_s, 1, 86400, 0),
           })))
           : null,
         libelle, o.cible?.pl ? texte(o.cible.pl, 80) : libelle],
      );
      vises += 1;
    }

    return { plan_id: planId, seances: sessions.length, semaines: semaines?.length ?? 0,
             blocs: blocs.length, objectifs: vises, debut: dates[0], fin: dates[dates.length - 1] };
  }
}

/**
 * Le calendrier commun : qui court quoi, et quand. Toutes les compétitions de
 * tous les athlètes — c'est un calendrier de club, pas une vue privée : le
 * nom, la date, la distance, l'objectif du plan actif s'il y en a un, et le
 * résultat s'il est couru. Rien du reste (mesures, journal, forme) ne passe
 * par ici.
 */
export async function calendrier() {
  return (await lignes(
    `SELECT c.id, c.date, c.nom, c.lieu, c.pays, c.discipline, c.distance_km, c.officielle,
            a.id AS athlete_id, a.nom AS athlete_nom, a.prenom AS athlete_prenom, a.surnom AS athlete_surnom,
            r.temps_s, r.classement, r.abandon,
            o.cible_fr, o.cible_pl, o.principal
     FROM msc_competition c
     JOIN msc_athlete a ON a.id = c.athlete_id
     LEFT JOIN msc_resultat r ON r.competition_id = c.id
     LEFT JOIN msc_objectif o ON o.competition_id = c.id
       AND o.plan_id = (SELECT p.id FROM msc_plan p WHERE p.athlete_id = a.id AND p.actif = 1 ORDER BY p.debut DESC LIMIT 1)
     ORDER BY c.date, a.nom`,
  )).map((l) => ({
    id: l.id,
    date: l.date,
    nom: l.nom,
    lieu: l.lieu ?? null,
    pays: l.pays ?? null,
    discipline: l.discipline,
    distance_km: Number(l.distance_km),
    officielle: Boolean(l.officielle),
    athlete: { id: l.athlete_id, nom: l.athlete_nom, prenom: l.athlete_prenom ?? null, surnom: l.athlete_surnom ?? null },
    cible: l.cible_fr ? { fr: l.cible_fr, pl: l.cible_pl ?? l.cible_fr } : null,
    principal: Boolean(l.principal),
    resultat: l.temps_s == null && !l.abandon
      ? null
      : { temps_s: l.temps_s == null ? null : Number(l.temps_s), classement: l.classement ?? null, abandon: Boolean(l.abandon) },
  }));
}

export async function ecrireCompetition(athleteId, c) {
  return transaction(async (cnx) => {
    let id = c.id;
    if (id) {
      const [r] = await cnx.execute(
        `UPDATE msc_competition SET date = ?, nom = ?, lieu = ?, pays = ?, discipline = ?,
           type_course = ?, distance_km = ?, denivele_m = ?, officielle = ?, note = ?
         WHERE id = ? AND athlete_id = ?`,
        [c.date, c.nom, c.lieu ?? null, c.pays ?? null, c.discipline ?? 'Course à pied',
         c.type_course ?? null, c.distance_km, c.denivele_m ?? null, c.officielle === false ? 0 : 1, c.note ?? null,
         id, athleteId],
      );
      if (r.affectedRows === 0) throw new DepotError('Compétition inconnue.', 404);
    } else {
      const [r] = await cnx.execute(
        `INSERT INTO msc_competition (athlete_id, date, nom, lieu, pays, discipline, type_course,
           distance_km, denivele_m, officielle, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [athleteId, c.date, c.nom, c.lieu ?? null, c.pays ?? null, c.discipline ?? 'Course à pied',
         c.type_course ?? null, c.distance_km, c.denivele_m ?? null, c.officielle === false ? 0 : 1, c.note ?? null],
      );
      id = r.insertId;
    }

    if (c.resultat) {
      const r = c.resultat;
      await cnx.execute(
        `INSERT INTO msc_resultat (competition_id, temps_s, classement, classement_categorie,
           categorie, partants, fc_moy, abandon, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE temps_s = VALUES(temps_s), classement = VALUES(classement),
           classement_categorie = VALUES(classement_categorie), categorie = VALUES(categorie),
           partants = VALUES(partants), fc_moy = VALUES(fc_moy), abandon = VALUES(abandon),
           note = VALUES(note)`,
        [id, r.temps_s, r.classement ?? null, r.classement_categorie ?? null,
         r.categorie ?? null, r.partants ?? null, r.fc_moy ?? null,
         r.abandon ? 1 : 0, r.note ?? null],
      );
    } else if (c.resultat === null) {
      await cnx.execute('DELETE FROM msc_resultat WHERE competition_id = ?', [id]);
    }
    return { id };
  });
}

/**
 * Relier un start à un objectif du plan : cet objectif vise désormais cette
 * course. La semaine se recalcule depuis le début du plan — un objectif dont
 * la date change n'est plus dans la même semaine, et personne d'autre ne le
 * sait.
 */
export async function relierObjectif(athleteId, { objectif_id, competition_id }) {
  return transaction(async (cnx) => {
    const [[o]] = await cnx.execute(
      `SELECT o.id, o.plan_id, p.debut, p.athlete_id
       FROM msc_objectif o JOIN msc_plan p ON p.id = o.plan_id
       WHERE o.id = ? AND p.athlete_id = ?`,
      [Number(objectif_id), athleteId],
    );
    if (!o) throw new DepotError('Objectif inconnu.', 404);
    const [[c]] = await cnx.execute(
      'SELECT id, date FROM msc_competition WHERE id = ? AND athlete_id = ?',
      [Number(competition_id), athleteId],
    );
    if (!c) throw new DepotError('Course inconnue.', 404);
    const jours = Math.floor((Date.parse(`${c.date}T00:00:00Z`) - Date.parse(`${o.debut}T00:00:00Z`)) / 86400000);
    const semaine = Math.max(1, Math.floor(jours / 7) + 1);
    try {
      await cnx.execute(
        'UPDATE msc_objectif SET competition_id = ?, semaine = ? WHERE id = ?',
        [c.id, semaine, o.id],
      );
    } catch (e) {
      if (e?.code === 'ER_DUP_ENTRY') throw new DepotError('Un autre objectif de ce plan vise déjà cette course.', 409);
      throw e;
    }
    return { objectif_id: o.id, competition_id: c.id, semaine };
  });
}

export async function supprimerCompetition(athleteId, id) {
  const { bd } = await import('./bd.mjs');
  const [r] = await bd().execute(
    'DELETE FROM msc_competition WHERE id = ? AND athlete_id = ?', [id, athleteId],
  );
  if (r.affectedRows === 0) throw new DepotError('Compétition inconnue.', 404);
  return { id };
}

/* ------------------------------------------------------------- utilitaires */

/* L'appel a été fait dans une langue et une seule. Remplir l'autre par
   traduction automatique serait pire que la répéter : au moins la répétition
   se voit, et redemander avec l'interrupteur inversé rend la vraie. */
function deuxLangues(texte, langue, nullSiVide = false) {
  const v = texte ?? null;
  if (nullSiVide && (v === null || v === '')) return [null, null];
  return langue === 'pl' ? [v, v] : [v, v];
}

function borner(v, min, max) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : max;
}
