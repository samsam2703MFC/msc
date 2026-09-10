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
  /** Ce qui a bloqué : codes de `LIMITES`. `['rien']` quand la question a eu
      sa réponse et que rien n'a bloqué ; vide tant qu'elle n'a pas été posée. */
  limites?: string[];
  note?: string;
  /** La coche de l'athlète : vrai « faite », faux « pas faite », absent tant
      qu'il n'a rien dit — Strava compte à part, dans msc_activity. */
  fait?: boolean;
}

/** Un réglage tel que le navigateur le reçoit : la valeur qui s'applique, et
    rien d'autre. Les secrets ne passent jamais par ici. */
export interface MscParamPublic {
  cle: string;
  valeur: number | string | boolean | null;
}

/** Un réglage tel que le back office le voit : d'où vient la valeur, et pour
    un secret seulement s'il est renseigné et ses derniers caractères. */
export interface MscParam {
  cle: string;
  groupe: string;
  type: 'nombre' | 'texte' | 'booleen' | 'secret';
  unite: string | null;
  ordre: number;
  libelle: Localized;
  aide: Localized | null;
  defaut: number | string | boolean | null;
  env: string | null;
  source: 'base' | 'env' | 'defaut';
  valeur: number | string | boolean | null;
  renseigne: boolean;
  apercu?: string | null;
  /** Un secret scellé avec une autre MSC_SECRET_KEY : là, mais irrécupérable. */
  illisible?: boolean;
}

/** Un fil de conversation avec le coach, tel que le back office le relit. */
export interface Conversation {
  fil: string;
  titre: Localized;
  dernier: string | null;
  tours: Array<{
    role: 'user' | 'assistant';
    texte: string;
    modele: string | null;
    cout_eur: number | null;
    /** Le coach qui parlait — tortionnaire, gentil, gros_porc. */
    ton: string | null;
    date: string;
  }>;
}

/** Les cinq axes du classement, notés sur 100. */
export type Axe = 'endurance' | 'vitesse' | 'velo' | 'cap' | 'natation';

/** Une ligne du classement du club : les scores, la moyenne, le palier. */
export interface ClassementLigne {
  id: number;
  nom: string;
  prenom: string | null;
  surnom: string | null;
  rang: number;
  scores: Record<Axe, number>;
  total: number;
  puissance: number;
  palier: { n: number; nom: Localized };
  brut: {
    heures_semaine: number;
    velo_h_semaine: number;
    nage_km_semaine: number;
    ref_10k_s: number;
    vitesse_s: number;
    vitesse_mesuree: boolean;
  };
}

export interface Classement {
  athletes: ClassementLigne[];
  paliers: Array<{ n: number; nom: Localized; seuil: number }>;
}

/** Une ligne du calendrier commun : une compétition, et à qui elle est. */
export interface CalendrierEntree {
  id: number;
  date: string;
  nom: string;
  lieu: string | null;
  pays: string | null;
  discipline: string;
  distance_km: number;
  officielle: boolean;
  athlete: { id: number; nom: string; prenom: string | null; surnom: string | null };
  cible: Localized | null;
  principal: boolean;
  resultat: { temps_s: number | null; classement: number | null; abandon: boolean } | null;
}

/** Le vocabulaire fermé de « ce qui a bloqué » — le même que le serveur. */
export const LIMITES = ['rien', 'jambes', 'souffle', 'technique', 'mental', 'sommeil', 'nutrition', 'douleur', 'chaleur'] as const;
export type Limite = (typeof LIMITES)[number];

export interface MscDaily {
  date: string;
  fc_repos: number;
}

/** La définition d'une métrique. `valeur` et `serie` se calculent depuis les
    activités et les mesures : elles manquent tant qu'il n'y a pas de quoi les
    calculer, et l'écran le dit plutôt que de peindre un chiffre inventé. */
/** Un jour de la base endurance : la charge du jour (durée × RPE), et les
    deux lissages — long (la base) et court (la fatigue). */
export interface CourbeCharge {
  date: string;
  charge: number;
  base: number;
  fatigue: number;
}

/** Un matin de HRV, contre la moyenne des jours d'avant ; `sous` quand la
    chute dépasse le seuil réglé. */
export interface CourbeHrv {
  date: string;
  hrv: number;
  base: number | null;
  sous: boolean;
}

/** Les courbes de forme, calculées par le serveur — pour l'écran État de
    forme et la carte du back office. */
