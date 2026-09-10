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
import { Card, SectionLabel } from '../components/primitives';
import type { App } from '../state/useApp';

type Role = CompteAdmin['role'];
type Droit = AthleteVisible['droit'];

const T = {
  fr: {
    chargement: 'Lecture des comptes…',
    intro: 'Qui se connecte, avec quel rôle, et quel athlète chacun voit. Un compte se désactive, il ne se supprime pas : ce qu’il a écrit reste à lui.',
    comptes: 'Comptes', aucun: 'Aucun compte.',
    roles: { athlete: 'athlète', coach: 'coach', admin: 'admin' } as Record<Role, string>,
    rolesAide: 'Un coach ouvre Réglages et Athlètes ; un admin ouvre aussi Comptes et Système.',
    actif: 'actif', inactif: 'désactivé', sansMdp: 'sans mot de passe',
    aucunAthlete: 'ne voit aucun athlète',
    droits: { lecture: 'lecture', ecriture: 'écriture' } as Record<Droit, string>,
    acces: 'Athlètes visibles', aucunAcces: 'aucun',
    nouveauMdp: 'Nouveau mot de passe', mdpAide: '12 caractères au moins par défaut (Réglages · Sécurité).',
    enregistrer: 'Enregistrer', modifier: 'Modifier', fermer: 'Fermer', enregistre: 'Enregistré',
    activer: 'Réactiver', desactiver: 'Désactiver',
    email: 'Email', nom: 'Nom', role: 'Rôle', mdp: 'Mot de passe',
    relier: 'Relié à l’athlète', personne: '— aucun —',
    nouveau: 'Nouvel athlète, nouveau compte',
    nouveauAide: 'Un athlète et son compte de connexion d’un seul geste. Décoche l’un des deux pour créer l’autre seul, relié à ce qui existe déjà. Les allures sont celles du 10 km, en min/km.',
    creerQuoi: 'Créer', unAthlete: 'un athlète', unCompte: 'un compte de connexion',
    blocAthlete: 'L’athlète', blocCompte: 'Le compte',
    prenom: 'Prénom', actuelle: 'Allure 10 km actuelle', cible: 'Allure 10 km visée', debut: 'Début du plan',
    compteRelie: 'Relié au compte', nomCompte: 'Nom du compte',
    creer: 'Créer', cree: 'Créé', rienACreer: 'Coche au moins l’un des deux.',
    athletes: 'Athlètes', sansLogin: 'sans login',
    retirer: 'retirer',
  },
  pl: {
    chargement: 'Wczytywanie kont…',
    intro: 'Kto się loguje, z jaką rolą i którego zawodnika widzi. Konto się dezaktywuje, nie usuwa: to, co zapisało, zostaje przy nim.',
    comptes: 'Konta', aucun: 'Brak kont.',
    roles: { athlete: 'zawodnik', coach: 'trener', admin: 'admin' } as Record<Role, string>,
    rolesAide: 'Trener otwiera Ustawienia i Zawodników; admin także Konta i System.',
    actif: 'aktywne', inactif: 'wyłączone', sansMdp: 'bez hasła',
    aucunAthlete: 'nie widzi żadnego zawodnika',
    droits: { lecture: 'odczyt', ecriture: 'zapis' } as Record<Droit, string>,
    acces: 'Widoczni zawodnicy', aucunAcces: 'brak',
    nouveauMdp: 'Nowe hasło', mdpAide: 'Domyślnie co najmniej 12 znaków (Ustawienia · Bezpieczeństwo).',
    enregistrer: 'Zapisz', modifier: 'Edytuj', fermer: 'Zamknij', enregistre: 'Zapisano',
    activer: 'Włącz', desactiver: 'Wyłącz',
    email: 'E-mail', nom: 'Nazwisko', role: 'Rola', mdp: 'Hasło',
    relier: 'Powiązany z zawodnikiem', personne: '— brak —',
    nouveau: 'Nowy zawodnik, nowe konto',
    nouveauAide: 'Zawodnik i jego konto logowania jednym ruchem. Odznacz jedno z dwóch, by utworzyć tylko drugie, powiązane z tym, co już istnieje. Tempa dotyczą 10 km, w min/km.',
    creerQuoi: 'Utwórz', unAthlete: 'zawodnika', unCompte: 'konto logowania',
    blocAthlete: 'Zawodnik', blocCompte: 'Konto',
    prenom: 'Imię', actuelle: 'Obecne tempo 10 km', cible: 'Docelowe tempo 10 km', debut: 'Start planu',
    compteRelie: 'Powiązane z kontem', nomCompte: 'Nazwa konta',
    creer: 'Utwórz', cree: 'Utworzono', rienACreer: 'Zaznacz przynajmniej jedno z dwóch.',
    athletes: 'Zawodnicy', sansLogin: 'bez loginu',
    retirer: 'usuń',
  },
} satisfies Record<Lang, unknown>;

