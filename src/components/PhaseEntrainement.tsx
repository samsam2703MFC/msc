/* La période d'entraînement : où l'on en est dans le plan.

   Une frise des blocs — chacun sa couleur et son icône, celui en cours allumé —
   et sous elle une barre de semaines, chaque segment large comme le bloc et
   rempli jusqu'à la semaine courante. Le bloc est le vrai signe de la phase :
   `part` va de 0 (réamorçage, l'allure actuelle) à 1 (bloc final, la cible), et
   c'est lui qui donne la couleur et l'icône, pas un champ de plus à tenir. */

import * as db from '../data/db';
import type { App } from '../state/useApp';
import type { MscBloc } from '../data/types';
import { C, F, R } from '../design/theme';
import { Icon } from './Icon';

/* La phase se lit sur `part`, la seule chose que le bloc sait déjà d'elle-même.
   Réamorçage (0) : reconstruire. Construction (<0.5) : l'allure descend, d'où
   la flèche. Vitesse (<1) : l'intensité, la flamme. Final (1) : la cible. */
function styleDe(part: number): { icon: string; couleur: string } {
  if (part <= 0) return { icon: 'leaf', couleur: C.teal };
  if (part < 0.5) return { icon: 'trending-down', couleur: C.accentDeep };
  if (part < 1) return { icon: 'flame', couleur: C.warning };
  return { icon: 'target', couleur: C.ink };
}

/* Combien de ce bloc est derrière nous, entre 0 et 1. Un bloc passé est plein,
   un bloc à venir vide, celui en cours rempli au prorata de ses semaines. */
function rempli(b: MscBloc, semaine: number): number {
  const span = b.a - b.de + 1;
  if (semaine > b.a) return 1;
  if (semaine < b.de) return 0;
  return (semaine - b.de + 1) / span;
}

export function PhaseEntrainement({ app }: { app: App }) {
  const lang = app.lang;
  const blocs = db.blocs();
  if (blocs.length === 0) return null;

  const total = db.derniereSemaine;
  const semaine = Math.min(Math.max(app.semaine, 1), total);
  const courant = db.blocDeSemaine(semaine);

  return (
    <div
      style={{
        borderRadius: R.card,
        border: `1px solid ${C.border}`,
        background: C.surface,
        padding: 14,
      }}
    >
      {/* la frise */}
      <div style={{ display: 'flex', gap: 6 }}>
        {blocs.map((b) => {
          const actif = b.code === courant.code;
          const { icon, couleur } = styleDe(b.part);
          return (
            <div key={b.code} style={{ flex: 1, textAlign: 'center', opacity: actif ? 1 : 0.5 }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  margin: '0 auto 6px',
                  borderRadius: R.full,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: actif ? couleur : C.surfaceAlt,
                  color: actif ? '#FFFFFF' : couleur,
                }}
              >
                <Icon name={icon} size={18} color={actif ? '#FFFFFF' : couleur} />
              </div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  lineHeight: 1.15,
                  color: actif ? C.ink : C.inkSecondary,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {b.nom[lang]}
              </div>
              <div style={{ fontFamily: F.mono, fontSize: 10, color: C.inkQuiet }}>
                S{b.de}–{b.a}
              </div>
            </div>
          );
        })}
      </div>

      {/* la barre de semaines : un segment par bloc, large comme lui */}
      <div style={{ display: 'flex', gap: 3, marginTop: 12 }}>
        {blocs.map((b) => {
          const { couleur } = styleDe(b.part);
          const part = rempli(b, semaine);
          return (
            <div
              key={b.code}
              style={{
                flexGrow: b.a - b.de + 1,
                height: 5,
                borderRadius: R.full,
                background: C.surfaceAlt,
                overflow: 'hidden',
              }}
            >
              <div style={{ width: `${part * 100}%`, height: '100%', background: couleur }} />
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 8, fontSize: 12, color: C.inkSecondary }}>
        {lang === 'fr'
          ? `Semaine ${semaine} / ${total} · ${courant.nom.fr}`
          : `Tydzień ${semaine} / ${total} · ${courant.nom.pl}`}
      </div>
    </div>
  );
}
