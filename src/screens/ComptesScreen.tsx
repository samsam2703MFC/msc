/* Les comptes : qui peut se connecter, avec quel rôle, et quel athlète chacun
   voit. Ce que `npm run compte` fait en ligne de commande, ici à l'écran —
   pour le rôle admin seulement, le serveur le vérifie.

   Un mot de passe se remplace, il ne se lit jamais. Un compte se désactive,
   il ne se supprime pas : ses écritures (journal, mesures) restent à lui. */

import { useEffect, useState } from 'react';
import * as api from '../data/api';
import type { AthleteAdmin, AthleteVisible, CompteAdmin } from '../data/api';
import type { Lang } from '../data/types';
import { C, F, R } from '../design/theme';
import { Icon } from '../components/Icon';
import { Card, Colonnes, SectionLabel } from '../components/primitives';
import type { App } from '../state/useApp';

type Role = CompteAdmin['role'];
type Droit = AthleteVisible['droit'];
type Mode = 'les-deux' | 'athlete' | 'compte';
type Etape = 'quoi' | 'athlete' | 'compte' | 'recap';

const T = {
  fr: {
    chargement: 'Lecture des comptes…',
    intro: 'Qui se connecte, avec quel rôle, et quel athlète chacun voit. Un compte se désactive, il ne se supprime pas : ce qu’il a écrit reste à lui. L’onboarding d’un athlète, avec son compte, se fait dans Athlètes.',
    comptes: 'Comptes', aucun: 'Aucun compte.',
    roles: { athlete: 'athlète', coach: 'coach', admin: 'admin' } as Record<Role, string>,
    rolesAide: 'Un admin ouvre le back office ; un athlète a son plan. Le coach, c’est l’IA.',
    actif: 'actif', inactif: 'désactivé', sansMdp: 'sans mot de passe',
    aucunAthlete: 'ne voit aucun athlète',
    droits: { lecture: 'lecture', ecriture: 'écriture' } as Record<Droit, string>,
    acces: 'Athlètes visibles', aucunAcces: 'aucun',
    nouveauMdp: 'Nouveau mot de passe', mdpAide: '12 caractères au moins par défaut (Paramètres · Sécurité).',
    enregistrer: 'Enregistrer', modifier: 'Modifier', fermer: 'Fermer', enregistre: 'Enregistré',
    activer: 'Réactiver', desactiver: 'Désactiver',
    email: 'Email', nom: 'Nom', role: 'Rôle', mdp: 'Mot de passe',
    relier: 'Relié à l’athlète', personne: '— aucun —',
    nouveau: 'Onboarding · un athlète et son compte',
    nouveauAide: 'Une fois par athlète : qui il est, ses allures, son login. Ce qui change ensuite — son plan, ses starts — vit dans ses sections, pas ici.',
    nouveauCompte: 'Nouveau compte',
    nouveauCompteAide: 'Un compte seul : un coach, un admin, ou un login pour un athlète déjà encodé. Un athlète et son compte, c’est l’onboarding, dans Athlètes.',
    etapesLabel: 'Étapes', etapes: { quoi: 'Quoi', athlete: 'Athlète', compte: 'Compte', recap: 'Récap' } as Record<Etape, string>,
    quoi: 'Que veux-tu créer ?',
    modes: [
      { v: 'les-deux' as Mode, l: 'Un athlète et son compte', d: 'Un nouveau membre, avec son login — ce qu’il fait lui-même en s’inscrivant, ou que l’admin fait pour lui.' },
      { v: 'compte' as Mode, l: 'Un compte seul', d: 'Un autre admin, ou un login pour un athlète encodé avant sans compte.' },
    ],
    blocAthlete: 'L’athlète', blocCompte: 'Le compte', recap: 'Récapitulatif',
    athleteAide: 'Les allures sont celles du 10 km, en min/km — entre 2:00 et 15:00. Le plan part de l’allure actuelle et vise la cible.',
    allureAide: 'mm:ss, entre 2:00 et 15:00', emailAide: 'Un email complet, avec son @.',
    prenom: 'Prénom', actuelle: 'Allure 10 km actuelle', cible: 'Allure 10 km visée', debut: 'Début du plan',
    compteRelie: 'Relié au compte', nomCompte: 'Nom du compte',
    recapAide: 'Tout est vérifié puis écrit d’un coup : si quelque chose cloche, rien n’est créé.',
    suivant: 'Suivant', precedent: 'Retour', creer: 'Créer', creation: 'Création…', recommencer: 'En créer un autre',
    fait: 'C’est fait', suiteAide: 'L’athlète est prêt. Relie son Strava pour récupérer son historique, ou écris son plan.',
    relierStrava: 'Relier Strava', ecrirePlan: 'Écrire son plan',
    athletes: 'Athlètes', sansLogin: 'sans login',
    retirer: 'retirer',
  },
  pl: {
    chargement: 'Wczytywanie kont…',
    intro: 'Kto się loguje, z jaką rolą i którego zawodnika widzi. Konto się dezaktywuje, nie usuwa: to, co zapisało, zostaje przy nim. Onboarding zawodnika z kontem robi się w Zawodnikach.',
    comptes: 'Konta', aucun: 'Brak kont.',
    roles: { athlete: 'zawodnik', coach: 'trener', admin: 'admin' } as Record<Role, string>,
    rolesAide: 'Admin otwiera zaplecze; zawodnik ma swój plan. Trenerem jest AI.',
    actif: 'aktywne', inactif: 'wyłączone', sansMdp: 'bez hasła',
    aucunAthlete: 'nie widzi żadnego zawodnika',
    droits: { lecture: 'odczyt', ecriture: 'zapis' } as Record<Droit, string>,
    acces: 'Widoczni zawodnicy', aucunAcces: 'brak',
    nouveauMdp: 'Nowe hasło', mdpAide: 'Domyślnie co najmniej 12 znaków (Ustawienia · Bezpieczeństwo).',
    enregistrer: 'Zapisz', modifier: 'Edytuj', fermer: 'Zamknij', enregistre: 'Zapisano',
    activer: 'Włącz', desactiver: 'Wyłącz',
    email: 'E-mail', nom: 'Nazwisko', role: 'Rola', mdp: 'Hasło',
    relier: 'Powiązany z zawodnikiem', personne: '— brak —',
    nouveau: 'Onboarding · zawodnik i jego konto',
    nouveauAide: 'Raz na zawodnika: kim jest, jego tempa, jego login. To, co się potem zmienia — plan, starty — żyje w jego sekcjach, nie tutaj.',
    nouveauCompte: 'Nowe konto',
    nouveauCompteAide: 'Samo konto: trener, admin albo login dla wpisanego już zawodnika. Zawodnik i jego konto to onboarding, w Zawodnikach.',
    etapesLabel: 'Kroki', etapes: { quoi: 'Co', athlete: 'Zawodnik', compte: 'Konto', recap: 'Podsumowanie' } as Record<Etape, string>,
    quoi: 'Co chcesz utworzyć?',
    modes: [
      { v: 'les-deux' as Mode, l: 'Zawodnika i jego konto', d: 'Nowy członek z loginem — to, co robi sam przy rejestracji, albo admin za niego.' },
      { v: 'compte' as Mode, l: 'Tylko konto', d: 'Kolejny admin albo login dla zawodnika wpisanego wcześniej bez konta.' },
    ],
    blocAthlete: 'Zawodnik', blocCompte: 'Konto', recap: 'Podsumowanie',
    athleteAide: 'Tempa dotyczą 10 km, w min/km — między 2:00 a 15:00. Plan wychodzi od obecnego tempa i celuje w docelowe.',
    allureAide: 'mm:ss, między 2:00 a 15:00', emailAide: 'Pełny e-mail, z @.',
    prenom: 'Imię', actuelle: 'Obecne tempo 10 km', cible: 'Docelowe tempo 10 km', debut: 'Start planu',
    compteRelie: 'Powiązane z kontem', nomCompte: 'Nazwa konta',
    recapAide: 'Wszystko jest sprawdzane i zapisywane naraz: jeśli coś nie gra, nic nie powstaje.',
    suivant: 'Dalej', precedent: 'Wstecz', creer: 'Utwórz', creation: 'Tworzenie…', recommencer: 'Utwórz kolejnego',
    fait: 'Gotowe', suiteAide: 'Zawodnik jest gotowy. Połącz jego Stravę, by pobrać historię, albo napisz jego plan.',
    relierStrava: 'Połącz Stravę', ecrirePlan: 'Napisz plan',
    athletes: 'Zawodnicy', sansLogin: 'bez loginu',
    retirer: 'usuń',
  },
} satisfies Record<Lang, unknown>;

