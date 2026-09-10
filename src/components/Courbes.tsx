/* Plusieurs séries dans un cadre — la même unité, exprès.

   `Courbe` refuse deux axes, et elle a raison : deux mesures d'unités
   différentes dans un cadre font lire une corrélation qui n'existe pas. Ici
   les séries partagent l'unité (la base et la fatigue sont deux lissages de
   la même charge ; la HRV et sa ligne de base sont des millisecondes), donc
   un seul axe suffit et le cadre les met en rapport sans mentir.

   Les règles du graphique : traits de 2 px, une grille en retrait avec trois
   repères chiffrés, une légende toujours là dès deux séries — un trait de la
   couleur à côté du nom, le nom en encre, jamais en couleur — et une
   étiquette directe au bout de chaque ligne. Aucun chiffre sur chaque point :
   le doigt sur le cadre lit la valeur, la ligne du dessous la dit. Les
   points quotidiens ne sont pas marqués (quatre-vingts ronds sur une ligne
   sont un mur) ; seuls le point touché et les jours à signaler le sont. */

import { useState } from 'react';
import type { Lang } from '../data/types';
import { C, F } from '../design/theme';
import { useLargeur } from './Courbe';

export interface Serie {
  code: string;
  label: string;
  couleur: string;
  /** Une valeur par date ; null quand le jour n'a rien. */
  valeurs: (number | null)[];
  /** Une ligne de référence : en pointillé, pas d'étiquette au bout. */
  reference?: boolean;
  /** Un lavis sous la ligne — la série principale. */
  lavis?: boolean;
}

const HAUTEUR = 124;
const MARGE = { haut: 16, bas: 18, gauche: 34, droite: 12 };

function jour(date: string, lang: Lang): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'pl-PL', { day: 'numeric', month: 'short' });
}

