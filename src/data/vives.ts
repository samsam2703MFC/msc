/* Les tables vivantes.

   Elles sont vides au chargement du module et remplies par `charger()`, avec
   l'instantané que le serveur rend pour un athlète. C'est le seul endroit du
   navigateur qui détient des données ; `db.ts` les expose, `engine.ts` calcule
   dessus, et aucun écran ne les touche.

   Le classeur n'est plus importé ici. Il vit dans `plan.generated.ts` et
   `reference.ts`, d'où le script de seed le charge en base et où les contrôles
   le lisent — mais il ne part plus dans le bundle, et surtout l'application ne
   peut plus afficher les données d'un autre athlète en croyant montrer les
   tiennes. Avant le chargement, elle n'affiche rien. */

import type {
  Lang, MscActivity, MscAdaptation, MscAjustement, MscAnalyse, MscAthlete, MscBloc,
  MscCompetition, MscCourbes, MscDaily, MscEcart, MscExcuse, MscJournal, MscMetric, MscObjectif,
  MesureAttente, MscMesure, MscParamPublic, MscPlanSession, MscPlanWeek, MscRegle, MscRpe,
  MscSource, MscStatut, MscType, MscUiStrings, MscZoneDef,
} from './types';

/* L'ordre est celui dans lequel la feuille de réglages liste les tables. */
export const tables = {
  msc_athlete: [] as MscAthlete[],
  msc_objectif: [] as MscObjectif[],
  msc_competition: [] as MscCompetition[],
  msc_bloc: [] as MscBloc[],
  msc_zone: [] as MscZoneDef[],
  msc_type: [] as MscType[],
  msc_session: [] as MscPlanSession[],
  msc_week: [] as MscPlanWeek[],
  msc_regle: [] as MscRegle[],
  msc_rpe: [] as MscRpe[],
  msc_activity: [] as MscActivity[],
  msc_journal: [] as MscJournal[],
  msc_daily: [] as MscDaily[],
  msc_mesure: [] as MscMesure[],
  mesures_attente: [] as MesureAttente[],
  msc_metric: [] as MscMetric[],
  msc_analyse: [] as MscAnalyse[],
  msc_adaptation: [] as MscAdaptation[],
  msc_ajustement: [] as MscAjustement[],
  msc_ecart: [] as MscEcart[],
  msc_excuse: [] as MscExcuse[],
  msc_statut: [] as MscStatut[],
  msc_source: [] as MscSource[],
  /* les réglages du back office que le moteur lit — jamais un secret */
  msc_param: [] as MscParamPublic[],
};

export const ui: Record<Lang, MscUiStrings> = {} as Record<Lang, MscUiStrings>;

/* Lire une propriété de l'athlète avant que la base soit chargée, c'est lire
   zéro et afficher une allure de 0:00 sans que rien ne proteste. Ce mandataire
   fait crier au lieu de laisser passer, et il disparaît dès le chargement :
   `charger()` le remplace par l'objet rendu par le serveur. */
const AVANT_CHARGEMENT = new Proxy({} as MscAthlete, {
  get(_, propriete) {
    throw new Error(
      `la base n'est pas chargée (lecture de « ${String(propriete)} » sur l'athlète)`,
    );
  },
});

/* Ces trois-là sont des `let` exportés : les liaisons ESM sont vivantes, donc
   `db.athlete` reflète la réaffectation sans que les appelants changent. */
export let athlete: MscAthlete = AVANT_CHARGEMENT;
export let premiereSemaine = 0;
export let derniereSemaine = 0;
export let chargee = false;
export let athleteId: number | null = null;
export let droit: 'lecture' | 'ecriture' = 'lecture';
/** Les courbes de forme : calculées par le serveur, pas une table. */
export let courbes: MscCourbes | null = null;

/** Ce que `/api/db/instantane` rend, tel quel. */
export type Instantane = Partial<typeof tables> & {
  msc_ui?: Record<Lang, MscUiStrings>;
  athlete_id?: number;
  droit?: 'lecture' | 'ecriture';
  courbes?: MscCourbes;
};

/** Remplit les tables. Chaque table est remplacée en place, jamais réaffectée :
    `arrayTables` de `db.ts` garde ainsi les mêmes références. */
export function charger(instantane: Instantane): void {
  for (const nom of Object.keys(tables) as (keyof typeof tables)[]) {
    const recues = instantane[nom] as unknown[] | undefined;
    const cible = tables[nom] as unknown[];
    cible.splice(0, cible.length, ...(recues ?? []));
  }

  if (instantane.msc_ui) {
    for (const langue of Object.keys(instantane.msc_ui) as Lang[]) {
      ui[langue] = instantane.msc_ui[langue];
    }
  }

  athlete = tables.msc_athlete[0] ?? AVANT_CHARGEMENT;
  premiereSemaine = tables.msc_week[0]?.semaine ?? 0;
  derniereSemaine = tables.msc_week[tables.msc_week.length - 1]?.semaine ?? 0;
  athleteId = instantane.athlete_id ?? null;
  droit = instantane.droit ?? 'lecture';
  courbes = instantane.courbes ?? null;
  chargee = tables.msc_athlete.length > 0;
}

/** Tout oublier — à la déconnexion. Les données d'un athlète ne doivent pas
    rester lisibles par le suivant qui se connecte sur le même appareil. */
export function vider(): void {
  for (const nom of Object.keys(tables) as (keyof typeof tables)[]) {
    (tables[nom] as unknown[]).length = 0;
  }
  for (const langue of Object.keys(ui) as Lang[]) delete ui[langue];
  athlete = AVANT_CHARGEMENT;
  premiereSemaine = 0;
  derniereSemaine = 0;
  athleteId = null;
  droit = 'lecture';
  courbes = null;
  chargee = false;
}
