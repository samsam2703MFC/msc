/* Système : ce que le serveur sait de lui-même, dit à l'admin.

   La version servie contre celle de cette page — c'est la question « est-ce
   que je vois la dernière version ? », posée une fois pour toutes. Puis les
   services : la clé Anthropic en trois états, Strava, le scellement, la base.
   Et ce que le seed de démonstration a laissé, avec le bouton pour le retirer
   — ce que `npm run db:demo -- retirer` fait sur le serveur. */

import { useCallback, useEffect, useState } from 'react';
import * as api from '../data/api';
import type { Systeme } from '../data/api';
import type { Lang } from '../data/types';
import { C, F, R } from '../design/theme';
import { Icon } from '../components/Icon';
import { Card, SectionLabel } from '../components/primitives';
import type { App } from '../state/useApp';

const T = {
  fr: {
    chargement: 'Lecture du serveur…',
    version: 'Version', cettePage: 'cette page', serveur: 'le serveur', aJour: 'La page est à jour.',
    pasAJour: 'Le serveur sert une version plus récente que cette page : recharge-la (ou ferme et rouvre l’application).',
    sansBuild: 'pas de build servi (dist/version.txt absent)', recharger: 'Recharger',
    node: 'Node', env: 'environnement', depuis: 'démarré le',
    sansTls: 'MSC_SANS_TLS est levé : le cookie de session voyage en clair. À ne garder que sur un serveur d’essai.',
    services: 'Services',
    cle: 'Clé Anthropic', cleOk: 'renseignée', cleAbsente: 'absente — Réglages · Coach, ou ANTHROPIC_API_KEY',
    cleIllisible: 'renseignée mais illisible : scellée avec une autre MSC_SECRET_KEY. À ressaisir dans Réglages.',
    sources: { base: 'réglée dans Réglages', env: 'variable d’environnement', defaut: 'défaut du code' } as Record<string, string>,
    strava: 'Strava', stravaOk: 'client configuré', stravaNon: 'non configuré — MSC_STRAVA_CLIENT_ID / SECRET',
    scellement: 'Scellement', scellementOk: 'MSC_SECRET_KEY prête', scellementNon: 'MSC_SECRET_KEY absente ou invalide : aucun secret ne peut être lu ni écrit',
    base: 'Base de données', baseOk: 'répond', baseNon: 'ne répond pas',
    demo: 'Données de démonstration',
    demoIntro: 'Ce que le seed a laissé dans la base vivante : des activités et des analyses inventées, en octobre 2026. Rien de ce que l’athlète a saisi lui-même n’y ressemble.',
    rien: 'Rien de la démonstration ici.',
    planActif: 'actif — laissé tel quel', planInactif: 'inactif', courses: 'courses à lui seul',
    retirer: 'Retirer le vécu inventé', retirerPlan: '… et le plan de démonstration', confirmer: 'Confirmer ?', annuler: 'Annuler',
    retire: 'Retiré', enCours: 'Retrait…',
    planNote: 'Le plan n’est retiré que s’il n’est pas actif, avec les courses que lui seul nomme et qui n’ont pas de résultat.',
  },
  pl: {
    chargement: 'Odczyt serwera…',
    version: 'Wersja', cettePage: 'ta strona', serveur: 'serwer', aJour: 'Strona jest aktualna.',
    pasAJour: 'Serwer podaje nowszą wersję niż ta strona: odśwież ją (lub zamknij i otwórz aplikację ponownie).',
    sansBuild: 'brak buildu (dist/version.txt nie istnieje)', recharger: 'Odśwież',
    node: 'Node', env: 'środowisko', depuis: 'uruchomiony',
    sansTls: 'MSC_SANS_TLS jest ustawione: ciasteczko sesji podróżuje jawnie. Tylko na serwerze testowym.',
    services: 'Usługi',
    cle: 'Klucz Anthropic', cleOk: 'ustawiony', cleAbsente: 'brak — Ustawienia · Trener lub ANTHROPIC_API_KEY',
    cleIllisible: 'ustawiony, ale nieczytelny: zapieczętowany innym MSC_SECRET_KEY. Wpisz ponownie w Ustawieniach.',
    sources: { base: 'z Ustawień', env: 'zmienna środowiskowa', defaut: 'domyślny z kodu' } as Record<string, string>,
    strava: 'Strava', stravaOk: 'klient skonfigurowany', stravaNon: 'nieskonfigurowany — MSC_STRAVA_CLIENT_ID / SECRET',
    scellement: 'Pieczęć', scellementOk: 'MSC_SECRET_KEY gotowy', scellementNon: 'MSC_SECRET_KEY brak lub nieprawidłowy: żaden sekret nie da się odczytać ani zapisać',
    base: 'Baza danych', baseOk: 'odpowiada', baseNon: 'nie odpowiada',
    demo: 'Dane demonstracyjne',
    demoIntro: 'Co seed zostawił w żywej bazie: wymyślone aktywności i analizy z października 2026. Nic z tego, co zawodnik wpisał sam, tak nie wygląda.',
    rien: 'Nic z demonstracji.',
    planActif: 'aktywny — pozostawiony', planInactif: 'nieaktywny', courses: 'zawodów tylko jego',
    retirer: 'Usuń wymyślone dane', retirerPlan: '… i plan demonstracyjny', confirmer: 'Potwierdzić?', annuler: 'Anuluj',
    retire: 'Usunięto', enCours: 'Usuwanie…',
    planNote: 'Plan jest usuwany tylko, gdy nie jest aktywny, wraz z zawodami, które tylko on nazywa i które nie mają wyniku.',
  },
} satisfies Record<Lang, unknown>;

