/* L'année d'un coup d'œil : tout le plan, en tête de la semaine.

   Une colonne par semaine, une case par jour — du lundi en haut au dimanche
   en bas —, chaque case de la couleur de ce que la séance est devenue : faite,
   faite autrement, manquée, aujourd'hui, à venir, repos. Dessous, la charge de
   chaque semaine — prévue en clair, faite en émeraude par-dessus, dans la même
   unité — pour lire la périodisation d'un regard ; puis les blocs, et un
   drapeau au-dessus des semaines de compétition. Toucher une semaine y va.

   Quarante-quatre semaines ne tiennent pas lisiblement dans la largeur d'un
   téléphone : les cases font quatorze pixels, et c'est le cadre qui défile —
   à l'ouverture, la semaine en cours est au milieu, et le doigt parcourt le
   reste. Une ligne de mois au-dessus dit où l'on est.

   Tout est dérivé de ce que les écrans lisent déjà : les séances du plan,
   l'état des séances (activités et journal), les blocs, les compétitions. Rien
   n'est stocké pour ça. Les couleurs de statut portent chacune un mot dans la
   légende, jamais la teinte seule ; les cases sont séparées par un espace de
   la surface plutôt que par un trait. */

import { useLayoutEffect } from 'react';
import * as db from '../data/db';
import { motDuStatut, visuelDuStatut } from '../data/statut';
import type { Lang, MscPlanSession, StatutCode } from '../data/types';
import { C, F } from '../design/theme';
import { useLargeur } from './Courbe';
import { Card, SectionLabel } from './primitives';
import type { App } from '../state/useApp';

const T: Record<Lang, Record<string, string>> = {
  fr: {
    titre: 'Le plan sur l’année', semaines: 'semaines', charge: 'charge · prévue / faite',
    competition: 'compétition', bloc: 'bloc', aller: 'Semaine', glisser: 'fais glisser',
  },
  pl: {
    titre: 'Plan na cały rok', semaines: 'tygodni', charge: 'obciążenie · plan / zrobione',
    competition: 'zawody', bloc: 'blok', aller: 'Tydzień', glisser: 'przesuń palcem',
  },
};

/* Quand plusieurs séances tombent le même jour, la case dit la plus parlante :
   une manquée avant une faite, une faite avant une à venir. */
const PRIORITE: StatutCode[] = ['manque', 'partiel', 'fait', 'aujourdhui', 'adapte', 'prevu', 'repos'];

/* La géométrie : une colonne de seize pixels par semaine, la case de quatorze,
   deux de surface entre deux cases. Fixe, pas étirée à la largeur : c'est le
   cadre qui défile. */
const COL = 16;
const GAP = 2;
const CELL = COL - GAP;

function jourDeSemaine(date: string): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7; //  lundi = 0
}

function plusJours(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function mois(date: string, lang: Lang, avecAnnee: boolean): string {
  const d = new Date(`${date}T00:00:00Z`);
  const m = d.toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'pl-PL', { month: 'short', timeZone: 'UTC' }).replace('.', '');
  return avecAnnee ? `${m} ${String(d.getUTCFullYear()).slice(2)}` : m;
}

