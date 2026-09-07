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
  };
}

async function planActif(athleteId) {
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
      `SELECT o.*, c.date, c.nom, c.distance_km
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
      nom: { fr: o.nom, pl: o.nom }, cible: L(o, 'cible'),
      role: Lnul(o, 'role') ?? { fr: '', pl: '' },
    })),
  };
}

async function leVecu(athleteId) {
  const [activites, blocs, journal, douleurs, mesures, attente] = await Promise.all([
    lignes('SELECT * FROM msc_activity WHERE athlete_id = :a ORDER BY date, id', { a: athleteId }),
    lignes(
      `SELECT b.* FROM msc_activity_bloc b JOIN msc_activity a ON a.id = b.activity_id
       WHERE a.athlete_id = :a ORDER BY b.activity_id, b.ordre`, { a: athleteId }),
    lignes('SELECT * FROM msc_journal WHERE athlete_id = :a ORDER BY date', { a: athleteId }),
    lignes(
      `SELECT d.* FROM msc_journal_douleur d JOIN msc_journal j ON j.id = d.journal_id
       WHERE j.athlete_id = :a`, { a: athleteId }),
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

  return {
    msc_activity: activites.map((a) => ({
      id_strava: Number(a.id_strava ?? a.id),
      session_id: a.session_id ?? undefined,
      date: a.date, sport: a.sport, duree_min: a.duree_min,
      allure_moy: a.allure_s_km ? formatAllure(a.allure_s_km) : undefined,
      fc_moy: nombre(a.fc_moy),
      splits_blocs: parActivite.get(a.id),
      statut: a.statut,
    })),
    msc_journal: journal.map((j) => ({
      date: j.date, session_id: j.session_id ?? 0,
      rpe_ressenti: j.rpe_ressenti ?? 0,
      sommeil: Number(j.sommeil_h ?? 0),
      douleurs: parJournal.get(j.id) ?? [],
      note: j.note ?? undefined,
    })),
    /* msc_daily n'existe plus comme table : la FC de repos vit dans les
       mesures, à côté du poids qui vient de la même photo. La forme que les
       écrans lisent, elle, ne change pas. */
    msc_daily: mesures
      .filter((m) => m.fc_repos !== null)
      .map((m) => ({ date: m.date, fc_repos: m.fc_repos })),
    msc_mesure: mesures.map((m) => ({
      date: m.date, poids_kg: nombre(m.poids_kg), fc_repos: nombre(m.fc_repos),
      source: m.source, etat: m.etat,
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
      modele: a.modele, cout_eur: Number(a.cout_eur),
      verdict: L(a, 'verdict'), stats: json(a.stats), blocs: json(a.blocs),
    })),
    /* Une zone et une part, pas des minutes et une allure : le navigateur les
       rend avec le moteur, comme il rend tout le reste. */
    msc_adaptation: adaptations.map((d) => ({
      id: d.id, analyse_id: d.analyse_id, session_id: d.session_id,
      zone: d.zone_code ?? undefined, part_duree: Number(d.part_duree),
      pourquoi: L(d, 'pourquoi'), applique: Boolean(d.applique_le),
    })),
    msc_ajustement: ajustements.map((j) => ({
      id: j.id, analyse_id: j.analyse_id,
      session_id: j.session_id ?? undefined, semaine: nombre(j.semaine),
      type: j.type_code, part: nombre(j.part), texte: Lnul(j, 'texte'),
      applique: Boolean(j.applique_le),
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
    discipline: c.discipline, distance_km: Number(c.distance_km),
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
  const parJour = new Map();
  const rpe = new Map(base.msc_journal.map((j) => [j.date, j.rpe_ressenti]));
  for (const a of base.msc_activity) {
    const charge = a.duree_min * (rpe.get(a.date) || 5);
    parJour.set(a.date, (parJour.get(a.date) ?? 0) + charge);
  }

  const jours = [...parJour.keys()].sort();
  const serieCharge = jours.map((j) => parJour.get(j) ?? 0);
  const moyenne = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

  const acwr = serieCharge.length >= 28
    ? (moyenne(serieCharge.slice(-7)) * 7) / (moyenne(serieCharge.slice(-28)) * 7)
    : null;

  const fc = base.msc_daily.map((d) => d.fc_repos);
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

  return { ...base, msc_metric: metriques(base), servi_le: new Date().toISOString() };
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
export async function ecrireJournal(athleteId, { date, session_id, rpe, sommeil, note, douleurs }, cnx) {
  const q = cnx ?? { execute: (...a) => import('./bd.mjs').then((m) => m.bd().execute(...a)) };
  const [r] = await q.execute(
    `INSERT INTO msc_journal (athlete_id, session_id, date, rpe_ressenti, sommeil_h, note)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE rpe_ressenti = VALUES(rpe_ressenti),
       sommeil_h = VALUES(sommeil_h), note = VALUES(note)`,
    [athleteId, session_id ?? null, date, rpe ?? null, sommeil ?? null, note ?? null],
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
  return { journal_id: journalId };
}

/** Le poids et la FC de repos du jour. */
export async function ecrireMesure(athleteId, { date, poids_kg, fc_repos, source, etat, note }, cnx) {
  const q = cnx ?? (await import('./bd.mjs')).bd();
  await q.execute(
    `INSERT INTO msc_mesure (athlete_id, date, poids_kg, fc_repos, source, etat, note, confirme_le)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE poids_kg = VALUES(poids_kg), fc_repos = VALUES(fc_repos),
       source = VALUES(source), etat = VALUES(etat), note = VALUES(note),
       confirme_le = VALUES(confirme_le)`,
    [athleteId, date, poids_kg ?? null, fc_repos ?? null, source ?? 'saisie',
     etat ?? 'confirme', note ?? null, (etat ?? 'confirme') === 'confirme' ? new Date() : null],
  );
  return { date };
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
export async function ecrireActivites(athleteId, activites, cnx) {
  const q = cnx ?? (await import('./bd.mjs')).bd();
  await q.execute(
    'DELETE FROM msc_activity WHERE athlete_id = ? AND id_strava IS NOT NULL', [athleteId],
  );
  let ecrites = 0;
  for (const a of activites ?? []) {
    if (!a?.id_strava) continue;
    const [r] = await q.execute(
      `INSERT INTO msc_activity (athlete_id, id_strava, session_id, date, sport, duree_min,
         allure_s_km, fc_moy, statut)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [athleteId, a.id_strava, a.session_id ?? null, a.date, a.sport, a.duree_min,
       a.allure_moy ? secondesDAllure(a.allure_moy) : null, a.fc_moy ?? null, a.statut ?? 'fait'],
    );
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

