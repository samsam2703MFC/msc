/* Créer — the athlete, their objectives, their constraints, and the plan the
   generator builds from them.

   The plan is generated locally and immediately: periodisation, volumes and
   placement need nothing but the form. Asking Claude for the methodology is a
   second, optional step that fills in what each session actually is. */

import { useMemo, useState } from 'react';
import * as db from '../data/db';
import { genererPlan } from '../data/generateur';
import type { Contraintes, Objectif, PlanGenere, ProfilAthlete } from '../data/generateur';
import { appliquerMethode, demanderMethode, MethodeError } from '../data/methode';
import type { Methode } from '../data/methode';
import { C, F, R } from '../design/theme';
import { Icon } from '../components/Icon';
import { AccentButton, Card, Grid, Mono, SectionLabel } from '../components/primitives';
import type { App } from '../state/useApp';
import { BackOffice } from './BackOffice';
import { AthletesScreen } from './AthletesScreen';
import { CalendrierScreen } from './CalendrierScreen';
import { ParamScreen } from './ParamScreen';
import { ComptesScreen } from './ComptesScreen';
import { SystemeScreen } from './SystemeScreen';
import { ConnexionsScreen } from './ConnexionsScreen';

/** mm:ss → seconds. */
function versSecondes(texte: string): number {
  const [m, s] = texte.split(':');
  return Number(m ?? 0) * 60 + Number(s ?? 0);
}

function versTexte(secondes: number): string {
  return `${Math.floor(secondes / 60)}:${String(Math.round(secondes % 60)).padStart(2, '0')}`;
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
  cible_s: 2400,
  distance_km: 10,
  principal: false,
};

const SECTIONS = {
  fr: { plan: 'Plan', courses: 'Courses', calendrier: 'Calendrier', athletes: 'Athlètes', connexions: 'Connexions', param: 'Réglages', comptes: 'Comptes', systeme: 'Système' },
  pl: { plan: 'Plan', courses: 'Zawody', calendrier: 'Kalendarz', athletes: 'Zawodnicy', connexions: 'Połączenia', param: 'Ustawienia', comptes: 'Konta', systeme: 'System' },
} as const;

type Section = keyof typeof SECTIONS.fr;

/* L'écran Créer porte deux choses différentes : fabriquer un plan, et tenir le
   registre des courses. Une bascule plutôt qu'un sixième onglet — la barre en a
   déjà cinq, et un back office n'est pas un écran qu'on ouvre tous les jours.

   Pour un coach ou un admin, le même onglet devient le back office : Réglages
   pour les deux, Comptes et Système pour l'admin seul — les mots de passe des
   autres et l'état du serveur ne regardent pas un coach. */
export function AdminScreen({ app }: { app: App }) {
  const [section, setSection] = useState<Section>('plan');
  const libelles = SECTIONS[app.lang];
  /* Les réglages valent pour tout le serveur : un rôle coach ou admin, et le
     serveur le vérifie de son côté. */
  const role = app.identite?.compte.role ?? 'athlete';
  const admin = role === 'coach' || role === 'admin';
  /* Le calendrier et le classement sont communs — un club, tout le monde les
     voit. Les cartes de suivi, elles, ne montrent que les athlètes visibles
     du compte : un seul pour un athlète, tous pour un coach. */
  const sections: Section[] = [
    'plan', 'courses', 'calendrier', 'athletes',
    ...(admin ? (['connexions', 'param'] as Section[]) : []),
    ...(role === 'admin' ? (['comptes', 'systeme'] as Section[]) : []),
  ];
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

      {section === 'courses'
        ? <BackOffice app={app} />
        : section === 'athletes'
          ? <AthletesScreen app={app} />
          : section === 'param'
            ? <ParamScreen app={app} />
            : section === 'connexions'
              ? <ConnexionsScreen app={app} />
            : section === 'comptes'
              ? <ComptesScreen app={app} />
              : section === 'systeme'
                ? <SystemeScreen app={app} />
                : section === 'calendrier'
                  ? <CalendrierScreen app={app} />
                  : <Generateur app={app} />}
    </div>
  );
}

function Generateur({ app }: { app: App }) {
  const fr = app.lang === 'fr';
  const seed = db.athlete;

  const [nom, setNom] = useState(seed.nom);
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* l'athlète */}
      <Card padding="16px 18px" gap={10}>
        <SectionLabel icon="target">{fr ? 'Athlète' : 'Zawodnik'}</SectionLabel>
        <Champ label={fr ? 'Nom' : 'Imię'} value={nom} onChange={setNom} />
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
            <Champ label={fr ? 'Nom' : 'Nazwa'} value={o.nom} onChange={(v) => majObjectif(i, { nom: v })} />
            <Grid cols={3} gap={8}>
              <Champ label="Date" value={o.date} onChange={(v) => majObjectif(i, { date: v })} type="date" mono />
              <Champ label="km" value={String(o.distance_km)} onChange={(v) => majObjectif(i, { distance_km: Number(v) || 10 })} mono />
              <Champ label={fr ? 'Cible' : 'Cel'} value={versTexte(o.cible_s)} onChange={(v) => majObjectif(i, { cible_s: versSecondes(v) })} mono />
            </Grid>
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
                ? `Le plan actif devient celui-ci : ${sessions.length} séances du ${plan.sessions[0]?.date} au ${plan.sessions[plan.sessions.length - 1]?.date}. L'ancien n'est pas supprimé — ses séances restent, et le journal comme les activités qui les visent avec.`
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