/* Deux rôles : l'athlète, et l'admin. Le coach, c'est l'IA — un compte
   « coach » d'avant reste lu, mais on n'en crée plus. */
const ROLES: Role[] = ['athlete', 'admin'];

const ENTREE: React.CSSProperties = {
  width: '100%', minWidth: 0, boxSizing: 'border-box',
  padding: '9px 11px', borderRadius: R.md, border: `1px solid ${C.border}`,
  background: C.surface, color: C.ink, fontSize: 14, fontFamily: F.body,
};

const BOUTON: React.CSSProperties = {
  padding: '8px 12px', borderRadius: R.md, background: C.accent, color: C.accentInk,
  fontWeight: 700, fontSize: 12, border: 'none',
};

const BOUTON_SOBRE: React.CSSProperties = {
  padding: '8px 12px', borderRadius: R.md, border: `1px solid ${C.border}`,
  color: C.inkMuted, fontSize: 12, fontWeight: 600, background: C.surface,
};

function mmss(s: number): string {
  return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
}

function Champ({
  label, value, onChange, type = 'text', aide, autoComplete, mono = false, inputMode,
}: {
  label: string; value: string; onChange: (v: string) => void; type?: string; aide?: string;
  autoComplete?: string; mono?: boolean; inputMode?: 'decimal' | 'email' | 'text';
}) {
  /* L'aide reste hors de l'étiquette : le nom accessible du champ, c'est le
     libellé seul — « Allure 10 km actuelle », pas « … 4:15 ». */
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        <span style={{ fontSize: 11, color: C.inkSecondary }}>{label}</span>
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          inputMode={inputMode}
          style={{ ...ENTREE, fontFamily: mono ? F.mono : F.body }}
        />
      </label>
      {aide && <span style={{ fontSize: 10.5, color: C.inkQuiet, lineHeight: 1.4 }}>{aide}</span>}
    </div>
  );
}

