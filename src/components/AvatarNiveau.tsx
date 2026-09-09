/* La tête d'un athlète selon son palier — la transformation, façon shōnen.
   Les cheveux disent tout : courts et sombres au départ, en pointes au
   deuxième palier, dorés au troisième, avec la foudre au quatrième, en
   crinière au cinquième, argentés au dernier. Le visage ne change pas :
   c'est la même personne, et un petit badge d'initiales le rappelle. */

import { C, F } from '../design/theme';

const TRAIT = '#0B1D2E';
const PEAU = '#F4C9A5';

const PALIER_STYLE: Record<number, { cheveux: string; aura: string; foudre?: boolean; criniere?: boolean; pointes: boolean }> = {
  1: { cheveux: '#2B2B2B', aura: '#E8ECEF', pointes: false },
  2: { cheveux: '#1B1B1B', aura: '#E3EEF6', pointes: true },
  3: { cheveux: '#F5C518', aura: '#FFF3B0', pointes: true },
  4: { cheveux: '#FFD43B', aura: '#FFF0A6', pointes: true, foudre: true },
  5: { cheveux: '#F2B705', aura: '#FFE98A', pointes: true, criniere: true },
  6: { cheveux: '#DCEBFF', aura: '#C9E0FF', pointes: true, foudre: true },
};

function initiales(nom: string): string {
  const mots = nom.trim().split(/\s+/).filter(Boolean);
  if (mots.length === 0) return '?';
  if (mots.length === 1) return mots[0].slice(0, 2).toUpperCase();
  return (mots[0][0] + mots[mots.length - 1][0]).toUpperCase();
}

export function AvatarNiveau({
  nom, palier = 1, taille = 48, teinte = C.ink, badge = true,
}: {
  nom: string; palier?: number; taille?: number; teinte?: string; badge?: boolean;
}) {
  const s = PALIER_STYLE[Math.max(1, Math.min(6, palier))];
  return (
    <div style={{ position: 'relative', width: taille, height: taille, flexShrink: 0 }} title={nom}>
      <svg width={taille} height={taille} viewBox="0 0 64 64" role="img" aria-label={nom} style={{ display: 'block' }}>
        <circle cx="32" cy="34" r="30" fill={s.aura} />
        {/* la crinière du cinquième palier tombe derrière les épaules */}
        {s.criniere && (
          <path d="M12 30 L8 62 L20 54 L18 40 Z M52 30 L56 62 L44 54 L46 40 Z" fill={s.cheveux} stroke={TRAIT} strokeWidth="1.5" strokeLinejoin="round" />
        )}
        {s.pointes ? (
          <path d="M14 34 L11 12 L21 22 L25 4 L32 17 L39 4 L43 22 L53 12 L50 34 Z" fill={s.cheveux} stroke={TRAIT} strokeWidth="1.5" strokeLinejoin="round" />
        ) : (
          <path d="M15 32 Q16 14 32 13 Q48 14 49 32 L44 28 Q32 22 20 28 Z" fill={s.cheveux} stroke={TRAIT} strokeWidth="1.5" strokeLinejoin="round" />
        )}
        <path d="M17 28 Q32 22 47 28 L46 44 Q44 54 32 56 Q20 54 18 44 Z" fill={PEAU} stroke={TRAIT} strokeWidth="2" />
        {palier >= 2 ? (
          <>
            <path d="M21 35 L29 37" stroke={TRAIT} strokeWidth="2.5" strokeLinecap="round" />
            <path d="M43 35 L35 37" stroke={TRAIT} strokeWidth="2.5" strokeLinecap="round" />
          </>
        ) : (
          <>
            <path d="M21 35 Q25 33 29 35" stroke={TRAIT} strokeWidth="2" strokeLinecap="round" fill="none" />
            <path d="M35 35 Q39 33 43 35" stroke={TRAIT} strokeWidth="2" strokeLinecap="round" fill="none" />
          </>
        )}
        <circle cx="25" cy="41" r="2.2" fill={palier >= 3 ? '#2A9D8F' : TRAIT} />
        <circle cx="39" cy="41" r="2.2" fill={palier >= 3 ? '#2A9D8F' : TRAIT} />
        <path d={palier >= 2 ? 'M26 49 L38 49' : 'M26 48 Q32 52 38 48'} stroke={TRAIT} strokeWidth="2.3" strokeLinecap="round" fill="none" />
        {/* la foudre des paliers 4 et 6 */}
        {s.foudre && (
          <>
            <path d="M6 20 L11 26 L7 28 L13 36" stroke="#4CB4FF" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M58 22 L53 28 L57 30 L51 38" stroke="#4CB4FF" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </>
        )}
      </svg>
      {badge && (
        <div
          style={{
            position: 'absolute', right: -2, bottom: -2,
            minWidth: Math.round(taille * 0.42), height: Math.round(taille * 0.42), padding: '0 3px',
            borderRadius: 999, background: teinte, color: '#FFFFFF',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: F.display, fontWeight: 700, fontSize: Math.max(8, Math.round(taille * 0.2)), lineHeight: 1,
            border: `2px solid ${C.surface}`, boxSizing: 'border-box',
          }}
        >
          {initiales(nom)}
        </div>
      )}
    </div>
  );
}
