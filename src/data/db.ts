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
import type { Lang, MscType, MscUiStrings, TypeCode } from './types';

export * from './engine';

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
  msc_activity,
  msc_journal,
  msc_daily,
  msc_metric,
  msc_analyse,
  msc_adaptation,
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
