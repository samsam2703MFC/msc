/* Row shapes for the MSC database (msc_ prefix).
   These mirror msc-db.js from the Claude Design handoff one-for-one. */

export type Lang = 'fr' | 'pl';

/** Every user-facing string in the database is stored per language. */
export type Localized = Record<Lang, string>;
export type LocalizedList = Record<Lang, string[]>;

/** A Lucide icon name, e.g. 'footprints'. */
export type IconName = string;

/** A hex colour, e.g. '#02A988'. */
export type Hex = string;

export type TypeCode =
  | 'ef' | 'recup' | 'endactive' | 'seuil' | 'allure10' | 'vma' | 'longue'
  | 'montagne' | 'test' | 'force' | 'compromis' | 'nage' | 'velo' | 'repos'
  | 'course'
  | 'biere' | 'chocolat' | 'gavage';

/** The eight pace zones, in order from slowest to fastest. */
export type ZoneCode =
  | 'recup' | 'ef' | 'endactive' | 'marathon' | 'semi' | 'seuil' | 'allure10' | 'vma';

export interface MscType {
  code: TypeCode;
  icon: IconName;
  color: Hex;
  label: Localized;
  /** The one-line payoff: « Aller plus vite », « Mieux durer »… */
  gain: Localized;
  /** Why the session exists at all. */
  why: Localized;
  /** What the science says — one or two lines. */
  sci: LocalizedList;
}

/** Sliding pace zones — a pace is never hard-coded in the UI. */
export interface MscZone {
  code: string;
  bloc: string;
  allure: string;
  label: Localized;
  icon: IconName;
}

export interface MscSession {
  id: number;
  semaine: number;
  bloc: string;
  date: string;
  jour: Localized;
  type: TypeCode;
  duree_min: number;
  titre: Localized;
  meta: Localized;
  titre_court?: Localized;
  but?: Localized;
  reussite?: Localized;
  zones?: string[];
  rpe_cible?: number;
  distance_km?: number;
  natation_m?: number;
  adapte_par?: string;
}

export interface MscSessionStep {
  session_id: number;
  ordre: number;
  duree: string;
  icon: IconName;
  detail: Localized;
}

/** What Strava returns — aggregates only, never the raw streams. */
export interface MscActivity {
  id_strava: number;
  /** The session this activity was. Absent when it matched nothing planned. */
  session_id?: number;
  date: string;
  sport: string;
  duree_min: number;
  statut: string;
  allure_moy?: string;
  fc_moy?: number;
  splits_blocs?: number[];
}

export interface MscJournal {
  date: string;
  session_id: number;
  rpe_ressenti: number;
  sommeil: number;
  douleurs: string[];
}

export interface MscDaily {
  date: string;
  fc_repos: number;
}

export interface MscMetric {
  code: string;
  icon: IconName;
  valeur: string;
  couleur: Hex;
  serie: number[];
  nom: Localized;
  formule: Localized;
  seuil?: number;
}

export interface MscWeekTotal {
  code: string;
  icon: IconName;
  realise: string;
  prevu: string;
  label: Localized;
}

export interface MscWeek {
  semaine: number;
  bloc: string;
  totaux: MscWeekTotal[];
}

export interface MscAnalyseStat {
  valeur: string;
  icon: IconName;
  couleur: Hex;
  label: Localized;
}

export interface MscAnalyseBloc {
  icon: IconName;
  couleur: Hex;
  items: LocalizedList;
}

/** Output of the Anthropic API, timestamped and kept. */
export interface MscAnalyse {
  id: number;
  date: string;
  type: 'seance' | 'hebdo';
  modele: string;
  cout_eur: number;
  verdict: Localized;
  session_id?: number;
  semaine?: number;
  stats?: MscAnalyseStat[];
  blocs?: MscAnalyseBloc[];
}

/** Comes out of a session analysis: a proposal, never a direct write. */
export interface MscAdaptation {
  id: number;
  analyse_id: number;
  session_id: number;
  type: TypeCode;
  session_avant: Localized;
  session_apres: string;
  pourquoi: Localized;
}

export interface MscAjustement {
  id: number;
  analyse_id: number;
  type: TypeCode;
  quand: Localized;
  quoi: Localized;
  session_id?: number;
  semaine?: number;
}

export interface MscEcartStat {
  valeur: string;
  icon: IconName;
  label: Localized;
}

export interface MscEcartRecalcul {
  portee: string;
  texte: Localized;
}

export interface MscEcart {
  semaine: number;
  retard: string;
  sautees: number;
  realisation: string;
  texte: Localized;
  stats: MscEcartStat[];
  recalcul: MscEcartRecalcul[];
}

export type StatutCode = 'repos' | 'fait' | 'aujourdhui' | 'adapte' | 'prevu';

export interface MscStatut {
  code: StatutCode;
  icon: IconName;
  couleur: Hex;
}

export interface MscSessionStatut {
  session_id: number;
  statut: StatutCode;
}

/** A data source and every state its card can be in.

    The strings stay in the database like every other string in the app; only
    the two figures the card interpolates — how long ago the last sync was, and
    how many activities matched nothing — are computed at render. */
export interface MscSource {
  code: string;
  etat: string;
  canal: string;
  /** The server has no client id or secret: nothing can be linked yet. */
  titre_absent: Localized;
  sous_absent: Localized;
  titre_off: Localized;
  sous_off: Localized;
  /** The athlete is away on the provider's consent screen. */
  titre_liaison: Localized;
  sous_liaison: Localized;
  titre_on: Localized;
  sous_on: Localized;
  sous_synchro: Localized;
  jamais: Localized;
  webhook_on: Localized;
  webhook_off: Localized;
  orphelines: Localized;
  delier: Localized;
}

