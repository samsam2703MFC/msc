/* L'historique Strava d'un athlète, en tête de l'écran Plan : d'où l'on part
   avant d'écrire où l'on va.

   Une seule série — les kilomètres courus par semaine, cinquante-deux semaines
   — donc pas de légende, le titre la nomme ; un survol dit la semaine, ses
   kilomètres et ses séances ; la plus grosse semaine et la dernière portent
   leur chiffre. À côté, ce que le coach cherche vraiment : la moyenne des huit
   dernières semaines, la sortie la plus longue, et l'allure 10 km que les
   meilleures sorties impliquent (Riegel) — avec le bouton qui la pose comme
   allure actuelle du plan. */

import { useMemo, useState } from 'react';
import { aujourdhuiISO } from '../data/engine';
import { equivalent10k } from '../data/generateur';
import type { Lang, MscActivity } from '../data/types';
import { C, F, R } from '../design/theme';
import { Icon } from './Icon';
import { Card, SectionLabel } from './primitives';
import { useLargeur } from './Courbe';

const T = {
  fr: {
    titre: 'Historique Strava · km par semaine',
    vide: 'Aucune activité Strava avec une distance. Relie Strava (Connexions) et importe l’historique : c’est de là qu’un plan part.',
    moyenne: 'km / semaine', moyenneSous: 'moyenne 8 sem.',
    seances: 'séances / sem.', seancesSous: '8 dernières',
    longue: 'sortie la plus longue', estime: 'allure 10 km estimée', estimeSous: 'meilleure sortie · 26 sem.',
    utiliser: 'Utiliser comme allure actuelle', utilise: 'Posée',
    semaine: 'semaine du', km: 'km', seance: (n: number) => `${n} séance${n > 1 ? 's' : ''}`,
    mois: ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'],
  },
  pl: {
    titre: 'Historia Strava · km na tydzień',
    vide: 'Brak aktywności Strava z dystansem. Połącz Stravę (Połączenia) i zaimportuj historię: od niej zaczyna się plan.',
    moyenne: 'km / tydzień', moyenneSous: 'średnia 8 tyg.',
    seances: 'treningów / tydz.', seancesSous: 'ostatnie 8',
    longue: 'najdłuższy bieg', estime: 'szacowane tempo 10 km', estimeSous: 'najlepszy bieg · 26 tyg.',
    utiliser: 'Ustaw jako obecne tempo', utilise: 'Ustawiono',
    semaine: 'tydzień od', km: 'km', seance: (n: number) => `${n} trening${n === 1 ? '' : n < 5 ? 'i' : 'ów'}`,
    mois: ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'],
  },
} satisfies Record<Lang, unknown>;

const SEMAINES = 52;

function lundiDe(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const jour = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - jour);
  return d.toISOString().slice(0, 10);
}

