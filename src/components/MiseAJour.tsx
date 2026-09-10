/* La mise à jour de l'application, dite plutôt que subie.

   Le service worker est en mode « prompt » : quand une nouvelle version est
   prête, elle attend. Ce bandeau le dit et laisse l'athlète recharger quand
   il veut — pas au milieu d'une note. Il se renseigne toutes les heures, et
   une première installation dit qu'elle est prête hors ligne, un instant. */

import { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import type { Lang } from '../data/types';
import { C, R } from '../design/theme';
import { Icon } from './Icon';

const UNE_HEURE = 60 * 60 * 1000;

const T: Record<Lang, { neuve: string; recharger: string; horsLigne: string }> = {
  fr: { neuve: 'Nouvelle version disponible', recharger: 'Recharger', horsLigne: 'Prête hors ligne' },
  pl: { neuve: 'Dostępna nowa wersja', recharger: 'Odśwież', horsLigne: 'Gotowa offline' },
};

export function MiseAJour({ lang }: { lang: Lang }) {
  const t = T[lang];
  const {
    needRefresh: [neuve],
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
    setTimeout(() => window.location.reload(), 3000);
  };

  if (neuve) {
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