function Ligne({ ok, titre, detail, alerte = false }: { ok: boolean; titre: string; detail: string; alerte?: boolean }) {
  const couleur = ok ? C.accentDeep : alerte ? C.negative : C.warning;
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '8px 0', borderTop: `1px solid ${C.borderSoft}` }}>
      <Icon name={ok ? 'circle-check' : 'triangle-alert'} size={15} color={couleur} style={{ marginTop: 1, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.ink }}>{titre}</div>
        <div style={{ fontSize: 11.5, lineHeight: 1.4, color: ok ? C.inkSecondary : couleur }}>{detail}</div>
      </div>
    </div>
  );
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function SystemeScreen({ app }: { app: App }) {
  const t = T[app.lang];
  const lang = app.lang;
  const [etat, setEtat] = useState<Systeme | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [retrait, setRetrait] = useState<'idle' | 'arme' | 'arme-plan' | 'en-cours' | 'fait'>('idle');

  const lire = useCallback(() => {
    api.systeme()
      .then((s) => { setEtat(s); setErreur(null); })
      .catch((e) => setErreur(message(e)));
  }, []);

  useEffect(() => { lire(); }, [lire]);

  const retirer = async (plan: boolean) => {
    setRetrait('en-cours');
    try {
      await api.retirerDemo(plan);
      setRetrait('fait');
      lire();
      setTimeout(() => setRetrait('idle'), 2000);
    } catch (e) {
      setErreur(message(e)); setRetrait('idle');
    }
  };

  if (erreur && !etat) {
    return (
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 12px', borderRadius: R.md, background: C.warningBg, color: C.warning, fontSize: 12, lineHeight: 1.4 }}>
        <Icon name="triangle-alert" size={14} />
        <span>{erreur}</span>
      </div>
    );
  }
  if (!etat) return <div style={{ color: C.inkSecondary, fontSize: 13 }}>{t.chargement}</div>;

  const cettePage = __MSC_VERSION__;
  const aJour = etat.version === null || etat.version === cettePage;
  const demo = etat.demo;
  const demoVide = !demo || demo.erreur || (demo.lots.every((l) => l.n === 0) && demo.plans.length === 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* la version */}
      <Card padding="14px 16px" gap={8}>
        <SectionLabel icon="git-commit-horizontal" color={C.teal}>{t.version}</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', fontSize: 12, alignItems: 'baseline' }}>
          <span style={{ color: C.inkSecondary }}>{t.cettePage}</span>
          <span style={{ fontFamily: F.mono, color: C.ink }}>{cettePage}</span>
          <span style={{ color: C.inkSecondary }}>{t.serveur}</span>
          <span style={{ fontFamily: F.mono, color: etat.version ? C.ink : C.warning }}>{etat.version ?? t.sansBuild}</span>
          <span style={{ color: C.inkSecondary }}>{t.node}</span>
          <span style={{ fontFamily: F.mono, color: C.ink }}>{`${etat.node} · ${etat.env}`}</span>
          <span style={{ color: C.inkSecondary }}>{t.depuis}</span>
          <span style={{ fontFamily: F.mono, color: C.ink }}>{etat.demarre_le.replace('T', ' ').slice(0, 16)} UTC</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, lineHeight: 1.4, color: aJour ? C.accentDeep : C.warning }}>
          <Icon name={aJour ? 'circle-check' : 'triangle-alert'} size={14} />
          <span style={{ flex: 1 }}>{aJour ? t.aJour : t.pasAJour}</span>
          {!aJour && (
            <button type="button" onClick={() => window.location.reload()} style={{ padding: '6px 10px', borderRadius: R.md, background: C.accent, color: C.accentInk, fontWeight: 700, fontSize: 12, border: 'none' }}>
              {t.recharger}
            </button>
          )}
        </div>
        {etat.sans_tls && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, lineHeight: 1.4, color: C.warning }}>
            <Icon name="triangle-alert" size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{t.sansTls}</span>
          </div>
        )}
      </Card>

      {/* les services */}
      <Card padding="14px 16px" gap={0}>
        <div style={{ paddingBottom: 6 }}><SectionLabel icon="link" color={C.teal}>{t.services}</SectionLabel></div>
        <Ligne
          ok={etat.cle && !etat.cle_illisible}
          alerte={etat.cle_illisible}
          titre={t.cle}
          detail={etat.cle_illisible ? t.cleIllisible : etat.cle ? `${t.cleOk} · ${t.sources[etat.cle_source ?? 'defaut'] ?? etat.cle_source}` : t.cleAbsente}
        />
        <Ligne ok={etat.strava} titre={t.strava} detail={etat.strava ? t.stravaOk : t.stravaNon} />
        <Ligne ok={etat.scellement} alerte={!etat.scellement} titre={t.scellement} detail={etat.scellement ? t.scellementOk : t.scellementNon} />
        <Ligne ok={etat.base.ok} alerte={!etat.base.ok} titre={t.base} detail={etat.base.ok ? `${t.baseOk} · ${etat.base.version ?? ''}` : `${t.baseNon} · ${etat.base.erreur ?? ''}`} />
      </Card>

      {/* la démonstration */}
      <Card padding="14px 16px" gap={8}>
        <SectionLabel icon="flask-conical" color={C.teal}>{t.demo}</SectionLabel>
        <div style={{ fontSize: 11.5, color: C.inkSecondary, lineHeight: 1.45 }}>{t.demoIntro}</div>
        {demo?.erreur && <div style={{ fontSize: 12, color: C.negative }}>{demo.erreur}</div>}
        {demoVide ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: C.accentDeep }}>
            <Icon name="circle-check" size={14} />
            <span>{t.rien}</span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {demo!.lots.map((l) => (
              <div key={l.code} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '6px 0', borderTop: `1px solid ${C.borderSoft}` }}>
                <span style={{ fontFamily: F.mono, fontSize: 13, color: l.n > 0 ? C.ink : C.inkQuiet, minWidth: 28, textAlign: 'right' }}>{l.n}</span>
                <span style={{ fontSize: 12, color: l.n > 0 ? C.inkBody : C.inkQuiet, lineHeight: 1.4 }}>{l.quoi[lang]}</span>
              </div>
            ))}
            {demo!.plans.map((p) => (
              <div key={p.id} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '6px 0', borderTop: `1px solid ${C.borderSoft}` }}>
                <Icon name="calendar-days" size={14} color={C.inkQuiet} />
                <span style={{ fontSize: 12, color: C.inkBody, lineHeight: 1.4 }}>
                  {`${p.nom} — ${p.actif ? t.planActif : t.planInactif}, ${p.courses.length} ${t.courses}`}
                </span>
              </div>
            ))}
          </div>
        )}
        {!demoVide && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {retrait === 'arme' || retrait === 'arme-plan' ? (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: C.negative }}>{t.confirmer}</span>
                <button type="button" onClick={() => void retirer(retrait === 'arme-plan')} style={{ padding: '7px 12px', borderRadius: R.md, background: C.negative, color: '#fff', fontWeight: 700, fontSize: 12, border: 'none' }}>
                  {retrait === 'arme-plan' ? t.retirerPlan : t.retirer}
                </button>
                <button type="button" onClick={() => setRetrait('idle')} style={{ padding: '7px 12px', borderRadius: R.md, border: `1px solid ${C.border}`, color: C.inkMuted, fontSize: 12, fontWeight: 600, background: C.surface }}>
                  {t.annuler}
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button type="button" disabled={retrait !== 'idle'} onClick={() => setRetrait('arme')} style={{ padding: '7px 12px', borderRadius: R.md, border: `1px solid ${C.negative}`, color: C.negative, fontSize: 12, fontWeight: 600, background: C.surface }}>
                  {retrait === 'en-cours' ? t.enCours : retrait === 'fait' ? t.retire : t.retirer}
                </button>
                {demo!.plans.some((p) => !p.actif) && (
                  <button type="button" disabled={retrait !== 'idle'} onClick={() => setRetrait('arme-plan')} style={{ padding: '7px 12px', borderRadius: R.md, border: `1px solid ${C.border}`, color: C.inkMuted, fontSize: 12, fontWeight: 600, background: C.surface }}>
                    {t.retirerPlan}
                  </button>
                )}
              </div>
            )}
            <div style={{ fontSize: 10.5, color: C.inkQuiet, lineHeight: 1.4 }}>{t.planNote}</div>
          </div>
        )}
        {erreur && <div style={{ fontSize: 12, color: C.negative }}>{erreur}</div>}
      </Card>
    </div>
  );
}
