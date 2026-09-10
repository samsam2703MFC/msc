/* L'année d'un coup d'œil : tout le plan, en tête de la semaine.

   Une colonne par semaine, une case par jour — du lundi en haut au dimanche
   en bas —, chaque case de la couleur de ce que la séance est devenue : faite,
   faite autrement, manquée, aujourd'hui, à venir, repos. Dessous, la charge de
   chaque semaine — prévue en clair, faite en émeraude par-dessus, dans la même
   unité — pour lire la périodisation d'un regard ; puis les blocs, et un
   drapeau au-dessus des semaines de compétition. Toucher une semaine y va.

   Tout est dérivé de ce que les écrans lisent déjà : les séances du plan,
   l'état des séances (activités et journal), les blocs, les compétitions. Rien
   n'est stocké pour ça. Les couleurs de statut portent chacune un mot dans la
   légende, jamais la teinte seule ; les cases sont séparées par un espace de
   la surface plutôt que par un trait. */

import * as db from '../data/db';
import { motDuStatut, visuelDuStatut } from '../data/statut';
import type { Lang, MscPlanSession, StatutCode } from '../data/types';
import { C, F } from '../design/theme';
import { useLargeur } from './Courbe';
import { Card, SectionLabel } from './primitives';
import type { App } from '../state/useApp';

const T: Record<Lang, Record<string, string>> = {
  fr: {
    titre: 'Le plan sur l’année', semaines: 'semaines', enCours: 'en cours', charge: 'charge · prévue / faite',
    competition: 'compétition', bloc: 'bloc', aller: 'Semaine',
  },
  pl: {
    titre: 'Plan na cały rok', semaines: 'tygodni', enCours: 'bieżący', charge: 'obciążenie · plan / zrobione',
    competition: 'zawody', bloc: 'blok', aller: 'Tydzień',
  },
};

/* Quand plusieurs séances tombent le même jour, la case dit la plus parlante :
   une manquée avant une faite, une faite avant une à venir. */
const PRIORITE: StatutCode[] = ['manque', 'partiel', 'fait', 'aujourdhui', 'adapte', 'prevu', 'repos'];

function jourDeSemaine(date: string): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7; //  lundi = 0
}

