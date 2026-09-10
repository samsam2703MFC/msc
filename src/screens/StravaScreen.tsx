/* Strava, pour l'athlète affiché : sa liaison, son historique, son
   application API — la sienne.

   Chaque athlète se relie avec son propre compte Strava, et peut porter sa
   propre application (strava.com/settings/api) : Strava n'autorise, sur une
   application neuve, que le compte qui l'a créée. Sans application propre,
   c'est l'application commune des Réglages qui vaut — l'écran dit laquelle. */

import { useCallback, useEffect, useState } from 'react';
import type { StravaAthlete } from '../data/api';
import * as db from '../data/db';
import { aujourdhuiISO } from '../data/engine';
import * as strava from '../data/strava';
import type { Lang } from '../data/types';
import { C, R } from '../design/theme';
import { Icon } from '../components/Icon';
import { Card, SectionLabel } from '../components/primitives';
import { BlocStrava } from '../components/StravaAthlete';
import type { App } from '../state/useApp';

const T = {
  fr: {
    titre: 'Strava',
    intro: 'La liaison Strava de cet athlète, son historique, et son application Strava à lui — chacun la sienne, créée sur strava.com/settings/api avec le domaine de rappel du serveur. Sans application propre, c’est l’application commune des Réglages qui vaut.',
    chargement: 'Lecture de Strava…',
  },
  pl: {
    titre: 'Strava',
    intro: 'Połączenie Strava tego zawodnika, jego historia i jego własna aplikacja Strava — każdy swoją, utworzoną na strava.com/settings/api z domeną zwrotną serwera. Bez własnej aplikacji obowiązuje wspólna z Ustawień.',
    chargement: 'Odczyt Stravy…',
  },
} satisfies Record<Lang, unknown>;

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/* Ce que le back office sait d'un athlète, lu pour celui-ci seul : l'état de
   la liaison et l'application par l'API, les activités depuis l'instantané. */
async function lireUn(id: number, nom: string, droit: 'lecture' | 'ecriture'): Promise<StravaAthlete> {
  const [e, app] = await Promise.all([strava.etat(id), strava.app(id)]);
  const aujourdhui = aujourdhuiISO();
  const recues = db.select('msc_activity').filter((a) => a.date <= aujourdhui);
  return {
    id, nom, droit,
    strava: {
      configure: e.configure, app_propre: Boolean(e.app_propre), lie: e.lie,
      athlete: e.athlete && e.athlete.id != null ? { id: e.athlete.id, prenom: e.athlete.prenom, nom: e.athlete.nom } : null,
      portee: e.portee, lie_le: e.lie_le, derniere_synchro: e.derniere_synchro,
    },
    app,
    activites: { n: recues.length, derniere: recues.length ? recues[recues.length - 1].date : null },
  };
}

export function StravaScreen({ app }: { app: App }) {
  const t = T[app.lang];
  const id = db.athleteId;
  const nom = db.athlete.nom;
  const droit = db.droit;
  const [a, setA] = useState<StravaAthlete | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const recharger = useCallback(async () => {
    if (!id) return null;
    try {
      const x = await lireUn(id, nom, droit);
      setA(x);
      setErreur(null);
      return [x];
    } catch (e) {
      setErreur(message(e));
      return null;
    }
  }, [id, nom, droit]);

  useEffect(() => { void recharger(); }, [recharger]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 12.5, color: C.inkSecondary, lineHeight: 1.5 }}>{t.intro}</div>
      <Card padding="12px 16px" gap={0}>
        <div style={{ paddingBottom: 4 }}>
          <SectionLabel icon="link" color={C.teal}>{`${t.titre} · ${nom}`}</SectionLabel>
        </div>
        {erreur && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 12px', borderRadius: R.md, background: C.warningBg, color: C.warning, fontSize: 12, lineHeight: 1.4 }}>
            <Icon name="triangle-alert" size={14} />
            <span>{erreur}</span>
          </div>
        )}
        {a
          ? (
            <BlocStrava
              a={a}
              lang={app.lang}
              recharger={recharger}
              /* Un historique importé, c'est un instantané à relire : l'écran
                 Plan en tire sa carte. */
              onImporte={() => { void app.recharger(db.athleteId); }}
            />
          )
          : !erreur && <div style={{ color: C.inkSecondary, fontSize: 13, padding: '8px 0' }}>{t.chargement}</div>}
      </Card>
    </div>
  );
}
