/* Le back office des athlètes : chacun en un coup d'œil, et un toucher pour
   passer sur lui. La phase et sa couleur, la semaine, les allures, ce qui est
   fait cette semaine, la forme. Tout vient de /api/apercu — rien n'est calculé
   deux fois. */

import { useCallback, useEffect, useState } from 'react';
import * as api from '../data/api';
import type { AthleteAdmin, CompteAdmin } from '../data/api';
import { Assistant } from './ComptesScreen';
import type { Onglet } from './AdminScreen';
import * as db from '../data/db';
import type { ApercuAthlete, Conversation as ConversationType, Lang } from '../data/types';
import { C, F, R } from '../design/theme';
import { coachDe } from '../data/coachs';
import { Avatar } from '../components/Avatar';
import { Progression } from '../components/Progression';
import { progression } from '../data/progression';
import { CoachAvatar } from '../components/CoachAvatar';
import { FormeJauge } from '../components/FormeJauge';
import { Colonnes } from '../components/primitives';
import { Courbe } from '../components/Courbe';
import type { Point } from '../components/Courbe';
import { Icon } from '../components/Icon';
import { limiteEnClair } from '../components/Limites';
import type { App } from '../state/useApp';

/* Même lecture que la frise des Paramètres : la phase se lit sur `part`. */
function phaseDe(part: number): { icon: string; couleur: string } {
  if (part <= 0) return { icon: 'leaf', couleur: C.teal };
  if (part < 0.5) return { icon: 'trending-down', couleur: C.accentDeep };
  if (part < 1) return { icon: 'flame', couleur: C.warning };
  return { icon: 'target', couleur: C.ink };
}

const T: Record<Lang, Record<string, string>> = {
  fr: { semaine: 'Semaine', sansPlan: 'Pas de plan actif', seances: 'séances', faites: 'faites',
        volume: 'Volume', rpe: 'Dernier RPE', voir: 'Ouvrir', chargement: 'Lecture des athlètes…',
        titre: 'Athlètes', reserve: 'Créer un athlète ou un compte est réservé à l’admin.',
        aucun: 'Aucun athlète visible pour ce compte.', courant: 'en cours',
        compte: 'Compte', sansLogin: 'sans login', desactive: 'désactivé',
        lien: 'Lien', lienEnCours: '…', copie: 'Lien copié — à usage unique, envoie-le-lui',
        desactiver: 'Désactiver', reactiver: 'Réactiver', supprimer: 'Supprimer…',
        actions: 'Son compte' },
  pl: { semaine: 'Tydzień', sansPlan: 'Brak aktywnego planu', seances: 'treningi', faites: 'zrobione',
        volume: 'Objętość', rpe: 'Ostatnie RPE', voir: 'Otwórz', chargement: 'Wczytywanie zawodników…',
        titre: 'Zawodnicy', reserve: 'Tworzenie zawodników i kont jest zastrzeżone dla admina.',
        aucun: 'Brak widocznych zawodników.', courant: 'bieżący',
        compte: 'Konto', sansLogin: 'bez loginu', desactive: 'wyłączone',
        lien: 'Link', lienEnCours: '…', copie: 'Link skopiowany — jednorazowy, wyślij mu go',
        desactiver: 'Wyłącz', reactiver: 'Włącz', supprimer: 'Usuń…',
        actions: 'Jego konto' },
};

function h(min: number): string {
  const hh = Math.floor(min / 60); const mm = min % 60;
  return hh ? `${hh}h${String(mm).padStart(2, '0')}` : `${mm} min`;
}

/* ----------------------------------------------- les conversations */

/* Ce que l'athlète a demandé au coach, et ce que le coach a répondu — avec
   le ton qui parlait, le modèle, le coût. Replié par défaut : c'est le
   coach humain qui l'ouvre, quand il veut relire. */
