/* The phone screen: header, the four screens, the tab bar, and the sheets that
   lay over all of it. */

import { useEffect, useState } from 'react';
import * as db from './data/db';
import type { ScreenKey } from './data/types';
import { C, F, R } from './design/theme';
import { Icon } from './components/Icon';
import { IOSDevice } from './components/IOSDevice';
import { SessionSheet } from './components/SessionSheet';
import { SettingsSheet } from './components/SettingsSheet';
import { TypeSheet } from './components/TypeSheet';
import { CoachScreen } from './screens/CoachScreen';
import { FormScreen } from './screens/FormScreen';
import { TodayScreen } from './screens/TodayScreen';
import { WeekScreen } from './screens/WeekScreen';
import { useApp } from './state/useApp';

const ORDER: ScreenKey[] = ['today', 'week', 'form', 'coach'];
const TAB_ICONS: Record<ScreenKey, string> = {
  today: 'sun',
  week: 'calendar-days',
  form: 'heart-pulse',
  coach: 'bot',
};

/* Below this the bezel would cost more room than it is worth. */
const FRAME_QUERY = '(min-width: 720px) and (min-height: 940px)';

function useFramed() {
  const [framed, setFramed] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(FRAME_QUERY).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(FRAME_QUERY);
    const onChange = () => setFramed(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return framed;
}

function Screen({ app }: { app: ReturnType<typeof useApp> }) {
  switch (app.screen) {
    case 'today':
      return <TodayScreen app={app} />;
    case 'week':
      return <WeekScreen app={app} />;
    case 'form':
      return <FormScreen lang={app.lang} />;
    case 'coach':
      return <CoachScreen app={app} />;
  }
}

function Phone({ app, framed }: { app: ReturnType<typeof useApp>; framed: boolean }) {
  const ui = db.ui(app.lang);

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: C.page,
        color: C.ink,
        position: 'relative',
        fontFamily: F.body,
      }}
    >
      <header
        style={{
          padding: framed ? '62px 20px 12px' : 'max(62px, calc(env(safe-area-inset-top) + 16px)) 20px 12px',
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 12,
          flexShrink: 0,
          background: C.surface,
          borderBottom: `1px solid ${C.border}`,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <div
            style={{
              fontSize: 11,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: C.teal,
              fontWeight: 600,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {ui.eyebrows[app.screen]}
          </div>
          <h1
            style={{
              margin: 0,
              fontFamily: F.display,
              fontSize: 26,
              fontWeight: 600,
              letterSpacing: '-0.01em',
              color: C.ink,
              lineHeight: 1.15,
            }}
          >
            {ui.screens[app.screen]}
          </h1>
        </div>

        <button
          type="button"
          className="msc-hover-accent"
          onClick={app.openSettings}
          aria-label={app.lang === 'fr' ? 'Paramètres' : 'Ustawienia'}
          style={{
            width: 38,
            height: 38,
            borderRadius: R.md,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: `1px solid ${C.border}`,
            color: C.inkSecondary,
            flexShrink: 0,
            position: 'relative',
          }}
        >
          <Icon name="settings" size={19} />
          {/* source state at a glance: connected or not */}
          <span
            style={{
              position: 'absolute',
              top: -3,
              right: -3,
              width: 9,
              height: 9,
              borderRadius: R.full,
              background: app.stravaOn ? C.accent : C.negative,
              border: `2px solid ${C.surface}`,
            }}
          />
        </button>
      </header>

      <main className="msc-scroll" style={{ flex: 1, padding: '16px 20px 24px' }}>
        <Screen app={app} />
      </main>

      <nav
        style={{
          flexShrink: 0,
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 4,
          padding: framed
            ? '10px 12px 34px'
            : '10px 12px max(34px, calc(env(safe-area-inset-bottom) + 10px))',
          background: C.surface,
          borderTop: `1px solid ${C.border}`,
        }}
      >
        {ORDER.map((key) => {
          const active = key === app.screen;
          return (
            <button
              key={key}
              type="button"
              onClick={() => app.setScreen(key)}
              aria-current={active ? 'page' : undefined}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
                padding: '6px 2px',
                borderRadius: R.md,
                background: active ? C.accentSoft : 'transparent',
                color: active ? C.accentDeep : C.inkQuiet,
              }}
            >
              <Icon name={TAB_ICONS[key]} size={21} />
              <div style={{ fontSize: 10, fontWeight: 600, textAlign: 'center' }}>
                {ui.tabs[key]}
              </div>
            </button>
          );
        })}
      </nav>

      {app.settingsOpen && <SettingsSheet app={app} />}
      {app.sessionId !== null && <SessionSheet app={app} sessionId={app.sessionId} />}
      {app.typeCode !== null && <TypeSheet app={app} code={app.typeCode} />}
    </div>
  );
}

export function App() {
  const app = useApp();
  const framed = useFramed();

  if (!framed) {
    return (
      <IOSDevice standalone>
        <Phone app={app} framed={false} />
      </IOSDevice>
    );
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 32,
        padding: '56px 24px 72px',
        fontFamily: F.body,
      }}
    >
      <div style={{ width: 402, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div
          style={{
            fontSize: 12,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: C.teal,
            fontWeight: 600,
          }}
        >
          Prototype · PWA · base MSC
        </div>
        <div
          style={{
            fontFamily: F.display,
            fontSize: 28,
            fontWeight: 600,
            letterSpacing: '-0.01em',
            color: C.ink,
          }}
        >
          MySmartCoach
        </div>
        <div style={{ fontSize: 14, color: C.inkSecondary, lineHeight: 1.5 }}>
          Tous les écrans lisent les tables msc_. « Take my data » et la langue sont dans les
          paramètres.
        </div>
        <div
          style={{
            height: 3,
            width: 88,
            marginTop: 8,
            background: 'linear-gradient(90deg, #02C9A0, #029CD0)',
            borderRadius: R.full,
          }}
        />
      </div>

      <IOSDevice>
        <Phone app={app} framed />
      </IOSDevice>
    </div>
  );
}
