/* La jauge de forme : ce que la FC de repos et la HRV du matin disent, entre ce
   qui est derrière et ce qui arrive.

   Un cadran sur dix, dont la couleur porte la sévérité (émeraude → ambre →
   brazier) et dont la piste est un pas plus clair de la même teinte, pour que
   l'état se lise sur tout l'arc. Le score est le chiffre-héros ; l'état est
   toujours dit par une icône ET un mot en encre — jamais par la couleur seule.
   Dessous, deux barres de la même teinte : la charge des sept jours passés
   (faite) et celle des sept à venir (prévue), dans la même unité pour se
   comparer. Et les deux mesures, avec leur écart à la ligne de base. */

import { useState } from 'react';
import type { ApercuAthlete, Lang, NiveauForme } from '../data/types';
import { C, F, R } from '../design/theme';
import { FormeCourbes } from './FormeCourbes';
import { Icon } from './Icon';

const ETAT: Record<NiveauForme, { icon: string; fr: string; pl: string }> = {
  excellent: { icon: 'sparkles', fr: 'Excellent — journée dure possible', pl: 'Świetnie — ciężki dzień możliwy' },
  bon: { icon: 'circle-check', fr: 'Bon — qualité possible', pl: 'Dobrze — jakość możliwa' },
  attention: { icon: 'clock-alert', fr: 'Attention — repos ou facile', pl: 'Uwaga — odpoczynek lub lekko' },
  fatigue: { icon: 'battery-low', fr: 'Fatigué — repos', pl: 'Zmęczenie — odpoczynek' },
};

const ALERTE: Record<string, { fr: string; pl: string }> = {
  fc_repos_haute: { fr: 'FC de repos à +3 : stress sympathique', pl: 'Tętno spoczynkowe +3: stres' },
  hrv_chute: { fr: 'HRV en chute de 10 % : fatigue accumulée', pl: 'HRV spadło o 10%: zmęczenie' },
};

/* La sévérité choisit la teinte ; la piste est la même teinte, un pas plus
   clair, comme le contrat « meter » le demande. */
function teinte(niveau: NiveauForme): { fill: string; track: string } {
  if (niveau === 'attention') return { fill: C.warning, track: C.warningBg };
  if (niveau === 'fatigue') return { fill: C.negative, track: 'rgba(216,90,48,0.16)' };
  return { fill: C.accentBar, track: C.accentSoft };
}

/** Un demi-cercle, de 0 à 10. */
function Cadran({ score, niveau }: { score: number; niveau: NiveauForme }) {
  const r = 44;
  const longueur = Math.PI * r; //  la demi-circonférence
  const part = Math.max(0, Math.min(1, score / 10));
  const { fill, track } = teinte(niveau);
  return (
    <svg width={120} height={72} viewBox="0 0 120 72" role="img" aria-label={`${score} sur 10`}>
      <path
        d="M 16 64 A 44 44 0 0 1 104 64"
        fill="none"
        stroke={track}
        strokeWidth={10}
        strokeLinecap="round"
      />
      <path
        d="M 16 64 A 44 44 0 0 1 104 64"
        fill="none"
        stroke={fill}
        strokeWidth={10}
        strokeLinecap="round"
        strokeDasharray={`${longueur * part} ${longueur}`}
      />
      <text
        x={60}
        y={62}
        textAnchor="middle"
        fontFamily={F.body}
        fontSize={30}
        fontWeight={600}
        fill={C.ink}
      >
        {score}
      </text>
    </svg>
  );
}

function Ecart({ actuel, base, unite, hausseBonne }: {
  actuel: number | null; base: number | null; unite: string; hausseBonne: boolean;
}) {
  if (actuel == null) return <span style={{ color: C.inkQuiet }}>—</span>;
  const d = base == null ? null : actuel - base;
  const bon = d == null ? null : hausseBonne ? d >= 0 : d <= 0;
  return (
    <span style={{ fontFamily: F.mono, fontSize: 13, color: C.ink }}>
      {actuel}
      <span style={{ color: C.inkQuiet }}> {unite}</span>
      {d != null && d !== 0 && (
        <span style={{ marginLeft: 6, fontSize: 11, color: bon ? C.accentDeep : C.negative }}>
          {d > 0 ? '+' : ''}{d}
        </span>
      )}
    </span>
  );
}

