/* Paramètres — the Strava source, the language, and what the database holds. */

import * as db from '../data/db';
import type { Lang } from '../data/types';
import { C, F, R } from '../design/theme';
import { Icon } from './Icon';
import { Mono, SectionLabel } from './primitives';
import { PhaseEntrainement } from './PhaseEntrainement';
import { Sheet, SheetCloseButton } from './Sheet';
import type { App } from '../state/useApp';

const PHASE_LABEL: Record<Lang, string> = { fr: 'Période d’entraînement', pl: 'Okres treningowy' };

const SETTINGS_TITLE: Record<Lang, string> = { fr: 'Paramètres', pl: 'Ustawienia' };
const LANG_LABEL: Record<Lang, string> = { fr: 'Langue', pl: 'Język' };
const DATE_LABEL: Record<Lang, string> = { fr: 'Jour du plan', pl: 'Dzień planu' };
const LANGS: Lang[] = ['fr', 'pl'];

export function SettingsSheet({ app }: { app: App }) {
  const lang = app.lang;
  const ui = db.ui(lang);

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

      <div>
        <SectionLabel icon="calendar-days" color={C.teal}>
          {PHASE_LABEL[lang]}
        </SectionLabel>
        <PhaseEntrainement app={app} />
      </div>

      <StravaCard app={app} />

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
            {db.derniereSemaine > 0
              ? `${lang === 'fr' ? 'Semaine' : 'Tydzień'} ${app.semaine} / ${db.derniereSemaine} · ${lang === 'fr' ? 'bloc' : 'blok'} ${db.blocDeSemaine(app.semaine).code}`
              : lang === 'fr' ? 'Sans plan' : 'Bez planu'}
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

      {/* Qui est connecté, et de quoi partir. Déconnecter vide les tables du
          navigateur, pas seulement l'écran : les données d'un athlète ne
          doivent pas rester lisibles par le suivant qui se connecte ici. */}
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
          <Icon name="user" size={18} />
        </div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.ink }}>
            {app.identite?.compte.nom ?? '—'}
          </div>
          <div style={{ fontSize: 11, color: C.inkSecondary }}>
            {app.identite?.compte.email ?? ''}
            {db.droit === 'lecture' ? ` · ${lang === 'fr' ? 'lecture seule' : 'tylko odczyt'}` : ''}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void app.seDeconnecter()}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 12px',
            borderRadius: R.full,
            border: `1px solid ${C.border}`,
            background: C.surface,
            color: C.inkSecondary,
            fontSize: 11,
          }}
        >
          <Icon name="log-out" size={14} />
          {lang === 'fr' ? 'Déconnexion' : 'Wyloguj'}
        </button>
      </div>

      <SheetCloseButton label={ui.modalClose} onClick={app.closeSettings} />
    </Sheet>
  );
}


/* ------------------------------------------------------------------ Strava */

/* Six states, and the card has to be honest about which one it is in. The
   prototype had two — a boolean pretending to be a connection — and "connected"
   there meant nothing had happened. Here it means the server holds a token. */
function StravaCard({ app }: { app: App }) {
  const lang = app.lang;
  const src = db.mustOne('msc_source', (r) => r.code === 'strava');
  const etat = app.strava;
  const lie = app.stravaOn;
  const occupe = app.stravaJob !== 'idle';

  const vue = (() => {
    if (!etat) {
      /* The plan server is not answering. Nothing can be said about Strava. */
      return {
        titre: src.titre_off[lang],
        sous: app.stravaErreur ?? '…',
        icone: 'download' as const,
        action: undefined,
      };
    }
    if (!etat.configure) {
      return {
        titre: src.titre_absent[lang],
        sous: src.sous_absent[lang],
        icone: 'triangle-alert' as const,
        action: undefined,
      };
    }
    if (app.stravaJob === 'liaison') {
      return {
        titre: src.titre_liaison[lang],
        sous: src.sous_liaison[lang],
        icone: 'loader' as const,
        action: undefined,
      };
    }
    if (!lie) {
      return {
        titre: src.titre_off[lang],
        sous: src.sous_off[lang],
        icone: 'download' as const,
        action: app.lierStrava,
      };
    }
    if (app.stravaJob === 'synchro') {
      return {
        titre: src.titre_on[lang],
        sous: src.sous_synchro[lang],
        icone: 'loader' as const,
        action: undefined,
      };
    }
    /* Linked and idle: when it last ran, and whether it will run by itself. */
    const quand = etat.derniere_synchro
      ? `${src.sous_on[lang]} ${ilYA(etat.derniere_synchro, lang)}`
      : src.jamais[lang];
    return {
      titre: etat.athlete?.prenom
        ? `${src.titre_on[lang]} · ${etat.athlete.prenom}`
        : src.titre_on[lang],
      sous: `${quand} · ${(etat.webhook ? src.webhook_on : src.webhook_off)[lang]}`,
      icone: 'refresh-cw' as const,
      action: app.synchroniser,
    };
  })();

  const teinte = lie ? C.accentDeep : etat && !etat.configure ? C.warning : C.negative;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <button
        type="button"
        onClick={vue.action}
        disabled={!vue.action}
        aria-pressed={lie}
        style={{
          borderRadius: 12,
          background: lie ? C.accentSoft : C.surface,
          border: `1px solid ${lie ? C.accent : C.border}`,
          padding: 14,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          cursor: vue.action ? 'pointer' : 'default',
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
            border: `1px solid ${lie ? C.accent : C.border}`,
            color: teinte,
            flexShrink: 0,
          }}
        >
          <Icon name={lie && !occupe ? 'link' : vue.icone} size={18} />
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
          <div style={{ fontSize: 14, fontWeight: 600, color: C.ink }}>{vue.titre}</div>
          <div style={{ fontSize: 11, color: C.inkSecondary }}>{vue.sous}</div>
        </div>
        {vue.action ? <Icon name={vue.icone} size={18} color={teinte} /> : null}
      </button>

      {/* An error the card itself could not carry — the sync failed, the quota
          ran out — rather than a state the card is in. */}
      {etat && app.stravaErreur ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            padding: '8px 10px',
            borderRadius: R.md,
            background: C.warningBg,
            color: C.warning,
            fontSize: 11,
            lineHeight: 1.4,
          }}
        >
          <Icon name="triangle-alert" size={14} />
          <span>{app.stravaErreur}</span>
        </div>
      ) : null}

      {lie ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 2 }}>
          {/* Activities that matched no session. Worth showing rather than
              swallowing: they are either a sport the plan does not track, or a
              session done on the wrong day. */}
          {app.stravaOrphelines.length > 0 ? (
            <Mono size={10} color={C.inkQuiet}>
              {`${app.stravaOrphelines.length} ${src.orphelines[lang]}`}
            </Mono>
          ) : null}
          <button
            type="button"
            onClick={app.delierStrava}
            style={{
              marginLeft: 'auto',
              padding: '4px 10px',
              borderRadius: R.full,
              border: `1px solid ${C.border}`,
              background: C.surface,
              color: C.inkSecondary,
              fontSize: 11,
            }}
          >
            {src.delier[lang]}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/* Intl does the two languages rather than a table of our own — "il y a 4 min"
   and "4 min temu" are the same call. */
function ilYA(iso: string, lang: Lang): string {
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto', style: 'short' });
  const s = Math.round((Date.parse(iso) - Date.now()) / 1000);
  const abs = Math.abs(s);
  if (abs < 60) return rtf.format(Math.round(s), 'second');
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(s / 3600), 'hour');
  return rtf.format(Math.round(s / 86_400), 'day');
}
