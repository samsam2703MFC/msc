/* Un athlète tout juste créé n'a pas de plan : pas de séances, pas d'allures,
   pas de semaine. Les écrans qui lisent le plan ne s'affichent pas ; à la
   place, le dire, et mener à l'endroit où l'on en fait un. */

import { C } from '../design/theme';
import { AccentButton, Card, IconLine } from './primitives';
import type { App } from '../state/useApp';

export function SansPlan({ app }: { app: App }) {
  const fr = app.lang === 'fr';
  return (
    <Card featured gap={12}>
      <IconLine icon="calendar-x" color={C.inkSecondary}>
        <span style={{ fontWeight: 600, color: C.ink }}>
          {fr ? 'Pas encore de plan' : 'Jeszcze bez planu'}
        </span>
      </IconLine>
      <div style={{ fontSize: 13, color: C.inkSecondary, lineHeight: 1.5 }}>
        {fr
          ? 'Les séances, les allures et la forme apparaîtront dès qu’un plan sera généré pour cet athlète.'
          : 'Sesje, tempa i forma pojawią się, gdy dla tego zawodnika powstanie plan.'}
      </div>
      <AccentButton
        label={fr ? 'Créer un plan' : 'Utwórz plan'}
        icon="plus"
        onClick={() => app.setScreen('admin')}
      />
    </Card>
  );
}
