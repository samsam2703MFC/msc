/* The MSC database seam.

   Screens never import ./tables, ./plan.generated or ./reference directly —
   they go through this module, so swapping the seed data for a real backend is
   a change in one file.

   Three sources sit behind it:
     ./plan.generated  the 243 sessions and 30 weekly totals, imported from the
                       reference workbook
     ./reference       the athlete, the blocks, the pace zones, the objectives
                       and the adjustment rules — the mechanic's inputs
     ./tables          the reference vocabulary, plus seeded examples of what
                       the Anthropic API writes back */

import { msc_session, msc_week } from './plan.generated';
import {
  msc_athlete,
  msc_bloc,
  msc_objectif,
  msc_regle,
  msc_rpe,
  msc_zone,
} from './reference';
import {
  msc_activity,
  msc_adaptation,
  msc_ajustement,
  msc_analyse,
  msc_daily,
  msc_ecart,
  msc_excuse,
  msc_journal,
  msc_metric,
  msc_source,
  msc_statut,
  msc_type,
  msc_ui,
} from './tables';
import type {
  Lang,
  MscActivity,
  MscAdaptation,
  MscAnalyse,
  MscType,
  MscUiStrings,
  TypeCode,
} from './types';

export * from './engine';

/* The one table a live integration writes into. Every other table here is read
   from end to end — seeded, imported or computed — but activities are what the
   athlete actually did, and Strava replaces them wholesale on every sync. So
   the accessors close over a mutable array rather than the imported seed, and
   `setActivites` is the seam the sync writes through.

   Unlinking puts the seeded example back, because a prototype with no Strava
   account should still have something to show. */
const activites: MscActivity[] = [...msc_activity];

/** Replaces the activity table with what Strava returned. */
export function setActivites(rows: MscActivity[]): void {
  activites.splice(0, activites.length, ...rows);
}

/** Back to the seeded example — what unlinking Strava leaves behind. */
export function reinitialiserActivites(): void {
  activites.splice(0, activites.length, ...msc_activity);
}

/* The coach's output lands here the same way. The seeded rows are the worked
   example from the workbook; a real analysis replaces the one for its own
   session and leaves the rest alone. */
const analyses: MscAnalyse[] = [...msc_analyse];
const adaptations: MscAdaptation[] = [...msc_adaptation];

/** Writes back what Claude made of a session. */
export function setAnalyse(analyse: MscAnalyse, adaptation?: MscAdaptation): void {
  const memeSeance = (r: { session_id?: number; type?: string }) =>
    r.type === 'seance' && r.session_id === analyse.session_id;

  for (let i = analyses.length - 1; i >= 0; i -= 1) {
    if (memeSeance(analyses[i])) {
      /* Its adaptation goes with it — an orphaned proposal would keep showing
         under a verdict that no longer exists. */
      const id = analyses[i].id;
      for (let j = adaptations.length - 1; j >= 0; j -= 1) {
        if (adaptations[j].analyse_id === id) adaptations.splice(j, 1);
      }
      analyses.splice(i, 1);
    }
  }

  analyses.push(analyse);
  if (adaptation) adaptations.push(adaptation);
}

/** The next analysis id — above the seeds, and above anything already written. */
export function prochainAnalyseId(): number {
  return analyses.reduce((max, a) => Math.max(max, a.id), 9000) + 1;
}

/** The next adaptation id — the proposals have their own numbering. */
export function prochainAdaptationId(): number {
  return adaptations.reduce((max, a) => Math.max(max, a.id), 7000) + 1;
}

/* Key order is the order the tables are listed in the settings sheet. */
const arrayTables = {
  msc_athlete,
  msc_objectif,
  msc_bloc,
  msc_zone,
  msc_type,
  msc_session,
  msc_week,
  msc_regle,
  msc_rpe,
  msc_activity: activites,
  msc_journal,
  msc_daily,
  msc_metric,
  msc_analyse: analyses,
  msc_adaptation: adaptations,
  msc_ajustement,
  msc_ecart,
  msc_excuse,
  msc_statut,
  msc_source,
};

export type TableName = keyof typeof arrayTables;
export type Row<K extends TableName> = (typeof arrayTables)[K][number];

/** Every table in the database, msc_ui included. */
export const tableNames: string[] = [...Object.keys(arrayTables), 'msc_ui'];

export function select<K extends TableName>(
  table: K,
  predicate?: (row: Row<K>) => boolean,
): Row<K>[] {
  const rows = arrayTables[table] as Row<K>[];
  return predicate ? rows.filter(predicate) : rows.slice();
}

export function one<K extends TableName>(
  table: K,
  predicate: (row: Row<K>) => boolean,
): Row<K> | undefined {
  return (arrayTables[table] as Row<K>[]).find(predicate);
}

/** `one` for rows the screens cannot render without — a miss is a data bug. */
export function mustOne<K extends TableName>(
  table: K,
  predicate: (row: Row<K>) => boolean,
): Row<K> {
  const row = one(table, predicate);
  if (!row) throw new Error(`${table}: no row matched`);
  return row;
}

export function type(code: TypeCode): MscType {
  const row = msc_type.find((r) => r.code === code);
  if (!row) throw new Error(`msc_type: unknown code "${code}"`);
  return row;
}

export function ui(lang: Lang): MscUiStrings {
  return msc_ui[lang];
}
