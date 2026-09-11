/* Le déroulé d'une séance, à l'écran.

   Une ligne par étape : sa durée, ce que c'est, son allure, sa plage de FC.
   Les blocs répétés portent leur « ×6 » plutôt que d'être écrits six fois —
   une liste de douze lignes identiques ne se lit pas, et c'est bien six fois
   la même chose qu'on fait.

   Rien n'est stocké : tout se calcule du type, de la durée et de la référence
   du bloc (src/data/deroule.ts). */

import { C, F, R } from '../design/theme';
import { Icon } from './Icon';
import { Mono, SectionLabel } from './primitives';
import { deroule } from '../data/deroule';
import type { MscPlanSession, Lang } from '../data/types';

const COULEUR = {
  echauffement: C.inkQuiet,
  travail: C.accentDeep,
  recuperation: C.inkSecondary,
  retour: C.inkQuiet,
} as const;

export function Deroule({ session, lang }: { session: MscPlanSession; lang: Lang }) {
  const fr = lang === 'fr';
  const d = deroule(session);
  if (!d || d.etapes.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <SectionLabel icon="list">{fr ? 'Le déroulé' : 'Przebieg'}</SectionLabel>
      <div style={{
        display: 'flex', flexDirection: 'column',
        borderRadius: R.md, border: `1px solid ${C.border}`, overflow: 'hidden',
      }}>
        {d.etapes.map((e, i) => (
          <div
            key={`${e.role}-${i}`}
            style={{
              display: 'flex', alignItems: 'baseline', gap: 10, padding: '9px 11px',
              borderTop: i === 0 ? 'none' : `1px solid ${C.borderSoft}`,
              background: e.role === 'travail' ? C.accentSoft : 'transparent',
            }}
          >
            <Mono size={12} color={COULEUR[e.role]} style={{ width: 62, flexShrink: 0 }}>
              {e.repetitions && e.repetitions > 1
                ? `${e.repetitions}× ${e.minutes}′`
                : `${e.minutes}′`}
            </Mono>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 13, color: C.ink }}>{e.libelle[lang]}</span>
              {e.fc && (
                <span style={{ fontSize: 11, color: C.inkQuiet, fontFamily: F.mono }}>
                  {`${e.fc[0]}–${e.fc[1]} bpm`}
                </span>
              )}
            </div>
            {e.allure && <Mono size={12} color={C.inkBody}>{e.allure}</Mono>}
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11, color: C.inkQuiet, lineHeight: 1.45, display: 'flex', alignItems: 'flex-start', gap: 5 }}>
        <Icon name="info" size={12} />
        <span>
          {d.fcMax && d.fcRepos
            ? (fr
              ? `Les plages de FC viennent de sa réserve : repos ${d.fcRepos} bpm, max estimée ${d.fcMax} bpm (Tanaka, depuis son année de naissance). Les allures viennent de la référence de son bloc.`
              : `Zakresy tętna z rezerwy: spoczynek ${d.fcRepos}, maks. ${d.fcMax} (Tanaka). Tempa z odniesienia bloku.`)
            : (fr
              ? 'Pas de plage de FC : il manque son année de naissance (Profil) ou des FC de repos du matin. Les allures, elles, viennent de la référence de son bloc.'
              : 'Brak zakresów tętna: brakuje roku urodzenia lub porannych pomiarów tętna.')}
        </span>
      </div>
    </div>
  );
}