/* Les deux courbes, repliées sous la jauge : la carte d'un athlète reste
   courte tant qu'on ne les demande pas. */
function CourbesRepliees({ a, lang }: { a: Pick<ApercuAthlete, 'courbes'>; lang: Lang }) {
  const [ouvert, setOuvert] = useState(false);
  if (!a.courbes) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <button
        type="button"
        className="msc-hover-accent"
        aria-expanded={ouvert}
        onClick={() => setOuvert((v) => !v)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 600, color: C.inkSecondary, alignSelf: 'flex-start' }}
      >
        <Icon name="trending-up" size={14} />
        {lang === 'fr' ? 'Base endurance et récupération HRV' : 'Baza wytrzymałościowa i regeneracja HRV'}
        <Icon name="chevron-right" size={13} style={{ transform: ouvert ? 'rotate(90deg)' : undefined }} />
      </button>
      {ouvert && <FormeCourbes courbes={a.courbes} lang={lang} compact />}
    </div>
  );
}

export function FormeJauge({ a, lang, compact = false }: {
  a: Pick<ApercuAthlete, 'forme' | 'mesure' | 'base' | 'charge' | 'courbes'>;
  lang: Lang;
  compact?: boolean;
}) {
  const fr = lang === 'fr';
  const { forme, mesure, base, charge } = a;
  const maxCharge = Math.max(charge.passee_7j, charge.a_venir_7j, 1);

  if (!forme) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 12, color: C.inkSecondary, lineHeight: 1.4 }}>
          {fr
            ? 'Pas encore de forme lisible : il faut une FC de repos ou une HRV du matin, et de quoi les comparer.'
            : 'Brak danych o formie: potrzebne tętno spoczynkowe lub HRV i punkt odniesienia.'}
        </div>
        <CourbesRepliees a={a} lang={lang} />
      </div>
    );
  }

  const etat = ETAT[forme.niveau];
  const { fill } = teinte(forme.niveau);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 8 : 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Cadran score={forme.score} niveau={forme.niveau} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.ink, fontWeight: 600, fontSize: 13 }}>
            <Icon name={etat.icon} size={15} color={fill} />
            <span>{fr ? etat.fr : etat.pl}</span>
          </div>
          {forme.alertes.map((code) => (
            <div key={code} style={{ marginTop: 4, fontSize: 11, color: C.inkSecondary, display: 'flex', gap: 5 }}>
              <Icon name="info" size={12} color={C.inkQuiet} />
              <span>{ALERTE[code] ? (fr ? ALERTE[code].fr : ALERTE[code].pl) : code}</span>
            </div>
          ))}
        </div>
      </div>

      {/* passé ↔ à venir : deux barres, même teinte, étiquetées */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {[
          { l: fr ? '7 j passés · fait' : '7 dni · zrobione', v: charge.passee_7j },
          { l: fr ? '7 j à venir · prévu' : '7 dni · zaplanowane', v: charge.a_venir_7j },
        ].map(({ l, v }) => (
          <div key={l} style={{ display: 'grid', gridTemplateColumns: '112px 1fr 44px', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: C.inkSecondary }}>{l}</span>
            <div style={{ height: 6, borderRadius: R.full, background: C.surfaceAlt, overflow: 'hidden' }} title={`${v}`}>
              <div style={{ width: `${(v / maxCharge) * 100}%`, height: '100%', background: C.accentBar, borderRadius: R.full }} />
            </div>
            <span style={{ fontFamily: F.mono, fontSize: 11, color: C.ink, textAlign: 'right' }}>{v}</span>
          </div>
        ))}
      </div>

      {!compact && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.inkQuiet }}>
              {fr ? 'FC de repos' : 'Tętno spocz.'}
            </div>
            <Ecart actuel={mesure?.fc_repos ?? null} base={base.fc_repos} unite="bpm" hausseBonne={false} />
          </div>
          <div>
            <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.inkQuiet }}>HRV</div>
            <Ecart actuel={mesure?.hrv_ms ?? null} base={base.hrv_ms} unite="ms" hausseBonne />
          </div>
        </div>
      )}
    </div>
  );
}
