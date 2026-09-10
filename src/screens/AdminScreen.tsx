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
import { Icon } from '../components/Icon';
import { AccentButton, Card, Colonnes, Grid, Mono, SectionLabel } from '../components/primitives';
import { DEFICITS_DEFAUT, DISCIPLINES, estMulti, referenceAPied, typeCourse, typesGroupes } from '../data/courses';
import type { Deficits, TypeCourse } from '../data/courses';
import type { Lang } from '../data/types';
import type { App } from '../state/useApp';
import { BackOffice } from './BackOffice';
import { AthletesHub, Classement, SuiviAthlete } from './AthletesScreen';
import { ProfilScreen } from './ProfilScreen';
import { CalendrierScreen } from './CalendrierScreen';
import { ParamScreen } from './ParamScreen';
import { ComptesScreen } from './ComptesScreen';
import { SystemeScreen } from './SystemeScreen';
import { StravaScreen } from './StravaScreen';
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

export const SECTIONS = {
  fr: { athletes: 'Athlètes', classement: 'Classement', calendrier: 'Calendrier', suivi: 'Suivi', plan: 'Plan', courses: 'Starts', strava: 'Strava', profil: 'Profil', param: 'Réglages', comptes: 'Comptes', systeme: 'Système' },
  pl: { athletes: 'Zawodnicy', classement: 'Ranking', calendrier: 'Kalendarz', suivi: 'Podgląd', plan: 'Plan', courses: 'Starty', strava: 'Strava', profil: 'Profil', param: 'Ustawienia', comptes: 'Konta', systeme: 'System' },
} as const;

export type Section = keyof typeof SECTIONS.fr;

/* Trois groupes, dans cet ordre. Le club : la liste des athlètes (le point
   d'entrée du coach, avec l'onboarding qui en crée un — une fois), le
   classement, le calendrier. L'athlète affiché : ce qui change tout le temps
   d'abord — son suivi, son plan, ses starts — puis sa configuration — son
   Strava, son profil. Les paramètres de l'application : réglages, comptes,
   système. Une chose par section, jamais deux fois. Le menu du bureau les
   affiche par groupe ; la barre du téléphone, à la suite. */
export const GROUPES: Array<{ code: 'club' | 'athlete' | 'parametres'; titre: Record<Lang, string>; sections: Section[] }> = [
  { code: 'club', titre: { fr: 'Club', pl: 'Klub' }, sections: ['athletes', 'classement', 'calendrier'] },
  { code: 'athlete', titre: { fr: 'Athlète', pl: 'Zawodnik' }, sections: ['suivi', 'plan', 'courses', 'strava', 'profil'] },
  { code: 'parametres', titre: { fr: 'Paramètres', pl: 'Ustawienia' }, sections: ['param', 'comptes', 'systeme'] },
];

/* Dans le groupe de l'athlète : l'entraînement (ce qui bouge) et la
   configuration (ce qu'on pose une fois). */
export const CONFIGURATION: Section[] = ['strava', 'profil'];

/** Les sections qu'un compte peut ouvrir. Un athlète : les siennes, et le
    club. Un coach : la liste des athlètes et leur suivi en plus, et les
    réglages. Un admin : Comptes et Système en plus. La même liste sert la
    barre du téléphone et le menu du bureau. */
export function sectionsDe(role: 'athlete' | 'coach' | 'admin' | undefined): Section[] {
  const coach = role === 'coach' || role === 'admin';
  return [
    ...(coach ? (['athletes'] as Section[]) : []),
    'classement', 'calendrier',
    ...(coach ? (['suivi'] as Section[]) : []),
    'plan', 'courses', 'strava', 'profil',
    ...(coach ? (['param'] as Section[]) : []),
    ...(role === 'admin' ? (['comptes', 'systeme'] as Section[]) : []),
  ];
}

/** Le contenu d'une section, sans la barre : le téléphone la met sous sa
    bascule, le bureau la met à côté de son menu. */
export type Suite = 'strava' | 'plan' | 'suivi' | 'param';

/** `large` : le bureau, qui a de la largeur — les sections s'y posent en
    colonnes ; le téléphone empile. */