function Choix<V extends string>({
  label, options, value, onChange,
}: {
  label?: string; options: Array<{ v: V; l: string }>; value: V; onChange: (v: V) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {label && <span style={{ fontSize: 11, color: C.inkSecondary }}>{label}</span>}
      <div style={{ display: 'flex', gap: 4, padding: 3, borderRadius: R.full, background: C.surfaceAlt, border: `1px solid ${C.border}` }}>
        {options.map((o) => (
          <button
            key={o.v}
            type="button"
            aria-pressed={value === o.v}
            onClick={() => onChange(o.v)}
            style={{
              flex: 1, minWidth: 0, padding: '6px 8px', borderRadius: R.full, fontSize: 12, fontWeight: 600,
              background: value === o.v ? C.surface : 'transparent',
              color: value === o.v ? C.ink : C.inkSecondary,
              boxShadow: value === o.v ? C.shadowCard : 'none',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}
          >
            {o.l}
          </button>
        ))}
      </div>
    </div>
  );
}

function Selection({
  label, value, onChange, options, vide,
}: {
  label: string; value: string; onChange: (v: string) => void;
  options: Array<{ v: string; l: string }>; vide: string;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <span style={{ fontSize: 11, color: C.inkSecondary }}>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={ENTREE}>
        <option value="">{vide}</option>
        {options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </label>
  );
}

function Erreur({ texte }: { texte: string | null }) {
  if (!texte) return null;
  return (
    <div role="alert" style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 12, lineHeight: 1.4, color: C.negative }}>
      <Icon name="triangle-alert" size={13} />
      <span>{texte}</span>
    </div>
  );
}

function Pastille({ texte, ton }: { texte: string; ton: 'accent' | 'sobre' | 'alerte' }) {
  const couleurs = ton === 'accent'
    ? { fond: C.accentSoft, encre: C.accentDeep, bord: C.accent }
    : ton === 'alerte'
      ? { fond: C.warningBg, encre: C.warning, bord: C.warning }
      : { fond: C.surfaceAlt, encre: C.inkMuted, bord: C.border };
  return (
    <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: R.full, background: couleurs.fond, color: couleurs.encre, border: `1px solid ${couleurs.bord}`, whiteSpace: 'nowrap' }}>
      {texte}
    </span>
  );
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/* ------------------------------------------------------------- un compte */

