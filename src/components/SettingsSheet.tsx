/* Paramètres — the Strava source, the language, and what the database holds. */

import * as db from '../data/db';
import type { Lang } from '../data/types';
import { C, F, R } from '../design/theme';
import { Icon } from './Icon';
import { Mono, SectionLabel } from './primitives';
import { Sheet, SheetCloseButton } from './Sheet';
import type { App } from '../state/useApp';

const SETTINGS_TITLE: Record<Lang, string> = { fr: 'Paramètres', pl: 'Ustawienia' };
const LANG_LABEL: Record<Lang, string> = { fr: 'Langue', pl: 'Język' };
const DB_LABEL: Record<Lang, string> = { fr: 'Base MSC · tables', pl: 'Baza MSC · tabele' };
const DATE_LABEL: Record<Lang, string> = { fr: 'Jour du plan', pl: 'Dzień planu' };
const LANGS: Lang[] = ['fr', 'pl'];

export function SettingsSheet({ app }: { app: App }) {
  const lang = app.lang;
  const ui = db.ui(lang);
  const src = db.mustOne('msc_source', (r) => r.code === 'strava');
  const on = app.stravaOn;

  return (
    <Sheet onClose={app.closeSettings} zIndex={90} label={SETTINGS_TITLE[lang]}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: C.ink }}>
        <Icon name="settings" size={20} color={C.inkSecondary} />
        <div
          style={{
            fontFamily: F.display,
            fontSize: 20,
            fontWeight: 600,
            letterSpacing: '-0.01em',
          }}
        >
          {SETTINGS_TITLE[lang]}
        </div>
      </div>

      {/* Take my data — Strava through the MCP connector */}
      <button
        type="button"
        onClick={app.toggleStrava}
        aria-pressed={on}
        style={{
          borderRadius: 12,
          background: on ? C.accentSoft : C.surface,
          border: `1px solid ${on ? C.accent : C.border}`,
          padding: 14,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 9,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: `1px solid ${on ? C.accent : C.border}`,
            color: on ? C.accentDeep : C.negative,
            flexShrink: 0,
          }}
        >
          <Icon name={on ? 'link' : 'download'} size={18} />
        </div>
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
          <div style={{ fontSize: 14, fontWeight: 600, color: C.ink }}>
            {(on ? src.titre_on : src.titre_off)[lang]}
          </div>
          <div style={{ fontSize: 11, color: C.inkSecondary }}>
            {(on ? src.sous_on : src.sous_off)[lang]}
          </div>
        </div>
        <Icon
          name={on ? 'refresh-cw' : 'chevron-right'}
          size={18}
          color={on ? C.accentDeep : C.negative}
        />
      </button>

      {/* FR / PL */}
      <div
        style={{
          borderRadius: 12,
          border: `1px solid ${C.border}`,
          padding: 14,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 9,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: `1px solid ${C.border}`,
            color: C.inkSecondary,
            flexShrink: 0,
          }}
        >
          <Icon name="languages" size={18} />
        </div>
        <div style={{ flex: 1, fontSize: 14, fontWeight: 600, color: C.ink }}>
          {LANG_LABEL[lang]}
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            padding: 3,
            borderRadius: R.full,
            background: C.surfaceAlt,
            border: `1px solid ${C.border}`,
          }}
        >
          {LANGS.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => app.setLang(l)}
              aria-pressed={lang === l}
              style={{
                padding: '5px 12px',
                borderRadius: R.full,
                fontFamily: F.mono,
                fontSize: 11,
                background: lang === l ? C.accent : 'transparent',
                color: lang === l ? C.accentInk : C.inkSecondary,
              }}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* where in the plan you are — the app opens on today, this walks it */}
      <div
        style={{
          borderRadius: 12,
          border: `1px solid ${C.border}`,
          padding: 14,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 9,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: `1px solid ${C.border}`,
            color: C.inkSecondary,
            flexShrink: 0,
          }}
        >
          <Icon name="calendar-days" size={18} />
        </div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <label htmlFor="msc-date" style={{ fontSize: 14, fontWeight: 600, color: C.ink }}>
            {DATE_LABEL[lang]}
          </label>
          <div style={{ fontSize: 11, color: C.inkSecondary }}>
            {`${lang === 'fr' ? 'Semaine' : 'Tydzień'} ${app.semaine} / ${db.derniereSemaine} · ${lang === 'fr' ? 'bloc' : 'blok'} ${db.blocDeSemaine(app.semaine).code}`}
          </div>
        </div>
        <input
          id="msc-date"
          type="date"
          value={app.date}
          onChange={(e) => e.target.value && app.allerA(e.target.value)}
          style={{
            borderRadius: R.md,
            border: `1px solid ${C.border}`,
            background: C.surface,
            color: C.ink,
            padding: '8px 10px',
            fontFamily: F.mono,
            fontSize: 11,
          }}
        />
      </div>

      {/* the two references the whole plan slides between */}
      <div
        style={{
          borderRadius: 12,
          background: C.page,
          border: `1px solid ${C.border}`,
          padding: 14,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <SectionLabel icon="gauge" color={C.teal}>
          {lang === 'fr' ? 'Références 10 km' : 'Odniesienia 10 km'}
        </SectionLabel>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Mono size={13} color={C.ink}>
            {db.format10k(db.athlete.ref_actuelle_s)}
          </Mono>
          <Icon name="arrow-right" size={14} color={C.accentDeep} />
          <Mono size={13} color={C.accentDeep}>
            {db.format10k(db.athlete.ref_cible_s)}
          </Mono>
        </div>
        <div style={{ fontSize: 11, color: C.inkSecondary, lineHeight: 1.4 }}>
          {lang === 'fr'
            ? "Toutes les allures du plan sont calculées depuis ces deux nombres. Le test de 30' recale le premier."
            : 'Wszystkie tempa planu liczone są z tych dwóch liczb. Test 30 min przelicza pierwszą.'}
        </div>
      </div>

      {/* what the database holds */}
      <div
        style={{
          borderRadius: 12,
          background: C.page,
          border: `1px solid ${C.border}`,
          padding: 14,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <SectionLabel icon="database" color={C.teal}>
          {DB_LABEL[lang]}
        </SectionLabel>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {db.tableNames.map((name) => (
            <Mono
              key={name}
              size={10}
              color={C.inkMuted}
              style={{
                padding: '3px 7px',
                borderRadius: R.sm,
                border: `1px solid ${C.border}`,
                background: C.surface,
              }}
            >
              {name}
            </Mono>
          ))}
        </div>
      </div>

      <SheetCloseButton label={ui.modalClose} onClick={app.closeSettings} />
    </Sheet>
  );
}
