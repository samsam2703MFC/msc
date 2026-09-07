/* A session, opened from the week: its type and why it exists, the paces
   computed for its block, the run sheet, and a chat bar about this session. */

import * as db from '../data/db';
import type { Lang } from '../data/types';
import { C } from '../design/theme';
import { ChatBar, Conversation } from '../screens/CoachScreen';
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

  /* One thread per session, and the session itself is what the coach is asked
     about — so the brief goes with every question rather than being restated. */
  const cle = `session:${session.id}`;
  const contexte = [
    `Séance : ${session.titre[lang]}`,
    `${session.jour_long} ${session.date} · semaine ${session.semaine} · bloc ${session.bloc} · ${session.discipline}`,
    `${session.duree_min} min · RPE cible ${session.rpe_cible} · charge ${session.charge}`,
    session.detail[lang],
  ].join('\n');

  /* Paces are derived for the session's block, not stored on the session. */
  const paces = session.zones.map((code) => ({
    zone: db.zone(code),
    valeur: db.allure(code, session.bloc),
  }));

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

      <IconLine icon="target">{session.detail[lang]}</IconLine>

      {db.consigne(session, lang) && (
        <IconLine icon="circle-check" iconColor={C.inkSecondary} color={C.inkMuted}>
          {db.consigne(session, lang)}
        </IconLine>
      )}

      {paces.length > 0 && (
        <Grid cols={3} gap={10}>
          {paces.map(({ zone, valeur }) => (
            <div
              key={zone.code}
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
                <Icon name={zone.icon} size={13} />
                <div style={{ fontSize: 10 }}>{zone.label[lang]}</div>
              </div>
              <Mono size={14} color={C.ink}>
                {valeur}
              </Mono>
            </div>
          ))}
        </Grid>
      )}

      <Card background={C.page} padding={14} gap={6} style={{ borderRadius: 12, boxShadow: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Mono size={11} color={C.inkQuiet}>
            {`${session.duree_min} min × RPE ${session.rpe_cible}`}
          </Mono>
          <Mono size={14} color={C.ink}>
            {`${lang === 'fr' ? 'charge' : 'obciążenie'} ${session.charge}`}
          </Mono>
        </div>
        <Mono size={11} color={C.inkQuiet}>
          {`${session.jour_long} ${session.date} · ${session.phase}`}
        </Mono>
      </Card>

      <Conversation
        tours={app.chats[cle] ?? []}
        busy={app.chatEnCours === cle}
        erreur={app.chatErreur}
        thinking={ui.chatThinking}
      />
      <ChatBar
        placeholder={chat.placeholder}
        busy={app.chatEnCours !== null}
        onSend={(q) => void app.demanderCoach(cle, q, contexte)}
      />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {chat.prompts.map((q) => (
          <button
            key={q}
            type="button"
            className="msc-hover-accent"
            onClick={() => void app.demanderCoach(cle, q, contexte)}
            disabled={app.chatEnCours !== null}
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
