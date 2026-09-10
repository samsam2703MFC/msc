/* The training mechanic.

   Nothing in the plan stores a pace. The engine derives every pace from two
   numbers on the athlete — the current 10 km reference and the target one —
   and slides them block by block. Change `ref_actuelle_s` (which is what the
   week-5 time trial does) and all thirty weeks recalibrate.

       référence(bloc) = actuelle − (actuelle − cible) × part(bloc)
       allure(zone, bloc) = référence(bloc) + écart(zone)

   Load is Foster's session-RPE, the workbook's own metric:

       charge = durée (min) × RPE

   The adjustment rules are data, not prose: each names the signal it watches
   and the threshold that fires it, so `evaluer` can run them. */

import { athlete as athleteCourant, tables } from './vives';
import type {
  MscAthlete,
  MscBloc,
  MscPlanSession,
  MscPlanWeek,
  MscRegle,
  MscSignal,
  MscZoneDef,
  ZoneCode,
} from './types';

/* L'athlète et les bornes du plan sont réexportés depuis `vives` : ce sont des
   liaisons ESM vivantes, donc elles suivent le chargement sans que les
   appelants aient à s'en soucier. */
export { athlete, premiereSemaine, derniereSemaine } from './vives';

/* ------------------------------------------------------------------ allures */

/** mm:ss from a number of seconds per km.

    Fractional seconds are truncated, not rounded, so the paces match the
    workbook the athlete already has — block C interpolates to x.6 s/km and the
    spreadsheet displays 5:44, not 5:45. */
