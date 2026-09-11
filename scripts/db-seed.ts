/* Charge dans MySQL les données que l'application portait en mémoire.

   C'est la preuve que le schéma tient : les 243 séances du classeur, les huit
   zones, les quatre blocs, les quatre courses et les exemples d'analyse
   entrent, ressortent, et `check:db` vérifie qu'ils ressortent identiques.

   Le script est rejouable : il vide les tables qu'il remplit avant de les
   remplir. Il ne touche jamais aux mesures, aux photos ni aux comptes Strava —
   ce sont des données de l'athlète, pas des données de départ. */

import {
  msc_athlete, msc_bloc, msc_objectif, msc_regle, msc_rpe, msc_zone,
} from '../src/data/reference';
import { msc_session, msc_week } from '../src/data/plan.generated';
import {
  msc_activity, msc_adaptation, msc_ajustement, msc_analyse, msc_daily, msc_ecart,
  msc_excuse, msc_journal, msc_metric, msc_source, msc_statut, msc_type, msc_ui,
} from '../src/data/tables';
import { bd, fermer, transaction } from '../server/bd.mjs';

/* Le classeur est le plan d'un athlète, et c'est celui-là qu'on installe. */
const ATHLETE = msc_athlete[0];
const COMPTE_EMAIL = process.env.MSC_SEED_EMAIL ?? 'sam@mysmartcoach.local';

/* argon2 n'est pas une dépendance de ce dépôt ; le compte de départ n'a pas de
   mot de passe utilisable, et c'est voulu. On en pose un au premier vrai
   déploiement, avec le hachage de l'application. */
const SANS_MOT_DE_PASSE = '!';

type Cnx = Awaited<ReturnType<ReturnType<typeof bd>['getConnection']>>;

const L = <T extends { fr: string; pl: string }>(v: T | undefined) => [v?.fr ?? null, v?.pl ?? null];

async function vider(cnx: Cnx) {
  /* Dans l'ordre inverse des dépendances. Les tables de l'athlète — mesures,
     photos, comptes Strava, mutations — ne sont pas là : elles ne sont pas des
     données de départ, et un seed qui les efface efface du réel. */
  const tables = [
    'msc_ecart', 'msc_ajustement', 'msc_adaptation', 'msc_analyse',
    'msc_activity_bloc', 'msc_activity', 'msc_journal_douleur', 'msc_journal',
    'msc_session_step', 'msc_session_zone', 'msc_session', 'msc_week',
    'msc_objectif', 'msc_resultat', 'msc_competition', 'msc_bloc', 'msc_plan',
    'msc_excuse', 'msc_regle', 'msc_metric', 'msc_source', 'msc_statut',
    'msc_rpe', 'msc_type_science', 'msc_type', 'msc_zone', 'msc_ui',
  ];
  for (const t of tables) await cnx.query(`DELETE FROM ${t}`);
}

