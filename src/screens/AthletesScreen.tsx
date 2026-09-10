/* Le back office des athlètes : chacun en un coup d'œil, et un toucher pour
   passer sur lui. La phase et sa couleur, la semaine, les allures, ce qui est
   fait cette semaine, la forme. Tout vient de /api/apercu — rien n'est calculé
   deux fois. */

import { useCallback, useEffect, useState } from 'react';
import * as api from '../data/api';
import type { AthleteAdmin, CompteAdmin } from '../data/api';
import { Assistant } from './ComptesScreen';
import type { Suite } from './AdminScreen';
import * as db from '../data/db';
import type { ApercuAthlete, Axe, Classement as ClassementDonnees, Conversation as ConversationType, Lang } from '../data/types';
import { C, F, R } from '../design/theme';
import { coachDe } from '../data/coachs';
import { Avatar } from '../components/Avatar';
import { AvatarNiveau } from '../components/AvatarNiveau';
import { CoachAvatar } from '../components/CoachAvatar';
import { FormeJauge } from '../components/FormeJauge';
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
        aucun: 'Aucun athlète visible pour ce compte.', courant: 'en cours' },
  pl: { semaine: 'Tydzień', sansPlan: 'Brak aktywnego planu', seances: 'treningi', faites: 'zrobione',
        volume: 'Objętość', rpe: 'Ostatnie RPE', voir: 'Otwórz', chargement: 'Wczytywanie zawodników…',
        titre: 'Zawodnicy', reserve: 'Tworzenie zawodników i kont jest zastrzeżone dla admina.',
        aucun: 'Brak widocznych zawodników.', courant: 'bieżący' },
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

/* ------------------------------------------------------- le classement */

const AXES: Array<{ code: Axe | 'total'; icon: string; nom: Record<Lang, string> }> = [
  { code: 'total', icon: 'zap', nom: { fr: 'Niveau', pl: 'Poziom' } },
  { code: 'endurance', icon: 'clock', nom: { fr: 'Endurance', pl: 'Wytrzymałość' } },
  { code: 'vitesse', icon: 'gauge', nom: { fr: 'Vitesse', pl: 'Szybkość' } },
  { code: 'velo', icon: 'bike', nom: { fr: 'Vélo', pl: 'Rower' } },
  { code: 'cap', icon: 'footprints', nom: { fr: 'CAP', pl: 'Bieg' } },
  { code: 'natation', icon: 'waves', nom: { fr: 'Natation', pl: 'Pływanie' } },
];

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/* D'où vient le score de l'axe choisi — le chiffre brut, pour que le
   classement ne soit pas une note tombée du ciel. */
function brutDe(l: ClassementDonnees['athletes'][number], axe: Axe | 'total', lang: Lang): string {
  const fr = lang === 'fr';
  switch (axe) {
    case 'endurance': return `${l.brut.heures_semaine} h/${fr ? 'sem' : 'tydz'}`;
    case 'velo': return `${l.brut.velo_h_semaine} h/${fr ? 'sem' : 'tydz'}`;
    case 'natation': return `${l.brut.nage_km_semaine} km/${fr ? 'sem' : 'tydz'}`;
    case 'cap': return `${mmss(l.brut.ref_10k_s)}/km`;
    case 'vitesse': return `${mmss(l.brut.vitesse_s)}/km${l.brut.vitesse_mesuree ? '' : fr ? ' (zone)' : ' (strefa)'}`;
    default: return `${fr ? 'moyenne' : 'średnia'} ${l.total}/100`;
  }
}

