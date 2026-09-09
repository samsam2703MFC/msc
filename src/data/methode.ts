/* What the coach service returns, and how the generator applies it.

   The methodology is Claude's half of the plan: the intent of each block and
   the prescription for each session type. It never carries a pace, a duration
   or a date — those are the generator's, and they stay checkable. */

import type { MscPlanSession, TypeCode } from './types';
import { RACINE_API } from './base';

export interface MethodeSeance {
  type: string;
  titre: string;
  structure: string;
  pourquoi: string;
  science: string[];
}

export interface MethodeBloc {
  code: string;
  intention: string;
  focus: string;
}

export interface Source {
  titre: string;
  url: string;
}

export interface Methode {
  principes: string[];
  blocs: MethodeBloc[];
  seances: MethodeSeance[];
  sources: Source[];
  reserves: string[];
}

const ENDPOINT = `${RACINE_API}/methode`;

export class MethodeError extends Error {}

/** Asks the plan server for the methodology. The API key lives there, not here. */
export async function demanderMethode(corps: unknown, signal?: AbortSignal): Promise<Methode> {
  let reponse: Response;
  try {
    reponse = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corps),
      signal,
    });
  } catch {
    throw new MethodeError(
      "Le serveur de plan ne répond pas. Lance-le avec « npm run server ».",
    );
  }
  const data = await reponse.json().catch(() => ({}));
  if (!reponse.ok) {
    throw new MethodeError(data?.erreur ?? `Le serveur a répondu ${reponse.status}.`);
  }
  return data as Methode;
}

/** Writes the methodology onto the generated sessions. */
export function appliquerMethode(sessions: MscPlanSession[], methode: Methode): MscPlanSession[] {
  const parType = new Map<string, MethodeSeance>();
  for (const s of methode.seances) parType.set(s.type, s);

  const intentions = new Map<string, string>();
  for (const b of methode.blocs) intentions.set(b.code, b.intention);

  return sessions.map((session) => {
    const modele = parType.get(session.type as TypeCode);
    const phase = intentions.get(session.bloc) ?? session.phase;
    if (!modele) return { ...session, phase };

    /* The generator's duration stays in the title; the prescription is Claude's. */
    const titre = session.duree_min
      ? `${modele.titre} · ${session.duree_min} min`
      : modele.titre;
    return {
      ...session,
      phase,
      titre: { fr: titre, pl: titre },
      titre_court: { fr: modele.titre, pl: modele.titre },
      detail: { fr: modele.structure, pl: modele.structure },
      consigne: { fr: modele.pourquoi, pl: modele.pourquoi },
    };
  });
}
