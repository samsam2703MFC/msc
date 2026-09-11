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
import { TITRE } from './data/ecrans';
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
import { GROUPES, ICONES_SECTION, SectionAdmin, sectionsDe, titreSection } from './screens/AdminScreen';
import type { Vue } from './screens/AdminScreen';
import type { App } from './state/useApp';

const T = {
  fr: { backOffice: 'Back office', monEntrainement: 'Mon entraînement', club: 'Le club', moi: 'Moi', mesEcrans: 'Mon application', deconnexion: 'Déconnexion', version: 'version', horsLigne: 'Hors ligne · copie locale', attente: 'en attente d’envoi', roles: { athlete: 'athlète', coach: 'coach', admin: 'admin' } },
  pl: { backOffice: 'Zaplecze', monEntrainement: 'Mój trening', club: 'Klub', moi: 'Ja', mesEcrans: 'Moja aplikacja', deconnexion: 'Wyloguj', version: 'wersja', horsLigne: 'Offline · kopia lokalna', attente: 'czeka na wysłanie', roles: { athlete: 'zawodnik', coach: 'trener', admin: 'admin' } },
} as const;

/* Où l'on en est dans le back office. Mes écrans, eux, sont dans `app.screen`
   comme sur le téléphone : deux états séparés pour deux mondes séparés. */

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
  const role = app.identite?.compte.role;
  const sections = sectionsDe(role);
  /* Deux mondes, et une bascule entre les deux — jamais les deux dans le même
     menu. Le back office parle des autres et de l'application ; mon
     entraînement ne parle que de moi. On entre par le back office : sur un
     grand écran, c'est pour ça qu'on s'assoit. */
  const [mode, setMode] = useState<'club' | 'moi'>('club');
  const [vue, setVue] = useState<Vue>({ section: 'athletes' });

  /* La fiche d'un athlète porte son nom en titre : c'est de lui qu'il s'agit,
     et le menu, lui, ne parle que du club et de l'application. */
  const fiche = vue.section === 'athletes' && vue.onglet;
  const titre = mode === 'moi'
    ? TITRE[app.screen][lang]
    : fiche
      ? [db.athlete.prenom, db.athlete.nom].filter(Boolean).join(' ') || db.athlete.nom
      : titreSection(vue.section, lang);
  const sur = mode === 'moi' ? eyebrow : t.backOffice;

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

        {/* La bascule : le club, ou moi. Deux mondes qui ne se mélangent
            plus — c'était ça, le désordre : des entrées « à moi » au milieu
            d'entrées « aux autres ». */}
        <div style={{ display: 'flex', gap: 3, padding: 3, margin: '0 8px', borderRadius: R.full, background: C.surfaceAlt, border: `1px solid ${C.border}` }}>
          {([['club', t.club], ['moi', t.moi]] as const).map(([m, libelle]) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              style={{
                flex: 1, padding: '6px 8px', borderRadius: R.full, fontSize: 12, fontWeight: 600,
                background: mode === m ? C.surface : 'transparent',
                color: mode === m ? C.ink : C.inkSecondary,
                boxShadow: mode === m ? C.shadowCard : 'none',
              }}
            >
              {libelle}
            </button>
          ))}
        </div>

        {mode === 'club' ? GROUPES.map((g) => {
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
        }) : (
          /* Mon entraînement : mes écrans, les mêmes que sur mon téléphone,
             et « Moi » pour mon plan, mes starts, mon profil, ma Strava. */
          <Groupe titre={t.monEntrainement}>
            {onglets.map((o) => (
              <Entree
                key={o.key}
                icon={o.icon}
                label={o.label}
                actif={app.screen === o.key}
                onClick={() => app.setScreen(o.key)}
              />
            ))}
          </Groupe>
        )}

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
          {mode === 'club' ? (
            <div style={{ maxWidth: 1400 }}>
              <SectionAdmin app={app} vue={vue} large onVue={setVue} />
            </div>
          ) : (
            /* Mes écrans, à la largeur pour laquelle ils sont dessinés — pas
               étirés sur tout l'écran. */
            <div style={{ maxWidth: 520 }}>{ecran}</div>
          )}
        </main>
      </div>

      {app.settingsOpen && <SettingsSheet app={app} />}
      {app.profilOpen && <ProfilSheet app={app} />}
      {app.matinOuvert && <MatinSheet app={app} />}
      {app.sessionId !== null && <SessionSheet app={app} sessionId={app.sessionId} />}
      {app.typeCode !== null && <TypeSheet app={app} code={app.typeCode} />}
    </div>
  );
}