/** The real life of an athlete: reasons declared, coach's answer. */
export interface MscExcuse {
  code: string;
  icon: IconName;
  type: TypeCode;
  session_id: number;
  label: Localized;
  reponse: Localized;
  remplacement: Localized;
}

export type ScreenKey = 'today' | 'week' | 'form' | 'coach' | 'admin';

export interface MscUiStrings {
  screens: Record<ScreenKey, string>;
  tabs: Record<ScreenKey, string>;
  doneOn: string;
  doneOff: string;
  rpeLabel: string;
  notePlaceholder: string;
  anaLabel: string;
  anaIdle: string;
  anaRunning: string;
  anaDoneBtn: string;
  nextLabel: string;
  applyOn: string;
  applyOff: string;
  legendLabel: string;
  gapLabel: string;
  gapNone: string;
  recalcIdle: string;
  recalcRunning: string;
  recalcDoneBtn: string;
  verdictLabel: string;
  askPlaceholder: string;
  chatThinking: string;
  chatEmpty: string;
  excuseLabel: string;
  excuseAnswer: string;
  excuseNew: string;
  modalKind: string;
  modalSci: string;
  modalClose: string;
}

/* ============================================================
   The training mechanic — profile, blocks, zones, rules.
   See ./reference for the data and ./engine for what computes from it.
   ============================================================ */

/** The two references the whole plan slides between. */
export interface MscAthlete {
  id: number;
  nom: string;
  /** Current 10 km pace, in seconds per km. The week-5 time trial rewrites it. */
  ref_actuelle_s: number;
  /** Target 10 km pace, in seconds per km. */
  ref_cible_s: number;
  fc_repos: number;
  fc_repos_moy7: number;
  fc_moy_reference: number;
  derive_reference_pct: number;
  /** Weekly volume floor, in hours. */
  plancher_heures: number;
  /** Distance floor per run, in km. */
  plancher_km_sortie: number;
  debut: string;
  note: Localized;
}

export interface MscBloc {
  code: string;
  /** First and last week of the block, inclusive. */
  de: number;
  a: number;
  /** Share of the way from the current reference to the target one, 0 → 1. */
  part: number;
  nom: Localized;
  quoi: Localized;
}

export interface MscZoneDef {
  code: ZoneCode;
  /** Offset from the block's 10 km reference, in seconds per km. */
  ecart_s: number;
  icon: IconName;
  label: Localized;
  usage: Localized;
}

export interface MscObjectif {
  id: number;
  date: string;
  semaine: number;
  /** The one race the plan is built backwards from. */
  principal: boolean;
  /** Race distance in km — a target is only comparable to the plan's 10 km
      reference once converted, which needs the distance it was run over. */
  distance_km: number;
  /** The fast end of the target range, in seconds. */
  cible_s: number;
  /** The slow end. Intermediate races are checkpoints, so the generator takes
      the middle of the range for them; the main objective is the goal, so it
      takes the fast end. `cible` carries the range as the athlete reads it. */
  cible_haute_s: number;
  nom: Localized;
  cible: Localized;
  role: Localized;
}

/** What a rule does once it fires. */
export type MscEffet =
  | { type: 'allure'; secondes: number; semaines?: number; zone?: ZoneCode }
  | { type: 'coupe'; disciplines: string[] }
  | { type: 'decharge' }
  | { type: 'stop'; jours: number; sauf: string[] }
  | { type: 'remplace'; par: TypeCode }
  | { type: 'sacrifice'; ordre: string[] };

/** The signals the rules watch, all of them already measured. */
export type MscSignal =
  | 'rpe_qualite'
  | 'derive_longue'
  | 'fc_repos_delta'
  | 'sensation_dure'
  | 'douleur_tendineuse'
  | 'nuits_courtes'
  | 'seance_sautee';

export interface MscRegle {
  code: string;
  signal: MscSignal;
  op: '>' | '>=' | '<=' | '<';
  seuil: number;
  /** How many consecutive days the signal must hold, where that matters. */
  jours?: number;
  gravite: 'ajuste' | 'allege' | 'stop';
  si: Localized;
  alors: Localized;
  pourquoi: Localized;
  effet: MscEffet;
}

export interface MscRpe {
  de: number;
  a: number;
  label: Localized;
  quoi: Localized;
}

/** A session as imported from the plan. */
export interface MscPlanSession {
  id: number;
  semaine: number;
  phase: string;
  bloc: string;
  date: string;
  jour: Localized;
  jour_long: string;
  discipline: string;
  type: TypeCode;
  duree_min: number;
  rpe_cible: number;
  /** Planned load: duration × target RPE. */
  charge: number;
  zones: ZoneCode[];
  titre: Localized;
  titre_court: Localized;
  meta: Localized;
  detail: Localized;
  distance_km?: number;
  natation_m?: number;
  /** Free-text pace instruction, where the session is run on effort not pace. */
  consigne?: Localized;
}

/** A week's planned totals, as the workbook computes them. */
export interface MscPlanWeek {
  semaine: number;
  phase: string;
  bloc: string;
  heures: number;
  heures_course: number;
  heures_hyrox: number;
  heures_nage: number;
  heures_velo: number;
  km: number;
  metres_nage: number;
  charge: number;
}
