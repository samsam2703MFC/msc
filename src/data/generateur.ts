/* The plan generator.

   Given an athlete, their objectives and their constraints, this produces the
   whole plan — blocks, weeks, sessions — with no call to anything. It is the
   deterministic half of the mechanic: every number here can be traced to a rule,
   which is what makes the plan auditable and reproducible.

   The rules were read off the reference plan rather than invented:

     Périodisation inverse   the plan is counted back from the A-race date; each
                             intermediate objective closes a block.
     Référence de bloc       a block's 10 km reference is the target of the race
                             that ends it. That is where `part` comes from.
     Volume                  +6 %/semaine inside a block, ×0,80 on the fourth
                             (décharge), ×0,55 on a race week, never below the
                             athlete's floor except on race weeks.
     Qualité                 one quality run a week, and never within 48 h of
                             another hard run — the long run sits three days
                             after it.
     Planchers               the weekly hours floor and the per-run distance
                             floor both hold; volume that will not fit into runs
                             goes to the bike, which costs nothing tendon-wise.

   Claude's part is the session *content* (see ./methode); it never sets a pace
   or a volume. */

import { DEFICITS_DEFAUT, comparableAuDixKm, referenceAPied } from './courses';
import type { Deficits } from './courses';
import { formatAllure, param } from './engine';
import { zonesDuType } from './structure';
import type {
  Localized,
  MscBloc,
  MscPlanSession,
  MscPlanWeek,
  MscStructure,
  TypeCode,
  ZoneCode,
} from './types';

const l = (s: string): Localized => ({ fr: s, pl: s });

const JOURS_FR = ['LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM'];
const JOURS_PL = ['PON', 'WT', 'ŚR', 'CZW', 'PT', 'SOB', 'ND'];
const JOURS_LONG = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

/* Volume shaping. */
const RAMPE = 1.06; //  +6 % per week inside a block
const DECHARGE = 0.8; //  every fourth week
const SEMAINE_COURSE = 0.55; //  a race week carries the race, not the volume
const CADENCE_DECHARGE = 4;

/** Hours between two hard runs. Below this the second one is not training. */
const ECART_QUALITE_H = 48;

/** Riegel's endurance exponent: T2 = T1 × (D2/D1)^1.06.
    A race target is only comparable to the plan's 10 km reference once it has
    been converted to its 10 km equivalent — a half-marathon pace is slower than
    a 10 km pace for the same fitness, and treating it as one makes the block
    reference far too easy. */
const RIEGEL = 1.06;

/** The 10 km-equivalent pace, in seconds per km, of a target over any distance. */
export function equivalent10k(cible_s: number, distance_km: number): number {
  if (distance_km === 10) return cible_s / 10;
  return (cible_s * Math.pow(10 / distance_km, RIEGEL)) / 10;
}

export interface Objectif {
  date: string;
  nom: string;
  /** Le type du catalogue (`courses.ts`) : il donne la distance, et dit si le
      chrono se ramène à une allure 10 km. */
  type_course?: string;
  discipline?: string;
  /** Un enchaînement : le chrono visé pour chaque partie. La partie course,
      corrigée du déficit, est ce qui règle l'allure du bloc. */
  parties?: Array<{ discipline: string; cible_s: number }>;
  /** The fast end of the target range, in seconds. */
  cible_s: number;
  /** The slow end. Optional — without it the fast end is used on its own. */
  cible_haute_s?: number;
  distance_km: number;
  principal: boolean;
}

/** The time a block should be built around.

    An intermediate race is a checkpoint, so the block that leads to it is built
    around the middle of its range — training to the optimistic end of a
    checkpoint makes every session in the block slightly too fast, which is the
    expensive direction to be wrong in. The main objective is the goal itself,
    so its block is built around the fast end. */
export function tempsDeReference(o: Objectif): number {
  if (o.principal || o.cible_haute_s === undefined) return o.cible_s;
  return (o.cible_s + o.cible_haute_s) / 2;
}