export function Courbes({
  dates,
  series,
  format,
  lang,
  vide,
  depuisZero = false,
  marques,
}: {
  dates: string[];
  series: Serie[];
  format: (v: number) => string;
  lang: Lang;
  vide: string;
  /** Vrai quand l'axe part de zéro — une charge ; faux pour zoomer — une HRV. */
  depuisZero?: boolean;
  /** Des jours à signaler d'un point plein : lesquels, en quelle teinte, et
      le mot qui va avec dans la légende. */
  marques?: { indices: number[]; couleur: string; label: string };
}) {
  const [touche, setTouche] = useState<number | null>(null);
  const { cadre, largeur: L } = useLargeur();

  const n = dates.length;
  if (n === 0) {
    return (
      <div ref={cadre} style={{ fontSize: 11, color: C.inkQuiet, fontStyle: 'italic', padding: '6px 0' }}>
        {vide}
      </div>
    );
  }

  const tout = series.flatMap((s) => s.valeurs).filter((v): v is number => v != null);
  const minBrut = depuisZero ? 0 : Math.min(...tout);
  const maxBrut = Math.max(...tout, depuisZero ? 1 : -Infinity);
  const marge = (maxBrut - minBrut) * 0.08 || Math.abs(maxBrut) * 0.02 || 1;
  const bas = depuisZero ? 0 : minBrut - marge;
  const haut = maxBrut + marge;

  const largeurTrace = L - MARGE.gauche - MARGE.droite;
  const hauteurTrace = HAUTEUR - MARGE.haut - MARGE.bas;
  const x = (i: number) => MARGE.gauche + (n === 1 ? largeurTrace / 2 : (i / (n - 1)) * largeurTrace);
  const y = (v: number) => MARGE.haut + (1 - (v - bas) / (haut - bas)) * hauteurTrace;

  /* Une ligne s'interrompt sur un trou plutôt que de le traverser. */
  const chemin = (valeurs: (number | null)[]) => {
    let d = '';
    let ouvert = false;
    valeurs.forEach((v, i) => {
      if (v == null) { ouvert = false; return; }
      d += `${ouvert ? ' L' : ' M'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
      ouvert = true;
    });
    return d.trim();
  };

  const actif = touche ?? n - 1;
  const repere = [haut - marge, (haut - marge + bas) / 2, bas];

  /* Les étiquettes au bout des lignes : une par série, écartées si deux
     tombent au même endroit. */
  const bouts = series
    .filter((s) => !s.reference)
    .map((s) => {
      let i = s.valeurs.length - 1;
      while (i >= 0 && s.valeurs[i] == null) i -= 1;
      return i >= 0 ? { s, i, y: y(s.valeurs[i] as number) } : null;
    })
    .filter((b): b is { s: Serie; i: number; y: number } => b !== null)
    .sort((a, b) => a.y - b.y);
  for (let k = 1; k < bouts.length; k += 1) {
    if (bouts[k].y - bouts[k - 1].y < 12) bouts[k].y = bouts[k - 1].y + 12;
  }

  const lire = (e: React.PointerEvent<SVGRectElement>) => {
    const boite = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - boite.left) / boite.width) * L;
    const i = Math.round(((px - MARGE.gauche) / largeurTrace) * (n - 1));
    setTouche(Math.max(0, Math.min(n - 1, i)));
  };

  return (
    <div ref={cadre} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <svg
        viewBox={`0 0 ${L} ${HAUTEUR}`}
        width={L}
        height={HAUTEUR}
        style={{ width: '100%', height: HAUTEUR, overflow: 'visible', display: 'block', touchAction: 'pan-y' }}
        role="img"
        aria-label={series.map((s) => `${s.label} : ${s.valeurs.filter((v) => v != null).slice(-1).map((v) => format(v as number))[0] ?? '—'}`).join(' · ')}
      >
        <defs>
          {series.filter((s) => s.lavis).map((s) => (
            <linearGradient key={s.code} id={`lavis-${s.code}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.couleur} stopOpacity="0.14" />
              <stop offset="100%" stopColor={s.couleur} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>

        {/* la grille et ses trois repères, en retrait */}
        {repere.map((v, k) => (
          <g key={k}>
            <line x1={MARGE.gauche} x2={L - MARGE.droite} y1={y(v)} y2={y(v)} stroke={C.borderSoft} strokeWidth={1} />
            <text x={MARGE.gauche - 6} y={y(v) + 3} textAnchor="end" fontFamily={F.mono} fontSize={9} fill={C.inkQuiet}>
              {format(v)}
            </text>
          </g>
        ))}

        {/* le lavis, puis les lignes — la référence dessous, les séries dessus */}
        {series.filter((s) => s.lavis).map((s) => {
          const d = chemin(s.valeurs);
          if (!d) return null;
          let dernier = s.valeurs.length - 1;
          while (dernier >= 0 && s.valeurs[dernier] == null) dernier -= 1;
          let premier = 0;
          while (premier < s.valeurs.length && s.valeurs[premier] == null) premier += 1;
          return (
            <path
              key={`lavis-${s.code}`}
              d={`${d} L ${x(dernier).toFixed(1)} ${(HAUTEUR - MARGE.bas).toFixed(1)} L ${x(premier).toFixed(1)} ${(HAUTEUR - MARGE.bas).toFixed(1)} Z`}
              fill={`url(#lavis-${s.code})`}
            />
          );
        })}
        {[...series].sort((a, b) => Number(Boolean(b.reference)) - Number(Boolean(a.reference))).map((s) => (
          <path
            key={s.code}
            d={chemin(s.valeurs)}
            fill="none"
            stroke={s.couleur}
            strokeWidth={s.reference ? 1.5 : 2}
            strokeDasharray={s.reference ? '4 3' : undefined}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {/* les jours à signaler */}
        {marques && series[0] && marques.indices.map((i) => {
          const v = series[0].valeurs[i];
          return v == null ? null : (
            <circle key={`m${i}`} cx={x(i)} cy={y(v)} r={3.5} fill={marques.couleur} stroke={C.surface} strokeWidth={1.5} />
          );
        })}

        {/* le curseur : une ligne, et un point par série */}
        <line x1={x(actif)} x2={x(actif)} y1={MARGE.haut - 4} y2={HAUTEUR - MARGE.bas} stroke={C.border} strokeWidth={1} />
        {series.map((s) => {
          const v = s.valeurs[actif];
          return v == null ? null : (
            <circle key={`c${s.code}`} cx={x(actif)} cy={y(v)} r={4} fill={C.surface} stroke={s.couleur} strokeWidth={2} />
          );
        })}

        {/* les étiquettes au bout des lignes : le nom, en encre */}
        {bouts.map(({ s, i, y: yy }) => (
          <text
            key={`b${s.code}`}
            x={Math.min(x(i) + 4, L - 2)}
            y={yy + 3}
            textAnchor={x(i) > L - 60 ? 'end' : 'start'}
            dx={x(i) > L - 60 ? -8 : 0}
            dy={x(i) > L - 60 ? -8 : 0}
            fontFamily={F.body}
            fontSize={9.5}
            fontWeight={600}
            fill={C.inkSecondary}
          >
            {s.label}
          </text>
        ))}

        {/* les deux dates qui bornent le cadre */}
        <text x={MARGE.gauche} y={HAUTEUR - 4} fontFamily={F.mono} fontSize={9} fill={C.inkQuiet}>{jour(dates[0], lang)}</text>
        {n > 1 && (
          <text x={L - MARGE.droite} y={HAUTEUR - 4} textAnchor="end" fontFamily={F.mono} fontSize={9} fill={C.inkQuiet}>
            {jour(dates[n - 1], lang)}
          </text>
        )}

        {/* la surface qui écoute le doigt — plus large que les lignes */}
        <rect
          x={MARGE.gauche - 8}
          y={0}
          width={largeurTrace + 16}
          height={HAUTEUR}
          fill="transparent"
          style={{ cursor: 'crosshair' }}
          onPointerMove={lire}
          onPointerDown={lire}
          /* Un doigt qui se lève « quitte » le cadre : la lecture resterait
             une fraction de seconde. Elle reste posée là où le doigt était ;
             une souris qui sort rend le dernier jour. */
          onPointerLeave={(e) => { if (e.pointerType !== 'touch') setTouche(null); }}
        />
      </svg>

      {/* la légende, et ce que le curseur lit : un trait de la couleur, le
          nom, la valeur — le texte reste en encre */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 14px', fontSize: 11, color: C.inkSecondary }}>
        <span style={{ fontFamily: F.mono, fontSize: 10, color: C.inkQuiet }}>{jour(dates[actif], lang)}</span>
        {series.map((s) => {
          const v = s.valeurs[actif];
          return (
            <span key={s.code} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span
                aria-hidden
                style={{
                  width: 14, height: 0, borderTop: `${s.reference ? 1.5 : 2}px ${s.reference ? 'dashed' : 'solid'} ${s.couleur}`,
                  display: 'inline-block',
                }}
              />
              <span>{s.label}</span>
              <span style={{ fontFamily: F.mono, color: C.ink }}>{v == null ? '—' : format(v)}</span>
            </span>
          );
        })}
        {marques && marques.indices.length > 0 && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span aria-hidden style={{ width: 7, height: 7, borderRadius: 7, background: marques.couleur, display: 'inline-block' }} />
            <span>{marques.label}</span>
          </span>
        )}
      </div>
    </div>
  );
}