function plusJours(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function Annee({ app }: { app: App }) {
  const lang = app.lang;
  const t = T[lang];
  const { cadre, largeur: L } = useLargeur();

  const premiere = db.premiereSemaine;
  const derniere = db.derniereSemaine;
  const n = derniere - premiere + 1;
  if (n <= 0) return null;

  const etat = db.etatDesSeances();
  const blocs = db.blocs();

  /* Chaque semaine : ses séances, son lundi, sa charge prévue et faite. */
  const semaines = Array.from({ length: n }, (_, k) => {
    const w = premiere + k;
    const sessions = db.sessionsDeSemaine(w);
    const debut = sessions.reduce<string | null>((a, s) => (a === null || s.date < a ? s.date : a), null);
    const lundi = debut === null ? null : plusJours(debut, -jourDeSemaine(debut));
    const prevue = sessions.reduce((c, s) => c + s.charge, 0);
    const faite = sessions.filter((s) => etat.faites.has(s.id)).reduce((c, s) => c + s.charge, 0);
    const jours = new Map<number, StatutCode>();
    for (const s of sessions as MscPlanSession[]) {
      const code = db.statutDe(s, app.date, etat);
      const j = jourDeSemaine(s.date);
      const actuel = jours.get(j);
      if (!actuel || PRIORITE.indexOf(code) < PRIORITE.indexOf(actuel)) jours.set(j, code);
    }
    return { w, lundi, prevue, faite, jours };
  });
  const maxCharge = Math.max(1, ...semaines.map((s) => s.prevue));

  /* Les compétitions, chacune sur sa semaine — celles hors du plan n'ont pas
     de colonne. */
  const drapeaux = db.select('msc_competition')
    .map((c) => semaines.findIndex((s) => s.lundi && c.date >= s.lundi && c.date <= plusJours(s.lundi, 6)))
    .filter((k) => k >= 0);

  /* La géométrie : une colonne par semaine, des cases carrées. */
  const colW = L / n;
  const gap = Math.min(2, colW * 0.25);
  const cell = colW - gap;
  const yDrapeaux = 0;
  const hDrapeaux = 11;
  const yGrille = yDrapeaux + hDrapeaux;
  const hGrille = 7 * colW;
  const yBarres = yGrille + hGrille + 8;
  const hBarres = 26;
  const yBlocs = yBarres + hBarres + 5;
  const hBlocs = 13;
  const H = yBlocs + hBlocs;

  const couleurDe = (code: StatutCode): string => {
    if (code === 'prevu') return C.border;
    if (code === 'repos') return C.surfaceAlt;
    return visuelDuStatut(code).couleur;
  };

  const courante = app.semaine - premiere;

  return (
    <Card padding="14px 16px" gap={10}>
      <SectionLabel icon="calendar-days">
        {`${t.titre} · ${n} ${t.semaines}`}
      </SectionLabel>

      <div ref={cadre}>
        <svg
          viewBox={`0 0 ${L} ${H}`}
          width={L}
          height={H}
          style={{ width: '100%', height: H, display: 'block', overflow: 'visible' }}
          role="img"
          aria-label={`${t.titre}, ${n} ${t.semaines}`}
        >
          {/* les drapeaux des compétitions */}
          {drapeaux.map((k, i) => {
            const x = k * colW + cell / 2;
            return (
              <path
                key={`d${i}`}
                d={`M ${x} ${yDrapeaux + hDrapeaux - 1} v -9 h 5 l -1.6 2 l 1.6 2 h -5`}
                fill={C.ink}
                stroke={C.ink}
                strokeWidth={0.8}
                strokeLinejoin="round"
              />
            );
          })}

          {/* la grille : une case par séance */}
          {semaines.map((s, k) =>
            [...s.jours.entries()].map(([j, code]) => (
              <rect
                key={`${k}-${j}`}
                x={k * colW}
                y={yGrille + j * colW}
                width={cell}
                height={cell}
                rx={Math.min(1.5, cell / 4)}
                fill={couleurDe(code)}
              />
            )),
          )}
          {/* la semaine en cours, cernée */}
          {courante >= 0 && courante < n && (
            <rect
              x={courante * colW - gap / 2 - 0.5}
              y={yGrille - gap / 2 - 0.5}
              width={colW + 1}
              height={hGrille + 1}
              rx={2}
              fill="none"
              stroke={C.ink}
              strokeWidth={1.25}
            />
          )}

          {/* la charge par semaine : prévue en clair, faite par-dessus */}
          <line x1={0} x2={L} y1={yBarres + hBarres + 0.5} y2={yBarres + hBarres + 0.5} stroke={C.borderSoft} strokeWidth={1} />
          {semaines.map((s, k) => {
            const hp = (s.prevue / maxCharge) * hBarres;
            const hf = (s.faite / maxCharge) * hBarres;
            return (
              <g key={`b${k}`}>
                {hp > 0 && (
                  <rect x={k * colW} y={yBarres + hBarres - hp} width={cell} height={hp} rx={Math.min(1.5, cell / 4)} fill={C.surfaceAlt} />
                )}
                {hf > 0 && (
                  <rect x={k * colW} y={yBarres + hBarres - hf} width={cell} height={hf} rx={Math.min(1.5, cell / 4)} fill={C.accentBar} />
                )}
              </g>
            );
          })}

          {/* les blocs, en bandes alternées, la lettre quand elle tient */}
          {blocs.map((b, i) => {
            const x = (b.de - premiere) * colW;
            const w = (b.a - b.de + 1) * colW - gap;
            if (w <= 0) return null;
            return (
              <g key={b.code}>
                <rect x={x} y={yBlocs} width={w} height={hBlocs} rx={2} fill={C.teal} opacity={i % 2 ? 0.34 : 0.18} />
                {w >= 12 && (
                  <text x={x + w / 2} y={yBlocs + hBlocs - 3.5} textAnchor="middle" fontFamily={F.mono} fontSize={8} fontWeight={700} fill={C.teal}>
                    {b.code}
                  </text>
                )}
              </g>
            );
          })}

          {/* une cible par semaine — plus large que les cases : un doigt */}
          {semaines.map((s, k) => (
            <rect
              key={`t${k}`}
              x={k * colW}
              y={0}
              width={colW}
              height={H}
              fill="transparent"
              role="button"
              aria-label={`${t.aller} ${s.w}`}
              style={{ cursor: s.lundi ? 'pointer' : 'default' }}
              onClick={() => { if (s.lundi) app.allerA(s.lundi); }}
            >
              <title>{`${t.aller} ${s.w} · ${t.bloc} ${db.blocDeSemaine(s.w).code} · ${s.prevue}`}</title>
            </rect>
          ))}
        </svg>
      </div>

      {/* la légende : chaque teinte avec son mot */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontSize: 11, color: C.inkSecondary }}>
        {(['fait', 'partiel', 'manque', 'aujourdhui', 'prevu'] as const).map((code) => (
          <span key={code} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span aria-hidden style={{ width: 9, height: 9, borderRadius: 2, background: couleurDe(code), display: 'inline-block' }} />
            {motDuStatut(code, lang)}
          </span>
        ))}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span aria-hidden style={{ width: 9, height: 9, borderRadius: 2, background: C.surfaceAlt, display: 'inline-block' }} />
          <span aria-hidden style={{ width: 9, height: 9, borderRadius: 2, background: C.accentBar, display: 'inline-block', marginLeft: -3 }} />
          {t.charge}
        </span>
        {drapeaux.length > 0 && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span aria-hidden style={{ fontSize: 10, color: C.ink }}>⚑</span>
            {t.competition}
          </span>
        )}
      </div>
    </Card>
  );
}
