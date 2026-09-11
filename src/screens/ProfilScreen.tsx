/* Le profil de l'athlète affiché, dans le back office : les mêmes champs que
   la feuille de profil du téléphone, les deux références 10 km d'où toutes
   les allures du plan sortent, et l'état de sa connexion Strava — vérifié
   d'un bouton, corrigé dans sa section Strava. */

import { useEffect, useState } from 'react';
import * as api from '../data/api';
import * as db from '../data/db';
import * as strava from '../data/strava';
import type { Lang } from '../data/types';
import { C, F, R } from '../design/theme';
import { Icon } from '../components/Icon';
import { Card, Colonnes, SectionLabel } from '../components/primitives';
import { ProfilForm } from '../components/ProfilSheet';
import { AdresseRetour } from '../components/StravaAthlete';
import type { App } from '../state/useApp';

const T = {
  fr: {
    profil: 'Profil', references: 'Références 10 km', actuelle: 'actuelle', cible: 'cible',
    aide: 'Toutes les allures du plan sont calculées depuis ces deux nombres. L’onboarding les pose ; le test de 30 minutes recale la première ; un nouveau plan (section Plan) les réécrit.',
    strava: 'Connexion Strava', verifier: 'Vérifier la connexion', verification: 'Vérification…',
    connecte: 'connecté', nonConnecte: 'non connecté', nonConfigure: 'Strava non configuré pour cet athlète',
    synchro: 'dernière synchro', jamais: 'jamais', pasVerifie: 'pas encore vérifiée', versStrava: '→ Strava',
    aideStrava: 'Le compte Strava relié, et quand il a synchronisé pour la dernière fois. Pour relier, importer l’historique ou poser son application : sa section Strava.',
  },
  pl: {
    profil: 'Profil', references: 'Odniesienia 10 km', actuelle: 'obecne', cible: 'docelowe',
    aide: 'Wszystkie tempa planu liczone są z tych dwóch liczb. Onboarding je ustawia; test 30 minut koryguje pierwszą; nowy plan (sekcja Plan) je nadpisuje.',
    strava: 'Połączenie Strava', verifier: 'Sprawdź połączenie', verification: 'Sprawdzanie…',
    connecte: 'połączona', nonConnecte: 'niepołączona', nonConfigure: 'Strava nieskonfigurowana dla tego zawodnika',
    synchro: 'ostatnia synchronizacja', jamais: 'nigdy', pasVerifie: 'jeszcze niesprawdzone', versStrava: '→ Strava',
    aideStrava: 'Połączone konto Strava i kiedy ostatnio synchronizowało. Połączenie, import historii, własna aplikacja: jego sekcja Strava.',
  },
} satisfies Record<Lang, unknown>;

