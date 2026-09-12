/* Les partenaires, dans le téléphone de l'athlète.

   Une carte par offre en cours : qui offre, ce qu'on gagne, ce qu'il faut
   avoir fait pour participer — et le bon d'achat, un code à montrer, avec le
   lien vers la boutique quand il y en a un. Un kiné n'a pas de boutique : son
   code se montre au cabinet, et la carte ne propose pas de lien qui n'existe
   pas.

   La règle de participation se lit sur le plan : « 80 % de tes séances de la
   semaine », et la carte dit où on en est. Ce n'est pas une case à cocher,
   c'est ce que l'athlète a fait. Rien n'est stocké ici : tout vient de
   /api/partenaires, et chaque geste y retourne. */

import { useEffect, useState } from 'react';
import * as api from '../data/api';
import * as db from '../data/db';
import type { Lang } from '../data/types';
import { C, F, R } from '../design/theme';
import { Icon } from './Icon';
import { Card, Mono, SectionLabel } from './primitives';
import type { App } from '../state/useApp';

const T: Record<Lang, Record<string, string>> = {
  fr: {
    titre: 'Partenaires', aGagner: 'À gagner', participer: 'Participer', participe: 'Tu participes',
    gagne: 'Tu as gagné !', tire: 'Tirage fait', regle: 'Pour participer :', seances: 'de tes séances de la semaine faites',
    tuEsA: 'tu es à', ouvert: 'ouvert à tout le monde', code: 'Ton code', boutique: 'Voir la boutique',
    montre: 'Montre ce code chez lui.', jusquau: 'jusqu’au',
  },
  pl: {
    titre: 'Partnerzy', aGagner: 'Do wygrania', participer: 'Biorę udział', participe: 'Bierzesz udział',
    gagne: 'Wygrałeś!', tire: 'Losowanie odbyte', regle: 'Aby wziąć udział:', seances: 'treningów tygodnia zrobionych',
    tuEsA: 'masz', ouvert: 'dla wszystkich', code: 'Twój kod', boutique: 'Zobacz sklep',
    montre: 'Pokaż ten kod u niego.', jusquau: 'do',
  },
};

export function Partenaires({ app }: { app: App }) {
  const lang = app.lang;
  const t = T[lang];
  const [donnees, setDonnees] = useState<Awaited<ReturnType<typeof api.partenaires>> | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const relire = () => api.partenaires().then(setDonnees).catch(() => setDonnees(null));

  useEffect(() => {
    let vivant = true;
    api.partenaires()
      .then((r) => {
        if (!vivant) return;
        setDonnees(r);
        /* Une vue par offre affichée — le serveur n'en compte qu'une par jour. */
        for (const o of r.offres) void api.noterPartenaire({ sponsor_id: o.sponsor.id, offre_id: o.id, type: 'vue' }).catch(() => undefined);
      })
      .catch(() => { if (vivant) setDonnees(null); });
    return () => { vivant = false; };
  }, [app.version]);

  if (!donnees || donnees.offres.length === 0) return null;

  const participer = async (offreId: number) => {
    setErreur(null);
    try {
      await api.participer(offreId);
      await relire();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    }
  };

  const boutique = (o: typeof donnees.offres[number]) => {
    if (!o.sponsor.url) return;
    void api.noterPartenaire({ sponsor_id: o.sponsor.id, offre_id: o.id, type: 'clic' }).catch(() => undefined);
    window.open(o.sponsor.url, '_blank', 'noopener');
  };

  return (
    <Card padding="14px 16px" gap={12}>
      <SectionLabel icon="gift" color={C.teal}>{t.titre}</SectionLabel>
      {donnees.offres.map((o) => {
        const fin = new Date(`${o.fin}T00:00:00`).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'pl-PL', { day: 'numeric', month: 'short' });
        return (
          <div key={o.id} style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 8, borderTop: `1px solid ${C.borderSoft}` }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: C.ink }}>
                {o.sponsor.nom}{o.sponsor.ville ? <span style={{ fontWeight: 500, color: C.inkSecondary }}> · {o.sponsor.ville}</span> : null}
              </span>
              <Mono size={10.5} color={C.inkQuiet}>{`${t.jusquau} ${fin}`}</Mono>
            </div>
            <div style={{ fontSize: 13, color: C.inkBody, lineHeight: 1.4 }}>{o.titre}</div>
            {o.lot && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: C.accentDeep, fontWeight: 600 }}>
                <Icon name="gift" size={14} />
                {`${t.aGagner} : ${o.lot}`}
              </div>
            )}

            {/* la règle, et où il en est — lue sur le plan, pas déclarée */}
            <div style={{ fontSize: 11.5, color: C.inkSecondary, lineHeight: 1.4 }}>
              {o.regle_pct > 0
                ? `${t.regle} ${o.regle_pct} % ${t.seances} — ${t.tuEsA} ${donnees.semaine.part} % (${donnees.semaine.faites}/${donnees.semaine.prevues}).`
                : `${t.regle} ${t.ouvert}.`}
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {o.gagnant ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 11px', borderRadius: R.full, background: C.accentSoft, color: C.accentDeep, fontWeight: 700, fontSize: 12.5 }}>
                  <Icon name="circle-check" size={14} />
                  {t.gagne}
                </span>
              ) : o.tire ? (
                <span style={{ fontSize: 12, color: C.inkQuiet }}>{t.tire}</span>
              ) : o.participe ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: C.accentDeep, fontWeight: 600 }}>
                  <Icon name="circle-check" size={14} />
                  {t.participe}
                </span>
              ) : (
                <button
                  type="button"
                  disabled={!o.eligible || db.droit !== 'ecriture'}
                  onClick={() => void participer(o.id)}
                  style={{
                    padding: '8px 13px', borderRadius: R.full, border: 'none', fontSize: 12.5, fontWeight: 700,
                    background: C.accent, color: C.accentInk, opacity: o.eligible && db.droit === 'ecriture' ? 1 : 0.45,
                  }}
                >
                  {t.participer}
                </button>
              )}
            </div>

            {o.voucher && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', borderRadius: R.md, background: C.surfaceAlt, border: `1px dashed ${C.border}`, flexWrap: 'wrap' }}>
                <Icon name="ticket" size={16} color={C.teal} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 10.5, color: C.inkQuiet }}>{t.code}</span>
                  <span style={{ fontFamily: F.mono, fontSize: 15, fontWeight: 700, color: C.ink, letterSpacing: '0.06em' }}>{o.voucher}</span>
                  {!o.sponsor.url && <span style={{ fontSize: 10.5, color: C.inkQuiet }}>{t.montre}</span>}
                </div>
                {o.sponsor.url && (
                  <button
                    type="button"
                    onClick={() => boutique(o)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 11px', borderRadius: R.full,
                      border: `1px solid ${C.accent}`, background: C.surface, color: C.accentDeep, fontSize: 12, fontWeight: 600,
                    }}
                  >
                    <Icon name="external-link" size={13} />
                    {t.boutique}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
      {erreur && <div style={{ fontSize: 12, color: C.negative }}>{erreur}</div>}
    </Card>
  );
}
