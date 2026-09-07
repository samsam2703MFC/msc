/* Ce que le navigateur garde quand le réseau n'est pas là.

   Deux choses, et elles n'ont pas le même statut.

   **L'instantané** est une copie, pas une source. Il permet de relire son plan
   dans un tunnel ou au fond d'une salle ; il est remplacé à chaque
   rechargement réussi, et effacé à la déconnexion — les données d'un athlète ne
   doivent pas rester lisibles par le suivant qui se connecte sur l'appareil.

   **La file d'attente** est autre chose : ce que l'athlète a tapé et que le
   serveur n'a pas encore reçu. Ça ne se perd pas. Chaque écriture porte
   l'identifiant que le client a tiré avant d'envoyer, et le serveur dédoublonne
   dessus — c'est ce qui rend le rejeu sûr, et c'est pour ça que la file peut
   rejouer sans compter ses tentatives.

   IndexedDB plutôt que localStorage : l'instantané fait quelques centaines de
   kilo-octets et une photo en attente est un Blob, ce que localStorage ne sait
   pas garder. */

import type { Instantane } from './vives';

const BASE = 'msc';
const VERSION = 1;
const INSTANTANES = 'instantanes';
const FILE = 'file';

export interface MutationEnAttente {
  id: string;
  chemin: string;
  /** Le corps JSON, ou un Blob pour une photo. */
  corps: unknown;
  type?: string;
  operation: string;
  cree_le: number;
  /** Renseigné quand le serveur l'a refusée pour de bon — pas un problème réseau. */
  refus?: string;
}

let ouverture: Promise<IDBDatabase> | null = null;

function ouvrir(): Promise<IDBDatabase> {
  if (!ouverture) {
    ouverture = new Promise((resolve, reject) => {
      const demande = indexedDB.open(BASE, VERSION);
      demande.onupgradeneeded = () => {
        const bd = demande.result;
        if (!bd.objectStoreNames.contains(INSTANTANES)) bd.createObjectStore(INSTANTANES);
        if (!bd.objectStoreNames.contains(FILE)) bd.createObjectStore(FILE, { keyPath: 'id' });
      };
      demande.onsuccess = () => resolve(demande.result);
      demande.onerror = () => reject(demande.error);
    });
  }
  return ouverture;
}

function transaction<T>(
  magasin: string,
  mode: IDBTransactionMode,
  travail: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return ouvrir().then(
    (bd) =>
      new Promise<T>((resolve, reject) => {
        const t = bd.transaction(magasin, mode);
        const demande = travail(t.objectStore(magasin));
        demande.onsuccess = () => resolve(demande.result);
        demande.onerror = () => reject(demande.error);
      }),
  );
}

/* Un navigateur en navigation privée, ou avec le stockage refusé, lève à
   l'ouverture. Ce n'est pas une raison de ne pas démarrer : sans cache, l'app
   marche exactement comme avant, en ligne seulement. */
async function silencieux<T>(travail: () => Promise<T>, defaut: T): Promise<T> {
  try {
    return await travail();
  } catch {
    return defaut;
  }
}

/* --------------------------------------------------------- l'instantané */

export function lireInstantane(athleteId: number): Promise<Instantane | undefined> {
  return silencieux(
    () => transaction<Instantane | undefined>(INSTANTANES, 'readonly', (s) => s.get(athleteId)),
    undefined,
  );
}

export function ecrireInstantane(athleteId: number, instantane: Instantane): Promise<unknown> {
  return silencieux(
    () =>
      transaction(INSTANTANES, 'readwrite', (s) =>
        s.put({ ...instantane, cache_le: new Date().toISOString() }, athleteId),
      ),
    undefined,
  );
}

/** Le plus récent instantané gardé, quel que soit l'athlète — de quoi démarrer
    sans réseau, avant même de savoir qui on est. */
export async function dernierInstantane(): Promise<Instantane | undefined> {
  const tout = await silencieux(
    () => transaction<Instantane[]>(INSTANTANES, 'readonly', (s) => s.getAll()),
    [] as Instantane[],
  );
  return tout.sort((a, b) =>
    String((b as { cache_le?: string }).cache_le ?? '').localeCompare(
      String((a as { cache_le?: string }).cache_le ?? ''),
    ),
  )[0];
}

/* L'identité est gardée à part : elle ne dit que le nom et l'adresse du compte,
   et elle sert à ne pas afficher un écran vide en mode hors ligne. */
const IDENTITE = -1;

export function lireIdentite<T>(): Promise<T | undefined> {
  return silencieux(() => transaction<T | undefined>(INSTANTANES, 'readonly', (s) => s.get(IDENTITE)), undefined);
}

export function ecrireIdentite(identite: unknown): Promise<unknown> {
  return silencieux(() => transaction(INSTANTANES, 'readwrite', (s) => s.put(identite, IDENTITE)), undefined);
}

/** À la déconnexion. La file, elle, survit : elle appartient à l'athlète qui
    l'a remplie, et la vider perdrait ce qu'il a tapé. */
export function oublierInstantanes(): Promise<unknown> {
  return silencieux(() => transaction(INSTANTANES, 'readwrite', (s) => s.clear()), undefined);
}

/* ------------------------------------------------------------- la file */

export function filer(m: MutationEnAttente): Promise<unknown> {
  return silencieux(() => transaction(FILE, 'readwrite', (s) => s.put(m)), undefined);
}

export function enAttente(): Promise<MutationEnAttente[]> {
  return silencieux(
    () =>
      transaction<MutationEnAttente[]>(FILE, 'readonly', (s) => s.getAll()).then((tout) =>
        /* Dans l'ordre où elles ont été tapées : un RPE corrigé deux fois doit
           arriver dans le bon sens. */
        tout.sort((a, b) => a.cree_le - b.cree_le),
      ),
    [],
  );
}

export function retirer(id: string): Promise<unknown> {
  return silencieux(() => transaction(FILE, 'readwrite', (s) => s.delete(id)), undefined);
}

export function marquerRefus(m: MutationEnAttente, refus: string): Promise<unknown> {
  return filer({ ...m, refus });
}

/** Combien attendent, et combien ont été refusées pour de bon. */
export async function etatFile(): Promise<{ attente: number; refusees: number }> {
  const tout = await enAttente();
  return {
    attente: tout.filter((m) => !m.refus).length,
    refusees: tout.filter((m) => m.refus).length,
  };
}

export function viderRefusees(): Promise<unknown> {
  return silencieux(async () => {
    for (const m of await enAttente()) if (m.refus) await retirer(m.id);
  }, undefined);
}