async function vocabulaire(cnx: Cnx) {
  for (const [i, z] of msc_zone.entries()) {
    await cnx.query(
      `INSERT INTO msc_zone (code, ordre, ecart_s, icon, label_fr, label_pl, usage_fr, usage_pl)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [z.code, i, z.ecart_s, z.icon, ...L(z.label), ...L(z.usage)],
    );
  }

  for (const [i, t] of msc_type.entries()) {
    await cnx.query(
      `INSERT INTO msc_type (code, icon, couleur, ordre, label_fr, label_pl, gain_fr, gain_pl, why_fr, why_pl)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [t.code, t.icon, t.color, i, ...L(t.label), ...L(t.gain), ...L(t.why)],
    );
    for (const langue of ['fr', 'pl'] as const) {
      for (const [ordre, texte] of (t.sci[langue] ?? []).entries()) {
        await cnx.query(
          'INSERT INTO msc_type_science (type_code, langue, ordre, texte) VALUES (?, ?, ?, ?)',
          [t.code, langue, ordre, texte],
        );
      }
    }
  }

  for (const s of msc_statut) {
    await cnx.query('INSERT INTO msc_statut (code, icon, couleur) VALUES (?, ?, ?)', [
      s.code, s.icon, s.couleur,
    ]);
  }

  for (const r of msc_rpe) {
    await cnx.query(
      'INSERT INTO msc_rpe (de, a, label_fr, label_pl, quoi_fr, quoi_pl) VALUES (?, ?, ?, ?, ?, ?)',
      [r.de, r.a, ...L(r.label), ...L(r.quoi)],
    );
  }

  for (const [i, e] of msc_excuse.entries()) {
    await cnx.query(
      `INSERT INTO msc_excuse (code, icon, type_code, session_exemple, ordre,
         label_fr, label_pl, reponse_fr, reponse_pl, remplacement_fr, remplacement_pl)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [e.code, e.icon, e.type, e.session_id ?? null, i, ...L(e.label), ...L(e.reponse), ...L(e.remplacement)],
    );
  }

  for (const [i, r] of msc_regle.entries()) {
    await cnx.query(
      `INSERT INTO msc_regle (code, signal_code, operateur, seuil, jours, gravite, ordre, effet,
         si_fr, si_pl, alors_fr, alors_pl, pourquoi_fr, pourquoi_pl)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [r.code, r.signal, r.op, r.seuil, r.jours ?? null, r.gravite, i, JSON.stringify(r.effet),
       ...L(r.si), ...L(r.alors), ...L(r.pourquoi)],
    );
  }

  for (const [i, m] of msc_metric.entries()) {
    /* `valeur` et `serie` ne sont pas repris : ils se calculent depuis les
       activités et le journal, et une copie en base est une copie qui dérive. */
    await cnx.query(
      `INSERT INTO msc_metric (code, icon, couleur, ordre, seuil, nom_fr, nom_pl, formule_fr, formule_pl)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [m.code, m.icon, m.couleur, i, m.seuil ?? null, ...L(m.nom), ...L(m.formule)],
    );
  }

  const s = msc_source[0];
  await cnx.query(
    `INSERT INTO msc_source (code, canal,
       titre_absent_fr, titre_absent_pl, sous_absent_fr, sous_absent_pl,
       titre_off_fr, titre_off_pl, sous_off_fr, sous_off_pl,
       titre_liaison_fr, titre_liaison_pl, sous_liaison_fr, sous_liaison_pl,
       titre_on_fr, titre_on_pl, sous_on_fr, sous_on_pl,
       sous_synchro_fr, sous_synchro_pl, jamais_fr, jamais_pl,
       webhook_on_fr, webhook_on_pl, webhook_off_fr, webhook_off_pl,
       orphelines_fr, orphelines_pl, delier_fr, delier_pl)
     VALUES (${new Array(30).fill('?').join(', ')})`,
    [s.code, s.canal, ...L(s.titre_absent), ...L(s.sous_absent), ...L(s.titre_off), ...L(s.sous_off),
     ...L(s.titre_liaison), ...L(s.sous_liaison), ...L(s.titre_on), ...L(s.sous_on),
     ...L(s.sous_synchro), ...L(s.jamais), ...L(s.webhook_on), ...L(s.webhook_off),
     ...L(s.orphelines), ...L(s.delier)],
  );

  for (const langue of ['fr', 'pl'] as const) {
    await cnx.query('INSERT INTO msc_ui (langue, chaines) VALUES (?, ?)', [
      langue, JSON.stringify(msc_ui[langue]),
    ]);
  }
}

async function athlete(cnx: Cnx): Promise<number> {
  const [existant] = (await cnx.query('SELECT id FROM compte WHERE email = ?', [COMPTE_EMAIL])) as any;
  let compteId: number = existant[0]?.id;
  if (!compteId) {
    const [r] = (await cnx.query(
      'INSERT INTO compte (email, mot_de_passe, nom, role) VALUES (?, ?, ?, ?)',
      [COMPTE_EMAIL, SANS_MOT_DE_PASSE, ATHLETE.nom, 'athlete'],
    )) as any;
    compteId = r.insertId;
  }

  const [deja] = (await cnx.query('SELECT id FROM msc_athlete WHERE compte_id = ?', [compteId])) as any;
  if (deja[0]?.id) return deja[0].id;

  const [r] = (await cnx.query(
    `INSERT INTO msc_athlete (compte_id, nom, ref_actuelle_s, ref_cible_s, fc_repos, fc_repos_moy7,
       fc_moy_reference, derive_reference_pct, plancher_heures, plancher_km_sortie, debut, note_fr, note_pl)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [compteId, ATHLETE.nom, ATHLETE.ref_actuelle_s, ATHLETE.ref_cible_s, ATHLETE.fc_repos,
     ATHLETE.fc_repos_moy7, ATHLETE.fc_moy_reference, ATHLETE.derive_reference_pct,
     ATHLETE.plancher_heures, ATHLETE.plancher_km_sortie, ATHLETE.debut, ...L(ATHLETE.note)],
  )) as any;
  const athleteId = r.insertId;
  await cnx.query(
    "INSERT INTO msc_acces (compte_id, athlete_id, droit) VALUES (?, ?, 'ecriture')",
    [compteId, athleteId],
  );
  return athleteId;
}