const ROLES: Role[] = ['athlete', 'coach', 'admin'];

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
  return (
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
      {aide && <span style={{ fontSize: 10.5, color: C.inkQuiet, lineHeight: 1.4 }}>{aide}</span>}
    </label>
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

/* ---------------------------------------------------------- le formulaire */

function Coche({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      aria-pressed={on}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 11px', borderRadius: R.md,
        border: `1px solid ${on ? C.accent : C.border}`, background: on ? C.accentSoft : C.surface,
        color: on ? C.accentDeep : C.inkSecondary, fontSize: 12, fontWeight: 600,
      }}
    >
      <Icon name={on ? 'check' : 'circle'} size={14} />
      {label}
    </button>
  );
}

function Bloc({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: 12, border: `1px solid ${C.border}` }}>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: C.inkSecondary }}>{titre}</div>
      {children}
    </div>
  );
}

/* Un athlète et son compte d'un seul geste. Décocher l'un crée l'autre seul,
   relié à ce qui existe déjà : un coach sans athlète, un athlète sans login,
   un login pour un athlète encodé avant. */
function Nouveau({
  comptes, athletes, lang, onCree,
}: {
  comptes: CompteAdmin[]; athletes: AthleteAdmin[]; lang: Lang;
  onCree: () => void;
}) {
  const t = T[lang];
  const [avecAthlete, setAvecAthlete] = useState(true);
  const [avecCompte, setAvecCompte] = useState(true);
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
  const [job, setJob] = useState<'idle' | 'saving' | 'fait'>('idle');
  const [erreur, setErreur] = useState<string | null>(null);

  const pretAthlete = !avecAthlete || (nom.trim() !== '' && actuelle.trim() !== '' && cible.trim() !== '');
  const pretCompte = !avecCompte || (email.trim() !== '' && mdp !== '' && (avecAthlete || nomCompte.trim() !== ''));
  const pret = (avecAthlete || avecCompte) && pretAthlete && pretCompte;

  const creer = async () => {
    setJob('saving'); setErreur(null);
    try {
      const r = await api.inscrire({
        athlete: avecAthlete ? { nom: nom.trim(), prenom: prenom.trim() || null, actuelle: actuelle.trim(), cible: cible.trim(), debut } : null,
        compte: avecCompte ? { email: email.trim(), nom: (avecAthlete ? [prenom.trim(), nom.trim()].filter(Boolean).join(' ') : nomCompte.trim()), role, mot_de_passe: mdp } : null,
        droit,
        compte_id: !avecCompte && compteId ? Number(compteId) : null,
        athlete_id: !avecAthlete && athleteId ? Number(athleteId) : null,
      });
      if (r.compte || r.athlete) onCree();
      setNom(''); setPrenom(''); setActuelle(''); setCible(''); setEmail(''); setNomCompte(''); setMdp('');
      setCompteId(''); setAthleteId(''); setRole('athlete');
      setJob('fait');
      setTimeout(() => setJob('idle'), 1500);
    } catch (e) {
      setErreur(message(e)); setJob('idle');
    }
  };

  return (
    <Card padding="16px 18px" gap={10}>
      <SectionLabel icon="plus" color={C.teal}>{t.nouveau}</SectionLabel>
      <div style={{ fontSize: 11.5, color: C.inkSecondary, lineHeight: 1.45 }}>{t.nouveauAide}</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: C.inkSecondary }}>{t.creerQuoi}</span>
        <Coche label={t.unAthlete} on={avecAthlete} onChange={setAvecAthlete} />
        <Coche label={t.unCompte} on={avecCompte} onChange={setAvecCompte} />
      </div>
      {!avecAthlete && !avecCompte && <div style={{ fontSize: 12, color: C.warning }}>{t.rienACreer}</div>}

      {avecAthlete && (
        <Bloc titre={t.blocAthlete}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Champ label={t.nom} value={nom} onChange={setNom} autoComplete="off" />
            <Champ label={t.prenom} value={prenom} onChange={setPrenom} autoComplete="off" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <Champ label={t.actuelle} value={actuelle} onChange={setActuelle} mono inputMode="decimal" aide="4:15" />
            <Champ label={t.cible} value={cible} onChange={setCible} mono inputMode="decimal" aide="3:50" />
            <Champ label={t.debut} value={debut} onChange={setDebut} type="date" mono />
          </div>
          {!avecCompte && (
            <Selection label={t.compteRelie} value={compteId} onChange={setCompteId} vide={t.personne}
              options={comptes.map((c) => ({ v: String(c.id), l: `${c.nom} · ${c.email}` }))} />
          )}
        </Bloc>
      )}

      {avecCompte && (
        <Bloc titre={t.blocCompte}>
          {!avecAthlete && <Champ label={t.nomCompte} value={nomCompte} onChange={setNomCompte} autoComplete="off" />}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Champ label={t.email} value={email} onChange={setEmail} type="email" inputMode="email" autoComplete="off" mono />
            <Champ label={t.mdp} value={mdp} onChange={setMdp} type="password" autoComplete="new-password" aide={t.mdpAide} />
          </div>
          <Choix<Role> label={t.role} options={ROLES.map((r) => ({ v: r, l: t.roles[r] }))} value={role} onChange={setRole} />
          <div style={{ fontSize: 10.5, color: C.inkQuiet, lineHeight: 1.4, marginTop: -4 }}>{t.rolesAide}</div>
          {!avecAthlete && (
            <Selection label={t.relier} value={athleteId} onChange={setAthleteId} vide={t.personne}
              options={athletes.map((a) => ({ v: String(a.id), l: a.nom }))} />
          )}
        </Bloc>
      )}

      {((avecAthlete && avecCompte) || (avecAthlete && compteId) || (avecCompte && athleteId)) && (
        <Choix<Droit> label={t.acces} options={[{ v: 'lecture', l: t.droits.lecture }, { v: 'ecriture', l: t.droits.ecriture }]} value={droit} onChange={setDroit} />
      )}

      <div>
        <button type="button" disabled={!pret || job === 'saving'} onClick={() => void creer()} style={{ ...BOUTON, opacity: pret ? 1 : 0.5 }}>
          {job === 'fait' ? t.cree : t.creer}
        </button>
      </div>
      <Erreur texte={erreur} />
    </Card>
  );
}

