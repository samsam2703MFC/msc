/* Le profil de l'athlète affiché, dans le back office : les mêmes champs que
   la feuille de profil du téléphone, les deux références 10 km d'où toutes
   les allures du plan sortent, et l'état de sa connexion Strava — vérifié
   d'un bouton, corrigé dans sa section Strava. */

import { useState } from 'react';
import * as db from '../data/db';
import * as strava from '../data/strava';
import type { Lang } from '../data/types';
import { C, F, R } from '../design/theme';
import { Icon } from '../components/Icon';
import { Card, SectionLabel } from '../components/primitives';
import { ProfilForm } from '../components/ProfilSheet';
import type { App } from '../state/useApp';

const T = {
  fr: {
    profil: 'Profil', references: 'Références 10 km', actuelle: 'actuelle', cible: 'cible',
    aide: 'Toutes les allures du plan sont calculées depuis ces deux nombres. L’onboarding les pose ; le test de 30 minutes recale la première ; un nouveau plan (section Plan) les réécrit.',
    strava: 'Connexion Strava', verifier: 'Vérifier la connexion', verification: 'Vérification…',
    connecte: 'connecté', nonConnecte: 'non connecté', nonConfigure: 'Strava non configuré pour cet athlète',
    synchro: 'dernière synchro', jamais: 'jamais', pasVerifie: 'pas encore vérifiée', versStrava: '→ Strava',
    aideStrava: 'Le compte Strava relié, et quand il a synchronisé pour la dernière fois. Pour relier, importer l’historique ou poser son application : sa section Strava.',
  },
  pl: {
    profil: 'Profil', references: 'Odniesienia 10 km', actuelle: 'obecne', cible: 'docelowe',
    aide: 'Wszystkie tempa planu liczone są z tych dwóch liczb. Onboarding je ustawia; test 30 minut koryguje pierwszą; nowy plan (sekcja Plan) je nadpisuje.',
    strava: 'Połączenie Strava', verifier: 'Sprawdź połączenie', verification: 'Sprawdzanie…',
    connecte: 'połączona', nonConnecte: 'niepołączona', nonConfigure: 'Strava nieskonfigurowana dla tego zawodnika',
    synchro: 'ostatnia synchronizacja', jamais: 'nigdy', pasVerifie: 'jeszcze niesprawdzone', versStrava: '→ Strava',
    aideStrava: 'Połączone konto Strava i kiedy ostatnio synchronizowało. Połączenie, import historii, własna aplikacja: jego sekcja Strava.',
  },
} satisfies Record<Lang, unknown>;

export function ProfilScreen({ app, onSection }: { app: App; onSection?: (s: 'strava') => void }) {
  const t = T[app.lang];
  const [etat, setEtat] = useState<strava.EtatStrava | null>(null);
  const [job, setJob] = useState<'idle' | 'verif'>('idle');
  const [erreur, setErreur] = useState<string | null>(null);

  const verifier = async () => {
    setJob('verif'); setErreur(null);
    try {
      setEtat(await strava.etat(db.athleteId));
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setJob('idle');
    }
  };

  const couleur = !etat ? C.inkQuiet : etat.lie ? C.accentDeep : etat.configure ? C.warning : C.negative;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Card padding="16px 18px" gap={12}>
        <SectionLabel icon="user" color={C.teal}>{`${t.profil} · ${db.athlete.nom}`}</SectionLabel>
        <ProfilForm app={app} onDone={() => undefined} />
      </Card>

      <Card padding="16px 18px" gap={8}>
        <SectionLabel icon="gauge" color={C.teal}>{t.references}</SectionLabel>
        <div style={{ display: 'flex', gap: 16, alignItems: 'baseline' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontFamily: F.mono, fontSize: 19, color: C.ink }}>{db.format10k(db.athlete.ref_actuelle_s)}</span>
            <span style={{ fontSize: 10.5, color: C.inkSecondary }}>{t.actuelle}</span>
          </div>
          <span style={{ color: C.inkQuiet }}>→</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontFamily: F.mono, fontSize: 19, color: C.ink }}>{db.format10k(db.athlete.ref_cible_s)}</span>
            <span style={{ fontSize: 10.5, color: C.inkSecondary }}>{t.cible}</span>
          </div>
        </div>
        <div style={{ fontSize: 11.5, color: C.inkSecondary, lineHeight: 1.45 }}>{t.aide}</div>
      </Card>

      <Card padding="16px 18px" gap={8}>
        <SectionLabel icon="link" color={C.teal}>{t.strava}</SectionLabel>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Icon name={etat?.lie ? 'circle-check' : etat ? 'triangle-alert' : 'circle-dashed'} size={15} color={couleur} />
          <span style={{ fontSize: 12.5, fontWeight: 600, color: couleur }}>
            {!etat
              ? t.pasVerifie
              : !etat.configure
                ? t.nonConfigure
                : etat.lie
                  ? `${t.connecte}${etat.athlete ? ` · ${[etat.athlete.prenom, etat.athlete.nom].filter(Boolean).join(' ')}` : ''}`
                  : t.nonConnecte}
          </span>
          {etat?.lie && (
            <span style={{ fontSize: 11, color: C.inkSecondary }}>
              {`· ${t.synchro} : ${etat.derniere_synchro ? String(etat.derniere_synchro).slice(0, 10) : t.jamais}`}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            disabled={job !== 'idle'}
            onClick={() => void verifier()}
            style={{ padding: '7px 12px', borderRadius: R.md, background: C.accent, color: C.accentInk, fontWeight: 700, fontSize: 12, border: 'none' }}
          >
            {job === 'verif' ? t.verification : t.verifier}
          </button>
          {onSection && (
            <button type="button" onClick={() => onSection('strava')} style={{ padding: '7px 12px', borderRadius: R.md, border: `1px solid ${C.border}`, color: C.inkMuted, fontSize: 12, fontWeight: 600, background: C.surface }}>
              {t.versStrava}
            </button>
          )}
        </div>
        {erreur && <div style={{ fontSize: 12, color: C.negative }}>{erreur}</div>}
        <div style={{ fontSize: 11, color: C.inkQuiet, lineHeight: 1.45 }}>{t.aideStrava}</div>
      </Card>
    </div>
  );
}