async function plan(cnx: Cnx, athleteId: number) {
  const dates = msc_session.map((s) => s.date).sort();
  const [r] = (await cnx.query(
    `INSERT INTO msc_plan (athlete_id, nom, origine, debut, fin, actif)
     VALUES (?, ?, 'classeur', ?, ?, 1)`,
    [athleteId, 'Plan 30 semaines — semi, 10 km, Hyrox, natation', dates[0], dates[dates.length - 1]],
  )) as any;
  const planId: number = r.insertId;

  const blocs = new Map<string, number>();
  for (const b of msc_bloc) {
    const [rb] = (await cnx.query(
      `INSERT INTO msc_bloc (plan_id, code, part, nature, semaine_de, semaine_a, nom_fr, nom_pl, focus_fr, focus_pl)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [planId, b.code, b.part, b.nature, b.de, b.a, ...L(b.nom), ...L(b.quoi)],
    )) as any;
    blocs.set(b.code, rb.insertId);
  }

  for (const w of msc_week) {
    await cnx.query(
      `INSERT INTO msc_week (plan_id, semaine, bloc_id, phase, heures, km, natation_m, charge)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [planId, w.semaine, blocs.get(w.bloc), w.phase, w.heures, w.km ?? null,
       (w as { natation_m?: number }).natation_m ?? null, (w as { charge?: number }).charge ?? null],
    );
  }

  /* Une course appartient à l'athlète ; l'objectif est ce que ce plan en vise.
     C'est cette séparation qui laisse les résultats survivre au plan. */
  for (const o of msc_objectif) {
    const [rc] = (await cnx.query(
      `INSERT INTO msc_competition (athlete_id, date, nom, discipline, distance_km, officielle)
       VALUES (?, ?, ?, 'Course à pied', ?, 1)`,
      [athleteId, o.date, o.nom.fr, o.distance_km],
    )) as any;
    await cnx.query(
      `INSERT INTO msc_objectif (plan_id, competition_id, semaine, principal, cible_s, cible_haute_s,
         cible_fr, cible_pl, role_fr, role_pl)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [planId, rc.insertId, o.semaine, o.principal ? 1 : 0, o.cible_s, o.cible_haute_s,
       ...L(o.cible), ...L(o.role)],
    );
  }

  /* Les identifiants du classeur sont conservés : les analyses, les excuses et
     les exemples y renvoient, et les renuméroter les casserait tous. */
  const parJour = new Map<string, number>();
  for (const s of msc_session) {
    const ordre = parJour.get(s.date) ?? 0;
    parJour.set(s.date, ordre + 1);
    await cnx.query(
      `INSERT INTO msc_session (id, plan_id, semaine, bloc_id, date, ordre, jour_long, jour_fr, jour_pl,
         phase, discipline, type_code, duree_min, rpe_cible, charge, distance_km, natation_m,
         titre_fr, titre_pl, titre_court_fr, titre_court_pl, meta_fr, meta_pl,
         detail_fr, detail_pl, consigne_fr, consigne_pl, but_fr, but_pl, reussite_fr, reussite_pl)
       VALUES (${new Array(31).fill('?').join(', ')})`,
      [s.id, planId, s.semaine, blocs.get(s.bloc), s.date, ordre, s.jour_long, ...L(s.jour),
       s.phase, s.discipline, s.type, s.duree_min, s.rpe_cible, s.charge,
       s.distance_km ?? null, s.natation_m ?? null,
       ...L(s.titre), ...L(s.titre_court), ...L(s.meta), ...L(s.detail),
       ...L(s.consigne), ...L(s.but), ...L(s.reussite)],
    );
    for (const [ordreZone, zone] of s.zones.entries()) {
      await cnx.query(
        'INSERT INTO msc_session_zone (session_id, zone_code, ordre) VALUES (?, ?, ?)',
        [s.id, zone, ordreZone],
      );
    }
  }

  return planId;
}

async function vecu(cnx: Cnx, athleteId: number) {
  for (const a of msc_activity) {
    const [r] = (await cnx.query(
      `INSERT INTO msc_activity (athlete_id, id_strava, session_id, date, sport, duree_min,
         allure_s_km, fc_moy, statut)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [athleteId, a.id_strava, a.session_id ?? null, a.date, a.sport, a.duree_min,
       a.allure_moy ? secondesDAllure(a.allure_moy) : null, a.fc_moy ?? null, a.statut],
    )) as any;
    for (const [ordre, allure] of (a.splits_blocs ?? []).entries()) {
      await cnx.query(
        'INSERT INTO msc_activity_bloc (activity_id, ordre, allure_s_km) VALUES (?, ?, ?)',
        [r.insertId, ordre, allure],
      );
    }
  }

  for (const j of msc_journal) {
    const [r] = (await cnx.query(
      `INSERT INTO msc_journal (athlete_id, session_id, date, rpe_ressenti, sommeil_h)
       VALUES (?, ?, ?, ?, ?)`,
      [athleteId, j.session_id ?? null, j.date, j.rpe_ressenti, j.sommeil ?? null],
    )) as any;
    for (const d of j.douleurs ?? []) {
      await cnx.query('INSERT INTO msc_journal_douleur (journal_id, douleur) VALUES (?, ?)', [
        r.insertId, d,
      ]);
    }
  }

  /* msc_daily ne portait que la FC de repos ; msc_mesure la porte avec le poids
     et la photo dont elle vient. La reprise est un INSERT … ON DUPLICATE parce
     que le seed est rejouable et que les mesures, elles, ne sont pas vidées. */
  for (const d of msc_daily) {
    await cnx.query(
      `INSERT INTO msc_mesure (athlete_id, date, fc_repos, source, etat)
       VALUES (?, ?, ?, 'import', 'confirme')
       ON DUPLICATE KEY UPDATE fc_repos = VALUES(fc_repos)`,
      [athleteId, d.date, d.fc_repos],
    );
  }
}

