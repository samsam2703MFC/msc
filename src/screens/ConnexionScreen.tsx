/* La connexion, l'inscription, et les deux écrans qui les entourent : le
   chargement, et l'échec.

   MySmartCoach est un service qu'on rejoint : un athlète qui installe
   l'application crée son compte ici même — qui il est, son email, son mot de
   passe, ses deux allures — et son coach est l'IA. L'admin peut fermer les
   inscriptions ou les garder derrière un code d'invitation (Réglages ·
   Sécurité). Pas de « mot de passe oublié » encore : c'est l'admin qui le
   remplace. */

import { useState } from 'react';
import type { Lang } from '../data/types';
import { C, F, R } from '../design/theme';
import { Icon } from '../components/Icon';

const T: Record<Lang, Record<string, string>> = {
  fr: {
    titre: 'MySmartCoach',
    sous: 'Connecte-toi pour retrouver ton plan.',
    sousInscription: 'Ton plan, ton coach, à partir de deux allures. Crée ton compte, le reste suit.',
    email: 'Adresse e-mail',
    motDePasse: 'Mot de passe',
    motDePasseAide: '12 caractères au moins.',
    prenom: 'Prénom',
    nom: 'Nom',
    actuelle: 'Allure 10 km actuelle',
    cible: 'Allure 10 km visée',
    alluresAide: 'En min/km, ce que tu tiens aujourd’hui sur 10 km, et ce que tu vises. Le plan part de là ; tu pourras les corriger.',
    code: 'Code d’invitation',
    codeAide: 'Seulement si on t’en a donné un.',
    entrer: 'Entrer',
    encours: 'Connexion…',
    creer: 'Créer mon compte',
    creation: 'Création…',
    versInscription: 'Pas encore de compte ? Créer mon compte',
    versConnexion: 'Déjà un compte ? Se connecter',
    chargement: 'Chargement de ton plan…',
    injoignable: 'Le serveur ne répond pas',
    reessayer: 'Réessayer',
  },
  pl: {
    titre: 'MySmartCoach',
    sous: 'Zaloguj się, aby wrócić do swojego planu.',
    sousInscription: 'Twój plan, twój trener, z dwóch temp. Załóż konto, reszta przyjdzie sama.',
    email: 'Adres e-mail',
    motDePasse: 'Hasło',
    motDePasseAide: 'Co najmniej 12 znaków.',
    prenom: 'Imię',
    nom: 'Nazwisko',
    actuelle: 'Obecne tempo 10 km',
    cible: 'Docelowe tempo 10 km',
    alluresAide: 'W min/km: ile trzymasz dziś na 10 km i do czego dążysz. Plan wychodzi stąd; potem możesz je poprawić.',
    code: 'Kod zaproszenia',
    codeAide: 'Tylko jeśli go dostałeś.',
    entrer: 'Wejdź',
    encours: 'Logowanie…',
    creer: 'Załóż konto',
    creation: 'Tworzenie…',
    versInscription: 'Nie masz konta? Załóż konto',
    versConnexion: 'Masz już konto? Zaloguj się',
    chargement: 'Wczytywanie planu…',
    injoignable: 'Serwer nie odpowiada',
    reessayer: 'Spróbuj ponownie',
  },
};

function allureOk(v: string): boolean {
  const m = v.trim().match(/^(\d{1,2}):([0-5]\d)$/);
  if (!m) return false;
  const n = Number(m[1]) * 60 + Number(m[2]);
  return n >= 120 && n <= 900;
}

const CADRE: React.CSSProperties = {
  minHeight: '100%',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 18,
  padding: '32px 26px',
  background: C.page,
};

const CHAMP: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  borderRadius: R.md,
  border: `1px solid ${C.border}`,
  background: C.surface,
  color: C.ink,
  padding: '12px 13px',
  fontFamily: F.body,
  fontSize: 15,
};

function Marque({ lang }: { lang: Lang }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <div
        style={{
          width: 52,
          height: 52,
          borderRadius: 14,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: C.accentSoft,
          border: `1px solid ${C.accent}`,
          color: C.accentDeep,
        }}
      >
        <Icon name="footprints" size={24} />
      </div>
      <div
        style={{
          fontFamily: F.display,
          fontSize: 21,
          fontWeight: 600,
          letterSpacing: '-0.01em',
          color: C.ink,
        }}
      >
        {T[lang].titre}
      </div>
    </div>
  );
}

export function ChargementScreen({ lang }: { lang: Lang }) {
  return (
    <div style={CADRE}>
      <Marque lang={lang} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.inkSecondary }}>
        <Icon name="loader" size={16} />
        <span style={{ fontSize: 13 }}>{T[lang].chargement}</span>
      </div>
    </div>
  );
}

export function PanneScreen({
  lang,
  erreur,
  onReessayer,
}: {
  lang: Lang;
  erreur: string | null;
  onReessayer: () => void;
}) {
  return (
    <div style={CADRE}>
      <Marque lang={lang} />
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 9,
          padding: '11px 13px',
          borderRadius: R.md,
          background: C.warningBg,
          color: C.warning,
          fontSize: 12,
          lineHeight: 1.45,
          maxWidth: 320,
        }}
      >
        <Icon name="triangle-alert" size={15} />
        <span>{erreur ?? T[lang].injoignable}</span>
      </div>
      <button
        type="button"
        onClick={onReessayer}
        style={{
          padding: '10px 20px',
          borderRadius: R.full,
          background: C.accent,
          color: C.accentInk,
          fontWeight: 600,
          fontSize: 14,
        }}
      >
        {T[lang].reessayer}
      </button>
    </div>
  );
}

