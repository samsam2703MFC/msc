/* Créer — the athlete, their objectives, their constraints, and the plan the
   generator builds from them.

   The plan is generated locally and immediately: periodisation, volumes and
   placement need nothing but the form. Asking Claude for the methodology is a
   second, optional step that fills in what each session actually is. */

import { useEffect, useMemo, useRef, useState } from 'react';
import * as db from '../data/db';
import { genererPlan } from '../data/generateur';
import type { Contraintes, Objectif, PlanGenere, ProfilAthlete } from '../data/generateur';
import { appliquerMethode, demanderMethode, MethodeError } from '../data/methode';
import type { Methode } from '../data/methode';
import { C, F, R } from '../design/theme';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { AccentButton, Card, Colonnes, Grid, Mono, SectionLabel } from '../components/primitives';
import { DEFICITS_DEFAUT, DISCIPLINES, estMulti, referenceAPied, typeCourse, typesGroupes } from '../data/courses';
import type { Deficits, TypeCourse } from '../data/courses';
import type { Lang } from '../data/types';
import type { App } from '../state/useApp';
import { BackOffice } from './BackOffice';
import { AthletesHub, SuiviAthlete } from './AthletesScreen';
import { Dupki } from './DupkiScreen';
import { ProfilScreen } from './ProfilScreen';
import { CalendrierScreen } from './CalendrierScreen';
import { ParamScreen } from './ParamScreen';
import { ComptesScreen } from './ComptesScreen';
import { SystemeScreen } from './SystemeScreen';
import { StravaScreen } from './StravaScreen';
import { StructureScreen } from './StructureScreen';
import { Historique } from '../components/Historique';

/** « 3:20:00 », « 41:40 » ou « 2500 » → secondes. Un marathon se vise en
    heures, une référence 10 km en minutes : les deux passent par ici. */
function versSecondes(texte: string): number {
  const parts = texte.trim().split(':').map((x) => Number(x) || 0);
  if (parts.length >= 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] ?? 0;
}