export function ProfilScreen({
  app, onSection, onSupprime, large = false,
}: {
  app: App; onSection?: (s: 'strava') => void;
  /** Rendu seulement dans le back office : supprimer l'athlète affiché. */
  onSupprime?: () => void;
  large?: boolean;
}) {
  const t = T[app.lang];
  const [etat, setEtat] = useState<strava.EtatStrava | null>(null);
  const [job, setJob] = useState<'idle' | 'verif'>('idle');
  const [erreur, setErreur] = useState<string | null>(null);

  const verifier = async () => {
    setJob('verif'); setErreur(null);
    try {
      setEtat(await strava.etat(db.athleteId));
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setJob('idle');
    }
  };

  const couleur = !etat ? C.inkQuiet : etat.lie ? C.accentDeep : etat.configure ? C.warning : C.negative;

  return (
    <Colonnes large={large} ratio="minmax(0, 7fr) minmax(0, 5fr)" gauche={
      <Card padding="16px 18px" gap={12}>
        <SectionLabel icon="user" color={C.teal}>{`${t.profil} · ${db.athlete.nom}`}</SectionLabel>
        <ProfilForm app={app} onDone={() => undefined} />
      </Card>
    } droite={<>
      <Card padding="16px 18px" gap={8}>
        <SectionLabel icon="gauge" color={C.teal}>{t.references}</SectionLabel>
        <div style={{ display: 'flex', gap: 16, alignItems: 'baseline' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontFamily: F.mono, fontSize: 19, color: C.ink }}>{db.format10k(db.athlete.ref_actuelle_s)}</span>
            <span style={{ fontSize: 10.5, color: C.inkSecondary }}>{t.actuelle}</span>
          </div>
          <span style={{ color: C.inkQuiet }}>→</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontFamily: F.mono, fontSize: 19, color: C.ink }}>{db.format10k(db.athlete.ref_cible_s)}</span>
            <span style={{ fontSize: 10.5, color: C.inkSecondary }}>{t.cible}</span>
          </div>
        </div>
        <div style={{ fontSize: 11.5, color: C.inkSecondary, lineHeight: 1.45 }}>{t.aide}</div>
      </Card>

      <Card padding="16px 18px" gap={8}>
        <SectionLabel icon="link" color={C.teal}>{t.strava}</SectionLabel>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Icon name={etat?.lie ? 'circle-check' : etat ? 'triangle-alert' : 'circle-dashed'} size={15} color={couleur} />
          <span style={{ fontSize: 12.5, fontWeight: 600, color: couleur }}>
            {!etat
              ? t.pasVerifie
              : !etat.configure
                ? t.nonConfigure
                : etat.lie
                  ? `${t.connecte}${etat.athlete ? ` · ${[etat.athlete.prenom, etat.athlete.nom].filter(Boolean).join(' ')}` : ''}`
                  : t.nonConnecte}
          </span>
          {etat?.lie && (
            <span style={{ fontSize: 11, color: C.inkSecondary }}>
              {`· ${t.synchro} : ${etat.derniere_synchro ? String(etat.derniere_synchro).slice(0, 10) : t.jamais}`}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            disabled={job !== 'idle'}
            onClick={() => void verifier()}
            style={{ padding: '7px 12px', borderRadius: R.md, background: C.accent, color: C.accentInk, fontWeight: 700, fontSize: 12, border: 'none' }}
          >
            {job === 'verif' ? t.verification : t.verifier}
          </button>
          {onSection && (
            <button type="button" onClick={() => onSection('strava')} style={{ padding: '7px 12px', borderRadius: R.md, border: `1px solid ${C.border}`, color: C.inkMuted, fontSize: 12, fontWeight: 600, background: C.surface }}>
              {t.versStrava}
            </button>
          )}
        </div>
        {erreur && <div style={{ fontSize: 12, color: C.negative }}>{erreur}</div>}
        {/* Le réglage que Strava juge, et qui fait rater la liaison sans rien
            dire ici : on ne le montre que quand il cloche. */}
        {etat && !strava.verdictRappel(etat.rappel).ok && (
          <AdresseRetour rappel={etat.rappel} lang={app.lang} />
        )}
        <div style={{ fontSize: 11, color: C.inkQuiet, lineHeight: 1.45 }}>{t.aideStrava}</div>
      </Card>

      {/* La sortie définitive : seulement dans le back office, seulement pour
          un admin, et jamais d'un seul bouton. */}
      {onSupprime && <Supprimer app={app} onSupprime={onSupprime} />}
    </>} />
  );
}

/* ------------------------------------------------- supprimer un athlète

   Définitif, et ça emporte tout : le plan, les séances, le journal, les
   activités, les courses, les mesures, les photos, ce qu'il a demandé au
   coach. Alors on le dit d'abord, chiffre par chiffre, et on demande son nom
   écrit à la main — le serveur le revérifie. Un bouton rouge tout seul ne
   protège de rien : ce qui protège, c'est de savoir ce qu'on détruit. */

const S = {
  fr: {
    titre: 'Supprimer cet athlète',
    aide: 'Définitif. Tout ce qui lui appartient part avec lui, et rien ne se récupère.',
    ouvrir: 'Supprimer cet athlète…', annuler: 'Annuler',
    ceQui: 'Ce qui sera détruit',
    plans: 'plans', seances: 'séances', activites: 'activités Strava', journal: 'jours de journal',
    courses: 'courses', mesures: 'mesures', photos: 'photos', analyses: 'analyses', questions: 'questions au coach',
    strava: 'la liaison Strava',
    comptes: 'Comptes qui le voient', seulLui: 'ne voit que lui',
    avecCompte: 'Supprimer aussi les comptes qui ne voient que lui',
    tape: 'Écris son nom pour confirmer',
    supprimer: 'Supprimer définitivement', enCours: 'Suppression…',
    fait: (n: string) => `${n} a été supprimé.`,
  },
  pl: {
    titre: 'Usuń tego zawodnika',
    aide: 'Nieodwracalne. Wszystko, co do niego należy, znika razem z nim.',
    ouvrir: 'Usuń tego zawodnika…', annuler: 'Anuluj',
    ceQui: 'Co zostanie usunięte',
    plans: 'plany', seances: 'treningi', activites: 'aktywności Strava', journal: 'dni dziennika',
    courses: 'starty', mesures: 'pomiary', photos: 'zdjęcia', analyses: 'analizy', questions: 'pytania do trenera',
    strava: 'połączenie ze Stravą',
    comptes: 'Konta, które go widzą', seulLui: 'widzi tylko jego',
    avecCompte: 'Usuń też konta, które widzą tylko jego',
    tape: 'Wpisz jego nazwisko, aby potwierdzić',
    supprimer: 'Usuń nieodwracalnie', enCours: 'Usuwanie…',
    fait: (n: string) => `${n} został usunięty.`,
  },
} satisfies Record<Lang, unknown>;

