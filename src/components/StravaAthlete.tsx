/* Strava, pour un athlète : sa liaison, son historique, son application API
   — la sienne. Le bloc que l'écran Strava du back office affiche pour
   l'athlète courant.

   Un secret ne redescend jamais : on sait qu'il est renseigné, on le
   remplace. Un jeton Strava n'apparaît nulle part, même pas ici. */

import { useEffect, useRef, useState } from 'react';
import type { StravaAthlete } from '../data/api';
import * as strava from '../data/strava';
import type { Lang } from '../data/types';
import { C, F, R } from '../design/theme';
import { Icon } from './Icon';

const T = {
  fr: {
    chargement: 'Lecture des connexions…',
    intro: 'Ce qui relie le serveur au monde : la clé du coach, l’application Strava, et la liaison Strava de chaque athlète.',
    cle: 'Clé Anthropic',
    cleAide: 'La clé du coach. Elle est scellée en base et ne redescend jamais : on la remplace, on ne la relit pas.',
    appCommune: 'Application Strava commune',
    appAide: 'Une application Strava neuve n’autorise que le compte qui l’a créée, tant que Strava ne l’a pas revue. Deux voies : faire revoir celle-ci, ou laisser chaque athlète créer la sienne sur strava.com/settings/api (domaine de rappel : celui du serveur) et la poser sous son nom, plus bas.',
    parAthlete: 'Strava, athlète par athlète',
    aucunAthlete: 'Aucun athlète visible.',
    connecte: 'connecté', nonConnecte: 'non connecté', nonConfigure: 'Strava non configuré pour cet athlète',
    relieLe: 'relié le', synchro: 'dernière synchro', jamais: 'jamais',
    activites: (n: number) => n === 0 ? 'aucune activité reçue' : n === 1 ? '1 activité reçue' : `${n} activités reçues`,
    derniere: 'dernière le',
    synchroNote: 'Les activités se synchronisent quand l’athlète ouvre l’application.',
    lienEnvoyer: 'Lien à envoyer', lienAide: 'Valable un jour. L’athlète l’ouvre sur son téléphone, connecté à son compte Strava, et dit oui.',
    copier: 'Copier', copie: 'Copié', expire: 'expire le',
    ouvrirIci: 'Ouvrir ici', ouvrirAide: 'Depuis l’appareil de l’athlète : c’est le compte Strava ouvert dans la fenêtre qui sera relié.',
    attente: 'En attente de Strava…',
    delier: 'Délier', delierConfirme: 'Délier ce compte Strava ?', oui: 'Oui, délier', annuler: 'Annuler',
    importer: 'Importer l’historique', importDepuis: 'depuis le', importEnCours: 'Import en cours…',
    importAide: 'Tout ce que Strava a de cet athlète depuis cette date, rangé tel quel : de quoi écrire un plan. Les séances déjà appariées le restent.',
    importFait: (n: number, premiere: string | null, derniere: string | null) =>
      `${n} activité${n > 1 ? 's' : ''} importée${n > 1 ? 's' : ''}${premiere ? ` · du ${premiere} au ${derniere ?? premiere}` : ''}`,
    appPropre: 'Application Strava de cet athlète',
    appPropreOui: (id: string) => `application propre · ID ${id}`,
    appCommuneOui: (id: string) => `application commune · ID ${id}`,
    appAucune: 'aucune application — ni propre, ni commune',
    appIllisible: 'secret illisible : scellé avec une autre MSC_SECRET_KEY, à ressaisir.',
    renseignerApp: 'Renseigner une application propre', modifierApp: 'Modifier', fermer: 'Fermer',
    clientId: 'ID client', secret: 'Secret client', secretAide: 'Jamais réaffiché. Laisse vide pour garder l’actuel.',
    enregistrer: 'Enregistrer', enregistre: 'Enregistré', effacer: 'Revenir à l’application commune',
  },
  pl: {
    chargement: 'Wczytywanie połączeń…',
    intro: 'Co łączy serwer ze światem: klucz trenera, aplikacja Strava i połączenie Strava każdego zawodnika.',
    cle: 'Klucz Anthropic',
    cleAide: 'Klucz trenera. Zapieczętowany w bazie, nigdy nie wraca na ekran: zastępuje się go, nie odczytuje.',
    appCommune: 'Wspólna aplikacja Strava',
    appAide: 'Nowa aplikacja Strava autoryzuje tylko konto, które ją utworzyło, dopóki Strava jej nie sprawdzi. Dwie drogi: zgłosić tę do sprawdzenia, albo pozwolić każdemu zawodnikowi utworzyć własną na strava.com/settings/api (domena zwrotna: serwera) i wpisać ją pod jego nazwiskiem niżej.',
    parAthlete: 'Strava, zawodnik po zawodniku',
    aucunAthlete: 'Brak widocznych zawodników.',
    connecte: 'połączona', nonConnecte: 'niepołączona', nonConfigure: 'Strava nieskonfigurowana dla tego zawodnika',
    relieLe: 'połączono', synchro: 'ostatnia synchronizacja', jamais: 'nigdy',
    activites: (n: number) => n === 0 ? 'brak odebranych aktywności' : n === 1 ? '1 odebrana aktywność' : `${n} odebranych aktywności`,
    derniere: 'ostatnia',
    synchroNote: 'Aktywności synchronizują się, gdy zawodnik otwiera aplikację.',
    lienEnvoyer: 'Link do wysłania', lienAide: 'Ważny jeden dzień. Zawodnik otwiera go na swoim telefonie, zalogowany na swoje konto Strava, i potwierdza.',
    copier: 'Kopiuj', copie: 'Skopiowano', expire: 'wygasa',
    ouvrirIci: 'Otwórz tutaj', ouvrirAide: 'Z urządzenia zawodnika: połączone zostanie konto Strava otwarte w oknie.',
    attente: 'Czekam na Stravę…',
    delier: 'Odłącz', delierConfirme: 'Odłączyć to konto Strava?', oui: 'Tak, odłącz', annuler: 'Anuluj',
    importer: 'Importuj historię', importDepuis: 'od', importEnCours: 'Import w toku…',
    importAide: 'Wszystko, co Strava ma o tym zawodniku od tej daty, zapisane tak jak jest: podstawa do napisania planu. Już dopasowane treningi zostają.',
    importFait: (n: number, premiere: string | null, derniere: string | null) =>
      `${n} zaimportowanych aktywności${premiere ? ` · od ${premiere} do ${derniere ?? premiere}` : ''}`,
    appPropre: 'Aplikacja Strava tego zawodnika',
    appPropreOui: (id: string) => `własna aplikacja · ID ${id}`,
    appCommuneOui: (id: string) => `wspólna aplikacja · ID ${id}`,
    appAucune: 'brak aplikacji — ani własnej, ani wspólnej',
    appIllisible: 'sekret nieczytelny: zapieczętowany innym MSC_SECRET_KEY, wpisz ponownie.',
    renseignerApp: 'Wpisz własną aplikację', modifierApp: 'Edytuj', fermer: 'Zamknij',
    clientId: 'ID klienta', secret: 'Sekret klienta', secretAide: 'Nigdy nie pokazywany. Zostaw puste, by zachować obecny.',
    enregistrer: 'Zapisz', enregistre: 'Zapisano', effacer: 'Wróć do wspólnej aplikacji',
  },
} satisfies Record<Lang, unknown>;

