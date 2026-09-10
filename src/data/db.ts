/* La couture de la base MSC.

   Les écrans passent tous par ici — `select`, `one`, `mustOne`, `type`, `ui`,
   plus le moteur — et n'importent jamais une table directement. C'est ce qui a
   rendu le passage du tableau en mémoire au serveur possible en un seul
   fichier : les tables vivent maintenant dans `./vives`, remplies par
   `charger()` avec l'instantané que le serveur rend, et rien d'autre n'a bougé.

   Avant le chargement, les tables sont vides et `db.athlete` crie plutôt que de
   rendre zéro. Aucun écran ne doit s'afficher avant `charger()` : `App.tsx`
   tient cette garde. */

import { tables, ui as uiVivant } from './vives';
import type { Lang, MscType, MscUiStrings, TypeCode } from './types';

export * from './engine';
/* `chargee`, pas `charge` : le moteur exporte déjà `charge(durée, RPE)`,
   la charge de Foster, et deux noms identiques en masqueraient un. */
export { charger, vider, chargee, athleteId, droit, courbes } from './vives';
export type { Instantane } from './vives';

const arrayTables = tables;

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
  const row = tables.msc_type.find((r) => r.code === code);
  if (!row) throw new Error(`msc_type: unknown code "${code}"`);
  return row;
}

export function ui(lang: Lang): MscUiStrings {
  const chaines = uiVivant[lang];
  if (!chaines) throw new Error(`msc_ui: la langue « ${lang} » n'est pas chargée`);
  return chaines;
}
