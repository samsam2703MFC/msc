/* Créer — the athlete, their objectives, their constraints, and the plan the
   generator builds from them.

   The plan is generated locally and immediately: periodisation, volumes and
   placement need nothing but the form. Asking Claude for the methodology is a
   second, optional step that fills in what each session actually is. */

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import * as db from '../data/db';
import { depuis10k, equivalent10k, genererPlan } from '../data/generateur';
import type { Contraintes, Objectif, PlanGenere, ProfilAthlete } from '../data/generateur';
import { appliquerMethode, demanderMethode, MethodeError } from '../data/methode';
import type { Methode } from '../data/methode';
import { C, F, R } from '../design/theme';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { AccentButton, Card, Colonnes, Grid, Mono, SectionLabel } from '../components/primitives';
import { DEFICITS_DEFAUT, DISCIPLINES, estMulti, referenceAPied, typeCourse, typesGroupes } from '../data/courses';
import type { Deficits, TypeCourse } from '../data/courses';
import type { Lang, MscCompetition, MscPlanSession, NaturePeriode } from '../data/types';
import { motDuStatut, visuelDuStatut } from '../data/statut';
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
import { FormeCourbes } from '../components/FormeCourbes';

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
  onBlur,
  type = 'text',
  mono = false,
  aide,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  /* Quand le champ écrit en base, il le fait en sortant : une frappe par
     requête donnerait un aller-retour par lettre. */
  onBlur?: (v: string) => void;
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
        onBlur={(e) => onBlur?.(e.target.value)}
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
  fr: { suivi: 'Suivi', structure: 'Semaine type', plan: 'Plan', seances: 'Calendrier', courses: 'Starts', profil: 'Profil', strava: 'Strava' },
  pl: { suivi: 'Podgląd', structure: 'Tydzień wzorcowy', plan: 'Plan', seances: 'Kalendarz', courses: 'Starty', profil: 'Profil', strava: 'Strava' },
} as const;

export type Onglet = keyof typeof ONGLETS.fr;

export const ONGLETS_ORDRE: Onglet[] = ['suivi', 'structure', 'plan', 'seances', 'courses', 'profil', 'strava'];

/* Ce que chaque onglet répond, en une ligne : la fiche le dit sous le nom de
   l'athlète, pour qu'on n'ait pas à ouvrir les cinq pour trouver le bon. */
const ONGLET_AIDE: Record<Onglet, Record<Lang, string>> = {
  suivi: { fr: 'Ce qui a été fait : forme, charge, poids, séances de la semaine.', pl: 'Co zostało zrobione: forma, obciążenie, waga, treningi tygodnia.' },
  structure: { fr: 'La semaine type : sept jours, deux créneaux, un sport et un type par créneau. C’est elle que le coach suit chaque jour.', pl: 'Tydzień wzorcowy: siedem dni, dwa okna, sport i typ w każdym. To nią kieruje się trener każdego dnia.' },
  plan: { fr: 'Le plan : objectifs, contraintes, et le plan que le coach en tire.', pl: 'Plan: cele, ograniczenia i plan, który z nich wynika.' },
  seances: { fr: 'Le calendrier : chaque séance datée, avec son allure et son état. C’est la table que le coach adapte au fil des signaux du matin.', pl: 'Kalendarz: każda sesja z datą, tempem i stanem. To tabela, którą trener dostosowuje do porannych sygnałów.' },
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
  seances: 'list', courses: 'flag', profil: 'pencil', strava: 'link',
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
      {onglet === 'seances' && <CalendrierEntrainement app={app} large={large} />}
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
const MOI_ORDRE = ['plan', 'seances', 'courses', 'profil', 'strava', 'calendrier'] as const;
type OngletMoi = (typeof MOI_ORDRE)[number];

const MOI_LIBELLE: Record<OngletMoi, Record<Lang, string>> = {
  plan: { fr: 'Mon plan', pl: 'Mój plan' },
  seances: { fr: 'Mes séances', pl: 'Moje sesje' },
  courses: { fr: 'Mes starts', pl: 'Moje starty' },
  profil: { fr: 'Mon profil', pl: 'Mój profil' },
  strava: { fr: 'Strava', pl: 'Strava' },
  calendrier: { fr: 'Calendrier', pl: 'Kalendarz' },
};

const MOI_ICONE: Record<OngletMoi, string> = {
  plan: 'wand-sparkles', seances: 'list', courses: 'flag', profil: 'pencil', strava: 'link',
  calendrier: 'calendar-days',
};

const MOI_AIDE: Record<OngletMoi, Record<Lang, string>> = {
  plan: { fr: 'Mes objectifs, mes contraintes, et le plan que le coach en tire.', pl: 'Moje cele, ograniczenia i plan, który z nich wynika.' },
  seances: { fr: 'Mon calendrier : chaque séance datée, son allure, son état.', pl: 'Mój kalendarz: każda sesja z datą, tempem i stanem.' },
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
      {onglet === 'seances' && <CalendrierEntrainement app={app} large={large} />}
      {onglet === 'courses' && <BackOffice app={app} />}
      {onglet === 'profil' && <ProfilScreen app={app} onSection={() => setOnglet('strava')} large={large} />}
      {onglet === 'strava' && <StravaScreen app={app} />}
      {onglet === 'calendrier' && <CalendrierScreen app={app} />}
    </div>
  );
}

/* La périodisation du plan actif, en un tableau.

   Un plan n'est pas une suite de semaines : c'est quatre périodes qui ne
   demandent pas la même chose, et chacune a sa place sur le chemin de la
   référence d'aujourd'hui vers l'objectif. `part` dit exactement ça —
   A 0 %, B 28 %, C 65 %, D 100 % — et la référence du bloc s'en déduit,
   elle ne se stocke pas.

   Tout est calculé depuis le plan déjà chargé : les semaines du bloc, ce
   qu'elles pèsent, la rampe d'une semaine à l'autre, la part de qualité. Un
   tableau plutôt que six cartes — on compare des périodes, et comparer se
   fait en lignes. */
const DURS = new Set(['seuil', 'allure10', 'vma', 'longue', 'montagne', 'course', 'test']);

