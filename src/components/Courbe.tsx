/* Une courbe d'évolution, en SVG, sans bibliothèque.

   Une série par graphique, et c'est délibéré : le poids est en kilogrammes et
   l'allure en secondes par kilomètre, et les mettre sur deux axes verticaux
   dans un même cadre est la façon la plus fiable de faire lire une corrélation
   qui n'existe pas. Deux cadres côte à côte disent la même chose sans mentir.

   La couleur ne porte donc aucune identité — le titre nomme la série, il n'y a
   pas de légende à avoir. Les deux teintes utilisées passent chacune la bande
   de clarté, le plancher de chroma et le contraste de 3:1 sur fond blanc ; les
   contrôles d'écart entre teintes ne s'appliquent pas, puisqu'elles ne se
   rencontrent jamais dans le même cadre.

   Un nombre sur chaque point encombrerait : seuls le premier et le dernier sont
   étiquetés — d'où l'athlète part, où il en est. Le reste se touche. */

import { useId, useLayoutEffect, useRef, useState } from 'react';
import { C, F, R } from '../design/theme';

export interface Point {
  /** L'abscisse, en ISO — les points sont supposés triés. */
  date: string;
  valeur: number;
  /** Ce que le point est : le nom d'une course, une semaine. */
  label?: string;
}

const HAUTEUR = 108;
const MARGE = { haut: 14, bas: 20, gauche: 10, droite: 10 };
const RAYON = 4.5;

/* Le viewBox est en pixels réels, mesurés, plutôt qu'en pourcentage étiré par
   `preserveAspectRatio="none"`. Un viewBox étiré aplatit la courbe correctement
   mais transforme aussi chaque point en ovale — ce qui ne se voit pas dans un
   validateur de couleurs et saute aux yeux dès qu'on regarde l'écran.

   Cette largeur sert avant la première mesure, le temps d'un rendu. */
const LARGEUR_DEFAUT = 320;

export function useLargeur() {
  const cadre = useRef<HTMLDivElement>(null);
  const [largeur, setLargeur] = useState(LARGEUR_DEFAUT);

  useLayoutEffect(() => {
    const el = cadre.current;
    if (!el) return undefined;
    const mesurer = () => setLargeur(el.clientWidth || LARGEUR_DEFAUT);
    mesurer();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const o = new ResizeObserver(mesurer);
    o.observe(el);
    return () => o.disconnect();
  }, []);

  return { cadre, largeur };
}

export function Courbe({
  points,
  couleur,
  format,
  /** Vrai quand une valeur plus BASSE est meilleure — une allure. */
  basMieux = false,
  vide,
}: {
  points: Point[];
  couleur: string;
  format: (v: number) => string;
  basMieux?: boolean;
  vide: string;
}) {
  const id = useId();
  const [touche, setTouche] = useState<number | null>(null);
  const { cadre, largeur } = useLargeur();

  if (points.length === 0) {
    return (
      <div ref={cadre} style={{ fontSize: 11, color: C.inkQuiet, fontStyle: 'italic', padding: '10px 0' }}>
        {vide}
      </div>
    );
  }

  /* Un seul point n'a pas de pente à montrer : la valeur suffit. */
  if (points.length === 1) {
    return (
      <div ref={cadre} style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <div style={{ fontFamily: F.mono, fontSize: 20, color: couleur }}>
          {format(points[0].valeur)}
        </div>
        <div style={{ fontSize: 11, color: C.inkQuiet }}>{points[0].label ?? points[0].date}</div>
      </div>
    );
  }

  const valeurs = points.map((p) => p.valeur);
  const min = Math.min(...valeurs);
  const max = Math.max(...valeurs);
  /* Une marge de 8 % en haut et en bas : une courbe qui touche le cadre se lit
     comme une courbe coupée. */
  const marge = (max - min) * 0.08 || Math.abs(max) * 0.02 || 1;
  const bas = min - marge;
  const haut = max + marge;

  const L = largeur;
  const x = (i: number) =>
    MARGE.gauche + (i / (points.length - 1)) * (L - MARGE.gauche - MARGE.droite);
  const y = (v: number) =>
    MARGE.haut + (1 - (v - bas) / (haut - bas)) * (HAUTEUR - MARGE.haut - MARGE.bas);

  const chemin = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.valeur)}`).join(' ');

  /* Le sens du progrès dépend de la mesure : une allure qui baisse est une
     bonne nouvelle, un poids qui baisse n'en est pas forcément une. */
  const delta = points[points.length - 1].valeur - points[0].valeur;
  const progres = basMieux ? delta < 0 : delta > 0;

  const actif = touche ?? points.length - 1;

  return (
    <div ref={cadre} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <svg
        viewBox={`0 0 ${L} ${HAUTEUR}`}
        width={L}
        height={HAUTEUR}
        style={{ width: '100%', height: HAUTEUR, overflow: 'visible', display: 'block' }}
        role="img"
        aria-label={points.map((p) => `${p.label ?? p.date} ${format(p.valeur)}`).join(', ')}
      >
        <defs>
          <linearGradient id={`${id}-remplissage`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={couleur} stopOpacity="0.16" />
            <stop offset="100%" stopColor={couleur} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* La grille est en retrait : elle situe, elle ne se regarde pas. */}
        {[0, 0.5, 1].map((f) => (
          <line
            key={f}
            x1={0}
            x2={L}
            y1={MARGE.haut + f * (HAUTEUR - MARGE.haut - MARGE.bas)}
            y2={MARGE.haut + f * (HAUTEUR - MARGE.haut - MARGE.bas)}
            stroke={C.borderSoft}
            strokeWidth={0.5}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        <path d={`${chemin} L ${x(points.length - 1)} ${HAUTEUR - MARGE.bas} L ${x(0)} ${HAUTEUR - MARGE.bas} Z`}
          fill={`url(#${id}-remplissage)`} />
        <path
          d={chemin}
          fill="none"
          stroke={couleur}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />

        {points.map((p, i) => (
          <g key={p.date + i}>
            {/* La cible tactile est plus large que le point : un doigt n'est pas
                un curseur. */}
            <circle
              cx={x(i)}
              cy={y(p.valeur)}
              r={RAYON * 2.6}
              fill="transparent"
              style={{ cursor: 'pointer' }}
              onPointerEnter={() => setTouche(i)}
              onPointerDown={() => setTouche(i)}
              onPointerLeave={() => setTouche(null)}
            />
            <circle
              cx={x(i)}
              cy={y(p.valeur)}
              r={i === actif ? RAYON + 1 : RAYON}
              fill={C.surface}
              stroke={couleur}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ))}
      </svg>

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, minWidth: 0 }}>
          <span style={{ fontFamily: F.mono, fontSize: 17, color: C.ink }}>
            {format(points[actif].valeur)}
          </span>
          <span
            style={{
              fontSize: 10,
              color: C.inkQuiet,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {points[actif].label ?? points[actif].date}
          </span>
        </div>
        <span
          style={{
            fontFamily: F.mono,
            fontSize: 11,
            padding: '2px 7px',
            borderRadius: R.full,
            background: progres ? C.accentSoft : C.surfaceAlt,
            color: progres ? C.accentDeep : C.inkSecondary,
            flexShrink: 0,
          }}
        >
          {`${delta > 0 ? '+' : delta < 0 ? '−' : ''}${format(Math.abs(delta))}`}
        </span>
      </div>
    </div>
  );
}
