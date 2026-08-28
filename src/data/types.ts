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
  | 'biere' | 'chocolat' | 'gavage';

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
  session_id: number;
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

export interface MscSource {
  code: string;
  etat: string;
  canal: string;
  titre_off: Localized;
  sous_off: Localized;
  titre_on: Localized;
  sous_on: Localized;
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

export type ScreenKey = 'today' | 'week' | 'form' | 'coach';

export interface MscUiStrings {
  screens: Record<ScreenKey, string>;
  eyebrows: Record<ScreenKey, string>;
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
  recalcIdle: string;
  recalcRunning: string;
  recalcDoneBtn: string;
  verdictLabel: string;
  askPlaceholder: string;
  excuseLabel: string;
  excuseAnswer: string;
  excuseNew: string;
  modalKind: string;
  modalSci: string;
  modalClose: string;
}
