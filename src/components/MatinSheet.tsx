/* Le matin. Avant d'ouvrir le plan, deux chiffres : la FC de repos et la HRV.
   La forme se lit dessus, les alertes du protocole aussi, et une journée sans
   eux est une journée où le coach parle sans savoir. Le poids, lui, est
   bienvenu mais pas exigé — il vient aussi de la photo de la balance.

   Le panneau ne se ferme pas : pas de scrim cliquable, pas d'Échap. Il part
   quand la mesure est rangée. */

import { useState } from 'react';
import * as db from '../data/db';
import type { Lang } from '../data/types';
import { C, F, R } from '../design/theme';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import type { App } from '../state/useApp';

const T: Record<Lang, Record<string, string>> = {
  fr: {
    bonjour: 'Bonjour', titre: 'Ton corps ce matin',
    aide: 'Le plan et la forme se lisent sur ces deux chiffres. Sans eux, rien ne s’ouvre.',
    fc: 'FC de repos', hrv: 'HRV', poids: 'Poids', optionnel: 'optionnel',
    entrer: 'Enregistrer et entrer', enCours: 'Enregistrement…',
    fcAide: 'entre 25 et 120 bpm', hrvAide: 'entre 5 et 300 ms',
  },
  pl: {
    bonjour: 'Dzień dobry', titre: 'Twoje ciało dziś rano',
    aide: 'Plan i forma czytają się z tych dwóch liczb. Bez nich nic się nie otwiera.',
    fc: 'Tętno spoczynkowe', hrv: 'HRV', poids: 'Waga', optionnel: 'opcjonalnie',
    entrer: 'Zapisz i wejdź', enCours: 'Zapisywanie…',
    fcAide: 'od 25 do 120 bpm', hrvAide: 'od 5 do 300 ms',
  },
};

/* Les bornes de vraisemblance : un 0 ou un 400 est une faute de frappe, pas
   une mesure, et il vaut mieux la refuser ici qu'en faire une alerte. */
const FC = { min: 25, max: 120 };
const HRV = { min: 5, max: 300 };
const POIDS = { min: 30, max: 250 };

function nombre(s: string): number | null {
  const n = Number(s.replace(',', '.'));
  return s.trim() !== '' && Number.isFinite(n) ? n : null;
}

function Champ({
  label, unite, aide, value, onChange, valide, requis,
}: {
  label: string; unite: string; aide?: string; value: string; onChange: (v: string) => void;
  valide: boolean; requis: boolean;
}) {
  const touche = value.trim() !== '';
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: C.inkSecondary, fontWeight: 600, whiteSpace: 'nowrap' }}>
        {label}{requis ? ' *' : ''}
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{
            flex: 1, minWidth: 0, boxSizing: 'border-box', padding: '12px 14px', borderRadius: R.md,
            border: `1px solid ${touche && !valide ? C.negative : touche && valide ? C.accent : C.border}`,
            background: C.surface, color: C.ink, fontSize: 22, fontFamily: F.mono,
          }}
        />
        <span style={{ fontSize: 13, color: C.inkQuiet, minWidth: 34 }}>{unite}</span>
      </span>
      {/* la borne sous le champ, en rouge seulement quand la valeur tapée la dépasse */}
      {aide && (
        <span style={{ fontSize: 10.5, color: touche && !valide ? C.negative : C.inkQuiet }}>{aide}</span>
      )}
    </label>
  );
}

export function MatinSheet({ app }: { app: App }) {
  const t = T[app.lang];
  const [fc, setFc] = useState('');
  const [hrv, setHrv] = useState('');
  const [poids, setPoids] = useState('');
  const [job, setJob] = useState<'idle' | 'saving'>('idle');
  const [erreur, setErreur] = useState<string | null>(null);

  const fcN = nombre(fc);
  const hrvN = nombre(hrv);
  const poidsN = nombre(poids);
  const fcOk = fcN != null && fcN >= FC.min && fcN <= FC.max;
  const hrvOk = hrvN != null && hrvN >= HRV.min && hrvN <= HRV.max;
  const poidsOk = poids.trim() === '' || (poidsN != null && poidsN >= POIDS.min && poidsN <= POIDS.max);
  const pret = fcOk && hrvOk && poidsOk && job === 'idle';

  const prenom = db.athlete.prenom || db.athlete.surnom || db.athlete.nom;

  const envoyer = async () => {
    if (!pret || fcN == null || hrvN == null) return;
    setJob('saving'); setErreur(null);
    try {
      await app.validerMatin({
        fc_repos: Math.round(fcN),
        hrv_ms: Math.round(hrvN),
        poids_kg: poidsN == null ? undefined : Math.round(poidsN * 10) / 10,
      });
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
      setJob('idle');
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.titre}
      style={{ position: 'absolute', inset: 0, zIndex: 120, background: C.scrim, display: 'flex', alignItems: 'flex-end' }}
    >
      <form
        onSubmit={(e) => { e.preventDefault(); void envoyer(); }}
        style={{
          width: '100%', background: C.surface, borderRadius: '22px 22px 0 0',
          padding: '22px 22px 44px', display: 'flex', flexDirection: 'column', gap: 16,
          boxShadow: '0 -8px 30px rgba(0,0,0,0.18)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Avatar nom={[db.athlete.prenom, db.athlete.nom].filter(Boolean).join(' ')} taille={52} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, color: C.teal, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              {`${t.bonjour} ${prenom}`}
            </div>
            <div style={{ fontFamily: F.display, fontSize: 22, fontWeight: 600, color: C.ink, letterSpacing: '-0.01em' }}>
              {t.titre}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: C.inkSecondary, lineHeight: 1.5 }}>
          <Icon name="heart-pulse" size={16} color={C.accentDeep} />
          <span>{t.aide}</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 12 }}>
          <Champ label={t.fc} unite="bpm" aide={t.fcAide} value={fc} onChange={setFc} valide={fcOk} requis />
          <Champ label={t.hrv} unite="ms" aide={t.hrvAide} value={hrv} onChange={setHrv} valide={hrvOk} requis />
        </div>
        <Champ label={t.poids} unite="kg" aide={t.optionnel} value={poids} onChange={setPoids} valide={poidsOk} requis={false} />

        {erreur && <div style={{ fontSize: 12, color: C.negative }}>{erreur}</div>}

        <button
          type="submit"
          disabled={!pret}
          style={{
            padding: '14px 16px', borderRadius: R.md, background: C.accent, color: C.accentInk,
            fontWeight: 700, fontSize: 15, border: 'none', opacity: pret ? 1 : 0.45,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}
        >
          <Icon name={job === 'saving' ? 'loader' : 'sun'} size={18} />
          {job === 'saving' ? t.enCours : t.entrer}
        </button>
      </form>
    </div>
  );
}