export interface Contraintes {
  /** Weekly volume floor, in hours. */
  plancher_heures: number;
  /** Distance floor per run, in km. */
  plancher_km_sortie: number;
  /** Weeks of easy rebuilding before the first quality session. */
  reamorcage_semaines: number;
  /** Disciplines available besides running. */
  natation: boolean;
  velo: boolean;
  salle: boolean;
  /** A mountain long run every N weeks, 0 to switch it off. */
  montagne_toutes_les: number;
}

export interface ProfilAthlete {
  nom: string;
  /** Current 10 km pace, seconds per km. */
  ref_actuelle_s: number;
  /** Target 10 km pace, seconds per km. */
  ref_cible_s: number;
  debut: string;
}

export interface PlanGenere {
  blocs: MscBloc[];
  semaines: MscPlanWeek[];
  sessions: MscPlanSession[];
  /** Anything the generator had to bend, so it is never silent. */
  avertissements: string[];
}

/* ------------------------------------------------------------------- dates */

const JOUR_MS = 86_400_000;

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function ajouter(dateISO: string, jours: number): string {
  return iso(new Date(Date.parse(dateISO) + jours * JOUR_MS));
}

/** Monday of the week containing `dateISO`. */
function lundi(dateISO: string): string {
  const d = new Date(dateISO);
  const decalage = (d.getUTCDay() + 6) % 7;
  return ajouter(dateISO, -decalage);
}

function semainesEntre(aISO: string, bISO: string): number {
  return Math.round((Date.parse(bISO) - Date.parse(aISO)) / (7 * JOUR_MS));
}

/* ------------------------------------------------------- périodisation */

/** Blocks run from the start to each objective; the A-race closes the last. */
export function periodiser(
  athlete: ProfilAthlete,
  objectifs: Objectif[],
  contraintes: Contraintes,
): { blocs: MscBloc[]; semaines_total: number; avertissements: string[] } {
  const avertissements: string[] = [];
  const tries = [...objectifs].sort((a, b) => a.date.localeCompare(b.date));
  const principal = tries.find((o) => o.principal) ?? tries[tries.length - 1];
  if (!principal) throw new Error('periodiser: aucun objectif');

  const depart = lundi(athlete.debut);
  const total = semainesEntre(depart, lundi(principal.date)) + 1;
  if (total < 8) {
    avertissements.push(
      `Seulement ${total} semaines jusqu'à l'objectif : trop court pour une préparation complète.`,
    );
  }

  const ecart = athlete.ref_actuelle_s - athlete.ref_cible_s;
  /** A block's reference is the target of the race that ends it. */
  const partDe = (cible_s: number) => (ecart === 0 ? 1 : (athlete.ref_actuelle_s - cible_s) / ecart);

  const blocs: MscBloc[] = [];
  const codes = ['A', 'B', 'C', 'D', 'E', 'F'];

  /* Block A is the rebuild: no pace is imposed, so it sits at the current
     reference whatever the first race asks for. */
  const finA = Math.min(contraintes.reamorcage_semaines, total);
  blocs.push({
    code: codes[0],
    de: 1,
    a: finA,
    part: 0,
    nom: l('Réamorçage'),
    quoi: l("Reconstruire avant de travailler. Aucune allure imposée avant le test."),
  });

  let curseur = finA + 1;
  tries.forEach((o, i) => {
    const fin = Math.min(semainesEntre(depart, lundi(o.date)) + 1, total);
    if (fin < curseur) {
      avertissements.push(`« ${o.nom} » tombe pendant le réamorçage : bloc ignoré.`);
      return;
    }
    /* Une course à pied donne son allure directement. Un enchaînement la
       donne par sa partie course, corrigée du déficit — courir après le vélo
       est plus lent que la même distance à sec, et le pour cent se règle dans
       le back office. Une cyclo ou une nage, elles, ne disent rien d'une
       allure : le bloc vise la date. */
    const deficits: Deficits = {
      natation: param('multi.deficit_natation_pct', DEFICITS_DEFAUT.natation ?? 5),
      velo: param('multi.deficit_velo_pct', DEFICITS_DEFAUT.velo ?? 6),
      cap: param('multi.deficit_cap_pct', DEFICITS_DEFAUT.cap ?? 8),
    };
    const ref = referenceAPied(o, tempsDeReference(o), deficits);
    const allureCible = ref ? equivalent10k(ref.temps_s, ref.distance_km) : null;
    const partPrecedente = blocs.length > 0 ? blocs[blocs.length - 1].part : 0;
    if (!ref) {
      avertissements.push(
        comparableAuDixKm(o.type_course)
          ? `« ${o.nom} » n’est pas une course à pied : le bloc vise la date, pas une allure.`
          : `« ${o.nom} » : sans chrono visé sur la partie course, le bloc vise la date, pas une allure.`,
      );
    }
    blocs.push({
      code: codes[blocs.length] ?? `B${i}`,
      de: curseur,
      a: fin,
      part: allureCible === null
        ? Math.min(Math.max(partPrecedente, 0), 1)
        : Math.min(Math.max(partDe(allureCible), 0), 1),
      nom: l(o.principal ? 'Bloc final' : `Vers ${o.nom}`),
      quoi: l(allureCible === null
        ? `${o.nom} le ${o.date} — préparation spécifique, sans allure de référence.`
        : ref && ref.distance_km !== o.distance_km
          ? `${o.nom} le ${o.date} — partie course ramenée à sec : référence ${formatAllure(allureCible)}.`
          : `${o.nom} le ${o.date} — référence ${formatAllure(allureCible)}.`),
    });
    curseur = fin + 1;
  });

  /* A block shorter than two weeks cannot carry a training effect; fold it into
     the one before it and say so. */
  const fusionnes: MscBloc[] = [];
  for (const b of blocs) {
    const precedent = fusionnes[fusionnes.length - 1];
    if (precedent && b.a - b.de + 1 < 2) {
      avertissements.push(
        `« ${b.nom.fr} » ne durait qu'une semaine : fondu dans « ${precedent.nom.fr} ».`,
      );
      precedent.a = b.a;
      precedent.part = b.part;
      continue;
    }
    fusionnes.push(b);
  }

  return { blocs: fusionnes, semaines_total: total, avertissements };
}

