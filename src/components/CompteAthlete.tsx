/* Le compte d'un athlète : son adresse, un mot de passe qu'on lui pose, son
   état — actif ou non — et le lien d'un seul usage.

   Un seul composant pour deux endroits : déplié sous sa ligne dans la liste
   des athlètes, et dans sa fiche, sous son profil. Les deux écrans posaient
   la même question — « comment il entre » — et deux versions auraient fini
   par diverger.

   Rien de neuf côté serveur : la route des comptes existait déjà, avec ses
   refus (une adresse prise ailleurs, le dernier admin actif, son propre
   compte qu'on ne peut pas se couper). Ce qu'elle répond s'affiche tel quel.

   L'adresse s'enregistre en sortant du champ, comme le calendrier ; le mot de
   passe demande un bouton, parce qu'on ne remplace pas un mot de passe par
   inadvertance. */

import { useCallback, useEffect, useState } from 'react';
import * as api from '../data/api';
import type { CompteAdmin } from '../data/api';
import type { Lang } from '../data/types';
import { C, F, R } from '../design/theme';

const T: Record<Lang, Record<string, string>> = {
  fr: {
    titre: 'Son compte', email: 'E-mail', mdp: 'Nouveau mot de passe', definir: 'Définir',
    etat: 'État', desactiver: 'Désactiver', reactiver: 'Réactiver', lien: 'Lien', lienEnCours: '…',
    copie: 'Lien copié — à usage unique, envoie-le-lui', enregistre: 'Enregistré',
    chargement: 'Lecture du compte…',
    sans: 'Pas de compte : crée-le dans l’onboarding, au bas de la liste des athlètes.',
  },
  pl: {
    titre: 'Jego konto', email: 'E-mail', mdp: 'Nowe hasło', definir: 'Ustaw',
    etat: 'Stan', desactiver: 'Wyłącz', reactiver: 'Włącz', lien: 'Link', lienEnCours: '…',
    copie: 'Link skopiowany — jednorazowy, wyślij mu go', enregistre: 'Zapisane',
    chargement: 'Wczytywanie konta…',
    sans: 'Brak konta: utwórz je w asystencie, na dole listy zawodników.',
  },
};

/* Le compte d'un athlète, c'est celui qui ne voit que lui. Un compte qui en
   voit plusieurs — l'admin, un coach — n'est celui de personne : le prendre
   pour son login collait la même adresse sur toute la liste, et couper « son »
   compte aurait coupé tout le club. En écriture d'abord, s'il y en a deux. */
export function compteDeLAthlete(comptes: CompteAdmin[], athleteId: number): CompteAdmin | null {
  const siens = comptes.filter((c) => c.athletes.length === 1 && c.athletes[0].id === athleteId);
  return siens.find((c) => c.athletes[0].droit === 'ecriture') ?? siens[0] ?? null;
}

export function CompteAthlete({ athleteId, lang, onChange }: {
  athleteId: number;
  lang: Lang;
  /** Prévenir l'écran qui affiche déjà ce compte ailleurs (la colonne de la liste). */
  onChange?: () => void;
}) {
  const t = T[lang];
  const [comptes, setComptes] = useState<CompteAdmin[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [mdp, setMdp] = useState('');
  const [job, setJob] = useState<'idle' | 'lien'>('idle');

  const relire = useCallback(() => {
    api.adminComptes().then((r) => setComptes(r.comptes)).catch(() => setComptes([]));
  }, []);
  useEffect(() => { relire(); }, [relire, athleteId]);

  const compte = comptes ? compteDeLAthlete(comptes, athleteId) : null;

  const ecrire = async (corps: { email?: string; mot_de_passe?: string; actif?: boolean }) => {
    if (!compte) return;
    setMessage(null);
    try {
      const r = await api.majCompte(compte.id, corps);
      setMessage(`${t.enregistre} — ${r.compte.email}`);
      relire();
      onChange?.();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };

  const envoyerLien = async () => {
    if (!compte) return;
    setJob('lien'); setMessage(null);
    try {
      const r = await api.lienDeConnexion(compte.id);
      const url = `${window.location.origin}${import.meta.env.BASE_URL}?lien=${r.jeton}`;
      /* Le presse-papiers n'existe qu'en HTTPS : ailleurs, ou s'il refuse, le
         lien s'affiche en entier plutôt que de prétendre qu'il est copié. */
      let copie = false;
      try { await navigator.clipboard.writeText(url); copie = true; } catch { copie = false; }
      setMessage(copie ? `${t.copie} — ${r.email}` : `${r.email} · ${url}`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setJob('idle');
    }
  };

  if (!comptes) return <div style={{ fontSize: 12, color: C.inkQuiet }}>{t.chargement}</div>;
  if (!compte) return <div style={{ fontSize: 12, color: C.inkQuiet, lineHeight: 1.45 }}>{t.sans}</div>;

  const champ: React.CSSProperties = {
    border: `1px solid ${C.border}`, borderRadius: R.md, padding: '6px 9px',
    fontSize: 12.5, fontFamily: F.mono, background: C.surface, color: C.ink,
    minWidth: 180, maxWidth: '100%',
  };
  const etiquette: React.CSSProperties = {
    fontSize: 10, fontWeight: 600, letterSpacing: '0.06em',
    textTransform: 'uppercase', color: C.inkSecondary,
  };
  const bouton: React.CSSProperties = {
    padding: '6px 10px', borderRadius: R.full, fontSize: 11, fontWeight: 600,
    border: `1px solid ${C.border}`, background: C.surface, color: C.inkSecondary,
    whiteSpace: 'nowrap',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div role="group" aria-label={t.titre} style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={etiquette}>{t.email}</span>
          <input
            type="email"
            defaultValue={compte.email}
            aria-label={`${t.email} · ${compte.email}`}
            style={champ}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== compte.email) void ecrire({ email: v });
            }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={etiquette}>{t.mdp}</span>
          <span style={{ display: 'flex', gap: 6 }}>
            <input
              type="password"
              value={mdp}
              autoComplete="new-password"
              aria-label={`${t.mdp} · ${compte.email}`}
              style={champ}
              onChange={(e) => setMdp(e.target.value)}
            />
            <button
              type="button" style={bouton} disabled={mdp.length === 0}
              onClick={() => { const v = mdp; setMdp(''); void ecrire({ mot_de_passe: v }); }}
            >
              {t.definir}
            </button>
          </span>
        </label>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={etiquette}>{t.etat}</span>
          <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button type="button" style={bouton} onClick={() => void ecrire({ actif: !compte.actif })}>
              {compte.actif ? t.desactiver : t.reactiver}
            </button>
            {compte.actif && (
              <button type="button" style={bouton} disabled={job === 'lien'} onClick={() => void envoyerLien()}>
                {job === 'lien' ? t.lienEnCours : t.lien}
              </button>
            )}
          </span>
        </span>
      </div>
      {message && (
        <div style={{ fontSize: 11.5, color: C.inkSecondary, lineHeight: 1.4, fontFamily: F.mono, wordBreak: 'break-all' }}>{message}</div>
      )}
    </div>
  );
}