function versTexte(secondes: number): string {
  const t = Math.round(secondes);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

const CHAMP: React.CSSProperties = {
  borderRadius: R.md,
  border: `1px solid ${C.border}`,
  background: C.surface,
  color: C.ink,
  padding: '9px 10px',
  fontFamily: F.body,
  fontSize: 13,
  width: '100%',
};

function Champ({
  label,
  value,
  onChange,
  type = 'text',
  mono = false,
  aide,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  mono?: boolean;
  aide?: string;
}) {
  const id = `msc-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <label htmlFor={id} style={{ fontSize: 11, color: C.inkSecondary }}>
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...CHAMP, fontFamily: mono ? F.mono : F.body }}
      />
      {aide && <div style={{ fontSize: 10, color: C.inkQuiet }}>{aide}</div>}
    </div>
  );
}

function Bascule({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      aria-pressed={on}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '9px 11px',
        borderRadius: R.md,
        border: `1px solid ${on ? C.accent : C.border}`,
        background: on ? C.accentSoft : C.surface,
        color: on ? C.accentDeep : C.inkSecondary,
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      <Icon name={on ? 'check' : 'circle'} size={14} />
      {label}
    </button>
  );
}

const OBJECTIF_VIDE: Objectif = {
  date: '',
  nom: '',
  type_course: 'cap_10',
  cible_s: 2400,
  distance_km: 10,
  principal: false,
};

/* Une liste déroulante de tous les types de course, groupés par discipline.
   Choisir un type pose la distance officielle et, si le nom n'a pas été
   touché, le nom de la course. */
function ChoixType({
  valeur, lang, onChange,
}: {
  valeur: string | undefined; lang: Lang; onChange: (t: TypeCourse) => void;
}) {
  const groupes = typesGroupes(lang);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 11, color: C.inkSecondary }}>{lang === 'fr' ? 'Type de course' : 'Typ zawodów'}</span>
        <select
          value={valeur ?? ''}
          onChange={(e) => {
            const t = typeCourse(e.target.value);
            if (t) onChange(t);
          }}
          style={CHAMP}
        >
          <option value="">{lang === 'fr' ? '— choisir —' : '— wybierz —'}</option>
          {groupes.map((g) => (
            <optgroup key={g.discipline} label={g.discipline}>
              {g.types.map((t) => <option key={t.code} value={t.code}>{t.nom}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
    </div>
  );
}

/* ------------------------------------------------- le plan du back office

   Deux niveaux, et pas trois. Le premier tient en six destinations, rangées
   en deux familles dont les noms disent ce qu'on y fait :

     ENTRAÎNEMENT   Athlètes · Calendrier · Classement
     APPLICATION    Paramètres · Comptes · Système

   Le second niveau est la fiche d'un athlète, ouverte en le touchant dans la
   liste : tout ce qui lui appartient y est réuni sous son nom — son suivi,
   son plan, ses starts, son profil, son Strava — au lieu d'être éparpillé
   dans le menu avec un sélecteur « athlète affiché » qu'il fallait deviner.

   La règle qui tient le tout : une entrée de menu ne dépend jamais d'un choix
   fait ailleurs. Le menu porte ce qui vaut pour le club et pour l'application ;
   la fiche porte ce qui vaut pour une personne, et elle dit laquelle. */

export const SECTIONS = {
  fr: { athletes: 'Athlètes', calendrier: 'Calendrier', classement: 'Classement', param: 'Paramètres', comptes: 'Comptes', systeme: 'Système' },
  pl: { athletes: 'Zawodnicy', calendrier: 'Kalendarz', classement: 'Ranking', param: 'Ustawienia', comptes: 'Konta', systeme: 'System' },
} as const;

export type Section = keyof typeof SECTIONS.fr;

/** Les onglets de la fiche d'un athlète — le second niveau, et le seul. */
export const ONGLETS = {
  fr: { suivi: 'Suivi', structure: 'Semaine type', plan: 'Plan', courses: 'Starts', profil: 'Profil', strava: 'Strava' },
  pl: { suivi: 'Podgląd', structure: 'Tydzień wzorcowy', plan: 'Plan', courses: 'Starty', profil: 'Profil', strava: 'Strava' },
} as const;

export type Onglet = keyof typeof ONGLETS.fr;

export const ONGLETS_ORDRE: Onglet[] = ['suivi', 'structure', 'plan', 'courses', 'profil', 'strava'];

/* Ce que chaque onglet répond, en une ligne : la fiche le dit sous le nom de
   l'athlète, pour qu'on n'ait pas à ouvrir les cinq pour trouver le bon. */
const ONGLET_AIDE: Record<Onglet, Record<Lang, string>> = {
  suivi: { fr: 'Ce qui a été fait : forme, charge, poids, séances de la semaine.', pl: 'Co zostało zrobione: forma, obciążenie, waga, treningi tygodnia.' },
  structure: { fr: 'La semaine type : sept jours, deux créneaux, un sport et un type par créneau. C’est elle que le coach suit chaque jour.', pl: 'Tydzień wzorcowy: siedem dni, dwa okna, sport i typ w każdym. To nią kieruje się trener każdego dnia.' },
  plan: { fr: 'Le plan : objectifs, contraintes, et le plan que le coach en tire.', pl: 'Plan: cele, ograniczenia i plan, który z nich wynika.' },
  courses: { fr: 'Les starts : les courses déjà faites, et celles qui viennent.', pl: 'Starty: biegi już zrobione i nadchodzące.' },
  profil: { fr: 'L’identité : nom, références 10 km, coach choisi, langue.', pl: 'Dane: nazwisko, odniesienia 10 km, wybrany trener, język.' },
  strava: { fr: 'La liaison Strava : relier, importer l’historique, l’application.', pl: 'Połączenie Strava: łączenie, import historii, aplikacja.' },
};

export const ICONES_SECTION: Record<Section, string> = {
  athletes: 'footprints', calendrier: 'calendar-days', classement: 'zap',
  param: 'settings', comptes: 'user', systeme: 'database',
};

export const ICONES_ONGLET: Record<Onglet, string> = {
  suivi: 'heart-pulse', structure: 'calendar-days', plan: 'wand-sparkles',
  courses: 'flag', profil: 'pencil', strava: 'link',
};

/* Deux familles, dans cet ordre : ce que le club fait, puis ce que
   l'application est. Le menu du bureau les affiche ainsi, la barre du
   téléphone à la suite. */
export const GROUPES: Array<{ code: 'entrainement' | 'application'; titre: Record<Lang, string>; sections: Section[] }> = [
  { code: 'entrainement', titre: { fr: 'Entraînement', pl: 'Trening' }, sections: ['athletes', 'calendrier', 'classement'] },
  { code: 'application', titre: { fr: 'Application', pl: 'Aplikacja' }, sections: ['param', 'comptes', 'systeme'] },
];

/** Les sections d'un compte. Le back office est au coach et à l'admin : un
    athlète n'en a pas du tout — son application, c'est ses cinq onglets, et
    « Moi » y tient tout ce qui lui appartient. */
export function sectionsDe(role: 'athlete' | 'coach' | 'admin' | undefined): Section[] {
  if (role !== 'coach' && role !== 'admin') return [];
  return [
    'athletes', 'calendrier', 'classement', 'param',
    ...(role === 'admin' ? (['comptes', 'systeme'] as Section[]) : []),
  ];
}

/** Le titre d'une section du back office. */
export function titreSection(section: Section, lang: Lang): string {
  return SECTIONS[lang][section];
}

/** Où l'on est dans le back office : une section, et pour la fiche d'un
    athlète, l'onglet ouvert. `onglet` absent sur « athletes » = la liste. */
export interface Vue {
  section: Section;
  onglet?: Onglet;
}

/** `large` : le bureau, qui a de la largeur — les sections s'y posent en
    colonnes ; le téléphone empile. */
export function SectionAdmin({
  app, vue, onVue, large = false,
}: {
  app: App; vue: Vue; onVue: (v: Vue) => void; large?: boolean;
}) {
  switch (vue.section) {
    case 'athletes': return <Athletes app={app} vue={vue} onVue={onVue} large={large} />;
    case 'calendrier': return <CalendrierScreen app={app} />;
    case 'classement': return <Dupki app={app} />;
    case 'param': return <ParamScreen app={app} large={large} />;
    /* « Relier Strava » / « Écrire son plan » à la fin de l'assistant : ce
       sont des onglets de la fiche du nouvel athlète, pas des sections. */
    case 'comptes': return <ComptesScreen app={app} onSection={(o: Onglet) => onVue({ section: 'athletes', onglet: o })} large={large} />;
    case 'systeme': return <SystemeScreen app={app} onSection={() => onVue({ section: 'param' })} large={large} />;
    default: return null;
  }
}

/* La section « Athlètes » a deux états : la liste, et la fiche de celui qu'on
   a touché. Un athlète qui ne voit que lui n'a pas de liste à traverser — on
   ouvre sa fiche directement. */
function Athletes({
  app, vue, onVue, large,
}: {
  app: App; vue: Vue; onVue: (v: Vue) => void; large: boolean;
}) {
  const onglet = vue.onglet;
  if (!onglet) {
    return (
      <AthletesHub
        app={app}
        large={large}
        onAthlete={(o: Onglet) => onVue({ section: 'athletes', onglet: o })}
      />
    );
  }
  return (
    <FicheAthlete
      app={app}
      onglet={onglet}
      onOnglet={(o) => onVue({ section: 'athletes', onglet: o })}
      onListe={() => onVue({ section: 'athletes' })}
      large={large}
    />
  );
}

/** La fiche d'un athlète : son nom en tête, cinq onglets, et rien qui
    appartienne à quelqu'un d'autre. */
export function FicheAthlete({
  app, onglet, onOnglet, onListe, large = false,
}: {
  app: App; onglet: Onglet; onOnglet: (o: Onglet) => void; onListe?: () => void; large?: boolean;
}) {
  const lang = app.lang;
  const fr = lang === 'fr';
  const athletes = app.identite?.athletes ?? [];
  const nom = [db.athlete.prenom, db.athlete.nom].filter(Boolean).join(' ') || db.athlete.nom;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Card padding="12px 16px" gap={10}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {onListe && (
            <button
              type="button"
              className="msc-hover-surface"
              onClick={onListe}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 10px', borderRadius: R.md, border: `1px solid ${C.border}`, background: C.surface, color: C.inkMuted, fontSize: 12, fontWeight: 600 }}
            >
              <Icon name="chevron-right" size={13} style={{ transform: 'rotate(180deg)' }} />
              {fr ? 'Tous les athlètes' : 'Wszyscy zawodnicy'}
            </button>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <Avatar nom={nom} taille={34} palier={db.athlete.niveau ?? null} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: F.display, fontSize: 17, fontWeight: 600, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nom}</div>
              <div style={{ fontSize: 11, color: C.inkSecondary }}>{db.athlete.surnom ?? (fr ? 'athlète' : 'zawodnik')}</div>
            </div>
          </div>
          {/* Changer d'athlète sans repasser par la liste, quand le compte en
              voit plusieurs : la fiche reste sur le même onglet. */}
          {athletes.length > 1 && (
            <select
              aria-label={fr ? 'Athlète' : 'Zawodnik'}
              value={db.athleteId ?? ''}
              onChange={(e) => void app.basculerAthlete(Number(e.target.value))}
              style={{ marginLeft: 'auto', padding: '6px 8px', borderRadius: R.md, border: `1px solid ${C.border}`, background: C.surface, color: C.ink, fontSize: 12, fontFamily: F.body }}
            >
              {athletes.map((a) => <option key={a.id} value={a.id}>{a.nom}</option>)}
            </select>
          )}
        </div>

        <div role="tablist" style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {ONGLETS_ORDRE.map((o) => {
            const actif = o === onglet;
            return (
              <button
                key={o}
                type="button"
                role="tab"
                aria-selected={actif}
                onClick={() => onOnglet(o)}
                className={actif ? undefined : 'msc-hover-accent'}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: R.full,
                  border: `1px solid ${actif ? C.accent : C.border}`,
                  background: actif ? C.accentSoft : C.surface,
                  color: actif ? C.accentDeep : C.inkMuted, fontSize: 12, fontWeight: 600,
                }}
              >
                <Icon name={ICONES_ONGLET[o]} size={13} />
                {ONGLETS[lang][o]}
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: 11.5, color: C.inkSecondary, lineHeight: 1.45 }}>{ONGLET_AIDE[onglet][lang]}</div>
      </Card>

      {onglet === 'suivi' && <SuiviAthlete app={app} large={large} />}
      {onglet === 'structure' && <StructureScreen app={app} large={large} />}
      {onglet === 'plan' && <Generateur app={app} large={large} />}
      {onglet === 'courses' && <BackOffice app={app} />}
      {onglet === 'profil' && (
        <ProfilScreen
          app={app}
          onSection={() => onOnglet('strava')}
          /* Supprimer un athlète est un geste de back office, et d'admin
             seul : dans SA fiche, sous son profil, et nulle part ailleurs.
             Une fois fait, il n'y a plus de fiche — on revient à la liste. */
          onSupprime={app.identite?.compte.role === 'admin'
            ? () => { void app.recharger(); onListe?.(); }
            : undefined}
          large={large}
        />
      )}
      {onglet === 'strava' && <StravaScreen app={app} />}
    </div>
  );
}

/* ------------------------------------------------------------------ moi

   Le cinquième onglet de l'application : ce qui est à moi et que les quatre
   autres ne portent pas — mon plan, mes starts, mon profil, ma liaison
   Strava — plus les deux écrans du club, qui regardent tout le monde.

   Ce n'est pas un back office : on n'y gère personne d'autre, il n'y a pas
   de liste, pas de comptes, pas de réglages de serveur. Le back office est
   ailleurs, derrière un bouton, et seulement pour qui en a un. */

/* Le classement n'est plus ici : c'est « Dupki », un onglet de la barre du
   bas. Deux chemins vers le même écran, c'était un de trop. */
const MOI_ORDRE = ['plan', 'courses', 'profil', 'strava', 'calendrier'] as const;
type OngletMoi = (typeof MOI_ORDRE)[number];

const MOI_LIBELLE: Record<OngletMoi, Record<Lang, string>> = {
  plan: { fr: 'Mon plan', pl: 'Mój plan' },
  courses: { fr: 'Mes starts', pl: 'Moje starty' },
  profil: { fr: 'Mon profil', pl: 'Mój profil' },
  strava: { fr: 'Strava', pl: 'Strava' },
  calendrier: { fr: 'Calendrier', pl: 'Kalendarz' },
};

const MOI_ICONE: Record<OngletMoi, string> = {
  plan: 'wand-sparkles', courses: 'flag', profil: 'pencil', strava: 'link',
  calendrier: 'calendar-days',
};

const MOI_AIDE: Record<OngletMoi, Record<Lang, string>> = {
  plan: { fr: 'Mes objectifs, mes contraintes, et le plan que le coach en tire.', pl: 'Moje cele, ograniczenia i plan, który z nich wynika.' },
  courses: { fr: 'Les courses que j’ai faites, et celles qui viennent.', pl: 'Biegi, które zrobiłem, i te, które nadchodzą.' },
  profil: { fr: 'Mon nom, mes références 10 km, mon coach, ma langue.', pl: 'Moje nazwisko, odniesienia 10 km, trener, język.' },
  strava: { fr: 'Ma liaison Strava : relier, importer mon historique.', pl: 'Moje połączenie ze Stravą: łączenie, import historii.' },
  calendrier: { fr: 'Les compétitions du club : qui court quoi, et quand.', pl: 'Zawody klubu: kto biegnie co i kiedy.' },
};

export function MoiScreen({ app, large = false }: { app: App; large?: boolean }) {
  const lang = app.lang;
  const fr = lang === 'fr';
  const [onglet, setOnglet] = useState<OngletMoi>('plan');
  const club = onglet === 'calendrier';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Card padding="12px 16px" gap={10}>
        <div role="tablist" style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {MOI_ORDRE.map((o) => {
            const actif = o === onglet;
            return (
              <button
                key={o}
                type="button"
                role="tab"
                aria-selected={actif}
                onClick={() => setOnglet(o)}
                className={actif ? undefined : 'msc-hover-accent'}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: R.full,
                  border: `1px solid ${actif ? C.accent : C.border}`,
                  background: actif ? C.accentSoft : C.surface,
                  color: actif ? C.accentDeep : C.inkMuted, fontSize: 12, fontWeight: 600,
                }}
              >
                <Icon name={MOI_ICONE[o]} size={13} />
                {MOI_LIBELLE[o][lang]}
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: 11.5, color: C.inkSecondary, lineHeight: 1.45 }}>
          {MOI_AIDE[onglet][lang]}
          {club ? ` · ${fr ? 'le club, pas moi' : 'klub, nie ja'}` : ''}
        </div>
      </Card>

      {onglet === 'plan' && <Generateur app={app} large={large} />}
      {onglet === 'courses' && <BackOffice app={app} />}
      {onglet === 'profil' && <ProfilScreen app={app} onSection={() => setOnglet('strava')} large={large} />}
      {onglet === 'strava' && <StravaScreen app={app} />}
      {onglet === 'calendrier' && <CalendrierScreen app={app} />}
    </div>
  );
}

function Generateur({ app, large = false }: { app: App; large?: boolean }) {
  const fr = app.lang === 'fr';
  const seed = db.athlete;

  /* Le nom vient du profil de l'athlète affiché ; le générateur ne fait que
     le lire, pour nommer le plan. */
  const nom = seed.nom;
  const [actuelle, setActuelle] = useState(versTexte(seed.ref_actuelle_s * 10));
  const [cible, setCible] = useState(versTexte(seed.ref_cible_s * 10));
  const [debut, setDebut] = useState(seed.debut);

  const [objectifs, setObjectifs] = useState<Objectif[]>(
    db.select('msc_objectif').map((o) => ({
      date: o.date,
      nom: o.nom.fr,
      cible_s: o.cible_s,
      cible_haute_s: o.cible_haute_s,
      distance_km: o.distance_km,
      principal: o.principal,
    })),
  );

  const [contraintes, setContraintes] = useState<Contraintes>({
    plancher_heures: seed.plancher_heures,
    plancher_km_sortie: seed.plancher_km_sortie,
    reamorcage_semaines: 6,
    natation: true,
    velo: true,
    salle: true,
    montagne_toutes_les: 3,
  });

  const [methode, setMethode] = useState<Methode | null>(null);
  const [statut, setStatut] = useState<'idle' | 'running' | 'error'>('idle');
  const [erreur, setErreur] = useState('');

  const athlete: ProfilAthlete = {
    nom,
    ref_actuelle_s: versSecondes(actuelle) / 10,
    ref_cible_s: versSecondes(cible) / 10,
    debut,
  };

  /* La semaine type de l'athlète commande le squelette : le plan tombe sur
     ses jours, ses sports, ses types. Sans elle, le squelette par défaut. */
  const structure = db.select('msc_structure');

  const plan: PlanGenere | null = useMemo(() => {
    if (!objectifs.some((o) => o.date && o.principal)) return null;
    try {
      return genererPlan(athlete, objectifs.filter((o) => o.date), contraintes, structure);
    } catch {
      return null;
    }
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [nom, actuelle, cible, debut, objectifs, contraintes, app.version]);

  const sessions = useMemo(
    () => (plan && methode ? appliquerMethode(plan.sessions, methode) : (plan?.sessions ?? [])),
    [plan, methode],
  );

  async function chercherMethode() {
    if (!plan) return;
    setStatut('running');
    setErreur('');
    try {
      const m = await demanderMethode({
        athlete,
        objectifs: objectifs.filter((o) => o.date),
        contraintes,
        blocs: plan.blocs,
      });
      setMethode(m);
      setStatut('idle');
    } catch (e) {
      setErreur(e instanceof MethodeError ? e.message : String(e));
      setStatut('error');
    }
  }

  const majObjectif = (i: number, patch: Partial<Objectif>) =>
    setObjectifs((prev) => prev.map((o, j) => (j === i ? { ...o, ...patch } : o)));

  return (
    <Colonnes large={large} ratio="minmax(0, 5fr) minmax(0, 6fr)" gauche={<>
      {/* d'où l'on part : ce que Strava sait de l'athlète */}
      <Historique
        activites={db.select('msc_activity')}
        lang={app.lang}
        onUtiliserAllure={(dixKm) => setActuelle(versTexte(dixKm))}
      />

      {/* l'athlète */}
      <Card padding="16px 18px" gap={10}>
        <SectionLabel icon="target">{fr ? 'Athlète' : 'Zawodnik'}</SectionLabel>
        {/* Le nom appartient au profil, pas au générateur : l'écrire ici ne
            renommait personne. Il s'affiche, et Profil le change. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 11, color: C.inkSecondary }}>{fr ? 'Nom' : 'Imię'}</span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: C.ink }}>{nom}</span>
            <span style={{ fontSize: 10.5, color: C.inkQuiet }}>
              {fr ? '— se change dans Profil' : '— zmienia się w Profilu'}
            </span>
          </div>
        </div>
        <Grid cols={2} gap={10}>
          <Champ
            label={fr ? '10 km actuel' : 'Obecne 10 km'}
            value={actuelle}
            onChange={setActuelle}
            mono
            aide={`${versTexte(versSecondes(actuelle) / 10)}/km`}
          />
          <Champ
            label={fr ? '10 km cible' : 'Cel 10 km'}
            value={cible}
            onChange={setCible}
            mono
            aide={`${versTexte(versSecondes(cible) / 10)}/km`}
          />
        </Grid>
        <Champ label={fr ? 'Début du plan' : 'Start planu'} value={debut} onChange={setDebut} type="date" mono />
      </Card>

      {/* les objectifs */}
      <Card padding="16px 18px" gap={10}>
        <SectionLabel icon="calendar-days">{fr ? 'Objectifs' : 'Cele'}</SectionLabel>
        <div style={{ fontSize: 11.5, color: C.inkSecondary, lineHeight: 1.45 }}>
          {fr
            ? 'Un objectif, c’est un type de course, une date et un chrono visé. Son nom est celui du type ; le vrai nom d’une course — Rome, l’Alpsman — vit dans Starts, où elle se relie à cet objectif.'
            : 'Cel to typ zawodów, data i cel czasowy. Nazwę bierze z typu; prawdziwa nazwa zawodów żyje w Startach, gdzie wiąże się z tym celem.'}
        </div>
        {objectifs.map((o, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              padding: 12,
              borderRadius: 12,
              border: `1px solid ${o.principal ? C.accent : C.border}`,
              background: o.principal ? C.accentSoft : 'transparent',
            }}
          >
            <ChoixType
              valeur={o.type_course}
              lang={app.lang}
              onChange={(t) => majObjectif(i, {
                type_course: t.code,
                distance_km: t.distance_km,
                discipline: t.discipline,
                /* Le nom, c'est le type : « Semi-marathon », « Triathlon M ».
                   Le vrai nom d'une course — Rome, Alpsman — vit dans Starts,
                   et s'y relie à cet objectif. */
                nom: t.nom[app.lang],
              })}
            />
            <Grid cols={3} gap={8}>
              <Champ label="Date" value={o.date} onChange={(v) => majObjectif(i, { date: v })} type="date" mono />
              <Champ label="km" value={String(o.distance_km)} onChange={(v) => majObjectif(i, { distance_km: Number(v) || 10 })} mono />
              <Champ
                label={fr ? 'Temps visé' : 'Cel czasowy'}
                value={versTexte(o.cible_s)}
                onChange={(v) => majObjectif(i, { cible_s: versSecondes(v) })}
                mono
                aide={estMulti(o.type_course)
                  ? (fr ? 'total, transitions comprises' : 'łącznie ze strefami zmian')
                  : typeCourse(o.type_course)?.exemple}
              />
            </Grid>
            {/* Un enchaînement se vise partie par partie : le total est leur
                somme plus les transitions, et la partie course, corrigée du
                déficit, est ce qui règle l'allure des blocs. */}
            {estMulti(o.type_course) && (
              <PartiesObjectif
                objectif={o}
                lang={app.lang}
                onChange={(patch) => majObjectif(i, patch)}
              />
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <Bascule
                label={fr ? 'Objectif principal' : 'Cel główny'}
                on={o.principal}
                onChange={(v) =>
                  setObjectifs((prev) => prev.map((x, j) => ({ ...x, principal: j === i ? v : false })))
                }
              />
              <button
                type="button"
                onClick={() => setObjectifs((prev) => prev.filter((_, j) => j !== i))}
                style={{ fontSize: 12, color: C.inkQuiet, padding: '9px 11px' }}
              >
                {fr ? 'Retirer' : 'Usuń'}
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          className="msc-hover-accent"
          onClick={() => setObjectifs((prev) => [...prev, { ...OBJECTIF_VIDE }])}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            padding: 10,
            borderRadius: R.md,
            border: `1px dashed ${C.border}`,
            color: C.inkSecondary,
            fontSize: 12,
          }}
        >
          <Icon name="plus" size={14} />
          {fr ? 'Ajouter une course' : 'Dodaj zawody'}
        </button>
      </Card>

      {/* les contraintes */}
      <Card padding="16px 18px" gap={10}>
        <SectionLabel icon="scale">{fr ? 'Contraintes' : 'Ograniczenia'}</SectionLabel>
        <Grid cols={3} gap={8}>
          <Champ label={fr ? 'Plancher h/sem' : 'Min h/tydz'} value={String(contraintes.plancher_heures)}
            onChange={(v) => setContraintes({ ...contraintes, plancher_heures: Number(v) || 0 })} mono />
          <Champ label={fr ? 'Min km/sortie' : 'Min km/bieg'} value={String(contraintes.plancher_km_sortie)}
            onChange={(v) => setContraintes({ ...contraintes, plancher_km_sortie: Number(v) || 0 })} mono />
          <Champ label={fr ? 'Réamorçage' : 'Rozruch'} value={String(contraintes.reamorcage_semaines)}
            onChange={(v) => setContraintes({ ...contraintes, reamorcage_semaines: Number(v) || 0 })} mono />
        </Grid>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Bascule label={fr ? 'Natation' : 'Pływanie'} on={contraintes.natation}
            onChange={(v) => setContraintes({ ...contraintes, natation: v })} />
          <Bascule label={fr ? 'Vélo' : 'Rower'} on={contraintes.velo}
            onChange={(v) => setContraintes({ ...contraintes, velo: v })} />
          <Bascule label={fr ? 'Salle' : 'Siłownia'} on={contraintes.salle}
            onChange={(v) => setContraintes({ ...contraintes, salle: v })} />
        </div>
      </Card>

    </>} droite={<>
      {/* ce que ça donne */}
      {plan ? (
        <>
          <Card featured padding="16px 18px" gap={10}>
            <SectionLabel icon="circle-check" iconColor={C.accentDeep}>
              {fr ? 'Plan généré' : 'Wygenerowany plan'}
            </SectionLabel>
            <div style={{ display: 'flex', gap: 16 }}>
              <Stat valeur={String(plan.semaines.length)} label={fr ? 'semaines' : 'tygodni'} />
              <Stat valeur={String(sessions.length)} label={fr ? 'séances' : 'treningów'} />
              <Stat valeur={String(plan.blocs.length)} label={fr ? 'blocs' : 'bloków'} />
            </div>
            {plan.blocs.map((b) => (
              <div key={b.code} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Mono size={11} color={C.accentDeep} style={{ minWidth: 62 }}>
                  {`${b.code} S${b.de}–S${b.a}`}
                </Mono>
                <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: C.inkBody }}>
                  {b.nom.fr}
                </div>
                <Mono size={12} color={C.ink}>
                  {db.format10k(
                    athlete.ref_actuelle_s - (athlete.ref_actuelle_s - athlete.ref_cible_s) * b.part,
                  )}
                </Mono>
              </div>
            ))}
          </Card>

          {plan.avertissements.length > 0 && (
            <div
              style={{
                borderRadius: R.card,
                background: C.warningBg,
                border: `1px solid ${C.warning}`,
                padding: 16,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <SectionLabel icon="triangle-alert" color={C.warning}>
                {fr ? 'Ce que le générateur a dû plier' : 'Co generator musiał nagiąć'}
              </SectionLabel>
              {plan.avertissements.map((a) => (
                <div key={a} style={{ fontSize: 12, lineHeight: 1.45, color: C.inkBody }}>
                  {a}
                </div>
              ))}
            </div>
          )}

          {/* la méthodologie, via l'API */}
          <Card padding="16px 18px" gap={10}>
            <SectionLabel icon="sparkles" color={C.teal}>
              {fr ? 'Méthodologie · Claude' : 'Metodologia · Claude'}
            </SectionLabel>
            <div style={{ fontSize: 12, lineHeight: 1.45, color: C.inkQuiet }}>
              {fr
                ? "Le squelette ci-dessus est calculé ici, sans réseau. Claude va chercher la méthodologie d'entraînement et écrit le contenu de chaque séance — il ne touche ni aux allures, ni aux volumes, ni aux dates."
                : 'Szkielet powyżej liczony jest lokalnie. Claude dostarcza metodologię i treść treningów — nie dotyka temp, objętości ani dat.'}
            </div>
            <AccentButton
              label={
                statut === 'running'
                  ? fr ? 'Claude cherche…' : 'Claude szuka…'
                  : methode
                    ? fr ? 'Relancer' : 'Ponów'
                    : fr ? 'Chercher la méthodologie' : 'Szukaj metodologii'
              }
              icon={statut === 'running' ? 'loader' : methode ? 'rotate-ccw' : 'sparkles'}
              active={statut === 'running' || !!methode}
              onClick={chercherMethode}
            />
            {statut === 'error' && (
              <div style={{ fontSize: 12, lineHeight: 1.45, color: C.negative }}>{erreur}</div>
            )}
            {methode && <Resultat methode={methode} />}
          </Card>

          {/* Enregistrer. C'est le geste qui fait exister le plan ailleurs que
              dans cet onglet — et il remplace celui qui servait jusque-là, donc
              il le dit avant, pas après. */}
          <Card padding="16px 18px" gap={10}>
            <SectionLabel icon="database" color={C.accentDeep}>
              {fr ? 'Enregistrer ce plan' : 'Zapisz ten plan'}
            </SectionLabel>
            <div style={{ fontSize: 12, lineHeight: 1.45, color: C.inkQuiet }}>
              {fr
                ? `Le plan actif devient celui-ci : ${sessions.length} séances du ${plan.sessions[0]?.date} au ${plan.sessions[plan.sessions.length - 1]?.date}. Les deux références 10 km deviennent celles de l'athlète. L'ancien plan n'est pas supprimé — ses séances restent, et le journal comme les activités qui les visent avec.`
                : `Ten plan staje się aktywny: ${sessions.length} treningów od ${plan.sessions[0]?.date} do ${plan.sessions[plan.sessions.length - 1]?.date}. Poprzedni nie znika — jego treningi zostają, a z nimi dziennik i aktywności.`}
            </div>
            <AccentButton
              label={
                app.planJob === 'envoi'
                  ? fr ? 'Enregistrement…' : 'Zapisywanie…'
                  : app.planJob === 'fait'
                    ? fr ? 'Plan actif' : 'Plan aktywny'
                    : fr ? 'Enregistrer et activer' : 'Zapisz i aktywuj'
              }
              icon={app.planJob === 'envoi' ? 'loader' : app.planJob === 'fait' ? 'check' : 'database'}
              active={app.planJob !== 'idle'}
              onClick={() => {
                if (app.planJob === 'envoi') return;
                void app.enregistrerPlan({
                  nom: `${objectifs.find((o) => o.principal)?.nom ?? 'Plan'} — ${nom}`,
                  /* Le plan est bâti sur ces deux allures : elles deviennent
                     celles de l'athlète, sinon les séances afficheraient des
                     allures que le plan n'a pas utilisées. */
                  athlete: {
                    ref_actuelle_s: athlete.ref_actuelle_s,
                    ref_cible_s: athlete.ref_cible_s,
                    debut,
                  },
                  methode: methode ?? undefined,
                  blocs: plan.blocs,
                  semaines: plan.semaines,
                  sessions,
                  objectifs: objectifs.filter((o) => o.date),
                });
              }}
            />
            {app.planErreur && (
              <div style={{ fontSize: 12, lineHeight: 1.45, color: C.negative }}>
                {app.planErreur}
              </div>
            )}
          </Card>

          <Card padding={0} gap={0} style={{ overflow: 'hidden' }}>
            {sessions.slice(0, 14).map((s) => {
              const t = db.type(s.type);
              return (
                <div
                  key={s.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 14px',
                    borderTop: `1px solid ${C.borderSoft}`,
                  }}
                >
                  <Mono size={10} color={C.inkQuiet} style={{ width: 34 }}>
                    {s.jour[app.lang]}
                  </Mono>
                  <Icon name={t.icon} size={15} color={t.color} />
                  <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: C.ink }}>
                    {s.titre_court[app.lang]}
                  </div>
                  <Mono size={10} color={C.inkQuiet}>
                    {s.meta[app.lang]}
                  </Mono>
                </div>
              );
            })}
            <div style={{ padding: '10px 14px', fontSize: 11, color: C.inkQuiet }}>
              {fr
                ? `… et ${Math.max(sessions.length - 14, 0)} autres séances.`
                : `… i ${Math.max(sessions.length - 14, 0)} innych treningów.`}
            </div>
          </Card>
        </>
      ) : (
        <Card padding="16px 18px">
          <div style={{ fontSize: 13, color: C.inkSecondary, lineHeight: 1.5 }}>
            {fr
              ? 'Renseigne au moins un objectif avec une date, et marque-le comme objectif principal : le plan se construit à rebours depuis cette date.'
              : 'Podaj przynajmniej jeden cel z datą i oznacz go jako główny: plan liczony jest wstecz od tej daty.'}
          </div>
        </Card>
      )}
    </>} />
  );
}