/* ------------------------------------------------------------------ volume */

/** Hours per week: ramp inside the block, deload every fourth, drop for races. */
export function courbeVolume(
  semaines: number,
  contraintes: Contraintes,
  semainesDeCourse: ReadonlySet<number>,
  reamorcage: number,
): number[] {
  const plancher = contraintes.plancher_heures;
  const out: number[] = [];

  for (let s = 1; s <= semaines; s++) {
    if (semainesDeCourse.has(s)) {
      out.push(Math.round(plancher * SEMAINE_COURSE * 10) / 10);
      continue;
    }

    let heures: number;
    if (s <= reamorcage) {
      /* Rebuild ramps from just over half the floor up to it. */
      const part = reamorcage <= 1 ? 1 : (s - 1) / (reamorcage - 1);
      heures = plancher * (0.55 + 0.45 * part);
    } else {
      const precedent = out[s - 2] ?? plancher;
      heures = Math.max(precedent * RAMPE, plancher);
    }

    if (s % CADENCE_DECHARGE === 0) heures *= DECHARGE;
    out.push(Math.round(Math.max(heures, s <= reamorcage ? 0 : plancher) * 10) / 10);
  }
  return out;
}

/* --------------------------------------------------------------- séances */

type Creneau = {
  /** 0 = Monday. */
  jour: number;
  discipline: string;
  type: TypeCode;
  zones: ZoneCode[];
  /** Share of the week's minutes this slot takes. */
  part: number;
  /** Hard runs, for the 48 h check. */
  dur?: boolean;
};

/* Les types qui comptent comme « durs » : deux d'entre eux ne doivent pas se
   toucher à moins de 48 h, et c'est ce drapeau qui le dit. */
const DURS_STRUCTURE = new Set<TypeCode>(['seuil', 'allure10', 'vma', 'longue', 'montagne', 'test']);

