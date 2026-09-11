/* La courbe du niveau : où il en est, où le plan le mène, et si ça suffit.

   Une seule grandeur en ordonnée — l'allure de référence au 10 km — et elle
   est renversée : plus haut veut dire plus rapide, ce qui est le seul sens
   dans lequel « monter » signifie progresser. Deux axes sur un même graphique
   diraient deux choses à la fois et n'en diraient aucune.

   Trois traits, un seul sujet :

     prévu      la trajectoire du plan, en pointillé gris — une référence,
                pas une série : elle n'a rien à revendiquer visuellement
     projeté    la même, corrigée par ce qu'il fait et comment il récupère
     observé    ses chronos de course, ramenés au 10 km — la seule mesure
                directe, donc la seule à mériter un point plein

   Et les compétitions en repères : un trait ambre, son chrono visé, son nom.
   La question que le graphique doit régler d'un coup d'œil est celle-là — la
   projection passe-t-elle au-dessus du repère ou en dessous. */

import type { CSSProperties } from 'react';
import { useState } from 'react';
import { C, F, R } from '../design/theme';
import { Card, Mono, SectionLabel } from './primitives';
import type { Progression as Donnees } from '../data/progression';
import type { Lang } from '../data/types';

/* La palette, vérifiée plutôt que choisie à l'œil : émeraude 600 et ambre
   passent la séparation daltonienne (ΔE 9,8 en protanopie, 20 en vision
   normale) et le contraste 3:1 sur fond blanc. Le gris du prévu n'est pas une
   série — c'est une ligne de référence, et elle porte son libellé. */
const NIVEAU = C.accentDeep;
const REPERE = C.warning;

/* Un repère fixe, et une mise à l'échelle uniforme. Étirer le SVG à la largeur
   disponible — preserveAspectRatio="none" — déforme tout ce qu'il contient : le
   texte des graduations se lisait « 3 5 : 3 0 » et les cercles devenaient des
   ovales. Le graphique garde donc ses proportions et grandit avec la page. */
const L = 640;
const H = 200;
const MARGE = { haut: 16, bas: 30, gauche: 46, droite: 62 };

