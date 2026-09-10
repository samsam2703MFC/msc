/* Les deux courbes de forme : la base endurance et la récupération.

   La jauge lit un matin ; ces deux cadres lisent des semaines. La base
   endurance est la charge (durée × RPE) lissée long — ce que l'entraînement
   a construit — avec la fatigue, la même charge lissée court, dans le même
   cadre parce que c'est la même unité. La récupération est la HRV du matin
   contre sa ligne de base ; un point plein quand la chute dépasse le seuil.

   Le serveur calcule les deux (server/forme.mjs) et les envoie avec
   l'instantané et la vue coach ; ici on ne fait que les montrer. */

import * as db from '../data/db';
import type { Lang, MscCourbes } from '../data/types';
import { C, F } from '../design/theme';
import { Icon } from './Icon';
import { Card } from './primitives';
import { Courbes } from './Courbes';

const T: Record<Lang, Record<string, string>> = {
  fr: {
    base: 'Base endurance', fatigue: 'fatigue', baseSerie: 'base',
    baseFormule: 'charge = durée × RPE · base lissée {b} j · fatigue lissée {f} j',
    baseVide: 'Pas encore d’activité : la base se construit avec les séances faites — Strava, ou la coche.',
    hrv: 'Récupération · HRV', hrvSerie: 'HRV', ligne: 'base {n} j', sous: 'sous le seuil',
    hrvFormule: 'HRV du matin · ligne de base = moyenne {n} j · alerte sous −{p} %',
    hrvVide: 'Pas encore de HRV : saisis-la le matin, la courbe suit.',
    vsBase: 'vs base',
  },
  pl: {
    base: 'Baza wytrzymałościowa', fatigue: 'zmęczenie', baseSerie: 'baza',
    baseFormule: 'obciążenie = czas × RPE · baza wygładzona {b} dni · zmęczenie {f} dni',
    baseVide: 'Brak aktywności: baza rośnie z wykonanych treningów — Strava lub zaznaczenie.',
    hrv: 'Regeneracja · HRV', hrvSerie: 'HRV', ligne: 'baza {n} dni', sous: 'poniżej progu',
    hrvFormule: 'poranne HRV · linia bazowa = średnia {n} dni · alert poniżej −{p} %',
    hrvVide: 'Brak HRV: wpisz je rano, wykres podąży.',
    vsBase: 'vs baza',
  },
};

function Entete({ icon, titre, valeur, sous }: { icon: string; titre: string; valeur: string; sous?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <Icon name={icon} size={18} color={C.accentDeep} />
        <div style={{ fontSize: 14, fontWeight: 600, color: C.ink }}>{titre}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexShrink: 0 }}>
        <div style={{ fontFamily: F.mono, fontSize: 19, color: valeur === '—' ? C.inkQuiet : C.ink }}>{valeur}</div>
        {sous && <div style={{ fontFamily: F.mono, fontSize: 11, color: C.inkQuiet }}>{sous}</div>}
      </div>
    </div>
  );
}

export function FormeCourbes({ courbes, lang, compact = false }: {
  courbes: MscCourbes | null | undefined;
  lang: Lang;
  /** Dans une carte du back office : sans cadre propre, plus serré. */
  compact?: boolean;
}) {
  const t = T[lang];
  const charge = courbes?.charge ?? [];
  const hrv = courbes?.hrv ?? [];
  const tau = courbes?.tau ?? { base: 42, fatigue: 7, hrv_base: 30 };
  const chute = db.param<number>('forme.hrv_chute_pct', 10);

  const dernier = charge[charge.length - 1];
  const dernierHrv = hrv[hrv.length - 1];
  const ecart = dernierHrv?.base ? Math.round(((dernierHrv.hrv - dernierHrv.base) / dernierHrv.base) * 100) : null;

  const Bloc = ({ children }: { children: React.ReactNode }) => compact
    ? <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 10, borderTop: `1px solid ${C.borderSoft}` }}>{children}</div>
    : <Card padding="16px 18px" gap={10}>{children}</Card>;

  return (
    <>
      <Bloc>
        <Entete
          icon="trending-up"
          titre={t.base}
          valeur={dernier ? String(dernier.base) : '—'}
          sous={dernier ? `${t.fatigue} ${dernier.fatigue}` : undefined}
        />
        <Courbes
          lang={lang}
          dates={charge.map((d) => d.date)}
          series={[
            { code: 'base', label: t.baseSerie, couleur: C.accentBar, valeurs: charge.map((d) => d.base), lavis: true },
            { code: 'fatigue', label: t.fatigue, couleur: C.warning, valeurs: charge.map((d) => d.fatigue) },
          ]}
          format={(v) => String(Math.round(v))}
          depuisZero
          vide={t.baseVide}
        />
        <div style={{ fontSize: 11, color: C.inkQuiet }}>
          {t.baseFormule.replace('{b}', String(tau.base)).replace('{f}', String(tau.fatigue))}
        </div>
      </Bloc>

      <Bloc>
        <Entete
          icon="heart-pulse"
          titre={t.hrv}
          valeur={dernierHrv ? `${dernierHrv.hrv} ms` : '—'}
          sous={ecart == null ? undefined : `${ecart > 0 ? '+' : ''}${ecart} % ${t.vsBase}`}
        />
        <Courbes
          lang={lang}
          dates={hrv.map((d) => d.date)}
          series={[
            { code: 'hrv', label: t.hrvSerie, couleur: C.accentBar, valeurs: hrv.map((d) => d.hrv), lavis: true },
            { code: 'ligne', label: t.ligne.replace('{n}', String(tau.hrv_base)), couleur: C.inkQuiet, valeurs: hrv.map((d) => d.base), reference: true },
          ]}
          format={(v) => `${Math.round(v)} ms`}
          marques={{ indices: hrv.map((d, i) => (d.sous ? i : -1)).filter((i) => i >= 0), couleur: C.negative, label: t.sous }}
          vide={t.hrvVide}
        />
        <div style={{ fontSize: 11, color: C.inkQuiet }}>
          {t.hrvFormule.replace('{n}', String(tau.hrv_base)).replace('{p}', String(chute))}
        </div>
      </Bloc>
    </>
  );
}
