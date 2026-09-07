/* La connexion, et les deux écrans qui l'entourent : le chargement, et l'échec.

   MySmartCoach n'est pas un service qu'on rejoint — c'est le plan d'un athlète
   et le back office de son coach. Il n'y a donc pas d'inscription, pas de
   « mot de passe oublié », pas de porte à pousser : les comptes se créent en
   ligne de commande sur le serveur, et cet écran ne fait qu'ouvrir la porte à
   qui a déjà la clé. */

import { useState } from 'react';
import type { Lang } from '../data/types';
import { C, F, R } from '../design/theme';
import { Icon } from '../components/Icon';

const T: Record<Lang, Record<string, string>> = {
  fr: {
    titre: 'MySmartCoach',
    sous: 'Connecte-toi pour retrouver ton plan.',
    email: 'Adresse e-mail',
    motDePasse: 'Mot de passe',
    entrer: 'Entrer',
    encours: 'Connexion…',
    chargement: 'Chargement de ton plan…',
    injoignable: 'Le serveur ne répond pas',
    reessayer: 'Réessayer',
  },
  pl: {
    titre: 'MySmartCoach',
    sous: 'Zaloguj się, aby wrócić do swojego planu.',
    email: 'Adres e-mail',
    motDePasse: 'Hasło',
    entrer: 'Wejdź',
    encours: 'Logowanie…',
    chargement: 'Wczytywanie planu…',
    injoignable: 'Serwer nie odpowiada',
    reessayer: 'Spróbuj ponownie',
  },
};

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

export function ConnexionScreen({
  lang,
  erreur,
  onConnexion,
}: {
  lang: Lang;
  erreur: string | null;
  onConnexion: (email: string, motDePasse: string) => Promise<void>;
}) {
  const t = T[lang];
  const [email, setEmail] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [enCours, setEnCours] = useState(false);

  const pret = email.trim() !== '' && motDePasse !== '' && !enCours;

  const envoyer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pret) return;
    setEnCours(true);
    /* L'échec revient par `erreur` ; ici on ne fait que rendre le bouton. */
    void onConnexion(email.trim(), motDePasse).catch(() => {}).finally(() => setEnCours(false));
  };

  return (
    <form style={CADRE} onSubmit={envoyer}>
      <Marque lang={lang} />
      <div
        style={{ fontSize: 13, color: C.inkSecondary, textAlign: 'center', maxWidth: 280 }}
      >
        {t.sous}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 320 }}>
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
            autoComplete="current-password"
            value={motDePasse}
            onChange={(e) => setMotDePasse(e.target.value)}
            style={CHAMP}
          />
        </label>

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
          {enCours ? t.encours : t.entrer}
        </button>
      </div>
    </form>
  );
}