function secondesDAllure(allure: string): number {
  const [min, sec] = allure.split('/')[0].split(':').map(Number);
  return min * 60 + (sec || 0);
}

async function coach(cnx: Cnx, athleteId: number, planId: number) {
  const ids = new Map<number, number>();
  for (const a of msc_analyse) {
    const [r] = (await cnx.query(
      `INSERT INTO msc_analyse (athlete_id, type, session_id, plan_id, semaine, date, modele,
         cout_eur, verdict_fr, verdict_pl, stats, blocs)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [athleteId, a.type, a.session_id ?? null, a.type === 'hebdo' ? planId : null,
       a.semaine ?? null, a.date, a.modele, a.cout_eur, ...L(a.verdict),
       a.stats ? JSON.stringify(a.stats) : null, a.blocs ? JSON.stringify(a.blocs) : null],
    )) as any;
    ids.set(a.id, r.insertId);
  }

  /* La graine porte maintenant ce que la base garde : une zone et une part.
     Plus rien à convertir — le rendu se fait dans le navigateur, avec le
     moteur, donc « 45 min · 6:20/km » n'existe qu'à l'écran. */
  for (const ad of msc_adaptation) {
    await cnx.query(
      `INSERT INTO msc_adaptation (analyse_id, session_id, zone_code, part_duree, pourquoi_fr, pourquoi_pl)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [ids.get(ad.analyse_id), ad.session_id, ad.zone ?? null, ad.part_duree, ...L(ad.pourquoi)],
    );
  }

  for (const aj of msc_ajustement) {
    await cnx.query(
      `INSERT INTO msc_ajustement (analyse_id, session_id, semaine, type_code, part, texte_fr, texte_pl)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [ids.get(aj.analyse_id), aj.session_id ?? null, aj.semaine ?? null, aj.type,
       aj.part ?? null, ...L(aj.texte)],
    );
  }

  for (const e of msc_ecart) {
    const hebdo = msc_analyse.find((a) => a.type === 'hebdo' && a.semaine === e.semaine);
    if (!hebdo) continue;
    await cnx.query(
      `INSERT INTO msc_ecart (analyse_id, plan_id, semaine, texte_fr, texte_pl, recalcul)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [ids.get(hebdo.id), planId, e.semaine, ...L(e.texte), JSON.stringify(e.recalcul)],
    );
  }
}

await transaction(async (cnx) => {
  await cnx.query('SET FOREIGN_KEY_CHECKS = 0');
  await vider(cnx as Cnx);
  await cnx.query('SET FOREIGN_KEY_CHECKS = 1');

  await vocabulaire(cnx as Cnx);
  const athleteId = await athlete(cnx as Cnx);
  const planId = await plan(cnx as Cnx, athleteId);
  await vecu(cnx as Cnx, athleteId);
  await coach(cnx as Cnx, athleteId, planId);

  console.log(
    `athlète ${athleteId} · plan ${planId} · ${msc_session.length} séances · ` +
      `${msc_week.length} semaines · ${msc_objectif.length} courses`,
  );
});

await fermer();
