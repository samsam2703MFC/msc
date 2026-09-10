/* Le bureau : le back office sur un écran large, pour un coach ou un admin.

   Le téléphone est l'application de l'athlète — cinq onglets, une main. Le
   coach, lui, travaille assis : un menu à gauche qui liste tout le back
   office, une page large à droite où un tableau a la place de ses colonnes.
   Les écrans de l'athlète restent à portée, dans le même menu, rendus dans
   une colonne à leur taille : ils ont été dessinés pour une main, on ne les
   étire pas.

   Rien ici ne décide de quoi que ce soit : les sections, les rôles, les
   données sont ceux de l'application ; ce fichier ne fait que les disposer. */

import { useState } from 'react';
import type { ReactNode } from 'react';
import * as db from './data/db';
import type { ScreenKey } from './data/types';
import { C, F, R } from './design/theme';
import { Icon } from './components/Icon';
import { Avatar } from './components/Avatar';
import { MatinSheet } from './components/MatinSheet';
import { MiseAJour } from './components/MiseAJour';
import { ProfilSheet } from './components/ProfilSheet';
import { SessionSheet } from './components/SessionSheet';
import { SettingsSheet } from './components/SettingsSheet';
import { TypeSheet } from './components/TypeSheet';
import { CONFIGURATION, GROUPES, SECTIONS, SectionAdmin, sectionsDe } from './screens/AdminScreen';
import type { Section } from './screens/AdminScreen';
import type { App } from './state/useApp';

const ICONES: Record<Section, string> = {
  athletes: 'footprints', classement: 'zap', calendrier: 'calendar-days',
  suivi: 'heart-pulse', plan: 'wand-sparkles', courses: 'flag', strava: 'link', profil: 'pencil',
  param: 'settings', comptes: 'user', systeme: 'database',
};

const T = {
  fr: { backOffice: 'Back office', vueAthlete: 'Vue athlète', athlete: 'Athlète affiché', entrainement: 'Entraînement', configuration: 'Configuration', reglages: 'Réglages', deconnexion: 'Déconnexion', version: 'version', horsLigne: 'Hors ligne · copie locale', attente: 'en attente d’envoi', roles: { athlete: 'athlète', coach: 'coach', admin: 'admin' } },
  pl: { backOffice: 'Zaplecze', vueAthlete: 'Widok zawodnika', athlete: 'Wyświetlany zawodnik', entrainement: 'Trening', configuration: 'Konfiguracja', reglages: 'Ustawienia', deconnexion: 'Wyloguj', version: 'wersja', horsLigne: 'Offline · kopia lokalna', attente: 'czeka na wysłanie', roles: { athlete: 'zawodnik', coach: 'trener', admin: 'admin' } },
} as const;

/* Un état de page à deux faces : une section du back office, ou un écran de
   l'athlète (celui de `app.screen`, comme sur le téléphone). */
type Page = { type: 'section'; section: Section } | { type: 'ecran' };

function Entree({
  icon, label, actif, onClick,
}: {
  icon: string; label: string; actif: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={actif ? 'page' : undefined}
      className={actif ? undefined : 'msc-hover-surface'}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
        padding: '8px 12px', borderRadius: R.md, fontSize: 13, fontWeight: 600,
        background: actif ? C.accentSoft : 'transparent',
        color: actif ? C.accentDeep : C.inkMuted,
      }}
    >
      <Icon name={icon} size={17} />
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
    </button>
  );
}

function Groupe({ titre, children }: { titre: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.teal, padding: '8px 12px 4px' }}>
        {titre}
      </div>
      {children}
    </div>
  );
}

