/* The phone screen: header, the four screens, the tab bar, and the sheets that
   lay over all of it. */

import { useEffect, useState } from 'react';
import * as db from './data/db';
import type { ScreenKey } from './data/types';
import { C, F, R } from './design/theme';
import { Icon } from './components/Icon';
import { Avatar } from './components/Avatar';
import { ProfilSheet } from './components/ProfilSheet';
import { SansPlan } from './components/SansPlan';
import { IOSDevice } from './components/IOSDevice';
import { MatinSheet } from './components/MatinSheet';
import { MiseAJour } from './components/MiseAJour';
import { SessionSheet } from './components/SessionSheet';
import { SettingsSheet } from './components/SettingsSheet';
import { TypeSheet } from './components/TypeSheet';
import { BackOfficeScreen, MoiScreen } from './screens/AdminScreen';
import { ChargementScreen, ConnexionScreen, PanneScreen } from './screens/ConnexionScreen';
import { CoachScreen } from './screens/CoachScreen';
import { FormScreen } from './screens/FormScreen';
import { TodayScreen } from './screens/TodayScreen';
import { WeekScreen } from './screens/WeekScreen';
import { useApp } from './state/useApp';
import { Bureau } from './Bureau';

const ORDER: ScreenKey[] = ['today', 'week', 'form', 'coach', 'admin'];
const TAB_ICONS: Record<ScreenKey, string> = {
  today: 'sun',
  week: 'calendar-days',
  form: 'heart-pulse',
  coach: 'bot',
  admin: 'user',
};

const MOIS_FR = ['janv.', 'févr.', 'mars', 'avril', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const MOIS_PL = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];

/* Le back office n'est pas un onglet : c'est un autre mode, pour les comptes
   qui en ont un. La barre du bas, elle, est toujours la même — c'est moi. */
function aUnBackOffice(app: ReturnType<typeof useApp>): boolean {
  const role = app.identite?.compte.role;
  return role === 'coach' || role === 'admin';
}

/** The eyebrow says where in the plan you are, so it is computed, not stored. */
function eyebrow(app: ReturnType<typeof useApp>): string {
  const fr = app.lang === 'fr';
  const [, mois, jour] = app.date.split('-');
  const nomMois = (fr ? MOIS_FR : MOIS_PL)[Number(mois) - 1];
  const s = fr ? 'S' : 'T';
  /* Sans plan, pas de semaine : la date seule, plutôt qu'un « S0 ». */
  const sem = app.semaine > 0 ? ` · ${s}${app.semaine}` : '';
  switch (app.screen) {
    case 'today':
      return `${Number(jour)} ${nomMois}${sem}`;
    case 'week':
      return app.semaine > 0
        ? `${s}${app.semaine} / ${db.derniereSemaine} · ${fr ? 'bloc' : 'blok'} ${db.blocDeSemaine(app.semaine).code}`
        : fr ? 'Sans plan' : 'Bez planu';
    case 'form':
      return fr ? '28 jours' : '28 dni';
    case 'coach':
      return `${fr ? 'Hebdo' : 'Tygodniowa'}${sem}`;
    case 'admin':
      return fr ? 'Ce qui est à moi' : 'To, co moje';
  }
}

/* Below this the bezel would cost more room than it is worth. */
const FRAME_QUERY = '(min-width: 720px) and (min-height: 940px)';
/* À partir d'ici, un coach ou un admin a le bureau : menu à gauche, page
   large. Un athlète garde le téléphone quelle que soit la fenêtre — l'app
   installée est la sienne. */
const BUREAU_QUERY = '(min-width: 1024px)';

function useMedia(requete: string) {
  const [ok, setOk] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(requete).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(requete);
    const onChange = () => setOk(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [requete]);
  return ok;
}

function Screen({ app }: { app: ReturnType<typeof useApp> }) {
  /* Sans plan, les écrans qui le lisent n'ont rien à montrer — et l'écran
     Semaine tomberait sur un bloc qui n'existe pas. Seul « Créer » reste. */
  if (db.derniereSemaine === 0 && app.screen !== 'admin') return <SansPlan app={app} />;
  switch (app.screen) {
    case 'today':
      return <TodayScreen app={app} />;
    case 'week':
      return <WeekScreen app={app} />;
    case 'form':
      return <FormScreen app={app} />;
    case 'coach':
      return <CoachScreen app={app} />;
    case 'admin':
      return <MoiScreen app={app} />;
  }
}