function mmss(s: number): string {
  const t = Math.round(s * 10);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

export function Progression({ donnees, lang, titre }: {
  donnees: Donnees;
  lang: Lang;
  titre?: string;
}) {
  const fr = lang === 'fr';
  const [survol, setSurvol] = useState<number | null>(null);
  const [table, setTable] = useState(false);

  const points = donnees.points;
  if (points.length < 2) return null;

  /* L'échelle : toutes les valeurs qui comptent, plus une marge — y compris
     les cibles des compétitions, sans quoi un repère sortirait du cadre. */
  const valeurs = [
    ...points.map((p) => p.prevu),
    ...points.map((p) => p.projete).filter((v): v is number => v !== undefined),
    ...points.map((p) => p.observe).filter((v): v is number => v !== undefined),
    ...donnees.reperes.map((r) => r.cible).filter((v): v is number => v !== undefined),
    donnees.cible, donnees.depart,
  ];
  const min = Math.min(...valeurs) - 3;
  const max = Math.max(...valeurs) + 3;

  const x = (n: number) => MARGE.gauche + ((n - points[0].semaine)
    / Math.max(points[points.length - 1].semaine - points[0].semaine, 1))
    * (L - MARGE.gauche - MARGE.droite);
  /* Renversé : une allure plus petite est un niveau plus haut. */
  const y = (v: number) => MARGE.haut + ((v - min) / (max - min)) * (H - MARGE.haut - MARGE.bas);

  const trace = (cle: 'prevu' | 'projete') => points
    .map((p) => ({ n: p.semaine, v: p[cle] }))
    .filter((p): p is { n: number; v: number } => p.v !== undefined)
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.n).toFixed(2)} ${y(p.v).toFixed(1)}`)
    .join(' ');

  const graduations = [0, 0.25, 0.5, 0.75, 1].map((f) => min + (max - min) * f);
  const survole = survol === null ? null : points.find((p) => p.semaine === survol) ?? null;

  const mois = (iso: string) => new Date(`${iso}T00:00:00`)
    .toLocaleDateString(fr ? 'fr-FR' : 'pl-PL', { month: 'short' });

  /* Une étiquette par changement de mois — et seulement si la précédente est
     assez loin : huit mois serrés donnaient « aoûtseptoctnov.decjanvfévrmars ». */
  const etiquettes: typeof points = [];
  for (const [i, p] of points.entries()) {
    if (i > 0 && mois(p.date) === mois(points[i - 1].date)) continue;
    const avant = etiquettes[etiquettes.length - 1];
    if (avant && x(p.semaine) - x(avant.semaine) < 40) continue;
    etiquettes.push(p);
  }

  const legende: Array<{ nom: string; style: CSSProperties }> = [
    { nom: fr ? 'mesuré' : 'zmierzone', style: { background: NIVEAU, width: 9, height: 9, borderRadius: '50%' } },
    { nom: fr ? 'projeté' : 'projekcja', style: { background: NIVEAU, width: 16, height: 2 } },
    { nom: fr ? 'prévu par le plan' : 'plan', style: { background: C.inkQuiet, width: 16, height: 2, opacity: 0.6 } },
    { nom: fr ? 'compétition' : 'zawody', style: { background: REPERE, width: 2, height: 12 } },
  ];

  return (
    <Card padding="14px 16px" gap={10}>
      <SectionLabel icon="trending-up" color={C.teal}>
        {titre ?? (fr ? 'Son niveau, et où le plan le mène' : 'Jego poziom i dokąd prowadzi plan')}
      </SectionLabel>

      {/* Le chiffre d'abord : c'est la réponse, la courbe est l'explication. */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <Mono size={26} color={C.ink}>{`${mmss(donnees.niveau)}`}</Mono>
        <span style={{ fontSize: 12, color: C.inkSecondary }}>
          {fr ? 'au 10 km, aujourd’hui' : 'na 10 km, dziś'}
        </span>
        <span style={{ fontSize: 12, color: C.inkQuiet }}>
          {fr
            ? `départ ${mmss(donnees.depart)} · objectif ${mmss(donnees.cible)}`
            : `start ${mmss(donnees.depart)} · cel ${mmss(donnees.cible)}`}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${L} ${H}`}
        style={{ width: '100%', height: 'auto', display: 'block', touchAction: 'pan-y' }}
        role="img"
        aria-label={fr
          ? `Niveau au 10 km : ${mmss(donnees.niveau)} aujourd’hui, objectif ${mmss(donnees.cible)}.`
          : `Poziom na 10 km: ${mmss(donnees.niveau)} dziś, cel ${mmss(donnees.cible)}.`}
        onMouseLeave={() => setSurvol(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const part = (e.clientX - r.left) / r.width;
          const n = points[0].semaine
            + Math.round(part * (points[points.length - 1].semaine - points[0].semaine));
          setSurvol(Math.min(Math.max(n, points[0].semaine), points[points.length - 1].semaine));
        }}
      >
        {/* la grille, discrète : elle situe, elle ne se montre pas */}
        {graduations.map((v) => (
          <g key={v}>
            <line x1={MARGE.gauche} x2={L - MARGE.droite} y1={y(v)} y2={y(v)}
              stroke={C.borderSoft} strokeWidth={1} />
            <text x={MARGE.gauche - 6} y={y(v) + 4} fill={C.inkQuiet} fontSize={11}
              fontFamily={F.mono} textAnchor="end">
              {mmss(v)}
            </text>
          </g>
        ))}

        {/* les compétitions : un trait, son nom, et son chrono visé */}
        {donnees.reperes.map((r) => (
          <g key={`${r.date}-${r.nom}`}>
            <line x1={x(r.semaine)} x2={x(r.semaine)} y1={MARGE.haut} y2={H - MARGE.bas}
              stroke={REPERE} strokeWidth={1.5} strokeDasharray="3 3" opacity={0.75} />
            {r.cible !== undefined && (
              <circle cx={x(r.semaine)} cy={y(r.cible)} r={5} fill={C.surface}
                stroke={REPERE} strokeWidth={2} />
            )}
          </g>
        ))}

        {/* le plan : une référence, en pointillé, sans prétention */}
        <path d={trace('prevu')} fill="none" stroke={C.inkQuiet} strokeWidth={2}
          strokeDasharray="5 4" opacity={0.55} />
        {/* la projection : le trait qui répond à la question */}
        <path d={trace('projete')} fill="none" stroke={NIVEAU} strokeWidth={2.5}
          strokeLinecap="round" strokeLinejoin="round" />

        {/* ce qui a été couru : la seule mesure directe */}
        {points.filter((p) => p.observe !== undefined).map((p) => (
          <circle key={p.semaine} cx={x(p.semaine)} cy={y(p.observe as number)} r={5.5}
            fill={NIVEAU} stroke={C.surface} strokeWidth={2} />
        ))}

        {/* le survol : un trait et rien d'autre — la valeur se lit au-dessus */}
        {survole && (
          <line x1={x(survole.semaine)} x2={x(survole.semaine)} y1={MARGE.haut} y2={H - MARGE.bas}
            stroke={C.ink} strokeWidth={1.5} opacity={0.25} />
        )}

        {/* Les deux traits, nommés au bout : une légende oblige à faire
            l'aller-retour, l'étiquette est là où l'œil finit déjà. */}
        {(() => {
          const dernier = points[points.length - 1];
          const finPlan = dernier.prevu;
          const finProj = dernier.projete;
          return (
            <>
              <text x={L - MARGE.droite + 10} y={y(finPlan) + 4} fill={C.inkQuiet} fontSize={11}>
                {mmss(finPlan)}
              </text>
              {finProj !== undefined && (
                <text x={L - MARGE.droite + 10} y={y(finProj) + 4} fill={NIVEAU} fontSize={11}
                  fontWeight={600}>
                  {mmss(finProj)}
                </text>
              )}
            </>
          );
        })()}

        {etiquettes.map((p) => (
          <text key={p.semaine} x={x(p.semaine)} y={H - 10} fill={C.inkQuiet} fontSize={11}
            textAnchor="middle">
            {mois(p.date)}
          </text>
        ))}
      </svg>

      {/* Ce que le survol dit, en texte : une infobulle dans un SVG étiré se
          déforme, et un chiffre déformé ne se lit pas. */}
      <div style={{ minHeight: 18, fontSize: 12, color: C.inkBody }}>
        {survole ? (
          <span>
            <Mono size={11} color={C.inkQuiet}>{`S${survole.semaine} · ${survole.date}`}</Mono>
            {survole.observe !== undefined && (
              <span style={{ color: NIVEAU, fontWeight: 600 }}>{` · ${mmss(survole.observe)} ${fr ? 'couru' : 'przebiegnięte'}${survole.course ? ` (${survole.course})` : ''}`}</span>
            )}
            {survole.projete !== undefined && (
              <span>{` · ${mmss(survole.projete)} ${fr ? 'projeté' : 'projekcja'}`}</span>
            )}
            <span style={{ color: C.inkQuiet }}>{` · ${mmss(survole.prevu)} ${fr ? 'prévu' : 'plan'}`}</span>
          </span>
        ) : (
          <span style={{ color: C.inkQuiet }}>
            {fr ? 'Passe sur la courbe pour lire une semaine.' : 'Najedź na wykres, by odczytać tydzień.'}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        {legende.map((l) => (
          <span key={l.nom} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: C.inkSecondary }}>
            <span style={{ ...l.style, display: 'inline-block', flexShrink: 0 }} />
            {l.nom}
          </span>
        ))}
        <button
          type="button"
          onClick={() => setTable((v) => !v)}
          style={{ fontSize: 11, color: C.inkSecondary, textDecoration: 'underline', padding: 0 }}
        >
          {table ? (fr ? 'masquer les repères' : 'ukryj punkty') : (fr ? 'voir les repères' : 'pokaż punkty')}
        </button>
      </div>

      {/* La même chose en chiffres : une courbe ne se cite pas, et tout le
          monde ne lit pas un graphique. */}
      {table && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
            <thead>
              <tr>
                {[fr ? 'Compétition' : 'Zawody', fr ? 'Date' : 'Data', fr ? 'Visé' : 'Cel',
                  fr ? 'Projeté' : 'Projekcja', fr ? 'Écart' : 'Różnica'].map((h) => (
                  <th key={h} scope="col" style={{
                    textAlign: 'left', padding: '5px 8px', fontSize: 10, fontWeight: 600,
                    textTransform: 'uppercase', letterSpacing: '0.06em', color: C.inkSecondary,
                    borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {donnees.reperes.map((r) => {
                const p = points.find((q) => q.semaine === r.semaine);
                const proj = p?.projete ?? p?.prevu;
                const ecart = r.cible !== undefined && proj !== undefined ? proj - r.cible : null;
                return (
                  <tr key={`${r.date}-${r.nom}`}>
                    <td style={{ padding: '5px 8px', borderTop: `1px solid ${C.borderSoft}` }}>{r.nom}</td>
                    <td style={{ padding: '5px 8px', borderTop: `1px solid ${C.borderSoft}` }}>
                      <Mono size={11} color={C.inkBody}>{r.date}</Mono>
                    </td>
                    <td style={{ padding: '5px 8px', borderTop: `1px solid ${C.borderSoft}` }}>
                      <Mono size={11} color={C.ink}>{r.cible === undefined ? '—' : mmss(r.cible)}</Mono>
                    </td>
                    <td style={{ padding: '5px 8px', borderTop: `1px solid ${C.borderSoft}` }}>
                      <Mono size={11} color={C.ink}>{proj === undefined ? '—' : mmss(proj)}</Mono>
                    </td>
                    <td style={{ padding: '5px 8px', borderTop: `1px solid ${C.borderSoft}` }}>
                      <Mono size={11} color={ecart === null ? C.inkQuiet : ecart <= 0 ? C.accentDeep : C.warning}>
                        {ecart === null ? '—' : `${ecart <= 0 ? '−' : '+'}${mmss(Math.abs(ecart))}`}
                      </Mono>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pourquoi la projection dit ce qu'elle dit. Un facteur sans ses raisons
          est un chiffre qu'on subit. */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 3, padding: '8px 10px',
        borderRadius: R.md, background: C.surfaceAlt,
      }}>
        {donnees.pourquoi.map((ligne) => (
          <span key={ligne} style={{ fontSize: 11.5, color: C.inkSecondary, lineHeight: 1.4 }}>
            {ligne}
          </span>
        ))}
      </div>
    </Card>
  );
}