/** The week's shape. Quality on Wednesday, long run on Saturday: 72 h apart.

    Quand l'athlète a une semaine type (`msc_structure`), c'est elle qui
    commande : chaque créneau garde son jour, son sport et son type, et sa
    durée habituelle devient sa part du volume. Le squelette ci-dessous ne sert
    plus qu'aux athlètes qui n'en ont pas encore posé une. */
function creneaux(contraintes: Contraintes, qualite: TypeCode, structure?: MscStructure[]): Creneau[] {
  if (structure?.length) {
    const total = structure.reduce((t, c) => t + (c.duree_min ?? 45), 0) || 1;
    return structure
      .slice()
      .sort((a, b) => a.jour - b.jour || a.creneau - b.creneau)
      .map((c) => ({
        jour: c.jour,
        discipline: c.discipline,
        type: c.type_code,
        zones: zonesDuType(c.type_code, c.discipline),
        part: (c.duree_min ?? 45) / total,
        dur: c.discipline === 'Course à pied' && DURS_STRUCTURE.has(c.type_code),
      }));
  }
  const out: Creneau[] = [];
  if (contraintes.salle) {
    out.push({ jour: 0, discipline: 'Hyrox', type: 'force', zones: [], part: 0.16 });
  }
  if (contraintes.natation) {
    out.push({ jour: 1, discipline: 'Natation', type: 'nage', zones: [], part: 0.12 });
  }
  if (contraintes.velo) {
    out.push({ jour: 1, discipline: 'Vélo', type: 'velo', zones: [], part: 0.1 });
  }
  out.push({
    jour: 2,
    discipline: 'Course à pied',
    type: qualite,
    zones: qualite === 'ef' ? ['ef'] : ['ef', qualite as ZoneCode],
    part: 0.14,
    dur: qualite !== 'ef',
  });
  if (contraintes.salle) {
    out.push({ jour: 3, discipline: 'Hyrox', type: 'compromis', zones: [], part: 0.13 });
  }
  if (contraintes.natation) {
    out.push({ jour: 4, discipline: 'Natation', type: 'nage', zones: [], part: 0.09 });
  }
  out.push({
    jour: 4,
    discipline: 'Course à pied',
    type: 'recup',
    zones: ['recup'],
    part: 0.1,
  });
  out.push({
    jour: 5,
    discipline: 'Course à pied',
    type: 'longue',
    zones: ['ef'],
    part: 0.16,
    dur: true,
  });
  out.push({ jour: 6, discipline: 'Repos', type: 'repos', zones: [], part: 0 });
  return out;
}

/** Which quality session a block calls for. */
function qualiteDuBloc(indexBloc: number, semaineDansBloc: number): TypeCode {
  if (indexBloc === 0) return 'ef'; //  rebuild: no quality yet
  if (indexBloc === 1) return 'seuil'; //  build: threshold is the best value
  /* Speed blocks alternate race pace and VO2max. */
  return semaineDansBloc % 3 === 2 ? 'vma' : 'allure10';
}

/** The session types that count as hard for the 48 h rule. */
const DURS = new Set<TypeCode>(['seuil', 'allure10', 'vma', 'longue', 'montagne', 'course', 'test']);

/** RPE by type — the workbook's own scale. */
const RPE: Record<string, number> = {
  repos: 0, recup: 3, ef: 3, nage: 5, velo: 4, force: 5, compromis: 5,
  longue: 5, seuil: 7, allure10: 8, vma: 8, montagne: 7, test: 9, course: 10,
};