export interface MscCourbes {
  charge: CourbeCharge[];
  hrv: CourbeHrv[];
  tau: { base: number; fatigue: number; hrv_base: number };
}

export interface MscMetric {
  code: string;
  icon: IconName;
  couleur: Hex;
  nom: Localized;
  formule: Localized;
  seuil?: number;
  valeur?: string;
  serie?: number[];
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

/** Ce que le coach renvoie, rangé tel quel : un ton et des lignes dans la
    langue de l'appel. « plan » est ce que la séance change à l'équilibre du
    plan. `Observations` sait lire les deux formes. */
export interface MscObservation {
  ton: 'bon' | 'attention' | 'plan';
  lignes: string[];
}

/** Une ligne des sept prochains jours, telle que le coach l'a écrite : ce que
    devient la séance (une action que le moteur sait appliquer), son format
    avec les allures fournies, et le mot du coach pour ce jour. */
export interface GlissantJour {
  date: string;
  session_id: number | null;
  action: 'garder' | 'reduire' | 'allonger' | 'deplacer' | 'sauter' | 'repos';
  part: number | null;
  vers_date: string | null;
  titre: string;
  format: string;
  note: string;
}

/** L'adaptation à jours glissants : le signal du matin, ce qu'il implique,
    les sept jours ligne par ligne, et la décision à trancher plus tard. */
export interface GlissantContenu {
  signal: { titre: string; lignes: string[]; verdict: 'journee_dure_ok' | 'qualite_ok' | 'facile' | 'repos' };
  implication: string;
  jours: GlissantJour[];
  decision: { quand: string; regle: string } | null;
}

/** Output of the Anthropic API, timestamped and kept. */
export interface MscAnalyse {
  id: number;
  date: string;
  type: 'seance' | 'hebdo' | 'glissant';
  modele: string;
  cout_eur: number;
  verdict: Localized;
  session_id?: number;
  semaine?: number;
  /** Le coach qui parlait. */
  ton?: string;
  stats?: MscAnalyseStat[];
  blocs?: Array<MscAnalyseBloc | MscObservation>;
  /** Pour une analyse « glissant » : les sept jours. */
  glissant?: GlissantContenu;
}

/** Comes out of a session analysis: a proposal, never a direct write.

    Ce que la base garde est ce que le modèle a choisi — une zone et une part de
    la durée prévue — et non « 44 min · 6:20/km ». Le moteur rend la ligne, donc
    réécrire la référence 10 km de l'athlète fait glisser la proposition comme
    elle fait glisser le plan. `appliquerAdaptation` s'en charge. */
export interface MscAdaptation {
  id: number;
  analyse_id: number;
  /** La séance visée : celle qui suit. */
  session_id: number;
  zone?: ZoneCode;
  part_duree: number;
  pourquoi: Localized;
  applique: boolean;
  /** Renseigné une fois la proposition acceptée. Voir `SeanceAvant`. */
  avant?: SeanceAvant;
}

/** Ce qu'une séance était juste avant qu'une proposition acceptée l'écrive.

    Accepter déplace vraiment la séance : `msc_session` porte désormais la durée
    et la zone que le coach a proposées. Ce souvenir est le seul fait de
    l'opération qui ne se recalcule pas — la séance a été écrasée — et c'est lui
    qui garde « 68 min → 54 min » vrai après l'acceptation, et le retrait
    exact. */
export interface SeanceAvant {
  duree_min: number;
  distance_km: number | null;
  natation_m: number | null;
  charge: number;
  zones: ZoneCode[];
  /** Le jour d'avant, quand la proposition acceptée l'a déplacée. */
  date?: string;
  jour_long?: string;
}

/** Un ajustement du réétalonnage hebdomadaire, accepté un par un. Soit une
    séance et une part de sa quantité — sa durée, ou ses mètres pour une nage —
    soit une semaine et ce qui s'y déplace. Le libellé est rendu par
    `libelleAjustement`, pour la même raison que l'adaptation. */
export interface MscAjustement {
  id: number;
  analyse_id: number;
  type: TypeCode;
  session_id?: number;
  semaine?: number;
  part?: number;
  /** Un déplacement : le jour où la séance atterrit à l'acceptation. */
  vers_date?: string;
  texte?: Localized;
  applique: boolean;
  avant?: SeanceAvant;
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

/** Ce que Claude dit de l'écart d'une semaine. Les trois chiffres — le retard,
    les séances sautées, la réalisation — n'y sont pas : ils sont arithmétiques
    et `ecartDeSemaine` les recalcule à chaque affichage. */
export interface MscEcart {
  semaine: number;
  texte: Localized;
  recalcul: MscEcartRecalcul[];
}

/** L'état d'une séance, dérivé — jamais stocké : faite (vert), faite autrement
    (orange : trop courte, ou un autre sport ce jour-là), manquée (rouge),
    aujourd'hui, adaptée, à venir, repos. */
export type StatutCode = 'repos' | 'fait' | 'partiel' | 'manque' | 'aujourdhui' | 'adapte' | 'prevu';

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

/** Le poids et la FC d'un jour, une fois confirmés. */
export interface MscMesure {
  date: string;
  poids_kg?: number;
  fc_repos?: number;
  /** La HRV du matin, en ms — l'autre moitié de la forme. */
  hrv_ms?: number;
  source: 'photo' | 'saisie' | 'import';
  etat: 'propose' | 'confirme' | 'rejete';
}

/** Ce qu'un modèle a lu sur une photo, et que l'athlète n'a pas encore vu.
    Tant que ce n'est pas confirmé, ça ne compte dans aucune métrique. */
export interface MesureAttente {
  date: string;
  poids_kg?: number;
  fc_repos?: number;
  photo_id: number;
  confiance?: 'haute' | 'moyenne' | 'basse';
  /** Ce que le modèle dit avoir lu, mot pour mot. */
  lu?: string;
  /** Vrai quand la lecture a échoué : la photo est là, les chiffres non. Le
      détail reste en base — l'écran n'a besoin que de proposer la saisie. */
  echec?: boolean;
}

/** Ce qu'une course a donné. L'allure n'est pas stockée : temps ÷ distance, et
    la distance est sur la compétition. */
export interface MscResultat {
  temps_s: number;
  allure_s_km: number;
  classement?: number;
  classement_categorie?: number;
  categorie?: string;
  partants?: number;
  fc_moy?: number;
  abandon: boolean;
  note?: string;
}

/** Une course, courue ou à courir. Elle appartient à l'athlète et pas au plan :
    c'est ce qui laisse les résultats survivre aux plans qui les visaient, et
    une courbe de progression traverser plusieurs plans sans s'en apercevoir. */
export interface MscCompetition {
  id: number;
  date: string;
  nom: string;
  lieu?: string;
  pays?: string;
  discipline: string;
  distance_km: number;
  denivele_m?: number;
  officielle: boolean;
  note?: string;
  resultat?: MscResultat;
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
  /** Le profil, sous l'avatar. `nom` reste ce que l'application affiche. */
  prenom?: string | null;
  surnom?: string | null;
  annee_naissance?: number | null;
  /** Le coach choisi — tortionnaire, gentil, gros_porc. Son ton, pas son fond. */
  coach?: string;
  /** Le palier de transformation (1–6), calculé par le serveur — l'avatar le porte. */
  niveau?: number;
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

/* ---------------------------------------------------------- la vue coach */

export type NiveauForme = 'excellent' | 'bon' | 'attention' | 'fatigue';

/** Un athlète en un coup d'œil — ce que /api/apercu rend, par athlète visible. */
export interface ApercuAthlete {
  id: number;
  droit: 'lecture' | 'ecriture';
  nom: string;
  prenom: string | null;
  surnom: string | null;
  annee_naissance: number | null;
  ref_actuelle_s: number;
  ref_cible_s: number;
  plan: { nom: string; debut: string; fin: string } | null;
  semaine: number;
  total: number;
  bloc: { code: string; part: number; de: number; a: number; nom: Localized } | null;
  cette_semaine: {
    prevues: number;
    faites: number;
    volume_prevu_min: number;
    volume_realise_min: number;
  };
  coach: string;
  niveau: number;
  dernier_rpe: { valeur: number; date: string; limites: string[] } | null;
  mesure: {
    date: string;
    poids_kg: number | null;
    fc_repos: number | null;
    hrv_ms: number | null;
  } | null;
  base: { fc_repos: number | null; hrv_ms: number | null };
  /** Absent quand rien ne permet de la lire — jamais un 10 par défaut. */
  forme: { score: number; niveau: NiveauForme; alertes: string[] } | null;
  charge: { passee_7j: number; a_venir_7j: number };
  courbes?: MscCourbes;
}
