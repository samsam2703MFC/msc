/* État de forme — the four metrics computed off activity + journal.
   Each card is a value, its 28-day series, and the formula behind it. */

import * as db from '../data/db';
import { C, F } from '../design/theme';
import { Icon } from '../components/Icon';
import { BarChart, Card, bars } from '../components/primitives';

export function FormScreen({ lang }: { lang: 'fr' | 'pl' }) {
  const metrics = db.select('msc_metric');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {metrics.map((m) => (
        <Card key={m.code} padding="16px 18px">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <Icon name={m.icon} size={18} color={m.couleur} />
              <div style={{ fontSize: 14, fontWeight: 600, color: C.ink }}>{m.nom[lang]}</div>
            </div>
            <div
              style={{ fontFamily: F.mono, fontSize: 19, color: m.couleur, flexShrink: 0 }}
            >
              {m.valeur}
            </div>
          </div>

          <BarChart height={38} gap={4} data={bars(m.serie, m.seuil, C.warning)} />

          <div style={{ fontSize: 11, color: C.inkQuiet }}>{m.formule[lang]}</div>
        </Card>
      ))}
    </div>
  );
}
