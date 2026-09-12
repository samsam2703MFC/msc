/* Poser son mot de passe.

   Deux chemins y mènent, et c'est le même écran : l'athlète qui vient d'entrer
   par un lien de connexion — le lien ne vaut qu'une fois, alors il lui faut un
   mot de passe pour la prochaine —, et celui qui veut simplement changer le
   sien depuis Paramètres.

   Personne d'autre ne le connaît. L'admin engendre un lien, il ne lit pas un
   mot de passe et n'en pose pas un à la place de l'athlète : c'est la seule
   façon qu'un mot de passe reste à celui à qui il appartient. */

import { useState } from 'react';
import * as db from '../data/db';
import type { Lang } from '../data/types';
import { C, F, R } from '../design/theme';
import { Icon } from './Icon';
import { Sheet } from './Sheet';

const T: Record<Lang, Record<string, string>> = {
  fr: {
    titre: 'Pose ton mot de passe',
    apresLien: 'Tu es entré par un lien : il ne vaut qu’une fois. Choisis un mot de passe pour la prochaine fois.',
    changer: 'Change ton mot de passe. Il ne s’affiche jamais nulle part, pas même à l’admin.',
    champ: 'Nouveau mot de passe', confirmation: 'Encore une fois',
    min: 'caractères au moins', different: 'Les deux ne sont pas identiques.',
    enregistrer: 'Enregistrer', enCours: 'Enregistrement…', plusTard: 'Plus tard',
    fait: 'C’est fait.',
  },
  pl: {
    titre: 'Ustaw hasło',
    apresLien: 'Wszedłeś przez link: działa tylko raz. Wybierz hasło na następny raz.',
    changer: 'Zmień hasło. Nigdzie się nie wyświetla, nawet adminowi.',
    champ: 'Nowe hasło', confirmation: 'Jeszcze raz',
    min: 'znaków minimum', different: 'Oba nie są identyczne.',
    enregistrer: 'Zapisz', enCours: 'Zapisywanie…', plusTard: 'Później',
    fait: 'Gotowe.',
  },
};

const ENTREE: React.CSSProperties = {
  width: '100%', minWidth: 0, boxSizing: 'border-box',
  padding: '11px 12px', borderRadius: R.md, border: `1px solid ${C.border}`,
  background: C.surface, color: C.ink, fontSize: 15, fontFamily: F.body,
};

export function MotDePasseSheet({
  lang, zIndex, apresLien, onEnregistrer, onFermer,
}: {
  lang: Lang;
  zIndex: number;
  /** Vrai quand on arrive d'un lien de connexion : le texte le dit. */
  apresLien?: boolean;
  onEnregistrer: (motDePasse: string) => Promise<void>;
  onFermer: () => void;
}) {
  const t = T[lang];
  const [mdp, setMdp] = useState('');
  const [encore, setEncore] = useState('');
  const [job, setJob] = useState<'idle' | 'saving'>('idle');
  const [erreur, setErreur] = useState<string | null>(null);
  const min = db.param('securite.mdp_min', 12);

  const assezLong = mdp.length >= min;
  const identiques = mdp === encore;
  const pret = assezLong && identiques && job === 'idle';

  const envoyer = async () => {
    setJob('saving'); setErreur(null);
    try {
      await onEnregistrer(mdp);
      onFermer();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
      setJob('idle');
    }
  };

  return (
    <Sheet onClose={onFermer} zIndex={zIndex} label={t.titre} gap={12}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <Icon name="user" size={18} color={C.teal} />
        <span style={{ fontFamily: F.display, fontWeight: 700, fontSize: 19, color: C.ink }}>{t.titre}</span>
      </div>
      <div style={{ fontSize: 13, color: C.inkSecondary, lineHeight: 1.5 }}>
        {apresLien ? t.apresLien : t.changer}
      </div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <span style={{ fontSize: 11.5, color: C.inkSecondary }}>{t.champ}</span>
        <input
          type="password" value={mdp} autoComplete="new-password"
          onChange={(e) => setMdp(e.target.value)} style={ENTREE}
        />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <span style={{ fontSize: 11.5, color: C.inkSecondary }}>{t.confirmation}</span>
        <input
          type="password" value={encore} autoComplete="new-password"
          onChange={(e) => setEncore(e.target.value)} style={ENTREE}
        />
      </label>

      <div style={{ fontSize: 11.5, color: encore && !identiques ? C.warning : C.inkQuiet, lineHeight: 1.4 }}>
        {encore && !identiques ? t.different : `${min} ${t.min}`}
      </div>
      {erreur && <div style={{ fontSize: 12.5, color: C.negative, lineHeight: 1.4 }}>{erreur}</div>}

      <button
        type="button"
        disabled={!pret}
        onClick={() => void envoyer()}
        style={{
          padding: '13px 14px', borderRadius: R.md, border: 'none',
          background: C.accent, color: C.accentInk, fontWeight: 700, fontSize: 15,
          opacity: pret ? 1 : 0.5,
        }}
      >
        {job === 'saving' ? t.enCours : t.enregistrer}
      </button>
      <button
        type="button"
        onClick={onFermer}
        style={{
          padding: '10px 14px', borderRadius: R.md, border: 'none',
          background: 'transparent', color: C.inkSecondary, fontSize: 13,
        }}
      >
        {t.plusTard}
      </button>
    </Sheet>
  );
}