/* ---------------------------------------------------------------- l'écran */

export function ComptesScreen({ app }: { app: App }) {
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

      <Card padding="12px 16px" gap={0}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 6 }}>
          <Icon name="footprints" size={16} color={C.teal} />
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.teal }}>
            {`${t.athletes} · ${athletes.length}`}
          </div>
        </div>
        {athletes.map((a) => {
          const vus = comptes.filter((c) => c.athletes.some((x) => x.id === a.id));
          return (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: `1px solid ${C.borderSoft}` }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.ink }}>{a.nom}</div>
                <div style={{ fontSize: 11, color: C.inkQuiet, lineHeight: 1.4 }}>
                  {vus.length === 0 ? t.sansLogin : vus.map((c) => c.email).join(' · ')}
                </div>
              </div>
              <div style={{ fontFamily: F.mono, fontSize: 11, color: C.inkSecondary, whiteSpace: 'nowrap' }}>
                {`${mmss(a.ref_actuelle_s)} → ${mmss(a.ref_cible_s)}`}
              </div>
            </div>
          );
        })}
      </Card>

      <Nouveau
        comptes={comptes}
        athletes={athletes}
        lang={app.lang}
        /* Relire les deux listes : un compte créé avec son athlète, un athlète
           relié à un compte existant, un compte relié à un athlète — chaque cas
           touche les deux, et le serveur sait mieux que nous ce qu'il a écrit. */
        onCree={() => {
          void api.adminComptes().then((r) => { setComptes(r.comptes); setAthletes(r.athletes); });
        }}
      />
    </div>
  );
}