export function Annee({ app }: { app: App }) {
  const lang = app.lang;
  const t = T[lang];
  const { cadre, largeur } = useLargeur();

  const premiere = db.premiereSemaine;
  const derniere = db.derniereSemaine;
  const n = derniere - premiere + 1;
  const courante = app.semaine - premiere;

  /* À l'ouverture, et quand la semaine change de loin : la semaine en cours
     au milieu du cadre. Un défilement que l'athlète a fait lui-même n'est pas
     repris tant que la semaine ne bouge pas. */
  useLayoutEffect(() => {
    const el = cadre.current;
    if (!el || n <= 0) return;
    const cible = courante * COL + COL / 2 - el.clientWidth / 2;
    el.scrollLeft = Math.max(0, Math.min(cible, n * COL - el.clientWidth));
  }, [cadre, courante, n, largeur]);

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

  /* Les mois : un libellé sur la première semaine qui commence dans un mois
     nouveau — l'année avec, en janvier et au départ. */
  const libellesMois = semaines
    .map((s, k) => {
      if (!s.lundi) return null;
      const m = s.lundi.slice(0, 7);
      const precedent = semaines.slice(0, k).reverse().find((x) => x.lundi)?.lundi?.slice(0, 7);
      if (k > 0 && precedent === m) return null;
      return { k, texte: mois(s.lundi, lang, k === 0 || s.lundi.slice(5, 7) === '01') };
    })
    .filter((x): x is { k: number; texte: string } => x !== null);

  /* Les compétitions, chacune sur sa semaine — celles hors du plan n'ont pas
     de colonne. */
  const drapeaux = db.select('msc_competition')
    .map((c) => semaines.findIndex((s) => s.lundi && c.date >= s.lundi && c.date <= plusJours(s.lundi, 6)))
    .filter((k) => k >= 0);

  const yMois = 0;
  const hMois = 12;
  const yDrapeaux = yMois + hMois;
  const hDrapeaux = 11;
  const yGrille = yDrapeaux + hDrapeaux;
  const hGrille = 7 * COL;
  const yBarres = yGrille + hGrille + 8;
  const hBarres = 26;
  const yBlocs = yBarres + hBarres + 5;
  const hBlocs = 14;
  const H = yBlocs + hBlocs;
  const L = n * COL;

  const couleurDe = (code: StatutCode): string => {
    if (code === 'prevu') return C.border;
    if (code === 'repos') return C.surfaceAlt;
    return visuelDuStatut(code).couleur;
  };

  return (
    <Card padding="14px 0 12px" gap={10}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, padding: '0 16px' }}>
        <SectionLabel icon="calendar-days">
          {`${t.titre} · ${n} ${t.semaines}`}
        </SectionLabel>
        <span style={{ fontSize: 10, color: C.inkQuiet, whiteSpace: 'nowrap' }}>{`← ${t.glisser} →`}</span>
      </div>

      {/* le cadre qui défile — la surface du doigt est la carte entière */}
      <div
        ref={cadre}
        style={{
          overflowX: 'auto', overflowY: 'hidden', padding: '0 16px',
          WebkitOverflowScrolling: 'touch', scrollbarWidth: 'thin',
        }}
      >
        <svg
          viewBox={`0 0 ${L} ${H}`}
          width={L}
          height={H}
          style={{ width: L, height: H, display: 'block', overflow: 'visible', flexShrink: 0 }}
          role="img"
          aria-label={`${t.titre}, ${n} ${t.semaines}`}
        >
          {/* les mois */}
          {libellesMois.map(({ k, texte }) => (
            <g key={`m${k}`}>
              <line x1={k * COL - GAP / 2} x2={k * COL - GAP / 2} y1={yMois + 2} y2={yGrille + hGrille} stroke={C.borderSoft} strokeWidth={1} />
              <text x={k * COL + 1} y={yMois + 9} fontFamily={F.mono} fontSize={9} fill={C.inkSecondary}>{texte}</text>
            </g>
          ))}

          {/* les drapeaux des compétitions */}
          {drapeaux.map((k, i) => {
            const x = k * COL + CELL / 2;
            return (
              <path
                key={`d${i}`}
                d={`M ${x} ${yDrapeaux + hDrapeaux - 1} v -9 h 6 l -2 2 l 2 2 h -6`}
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
                x={k * COL}
                y={yGrille + j * COL}
                width={CELL}
                height={CELL}
                rx={3}
                fill={couleurDe(code)}
              />
            )),
          )}
          {/* la semaine en cours, cernée */}
          {courante >= 0 && courante < n && (
            <rect
              x={courante * COL - GAP / 2 - 0.5}
              y={yGrille - GAP / 2 - 0.5}
              width={COL + 1}
              height={hGrille + 1}
              rx={4}
              fill="none"
              stroke={C.ink}
              strokeWidth={1.5}
            />
          )}

          {/* la charge par semaine : prévue en clair, faite par-dessus */}
          <line x1={0} x2={L} y1={yBarres + hBarres + 0.5} y2={yBarres + hBarres + 0.5} stroke={C.borderSoft} strokeWidth={1} />
          {semaines.map((s, k) => {
            const hp = (s.prevue / maxCharge) * hBarres;
            const hf = (s.faite / maxCharge) * hBarres;
            return (
              <g key={`b${k}`}>
                {hp > 0 && <rect x={k * COL} y={yBarres + hBarres - hp} width={CELL} height={hp} rx={2} fill={C.surfaceAlt} />}
                {hf > 0 && <rect x={k * COL} y={yBarres + hBarres - hf} width={CELL} height={hf} rx={2} fill={C.accentBar} />}
              </g>
            );
          })}

          {/* les blocs, en bandes alternées, la lettre au milieu */}
          {blocs.map((b, i) => {
            const x = (b.de - premiere) * COL;
            const w = (b.a - b.de + 1) * COL - GAP;
            if (w <= 0) return null;
            return (
              <g key={b.code}>
                <rect x={x} y={yBlocs} width={w} height={hBlocs} rx={3} fill={C.teal} opacity={i % 2 ? 0.34 : 0.18} />
                <text x={x + w / 2} y={yBlocs + hBlocs - 4} textAnchor="middle" fontFamily={F.mono} fontSize={9} fontWeight={700} fill={C.teal}>
                  {b.code}
                </text>
              </g>
            );
          })}

          {/* une cible par semaine — la colonne entière, du mois au bloc */}
          {semaines.map((s, k) => (
            <rect
              key={`t${k}`}
              x={k * COL - GAP / 2}
              y={0}
              width={COL}
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
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontSize: 11, color: C.inkSecondary, padding: '0 16px' }}>
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
