/* Ce que le coach a vu : ce qui va, ce qui ne va pas, et ce que la séance
   change à l'équilibre du plan. Lit les deux formes rangées dans
   msc_analyse.blocs — celle du seed (icône, couleur, items par langue) et
   celle que le modèle renvoie (un ton, des lignes). L'état passe par l'icône
   et le titre, jamais par la couleur seule. */

import type { Lang, MscAnalyse } from '../data/types';
import { C } from '../design/theme';
import { Icon } from './Icon';

const TON: Record<
  'bon' | 'attention' | 'plan',
  { icon: string; couleur: string; titre: Record<Lang, string> }
> = {
  bon: { icon: 'circle-check', couleur: C.accentDeep, titre: { fr: 'Ce qui va', pl: 'Co gra' } },
  attention: { icon: 'triangle-alert', couleur: C.warning, titre: { fr: 'Ce qui ne va pas', pl: 'Co nie gra' } },
  plan: { icon: 'scale', couleur: C.teal, titre: { fr: 'Ce que ça change au plan', pl: 'Co to zmienia w planie' } },
};

interface Bloc {
  cle: string;
  icon: string;
  couleur: string;
  titre: string | null;
  lignes: string[];
}

function blocsLisibles(analyse: Pick<MscAnalyse, 'blocs'>, lang: Lang): Bloc[] {
  return (analyse.blocs ?? []).map((b, i) => {
    if ('items' in b) {
      return { cle: `${b.icon}-${i}`, icon: b.icon, couleur: b.couleur, titre: null, lignes: b.items[lang] ?? [] };
    }
    const t = TON[b.ton] ?? TON.attention;
    return { cle: `${b.ton}-${i}`, icon: t.icon, couleur: t.couleur, titre: t.titre[lang], lignes: b.lignes ?? [] };
  });
}

export function Observations({
  analyse,
  lang,
  cols = 2,
}: {
  analyse: Pick<MscAnalyse, 'blocs'>;
  lang: Lang;
  cols?: 1 | 2;
}) {
  const blocs = blocsLisibles(analyse, lang).filter((b) => b.lignes.length > 0);
  if (blocs.length === 0) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: 10 }}>
      {blocs.map((b) => (
        <div
          key={b.cle}
          style={{
            borderRadius: 12,
            border: `1px solid ${C.border}`,
            background: C.surface,
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            /* le bloc « plan » prend toute la largeur : c'est une phrase, pas une liste */
            gridColumn: b.titre && b.icon === 'scale' ? '1 / -1' : undefined,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name={b.icon} size={16} color={b.couleur} />
            {b.titre && (
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: C.inkSecondary }}>
                {b.titre}
              </div>
            )}
          </div>
          {b.lignes.map((l) => (
            <div key={l} style={{ fontSize: 12.5, lineHeight: 1.45, color: C.inkBody }}>
              {l}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