const ENTREE: React.CSSProperties = {
  width: '100%', minWidth: 0, boxSizing: 'border-box',
  padding: '9px 11px', borderRadius: R.md, border: `1px solid ${C.border}`,
  background: C.surface, color: C.ink, fontSize: 14, fontFamily: F.mono,
};

const BOUTON: React.CSSProperties = {
  padding: '7px 12px', borderRadius: R.md, background: C.accent, color: C.accentInk,
  fontWeight: 700, fontSize: 12, border: 'none', whiteSpace: 'nowrap',
};

const BOUTON_SOBRE: React.CSSProperties = {
  padding: '7px 12px', borderRadius: R.md, border: `1px solid ${C.border}`,
  color: C.inkMuted, fontSize: 12, fontWeight: 600, background: C.surface, whiteSpace: 'nowrap',
};

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function jour(iso: string | null | undefined): string {
  return iso ? String(iso).slice(0, 10) : '';
}

function Pastille({ texte, ok }: { texte: string; ok: boolean }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: R.full, whiteSpace: 'nowrap', background: ok ? C.accentSoft : C.surfaceAlt, color: ok ? C.accentDeep : C.inkMuted, border: `1px solid ${ok ? C.accent : C.border}` }}>
      {texte}
    </span>
  );
}

/* ------------------------------------------------------------- un athlète */