export function genererPlan(
  athlete: ProfilAthlete,
  objectifs: Objectif[],
  contraintes: Contraintes,
  /* La semaine type de l'athlète. Absente, le squelette par défaut s'applique
     — c'est ce qui se passait avant qu'elle existe. */
  structure?: MscStructure[],
): PlanGenere {
  const { blocs, semaines_total, avertissements } = periodiser(athlete, objectifs, contraintes);
  const depart = lundi(athlete.debut);

  const semaineDe = (dateISO: string) => semainesEntre(depart, lundi(dateISO)) + 1;
  const semainesDeCourse = new Set(objectifs.map((o) => semaineDe(o.date)));
  const volumes = courbeVolume(
    semaines_total,
    contraintes,
    semainesDeCourse,
    contraintes.reamorcage_semaines,
  );

  const blocDe = (s: number) => blocs.find((b) => s >= b.de && s <= b.a) ?? blocs[blocs.length - 1];

  const sessions: MscPlanSession[] = [];
  const semaines: MscPlanWeek[] = [];
  let id = 1;

  for (let s = 1; s <= semaines_total; s++) {
    const bloc = blocDe(s);
    const indexBloc = blocs.indexOf(bloc);
    const minutes = Math.round(volumes[s - 1] * 60);
    const course = objectifs.find((o) => semaineDe(o.date) === s);
    const estMontagne =
      contraintes.montagne_toutes_les > 0 && s % contraintes.montagne_toutes_les === 0;

    const grille = creneaux(contraintes, qualiteDuBloc(indexBloc, s - bloc.de), structure);
    const totalPart = grille.reduce((t, c) => t + c.part, 0);

    for (const creneau of grille) {
      const date = ajouter(depart, (s - 1) * 7 + creneau.jour);

      /* The race replaces whatever the template had that day. */
      const estJourDeCourse = course ? date === course.date : false;

      /* Nothing hard inside 48 h of a race: the day before is rest, and the
         long run does not get to eat the race. */
      const heuresAvantCourse = course
        ? (Date.parse(course.date) - Date.parse(date)) / 3_600_000
        : Infinity;
      const veilleDeCourse =
        !estJourDeCourse && heuresAvantCourse > 0 && heuresAvantCourse < ECART_QUALITE_H;

      const type: TypeCode = estJourDeCourse
        ? 'course'
        : veilleDeCourse && DURS.has(creneau.type)
          ? 'repos'
          : creneau.type === 'longue' && estMontagne
            ? 'montagne'
            : creneau.type;

      if (type === 'repos' && !estJourDeCourse) {
        sessions.push(
          seance(
            id++, s, bloc, date, creneau, 'repos', 0, [], contraintes,
            l(veilleDeCourse ? 'Repos — veille de course' : 'Repos complet'),
            l(veilleDeCourse
              ? 'Veille de course : rien de dur. Le gain est déjà acquis, il ne reste qu’à ne pas le dépenser.'
              : 'Repos complet. Le plan se construit ici aussi.'),
          ),
        );
        continue;
      }

      let duree = Math.round((minutes * creneau.part) / totalPart);
      if (estJourDeCourse && course) duree = Math.round(course.cible_s / 60);

      /* The per-run distance floor: a run shorter than the floor is padded, and
         what it costs is taken off the bike rather than off the long run. */
      const estCourse = creneau.discipline === 'Course à pied';
      const distance = estCourse ? Math.round((duree / 6) * 10) / 10 : undefined;
      if (estCourse && distance !== undefined && distance < contraintes.plancher_km_sortie) {
        duree = Math.round(contraintes.plancher_km_sortie * 6);
      }

      sessions.push(
        seance(
          id++, s, bloc, date, creneau, type, duree,
          estJourDeCourse ? ['allure10'] : creneau.zones,
          contraintes,
          l(titreDe(type, course?.nom)),
          l(detailDe(type)),
        ),
      );
    }

    const dansLaSemaine = sessions.filter((x) => x.semaine === s);
    semaines.push({
      semaine: s,
      phase: bloc.nom.fr,
      bloc: bloc.code,
      heures: Math.round((dansLaSemaine.reduce((t, x) => t + x.duree_min, 0) / 60) * 100) / 100,
      heures_course: heuresDe(dansLaSemaine, 'Course à pied'),
      heures_hyrox: heuresDe(dansLaSemaine, 'Hyrox'),
      heures_nage: heuresDe(dansLaSemaine, 'Natation'),
      heures_velo: heuresDe(dansLaSemaine, 'Vélo'),
      km: Math.round(dansLaSemaine.reduce((t, x) => t + (x.distance_km ?? 0), 0) * 10) / 10,
      metres_nage: 0,
      charge: dansLaSemaine.reduce((t, x) => t + x.charge, 0),
    });
  }

  avertissements.push(...verifierEcartQualite(sessions));
  return { blocs, semaines, sessions, avertissements };
}

