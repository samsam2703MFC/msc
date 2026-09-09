/* Les trois têtes de coach, façon shōnen : cheveux en pointes, traits épais,
   un aplat par zone. Dessinées ici plutôt que chargées : trois SVG de vingt
   lignes pèsent moins qu'une image, et ils prennent la taille qu'on leur donne. */

import { coachDe } from '../data/coachs';

const TRAIT = '#0B1D2E';
const PEAU = '#F4C9A5';
const ROSE = '#F2A7B8';
const ROSE_FONCE = '#D97A92';

function Tortionnaire() {
  return (
    <>
      {/* aura */}
      <circle cx="32" cy="34" r="28" fill="#F9D8CE" />
      {/* cheveux : la pointe en V sur le front, les mèches vers le haut */}
      <path
        d="M14 36 L10 12 L20 22 L24 4 L32 18 L40 4 L44 22 L54 12 L50 36 Z"
        fill={TRAIT}
      />
      {/* visage */}
      <path d="M17 28 Q32 22 47 28 L46 44 Q44 54 32 56 Q20 54 18 44 Z" fill={PEAU} stroke={TRAIT} strokeWidth="2" />
      {/* sourcils en colère */}
      <path d="M20 34 L30 38" stroke={TRAIT} strokeWidth="3" strokeLinecap="round" />
      <path d="M44 34 L34 38" stroke={TRAIT} strokeWidth="3" strokeLinecap="round" />
      {/* yeux */}
      <path d="M22 41 L29 41" stroke={TRAIT} strokeWidth="2.5" strokeLinecap="round" />
      <path d="M35 41 L42 41" stroke={TRAIT} strokeWidth="2.5" strokeLinecap="round" />
      {/* bouche serrée */}
      <path d="M26 50 L38 50" stroke={TRAIT} strokeWidth="2.5" strokeLinecap="round" />
      {/* cicatrice */}
      <path d="M40 44 L43 48" stroke={TRAIT} strokeWidth="1.5" strokeLinecap="round" />
    </>
  );
}

function Gentil() {
  return (
    <>
      <circle cx="32" cy="34" r="28" fill="#D5F2E9" />
      {/* cheveux : pointes plus rondes, penchées d'un côté */}
      <path
        d="M14 34 L12 16 L22 24 L26 8 L34 20 L42 8 L46 24 L54 18 L50 34 Z"
        fill={TRAIT}
      />
      <path d="M17 28 Q32 22 47 28 L46 44 Q44 54 32 56 Q20 54 18 44 Z" fill={PEAU} stroke={TRAIT} strokeWidth="2" />
      {/* sourcils levés, yeux ronds */}
      <path d="M21 35 Q25 32 29 35" stroke={TRAIT} strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <path d="M35 35 Q39 32 43 35" stroke={TRAIT} strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <circle cx="25" cy="41" r="2.4" fill={TRAIT} />
      <circle cx="39" cy="41" r="2.4" fill={TRAIT} />
      {/* sourire */}
      <path d="M25 48 Q32 54 39 48" stroke={TRAIT} strokeWidth="2.5" strokeLinecap="round" fill="none" />
      {/* col de gi */}
      <path d="M20 58 L32 62 L44 58" stroke="#E07A2F" strokeWidth="4" strokeLinecap="round" fill="none" />
    </>
  );
}

function GrosPorc() {
  return (
    <>
      <circle cx="32" cy="34" r="28" fill="#FBE3EA" />
      {/* oreilles */}
      <path d="M14 26 L18 12 L26 22 Z" fill={ROSE_FONCE} stroke={TRAIT} strokeWidth="2" strokeLinejoin="round" />
      <path d="M50 26 L46 12 L38 22 Z" fill={ROSE_FONCE} stroke={TRAIT} strokeWidth="2" strokeLinejoin="round" />
      {/* tête */}
      <ellipse cx="32" cy="38" rx="17" ry="16" fill={ROSE} stroke={TRAIT} strokeWidth="2" />
      {/* casquette */}
      <path d="M17 26 Q32 12 47 26 Z" fill="#3C9D6E" stroke={TRAIT} strokeWidth="2" strokeLinejoin="round" />
      <path d="M15 26 L49 26" stroke={TRAIT} strokeWidth="2.5" strokeLinecap="round" />
      {/* yeux mi-clos */}
      <path d="M22 36 L28 36" stroke={TRAIT} strokeWidth="2.5" strokeLinecap="round" />
      <path d="M36 36 L42 36" stroke={TRAIT} strokeWidth="2.5" strokeLinecap="round" />
      {/* groin */}
      <ellipse cx="32" cy="45" rx="8" ry="5.5" fill={ROSE_FONCE} stroke={TRAIT} strokeWidth="2" />
      <circle cx="29" cy="45" r="1.4" fill={TRAIT} />
      <circle cx="35" cy="45" r="1.4" fill={TRAIT} />
      {/* miette */}
      <circle cx="44" cy="50" r="1.6" fill="#B8742E" />
    </>
  );
}

export function CoachAvatar({ code, taille = 48 }: { code?: string | null; taille?: number }) {
  const coach = coachDe(code);
  return (
    <svg
      width={taille}
      height={taille}
      viewBox="0 0 64 64"
      role="img"
      aria-label={coach.nom.fr}
      style={{ flexShrink: 0, display: 'block' }}
    >
      {coach.code === 'tortionnaire' && <Tortionnaire />}
      {coach.code === 'gentil' && <Gentil />}
      {coach.code === 'gros_porc' && <GrosPorc />}
    </svg>
  );
}
