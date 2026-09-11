/* Dupki — le classement du club, vu par l'athlète comme par le coach.

   Cinq axes plus la moyenne, une barre, un palier et sa pastille : qui en est
   où. C'est le seul écran du téléphone qui parle des autres, et c'est voulu —
   on s'entraîne mieux en sachant ce que fait le voisin.

   /api/classement rend tout le club à tout compte connecté : des noms et des
   scores, rien de ce qui appartient à quelqu'un. Le même composant sert la
   section « Classement » du back office : une seule version de la chose. */

import { useEffect, useState } from 'react';
import * as api from '../data/api';
import * as db from '../data/db';
import type { Axe, Classement as ClassementDonnees, Lang } from '../data/types';
import { C, F, R } from '../design/theme';
import { AvatarNiveau } from '../components/AvatarNiveau';
import { Icon } from '../components/Icon';
import type { App } from '../state/useApp';

const AXES: Array<{ code: Axe | 'total'; icon: string; nom: Record<Lang, string> }> = [
  { code: 'total', icon: 'zap', nom: { fr: 'Niveau', pl: 'Poziom' } },
  { code: 'endurance', icon: 'clock', nom: { fr: 'Endurance', pl: 'Wytrzymałość' } },
  { code: 'vitesse', icon: 'gauge', nom: { fr: 'Vitesse', pl: 'Szybkość' } },
  { code: 'velo', icon: 'bike', nom: { fr: 'Vélo', pl: 'Rower' } },
  { code: 'cap', icon: 'footprints', nom: { fr: 'CAP', pl: 'Bieg' } },
  { code: 'natation', icon: 'waves', nom: { fr: 'Natation', pl: 'Pływanie' } },
];

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/* D'où vient le score de l'axe choisi — le chiffre brut, pour que le
   classement ne soit pas une note tombée du ciel. */
function brutDe(l: ClassementDonnees['athletes'][number], axe: Axe | 'total', lang: Lang): string {
  const fr = lang === 'fr';
  switch (axe) {
    case 'endurance': return `${l.brut.heures_semaine} h/${fr ? 'sem' : 'tydz'}`;
    case 'velo': return `${l.brut.velo_h_semaine} h/${fr ? 'sem' : 'tydz'}`;
    case 'natation': return `${l.brut.nage_km_semaine} km/${fr ? 'sem' : 'tydz'}`;
    case 'cap': return `${mmss(l.brut.ref_10k_s)}/km`;
    case 'vitesse': return `${mmss(l.brut.vitesse_s)}/km${l.brut.vitesse_mesuree ? '' : fr ? ' (zone)' : ' (strefa)'}`;
    default: return `${fr ? 'moyenne' : 'średnia'} ${l.total}/100`;
  }
}

export function Dupki({ app }: { app: App }) {
  const lang = app.lang;
  const fr = lang === 'fr';
  const [donnees, setDonnees] = useState<ClassementDonnees | null>(null);
  const [axe, setAxe] = useState<Axe | 'total'>('total');

  useEffect(() => {
    let vivant = true;
    api.classement().then((c) => { if (vivant) setDonnees(c); }).catch(() => { if (vivant) setDonnees({ athletes: [], paliers: [] }); });
    return () => { vivant = false; };
  }, [app.version]);

  if (!donnees) return null;
  const score = (l: ClassementDonnees['athletes'][number]) => (axe === 'total' ? l.total : l.scores[axe]);
  const lignes = [...donnees.athletes].sort((a, b) => score(b) - score(a) || a.nom.localeCompare(b.nom));

  return (
    <div style={{ borderRadius: R.card, background: C.surface, border: `1px solid ${C.border}`, boxShadow: C.shadowCard, padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name="zap" size={16} color={C.teal} />
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.teal }}>
          {fr ? 'Niveaux de combat' : 'Poziomy mocy'}
        </div>
      </div>

      {/* l'axe : total ou une discipline */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {AXES.map((a) => {
          const on = axe === a.code;
          return (
            <button
              key={a.code}
              type="button"
              className="msc-hover-accent"
              aria-pressed={on}
              onClick={() => setAxe(a.code)}
              style={{
                display: 'flex', alignItems: 'center', gap: 5, padding: '5px 9px', borderRadius: R.full,
                border: `1px solid ${on ? C.accent : C.border}`, background: on ? C.accentSoft : C.surface,
                color: on ? C.accentDeep : C.inkMuted, fontSize: 11, fontWeight: 600,
              }}
            >
              <Icon name={a.icon} size={12} />
              {a.nom[lang]}
            </button>
          );
        })}
      </div>

      {lignes.map((l, i) => {
        const moi = l.id === db.athleteId;
        const nomComplet = [l.prenom, l.nom].filter(Boolean).join(' ') || l.nom;
        const v = score(l);
        return (
          <div
            key={l.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: R.md,
              border: `1px solid ${moi ? C.accent : C.border}`, background: moi ? C.accentSoft : C.page,
            }}
          >
            <div style={{ width: 18, fontFamily: F.mono, fontSize: 13, color: C.inkQuiet, textAlign: 'right' }}>{i + 1}</div>
            <AvatarNiveau nom={nomComplet} palier={l.palier.n} taille={44} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {l.surnom || l.prenom || l.nom}
                </div>
                <div style={{ fontSize: 11, color: C.inkQuiet, whiteSpace: 'nowrap' }}>{l.palier.nom[lang]}</div>
              </div>
              {/* la barre : remplissage et piste de la même teinte ; le chiffre à côté */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5 }}>
                <div style={{ flex: 1, height: 6, borderRadius: R.full, background: C.accentSoft, overflow: 'hidden' }}>
                  <div style={{ width: `${v}%`, height: '100%', background: C.accentBar, borderRadius: R.full }} />
                </div>
                <div style={{ fontFamily: F.mono, fontSize: 11, color: C.inkSecondary, whiteSpace: 'nowrap' }}>{brutDe(l, axe, lang)}</div>
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontFamily: F.mono, fontSize: 18, color: C.ink, lineHeight: 1 }}>
                {axe === 'total' ? l.puissance.toLocaleString(fr ? 'fr-FR' : 'pl-PL') : v}
              </div>
              <div style={{ fontSize: 9, color: C.inkQuiet, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {axe === 'total' ? (fr ? 'puissance' : 'moc') : '/100'}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
