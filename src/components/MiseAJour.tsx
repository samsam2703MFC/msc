/* La mise à jour de l'application, dite plutôt que subie.

   Le service worker est en mode « prompt » : quand une nouvelle version est
   prête, elle attend. Ce bandeau le dit et laisse l'athlète recharger quand
   il veut — pas au milieu d'une note. Il se renseigne toutes les heures, et
   une première installation dit qu'elle est prête hors ligne, un instant. */

import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import type { Lang } from '../data/types';
import { C, R } from '../design/theme';
import { Icon } from './Icon';

const UNE_HEURE = 60 * 60 * 1000;
const BASE = import.meta.env?.BASE_URL ?? '/';

/* Sans HTTPS il n'y a pas de service worker, donc personne pour dire qu'une
   version plus récente attend : une page ouverte depuis l'écran d'accueil
   peut vivre des jours. L'application le demande donc elle-même au serveur —
   version.txt, jamais mis en cache — à l'ouverture, quand elle revient au
   premier plan, et toutes les demi-heures. */
function useVersionDistante(): boolean {
  const [neuve, setNeuve] = useState(false);
  useEffect(() => {
    let vivant = true;
    const verifier = async () => {
      try {
        const r = await fetch(`${BASE}version.txt?t=${Date.now()}`, { cache: 'no-store' });
        if (!r.ok) return;
        const distante = (await r.text()).trim();
        if (vivant && distante && distante !== __MSC_VERSION__) setNeuve(true);
      } catch { /* hors ligne : on ne dit rien */ }
    };
    void verifier();
    const auRetour = () => { if (document.visibilityState === 'visible') void verifier(); };
    document.addEventListener('visibilitychange', auRetour);
    const t = setInterval(verifier, UNE_HEURE / 2);
    return () => { vivant = false; document.removeEventListener('visibilitychange', auRetour); clearInterval(t); };
  }, []);
  return neuve;
}

const T: Record<Lang, { neuve: string; recharger: string; horsLigne: string }> = {
  fr: { neuve: 'Nouvelle version disponible', recharger: 'Recharger', horsLigne: 'Prête hors ligne' },
  pl: { neuve: 'Dostępna nowa wersja', recharger: 'Odśwież', horsLigne: 'Gotowa offline' },
};

export function MiseAJour({ lang }: { lang: Lang }) {
  const t = T[lang];
  const neuveDistante = useVersionDistante();
  const {
    needRefresh: [neuveSW],
    offlineReady: [horsLigne, setHorsLigne],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, enregistrement) {
      if (!enregistrement) return;
      setInterval(() => { void enregistrement.update(); }, UNE_HEURE);
    },
  });

  /* « Prête hors ligne » s'efface seule : c'est une bonne nouvelle, pas une
     consigne. */
  useEffect(() => {
    if (!horsLigne) return undefined;
    const t = setTimeout(() => setHorsLigne(false), 4000);
    return () => clearTimeout(t);
  }, [horsLigne, setHorsLigne]);

  /* Recharger : on dit au service worker en attente de prendre la main, et on
     recharge dès qu'il l'a — soi-même, parce qu'une mise à jour trouvée par
     `update()` toutes les heures est « externe » pour workbox-window, qui ne
     recharge alors pas de lui-même. Et si rien ne vient, on recharge quand
     même : la nouvelle version est déjà là. */
  const recharger = () => {
    navigator.serviceWorker?.addEventListener('controllerchange', () => window.location.reload(), { once: true });
    void updateServiceWorker(true);
    setTimeout(() => window.location.reload(), neuveSW ? 3000 : 0);
  };

  if (neuveSW || neuveDistante) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, color: C.accentDeep }}>
        <Icon name="download" size={12} />
        <span>{t.neuve}</span>
        <button
          type="button"
          onClick={recharger}
          style={{
            padding: '2px 8px', borderRadius: R.full, background: C.accent, color: C.accentInk,
            fontSize: 10, fontWeight: 700, border: 'none',
          }}
        >
          {t.recharger}
        </button>
      </div>
    );
  }
  if (horsLigne) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: C.accentDeep }}>
        <Icon name="circle-check" size={12} />
        <span>{t.horsLigne}</span>
      </div>
    );
  }
  return null;
}