function heuresDe(sessions: MscPlanSession[], discipline: string): number {
  const m = sessions.filter((s) => s.discipline === discipline).reduce((t, s) => t + s.duree_min, 0);
  return Math.round((m / 60) * 100) / 100;
}

function seance(
  id: number,
  semaine: number,
  bloc: MscBloc,
  date: string,
  creneau: Creneau,
  type: TypeCode,
  duree: number,
  zones: ZoneCode[],
  contraintes: Contraintes,
  titre: Localized,
  detail: Localized,
): MscPlanSession {
  const jour = (new Date(date).getUTCDay() + 6) % 7;
  const rpe = RPE[type] ?? 5;
  const estCourse = creneau.discipline === 'Course à pied' && type !== 'repos';
  const distance = estCourse ? Math.round((duree / 6) * 10) / 10 : undefined;
  const metres = creneau.discipline === 'Natation' ? Math.round((duree * 40) / 100) * 100 : undefined;

  const meta = [duree ? `${duree} min` : '', distance ? `${distance} km` : '',
    metres ? `${metres} m` : '', rpe ? `RPE ${rpe}` : ''].filter(Boolean).join(' · ');

  return {
    id,
    semaine,
    phase: bloc.nom.fr,
    bloc: bloc.code,
    date,
    jour: { fr: JOURS_FR[jour], pl: JOURS_PL[jour] },
    jour_long: JOURS_LONG[jour],
    discipline: type === 'repos' ? 'Repos' : creneau.discipline,
    type,
    duree_min: duree,
    rpe_cible: rpe,
    charge: duree * rpe,
    zones,
    titre,
    titre_court: titre,
    meta: l(meta || 'repos'),
    detail,
    ...(distance ? { distance_km: distance } : {}),
    ...(metres ? { natation_m: metres } : {}),
    ...(contraintes.plancher_km_sortie && estCourse ? {} : {}),
  };
}

/* Le titre ne porte pas de chiffre.

   « Sortie longue 97 min » et `meta` « 97 min · 16,2 km · RPE 5 » disaient la
   même durée à deux endroits — et le titre devenait faux à la minute où un
   ajustement accepté raccourcissait la séance. Le classeur, lui, écrit
   « Seuil — 5 × 3' » et laisse les chiffres à `meta` : c'est la bonne règle,
   le générateur la suit. */
function titreDe(type: TypeCode, nomCourse?: string): string {
  switch (type) {
    case 'course': return nomCourse ?? 'Course';
    case 'repos': return 'Repos complet';
    case 'longue': return 'Sortie longue';
    case 'montagne': return 'Sortie montagne';
    case 'seuil': return 'Seuil';
    case 'allure10': return 'Fractionné allure 10 km';
    case 'vma': return 'VMA';
    case 'recup': return 'Footing de récupération';
    case 'ef': return "Footing d'endurance";
    case 'nage': return 'Natation';
    case 'velo': return 'Vélo Z2';
    case 'force': return 'Force';
    case 'compromis': return 'Circuit + course dégradée';
    default: return type;
  }
}

/** Placeholder prose. Claude replaces this with the real prescription. */
function detailDe(type: TypeCode): string {
  return `Séance de type ${type}. Le détail est écrit par le coach à la génération.`;
}

/** No two hard runs inside 48 h. Returns what it found rather than throwing. */
export function verifierEcartQualite(sessions: MscPlanSession[]): string[] {
  const durs = sessions
    .filter((s) => DURS.has(s.type))
    .sort((a, b) => a.date.localeCompare(b.date));
  const out: string[] = [];
  for (let i = 1; i < durs.length; i++) {
    const h = (Date.parse(durs[i].date) - Date.parse(durs[i - 1].date)) / 3_600_000;
    if (h < ECART_QUALITE_H) {
      out.push(
        `S${durs[i].semaine} : « ${durs[i - 1].titre.fr} » et « ${durs[i].titre.fr} » sont à ${h} h d'écart (minimum ${ECART_QUALITE_H} h).`,
      );
    }
  }
  return out;
}
