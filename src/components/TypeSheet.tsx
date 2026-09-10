/* The training-type card: what it buys you, why the session exists, and two
   lines of what the science says. Reached from any type tag in the app. */

import * as db from '../data/db';
import type { TypeCode } from '../data/types';
import { C, F } from '../design/theme';
import { Icon } from './Icon';
import { GainPill, SheetHeading } from './SheetHeading';
import { IconLine, SectionLabel } from './primitives';
import { Sheet, SheetCloseButton } from './Sheet';
import type { App } from '../state/useApp';

export function TypeSheet({ app, code }: { app: App; code: TypeCode }) {
  const lang = app.lang;
  const ui = db.ui(lang);
  const t = db.type(code);

  return (
    <Sheet onClose={app.closeType} zIndex={90} label={t.label[lang]}>
      <SheetHeading
        icon={t.icon}
        color={t.color}
        eyebrow={ui.modalKind}
        eyebrowColor={C.inkQuiet}
        title={t.label[lang]}
        titleSize={20}
        trailing={<GainPill>{t.gain[lang]}</GainPill>}
      />

      <IconLine icon="target">{t.why[lang]}</IconLine>

      <div
        style={{
          borderRadius: 12,
          background: C.page,
          border: `1px solid ${C.border}`,
          padding: 14,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <SectionLabel icon="flask-conical" color={C.teal}>
          {ui.modalSci}
        </SectionLabel>
        {t.sci[lang].map((line) => (
          <div key={line} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <Icon name="dot" size={16} color={C.accentDeep} style={{ marginTop: 2 }} />
            <div style={{ fontSize: 13, lineHeight: 1.45, color: C.inkMuted, fontFamily: F.body }}>
              {line}
            </div>
          </div>
        ))}
      </div>

      <SheetCloseButton label={ui.modalClose} onClick={app.closeType} />
    </Sheet>
  );
}