function Phone({ app, framed }: { app: ReturnType<typeof useApp>; framed: boolean }) {
  const ui = db.ui(app.lang);
  /* Le back office est un mode, pas un onglet : on y entre par le bouton du
     bandeau, on en sort par la barre du bas — qui, elle, est toujours mon
     application. Un athlète n'a pas ce bouton du tout. */
  const [backOffice, setBackOffice] = useState(false);
  const fr = app.lang === 'fr';

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
          {/* Une nouvelle version qui attend, ou l'application prête hors ligne. */}
          <MiseAJour lang={app.lang} />
          {/* Hors réseau, l'application lit sa copie locale. Le dire vaut mieux
              que laisser croire que les chiffres viennent d'arriver. */}
          {(!app.enLigne || app.enAttente > 0) && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 10,
                color: app.enLigne ? C.accentDeep : C.warning,
              }}
            >
              <Icon name={app.enLigne ? 'refresh-cw' : 'cloud-off'} size={12} />
              {/* Les deux ensemble, jamais l'un à la place de l'autre : hors
                  ligne avec trois choses en attente, cacher le compte donnerait
                  l'impression qu'elles se sont perdues. */}
              {[
                app.enLigne
                  ? null
                  : app.lang === 'fr'
                    ? 'Hors ligne · copie locale'
                    : 'Offline · kopia lokalna',
                app.enAttente > 0
                  ? `${app.enAttente} ${app.lang === 'fr' ? 'en attente d’envoi' : 'czeka na wysłanie'}`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
          )}
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
            {backOffice ? (fr ? 'Coach · le club' : 'Trener · klub') : eyebrow(app)}
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
            {backOffice ? (fr ? 'Back office' : 'Zaplecze') : ui.screens[app.screen]}
          </h1>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        {/* Entrer dans le back office, pour qui en a un. Ce n'est pas « mon »
            application : c'est celle du club, et le bouton le dit. */}
        {aUnBackOffice(app) && !backOffice && (
          <button
            type="button"
            className="msc-hover-accent"
            onClick={() => setBackOffice(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: '7px 10px', borderRadius: R.md,
              border: `1px solid ${C.border}`, color: C.inkSecondary, fontSize: 11, fontWeight: 600,
              whiteSpace: 'nowrap', flexShrink: 0,
            }}
          >
            <Icon name="footprints" size={15} />
            {fr ? 'Back office' : 'Zaplecze'}
          </button>
        )}
        {/* Prénom + nom pour les initiales ; sous la pastille, le surnom seul. */}
        <Avatar
          nom={[db.athlete.prenom, db.athlete.nom].filter(Boolean).join(' ')}
          onClick={app.openProfil}
          sousTitre={db.athlete.surnom ?? null}
          palier={db.athlete.niveau ?? null}
        />
        <button
          type="button"
          className="msc-hover-accent"
          onClick={app.openSettings}
          aria-label={app.lang === 'fr' ? 'Mon application' : 'Moja aplikacja'}
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
        </div>
      </header>

      <main className="msc-scroll" style={{ flex: 1, padding: '16px 20px 24px' }}>
        {backOffice
          ? <BackOfficeScreen app={app} onQuitter={() => setBackOffice(false)} />
          : <Screen app={app} />}
      </main>

      <nav
        style={{
          flexShrink: 0,
          display: 'grid',
          gridTemplateColumns: `repeat(${ORDER.length}, 1fr)`,
          gap: 4,
          padding: framed
            ? '10px 12px 34px'
            : '10px 12px max(34px, calc(env(safe-area-inset-bottom) + 10px))',
          background: C.surface,
          borderTop: `1px solid ${C.border}`,
        }}
      >
        {ORDER.map((key) => {
          const active = key === app.screen && !backOffice;
          return (
            <button
              key={key}
              type="button"
              onClick={() => { setBackOffice(false); app.setScreen(key); }}
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
      {app.profilOpen && <ProfilSheet app={app} />}
      {/* par-dessus tout : le parcours du matin — le signal, hier, aujourd'hui */}
      {app.matinOuvert && <MatinSheet app={app} />}
      {app.sessionId !== null && <SessionSheet app={app} sessionId={app.sessionId} />}
      {app.typeCode !== null && <TypeSheet app={app} code={app.typeCode} />}
    </div>
  );
}

/* Aucun écran ne s'affiche avant que l'instantané soit chargé.
   Ce n'est pas de la courtoisie : les tables sont vides jusque-là, et
   `db.athlete` lève plutôt que de rendre zéro — une allure de 0:00 affichée
   sans que rien ne proteste serait pire qu'un écran d'attente. */
function Contenu({ app, framed }: { app: ReturnType<typeof useApp>; framed: boolean }) {
  switch (app.amorce) {
    case 'pret':
      return <Phone app={app} framed={framed} />;
    case 'connexion':
      return (
        <ConnexionScreen
          lang={app.lang}
          erreur={app.amorceErreur}
          onConnexion={app.seConnecter}
          onInscription={app.sInscrire}
        />
      );
    case 'erreur':
      return (
        <PanneScreen
          lang={app.lang}
          erreur={app.amorceErreur}
          onReessayer={() => window.location.reload()}
        />
      );
    default:
      return <ChargementScreen lang={app.lang} />;
  }
}

export function App() {
  const app = useApp();
  const framed = useMedia(FRAME_QUERY);
  const large = useMedia(BUREAU_QUERY);

  /* Le bureau du coach : une fois connecté, sur un écran large. Les écrans de
     l'athlète y restent accessibles, rendus par le même `Screen`. */
  if (app.amorce === 'pret' && large && aUnBackOffice(app)) {
    const ui = db.ui(app.lang);
    return (
      <IOSDevice standalone>
        <Bureau
          app={app}
          ecran={<Screen app={app} />}
          eyebrow={eyebrow(app)}
          /* Les cinq mêmes que sur le téléphone, « Moi » compris : mon
             entraînement est mon application, pas un sous-ensemble. */
          onglets={ORDER.map((k) => ({ key: k, icon: TAB_ICONS[k], label: ui.tabs[k] }))}
        />
      </IOSDevice>
    );
  }

  if (!framed) {
    return (
      <IOSDevice standalone>
        <Contenu app={app} framed={false} />
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
          PWA · API · base MSC
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
          Tous les écrans lisent les tables msc_, servies par l'API. « Take my data », la
          langue et la déconnexion sont dans les paramètres.
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
        <Contenu app={app} framed />
      </IOSDevice>
    </div>
  );
}
