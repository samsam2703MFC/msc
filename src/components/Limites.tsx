/* « Quelque chose a bloqué ? » — la question posée après chaque séance, et
   dès que Strava en ramène une. Un vocabulaire fermé, le même que le serveur
   (LIMITES) : c'est ce qui permet de compter « les jambes, trois fois de
   suite », et c'est ce que le coach lit avant d'ajuster la suivante. */

import type { Lang, Limite } from '../data/types';
import { C, R } from '../design/theme';
import { Icon } from './Icon';

const VOCAB: Array<{ code: Limite; icon: string; label: Record<Lang, string> }> = [
  { code: 'rien', icon: 'circle-check', label: { fr: 'Rien, tout est passé', pl: 'Nic, wszystko poszło' } },
  { code: 'jambes', icon: 'dumbbell', label: { fr: 'Les jambes (muscles)', pl: 'Nogi (mięśnie)' } },
  { code: 'souffle', icon: 'wind', label: { fr: 'Le souffle', pl: 'Oddech' } },
  { code: 'technique', icon: 'route', label: { fr: 'La technique', pl: 'Technika' } },
  { code: 'mental', icon: 'brain', label: { fr: 'Le mental', pl: 'Głowa' } },
  { code: 'sommeil', icon: 'moon', label: { fr: 'Le sommeil', pl: 'Sen' } },
  { code: 'nutrition', icon: 'utensils', label: { fr: 'La nutrition', pl: 'Jedzenie' } },
  { code: 'douleur', icon: 'bandage', label: { fr: 'Une douleur', pl: 'Ból' } },
  { code: 'chaleur', icon: 'thermometer-sun', label: { fr: 'La chaleur', pl: 'Upał' } },
];

/** Le libellé court d'un code, pour les cartes du back office. */
export function limiteEnClair(code: string, lang: Lang): string {
  return VOCAB.find((v) => v.code === code)?.label[lang] ?? code;
}

export function Limites({
  lang,
  valeur,
  onToggle,
  disabled = false,
  nudge = false,
}: {
  lang: Lang;
  valeur: string[];
  onToggle: (code: Limite) => void;
  disabled?: boolean;
  /** Vrai quand Strava a ramené la séance et que la question n'a pas eu sa réponse. */
  nudge?: boolean;
}) {
  const fr = lang === 'fr';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.inkSecondary }}>
        <Icon name="circle-question-mark" size={15} />
        <div style={{ fontSize: 12 }}>{fr ? 'Quelque chose a bloqué ?' : 'Coś blokowało?'}</div>
      </div>
      {nudge && (
        <div style={{ fontSize: 11, color: C.accentDeep, lineHeight: 1.4 }}>
          {fr
            ? 'Strava a ramené la séance — dis au coach ce qui a bloqué, il ajustera la suivante.'
            : 'Strava przyniosła trening — powiedz trenerowi, co blokowało; dostosuje następny.'}
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {VOCAB.map((v) => {
          const on = valeur.includes(v.code);
          return (
            <button
              key={v.code}
              type="button"
              className="msc-hover-accent"
              aria-pressed={on}
              disabled={disabled}
              onClick={() => onToggle(v.code)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 10px',
                borderRadius: R.full,
                border: `1px solid ${on ? C.accent : C.border}`,
                background: on ? C.accentSoft : C.surface,
                color: on ? C.accentDeep : C.inkMuted,
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              <Icon name={v.icon} size={13} />
              {v.label[lang]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