/* Les périodes du plan, et ce qui les façonne.

   Une ligne par période ; on la déroule pour voir ses semaines une à une, ce
   que chacune pèse et ce qui la distingue — un pas de plus, une décharge, une
   semaine de course. Les réglages qui donnent cette forme sont là aussi, à
   côté de ce qu'ils font : une rampe qu'on lit sans pouvoir la changer oblige
   à la deviner ailleurs.

   Le tableau montre le plan qu'on est en train de composer dès qu'il y en a
   un — c'est celui qu'on règle. Sans objectif, il montre le plan actif : où
   l'athlète en est aujourd'hui. */
function Periodisation({
  app, plan, contraintes, onReglage,
}: {
  app: App;
  plan?: PlanGenere | null;
  contraintes?: Contraintes;
  onReglage?: (patch: Partial<Contraintes>) => void;
}) {
  const lang = app.lang;
  const fr = lang === 'fr';
  const [ouverte, setOuverte] = useState<string | null>(null);

  /* Deux sources, une seule forme : le plan composé, ou celui de la base. */
  const source = plan
    ? {
      blocs: plan.blocs,
      heures: (n: number) => plan.semaines.find((w) => w.semaine === n)?.heures ?? 0,
      seances: (de: number, a: number) => plan.sessions
        .filter((x) => x.semaine >= de && x.semaine <= a && x.discipline !== 'Repos'),
      courses: new Set(plan.sessions.filter((x) => x.type === 'course').map((x) => x.semaine)),
    }
    : {
      blocs: db.select('msc_bloc'),
      heures: (n: number) => db.bilanSemaine(n).prevu.minutes / 60,
      seances: (de: number, a: number) => db.select('msc_session', (x) => x.semaine >= de
        && x.semaine <= a && x.discipline !== 'Repos'),
      courses: new Set(db.select('msc_session', (x) => x.type === 'course').map((x) => x.semaine)),
    };

  if (source.blocs.length === 0) return null;
  const courant = !plan && db.derniereSemaine > 0 && app.semaine > 0
    ? db.blocDeSemaine(app.semaine).code
    : null;

  const lignes = source.blocs.map((b) => {
    const semaines = [];
    for (let n = b.de; n <= b.a; n += 1) {
      semaines.push({ semaine: n, heures: source.heures(n), course: source.courses.has(n) });
    }
    const seances = source.seances(b.de, b.a);
    const durs = seances.filter((x) => DURS.has(x.type)).length;

    /* La rampe : de combien le volume monte d'une semaine à l'autre. On prend
       la médiane des rapports, les semaines de course retirées — première
       contre dernière donnait « −7 % » sur une construction à +6 %, parce que
       la dernière est souvent une semaine de course ou de décharge. */
    const utiles = semaines.filter((x) => !x.course).map((x) => x.heures);
    const rapports = utiles
      .slice(1)
      .map((h, i) => (utiles[i] > 0 ? h / utiles[i] : null))
      .filter((r): r is number => r !== null)
      .sort((x, y) => x - y);

    return {
      bloc: b,
      semaines,
      heures: semaines.reduce((t, x) => t + x.heures, 0),
      rampe: rapports.length > 0 ? (rapports[Math.floor(rapports.length / 2)] - 1) * 100 : null,
      seances: seances.length,
      qualite: seances.length > 0 ? Math.round((durs / seances.length) * 100) : 0,
    };
  });

  const cellule: React.CSSProperties = { padding: '7px 8px', borderTop: `1px solid ${C.borderSoft}`, whiteSpace: 'nowrap' };
  const entete: React.CSSProperties = {
    textAlign: 'left', padding: '6px 8px', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em',
    textTransform: 'uppercase', color: C.inkSecondary, borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap',
  };
  const pourcent = (v: number | null, suffixe = '') => (v === null
    ? '—'
    : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)} %${suffixe}`);

  return (
    <Card padding="14px 16px" gap={10}>
      <SectionLabel icon="route" color={C.teal}>
        {plan
          ? (fr ? 'Les périodes du plan à venir' : 'Okresy przyszłego planu')
          : (fr ? 'Les périodes du plan' : 'Okresy planu')}
      </SectionLabel>
      <div style={{ fontSize: 12, color: C.inkSecondary, lineHeight: 1.45 }}>
        {fr
          ? 'Chaque période a sa place entre ta référence d’aujourd’hui et ton objectif : c’est la part, et c’est elle qui donne l’allure de référence du bloc. Ouvre une période pour voir ses semaines — et régler ce qui leur donne cette forme.'
          : 'Każdy okres ma swoje miejsce między dzisiejszym odniesieniem a celem: to jest udział, i to on daje tempo odniesienia bloku. Otwórz okres, by zobaczyć jego tygodnie — i ustawić to, co nadaje im kształt.'}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12.5 }}>
          <thead>
            <tr>
              {[fr ? 'Période' : 'Okres', fr ? 'Semaines' : 'Tygodnie', fr ? 'Part' : 'Udział',
                fr ? 'Réf. 10 km' : 'Odn. 10 km', fr ? 'Volume' : 'Objętość', fr ? 'Rampe' : 'Rampa',
                fr ? 'Séances' : 'Sesje', fr ? 'Qualité' : 'Jakość'].map((h) => (
                <th key={h} scope="col" style={entete}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lignes.map((l) => {
              const ici = l.bloc.code === courant;
              const ouvert = ouverte === l.bloc.code;
              const ref = plan
                ? db.athlete.ref_actuelle_s - (db.athlete.ref_actuelle_s - db.athlete.ref_cible_s) * l.bloc.part
                : db.reference(l.bloc.code);
              return (
                <Fragment key={l.bloc.code}>
                  <tr
                    onClick={() => setOuverte(ouvert ? null : l.bloc.code)}
                    style={{ background: ici ? C.accentSoft : 'transparent', cursor: 'pointer' }}
                  >
                    <td style={cellule}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Icon name={ouvert ? 'chevron-down' : 'chevron-right'} size={13} />
                        <Mono size={12} color={C.teal}>{l.bloc.code}</Mono>
                        <span style={{ fontWeight: 600, color: C.ink }}>{db.periode(l.bloc).nom[lang]}</span>
                        {ici && (
                          <span style={{ fontSize: 9.5, fontWeight: 700, color: C.accentDeep, textTransform: 'uppercase' }}>
                            {fr ? 'ici' : 'tu'}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: C.inkQuiet, whiteSpace: 'normal' }}>
                        {[l.bloc.nom[lang] === db.periode(l.bloc).nom[lang] ? null : l.bloc.nom[lang],
                          l.bloc.quoi?.[lang] || db.periode(l.bloc).quoi[lang]]
                          .filter(Boolean).join(' · ')}
                      </div>
                    </td>
                    <td style={cellule}>
                      <Mono size={12} color={C.inkBody}>{`${l.bloc.de} → ${l.bloc.a}`}</Mono>
                      <span style={{ fontSize: 11, color: C.inkQuiet }}>{` (${l.semaines.length})`}</span>
                    </td>
                    <td style={cellule}><Mono size={12} color={C.ink}>{`${Math.round(l.bloc.part * 100)} %`}</Mono></td>
                    <td style={cellule}><Mono size={12} color={C.ink}>{db.format10k(ref)}</Mono></td>
                    <td style={cellule}><Mono size={12} color={C.inkBody}>{`${l.heures.toFixed(0)} h`}</Mono></td>
                    <td style={cellule}>
                      <Mono size={12} color={l.rampe === null ? C.inkQuiet : l.rampe >= 0 ? C.accentDeep : C.warning}>
                        {pourcent(l.rampe)}
                      </Mono>
                      <span style={{ fontSize: 10, color: C.inkQuiet }}>{fr ? '/sem' : '/tydz'}</span>
                    </td>
                    <td style={cellule}><Mono size={12} color={C.inkBody}>{String(l.seances)}</Mono></td>
                    <td style={cellule}><Mono size={12} color={C.inkBody}>{`${l.qualite} %`}</Mono></td>
                  </tr>
                  {ouvert && (
                    <tr>
                      <td colSpan={8} style={{ ...cellule, whiteSpace: 'normal', background: C.surfaceAlt }}>
                        <SemainesDeLaPeriode
                          semaines={l.semaines}
                          lang={lang}
                          nature={l.bloc.nature}
                          contraintes={contraintes}
                          onReglage={onReglage}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11, color: C.inkQuiet, lineHeight: 1.45 }}>
        {fr
          ? `De ${db.format10k(db.athlete.ref_actuelle_s)} à ${db.format10k(db.athlete.ref_cible_s)} sur 10 km : la part de chaque période dit où elle te place sur ce chemin.`
          : `Od ${db.format10k(db.athlete.ref_actuelle_s)} do ${db.format10k(db.athlete.ref_cible_s)} na 10 km: udział okresu mówi, gdzie cię stawia na tej drodze.`}
      </div>
    </Card>
  );
}

/* Le détail d'une période : ses semaines, et les réglages qui leur donnent
   cette forme. Les réglages ne s'affichent que sur un plan qu'on compose —
   sur un plan déjà enregistré, il n'y a plus rien à régler, il y a à
   régénérer. */
function SemainesDeLaPeriode({
  semaines, lang, nature, contraintes, onReglage,
}: {
  semaines: Array<{ semaine: number; heures: number; course: boolean }>;
  lang: Lang;
  nature: NaturePeriode;
  contraintes?: Contraintes;
  onReglage?: (patch: Partial<Contraintes>) => void;
}) {
  const fr = lang === 'fr';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {semaines.map((w, i) => {
          const avant = semaines[i - 1]?.heures;
          const pas = avant && avant > 0 ? (w.heures / avant - 1) * 100 : null;
          return (
            <div
              key={w.semaine}
              style={{
                display: 'flex', flexDirection: 'column', gap: 2, minWidth: 84,
                padding: '6px 8px', borderRadius: R.md,
                border: `1px solid ${w.course ? C.accent : C.border}`,
                background: w.course ? C.accentSoft : C.surface,
              }}
            >
              <Mono size={11} color={C.inkQuiet}>{`S${w.semaine}`}</Mono>
              <Mono size={13} color={C.ink}>{`${w.heures.toFixed(1)} h`}</Mono>
              <Mono size={10} color={w.course ? C.accentDeep : pas === null ? C.inkQuiet : pas >= 0 ? C.accentDeep : C.warning}>
                {w.course
                  ? (fr ? 'course' : 'zawody')
                  : pas === null ? '—' : `${pas >= 0 ? '+' : '−'}${Math.abs(pas).toFixed(0)} %`}
              </Mono>
            </div>
          );
        })}
      </div>
      {onReglage && contraintes && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
          {nature === 'reamorcage' && (
            <>
              <Reglage label={fr ? 'Départ (% du plancher)' : 'Start (% podłogi)'}
                valeur={contraintes.reamorcage_depart_pct ?? 55}
                onChange={(v) => onReglage({ reamorcage_depart_pct: v })} />
              <Reglage label={fr ? 'Semaines' : 'Tygodnie'} valeur={contraintes.reamorcage_semaines}
                onChange={(v) => onReglage({ reamorcage_semaines: v })} />
            </>
          )}
          {(nature === 'construction' || nature === 'pic') && (
            <>
              <Reglage label={fr ? 'Rampe (%/sem)' : 'Rampa (%/tydz)'} valeur={contraintes.rampe_pct ?? 6}
                onChange={(v) => onReglage({ rampe_pct: v })} />
              <Reglage label={fr ? 'Décharge : 1 sem. sur' : 'Odciążenie: 1 tydz. na'}
                valeur={contraintes.decharge_cadence ?? 4}
                onChange={(v) => onReglage({ decharge_cadence: v })} />
              <Reglage label={fr ? 'Décharge (−%)' : 'Odciążenie (−%)'} valeur={contraintes.decharge_pct ?? 20}
                onChange={(v) => onReglage({ decharge_pct: v })} />
            </>
          )}
          {nature === 'affutage' && (
            <>
              <Reglage label={fr ? 'Pente (−%/sem)' : 'Spadek (−%/tydz)'} valeur={contraintes.affutage_pct ?? 25}
                onChange={(v) => onReglage({ affutage_pct: v })} />
              <Reglage label={fr ? 'Semaines' : 'Tygodnie'} valeur={contraintes.affutage_semaines}
                onChange={(v) => onReglage({ affutage_semaines: v })} />
            </>
          )}
          <Reglage label={fr ? 'Semaine de course (% du plancher)' : 'Tydzień zawodów (% podłogi)'}
            valeur={contraintes.semaine_course_pct ?? 55}
            onChange={(v) => onReglage({ semaine_course_pct: v })} />
        </div>
      )}
    </div>
  );
}

/* Un réglage : un nombre, et rien d'autre. Il agit tout de suite — le plan se
   recompose sous le tableau, ce qui est la seule façon de savoir ce que le
   chiffre fait. */
function Reglage({ label, valeur, onChange }: {
  label: string; valeur: number; onChange: (v: number) => void;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10.5, color: C.inkSecondary }}>
      {label}
      <input
        type="number"
        value={String(valeur)}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        style={{ ...CHAMP, fontFamily: F.mono, width: 84, padding: '6px 8px', fontSize: 12 }}
      />
    </label>
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

  /* Les objectifs SONT ses courses. Une course de son calendrier avec un
     chrono visé est un objectif, et celle qui porte la couronne termine le
     plan — c'est la même chose rangée une seule fois, dans msc_competition.

     Avant, cette liste ne vivait que dans l'écran : on en retirait une, on
     changeait d'onglet, elle revenait ; on en ajoutait une, elle disparaissait.
     Rien n'était écrit tant que le plan n'était pas enregistré. */
  const courses = db
    .select('msc_competition', (c) => c.date >= debut)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));

  const objectifs: Objectif[] = courses.map((c) => ({
    competition_id: c.id,
    date: c.date,
    nom: (c.type_course ? typeCourse(c.type_course)?.nom[app.lang] : undefined) ?? c.nom,
    type_course: c.type_course,
    discipline: c.discipline,
    cible_s: c.cible_s ?? 0,
    cible_haute_s: c.cible_haute_s,
    parties: c.parties,
    distance_km: c.distance_km,
    principal: !!c.principal,
  }));

  /* La semaine type de l'athlète commande le squelette : le plan tombe sur
     ses jours, ses sports, ses types — et c'est aussi elle qui dit ce que
     pèse une semaine normale chez lui. Un plancher tapé à la main à côté
     d'une matrice à 7 h 30 donnait des séances rabotées d'un tiers sans que
     rien ne le dise. */
  const structure = db.select('msc_structure');
  const heuresPosees = structure.reduce((t, c) => t + (c.duree_min ?? 45), 0) / 60;

  /* Le plancher suit la semaine type tant que le coach n'a pas posé le sien :
     une valeur figée à l'ouverture de l'écran était fausse dès qu'on venait
     d'enregistrer la matrice dans l'onglet d'à côté. */
  const [plancherSaisi, setPlancherSaisi] = useState<number | null>(null);
  const plancherDeLaMatrice = heuresPosees > 0
    ? Math.max(Math.round(heuresPosees * 2) / 2, 1)
    : seed.plancher_heures;

  const [reglages, setReglages] = useState<Omit<Contraintes, 'plancher_heures'>>({
    plancher_km_sortie: seed.plancher_km_sortie,
    reamorcage_semaines: 6,
    affutage_semaines: 3,
    natation: true,
    velo: true,
    salle: true,
    montagne_toutes_les: 3,
  });

  /* Mémoïsé : le plan se recalcule quand les contraintes changent, et un objet
     neuf à chaque rendu le ferait recalculer pour rien — 261 séances. */
  /* Une échelle qui redescend : un objectif plus facile que celui d'avant. Le
     plan suit — la référence du bloc ralentit en chemin — et personne ne
     comprend pourquoi tant que les chronos ne sont pas ramenés à la même
     unité. Un semi et un marathon posés à la même allure au kilomètre, par
     exemple : c'est impossible, un semi se court plus vite. */
  const echelle = (() => {
    const comparables = objectifs
      .filter((o) => o.date && o.cible_s > 0 && !estMulti(o.type_course ?? ''))
      .map((o) => ({ nom: o.nom, e: equivalent10k(o.cible_s, o.distance_km) }));
    for (let i = 1; i < comparables.length; i += 1) {
      const avant = comparables[i - 1];
      const ici = comparables[i];
      if (ici.e > avant.e + 1) {
        const a = versTexte(Math.round(avant.e * 10));
        const b = versTexte(Math.round(ici.e * 10));
        return fr
          ? `« ${ici.nom} » vaut ${b} au 10 km, « ${avant.nom} » qui le précède en vaut ${a} : c’est une course plus facile que la précédente. Le plan ne recule pas pour autant — le bloc garde sa référence et la course se court dedans — mais si elle devait poser le niveau, « Aligner sur sa cible » donne le chrono qui correspond.`
          : `„${ici.nom}” to ${b} na 10 km, a poprzedzające „${avant.nom}” — ${a}: to zawody łatwiejsze od poprzednich. Plan się nie cofa — blok zachowuje swoje odniesienie — ale „Wyrównaj do celu” poda pasujący czas.`;
      }
    }
    return null;
  })();

  const contraintes: Contraintes = useMemo(
    () => ({ ...reglages, plancher_heures: plancherSaisi ?? plancherDeLaMatrice }),
    [reglages, plancherSaisi, plancherDeLaMatrice],
  );

  const [methode, setMethode] = useState<Methode | null>(null);
  const [statut, setStatut] = useState<'idle' | 'running' | 'error'>('idle');
  const [erreur, setErreur] = useState('');

  const athlete: ProfilAthlete = {
    nom,
    ref_actuelle_s: versSecondes(actuelle) / 10,
    ref_cible_s: versSecondes(cible) / 10,
    debut,
  };

  /* Une course de plus : elle est écrite tout de suite, avec une date à
     corriger plutôt qu'une ligne fantôme. Sans date, elle n'existerait dans
     aucune table — c'est précisément ce qu'on vient de réparer. */
  async function ajouterCourse() {
    const derniere = courses[courses.length - 1]?.date ?? debut;
    const dans = new Date(Date.parse(`${derniere}T00:00:00Z`) + 8 * 7 * 86_400_000)
      .toISOString().slice(0, 10);
    await app.enregistrerCompetition({
      date: dans,
      nom: typeCourse('cap_10')?.nom[app.lang] ?? '10 km',
      discipline: 'Course à pied',
      type_course: 'cap_10',
      distance_km: 10,
      officielle: true,
      /* La première course posée est l'objectif principal : quand il n'y en a
         qu'une, ce n'est pas à l'utilisateur de la désigner. */
      principal: !courses.some((c) => c.principal),
    });
  }

  /* Ce que la composition rend, y compris quand elle échoue : avaler l'erreur
     affichait « il manque un objectif » alors qu'il n'en manquait aucun. */
  const compose = useMemo<{ plan: PlanGenere | null; erreur: string | null }>(() => {
    if (!objectifs.some((o) => o.date && o.principal)) return { plan: null, erreur: null };
    try {
      return {
        plan: genererPlan(athlete, objectifs.filter((o) => o.date), contraintes, structure),
        erreur: null,
      };
    } catch (e) {
      return { plan: null, erreur: e instanceof Error ? e.message : String(e) };
    }
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [nom, actuelle, cible, debut, objectifs, contraintes, app.version]);
  const plan = compose.plan;

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

  /* Une modification part en base tout de suite : c'est une course, elle a un
     identifiant, et l'instantané revient avec. */
  const majCourse = (c: MscCompetition, patch: Partial<MscCompetition>) =>
    void app.enregistrerCompetition({ ...c, ...patch });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
    {/* Le plan qu'il suit aujourd'hui, période par période — avant celui qu'on
        lui construirait. On lit d'abord où il en est. */}
    <Periodisation
      app={app}
      plan={plan}
      contraintes={contraintes}
      onReglage={(patch) => {
        const { plancher_heures: sol, ...reste } = patch;
        if (sol !== undefined) setPlancherSaisi(sol);
        if (Object.keys(reste).length > 0) setReglages((r) => ({ ...r, ...reste }));
      }}
    />

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
        {courses.map((c) => (
          <LigneObjectif
            key={c.id}
            course={c}
            lang={app.lang}
            refCible={versSecondes(cible) / 10}
            onChange={(patch) => majCourse(c, patch)}
            onRetirer={() => void app.supprimerCompetition(c.id)}
          />
        ))}
        <button
          type="button"
          className="msc-hover-accent"
          onClick={() => void ajouterCourse()}
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
        {echelle && (
          <div style={{
            fontSize: 11.5, color: C.warning, lineHeight: 1.45,
            padding: '8px 10px', borderRadius: R.md, background: C.warningBg,
          }}>
            {echelle}
          </div>
        )}
        {app.coursesErreur && (
          <div style={{ fontSize: 12, color: C.negative, lineHeight: 1.4 }}>{app.coursesErreur}</div>
        )}
      </Card>

      {/* les contraintes */}
      <Card padding="16px 18px" gap={10}>
        <SectionLabel icon="scale">{fr ? 'Contraintes' : 'Ograniczenia'}</SectionLabel>
        <Grid cols={3} gap={8}>
          <Champ label={fr ? 'Plancher h/sem' : 'Min h/tydz'} value={String(contraintes.plancher_heures)}
            onChange={(v) => setPlancherSaisi(Number(v) || 0)} mono />
          <Champ label={fr ? 'Min km/sortie' : 'Min km/bieg'} value={String(contraintes.plancher_km_sortie)}
            onChange={(v) => setReglages({ ...reglages, plancher_km_sortie: Number(v) || 0 })} mono />
          <Champ label={fr ? 'Réamorçage' : 'Rozruch'} value={String(contraintes.reamorcage_semaines)}
            onChange={(v) => setReglages({ ...reglages, reamorcage_semaines: Number(v) || 0 })} mono />
          <Champ label={fr ? 'Affûtage' : 'Tapering'} value={String(contraintes.affutage_semaines)}
            onChange={(v) => setReglages({ ...reglages, affutage_semaines: Number(v) || 0 })} mono />
        </Grid>
        {/* D'où sort le plancher, et sur quoi le plan est bâti. Sans cette
            ligne, « 41 min » en face de 70 min posées ressemble à un bug. */}
        <div style={{ fontSize: 11.5, color: C.inkSecondary, lineHeight: 1.45 }}>
          {structure.length > 0
            ? (fr
              ? `Bâti sur sa semaine type : ${structure.length} créneaux, ${heuresPosees.toFixed(1).replace('.', ',')} h posées — ce sont ses jours, ses sports et ses durées. Le plancher en part ; le réamorçage démarre en dessous, la construction monte au-dessus, l’affûtage redescend.`
              : `Zbudowany na jego tygodniu wzorcowym: ${structure.length} slotów, ${heuresPosees.toFixed(1).replace('.', ',')} h — jego dni, sporty i czasy. Plancher stąd wychodzi; rozruch startuje niżej, budowa rośnie wyżej, tapering schodzi.`)
            : (fr
              ? 'Aucune semaine type posée pour cet athlète : le plan tombe sur le squelette par défaut. Pose-la dans l’onglet « Semaine type » pour qu’il suive ses jours et ses sports.'
              : 'Brak tygodnia wzorcowego: plan opiera się na domyślnym szkielecie. Ustaw go w zakładce „Tydzień wzorcowy”.')}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Bascule label={fr ? 'Natation' : 'Pływanie'} on={contraintes.natation}
            onChange={(v) => setReglages({ ...reglages, natation: v })} />
          <Bascule label={fr ? 'Vélo' : 'Rower'} on={contraintes.velo}
            onChange={(v) => setReglages({ ...reglages, velo: v })} />
          <Bascule label={fr ? 'Salle' : 'Siłownia'} on={contraintes.salle}
            onChange={(v) => setReglages({ ...reglages, salle: v })} />
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
            {/* Ce que montrent ces quatorze lignes : les deux premières
                semaines, donc les plus légères du plan. Sans le dire, une
                séance de 41 min en face des 70 min de la semaine type passe
                pour une erreur, alors que c'est le réamorçage. */}
            <div style={{ padding: '10px 14px', fontSize: 11.5, color: C.inkSecondary, lineHeight: 1.45, borderBottom: `1px solid ${C.borderSoft}` }}>
              {structure.length > 0
                ? (fr
                  ? `Les deux premières semaines — ${db.periode(plan.blocs[0]).nom[app.lang].toLowerCase()}, les plus légères du plan. Les jours et les sports sont ceux de sa semaine type ; les durées y reviennent à ${heuresPosees.toFixed(1).replace('.', ',')} h en S${contraintes.reamorcage_semaines}, puis montent.`
                  : `Dwa pierwsze tygodnie — ${db.periode(plan.blocs[0]).nom[app.lang].toLowerCase()}, najlżejsze w planie. Dni i sporty pochodzą z tygodnia wzorcowego; czasy wracają do ${heuresPosees.toFixed(1).replace('.', ',')} h w T${contraintes.reamorcage_semaines}, potem rosną.`)
                : (fr
                  ? 'Les deux premières semaines — les plus légères du plan.'
                  : 'Dwa pierwsze tygodnie — najlżejsze w planie.')}
            </div>
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
        <Card padding="16px 18px" gap={10}>
          {compose.erreur ? (
            <div style={{ fontSize: 13, color: C.negative, lineHeight: 1.5 }}>
              {(fr ? 'Le plan n’a pas pu être composé : ' : 'Nie udało się złożyć planu: ') + compose.erreur}
            </div>
          ) : (
          <div style={{ fontSize: 13, color: C.inkSecondary, lineHeight: 1.5 }}>
            {fr
              ? 'Le plan se construit à rebours depuis la date de l’objectif principal. Il manque :'
              : 'Plan liczy się wstecz od daty celu głównego. Brakuje:'}
          </div>)}
          {/* Ce qui manque, nommément. « Renseigne un objectif » n'aide pas
              quelqu'un qui vient d'en renseigner un et ne voit rien venir. */}
          <ul hidden={!!compose.erreur} style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: C.ink, lineHeight: 1.6 }}>
            {objectifs.length === 0 && (
              <li>{fr ? 'une course — le bouton « Ajouter une course », à gauche' : 'zawody — przycisk „Dodaj zawody” po lewej'}</li>
            )}
            {objectifs.filter((o) => !o.date).map((o, i) => (
              <li key={`d${i}`}>
                {fr ? `la date de « ${o.nom || o.type_course} »` : `data „${o.nom || o.type_course}”`}
              </li>
            ))}
            {objectifs.length > 0 && !objectifs.some((o) => o.principal) && (
              <li>
                {fr
                  ? 'l’objectif principal : la bascule « Objectif principal » sur la course qui termine le plan'
                  : 'cel główny: przełącznik „Cel główny” na zawodach kończących plan'}
              </li>
            )}
          </ul>
        </Card>
      )}
    </>} />
    </div>
  );
}

/* Une ligne d'objectif : une course de son calendrier, et ce qui en fait un
   objectif — le chrono visé, la couronne.

   Ce qui se tape vit ici le temps de la frappe, et part en base en sortant du
   champ : une requête par lettre serait ridicule, et ne rien écrire du tout
   était le bug d'avant. Les listes et les bascules, elles, écrivent tout de
   suite : il n'y a rien à finir de taper. */
function LigneObjectif({
  course, lang, refCible, onChange, onRetirer,
}: {
  course: MscCompetition;
  lang: Lang;
  /** L'allure cible de l'athlète, s/km : de quoi proposer un chrono. */
  refCible: number;
  onChange: (patch: Partial<MscCompetition>) => void;
  onRetirer: () => void;
}) {
  const fr = lang === 'fr';
  const [date, setDate] = useState(course.date);
  const [km, setKm] = useState(String(course.distance_km));
  const [chrono, setChrono] = useState(course.cible_s ? versTexte(course.cible_s) : '');
  const [confirme, setConfirme] = useState(false);

  /* L'instantané revient après chaque écriture : la ligne se réaligne sur ce
     que la base a vraiment retenu, plutôt que sur ce qu'on croyait écrire. */
  useEffect(() => {
    setDate(course.date);
    setKm(String(course.distance_km));
    setChrono(course.cible_s ? versTexte(course.cible_s) : '');
  }, [course.date, course.distance_km, course.cible_s]);

  const multi = estMulti(course.type_course ?? '');

  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: 12,
        border: `1px solid ${course.principal ? C.accent : C.border}`,
        background: course.principal ? C.accentSoft : 'transparent',
      }}
    >
      <ChoixType
        valeur={course.type_course}
        lang={lang}
        onChange={(t) => onChange({
          type_course: t.code,
          distance_km: t.distance_km,
          discipline: t.discipline,
          /* Le nom, c'est le type : « Semi-marathon », « Triathlon M ». Le
             vrai nom — Rome, l'Alpsman — se corrige dans Starts, et reste. */
          nom: course.nom && course.type_course ? course.nom : t.nom[lang],
        })}
      />
      <Grid cols={3} gap={8}>
        <Champ label="Date" value={date} onChange={setDate}
          onBlur={(v) => v && v !== course.date && onChange({ date: v })} type="date" mono />
        <Champ label="km" value={km} onChange={setKm}
          onBlur={(v) => Number(v) > 0 && Number(v) !== course.distance_km
            && onChange({ distance_km: Number(v) })} mono />
        <Champ
          label={fr ? 'Temps visé' : 'Cel czasowy'}
          value={chrono}
          onChange={setChrono}
          onBlur={(v) => {
            const s = versSecondes(v);
            if (s !== (course.cible_s ?? 0)) onChange({ cible_s: s, cible_haute_s: s || undefined });
          }}
          mono
          /* Ce que ce chrono vaut sur dix kilomètres. Sans cette ligne, un semi
             et un marathon posés à la même allure ne se voyaient pas — et c'est
             pourtant impossible : un semi se court plus vite. */
          aide={multi
            ? (fr ? 'total, transitions comprises' : 'łącznie ze strefami zmian')
            : course.cible_s
              ? `≡ ${versTexte(Math.round(equivalent10k(course.cible_s, course.distance_km) * 10))} ${fr ? 'au 10 km' : 'na 10 km'}`
              : `${fr ? 'à son allure cible' : 'w tempie docelowym'} : ${versTexte(Math.round(depuis10k(refCible, course.distance_km)))}`}
        />
      </Grid>
      {multi && (
        <PartiesObjectif
          objectif={{
            date: course.date, nom: course.nom, type_course: course.type_course,
            discipline: course.discipline, parties: course.parties,
            cible_s: course.cible_s ?? 0, cible_haute_s: course.cible_haute_s,
            distance_km: course.distance_km, principal: !!course.principal,
          }}
          lang={lang}
          onChange={(patch) => onChange({
            parties: patch.parties ?? course.parties,
            cible_s: patch.cible_s ?? course.cible_s,
          })}
        />
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Bascule
          label={fr ? 'Objectif principal' : 'Cel główny'}
          on={!!course.principal}
          onChange={(v) => onChange({ principal: v })}
        />
        {/* Aligner : le chrono que son objectif 10 km vaut sur cette distance.
            Un clic plutôt qu'une conversion de tête, qui est exactement
            l'endroit où deux courses finissent à la même allure. */}
        {!multi && (
          <button
            type="button"
            className="msc-hover-accent"
            onClick={() => {
              const t = Math.round(depuis10k(refCible, course.distance_km));
              onChange({ cible_s: t, cible_haute_s: t });
            }}
            style={{ fontSize: 12, color: C.inkSecondary, padding: '9px 11px' }}
          >
            {fr
              ? `Aligner sur sa cible (${versTexte(Math.round(depuis10k(refCible, course.distance_km)))})`
              : `Wyrównaj do celu (${versTexte(Math.round(depuis10k(refCible, course.distance_km)))})`}
          </button>
        )}
        {/* Retirer, c'est retirer la course de son calendrier : elle n'est pas
            qu'un objectif. On le dit avant de le faire. */}
        {confirme ? (
          <>
            <span style={{ fontSize: 11.5, color: C.inkSecondary }}>
              {fr ? `Retirer « ${course.nom} » de ses courses ?` : `Usunąć „${course.nom}” z jego zawodów?`}
            </span>
            <button type="button" onClick={onRetirer}
              style={{ fontSize: 12, color: C.negative, fontWeight: 600, padding: '9px 11px' }}>
              {fr ? 'Oui, retirer' : 'Tak, usuń'}
            </button>
            <button type="button" onClick={() => setConfirme(false)}
              style={{ fontSize: 12, color: C.inkQuiet, padding: '9px 11px' }}>
              {fr ? 'Annuler' : 'Anuluj'}
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setConfirme(true)}
            style={{ fontSize: 12, color: C.inkQuiet, padding: '9px 11px' }}>
            {fr ? 'Retirer' : 'Usuń'}
          </button>
        )}
      </div>
    </div>
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

/* ------------------------------------------------- le calendrier d'entraînement */

/* Tout ce que le plan demande à cet athlète, jour par jour.

   C'est la table que le générateur a écrite — une ligne par séance, datée,
   rattachée à sa semaine et à sa période — et c'est elle que le coach adapte
   au fil des signaux du matin. Les autres onglets en montrent des tranches :
   la semaine type est le moule, le plan est ce qui en sort, le suivi est ce
   qui a été fait. Ici, c'est la table elle-même.

   L'allure n'y est pas stockée, et ne le sera pas : elle se calcule du type
   de la séance et de la référence de sa période. La stocker, ce serait en
   avoir deux versions dont une fausse le jour où l'athlète progresse. */
function CalendrierEntrainement({ app, large = false }: { app: App; large?: boolean }) {
  const lang = app.lang;
  const fr = lang === 'fr';
  const [tout, setTout] = useState(false);

  const seances = db.select('msc_session').slice().sort((a, b) => a.date.localeCompare(b.date)
    || a.id - b.id);
  const etat = db.etatDesSeances();
  const aujourdhui = app.date;

  if (seances.length === 0) {
    return (
      <Card padding="16px 18px">
        <div style={{ fontSize: 13, color: C.inkSecondary, lineHeight: 1.5 }}>
          {fr
            ? 'Aucun plan actif pour cet athlète : il n’y a donc pas de calendrier. Compose-en un dans l’onglet Plan.'
            : 'Brak aktywnego planu: nie ma więc kalendarza. Ułóż go w zakładce Plan.'}
        </div>
      </Card>
    );
  }

  /* Les sept prochains jours, à partir d'aujourd'hui — glissants, pas la
     semaine civile : c'est ce que l'athlète a devant lui. */
  const jour = (n: number) => new Date(Date.parse(`${aujourdhui}T00:00:00Z`) + n * 86_400_000)
    .toISOString().slice(0, 10);
  const sept = Array.from({ length: 7 }, (_, i) => jour(i));

  const visibles = tout ? seances : seances.filter((s) => s.date >= aujourdhui);
  const semaines = [...new Set(visibles.map((s) => s.semaine))].sort((a, b) => a - b);

  const cellule: React.CSSProperties = {
    padding: '6px 8px', borderTop: `1px solid ${C.borderSoft}`, whiteSpace: 'nowrap',
  };
  const entete: React.CSSProperties = {
    textAlign: 'left', padding: '6px 8px', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em',
    textTransform: 'uppercase', color: C.inkSecondary, borderBottom: `1px solid ${C.border}`,
    whiteSpace: 'nowrap',
  };

  /* Ses courses, par date : une ligne du calendrier qui tombe un jour de
     compétition n'est pas une séance comme les autres — c'est elle que tout
     le reste prépare, et elle doit se voir d'un coup d'œil. */
  const competitions = new Map(db.select('msc_competition').map((c) => [c.date, c]));

  const allures = (s: MscPlanSession) => s.zones
    .map((z) => db.allure(z, s.bloc))
    .filter((x: string, i: number, liste: string[]) => liste.indexOf(x) === i)
    .join(' · ');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* d'où vient l'adaptation : le signal du matin, et ce qu'il donne */}
      <Card padding="14px 16px" gap={10}>
        <SectionLabel icon="activity" color={C.teal}>
          {fr ? 'Son niveau de forme' : 'Jego forma'}
        </SectionLabel>
        <div style={{ fontSize: 12, color: C.inkSecondary, lineHeight: 1.45 }}>
          {fr
            ? 'Ce que le coach lit chaque matin — charge et récupération — et qui lui fait adapter les jours qui suivent.'
            : 'To, co trener czyta każdego ranka — obciążenie i regeneracja — i na tej podstawie dostosowuje kolejne dni.'}
        </div>
        <FormeCourbes courbes={db.courbes} lang={lang} compact={!large} />
      </Card>

      <Card padding="14px 16px" gap={10}>
        <SectionLabel icon="calendar-days" color={C.teal}>
          {fr ? 'Les 7 prochains jours' : 'Najbliższe 7 dni'}
        </SectionLabel>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {sept.map((d) => {
            const duJour = seances.filter((s) => s.date === d && s.discipline !== 'Repos');
            const nom = new Date(`${d}T00:00:00`).toLocaleDateString(fr ? 'fr-FR' : 'pl-PL', { weekday: 'short', day: 'numeric' });
            return (
              <div
                key={d}
                style={{
                  display: 'flex', flexDirection: 'column', gap: 3, minWidth: 132, flex: '1 1 132px',
                  padding: '8px 10px', borderRadius: R.md,
                  border: `1px solid ${d === aujourdhui ? C.accent : C.border}`,
                  background: d === aujourdhui ? C.accentSoft : C.surface,
                }}
              >
                <Mono size={11} color={C.inkQuiet}>{nom}</Mono>
                {duJour.length === 0 && (
                  <span style={{ fontSize: 12, color: C.inkQuiet }}>{fr ? 'repos' : 'odpoczynek'}</span>
                )}
                {duJour.map((s) => (
                  <div key={s.id} style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: 12, color: C.ink, fontWeight: 600 }}>
                      {`${s.discipline} · ${db.type(s.type).label[lang]}`}
                    </span>
                    <Mono size={11} color={C.inkQuiet}>
                      {`${s.duree_min} min${allures(s) ? ` · ${allures(s)}` : ''}`}
                    </Mono>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </Card>

      <Card padding="14px 16px" gap={10}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <SectionLabel icon="list" color={C.teal}>
            {fr ? 'Tout son calendrier' : 'Cały jego kalendarz'}
          </SectionLabel>
          <Bascule
            label={tout
              ? (fr ? `Tout (${seances.length})` : `Wszystko (${seances.length})`)
              : (fr ? 'Depuis aujourd’hui' : 'Od dzisiaj')}
            on={tout}
            onChange={setTout}
          />
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
            <thead>
              <tr>
                {['id', fr ? 'Date' : 'Data', fr ? 'Jour' : 'Dzień', fr ? 'Période' : 'Okres',
                  fr ? 'Sport' : 'Sport', fr ? 'Type' : 'Typ', fr ? 'Durée' : 'Czas',
                  fr ? 'Allures' : 'Tempa', fr ? 'Charge' : 'Obciążenie', fr ? 'État' : 'Stan'].map((h) => (
                  <th key={h} scope="col" style={entete}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {semaines.map((n) => {
                const deLaSemaine = visibles.filter((s) => s.semaine === n);
                const minutes = deLaSemaine.reduce((t, s) => t + s.duree_min, 0);
                /* La charge de la semaine, sous son titre : c'est elle qui dit
                   ce que la semaine coûte, plus que les heures — une heure de
                   seuil et une heure d'endurance ne pèsent pas pareil. */
                const charge = deLaSemaine.reduce((t, s) => t + (s.charge ?? 0), 0);
                const km = deLaSemaine.reduce((t, s) => t + (s.distance_km ?? 0), 0);
                const bloc = db.blocDeSemaine(n);
                return (
                  <Fragment key={n}>
                    <tr>
                      <td colSpan={10} style={{ ...cellule, background: C.surfaceAlt, fontWeight: 600, color: C.ink }}>
                        {[
                          `S${n}`,
                          db.periode(bloc).nom[lang],
                          `${(minutes / 60).toFixed(1)} h`,
                          `${deLaSemaine.filter((s) => s.discipline !== 'Repos').length} ${fr ? 'séances' : 'sesji'}`,
                          km > 0 ? `${km.toFixed(0)} km` : null,
                          `${fr ? 'charge' : 'obciążenie'} ${charge}`,
                          deLaSemaine.some((x) => competitions.has(x.date))
                            ? `⚑ ${[...new Set(deLaSemaine.map((x) => competitions.get(x.date)?.nom).filter(Boolean))].join(', ')}`
                            : null,
                        ].filter(Boolean).join(' · ')}
                      </td>
                    </tr>
                    {deLaSemaine.map((s) => {
                      const st = db.statutDe(s, aujourdhui, etat);
                      const vu = visuelDuStatut(st);
                      const course = competitions.get(s.date);
                      return (
                        <tr
                          key={s.id}
                          style={{
                            background: course ? C.warningBg : s.date === aujourdhui ? C.accentSoft : 'transparent',
                            fontWeight: course ? 600 : 400,
                          }}
                        >
                          <td style={cellule}><Mono size={11} color={C.inkQuiet}>{String(s.id)}</Mono></td>
                          <td style={cellule}><Mono size={11.5} color={C.inkBody}>{s.date}</Mono></td>
                          <td style={cellule}><Mono size={11} color={C.inkQuiet}>{s.jour[lang]}</Mono></td>
                          <td style={cellule}><Mono size={11} color={C.teal}>{s.bloc}</Mono></td>
                          <td style={cellule}>
                            {s.discipline}
                            {course && (
                              <span style={{ color: C.warning, fontSize: 11 }}>{` · ${course.nom}`}</span>
                            )}
                          </td>
                          <td style={cellule}>{db.type(s.type).label[lang]}</td>
                          <td style={cellule}><Mono size={11.5} color={C.inkBody}>{s.duree_min ? `${s.duree_min}′` : '—'}</Mono></td>
                          <td style={cellule}><Mono size={11} color={C.inkQuiet}>{allures(s) || '—'}</Mono></td>
                          <td style={cellule}><Mono size={11} color={C.inkQuiet}>{s.charge ? String(s.charge) : '—'}</Mono></td>
                          <td style={cellule}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: vu.couleur, fontSize: 11.5 }}>
                              <Icon name={vu.icon} size={12} />
                              {motDuStatut(st, lang)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 11, color: C.inkQuiet, lineHeight: 1.45 }}>
          {fr
            ? 'L’allure n’est pas stockée : elle se calcule du type de la séance et de la référence de sa période. La stocker, ce serait en avoir deux versions dont une fausse le jour où il progresse.'
            : 'Tempo nie jest zapisane: wylicza się z typu sesji i odniesienia okresu.'}
        </div>
      </Card>
    </div>
  );
}