/** « 4:56/km » → 296. L'inverse de `formatAllure`. */
function secondesDAllure(allure) {
  const [min, sec] = String(allure).split('/')[0].split(':').map(Number);
  return min * 60 + (sec || 0);
}

/** Accepter ou retirer une proposition du coach. */
export async function appliquer(athleteId, table, id, applique) {
  if (table !== 'msc_adaptation' && table !== 'msc_ajustement') {
    throw new Error('table inconnue');
  }
  const { bd } = await import('./bd.mjs');
  const [r] = await bd().execute(
    `UPDATE ${table} p JOIN msc_analyse n ON n.id = p.analyse_id
     SET p.applique_le = ? WHERE p.id = ? AND n.athlete_id = ?`,
    [applique ? new Date() : null, id, athleteId],
  );
  if (r.affectedRows === 0) throw new Error('proposition inconnue');
  return { id, applique: Boolean(applique) };
}

/* ------------------------------------------------- ce que le coach produit */

/* Ce qui est stocké ici est ce que le modèle a écrit ou choisi : la prose, la
   zone, la part. Les statistiques viennent du navigateur, qui les a calculées
   avec le moteur avant de les donner à Claude pour qu'il les cite — le serveur
   range ce qu'on lui a remis, il ne recalcule rien. */

export async function enregistrerAnalyse(athleteId, { session_id, date, modele, cout_eur, strava,
  verdict, observations, stats, adaptation, suivante_id, langue = 'fr' }) {
  return transaction(async (cnx) => {
    await cnx.execute('DELETE FROM msc_analyse WHERE session_id = ?', [session_id]);
    const [r] = await cnx.execute(
      `INSERT INTO msc_analyse (athlete_id, type, session_id, date, modele, cout_eur, strava_lu,
         verdict_fr, verdict_pl, stats, blocs)
       VALUES (?, 'seance', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [athleteId, session_id, date, modele, cout_eur ?? 0, strava ? 1 : 0,
       ...deuxLangues(verdict, langue),
       stats ? JSON.stringify(stats) : null,
       observations ? JSON.stringify(observations) : null],
    );

    if (adaptation && suivante_id) {
      await cnx.execute(
        `INSERT INTO msc_adaptation (analyse_id, session_id, zone_code, part_duree, pourquoi_fr, pourquoi_pl)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [r.insertId, suivante_id, adaptation.zone ?? null,
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
        `INSERT INTO msc_chat (athlete_id, fil, ordre, role, texte, modele, cout_eur)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [athleteId, fil, ordre++, t.role, t.texte, t.modele ?? null, t.cout_eur ?? null],
      );
    }
    return { fil, tours: tours.length };
  });
}

/* --------------------------------------------- le back office : compétitions */

export async function ecrireCompetition(athleteId, c) {
  return transaction(async (cnx) => {
    let id = c.id;
    if (id) {
      const [r] = await cnx.execute(
        `UPDATE msc_competition SET date = ?, nom = ?, lieu = ?, pays = ?, discipline = ?,
           distance_km = ?, denivele_m = ?, officielle = ?, note = ?
         WHERE id = ? AND athlete_id = ?`,
        [c.date, c.nom, c.lieu ?? null, c.pays ?? null, c.discipline ?? 'Course à pied',
         c.distance_km, c.denivele_m ?? null, c.officielle === false ? 0 : 1, c.note ?? null,
         id, athleteId],
      );
      if (r.affectedRows === 0) throw new Error('compétition inconnue');
    } else {
      const [r] = await cnx.execute(
        `INSERT INTO msc_competition (athlete_id, date, nom, lieu, pays, discipline,
           distance_km, denivele_m, officielle, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [athleteId, c.date, c.nom, c.lieu ?? null, c.pays ?? null, c.discipline ?? 'Course à pied',
         c.distance_km, c.denivele_m ?? null, c.officielle === false ? 0 : 1, c.note ?? null],
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

export async function supprimerCompetition(athleteId, id) {
  const { bd } = await import('./bd.mjs');
  const [r] = await bd().execute(
    'DELETE FROM msc_competition WHERE id = ? AND athlete_id = ?', [id, athleteId],
  );
  if (r.affectedRows === 0) throw new Error('compétition inconnue');
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