export function Classement({ app }: { app: App }) {
  const lang = app.lang;
  const fr = lang === 'fr';
  const [donnees, setDonnees] = useState<ClassementDonnees | null>(null);
  const [axe, setAxe] = useState<Axe | 'total'>('total');

  useEffect(() => {
    let vivant = true;
    api.classement().then((c) => { if (vivant) setDonnees(c); }).catch(() => { if (vivant) setDonnees({ athletes: [], paliers: [] }); });
    return () => { vivant = false; };
  }, [app.version]);

  if (!donnees) return null;
  const score = (l: ClassementDonnees['athletes'][number]) => (axe === 'total' ? l.total : l.scores[axe]);
  const lignes = [...donnees.athletes].sort((a, b) => score(b) - score(a) || a.nom.localeCompare(b.nom));

  return (
    <div style={{ borderRadius: R.card, background: C.surface, border: `1px solid ${C.border}`, boxShadow: C.shadowCard, padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name="zap" size={16} color={C.teal} />
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.teal }}>
          {fr ? 'Niveaux de combat' : 'Poziomy mocy'}
        </div>
      </div>

      {/* l'axe : total ou une discipline */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {AXES.map((a) => {
          const on = axe === a.code;
          return (
            <button
              key={a.code}
              type="button"
              className="msc-hover-accent"
              aria-pressed={on}
              onClick={() => setAxe(a.code)}
              style={{
                display: 'flex', alignItems: 'center', gap: 5, padding: '5px 9px', borderRadius: R.full,
                border: `1px solid ${on ? C.accent : C.border}`, background: on ? C.accentSoft : C.surface,
                color: on ? C.accentDeep : C.inkMuted, fontSize: 11, fontWeight: 600,
              }}
            >
              <Icon name={a.icon} size={12} />
              {a.nom[lang]}
            </button>
          );
        })}
      </div>

      {lignes.map((l, i) => {
        const moi = l.id === db.athleteId;
        const nomComplet = [l.prenom, l.nom].filter(Boolean).join(' ') || l.nom;
        const v = score(l);
        return (
          <div
            key={l.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: R.md,
              border: `1px solid ${moi ? C.accent : C.border}`, background: moi ? C.accentSoft : C.page,
            }}
          >
            <div style={{ width: 18, fontFamily: F.mono, fontSize: 13, color: C.inkQuiet, textAlign: 'right' }}>{i + 1}</div>
            <AvatarNiveau nom={nomComplet} palier={l.palier.n} taille={44} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {l.surnom || l.prenom || l.nom}
                </div>
                <div style={{ fontSize: 11, color: C.inkQuiet, whiteSpace: 'nowrap' }}>{l.palier.nom[lang]}</div>
              </div>
              {/* la barre : remplissage et piste de la même teinte ; le chiffre à côté */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5 }}>
                <div style={{ flex: 1, height: 6, borderRadius: R.full, background: C.accentSoft, overflow: 'hidden' }}>
                  <div style={{ width: `${v}%`, height: '100%', background: C.accentBar, borderRadius: R.full }} />
                </div>
                <div style={{ fontFamily: F.mono, fontSize: 11, color: C.inkSecondary, whiteSpace: 'nowrap' }}>{brutDe(l, axe, lang)}</div>
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontFamily: F.mono, fontSize: 18, color: C.ink, lineHeight: 1 }}>
                {axe === 'total' ? l.puissance.toLocaleString(fr ? 'fr-FR' : 'pl-PL') : v}
              </div>
              <div style={{ fontSize: 9, color: C.inkQuiet, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {axe === 'total' ? (fr ? 'puissance' : 'moc') : '/100'}
              </div>
            </div>
          </div>
        );
      })}
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
        {!courant && (
          <button
            type="button"
            className="msc-hover-accent"
            onClick={() => void app.basculerAthlete(a.id)}
            aria-label={`${t.voir} ${affiche}`}
            style={{ padding: '7px 11px', borderRadius: R.full, border: `1px solid ${C.border}`, fontSize: 12, fontWeight: 600, color: C.ink, background: C.surface }}
          >
            {t.voir}
          </button>
        )}
        {courant && <span style={{ fontSize: 11, color: C.accentDeep, fontWeight: 600 }}>{t.courant}</span>}
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
export function SuiviAthlete({ app }: { app: App }) {
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
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Carte a={a} app={app} />
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
    </div>
  );
}

/* Le hub des athlètes : la liste de ceux que le compte voit, en une ligne
   chacun — qui, où dans son plan, ses allures, sa semaine — et « Ouvrir »,
   qui en fait l'athlète affiché et ouvre son suivi. Dessous, pour l'admin,
   l'onboarding : l'assistant qui crée un athlète et son compte, une fois. Ce
   qui change tout le temps — son plan, ses starts — est dans ses sections. */
export function AthletesHub({ app, onSection }: { app: App; onSection?: (s: Suite) => void }) {
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

  const ouvrir = async (id: number) => {
    if (id !== db.athleteId) await app.basculerAthlete(id);
    onSection?.('suivi');
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
                  </div>
                  {courant
                    ? <span style={{ fontSize: 11, color: C.accentDeep, fontWeight: 600, whiteSpace: 'nowrap' }}>{t.courant}</span>
                    : (
                      <button
                        type="button"
                        className="msc-hover-accent"
                        onClick={() => void ouvrir(a.id)}
                        aria-label={`${t.voir} ${affiche}`}
                        style={{ padding: '6px 11px', borderRadius: R.full, border: `1px solid ${C.border}`, fontSize: 12, fontWeight: 600, color: C.ink, background: C.surface, whiteSpace: 'nowrap' }}
                      >
                        {t.voir}
                      </button>
                    )}
                </div>
              );
            })}
      </div>

      {admin && listes && (
        <Assistant
          comptes={listes.comptes}
          athletes={listes.athletes}
          lang={app.lang}
          app={app}
          onSection={onSection}
          onCree={() => { relire(); void app.chargerApercu(); }}
        />
      )}
      {!admin && (
        <div style={{ fontSize: 11.5, color: C.inkQuiet, lineHeight: 1.45 }}>{t.reserve}</div>
      )}
    </div>
  );
}