export function formatAllure(secondes: number): string {
  const s = Math.floor(secondes);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}/km`;
}

/** mm:ss for a 10 km at this pace — how the workbook states each block. */
export function format10k(secondesParKm: number): string {
  const total = Math.floor(secondesParKm * 10);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function bloc(code: string): MscBloc {
  const found = tables.msc_bloc.find((b) => b.code === code);
  if (!found) throw new Error(`msc_bloc: unknown block "${code}"`);
  return found;
}

/* Ce que les écrans lisent tant qu'aucun plan n'existe : un bloc vide plutôt
   qu'un `undefined` qui ferait tomber l'en-tête sur `.code`. */
const SANS_BLOC: MscBloc = {
  code: '—',
  de: 0,
  a: 0,
  part: 0,
  nom: { fr: 'Sans plan', pl: 'Bez planu' },
  quoi: { fr: '', pl: '' },
};

export function blocDeSemaine(semaine: number): MscBloc {
  const week = Math.max(semaine, 1);
  return tables.msc_bloc.find((b) => week >= b.de && week <= b.a) ?? tables.msc_bloc[0] ?? SANS_BLOC;
}

/** Tous les blocs du plan, dans l'ordre des semaines. */
export function blocs(): MscBloc[] {
  return [...tables.msc_bloc].sort((a, b) => a.de - b.de);
}

/** Un réglage du back office (msc_param), ou le défaut du code s'il manque
    ou n'est pas du bon type — le moteur ne s'arrête pas sur un réglage. */
export function param<T extends number | string | boolean>(cle: string, defaut: T): T {
  const p = tables.msc_param.find((x) => x.cle === cle);
  return p && p.valeur != null && typeof p.valeur === typeof defaut ? (p.valeur as T) : defaut;
}

/** The block's 10 km reference pace, in seconds per km. */
export function reference(blocCode: string, who: MscAthlete = athleteCourant): number {
  const b = bloc(blocCode);
  return who.ref_actuelle_s - (who.ref_actuelle_s - who.ref_cible_s) * b.part;
}

export function zone(code: ZoneCode): MscZoneDef {
  const found = tables.msc_zone.find((z) => z.code === code);
  if (!found) throw new Error(`msc_zone: unknown zone "${code}"`);
  return found;
}

/** The training pace for a zone in a block, in seconds per km. */
export function allureSecondes(
  zoneCode: ZoneCode,
  blocCode: string,
  who: MscAthlete = athleteCourant,
): number {
  return reference(blocCode, who) + zone(zoneCode).ecart_s;
}

export function allure(
  zoneCode: ZoneCode,
  blocCode: string,
  who: MscAthlete = athleteCourant,
): string {
  return formatAllure(allureSecondes(zoneCode, blocCode, who));
}

/** Every zone for a block — the Allures sheet, one column of it. */
export function grilleAllures(blocCode: string, who: MscAthlete = athleteCourant) {
  return tables.msc_zone.map((z) => ({
    zone: z,
    secondes: allureSecondes(z.code, blocCode, who),
    allure: allure(z.code, blocCode, who),
  }));
}

/* -------------------------------------------------------------------- plan */

export function sessionsDeSemaine(semaine: number): MscPlanSession[] {
  return tables.msc_session.filter((s) => s.semaine === semaine);
}

export function sessionDuJour(date: string): MscPlanSession | undefined {
  /* Several sessions can share a day (swim in the morning, bike at night);
     the one that carries the day is the longest. */
  const jour = tables.msc_session.filter((s) => s.date === date);
  return jour.sort((a, b) => b.duree_min - a.duree_min)[0];
}

/** Where the plan is on a given date, clamped to its first and last day. */
export function positionDuPlan(date: string): { date: string; semaine: number } {
  const first = tables.msc_session[0];
  const last = tables.msc_session[tables.msc_session.length - 1];
  /* Sans plan (athlète tout juste créé), la date reste la date : rien à quoi
     l'accrocher, et un écran vide vaut mieux qu'une exception. */
  if (!first || !last) return { date, semaine: 0 };
  if (date < first.date) return { date: first.date, semaine: first.semaine };
  if (date > last.date) return { date: last.date, semaine: last.semaine };
  const exact = tables.msc_session.find((s) => s.date === date);
  if (exact) return { date, semaine: exact.semaine };
  /* A gap day — fall through to the next session in the plan. */
  const next = tables.msc_session.find((s) => s.date > date) ?? last;
  return { date: next.date, semaine: next.semaine };
}

export function semaine(n: number): MscPlanWeek | undefined {
  return tables.msc_week.find((w) => w.semaine === n);
}


/* ------------------------------------------------------------------- charge */

/** Foster's session-RPE. Read week over week, never in absolute. */
export function charge(dureeMin: number, rpe: number): number {
  return Math.round(dureeMin * rpe);
}

export interface Realise {
  session_id: number;
  duree_min: number;
  rpe: number;
}

/** Planned versus done for a week, in the shape the Semaine screen reads. */
export function bilanSemaine(n: number, realise: Realise[] = []) {
  const plan = sessionsDeSemaine(n);
  const faites = new Set(realise.map((r) => r.session_id));
  const done = plan.filter((s) => faites.has(s.id));
  const sum = (rows: MscPlanSession[], pick: (s: MscPlanSession) => number) =>
    rows.reduce((total, s) => total + pick(s), 0);

  return {
    semaine: n,
    prevu: {
      minutes: sum(plan, (s) => s.duree_min),
      km: sum(plan, (s) => s.distance_km ?? 0),
      metres: sum(plan, (s) => s.natation_m ?? 0),
      charge: sum(plan, (s) => s.charge),
    },
    realise: {
      minutes: sum(done, (s) => s.duree_min),
      km: sum(done, (s) => s.distance_km ?? 0),
      metres: sum(done, (s) => s.natation_m ?? 0),
      charge: realise.reduce((total, r) => total + charge(r.duree_min, r.rpe), 0),
    },
    seances: { prevu: plan.length, realise: done.length },
  };
}

/** Acute (7 day) over chronic (28 day) load. Above 1.5 is the alarm. */
export function acwr(chargesParJour: number[]): number | null {
  if (chargesParJour.length < 28) return null;
  const tail = (n: number) => chargesParJour.slice(-n);
  const moyenne = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const chronique = moyenne(tail(28)) * 7;
  if (chronique === 0) return null;
  return (moyenne(tail(7)) * 7) / chronique;
}

/* ------------------------------------------------------------------- règles */

/** What the athlete's week actually looked like, in the terms the rules use. */
export type Signaux = Partial<Record<MscSignal, number>>;

function franchi(regle: MscRegle, valeur: number): boolean {
  switch (regle.op) {
    case '>':
      return valeur > regle.seuil;
    case '>=':
      return valeur >= regle.seuil;
    case '<=':
      return valeur <= regle.seuil;
    case '<':
      return valeur < regle.seuil;
  }
}

/** The rules that fire, worst first — stop before lighten before adjust. */
export function evaluer(signaux: Signaux): MscRegle[] {
  const ordre = { stop: 0, allege: 1, ajuste: 2 };
  return tables.msc_regle
    .filter((r) => {
      const valeur = signaux[r.signal];
      return valeur !== undefined && franchi(r, valeur);
    })
    .sort((a, b) => ordre[a.gravite] - ordre[b.gravite]);
}

/** The pace a session should be run at once the fired rules are applied. */
export function allureCorrigee(
  zoneCode: ZoneCode,
  blocCode: string,
  regles: MscRegle[],
  who: MscAthlete = athleteCourant,
): string {
  const base = allureSecondes(zoneCode, blocCode, who);
  const delta = regles.reduce((total, r) => {
    if (r.effet.type !== 'allure') return total;
    if (r.effet.zone && r.effet.zone !== zoneCode) return total;
    return total + r.effet.secondes;
  }, 0);
  return formatAllure(base + delta);
}

/* ------------------------------------------------------------------ statuts */

/** A session's state is derived, not stored: done, today, rest, or ahead. */
/**
 * La ligne d'allures d'une séance : « EF 06:00 · Seuil 04:55 ».
 *
 * Le classeur la portait écrite, séance par séance. C'était la même chose que
 * ses zones passées dans le moteur, figée le jour de l'import — donc fausse dès
 * que le test de 30 minutes réécrit la référence. Elle est recomposée ici, et
 * elle glisse avec tout le reste.
 *
 * Une séance sans zone garde la sienne : celle-là n'est pas une allure mais une
 * consigne (« À l'effort, pas à l'allure — marche en côte assumée »).
 */
export function consigne(session: MscPlanSession, lang: 'fr' | 'pl'): string | undefined {
  if (session.zones.length === 0) return session.consigne?.[lang];
  return session.zones
    .map((code) => `${zone(code).label[lang]} ${allure(code, session.bloc)}`)
    .join(' · ');
}

/** Ce que les activités et le journal disent de chaque séance : faite, faite
    autrement, ou dite « pas faite ». Le reste — manquée, aujourd'hui, à venir —
    se lit sur la date. */
export interface EtatSeances {
  /** Une activité appariée d'une durée raisonnable, ou la coche de l'athlète. */
  faites: ReadonlySet<number>;
  /** Une activité appariée mais bien trop courte, ou une autre activité ce
      jour-là (un autre sport, une sortie que rien n'a appariée). */
  partiels: ReadonlySet<number>;
  /** L'athlète a dit « pas faite » : ça prime sur tout. */
  manquees: ReadonlySet<number>;
}

/* En dessous de cette part de la durée prévue, une activité appariée ne vaut
   pas la séance : trente minutes sur les quatre-vingt-dix d'une sortie longue,
   c'est « autrement », pas « faite ». */
const PART_MINIMALE = 0.6;

export function etatDesSeances(): EtatSeances {
  const faites = new Set<number>();
  const partiels = new Set<number>();
  const manquees = new Set<number>();
  const parId = new Map(tables.msc_session.map((s) => [s.id, s]));

  for (const j of tables.msc_journal) {
    if (j.fait === true) faites.add(j.session_id);
    if (j.fait === false) manquees.add(j.session_id);
  }
  const joursAvecActivite = new Set<string>();
  for (const a of tables.msc_activity) {
    joursAvecActivite.add(a.date);
    if (a.session_id === undefined) continue;
    const s = parId.get(a.session_id);
    if (!s) continue;
    if (a.duree_min >= s.duree_min * PART_MINIMALE) faites.add(a.session_id);
    else partiels.add(a.session_id);
  }
  /* Une activité ce jour-là qui n'est pas la séance : c'est « autrement ». */
  for (const s of tables.msc_session) {
    if (s.type === 'repos' || faites.has(s.id)) continue;
    if (joursAvecActivite.has(s.date)) partiels.add(s.id);
  }
  for (const id of manquees) { faites.delete(id); partiels.delete(id); }
  for (const id of faites) partiels.delete(id);
  return { faites, partiels, manquees };
}

const AUCUNE: EtatSeances = { faites: new Set(), partiels: new Set(), manquees: new Set() };

export function statutDe(
  session: MscPlanSession,
  aujourdhui: string,
  etat: EtatSeances = AUCUNE,
): 'repos' | 'fait' | 'partiel' | 'manque' | 'aujourdhui' | 'prevu' {
  if (etat.manquees.has(session.id)) return 'manque';
  if (etat.faites.has(session.id)) return 'fait';
  if (etat.partiels.has(session.id)) return 'partiel';
  if (session.type === 'repos') return 'repos';
  if (session.date === aujourdhui) return 'aujourdhui';
  /* Passée sans rien : ni activité, ni coche. Le dire en rouge plutôt que de
     la laisser en pointillé comme une séance à venir. */
  if (session.date < aujourdhui) return 'manque';
  return 'prevu';
}

/** Today, as an ISO date. Split out so a fixed date can be substituted. */
export function aujourdhuiISO(): string {
  return new Date().toISOString().slice(0, 10);
}