export function Bureau({
  app, ecran, eyebrow, onglets,
}: {
  app: App;
  /** L'écran de l'athlète courant (Aujourd'hui, Semaine…), rendu par App. */
  ecran: ReactNode;
  eyebrow: string;
  onglets: Array<{ key: ScreenKey; icon: string; label: string }>;
}) {
  const lang = app.lang;
  const t = T[lang];
  const ui = db.ui(lang);
  const role = app.identite?.compte.role;
  const sections = sectionsDe(role);
  const [page, setPage] = useState<Page>({ type: 'section', section: 'athletes' });

  const titre = page.type === 'section' ? SECTIONS[lang][page.section] : ui.screens[app.screen];
  /* Ce qui est à l'athlète porte son nom en surtitre ; le reste, « Back office ». */
  const groupeDe = (s: Section) => GROUPES.find((g) => g.sections.includes(s))?.code;
  const sur = page.type === 'section'
    ? groupeDe(page.section) === 'athlete' ? db.athlete.nom : t.backOffice
    : eyebrow;
  const athletes = app.identite?.athletes ?? [];

  return (
    <div
      style={{
        height: '100%', display: 'flex', background: C.page, color: C.ink, fontFamily: F.body,
        position: 'relative', overflow: 'hidden',
      }}
    >
      {/* le menu */}
      <nav
        aria-label={t.backOffice}
        className="msc-scroll"
        style={{
          width: 248, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 12,
          padding: '20px 12px 16px', background: C.surface, borderRight: `1px solid ${C.border}`,
          overflowY: 'auto',
        }}
      >
        <div style={{ padding: '0 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ fontFamily: F.display, fontSize: 20, fontWeight: 600, letterSpacing: '-0.01em', color: C.ink }}>MySmartCoach</div>
          <div style={{ fontSize: 11, color: C.inkSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {app.identite?.compte.nom}
            {role && (
              <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: R.full, background: C.accentSoft, color: C.accentDeep, border: `1px solid ${C.accent}` }}>
                {t.roles[role]}
              </span>
            )}
          </div>
        </div>

        {GROUPES.map((g) => {
          const siennes = g.sections.filter((s) => sections.includes(s));
          if (siennes.length === 0) return null;
          return (
            <Groupe key={g.code} titre={g.code === 'athlete' ? db.athlete.nom : g.titre[lang]}>
              {/* Le groupe de l'athlète commence par le choix de l'athlète,
                  quand le compte en voit plusieurs : tout ce qui suit est à lui. */}
              {g.code === 'athlete' && athletes.length > 1 && (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '2px 12px 8px' }}>
                  <span style={{ fontSize: 10.5, color: C.inkSecondary }}>{t.athlete}</span>
                  <select
                    value={db.athleteId ?? ''}
                    onChange={(e) => void app.recharger(Number(e.target.value))}
                    style={{ padding: '6px 8px', borderRadius: R.md, border: `1px solid ${C.border}`, background: C.surface, color: C.ink, fontSize: 12, fontFamily: F.body }}
                  >
                    {athletes.map((a) => <option key={a.id} value={a.id}>{a.nom}</option>)}
                  </select>
                </label>
              )}
              {siennes.map((s, i) => (
                <div key={s}>
                  {/* Chez l'athlète : ce qui bouge (suivi, plan, starts), puis
                      ce qu'on pose une fois (Strava, profil). */}
                  {g.code === 'athlete' && (i === 0 || (CONFIGURATION.includes(s) && !CONFIGURATION.includes(siennes[i - 1]))) && (
                    <div style={{ fontSize: 10, color: C.inkQuiet, padding: `${i === 0 ? 2 : 8}px 12px 2px` }}>
                      {CONFIGURATION.includes(s) ? t.configuration : t.entrainement}
                    </div>
                  )}
                  <Entree
                    icon={ICONES[s]}
                    label={SECTIONS[lang][s]}
                    actif={page.type === 'section' && page.section === s}
                    onClick={() => setPage({ type: 'section', section: s })}
                  />
                </div>
              ))}
              {/* … et ses écrans, tels que le téléphone les montre. */}
              {g.code === 'athlete' && (
                <>
                  <div style={{ fontSize: 10, color: C.inkQuiet, padding: '8px 12px 2px' }}>{t.vueAthlete}</div>
                  {onglets.map((o) => (
                    <Entree
                      key={o.key}
                      icon={o.icon}
                      label={o.label}
                      actif={page.type === 'ecran' && app.screen === o.key}
                      onClick={() => { app.setScreen(o.key); setPage({ type: 'ecran' }); }}
                    />
                  ))}
                </>
              )}
            </Groupe>
          );
        })}

        <div style={{ flex: 1 }} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Entree icon="settings" label={t.reglages} actif={false} onClick={app.openSettings} />
          <Entree icon="log-out" label={t.deconnexion} actif={false} onClick={() => void app.seDeconnecter()} />
          <div style={{ padding: '6px 12px 0', fontSize: 10, fontFamily: F.mono, color: C.inkQuiet, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {`${t.version} ${__MSC_VERSION__}`}
          </div>
        </div>
      </nav>

      {/* la page */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <header
          style={{
            display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16,
            padding: '20px 32px 14px', background: C.surface, borderBottom: `1px solid ${C.border}`, flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
            <MiseAJour lang={lang} />
            {(!app.enLigne || app.enAttente > 0) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: app.enLigne ? C.accentDeep : C.warning }}>
                <Icon name={app.enLigne ? 'refresh-cw' : 'cloud-off'} size={12} />
                {[app.enLigne ? null : t.horsLigne, app.enAttente > 0 ? `${app.enAttente} ${t.attente}` : null].filter(Boolean).join(' · ')}
              </div>
            )}
            <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.teal, fontWeight: 600 }}>{sur}</div>
            <h1 style={{ margin: 0, fontFamily: F.display, fontSize: 24, fontWeight: 600, letterSpacing: '-0.01em', color: C.ink, lineHeight: 1.15 }}>
              {titre}
            </h1>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <Avatar
              nom={[db.athlete.prenom, db.athlete.nom].filter(Boolean).join(' ')}
              onClick={app.openProfil}
              sousTitre={db.athlete.surnom ?? null}
              palier={db.athlete.niveau ?? null}
            />
          </div>
        </header>

        <main className="msc-scroll" style={{ flex: 1, padding: '24px 32px 40px' }}>
          {page.type === 'section' ? (
            <div style={{ maxWidth: 1120 }}>
              <SectionAdmin app={app} section={page.section} onSection={(s) => setPage({ type: 'section', section: s })} />
            </div>
          ) : (
            /* Les écrans de l'athlète, à la largeur pour laquelle ils sont
               dessinés — pas étirés sur tout l'écran. */
            <div style={{ maxWidth: 520 }}>{ecran}</div>
          )}
        </main>
      </div>

      {app.settingsOpen && <SettingsSheet app={app} />}
      {app.profilOpen && <ProfilSheet app={app} />}
      {app.matinRequis && <MatinSheet app={app} />}
      {app.sessionId !== null && <SessionSheet app={app} sessionId={app.sessionId} />}
      {app.typeCode !== null && <TypeSheet app={app} code={app.typeCode} />}
    </div>
  );
}