/* Les parties d'un enchaînement : un chrono par discipline, le total qui en
   découle, et ce que la partie course vaudrait « à sec ». Les pour cent de
   déficit se règlent dans Paramètres · Enchaînements. */
function PartiesObjectif({
  objectif, lang, onChange,
}: {
  objectif: Objectif; lang: Lang; onChange: (patch: Partial<Objectif>) => void;
}) {
  const fr = lang === 'fr';
  const t = typeCourse(objectif.type_course);
  const parties = t?.parties ?? [];
  const transitions = db.param('multi.transitions_min', 5) * 60;
  const deficits: Deficits = {
    natation: db.param('multi.deficit_natation_pct', DEFICITS_DEFAUT.natation ?? 5),
    velo: db.param('multi.deficit_velo_pct', DEFICITS_DEFAUT.velo ?? 6),
    cap: db.param('multi.deficit_cap_pct', DEFICITS_DEFAUT.cap ?? 8),
  };
  const visees = parties.map((p, i) => objectif.parties?.[i]?.cible_s ?? versSecondes(p.exemple));

  /* Un objectif relu d'un plan d'avant les parties : on pose celles du
     catalogue une fois, pour que le générateur voie ce que l'écran montre. */
  const pose = useRef(false);
  useEffect(() => {
    if (pose.current || parties.length === 0 || (objectif.parties?.length ?? 0) > 0) return;
    pose.current = true;
    onChange({
      parties: parties.map((p, i) => ({ discipline: p.discipline, cible_s: visees[i] })),
      cible_s: visees.reduce((somme, x) => somme + x, 0) + transitions,
    });
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [objectif.type_course]);

  const poser = (index: number, secondes: number) => {
    const suite = parties.map((p, i) => ({
      discipline: p.discipline,
      cible_s: i === index ? secondes : visees[i],
    }));
    const total = suite.reduce((somme, x) => somme + x.cible_s, 0) + transitions;
    onChange({ parties: suite, cible_s: total });
  };

  const total = visees.reduce((somme, x) => somme + x, 0) + transitions;
  const aSec = referenceAPied({ ...objectif, parties: parties.map((p, i) => ({ discipline: p.discipline, cible_s: visees[i] })) }, objectif.cible_s, deficits);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 10, borderRadius: 10, background: C.page }}>
      <div style={{ fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: C.inkSecondary, fontWeight: 600 }}>
        {fr ? 'Par discipline' : 'Według dyscypliny'}
      </div>
      <Grid cols={parties.length > 2 ? 3 : 2} gap={8}>
        {parties.map((p, i) => {
          const d = DISCIPLINES.find((x) => x.code === p.discipline);
          return (
            <Champ
              key={`${p.discipline}-${i}`}
              label={`${d ? d.nom[lang] : p.discipline} · ${p.distance_km} km`}
              value={versTexte(visees[i])}
              onChange={(v) => poser(i, versSecondes(v))}
              mono
              aide={p.exemple}
            />
          );
        })}
      </Grid>
      <div style={{ fontSize: 11, color: C.inkSecondary, lineHeight: 1.45 }}>
        {fr
          ? `Total ${versTexte(total)}, transitions comprises (${Math.round(transitions / 60)} min).`
          : `Łącznie ${versTexte(total)}, ze strefami zmian (${Math.round(transitions / 60)} min).`}
        {aSec && (
          fr
            ? ` La partie course vaut ${versTexte(Math.round(aSec.temps_s))} à sec sur ${aSec.distance_km} km — c’est elle qui règle les allures du plan.`
            : ` Część biegowa to ${versTexte(Math.round(aSec.temps_s))} na świeżo na ${aSec.distance_km} km — to ona ustawia tempa planu.`
        )}
      </div>
      <div style={{ fontSize: 10.5, color: C.inkQuiet, lineHeight: 1.4 }}>
        {fr
          ? `Déficits appliqués : natation ${deficits.natation} %, vélo ${deficits.velo} %, course ${deficits.cap} % — Paramètres · Enchaînements.`
          : `Zastosowane straty: pływanie ${deficits.natation} %, rower ${deficits.velo} %, bieg ${deficits.cap} % — Ustawienia · Wieloboje.`}
      </div>
    </div>
  );
}

