/* La semaine — planned vs done, the seven days, and the type legend.
   A day row opens the session sheet; its type square opens the type sheet. */

import * as db from '../data/db';
import { C, F } from '../design/theme';
import { Icon } from '../components/Icon';
import { Card, Grid, Mono, SectionLabel, TypeSquare } from '../components/primitives';
import type { App } from '../state/useApp';
import { WEEK } from '../state/useApp';

export function WeekScreen({ app }: { app: App }) {
  const lang = app.lang;
  const ui = db.ui(lang);

  const week = db.mustOne('msc_week', (r) => r.semaine === WEEK);
  const days = db.select('msc_session', (r) => r.semaine === WEEK);
  const types = db.select('msc_type');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Grid cols={3} gap={10}>
        {week.totaux.map((t) => (
          <Card key={t.code} padding={12} gap={6}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: C.inkSecondary }}>
              <Icon name={t.icon} size={14} />
              <div style={{ fontSize: 10 }}>{t.label[lang]}</div>
            </div>
            <Mono size={15} color={C.ink}>
              {t.realise}
            </Mono>
            <Mono size={10} color={C.inkQuiet}>
              {`/ ${t.prevu}`}
            </Mono>
          </Card>
        ))}
      </Grid>

      <Card padding={0} gap={0} style={{ overflow: 'hidden' }}>
        {days.map((d) => {
          const link = db.mustOne('msc_session_statut', (r) => r.session_id === d.id);
          const statut = db.mustOne('msc_statut', (r) => r.code === link.statut);
          const type = db.type(d.type);
          return (
            <button
              key={d.id}
              type="button"
              className="msc-hover-surface"
              onClick={() => app.openSession(d.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '12px 14px',
                borderTop: `1px solid ${C.borderSoft}`,
                width: '100%',
              }}
            >
              <Mono size={11} style={{ width: 30, textAlign: 'left' }}>
                {d.jour[lang]}
              </Mono>
              <TypeSquare
                icon={type.icon}
                color={type.color}
                label={type.label[lang]}
                onClick={() => app.openType(type.code)}
              />
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  textAlign: 'left',
                }}
              >
                <div style={{ fontSize: 14, color: C.ink }}>{(d.titre_court ?? d.titre)[lang]}</div>
                <div style={{ fontSize: 11, color: C.inkQuiet }}>{d.meta[lang]}</div>
              </div>
              <Icon name={statut.icon} size={17} color={statut.couleur} />
            </button>
          );
        })}
      </Card>

      {/* the legend — every type, each opening its own sheet */}
      <Card padding="16px 18px">
        <SectionLabel icon="tags">{ui.legendLabel}</SectionLabel>
        <Grid cols={2} gap={8}>
          {types.map((t) => (
            <button
              key={t.code}
              type="button"
              className="msc-hover-accent"
              onClick={() => app.openType(t.code)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 10px',
                borderRadius: 10,
                border: `1px solid ${C.border}`,
                fontFamily: F.body,
              }}
            >
              <Icon name={t.icon} size={16} color={t.color} />
              <div style={{ fontSize: 12, color: C.inkBody, textAlign: 'left' }}>
                {t.label[lang]}
              </div>
            </button>
          ))}
        </Grid>
      </Card>
    </div>
  );
}