function plusJours(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function mmss(s: number): string {
  const t = Math.round(s);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

interface Semaine {
  lundi: string;
  km: number;
  seances: number;
  encours: boolean;
}

export function resumerHistorique(activites: MscActivity[], aujourdhui: string) {
  const lundiCourant = lundiDe(aujourdhui);
  const debut = plusJours(lundiCourant, -7 * (SEMAINES - 1));
  const passees = activites.filter((a) => a.date <= aujourdhui && a.date >= debut);
  const semaines: Semaine[] = [];
  for (let i = SEMAINES - 1; i >= 0; i -= 1) {
    const lundi = plusJours(lundiCourant, -7 * i);
    const fin = plusJours(lundi, 6);
    const siennes = passees.filter((a) => a.date >= lundi && a.date <= fin);
    semaines.push({
      lundi,
      km: siennes.filter((a) => a.sport === 'run').reduce((t, a) => t + (a.distance_km ?? 0), 0),
      seances: siennes.length,
      encours: i === 0,
    });
  }
  const huit = semaines.slice(-9, -1);
  const moyenne = huit.length ? huit.reduce((t, s) => t + s.km, 0) / huit.length : 0;
  const seances = huit.length ? huit.reduce((t, s) => t + s.seances, 0) / huit.length : 0;
  const courses = passees.filter((a) => a.sport === 'run' && (a.distance_km ?? 0) > 0);
  const longue = courses.reduce<MscActivity | null>((m, a) => (!m || (a.distance_km ?? 0) > (m.distance_km ?? 0) ? a : m), null);
  /* L'allure 10 km que les sorties impliquent : Riegel sur chaque sortie d'au
     moins 5 km des 26 dernières semaines, la meilleure retenue. Une sortie
     lente n'abaisse rien — on cherche ce dont l'athlète est capable. */
  const depuis26 = plusJours(lundiCourant, -7 * 25);
  let dixKm: number | null = null;
  for (const a of courses) {
    if (a.date < depuis26 || (a.distance_km ?? 0) < 5 || !a.duree_s) continue;
    const s = equivalent10k(a.duree_s, a.distance_km as number);
    if (dixKm === null || s < dixKm) dixKm = s;
  }
  return { semaines, moyenne, seances, longue, dixKm, total: courses.length };
}

export function Historique({
  activites, lang, onUtiliserAllure,
}: {
  activites: MscActivity[]; lang: Lang; onUtiliserAllure?: (dixKmSecondes: number) => void;
}) {
  const t = T[lang];
  const aujourdhui = aujourdhuiISO();
  const r = useMemo(() => resumerHistorique(activites, aujourdhui), [activites, aujourdhui]);
  const { cadre, largeur } = useLargeur();
  const [survol, setSurvol] = useState<number | null>(null);
  const [pose, setPose] = useState(false);

  if (r.total === 0) {
    return (
      <Card padding="16px 18px" gap={8}>
        <SectionLabel icon="activity" color={C.teal}>{t.titre}</SectionLabel>
        <div style={{ fontSize: 12, color: C.inkSecondary, lineHeight: 1.5 }}>{t.vide}</div>
      </Card>
    );
  }

  const H = 110;
  const HAUT = 18;
  const BAS = 18;
  const max = Math.max(1, ...r.semaines.map((s) => s.km));
  const pas = largeur / SEMAINES;
  const barre = Math.max(2, pas - 2);
  const y = (km: number) => HAUT + (H - HAUT - BAS) * (1 - km / max);
  const iMax = r.semaines.reduce((m, s, i) => (s.km > r.semaines[m].km ? i : m), 0);
  const iDerniere = SEMAINES - 2;
  const etroit = largeur < 480;
  const actif = survol !== null ? r.semaines[survol] : null;

  return (
    <Card padding="16px 18px" gap={10}>
      <SectionLabel icon="activity" color={C.teal}>{t.titre}</SectionLabel>

      <div ref={cadre} style={{ width: '100%', position: 'relative' }}>
        <svg width={largeur} height={H} role="img" aria-label={t.titre} style={{ display: 'block', overflow: 'visible' }}>
          <line x1={0} x2={largeur} y1={y(0)} y2={y(0)} stroke={C.border} strokeWidth={1} />
          <line x1={0} x2={largeur} y1={y(max / 2)} y2={y(max / 2)} stroke={C.borderSoft} strokeWidth={1} />
          {r.semaines.map((s, i) => {
            const x = i * pas + (pas - barre) / 2;
            const h = Math.max(s.km > 0 ? 2 : 0, y(0) - y(s.km));
            const mois = new Date(`${s.lundi}T00:00:00Z`).getUTCMonth();
            const premierDuMois = s.lundi.slice(8, 10) <= '07';
            const etiquette = premierDuMois && (!etroit || mois % 2 === 0);
            return (
              <g key={s.lundi}
                onMouseEnter={() => setSurvol(i)} onMouseLeave={() => setSurvol(null)}
                onTouchStart={() => setSurvol(i)}>
                {/* zone de prise plus large que la barre */}
                <rect x={i * pas} y={HAUT - 6} width={pas} height={H - HAUT + 6} fill="transparent" />
                <rect
                  x={x} y={y(0) - h} width={barre} height={h} rx={2}
                  fill={s.encours ? C.accentSoft : survol === i ? C.accentDeep : C.accentBar}
                  stroke={s.encours ? C.accent : 'none'} strokeWidth={s.encours ? 1 : 0}
                />
                {etiquette && (
                  <text x={i * pas} y={H - 3} fontSize={9} fill={C.inkQuiet} fontFamily={F.mono}>{t.mois[mois]}</text>
                )}
                {(i === iMax || i === iDerniere) && s.km > 0 && survol === null && (
                  <text x={x + barre / 2} y={y(s.km) - 4} fontSize={10} fontFamily={F.mono} fill={C.inkSecondary} textAnchor="middle">
                    {`${Math.round(s.km)}`}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {actif && (
          <div
            style={{
              position: 'absolute', top: 0, left: Math.min(Math.max(0, (survol as number) * pas - 70), Math.max(0, largeur - 150)),
              padding: '4px 8px', borderRadius: R.sm, background: C.ink, color: C.surface, fontSize: 11, fontFamily: F.mono,
              pointerEvents: 'none', whiteSpace: 'nowrap',
            }}
          >
            {`${t.semaine} ${actif.lundi} · ${Math.round(actif.km)} ${t.km} · ${t.seance(actif.seances)}`}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
        <Chiffre valeur={`${Math.round(r.moyenne)}`} label={t.moyenne} sous={t.moyenneSous} />
        <Chiffre valeur={r.seances.toFixed(1)} label={t.seances} sous={t.seancesSous} />
        <Chiffre
          valeur={r.longue ? `${(r.longue.distance_km ?? 0).toFixed(1)} km` : '—'}
          label={t.longue}
          sous={r.longue?.date ?? ''}
        />
        <Chiffre valeur={r.dixKm ? `${mmss(r.dixKm)}/km` : '—'} label={t.estime} sous={r.dixKm ? `10 km ≈ ${mmss(r.dixKm * 10)} · ${t.estimeSous}` : t.estimeSous} />
      </div>

      {r.dixKm && onUtiliserAllure && (
        <div>
          <button
            type="button"
            onClick={() => { onUtiliserAllure(Math.round((r.dixKm as number) * 10)); setPose(true); setTimeout(() => setPose(false), 1500); }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: R.md, border: `1px solid ${C.accent}`, background: C.accentSoft, color: C.accentDeep, fontSize: 12, fontWeight: 600 }}
          >
            <Icon name={pose ? 'check' : 'arrow-right'} size={13} />
            {pose ? t.utilise : t.utiliser}
          </button>
        </div>
      )}
    </Card>
  );
}

function Chiffre({ valeur, label, sous }: { valeur: string; label: string; sous: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '8px 10px', borderRadius: R.md, background: C.page }}>
      <span style={{ fontFamily: F.mono, fontSize: 17, color: C.ink }}>{valeur}</span>
      <span style={{ fontSize: 10.5, color: C.inkSecondary }}>{label}</span>
      <span style={{ fontSize: 10, color: C.inkQuiet }}>{sous}</span>
    </div>
  );
}