function Stat({ valeur, label }: { valeur: string; label: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Mono size={19} color={C.ink}>
        {valeur}
      </Mono>
      <div style={{ fontSize: 10, color: C.inkSecondary }}>{label}</div>
    </div>
  );
}

function Resultat({ methode }: { methode: Methode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {methode.principes.map((p) => (
        <div key={p} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <Icon name="dot" size={16} color={C.accentDeep} style={{ marginTop: 1 }} />
          <div style={{ fontSize: 12, lineHeight: 1.45, color: C.inkBody }}>{p}</div>
        </div>
      ))}

      {methode.reserves.length > 0 && (
        <div
          style={{
            borderRadius: 10,
            background: C.warningBg,
            border: `1px solid ${C.warning}`,
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          {methode.reserves.map((r) => (
            <div key={r} style={{ fontSize: 12, lineHeight: 1.45, color: C.inkBody }}>
              {r}
            </div>
          ))}
        </div>
      )}

      {methode.sources.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {methode.sources.map((s) => (
            <a
              key={s.url}
              href={s.url}
              target="_blank"
              rel="noreferrer noopener"
              style={{
                fontSize: 10,
                padding: '4px 8px',
                borderRadius: R.sm,
                border: `1px solid ${C.border}`,
                color: C.inkMuted,
              }}
            >
              {s.titre}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