function Champ({
  label, value, onChange, type = 'text', autoComplete, inputMode, aide, mono = false, optionnel = false,
}: {
  label: string; value: string; onChange: (v: string) => void; type?: string; autoComplete?: string;
  inputMode?: 'email' | 'decimal' | 'text'; aide?: string; mono?: boolean; optionnel?: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <span style={{ fontSize: 11, color: C.inkSecondary }}>{label}{optionnel ? '' : ''}</span>
        <input
          type={type}
          autoComplete={autoComplete}
          autoCapitalize={type === 'email' ? 'none' : undefined}
          inputMode={inputMode}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{ ...CHAMP, fontFamily: mono ? F.mono : F.body }}
        />
      </label>
      {aide && <span style={{ fontSize: 10.5, color: C.inkQuiet, lineHeight: 1.4 }}>{aide}</span>}
    </div>
  );
}

export function ConnexionScreen({
  lang,
  erreur,
  onConnexion,
  onInscription,
}: {
  lang: Lang;
  erreur: string | null;
  onConnexion: (email: string, motDePasse: string) => Promise<void>;
  onInscription?: (corps: {
    prenom: string; nom: string; email: string; mot_de_passe: string; actuelle: string; cible: string; code?: string;
  }) => Promise<void>;
}) {
  const t = T[lang];
  const [mode, setMode] = useState<'connexion' | 'inscription'>('connexion');
  const [email, setEmail] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [prenom, setPrenom] = useState('');
  const [nom, setNom] = useState('');
  const [actuelle, setActuelle] = useState('5:30');
  const [cible, setCible] = useState('5:00');
  const [code, setCode] = useState('');
  const [enCours, setEnCours] = useState(false);

  const inscription = mode === 'inscription';
  const pret = inscription
    ? nom.trim() !== '' && email.trim() !== '' && motDePasse.length >= 12 && allureOk(actuelle) && allureOk(cible) && !enCours
    : email.trim() !== '' && motDePasse !== '' && !enCours;

  const envoyer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pret) return;
    setEnCours(true);
    /* L'échec revient par `erreur` ; ici on ne fait que rendre le bouton. */
    const promesse = inscription && onInscription
      ? onInscription({ prenom: prenom.trim(), nom: nom.trim(), email: email.trim(), mot_de_passe: motDePasse, actuelle: actuelle.trim(), cible: cible.trim(), code: code.trim() || undefined })
      : onConnexion(email.trim(), motDePasse);
    void promesse.catch(() => {}).finally(() => setEnCours(false));
  };

  return (
    <form style={CADRE} onSubmit={envoyer}>
      <Marque lang={lang} />
      <div
        style={{ fontSize: 13, color: C.inkSecondary, textAlign: 'center', maxWidth: 280 }}
      >
        {inscription ? t.sousInscription : t.sous}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 320 }}>
        {inscription && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <Champ label={t.prenom} value={prenom} onChange={setPrenom} autoComplete="given-name" />
              <Champ label={t.nom} value={nom} onChange={setNom} autoComplete="family-name" />
            </div>
          </>
        )}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span style={{ fontSize: 11, color: C.inkSecondary }}>{t.email}</span>
          <input
            type="email"
            /* Le navigateur et le gestionnaire de mots de passe savent quoi
               proposer, et le téléphone n'ouvre pas le clavier majuscule. */
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={CHAMP}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span style={{ fontSize: 11, color: C.inkSecondary }}>{t.motDePasse}</span>
          <input
            type="password"
            autoComplete={inscription ? 'new-password' : 'current-password'}
            value={motDePasse}
            onChange={(e) => setMotDePasse(e.target.value)}
            style={CHAMP}
          />
        </label>
        {inscription && (
          <>
            <span style={{ fontSize: 10.5, color: C.inkQuiet, marginTop: -4 }}>{t.motDePasseAide}</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <Champ label={t.actuelle} value={actuelle} onChange={setActuelle} mono inputMode="decimal" />
              <Champ label={t.cible} value={cible} onChange={setCible} mono inputMode="decimal" />
            </div>
            <span style={{ fontSize: 10.5, color: C.inkQuiet, lineHeight: 1.4, marginTop: -4 }}>{t.alluresAide}</span>
            <Champ label={t.code} value={code} onChange={setCode} autoComplete="off" aide={t.codeAide} />
          </>
        )}

        {erreur && (
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              padding: '9px 11px',
              borderRadius: R.md,
              background: C.warningBg,
              color: C.warning,
              fontSize: 11,
              lineHeight: 1.45,
            }}
            role="alert"
          >
            <Icon name="triangle-alert" size={14} />
            <span>{erreur}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={!pret}
          style={{
            marginTop: 4,
            padding: '12px 20px',
            borderRadius: R.full,
            background: pret ? C.accent : C.surfaceAlt,
            color: pret ? C.accentInk : C.inkQuiet,
            fontWeight: 600,
            fontSize: 15,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          {enCours && <Icon name="loader" size={16} />}
          {enCours ? (inscription ? t.creation : t.encours) : inscription ? t.creer : t.entrer}
        </button>
        {onInscription && (
          <button
            type="button"
            onClick={() => setMode(inscription ? 'connexion' : 'inscription')}
            style={{ marginTop: 6, fontSize: 12, color: C.accentDeep, fontWeight: 600, background: 'none', border: 'none', textAlign: 'center' }}
          >
            {inscription ? t.versConnexion : t.versInscription}
          </button>
        )}
      </div>
      <div style={{ fontSize: 10, fontFamily: F.mono, color: C.inkQuiet, textAlign: 'center', marginTop: 4 }}>
        {`version ${__MSC_VERSION__}`}
      </div>
    </form>
  );
}
