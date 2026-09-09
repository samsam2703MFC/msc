/* Le back office des athlètes : chacun en un coup d'œil, et un toucher pour
   passer sur lui. La phase et sa couleur, la semaine, les allures, ce qui est
   fait cette semaine, la forme. Tout vient de /api/apercu — rien n'est calculé
   deux fois. */

import { useEffect } from 'react';
import * as db from '../data/db';
import type { ApercuAthlete, Lang } from '../data/types';
import { C, F, R } from '../design/theme';
import { coachDe } from '../data/coachs';
import { Avatar } from '../components/Avatar';
import { CoachAvatar } from '../components/CoachAvatar';
import { FormeJauge } from '../components/FormeJauge';
import { Icon } from '../components/Icon';
import { limiteEnClair } from '../components/Limites';
import type { App } from '../state/useApp';

/* Même lecture que la frise des Paramètres : la phase se lit sur `part`. */
function phaseDe(part: number): { icon: string; couleur: string } {
  if (part <= 0) return { icon: 'leaf', couleur: C.teal };
  if (part < 0.5) return { icon: 'trending-down', couleur: C.accentDeep };
  if (part < 1) return { icon: 'flame', couleur: C.warning };
  return { icon: 'target', couleur: C.ink };
}

const T: Record<Lang, Record<string, string>> = {
  fr: { semaine: 'Semaine', sansPlan: 'Pas de plan actif', seances: 'séances', faites: 'faites',
        volume: 'Volume', rpe: 'Dernier RPE', voir: 'Ouvrir', chargement: 'Lecture des athlètes…',
        aucun: 'Aucun athlète visible pour ce compte.', courant: 'en cours' },
  pl: { semaine: 'Tydzień', sansPlan: 'Brak aktywnego planu', seances: 'treningi', faites: 'zrobione',
        volume: 'Objętość', rpe: 'Ostatnie RPE', voir: 'Otwórz', chargement: 'Wczytywanie zawodników…',
        aucun: 'Brak widocznych zawodników.', courant: 'bieżący' },
};

function h(min: number): string {
  const hh = Math.floor(min / 60); const mm = min % 60;
  return hh ? `${hh}h${String(mm).padStart(2, '0')}` : `${mm} min`;
}

function Carte({ a, app }: { a: ApercuAthlete; app: App }) {
  const t = T[app.lang];
  const fr = app.lang === 'fr';
  const courant = a.id === db.athleteId;
  const phase = a.bloc ? phaseDe(a.bloc.part) : null;
  const affiche = [a.prenom, a.nom].filter(Boolean).join(' ') || a.nom;

  return (
    <div
      style={{
        borderRadius: R.card, background: C.surface, padding: 14,
        border: `1px solid ${courant ? C.accent : C.border}`, boxShadow: C.shadowCard,
        display: 'flex', flexDirection: 'column', gap: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Avatar nom={affiche} taille={44} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: F.display, fontSize: 17, fontWeight: 600, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {affiche}
            {a.surnom && <span style={{ fontWeight: 500, color: C.inkSecondary }}> · {a.surnom}</span>}
          </div>
          {a.bloc && phase ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, fontSize: 12, color: phase.couleur, fontWeight: 600 }}>
              <Icon name={phase.icon} size={13} color={phase.couleur} />
              <span>{a.bloc.nom[app.lang]}</span>
              <span style={{ color: C.inkQuiet, fontWeight: 500 }}>· {t.semaine} {a.semaine}/{a.total}</span>
            </div>
          ) : (
            <div style={{ marginTop: 3, fontSize: 12, color: C.inkQuiet }}>{t.sansPlan}</div>
          )}
        </div>
        {!courant && (
          <button
            type="button"
            className="msc-hover-accent"
            onClick={() => void app.basculerAthlete(a.id)}
            aria-label={`${t.voir} ${affiche}`}
            style={{ padding: '7px 11px', borderRadius: R.full, border: `1px solid ${C.border}`, fontSize: 12, fontWeight: 600, color: C.ink, background: C.surface }}
          >
            {t.voir}
          </button>
        )}
        {courant && <span style={{ fontSize: 11, color: C.accentDeep, fontWeight: 600 }}>{t.courant}</span>}
      </div>

      {/* allures et semaine en cours : une ligne de tuiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        {/* La référence en gros, la cible dessous : les deux tiennent dans un
            tiers de largeur, là où « 52:00 → 38:00 » sur une ligne se coupait. */}
        <Tuile label="10 km" valeur={db.format10k(a.ref_actuelle_s)} sous={`→ ${db.format10k(a.ref_cible_s)}`} />
        <Tuile
          label={fr ? 'Séances' : 'Treningi'}
          valeur={`${a.cette_semaine.faites}/${a.cette_semaine.prevues}`}
          sous={`${h(a.cette_semaine.volume_realise_min)} / ${h(a.cette_semaine.volume_prevu_min)}`}
        />
        <Tuile label={t.rpe} valeur={a.dernier_rpe ? String(a.dernier_rpe.valeur) : '—'} sous={a.dernier_rpe?.date ?? ''} />
      </div>

      {/* son coach, et ce qui a bloqué la dernière fois — la ligne que le
          coach humain lit avant le chiffre */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: C.inkSecondary }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <CoachAvatar code={a.coach} taille={22} />
          <span style={{ fontWeight: 600 }}>{coachDe(a.coach).nom[app.lang]}</span>
        </div>
        {a.dernier_rpe?.limites?.length ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.inkQuiet }}>
            <Icon name="circle-question-mark" size={13} />
            <span>
              {`${fr ? 'A bloqué' : 'Blokowało'} : ${a.dernier_rpe.limites.map((l) => limiteEnClair(l, app.lang).toLowerCase()).join(', ')}`}
            </span>
          </div>
        ) : null}
      </div>

      <FormeJauge a={a} lang={app.lang} compact />
    </div>
  );
}

function Tuile({ label, valeur, sous }: { label: string; valeur: string; sous?: string }) {
  return (
    <div style={{ borderRadius: R.md, background: C.page, padding: '8px 10px', minWidth: 0 }}>
      <div style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: C.inkQuiet, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
      <div style={{ fontFamily: F.mono, fontSize: 13, color: C.ink, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{valeur}</div>
      {sous && <div style={{ fontSize: 10, color: C.inkQuiet, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sous}</div>}
    </div>
  );
}

export function AthletesScreen({ app }: { app: App }) {
  const t = T[app.lang];
  useEffect(() => { void app.chargerApercu(); }, [app.chargerApercu, app.version]);

  if (app.apercu === null) return <div style={{ color: C.inkSecondary, fontSize: 13 }}>{t.chargement}</div>;
  if (app.apercu.length === 0) return <div style={{ color: C.inkSecondary, fontSize: 13 }}>{t.aucun}</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {app.apercu.map((a) => <Carte key={a.id} a={a} app={app} />)}
    </div>
  );
}
