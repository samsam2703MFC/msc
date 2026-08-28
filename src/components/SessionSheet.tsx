/* A session, opened from the week: its type and why it exists, the paces
   computed for its block, the run sheet, and a chat bar about this session. */

import * as db from '../data/db';
import type { Lang } from '../data/types';
import { C } from '../design/theme';
import { ChatBar } from '../screens/CoachScreen';
import { Icon } from './Icon';
import { GainPill, SheetHeading } from './SheetHeading';
import { Card, Grid, IconLine, Mono } from './primitives';
import { Sheet, SheetCloseButton } from './Sheet';
import type { App } from '../state/useApp';

/* Suggested openers — UI copy, so they sit with the component, not in msc_. */
const CHAT: Record<Lang, { placeholder: string; prompts: string[] }> = {
  fr: {
    placeholder: 'Une question sur cette séance',
    prompts: ['Je peux la déplacer ?', 'Trop dur pour moi ?', 'Comment je la rate ?'],
  },
  pl: {
    placeholder: 'Pytanie o ten trening',
    prompts: ['Mogę go przenieść?', 'Za trudny dla mnie?', 'Jak go zepsuć?'],
  },
};

export function SessionSheet({ app, sessionId }: { app: App; sessionId: number }) {
  const lang = app.lang;
  const ui = db.ui(lang);

  const session = db.mustOne('msc_session', (r) => r.id === sessionId);
  const type = db.type(session.type);
  const chat = CHAT[lang];

  const paces = (session.zones ?? []).map((code) =>
    db.mustOne('msc_zone', (r) => r.code === code && r.bloc === session.bloc),
  );
  const steps = db
    .select('msc_session_step', (r) => r.session_id === session.id)
    .sort((a, b) => a.ordre - b.ordre);

  return (
    <Sheet
      onClose={app.closeSession}
      zIndex={85}
      label={session.titre[lang]}
      paddingBottom={40}
      gap={14}
      scrollable
    >
      <SheetHeading
        icon={type.icon}
        color={type.color}
        eyebrow={type.label[lang]}
        eyebrowColor={type.color}
        title={session.titre[lang]}
        titleSize={19}
        trailing={<GainPill>{type.gain[lang]}</GainPill>}
      />

      <IconLine icon="target">{type.why[lang]}</IconLine>

      {paces.length > 0 && (
        <Grid cols={3} gap={10}>
          {paces.map((z) => (
            <div
              key={z.code}
              style={{
                borderRadius: 12,
                border: `1px solid ${C.border}`,
                padding: 10,
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: C.inkSecondary }}>
                <Icon name={z.icon} size={13} />
                <div style={{ fontSize: 10 }}>{z.label[lang]}</div>
              </div>
              <Mono size={14} color={C.ink}>
                {z.allure}
              </Mono>
            </div>
          ))}
        </Grid>
      )}

      {steps.length > 0 && (
        <Card background={C.page} padding={14} gap={9} style={{ borderRadius: 12, boxShadow: 'none' }}>
          {steps.map((s) => (
            <IconLine
              key={s.ordre}
              icon={s.icon}
              iconSize={15}
              lead={s.duree}
              leadSize={11}
              fontSize={13}
              lineHeight={1.45}
            >
              {s.detail[lang]}
            </IconLine>
          ))}
        </Card>
      )}

      <ChatBar placeholder={chat.placeholder} />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {chat.prompts.map((q) => (
          <button
            key={q}
            type="button"
            className="msc-hover-accent"
            style={{
              padding: '6px 10px',
              borderRadius: 999,
              border: `1px solid ${C.border}`,
              fontSize: 11,
              color: C.inkMuted,
            }}
          >
            {q}
          </button>
        ))}
      </div>

      <SheetCloseButton label={ui.modalClose} onClick={app.closeSession} />
    </Sheet>
  );
}
