/* Le bureau : le back office, et rien d'autre.

   Deux applications, deux appareils. Le téléphone est celle de l'athlète —
   cinq onglets, une main, mon entraînement. Le bureau est celle du club : un
   menu à gauche qui liste tout le back office, une page large à droite où un
   tableau a la place de ses colonnes.

   Mon entraînement n'est donc pas ici, pas même derrière une bascule : c'était
   le dernier mélange qui restait. Ce que le coach a à voir de lui-même, il le
   voit comme le club le voit — sa ligne dans Athlètes, et sa fiche.

   Rien ici ne décide de quoi que ce soit : les sections, les rôles, les
   données sont ceux de l'application ; ce fichier ne fait que les disposer. */

import { useState } from 'react';
import type { ReactNode } from 'react';
import * as db from './data/db';
import { C, F, R } from './design/theme';
import { Icon } from './components/Icon';
import { Avatar } from './components/Avatar';
import { MiseAJour } from './components/MiseAJour';
import { ProfilSheet } from './components/ProfilSheet';
import { SettingsSheet } from './components/SettingsSheet';
import { GROUPES, ICONES_SECTION, SectionAdmin, sectionsDe, titreSection } from './screens/AdminScreen';
import type { Vue } from './screens/AdminScreen';
import type { App } from './state/useApp';

const T = {
  fr: { backOffice: 'Back office', mesEcrans: 'Mon application', deconnexion: 'Déconnexion', version: 'version', horsLigne: 'Hors ligne · copie locale', attente: 'en attente d’envoi', roles: { athlete: 'athlète', coach: 'coach', admin: 'admin' } },
  pl: { backOffice: 'Zaplecze', mesEcrans: 'Moja aplikacja', deconnexion: 'Wyloguj', version: 'wersja', horsLigne: 'Offline · kopia lokalna', attente: 'czeka na wysłanie', roles: { athlete: 'zawodnik', coach: 'trener', admin: 'admin' } },
} as const;

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

export function Bureau({ app }: { app: App }) {
  const lang = app.lang;
  const t = T[lang];
  const role = app.identite?.compte.role;
  const sections = sectionsDe(role);
  const [vue, setVue] = useState<Vue>({ section: 'athletes' });

  /* La fiche d'un athlète porte son nom en titre : c'est de lui qu'il s'agit,
     et le menu, lui, ne parle que du club et de l'application. */
  const fiche = vue.section === 'athletes' && vue.onglet;
  const titre = fiche
    ? [db.athlete.prenom, db.athlete.nom].filter(Boolean).join(' ') || db.athlete.nom
    : titreSection(vue.section, lang);

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
          const siennes = g.sections.filter((x) => sections.includes(x));
          if (siennes.length === 0) return null;
          return (
            <Groupe key={g.code} titre={g.titre[lang]}>
              {siennes.map((x) => (
                <Entree
                  key={x}
                  icon={ICONES_SECTION[x]}
                  label={titreSection(x, lang)}
                  actif={vue.section === x}
                  onClick={() => setVue({ section: x })}
                />
              ))}
            </Groupe>
          );
        })}

        <div style={{ flex: 1 }} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {/* Le réglage de MON application (langue, jour du plan, compte) —
              les paramètres du serveur, eux, sont une section du menu. */}
          <Entree icon="settings" label={t.mesEcrans} actif={false} onClick={app.openSettings} />
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
            <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.teal, fontWeight: 600 }}>{t.backOffice}</div>
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
          <div style={{ maxWidth: 1400 }}>
            <SectionAdmin app={app} vue={vue} large onVue={setVue} />
          </div>
        </main>
      </div>

      {/* Deux feuilles seulement : le réglage de mon application, et le profil
          de l'athlète affiché. Le matin, une séance, une fiche de type — c'est
          l'application de l'athlète, elle est sur son téléphone. */}
      {app.settingsOpen && <SettingsSheet app={app} />}
      {app.profilOpen && <ProfilSheet app={app} />}
    </div>
  );
}