export function SectionAdmin({
  app, section, onSection, large = false,
}: {
  app: App; section: Section; onSection?: (s: Suite) => void; large?: boolean;
}) {
  switch (section) {
    case 'athletes': return <AthletesHub app={app} onSection={onSection} large={large} />;
    case 'classement': return <Classement app={app} />;
    case 'calendrier': return <CalendrierScreen app={app} />;
    case 'suivi': return <SuiviAthlete app={app} large={large} />;
    case 'courses': return <BackOffice app={app} />;
    case 'strava': return <StravaScreen app={app} />;
    case 'profil': return <ProfilScreen app={app} onSection={onSection} large={large} />;
    case 'param': return <ParamScreen app={app} large={large} />;
    case 'comptes': return <ComptesScreen app={app} onSection={onSection} large={large} />;
    case 'systeme': return <SystemeScreen app={app} onSection={onSection} large={large} />;
    default: return <Generateur app={app} large={large} />;
  }
}

/* L'écran Créer porte deux choses différentes : fabriquer un plan, et tenir le
   registre des courses. Une bascule plutôt qu'un sixième onglet — la barre en a
   déjà cinq, et un back office n'est pas un écran qu'on ouvre tous les jours.

   Pour un coach ou un admin, le même onglet devient le back office : Réglages
   pour les deux, Comptes et Système pour l'admin seul — les mots de passe des
   autres et l'état du serveur ne regardent pas un coach. */
export function AdminScreen({ app }: { app: App }) {
  /* Les réglages valent pour tout le serveur : un rôle coach ou admin, et le
     serveur le vérifie de son côté. */
  const role = app.identite?.compte.role ?? 'athlete';
  const [section, setSection] = useState<Section>(() => (role === 'athlete' ? 'plan' : 'athletes'));
  const libelles = SECTIONS[app.lang];
  /* Le calendrier et le classement sont communs — un club, tout le monde les
     voit. Les cartes de suivi, elles, ne montrent que les athlètes visibles
     du compte : un seul pour un athlète, tous pour un coach. */
  const sections = sectionsDe(role);
  /* Jusqu'à cinq, les sections se partagent la largeur. Au-delà — l'admin —
     la barre défile : sept intitulés serrés dans 360 px ne se lisent plus. */
  const serre = sections.length > 3;
  const defile = sections.length > 5;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div
        role="tablist"
        style={{
          display: 'flex',
          gap: 3,
          padding: 3,
          borderRadius: R.full,
          background: C.surfaceAlt,
          border: `1px solid ${C.border}`,
          ...(defile ? { overflowX: 'auto', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' } : {}),
        }}
      >
        {sections.map((cle) => (
          <button
            key={cle}
            type="button"
            role="tab"
            onClick={() => setSection(cle)}
            aria-selected={section === cle}
            aria-pressed={section === cle}
            style={{
              flex: defile ? '0 0 auto' : 1,
              minWidth: 0,
              padding: defile ? '7px 12px' : serre ? '7px 4px' : '7px 12px',
              borderRadius: R.full,
              fontSize: serre && !defile ? 11 : 12,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              fontWeight: 600,
              background: section === cle ? C.surface : 'transparent',
              color: section === cle ? C.ink : C.inkSecondary,
              boxShadow: section === cle ? C.shadowCard : 'none',
            }}
          >
            {libelles[cle]}
          </button>
        ))}
      </div>

      <SectionAdmin app={app} section={section} onSection={setSection} />
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

  const plan: PlanGenere | null = useMemo(() => {
    if (!objectifs.some((o) => o.date && o.principal)) return null;
    try {
      return genererPlan(athlete, objectifs.filter((o) => o.date), contraintes);
    } catch {
      return null;
    }
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [nom, actuelle, cible, debut, objectifs, contraintes]);

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
   déficit se règlent dans Réglages · Enchaînements. */
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
          ? `Déficits appliqués : natation ${deficits.natation} %, vélo ${deficits.velo} %, course ${deficits.cap} % — Réglages · Enchaînements.`
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
