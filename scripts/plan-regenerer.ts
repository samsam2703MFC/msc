/* Régénérer le plan d'un athlète, côté serveur.

   Le générateur vit dans `src/data/generateur.ts`, donc dans le navigateur :
   c'est là que le coach compose un plan, le regarde, puis l'enregistre. Mais
   il n'a besoin de rien du navigateur — ni DOM, ni réseau —, alors on
   l'empaquette avec ce fichier et le serveur peut faire le même geste sans
   qu'on soit devant l'écran. Le paquet part avec le déploiement, comme celui
   du classeur : la machine de production reste sans outil de build.

   Ce que ça lit : l'athlète (ses deux références, sa date de début), sa
   semaine type, et ses courses à venir — celles qui portent un chrono visé
   sont ses objectifs, celle qui porte la couronne termine le plan. Autrement
   dit exactement ce que l'écran lit, par le même instantané.

   Ce que ça écrit : un plan actif de plus. L'ancien n'est pas supprimé — ses
   séances restent, et le journal comme les activités qui les visent avec. */

import { genererPlan } from '../src/data/generateur';
import type { Contraintes, Objectif, ProfilAthlete } from '../src/data/generateur';
import type { MscStructure } from '../src/data/types';
// @ts-expect-error — le dépôt est en JS, et c'est lui qui parle à la base.
import * as depots from '../server/depots.mjs';

export interface Reglages {
  reamorcage_semaines?: number;
  affutage_semaines?: number;
  montagne_toutes_les?: number;
  /** Le nom du plan écrit en base. Sinon : celui de l'objectif principal. */
  nom?: string;
}

export interface Resultat {
  plan_id?: number;
  seances: number;
  semaines: number;
  periodes: string;
  avertissements: string[];
}

/** Ce qui empêche de régénérer, dit en une phrase — ou rien. */
export function ceQuiManque(base: {
  msc_athlete: Array<{ debut: string; ref_actuelle_s: number; ref_cible_s: number }>;
  msc_competition: Array<{ date: string; cible_s?: number; principal?: boolean }>;
}): string | null {
  const a = base.msc_athlete[0];
  if (!a) return 'aucun athlète';
  const principal = base.msc_competition.find((c) => c.principal);
  if (!principal) return 'aucun objectif principal';
  if (principal.date <= a.debut) return `l’objectif principal (${principal.date}) précède le début du plan (${a.debut})`;
  return null;
}

/** Régénère et enregistre. Rend ce que le plan contient, ou lève. */
export async function regenererPlan(athleteId: number, reglages: Reglages = {}): Promise<Resultat> {
  const base = await depots.instantane(athleteId);
  const manque = ceQuiManque(base);
  if (manque) throw new Error(manque);

  const a = base.msc_athlete[0];
  const athlete: ProfilAthlete = {
    nom: a.nom,
    ref_actuelle_s: Number(a.ref_actuelle_s),
    ref_cible_s: Number(a.ref_cible_s),
    debut: a.debut,
  };

  /* La semaine type commande le squelette — les jours, les sports, les types —
     et son total dit ce que pèse une semaine normale chez lui. Sans elle, le
     plancher du profil, et le squelette par défaut. */
  const structure = (base.msc_structure ?? []) as MscStructure[];
  const posees = structure.reduce((t, c) => t + (c.duree_min ?? 45), 0) / 60;

  const contraintes: Contraintes = {
    plancher_heures: posees > 0 ? Math.max(Math.round(posees * 2) / 2, 1) : Number(a.plancher_heures ?? 8),
    plancher_km_sortie: Number(a.plancher_km_sortie ?? 10),
    reamorcage_semaines: reglages.reamorcage_semaines ?? 6,
    affutage_semaines: reglages.affutage_semaines ?? 3,
    natation: true,
    velo: true,
    salle: true,
    montagne_toutes_les: reglages.montagne_toutes_les ?? 3,
  };

  /* Ses objectifs : les courses à venir qui portent un chrono visé, plus celle
     qui porte la couronne même si son chrono manque — c'est elle qui donne la
     date de fin, et un bloc peut viser une date sans viser une allure. */
  const objectifs: Objectif[] = base.msc_competition
    .filter((c: any) => c.date > athlete.debut && ((c.cible_s ?? 0) > 0 || c.principal))
    .sort((x: any, y: any) => x.date.localeCompare(y.date))
    .map((c: any) => ({
      competition_id: c.id,
      date: c.date,
      nom: c.nom,
      type_course: c.type_course,
      discipline: c.discipline,
      cible_s: c.cible_s ?? 0,
      cible_haute_s: c.cible_haute_s,
      parties: c.parties,
      distance_km: Number(c.distance_km),
      principal: !!c.principal,
    }));

  const plan = genererPlan(athlete, objectifs, contraintes, structure);
  const principal = objectifs.find((o) => o.principal);

  const ecrit = await depots.enregistrerPlan(athleteId, {
    nom: reglages.nom ?? `${principal?.nom ?? athlete.nom} — régénéré`,
    athlete: { ref_actuelle_s: athlete.ref_actuelle_s, ref_cible_s: athlete.ref_cible_s, debut: athlete.debut },
    blocs: plan.blocs,
    semaines: plan.semaines,
    sessions: plan.sessions,
    objectifs,
    origine: 'genere',
  });

  return {
    plan_id: ecrit?.plan_id,
    seances: plan.sessions.length,
    semaines: plan.semaines.length,
    periodes: plan.blocs.map((b) => `${b.nature} S${b.de}–S${b.a}`).join(' · '),
    avertissements: plan.avertissements,
  };
}

/* Lancé à la main : `npm run plan:regenerer -- 1`, ou le nom de l'athlète. */
if (process.argv[1] && /plan-regenerer/.test(process.argv[1])) {
  const qui = process.argv[2];
  if (!qui) {
    console.error('usage : plan-regenerer <id ou nom de l’athlète> [semaines d’affûtage]');
    process.exit(2);
  }
  const id = /^\d+$/.test(qui)
    ? Number(qui)
    : await (async () => {
      const { bd } = await import('../server/bd.mjs' as string);
      const [[a]] = await bd().execute('SELECT id FROM msc_athlete WHERE nom = ?', [qui]);
      if (!a) throw new Error(`athlète « ${qui} » inconnu`);
      return a.id as number;
    })();
  const r = await regenererPlan(id, {
    affutage_semaines: process.argv[3] ? Number(process.argv[3]) : undefined,
  });
  console.log(`plan #${r.plan_id} · ${r.seances} séances · ${r.semaines} semaines`);
  console.log(`  ${r.periodes}`);
  for (const av of r.avertissements) console.log(`  ⚠ ${av}`);
  process.exit(0);
}