function LigneCompte({
  c, moi, athletes, lang, onMaj,
}: {
  c: CompteAdmin; moi: boolean; athletes: AthleteAdmin[]; lang: Lang; onMaj: (c: CompteAdmin) => void;
}) {
  const t = T[lang];
  const [ouvert, setOuvert] = useState(false);
  const [role, setRole] = useState<Role>(c.role);
  const [nom, setNom] = useState(c.nom);
  const [mdp, setMdp] = useState('');
  const [job, setJob] = useState<'idle' | 'saving' | 'fait'>('idle');
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => { setRole(c.role); setNom(c.nom); }, [c.role, c.nom]);

  const modifie = role !== c.role || nom.trim() !== c.nom || mdp !== '';

  const envoyer = async (corps: Parameters<typeof api.majCompte>[1]) => {
    setJob('saving'); setErreur(null);
    try {
      const r = await api.majCompte(c.id, corps);
      onMaj(r.compte);
      setMdp('');
      setJob('fait');
      setTimeout(() => setJob('idle'), 1500);
    } catch (e) {
      setErreur(message(e)); setJob('idle');
    }
  };

  const changerAcces = async (athleteId: number, droit: Droit | null) => {
    setErreur(null);
    try {
      await api.majAcces({ compte_id: c.id, athlete_id: athleteId, droit });
      const reste = c.athletes.filter((a) => a.id !== athleteId);
      const a = athletes.find((x) => x.id === athleteId);
      onMaj({ ...c, athletes: droit && a ? [...reste, { id: a.id, nom: a.nom, droit }].sort((x, y) => x.nom.localeCompare(y.nom)) : reste });
    } catch (e) {
      setErreur(message(e));
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 0', borderTop: `1px solid ${C.borderSoft}`, opacity: c.actif ? 1 : 0.7 }}>
      <button
        type="button"
        onClick={() => setOuvert((o) => !o)}
        aria-expanded={ouvert}
        style={{ display: 'flex', alignItems: 'flex-start', gap: 10, textAlign: 'left', width: '100%' }}
      >
        <div style={{ width: 32, height: 32, borderRadius: R.full, flexShrink: 0, display: 'grid', placeItems: 'center', background: c.role === 'athlete' ? C.surfaceAlt : C.accentSoft, color: c.role === 'athlete' ? C.inkMuted : C.accentDeep }}>
          <Icon name={c.role === 'admin' ? 'settings' : c.role === 'coach' ? 'bot' : 'user'} size={16} />
        </div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: C.ink }}>{c.nom}</span>
            {moi && <Pastille texte={lang === 'fr' ? 'toi' : 'ty'} ton="accent" />}
            <Pastille texte={t.roles[c.role]} ton={c.role === 'athlete' ? 'sobre' : 'accent'} />
            {!c.actif && <Pastille texte={t.inactif} ton="alerte" />}
            {c.sans_mot_de_passe && <Pastille texte={t.sansMdp} ton="alerte" />}
          </div>
          <div style={{ fontSize: 11.5, color: C.inkSecondary, fontFamily: F.mono, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.email}</div>
          <div style={{ fontSize: 11, color: C.inkQuiet, lineHeight: 1.4 }}>
            {c.athletes.length === 0
              ? t.aucunAthlete
              : c.athletes.map((a) => `${a.nom} (${t.droits[a.droit]})`).join(' · ')}
          </div>
        </div>
        <Icon name="chevron-right" size={16} color={C.inkQuiet} style={{ transform: ouvert ? 'rotate(90deg)' : 'none', transition: 'transform 120ms', flexShrink: 0, marginTop: 8 }} />
      </button>

      {ouvert && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingLeft: 42 }}>
          <Champ label={t.nom} value={nom} onChange={setNom} />
          <Choix<Role> label={t.role} options={ROLES.map((r) => ({ v: r, l: t.roles[r] }))} value={role} onChange={setRole} />
          <Champ label={t.nouveauMdp} value={mdp} onChange={setMdp} type="password" autoComplete="new-password" aide={t.mdpAide} />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button
              type="button"
              disabled={!modifie || job === 'saving'}
              onClick={() => void envoyer({
                ...(nom.trim() !== c.nom ? { nom: nom.trim() } : {}),
                ...(role !== c.role ? { role } : {}),
                ...(mdp ? { mot_de_passe: mdp } : {}),
              })}
              style={{ ...BOUTON, opacity: modifie ? 1 : 0.5 }}
            >
              {job === 'fait' ? t.enregistre : t.enregistrer}
            </button>
            {!moi && (
              <button type="button" disabled={job === 'saving'} onClick={() => void envoyer({ actif: !c.actif })} style={BOUTON_SOBRE}>
                {c.actif ? t.desactiver : t.activer}
              </button>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 11, color: C.inkSecondary }}>{t.acces}</span>
            {athletes.map((a) => {
              const droit = c.athletes.find((x) => x.id === a.id)?.droit ?? null;
              return (
                <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: droit ? C.ink : C.inkQuiet, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.nom}</span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {(['lecture', 'ecriture'] as Droit[]).map((d) => (
                      <button
                        key={d}
                        type="button"
                        aria-pressed={droit === d}
                        onClick={() => void changerAcces(a.id, droit === d ? null : d)}
                        style={{
                          padding: '4px 9px', borderRadius: R.full, fontSize: 11, fontWeight: 600,
                          border: `1px solid ${droit === d ? C.accent : C.border}`,
                          background: droit === d ? C.accentSoft : C.surface,
                          color: droit === d ? C.accentDeep : C.inkMuted,
                        }}
                      >
                        {t.droits[d]}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <Erreur texte={erreur} />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ l'assistant */

/* Créer, pas à pas : quoi, l'athlète, le compte, le récapitulatif — puis ce
   qui vient après (relier Strava, écrire le plan). Chaque étape ne montre que
   ses champs et ne laisse passer que ce qui est valide ; le serveur revalide
   tout et écrit en une transaction. */

function allureOk(v: string): boolean {
  const s = v.trim();
  let n: number | null = null;
  if (/^\d+$/.test(s)) n = Number(s);
  else {
    const m = s.match(/^(\d{1,2}):([0-5]\d)$/);
    if (m) n = Number(m[1]) * 60 + Number(m[2]);
  }
  return n !== null && n >= 120 && n <= 900;
}

function emailOk(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

function Bloc({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: 12, border: `1px solid ${C.border}` }}>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: C.inkSecondary }}>{titre}</div>
      {children}
    </div>
  );
}

function Etapes({ etapes, courante, lang }: { etapes: Etape[]; courante: number; lang: Lang }) {
  const t = T[lang];
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }} aria-label={t.etapesLabel}>
      {etapes.map((e, i) => {
        const faite = i < courante;
        const active = i === courante;
        return (
          <div key={e} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 9px', borderRadius: R.full, fontSize: 11, fontWeight: 600,
                background: active ? C.accent : faite ? C.accentSoft : C.surfaceAlt,
                color: active ? C.accentInk : faite ? C.accentDeep : C.inkQuiet,
                border: `1px solid ${active ? C.accent : faite ? C.accent : C.border}`,
              }}
              aria-current={active ? 'step' : undefined}
            >
              {faite ? <Icon name="check" size={11} /> : <span>{i + 1}</span>}
              {t.etapes[e]}
            </span>
            {i < etapes.length - 1 && <span style={{ width: 10, height: 1, background: C.border }} />}
          </div>
        );
      })}
    </div>
  );
}