function Conversations({ athleteId, lang }: { athleteId: number; lang: Lang }) {
  const fr = lang === 'fr';
  const [ouvert, setOuvert] = useState(false);
  const [fils, setFils] = useState<ConversationType[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    if (!ouvert || fils !== null) return;
    let vivant = true;
    api.conversations(athleteId)
      .then((r) => { if (vivant) setFils(r.fils); })
      .catch((e) => { if (vivant) setErreur(e instanceof Error ? e.message : String(e)); });
    return () => { vivant = false; };
  }, [ouvert, fils, athleteId]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <button
        type="button"
        className="msc-hover-accent"
        aria-expanded={ouvert}
        onClick={() => setOuvert((v) => !v)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 600, color: C.inkSecondary, alignSelf: 'flex-start' }}
      >
        <Icon name="message-square-quote" size={14} />
        {fr ? 'Ce qu’il a demandé au coach' : 'O co pytał trenera'}
        <Icon name="chevron-right" size={13} />
      </button>
      {ouvert && erreur && <div style={{ fontSize: 12, color: C.negative }}>{erreur}</div>}
      {ouvert && fils === null && !erreur && <div style={{ fontSize: 12, color: C.inkQuiet }}>{fr ? 'Lecture…' : 'Wczytywanie…'}</div>}
      {ouvert && fils !== null && fils.length === 0 && (
        <div style={{ fontSize: 12, color: C.inkQuiet }}>{fr ? 'Aucune question posée pour l’instant.' : 'Na razie żadnych pytań.'}</div>
      )}
      {ouvert && fils?.map((f) => (
        <div key={f.fil} style={{ borderRadius: R.md, border: `1px solid ${C.border}`, background: C.page, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: C.inkSecondary }}>
            {f.titre[lang]}
          </div>
          {f.tours.map((t, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexDirection: t.role === 'user' ? 'row' : 'row-reverse' }}>
              {t.role === 'assistant' ? <CoachAvatar code={t.ton} taille={26} /> : <Icon name="user" size={16} color={C.inkQuiet} />}
              <div
                style={{
                  maxWidth: '85%', padding: '7px 10px', borderRadius: 12, fontSize: 12.5, lineHeight: 1.45,
                  background: t.role === 'user' ? C.surface : C.accentSoft, color: C.inkBody,
                  border: `1px solid ${t.role === 'user' ? C.border : 'transparent'}`,
                }}
              >
                {t.texte}
                {t.role === 'assistant' && (
                  <div style={{ marginTop: 4, fontSize: 10, color: C.inkQuiet, fontFamily: F.mono }}>
                    {[t.ton ? coachDe(t.ton).nom[lang] : null, t.modele, t.cout_eur != null ? `${t.cout_eur.toFixed(4)} €` : null, t.date.slice(0, 10)]
                      .filter(Boolean).join(' · ')}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Carte({ a, app }: { a: ApercuAthlete; app: App }) {
  const t = T[app.lang];
  const fr = app.lang === 'fr';
  const courant = a.id === db.athleteId;
  const phase = a.bloc ? phaseDe(a.bloc.part) : null;
  const affiche = [a.prenom, a.nom].filter(Boolean).join(' ') || a.nom;

  return (
    <div
      style={{
        borderRadius: R.card, background: C.surface, padding: 14,
        border: `1px solid ${courant ? C.accent : C.border}`, boxShadow: C.shadowCard,
        display: 'flex', flexDirection: 'column', gap: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Avatar nom={affiche} taille={44} palier={a.niveau} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: F.display, fontSize: 17, fontWeight: 600, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {affiche}
            {a.surnom && <span style={{ fontWeight: 500, color: C.inkSecondary }}> · {a.surnom}</span>}
          </div>
          {a.bloc && phase ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, fontSize: 12, color: phase.couleur, fontWeight: 600 }}>
              <Icon name={phase.icon} size={13} color={phase.couleur} />
              <span>{a.bloc.nom[app.lang]}</span>
              <span style={{ color: C.inkQuiet, fontWeight: 500 }}>· {t.semaine} {a.semaine}/{a.total}</span>
            </div>
          ) : (
            <div style={{ marginTop: 3, fontSize: 12, color: C.inkQuiet }}>{t.sansPlan}</div>
          )}
        </div>
        {/* La carte vit dans la fiche de l'athlète, qui dit déjà de qui il
            s'agit : ni bascule ni « en cours » à répéter ici. */}
      </div>

      {/* allures et semaine en cours : une ligne de tuiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        {/* La référence en gros, la cible dessous : les deux tiennent dans un
            tiers de largeur, là où « 52:00 → 38:00 » sur une ligne se coupait. */}
        <Tuile label="10 km" valeur={db.format10k(a.ref_actuelle_s)} sous={`→ ${db.format10k(a.ref_cible_s)}`} />
        <Tuile
          label={fr ? 'Séances' : 'Treningi'}
          valeur={`${a.cette_semaine.faites}/${a.cette_semaine.prevues}`}
          sous={`${h(a.cette_semaine.volume_realise_min)} / ${h(a.cette_semaine.volume_prevu_min)}`}
        />
        <Tuile label={t.rpe} valeur={a.dernier_rpe ? String(a.dernier_rpe.valeur) : '—'} sous={a.dernier_rpe?.date ?? ''} />
      </div>

      {/* son coach, et ce qui a bloqué la dernière fois — la ligne que le
          coach humain lit avant le chiffre */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: C.inkSecondary }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <CoachAvatar code={a.coach} taille={22} />
          <span style={{ fontWeight: 600 }}>{coachDe(a.coach).nom[app.lang]}</span>
        </div>
        {a.dernier_rpe?.limites?.length ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.inkQuiet }}>
            <Icon name="circle-question-mark" size={13} />
            <span>
              {`${fr ? 'A bloqué' : 'Blokowało'} : ${a.dernier_rpe.limites.map((l) => limiteEnClair(l, app.lang).toLowerCase()).join(', ')}`}
            </span>
          </div>
        ) : null}
      </div>

      <FormeJauge a={a} lang={app.lang} compact />

      <Conversations athleteId={a.id} lang={app.lang} />
    </div>
  );
}

function Tuile({ label, valeur, sous }: { label: string; valeur: string; sous?: string }) {
  return (
    <div style={{ borderRadius: R.md, background: C.page, padding: '8px 10px', minWidth: 0 }}>
      <div style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: C.inkQuiet, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
      <div style={{ fontFamily: F.mono, fontSize: 13, color: C.ink, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{valeur}</div>
      {sous && <div style={{ fontSize: 10, color: C.inkQuiet, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sous}</div>}
    </div>
  );
}

/* Le suivi de l'athlète affiché : sa carte de coach — allures, semaine en
   cours, dernier RPE, son coach, sa forme, ce qu'il a demandé. */
export function SuiviAthlete({ app, large = false }: { app: App; large?: boolean }) {
  const t = T[app.lang];
  const fr = app.lang === 'fr';
  useEffect(() => { void app.chargerApercu(); }, [app.chargerApercu, app.version]);
  const a = app.apercu?.find((x) => x.id === db.athleteId);
  /* Le poids est à l'athlète — une mesure confirmée du matin — pas à ses
     courses : sa courbe vit ici, avec le reste de son suivi. */
  const poids: Point[] = db
    .select('msc_mesure')
    .filter((m) => m.poids_kg !== undefined)
    .map((m) => ({ date: m.date, valeur: m.poids_kg as number, label: m.date }));
  if (app.apercu === null) return <div style={{ color: C.inkSecondary, fontSize: 13 }}>{t.chargement}</div>;
  if (!a) return <div style={{ color: C.inkSecondary, fontSize: 13 }}>{t.aucun}</div>;
  /* Où en est son niveau, et où le plan le mène : c'est la question que « ce
     qui a été fait » pose sans y répondre. Le modèle est dans
     src/data/progression.ts ; ici on ne fait que le montrer. */
  const suivi = progression(app.semaine, app.lang);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
    <Colonnes large={large} ratio="minmax(0, 7fr) minmax(0, 5fr)" gauche={<Carte a={a} app={app} />} droite={
      <div style={{ borderRadius: R.card, background: C.surface, border: `1px solid ${C.border}`, boxShadow: C.shadowCard, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="scale" size={16} color={C.teal} />
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.teal }}>{fr ? 'Poids' : 'Waga'}</div>
        </div>
        <Courbe
          points={poids}
          couleur="#029CD0"
          format={(v) => `${v.toFixed(1)} kg`}
          vide={fr ? 'Aucune mesure de poids confirmée.' : 'Brak potwierdzonych pomiarów wagi.'}
        />
      </div>
    } />

    {/* Toute la largeur : une série sur huit mois dans une colonne étroite est
        une série qu'on ne lit pas. */}
    {suivi && <Progression donnees={suivi} lang={app.lang} />}
    </div>
  );
}

/* Le hub des athlètes : la liste de ceux que le compte voit, en une ligne
   chacun — qui, où dans son plan, ses allures, sa semaine — et « Ouvrir »,
   qui en fait l'athlète affiché et ouvre son suivi. Dessous, pour l'admin,
   l'onboarding : l'assistant qui crée un athlète et son compte, une fois. Ce
   qui change tout le temps — son plan, ses starts — est dans ses sections. */
/* Ce qu'on fait du compte d'un athlète depuis la liste : lui envoyer un lien
   de connexion, le désactiver, ou le supprimer.

   Supprimer n'est pas un bouton de plus ici : ça ouvre sa fiche, où la
   suppression dit d'abord ce qu'elle détruit et demande son nom. Une
   destruction irréversible n'a pas sa place au bout d'une ligne de tableau,
   et en avoir deux versions serait pire encore. */
function ActionsCompte({
  athleteId, compte, t, onLien, onActif, onSupprimer,
}: {
  athleteId: number;
  compte: CompteAdmin | null;
  t: Record<string, string>;
  onLien: (compteId: number) => Promise<void>;
  onActif: (compteId: number, actif: boolean) => Promise<void>;
  onSupprimer: (athleteId: number) => void;
}) {
  const [job, setJob] = useState<'idle' | 'lien'>('idle');
  const bouton: React.CSSProperties = {
    padding: '5px 9px', borderRadius: R.full, fontSize: 11, fontWeight: 600,
    border: `1px solid ${C.border}`, background: C.surface, color: C.inkSecondary,
    whiteSpace: 'nowrap',
  };
  return (
    <span style={{ display: 'inline-flex', gap: 5, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      {compte && compte.actif && (
        <button
          type="button" style={bouton} disabled={job === 'lien'}
          onClick={() => {
            setJob('lien');
            void onLien(compte.id).finally(() => setJob('idle'));
          }}
        >
          {job === 'lien' ? t.lienEnCours : t.lien}
        </button>
      )}
      {compte && (
        <button type="button" style={bouton} onClick={() => void onActif(compte.id, !compte.actif)}>
          {compte.actif ? t.desactiver : t.reactiver}
        </button>
      )}
      <button
        type="button"
        style={{ ...bouton, color: C.negative, borderColor: C.border }}
        onClick={() => onSupprimer(athleteId)}
      >
        {t.supprimer}
      </button>
    </span>
  );
}

export function AthletesHub({ app, onAthlete, large = false }: { app: App; onAthlete?: (o: Onglet) => void; large?: boolean }) {
  const t = T[app.lang];
  const fr = app.lang === 'fr';
  useEffect(() => { void app.chargerApercu(); }, [app.chargerApercu, app.version]);
  const admin = app.identite?.compte.role === 'admin';
  const [listes, setListes] = useState<{ comptes: CompteAdmin[]; athletes: AthleteAdmin[] } | null>(null);
  const relire = useCallback(() => {
    if (!admin) return;
    api.adminComptes().then(setListes).catch(() => setListes(null));
  }, [admin]);
  useEffect(() => { relire(); }, [relire, app.version]);

  /* Toucher un athlète, c'est ouvrir SA fiche : on bascule dessus, puis on
     entre par son suivi — ce qu'il a fait, la première question qu'on pose. */
  const ouvrir = async (id: number, onglet: Onglet = 'suivi') => {
    if (id !== db.athleteId) await app.basculerAthlete(id);
    onAthlete?.(onglet);
  };

  /* Le compte d'un athlète : celui qui ne voit que lui, en écriture — son
     login à lui. Un compte d'admin qui voit tout le monde n'est pas « son »
     compte, et le désactiver couperait tout le club. */
  const compteDe = (athleteId: number): CompteAdmin | null => {
    const vus = listes?.comptes.filter((c) => c.athletes.some((a) => a.id === athleteId)) ?? [];
    return vus.find((c) => c.athletes.length === 1 && c.athletes[0].droit === 'ecriture')
      ?? vus.find((c) => c.role === 'athlete')
      ?? null;
  };

  const [message, setMessage] = useState<string | null>(null);
  const envoyerLien = async (compteId: number) => {
    setMessage(null);
    try {
      const r = await api.lienDeConnexion(compteId);
      const url = `${window.location.origin}${import.meta.env.BASE_URL}?lien=${r.jeton}`;
      /* Le presse-papiers n'existe qu'en HTTPS : ailleurs, ou s'il refuse, le
         lien s'affiche en entier plutôt que de prétendre qu'il est copié. */
      let copie = false;
      try { await navigator.clipboard.writeText(url); copie = true; } catch { copie = false; }
      setMessage(copie ? `${t.copie} — ${r.email}` : `${r.email} · ${url}`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };
  const changerActif = async (compteId: number, actif: boolean) => {
    setMessage(null);
    try {
      await api.majCompte(compteId, { actif });
      relire();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ borderRadius: R.card, background: C.surface, border: `1px solid ${C.border}`, boxShadow: C.shadowCard, padding: '12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 6 }}>
          <Icon name="footprints" size={16} color={C.teal} />
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.teal }}>
            {`${t.titre} · ${app.apercu?.length ?? 0}`}
          </div>
        </div>
        {app.apercu === null
          ? <div style={{ color: C.inkSecondary, fontSize: 13, padding: '8px 0' }}>{t.chargement}</div>
          : app.apercu.length === 0
            ? <div style={{ color: C.inkSecondary, fontSize: 13, padding: '8px 0' }}>{t.aucun}</div>
            : large
              ? (
                /* Sur le bureau, un tableau : une colonne par chose, et l'œil
                   compare d'une ligne à l'autre. */
                <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
                  <thead>
                    <tr>
                      {[t.titre.replace(/s$/, ''), t.compte, fr ? 'Plan' : 'Plan', '10 km', fr ? 'Séances · semaine' : 'Treningi · tydzień', t.rpe, ''].map((h, i) => (
                        <th key={i} scope="col" style={{ textAlign: 'left', padding: '6px 8px', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: C.inkSecondary, borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {app.apercu.map((a) => {
                      const courant = a.id === db.athleteId;
                      const affiche = [a.prenom, a.nom].filter(Boolean).join(' ') || a.nom;
                      const phase = a.bloc ? phaseDe(a.bloc.part) : null;
                      const cellule: React.CSSProperties = { padding: '8px 8px', borderTop: `1px solid ${C.borderSoft}`, verticalAlign: 'middle' };
                      return (
                        <tr key={a.id} style={{ background: courant ? C.accentSoft : 'transparent' }}>
                          <td style={cellule}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <Avatar nom={affiche} taille={32} palier={a.niveau} />
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontWeight: 600, color: C.ink, whiteSpace: 'nowrap' }}>{affiche}</div>
                                {a.surnom && <div style={{ fontSize: 11, color: C.inkSecondary }}>{a.surnom}</div>}
                              </div>
                            </div>
                          </td>
                          {/* Son login : c'est ce qu'on cherche quand on veut
                              lui écrire, lui renvoyer un lien, ou comprendre
                              pourquoi il n'entre plus. */}
                          <td style={cellule}>
                            {(() => {
                              const compte = compteDe(a.id);
                              if (!compte) return <span style={{ color: C.inkQuiet, fontSize: 12 }}>{t.sansLogin}</span>;
                              return (
                                <span style={{ display: 'inline-flex', flexDirection: 'column' }}>
                                  <span style={{ fontFamily: F.mono, fontSize: 11.5, color: compte.actif ? C.inkBody : C.inkQuiet }}>{compte.email}</span>
                                  {!compte.actif && <span style={{ fontSize: 10.5, color: C.warning, fontWeight: 600 }}>{t.desactive}</span>}
                                </span>
                              );
                            })()}
                          </td>
                          <td style={cellule}>
                            {a.bloc && phase
                              ? <span style={{ color: phase.couleur, fontWeight: 600, fontSize: 12 }}>{`${a.bloc.nom[app.lang]} · ${t.semaine} ${a.semaine}/${a.total}`}</span>
                              : <span style={{ color: C.inkQuiet, fontSize: 12 }}>{t.sansPlan}</span>}
                          </td>
                          <td style={{ ...cellule, fontFamily: F.mono, fontSize: 12, whiteSpace: 'nowrap' }}>{`${db.format10k(a.ref_actuelle_s)} → ${db.format10k(a.ref_cible_s)}`}</td>
                          <td style={{ ...cellule, fontFamily: F.mono, fontSize: 12, whiteSpace: 'nowrap' }}>
                            {`${a.cette_semaine.faites}/${a.cette_semaine.prevues} · ${h(a.cette_semaine.volume_realise_min)} / ${h(a.cette_semaine.volume_prevu_min)}`}
                          </td>
                          <td style={{ ...cellule, fontFamily: F.mono, fontSize: 12, whiteSpace: 'nowrap' }}>
                            {a.dernier_rpe ? `${a.dernier_rpe.valeur} · ${a.dernier_rpe.date}` : '—'}
                          </td>
                          <td style={{ ...cellule, textAlign: 'right', whiteSpace: 'nowrap' }}>
                            {admin && (
                              <ActionsCompte
                                athleteId={a.id}
                                compte={compteDe(a.id)}
                                t={t}
                                onLien={envoyerLien}
                                onActif={changerActif}
                                onSupprimer={(id) => void ouvrir(id, 'profil')}
                              />
                            )}
                            {' '}
                            <button type="button" className="msc-hover-accent" onClick={() => void ouvrir(a.id)} aria-label={`${t.voir} ${affiche}`}
                              style={{
                                padding: '6px 11px', borderRadius: R.full, fontSize: 12, fontWeight: 600,
                                border: `1px solid ${courant ? C.accent : C.border}`,
                                background: courant ? C.accentSoft : C.surface,
                                color: courant ? C.accentDeep : C.ink,
                              }}>
                              {t.voir}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )
            : app.apercu.map((a) => {
              const courant = a.id === db.athleteId;
              const affiche = [a.prenom, a.nom].filter(Boolean).join(' ') || a.nom;
              const phase = a.bloc ? phaseDe(a.bloc.part) : null;
              return (
                <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: `1px solid ${C.borderSoft}` }}>
                  <Avatar nom={affiche} taille={36} palier={a.niveau} />
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {affiche}{a.surnom ? <span style={{ fontWeight: 500, color: C.inkSecondary }}> · {a.surnom}</span> : null}
                    </div>
                    <div style={{ fontSize: 11, color: C.inkQuiet, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      {a.bloc && phase
                        ? <span style={{ color: phase.couleur, fontWeight: 600 }}>{`${a.bloc.nom[app.lang]} · ${t.semaine} ${a.semaine}/${a.total}`}</span>
                        : <span>{t.sansPlan}</span>}
                      <span>{`· 10 km ${db.format10k(a.ref_actuelle_s)} → ${db.format10k(a.ref_cible_s)}`}</span>
                      <span>{`· ${fr ? 'séances' : 'treningi'} ${a.cette_semaine.faites}/${a.cette_semaine.prevues}`}</span>
                    </div>
                    {admin && (() => {
                      const compte = compteDe(a.id);
                      return (
                        <div style={{ fontSize: 11, color: compte?.actif === false ? C.warning : C.inkQuiet, fontFamily: F.mono }}>
                          {compte ? `${compte.email}${compte.actif ? '' : ` · ${t.desactive}`}` : t.sansLogin}
                        </div>
                      );
                    })()}
                  </div>
                  {/* Ouvrir vaut pour tout le monde, l'athlète affiché
                      compris : c'est sa fiche qu'on ouvre, pas un changement
                      d'athlète — un « en cours » sans porte laissait croire
                      qu'il n'y avait rien à voir. */}
                  <button
                    type="button"
                    className="msc-hover-accent"
                    onClick={() => void ouvrir(a.id)}
                    aria-label={`${t.voir} ${affiche}`}
                    style={{
                      padding: '6px 11px', borderRadius: R.full, fontSize: 12, fontWeight: 600,
                      whiteSpace: 'nowrap',
                      border: `1px solid ${courant ? C.accent : C.border}`,
                      background: courant ? C.accentSoft : C.surface,
                      color: courant ? C.accentDeep : C.ink,
                    }}
                  >
                    {t.voir}
                  </button>
                </div>
              );
            })}
      </div>

      {message && (
        <div style={{ fontSize: 12, color: C.inkSecondary, lineHeight: 1.45, padding: '0 2px', fontFamily: F.mono, wordBreak: 'break-all' }}>{message}</div>
      )}

      {admin && listes && (
        <Assistant
          comptes={listes.comptes}
          athletes={listes.athletes}
          lang={app.lang}
          app={app}
          onSection={onAthlete}
          onCree={() => { relire(); void app.chargerApercu(); }}
        />
      )}
      {!admin && (
        <div style={{ fontSize: 11.5, color: C.inkQuiet, lineHeight: 1.45 }}>{t.reserve}</div>
      )}
    </div>
  );
}