function Supprimer({ app, onSupprime }: { app: App; onSupprime: () => void }) {
  const t = S[app.lang];
  const id = db.athleteId;
  const [ouvert, setOuvert] = useState(false);
  const [resume, setResume] = useState<api.ResumeAthlete | null>(null);
  const [nom, setNom] = useState('');
  const [avecCompte, setAvecCompte] = useState(false);
  const [job, setJob] = useState<'idle' | 'suppression'>('idle');
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    if (!ouvert || !id) return;
    setResume(null); setNom(''); setErreur(null);
    api.resumeAthlete(id).then(setResume).catch((e) => setErreur(e instanceof Error ? e.message : String(e)));
  }, [ouvert, id]);

  if (!id) return null;

  const compte = resume?.compte;
  const lignes: Array<[number, string]> = compte
    ? ([
      [compte.seances, t.seances], [compte.plans, t.plans], [compte.activites, t.activites],
      [compte.journal, t.journal], [compte.courses, t.courses], [compte.mesures, t.mesures],
      [compte.photos, t.photos], [compte.analyses, t.analyses], [compte.questions, t.questions],
    ] as Array<[number, string]>).filter(([n]) => n > 0)
    : [];

  const supprimer = async () => {
    setJob('suppression'); setErreur(null);
    try {
      await api.supprimerAthlete(id, { nom, compte: avecCompte });
      setOuvert(false);
      onSupprime();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setJob('idle');
    }
  };

  return (
    <Card padding="16px 18px" gap={10} borderColor={C.negative}>
      <SectionLabel icon="triangle-alert" color={C.negative}>{t.titre}</SectionLabel>
      <div style={{ fontSize: 12, color: C.inkSecondary, lineHeight: 1.5 }}>{t.aide}</div>

      {!ouvert ? (
        <div>
          <button
            type="button"
            onClick={() => setOuvert(true)}
            style={{ padding: '8px 12px', borderRadius: R.md, border: `1px solid ${C.negative}`, color: C.negative, background: C.surface, fontSize: 12, fontWeight: 600 }}
          >
            {t.ouvrir}
          </button>
        </div>
      ) : (
        <>
          {compte && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: C.negative }}>{t.ceQui}</div>
              <div style={{ fontSize: 12.5, color: C.ink, lineHeight: 1.6 }}>
                {lignes.length === 0
                  ? '—'
                  : lignes.map(([n, mot]) => `${n} ${mot}`).join(' · ')}
                {compte.strava > 0 ? ` · ${t.strava}` : ''}
              </div>
            </div>
          )}

          {resume && resume.comptes.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: C.inkSecondary }}>{t.comptes}</div>
              {resume.comptes.map((c) => (
                <div key={c.id} style={{ fontSize: 12, color: C.inkSecondary }}>
                  {c.email}
                  {c.seulement_lui ? <span style={{ color: C.warning }}>{` · ${t.seulLui}`}</span> : null}
                </div>
              ))}
              {resume.comptes.some((c) => c.seulement_lui) && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: C.ink }}>
                  <input type="checkbox" checked={avecCompte} onChange={(e) => setAvecCompte(e.target.checked)} />
                  {t.avecCompte}
                </label>
              )}
            </div>
          )}

          <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ fontSize: 11, color: C.inkSecondary, fontWeight: 600 }}>
              {`${t.tape} : « ${resume?.athlete.nom ?? db.athlete.nom} »`}
            </span>
            <input
              value={nom}
              onChange={(e) => setNom(e.target.value)}
              style={{ padding: '10px 12px', borderRadius: R.md, border: `1px solid ${C.border}`, background: C.surface, color: C.ink, fontSize: 14, fontFamily: F.body }}
            />
          </label>

          {erreur && <div style={{ fontSize: 12, color: C.negative }}>{erreur}</div>}

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => setOuvert(false)}
              style={{ padding: '9px 12px', borderRadius: R.md, border: `1px solid ${C.border}`, background: C.surface, color: C.inkMuted, fontSize: 12, fontWeight: 600 }}
            >
              {t.annuler}
            </button>
            <button
              type="button"
              disabled={job !== 'idle' || nom.trim() === ''}
              onClick={() => void supprimer()}
              style={{
                padding: '9px 14px', borderRadius: R.md, border: 'none', fontSize: 12, fontWeight: 700,
                background: C.negative, color: '#fff', opacity: job !== 'idle' || nom.trim() === '' ? 0.5 : 1,
              }}
            >
              {job === 'idle' ? t.supprimer : t.enCours}
            </button>
          </div>
        </>
      )}
    </Card>
  );
}