function Ligne({ label, valeur }: { label: string; valeur: string }) {
  return (
    <div style={{ display: 'flex', gap: 10, fontSize: 12.5, lineHeight: 1.5 }}>
      <span style={{ color: C.inkSecondary, minWidth: 120 }}>{label}</span>
      <span style={{ color: C.ink, fontWeight: 600 }}>{valeur}</span>
    </div>
  );
}

export function Assistant({
  comptes, athletes, lang, app, onCree, onSection, modeInitial = 'les-deux',
}: {
  comptes: CompteAdmin[]; athletes: AthleteAdmin[]; lang: Lang; app: App;
  onCree: () => void; onSection?: (s: 'strava' | 'plan') => void; modeInitial?: Mode;
}) {
  const t = T[lang];
  const [mode, setMode] = useState<Mode>(modeInitial);
  const [indice, setIndice] = useState(0);
  const [nom, setNom] = useState('');
  const [prenom, setPrenom] = useState('');
  const [actuelle, setActuelle] = useState('');
  const [cible, setCible] = useState('');
  const [debut, setDebut] = useState(new Date().toISOString().slice(0, 10));
  const [email, setEmail] = useState('');
  const [nomCompte, setNomCompte] = useState('');
  const [role, setRole] = useState<Role>('athlete');
  const [mdp, setMdp] = useState('');
  const [compteId, setCompteId] = useState('');
  const [athleteId, setAthleteId] = useState('');
  const [droit, setDroit] = useState<Droit>('ecriture');
  const [job, setJob] = useState<'idle' | 'saving'>('idle');
  const [erreur, setErreur] = useState<string | null>(null);
  const [resultat, setResultat] = useState<{ compte: CompteAdmin | null; athlete: AthleteAdmin | null } | null>(null);

  const avecAthlete = mode !== 'compte';
  const avecCompte = mode !== 'athlete';
  const etapes: Etape[] = ['quoi', ...(avecAthlete ? (['athlete'] as Etape[]) : []), ...(avecCompte ? (['compte'] as Etape[]) : []), 'recap'];
  const courante = etapes[Math.min(indice, etapes.length - 1)];

  const valideAthlete = nom.trim() !== '' && allureOk(actuelle) && allureOk(cible);
  const valideCompte = emailOk(email) && mdp !== '' && (avecAthlete || nomCompte.trim() !== '');
  const peutSuivre = courante === 'athlete' ? valideAthlete : courante === 'compte' ? valideCompte : true;
  const nomDuCompte = avecAthlete ? [prenom.trim(), nom.trim()].filter(Boolean).join(' ') : nomCompte.trim();
  const compteRelie = comptes.find((c) => String(c.id) === compteId);
  const athleteRelie = athletes.find((a) => String(a.id) === athleteId);

  const recommencer = () => {
    setMode(modeInitial); setIndice(0); setResultat(null); setErreur(null);
    setNom(''); setPrenom(''); setActuelle(''); setCible(''); setEmail(''); setNomCompte(''); setMdp('');
    setCompteId(''); setAthleteId(''); setRole('athlete'); setDroit('ecriture');
  };

  const creer = async () => {
    setJob('saving'); setErreur(null);
    try {
      const r = await api.inscrire({
        athlete: avecAthlete ? { nom: nom.trim(), prenom: prenom.trim() || null, actuelle: actuelle.trim(), cible: cible.trim(), debut } : null,
        compte: avecCompte ? { email: email.trim(), nom: nomDuCompte, role, mot_de_passe: mdp } : null,
        droit,
        compte_id: !avecCompte && compteId ? Number(compteId) : null,
        athlete_id: !avecAthlete && athleteId ? Number(athleteId) : null,
      });
      setResultat(r);
      setMdp('');
      onCree();
    } catch (e) {
      setErreur(message(e));
    } finally {
      setJob('idle');
    }
  };

  /* Après : l'athlète créé devient celui qu'on affiche, et Strava ou le plan
     sont à un clic — c'est ce qu'un coach fait juste après. */
  const ouvrir = async (s: 'strava' | 'plan') => {
    const id = resultat?.athlete?.id ?? athleteRelie?.id;
    if (id && id !== app.identite?.athletes[0]?.id) await app.recharger(id);
    else if (id) await app.recharger(id);
    onSection?.(s);
  };

  if (resultat) {
    return (
      <Card padding="16px 18px" gap={10} featured>
        <SectionLabel icon="circle-check" iconColor={C.accentDeep}>{t.fait}</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {resultat.athlete && <Ligne label={t.blocAthlete} valeur={`${[resultat.athlete.prenom, resultat.athlete.nom].filter(Boolean).join(' ')} · ${mmss(resultat.athlete.ref_actuelle_s)} → ${mmss(resultat.athlete.ref_cible_s)} /km`} />}
          {resultat.compte && <Ligne label={t.blocCompte} valeur={`${resultat.compte.email} · ${t.roles[resultat.compte.role]}`} />}
          {resultat.compte && resultat.compte.athletes.length > 0 && (
            <Ligne label={t.acces} valeur={resultat.compte.athletes.map((a) => `${a.nom} (${t.droits[a.droit]})`).join(' · ')} />
          )}
        </div>
        {(resultat.athlete || athleteRelie) && (
          <>
            <div style={{ fontSize: 11.5, color: C.inkSecondary, lineHeight: 1.45 }}>{t.suiteAide}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" onClick={() => void ouvrir('strava')} style={BOUTON}>{t.relierStrava}</button>
              <button type="button" onClick={() => void ouvrir('plan')} style={BOUTON_SOBRE}>{t.ecrirePlan}</button>
            </div>
          </>
        )}
        <div>
          <button type="button" onClick={recommencer} style={{ ...BOUTON_SOBRE, fontSize: 11 }}>{t.recommencer}</button>
        </div>
      </Card>
    );
  }

  return (
    <Card padding="16px 18px" gap={12}>
      <SectionLabel icon="plus" color={C.teal}>{modeInitial === 'compte' ? t.nouveauCompte : t.nouveau}</SectionLabel>
      <div style={{ fontSize: 11.5, color: C.inkSecondary, lineHeight: 1.45 }}>{modeInitial === 'compte' ? t.nouveauCompteAide : t.nouveauAide}</div>
      <Etapes etapes={etapes} courante={etapes.indexOf(courante)} lang={lang} />

      {courante === 'quoi' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.ink }}>{t.quoi}</div>
          {t.modes.map((m) => (
            <button
              key={m.v}
              type="button"
              onClick={() => { setMode(m.v); setIndice(0); }}
              aria-pressed={mode === m.v}
              style={{
                display: 'flex', gap: 10, alignItems: 'flex-start', textAlign: 'left', padding: '10px 12px', borderRadius: 12,
                border: `1px solid ${mode === m.v ? C.accent : C.border}`, background: mode === m.v ? C.accentSoft : C.surface,
              }}
            >
              <Icon name={mode === m.v ? 'circle-check' : 'circle'} size={16} color={mode === m.v ? C.accentDeep : C.inkQuiet} style={{ marginTop: 1, flexShrink: 0 }} />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: C.ink }}>{m.l}</span>
                <span style={{ fontSize: 11.5, color: C.inkSecondary, lineHeight: 1.4 }}>{m.d}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {courante === 'athlete' && (
        <Bloc titre={t.blocAthlete}>
          <div style={{ fontSize: 11.5, color: C.inkSecondary, lineHeight: 1.45 }}>{t.athleteAide}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Champ label={t.nom} value={nom} onChange={setNom} autoComplete="off" />
            <Champ label={t.prenom} value={prenom} onChange={setPrenom} autoComplete="off" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <Champ label={t.actuelle} value={actuelle} onChange={setActuelle} mono inputMode="decimal" aide={actuelle && !allureOk(actuelle) ? t.allureAide : '4:15'} />
            <Champ label={t.cible} value={cible} onChange={setCible} mono inputMode="decimal" aide={cible && !allureOk(cible) ? t.allureAide : '3:50'} />
            <Champ label={t.debut} value={debut} onChange={setDebut} type="date" mono />
          </div>
          {!avecCompte && (
            <>
              <Selection label={t.compteRelie} value={compteId} onChange={setCompteId} vide={t.personne}
                options={comptes.map((c) => ({ v: String(c.id), l: `${c.nom} · ${c.email}` }))} />
              {compteId && <Choix<Droit> label={t.acces} options={[{ v: 'lecture', l: t.droits.lecture }, { v: 'ecriture', l: t.droits.ecriture }]} value={droit} onChange={setDroit} />}
            </>
          )}
        </Bloc>
      )}

      {courante === 'compte' && (
        <Bloc titre={t.blocCompte}>
          {!avecAthlete && <Champ label={t.nomCompte} value={nomCompte} onChange={setNomCompte} autoComplete="off" />}
          {avecAthlete && <div style={{ fontSize: 11.5, color: C.inkSecondary }}>{`${t.nomCompte} : ${nomDuCompte || '—'}`}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Champ label={t.email} value={email} onChange={setEmail} type="email" inputMode="email" autoComplete="off" mono aide={email && !emailOk(email) ? t.emailAide : undefined} />
            <Champ label={t.mdp} value={mdp} onChange={setMdp} type="password" autoComplete="new-password" aide={t.mdpAide} />
          </div>
          <Choix<Role> label={t.role} options={ROLES.map((r) => ({ v: r, l: t.roles[r] }))} value={role} onChange={setRole} />
          <div style={{ fontSize: 10.5, color: C.inkQuiet, lineHeight: 1.4, marginTop: -4 }}>{t.rolesAide}</div>
          {!avecAthlete && (
            <>
              <Selection label={t.relier} value={athleteId} onChange={setAthleteId} vide={t.personne}
                options={athletes.map((a) => ({ v: String(a.id), l: a.nom }))} />
              {athleteId && <Choix<Droit> label={t.acces} options={[{ v: 'lecture', l: t.droits.lecture }, { v: 'ecriture', l: t.droits.ecriture }]} value={droit} onChange={setDroit} />}
            </>
          )}
          {avecAthlete && <Choix<Droit> label={t.acces} options={[{ v: 'lecture', l: t.droits.lecture }, { v: 'ecriture', l: t.droits.ecriture }]} value={droit} onChange={setDroit} />}
        </Bloc>
      )}

      {courante === 'recap' && (
        <Bloc titre={t.recap}>
          {avecAthlete && <Ligne label={t.blocAthlete} valeur={`${[prenom.trim(), nom.trim()].filter(Boolean).join(' ')} · ${actuelle} → ${cible} /km · ${t.debut.toLowerCase()} ${debut}`} />}
          {avecCompte && <Ligne label={t.blocCompte} valeur={`${email.trim()} · ${t.roles[role]} · ${nomDuCompte}`} />}
          {avecAthlete && avecCompte && <Ligne label={t.acces} valeur={t.droits[droit]} />}
          {!avecCompte && <Ligne label={t.compteRelie} valeur={compteRelie ? `${compteRelie.email} (${t.droits[droit]})` : t.personne} />}
          {!avecAthlete && <Ligne label={t.relier} valeur={athleteRelie ? `${athleteRelie.nom} (${t.droits[droit]})` : t.personne} />}
          <div style={{ fontSize: 11.5, color: C.inkSecondary, lineHeight: 1.45 }}>{t.recapAide}</div>
        </Bloc>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {indice > 0 && (
          <button type="button" onClick={() => setIndice((i) => i - 1)} style={BOUTON_SOBRE}>{t.precedent}</button>
        )}
        <div style={{ flex: 1 }} />
        {courante !== 'recap' ? (
          <button type="button" disabled={!peutSuivre} onClick={() => setIndice((i) => i + 1)} style={{ ...BOUTON, opacity: peutSuivre ? 1 : 0.5 }}>
            {t.suivant}
          </button>
        ) : (
          <button type="button" disabled={job === 'saving'} onClick={() => void creer()} style={BOUTON}>
            {job === 'saving' ? t.creation : t.creer}
          </button>
        )}
      </div>
      <Erreur texte={erreur} />
    </Card>
  );
}

/* ---------------------------------------------------------------- l'écran */

export function ComptesScreen({ app, onSection, large = false }: { app: App; onSection?: (s: 'strava' | 'plan') => void; large?: boolean }) {
  const t = T[app.lang];
  const [comptes, setComptes] = useState<CompteAdmin[] | null>(null);
  const [athletes, setAthletes] = useState<AthleteAdmin[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const moi = app.identite?.compte.id ?? null;

  useEffect(() => {
    let vivant = true;
    api.adminComptes()
      .then((r) => { if (vivant) { setComptes(r.comptes); setAthletes(r.athletes); } })
      .catch((e) => { if (vivant) setErreur(message(e)); });
    return () => { vivant = false; };
  }, []);

  const remplacer = (c: CompteAdmin) =>
    setComptes((cs) => (cs ?? []).map((x) => (x.id === c.id ? c : x)));

  if (erreur) {
    return (
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 12px', borderRadius: R.md, background: C.warningBg, color: C.warning, fontSize: 12, lineHeight: 1.4 }}>
        <Icon name="triangle-alert" size={14} />
        <span>{erreur}</span>
      </div>
    );
  }
  if (comptes === null) return <div style={{ color: C.inkSecondary, fontSize: 13 }}>{t.chargement}</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 12.5, color: C.inkSecondary, lineHeight: 1.5 }}>{t.intro}</div>

      <Colonnes large={large} ratio="minmax(0, 6fr) minmax(0, 5fr)" gauche={
      <Card padding="12px 16px" gap={0}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 6 }}>
          <Icon name="user" size={16} color={C.teal} />
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.teal }}>
            {`${t.comptes} · ${comptes.length}`}
          </div>
        </div>
        {comptes.length === 0 && <div style={{ fontSize: 12, color: C.inkQuiet, padding: '8px 0' }}>{t.aucun}</div>}
        {comptes.map((c) => (
          <LigneCompte key={c.id} c={c} moi={c.id === moi} athletes={athletes} lang={app.lang} onMaj={remplacer} />
        ))}
      </Card>

      } droite={
      /* Un compte seul — un autre admin, un login pour un athlète encodé avant
         sans compte. L'athlète et son compte, c'est l'onboarding, dans Athlètes. */
      <Assistant
        comptes={comptes}
        athletes={athletes}
        lang={app.lang}
        app={app}
        modeInitial="compte"
        onSection={onSection}
        /* Relire les deux listes : un compte créé avec son athlète, un athlète
           relié à un compte existant, un compte relié à un athlète — chaque cas
           touche les deux, et le serveur sait mieux que nous ce qu'il a écrit. */
        onCree={() => {
          void api.adminComptes().then((r) => { setComptes(r.comptes); setAthletes(r.athletes); });
        }}
      />
      } />
    </div>
  );
}