export function BlocStrava({
  a, lang, recharger, onImporte,
}: {
  a: StravaAthlete; lang: Lang; recharger: () => Promise<StravaAthlete[] | null>; onImporte?: () => void;
}) {
  const t = T[lang];
  const [lien, setLien] = useState<{ url: string; expire_le: string | null } | null>(null);
  const [copie, setCopie] = useState(false);
  const [job, setJob] = useState<'idle' | 'lien' | 'popup' | 'delier' | 'app' | 'import'>('idle');
  const [depuis, setDepuis] = useState(() => new Date(Date.now() - 2 * 365 * 86400 * 1000).toISOString().slice(0, 10));
  const [importe, setImporte] = useState<strava.ImportHistorique | null>(null);
  const [confirme, setConfirme] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [appOuverte, setAppOuverte] = useState(false);
  const [clientId, setClientId] = useState(a.app.client_id ?? '');
  const [secret, setSecret] = useState('');
  const [appFait, setAppFait] = useState(false);
  const sondage = useRef<number | undefined>(undefined);

  useEffect(() => { setClientId(a.app.client_id ?? ''); }, [a.app.client_id]);
  useEffect(() => () => window.clearInterval(sondage.current), []);

  const lienAEnvoyer = async () => {
    setErreur(null); setJob('lien');
    try {
      setLien(await strava.lienAutorisation(a.id, true));
    } catch (e) {
      setErreur(message(e));
    } finally {
      setJob('idle');
    }
  };

  const copier = async () => {
    if (!lien) return;
    try {
      await navigator.clipboard.writeText(lien.url);
      setCopie(true);
      setTimeout(() => setCopie(false), 2000);
    } catch {
      /* Pas de presse-papiers (page non sécurisée) : le champ reste sélectionnable. */
    }
  };

  /* La fenêtre Strava est sur leur origine, opaque pour nous : on guette le
     serveur jusqu'à ce que la liaison apparaisse, ou que la fenêtre se ferme. */
  const ouvrirIci = async () => {
    setErreur(null);
    let url: string;
    try {
      ({ url } = await strava.lienAutorisation(a.id));
    } catch (e) {
      setErreur(message(e));
      return;
    }
    const fenetre = window.open(url, 'msc-strava', 'width=520,height=760');
    if (!fenetre) { window.location.assign(url); return; }
    setJob('popup');
    const debut = Date.now();
    window.clearInterval(sondage.current);
    sondage.current = window.setInterval(() => {
      void (async () => {
        const liste = await recharger();
        const moi = liste?.find((x) => x.id === a.id);
        const fini = moi?.strava.lie || fenetre.closed || Date.now() - debut > 3 * 60 * 1000;
        if (fini) {
          window.clearInterval(sondage.current);
          setJob('idle');
          if (moi?.strava.lie) fenetre.close();
        }
      })();
    }, 3000);
  };

  const delier = async () => {
    setConfirme(false); setErreur(null); setJob('delier');
    try {
      await strava.delier(a.id);
      await recharger();
    } catch (e) {
      setErreur(message(e));
    } finally {
      setJob('idle');
    }
  };

  const importer = async () => {
    setErreur(null); setJob('import'); setImporte(null);
    try {
      setImporte(await strava.importerHistorique(a.id, depuis));
      await recharger();
      onImporte?.();
    } catch (e) {
      setErreur(message(e));
    } finally {
      setJob('idle');
    }
  };

  const enregistrerApp = async () => {
    setErreur(null); setJob('app');
    try {
      await strava.ecrireApp(a.id, { client_id: clientId.trim(), client_secret: secret || undefined });
      setSecret('');
      setAppFait(true);
      setTimeout(() => setAppFait(false), 1500);
      await recharger();
    } catch (e) {
      setErreur(message(e));
    } finally {
      setJob('idle');
    }
  };

  const effacerApp = async () => {
    setErreur(null); setJob('app');
    try {
      await strava.effacerApp(a.id);
      setClientId(''); setSecret(''); setAppOuverte(false);
      await recharger();
    } catch (e) {
      setErreur(message(e));
    } finally {
      setJob('idle');
    }
  };

  const s = a.strava;
  const etatApp = a.app.propre
    ? t.appPropreOui(a.app.client_id ?? '')
    : a.app.commune
      ? t.appCommuneOui(a.app.commune_client_id ?? '')
      : t.appAucune;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 0', borderTop: `1px solid ${C.borderSoft}` }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: R.full, flexShrink: 0, display: 'grid', placeItems: 'center', background: s.lie ? C.accentSoft : C.surfaceAlt, color: s.lie ? C.accentDeep : C.inkQuiet }}>
          <Icon name="link" size={15} />
        </div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: C.ink }}>{a.nom}</span>
            <Pastille texte={`Strava · ${s.lie ? t.connecte : t.nonConnecte}`} ok={s.lie} />
          </div>
          {s.lie && s.athlete && (
            <div style={{ fontSize: 11.5, color: C.inkSecondary, lineHeight: 1.4 }}>
              {`${s.athlete.prenom} ${s.athlete.nom}`.trim()}{` · #${s.athlete.id}`}
              {s.lie_le ? ` · ${t.relieLe} ${jour(s.lie_le)}` : ''}
              {` · ${t.synchro} : ${s.derniere_synchro ? jour(s.derniere_synchro) : t.jamais}`}
            </div>
          )}
          {!s.configure && (
            <div style={{ display: 'flex', gap: 5, alignItems: 'center', fontSize: 11.5, color: C.warning }}>
              <Icon name="triangle-alert" size={12} />
              <span>{t.nonConfigure}</span>
            </div>
          )}
          <div style={{ fontSize: 11, color: C.inkQuiet, lineHeight: 1.4 }}>
            {t.activites(a.activites.n)}{a.activites.derniere ? ` · ${t.derniere} ${jour(a.activites.derniere)}` : ''}
            {s.lie ? ` · ${t.synchroNote}` : ''}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingLeft: 42 }}>
        {!s.lie && (
          <>
            <button type="button" disabled={job !== 'idle' || !s.configure} onClick={() => void lienAEnvoyer()} style={{ ...BOUTON, opacity: s.configure ? 1 : 0.5 }}>
              {t.lienEnvoyer}
            </button>
            <button type="button" disabled={job !== 'idle' || !s.configure} onClick={() => void ouvrirIci()} style={{ ...BOUTON_SOBRE, opacity: s.configure ? 1 : 0.5 }}>
              {job === 'popup' ? t.attente : t.ouvrirIci}
            </button>
          </>
        )}
        {s.lie && (confirme ? (
          <>
            <span style={{ fontSize: 12, fontWeight: 600, color: C.negative, alignSelf: 'center' }}>{t.delierConfirme}</span>
            <button type="button" onClick={() => void delier()} style={{ ...BOUTON, background: C.negative, color: '#fff' }}>{t.oui}</button>
            <button type="button" onClick={() => setConfirme(false)} style={BOUTON_SOBRE}>{t.annuler}</button>
          </>
        ) : (
          <button type="button" disabled={job !== 'idle'} onClick={() => setConfirme(true)} style={{ ...BOUTON_SOBRE, color: C.negative, borderColor: C.negative }}>
            {t.delier}
          </button>
        ))}
      </div>

      {s.lie && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 42 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" disabled={job !== 'idle'} onClick={() => void importer()} style={BOUTON}>
              {job === 'import' ? t.importEnCours : t.importer}
            </button>
            <span style={{ fontSize: 11, color: C.inkSecondary }}>{t.importDepuis}</span>
            <input type="date" value={depuis} onChange={(e) => setDepuis(e.target.value)} aria-label={t.importDepuis} style={{ ...ENTREE, width: 'auto', fontSize: 12, padding: '6px 8px' }} />
          </div>
          <div style={{ fontSize: 11, color: C.inkQuiet, lineHeight: 1.4 }}>{t.importAide}</div>
          {importe && (
            <div style={{ display: 'flex', gap: 5, alignItems: 'center', fontSize: 12, color: C.accentDeep }}>
              <Icon name="circle-check" size={13} />
              <span>{t.importFait(importe.importees, importe.premiere, importe.derniere)}</span>
            </div>
          )}
        </div>
      )}

      {lien && !s.lie && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 42 }}>
          <div style={{ fontSize: 11, color: C.inkSecondary, lineHeight: 1.4 }}>{t.lienAide}</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input readOnly value={lien.url} onFocus={(e) => e.currentTarget.select()} aria-label={t.lienEnvoyer} style={{ ...ENTREE, fontSize: 11 }} />
            <button type="button" onClick={() => void copier()} style={BOUTON}>{copie ? t.copie : t.copier}</button>
          </div>
          {lien.expire_le && <div style={{ fontSize: 10.5, color: C.inkQuiet }}>{`${t.expire} ${lien.expire_le.replace('T', ' ').slice(0, 16)} UTC`}</div>}
        </div>
      )}
      {job === 'popup' && (
        <div style={{ fontSize: 11, color: C.inkSecondary, lineHeight: 1.4, paddingLeft: 42 }}>{t.ouvrirAide}</div>
      )}

      {/* l'application propre */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 42 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: C.inkSecondary }}>{t.appPropre}</span>
          <span style={{ fontSize: 11, fontFamily: F.mono, color: a.app.propre || a.app.commune ? C.ink : C.warning }}>{etatApp}</span>
          <button type="button" onClick={() => setAppOuverte((o) => !o)} aria-expanded={appOuverte} style={{ ...BOUTON_SOBRE, padding: '4px 9px', fontSize: 11 }}>
            {appOuverte ? t.fermer : a.app.propre ? t.modifierApp : t.renseignerApp}
          </button>
        </div>
        {a.app.illisible && (
          <div style={{ display: 'flex', gap: 5, alignItems: 'center', fontSize: 11.5, color: C.negative }}>
            <Icon name="triangle-alert" size={12} />
            <span>{t.appIllisible}</span>
          </div>
        )}
        {appOuverte && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 11, color: C.inkSecondary }}>{t.clientId}</span>
              <input value={clientId} onChange={(e) => setClientId(e.target.value)} inputMode="numeric" autoComplete="off" style={ENTREE} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 11, color: C.inkSecondary }}>{t.secret}</span>
              <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="new-password" style={ENTREE} />
              <span style={{ fontSize: 10.5, color: C.inkQuiet }}>{t.secretAide}</span>
            </label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button type="button" disabled={job !== 'idle' || clientId.trim() === '' || (!a.app.propre && secret === '')} onClick={() => void enregistrerApp()} style={{ ...BOUTON, opacity: clientId.trim() && (a.app.propre || secret) ? 1 : 0.5 }}>
                {appFait ? t.enregistre : t.enregistrer}
              </button>
              {a.app.propre && (
                <button type="button" disabled={job !== 'idle'} onClick={() => void effacerApp()} style={BOUTON_SOBRE}>{t.effacer}</button>
              )}
            </div>
          </div>
        )}
      </div>

      {erreur && (
        <div role="alert" style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 12, lineHeight: 1.4, color: C.negative, paddingLeft: 42 }}>
          <Icon name="triangle-alert" size={13} />
          <span>{erreur}</span>
        </div>
      )}
    </div>
  );
}

