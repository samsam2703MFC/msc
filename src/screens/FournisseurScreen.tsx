/* Le back office du fournisseur.

   Un sponsor se connecte et ne trouve que le sien : ses offres, ce qu'elles
   ont donné, et à qui il parle. Pas d'athlètes, pas de plans, pas de club —
   il n'a rien à y faire.

   Son audience est anonyme, et c'est voulu : il a besoin de savoir combien
   ils sont, quels sports ils font et de quelle génération ils sont, pas qui
   ils sont. Le seul nom qu'il voit est celui du gagnant, parce que c'est à
   lui qu'il remet le lot.

   Le « déclencheur » d'une offre, c'est sa règle : la part des séances de la
   semaine qu'il faut avoir faites pour participer. Zéro, et elle est ouverte
   à tout le monde. */

import { useEffect, useState } from 'react';
import * as api from '../data/api';
import type { OffreFournisseur, VueFournisseur } from '../data/api';
import type { Lang } from '../data/types';
import { C, F, R } from '../design/theme';
import { Icon } from '../components/Icon';
import { Card, SectionLabel } from '../components/primitives';
import type { App } from '../state/useApp';

const T = {
  fr: {
    chargement: 'Lecture de tes offres…',
    aucun: 'Ce compte ne tient aucun sponsor. Demande à l’admin du club de le relier au tien.',
    mesOffres: 'Mes offres', nouvelle: 'Nouvelle offre', aucuneOffre: 'Aucune offre pour l’instant.',
    titre: 'Titre', lot: 'Lot à gagner', voucher: 'Code (voucher)',
    regle: 'Déclencheur', regleAide: '% des séances de la semaine à avoir faites — 0 : ouverte à tous',
    debut: 'Début', fin: 'Fin', creer: 'Créer', tirer: 'Tirer au sort', tire: 'Tirage fait',
    vues: 'Vues', clics: 'Clics', parts: 'Participations', gagnant: 'Gagnant', ouverte: 'ouverte à tous',
    audience: 'Mon audience', athletes: 'athlètes dans le club', cliqueurs: 'ont cliqué vers ma boutique',
    sports: 'Leurs sports', ages: 'Leurs âges',
    anonyme: 'Cette audience est anonyme : des comptes, jamais des noms. Le seul nom que tu vois est celui du gagnant, à qui tu remets le lot.',
    boutique: 'Ma boutique', sansBoutique: 'Pas de boutique : ton code se montre chez toi.',
  },
  pl: {
    chargement: 'Wczytywanie twoich ofert…',
    aucun: 'To konto nie prowadzi żadnego sponsora. Poproś admina klubu o powiązanie.',
    mesOffres: 'Moje oferty', nouvelle: 'Nowa oferta', aucuneOffre: 'Brak ofert.',
    titre: 'Tytuł', lot: 'Nagroda', voucher: 'Kod (voucher)',
    regle: 'Wyzwalacz', regleAide: '% treningów tygodnia — 0: dla wszystkich',
    debut: 'Start', fin: 'Koniec', creer: 'Utwórz', tirer: 'Losuj', tire: 'Wylosowano',
    vues: 'Wyśw.', clics: 'Kliknięcia', parts: 'Udziały', gagnant: 'Zwycięzca', ouverte: 'dla wszystkich',
    audience: 'Moja publiczność', athletes: 'zawodników w klubie', cliqueurs: 'kliknęło do mojego sklepu',
    sports: 'Ich sporty', ages: 'Ich wiek',
    anonyme: 'Ta publiczność jest anonimowa: liczby, nigdy nazwiska. Jedyne nazwisko to zwycięzca, któremu wręczasz nagrodę.',
    boutique: 'Mój sklep', sansBoutique: 'Brak sklepu: kod pokazuje się u ciebie.',
  },
} satisfies Record<Lang, unknown>;

const ENTREE: React.CSSProperties = {
  width: '100%', minWidth: 0, boxSizing: 'border-box', padding: '8px 10px', borderRadius: R.md,
  border: `1px solid ${C.border}`, background: C.surface, color: C.ink, fontSize: 13, fontFamily: F.body,
};
const BOUTON: React.CSSProperties = {
  padding: '8px 13px', borderRadius: R.md, background: C.accent, color: C.accentInk,
  fontWeight: 700, fontSize: 12.5, border: 'none',
};
const BOUTON_SOBRE: React.CSSProperties = {
  padding: '6px 10px', borderRadius: R.md, border: `1px solid ${C.border}`,
  color: C.inkMuted, fontSize: 11.5, fontWeight: 600, background: C.surface,
};
const entete: React.CSSProperties = {
  textAlign: 'left', padding: '6px 8px', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em',
  textTransform: 'uppercase', color: C.inkSecondary, borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap',
};
const cellule: React.CSSProperties = {
  padding: '7px 8px', borderTop: `1px solid ${C.borderSoft}`, fontSize: 12.5, whiteSpace: 'nowrap',
};

function Champ({ label, value, onChange, type = 'text', aide, mono = false }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; aide?: string; mono?: boolean;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <span style={{ fontSize: 11, color: C.inkSecondary }}>{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
        style={{ ...ENTREE, fontFamily: mono ? F.mono : F.body }} />
      {aide && <span style={{ fontSize: 10.5, color: C.inkQuiet, lineHeight: 1.4 }}>{aide}</span>}
    </label>
  );
}

/* Une barre : ce que vaut une part, sans axe ni graduation — on compare des
   longueurs, pas des chiffres. */
function Barre({ nom, n, total }: { nom: string; n: number; total: number }) {
  const part = total > 0 ? n / total : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 12, color: C.inkBody, width: 108, flexShrink: 0 }}>{nom}</span>
      <div style={{ flex: 1, height: 8, borderRadius: R.full, background: C.surfaceAlt, overflow: 'hidden' }}>
        <div style={{ width: `${Math.round(part * 100)}%`, height: '100%', background: C.accent }} />
      </div>
      <span style={{ fontSize: 11.5, fontFamily: F.mono, color: C.inkSecondary, width: 28, textAlign: 'right' }}>{n}</span>
    </div>
  );
}

const aujourdhui = () => new Date().toISOString().slice(0, 10);
const dansUnMois = () => new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

export function FournisseurScreen({ app }: { app: App }) {
  const lang = app.lang;
  const t = T[lang];
  const [vue, setVue] = useState<VueFournisseur | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [titre, setTitre] = useState('');
  const [lot, setLot] = useState('');
  const [voucher, setVoucher] = useState('');
  const [regle, setRegle] = useState('0');
  const [debut, setDebut] = useState(aujourdhui());
  const [fin, setFin] = useState(dansUnMois());

  const relire = () => api.fournisseur().then((r) => { setVue(r); setErreur(null); })
    .catch((e) => setErreur(e instanceof Error ? e.message : String(e)));
  useEffect(() => { relire(); }, []);

  const creer = async () => {
    setErreur(null);
    try {
      await api.ecrireOffreFournisseur({ titre, lot, voucher, regle_pct: Number(regle), debut, fin });
      setTitre(''); setLot(''); setVoucher('');
      relire();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    }
  };
  const tirer = async (o: OffreFournisseur) => {
    setErreur(null);
    try { await api.tirerOffreFournisseur(o.id); relire(); }
    catch (e) { setErreur(e instanceof Error ? e.message : String(e)); }
  };

  if (!vue) {
    return (
      <div style={{ padding: '24px 20px', fontSize: 13, color: C.inkSecondary, lineHeight: 1.5 }}>
        {erreur ?? t.chargement}
      </div>
    );
  }

  const a = vue.audience;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '20px 18px 40px', maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: F.display, fontSize: 22, fontWeight: 600, color: C.ink }}>{vue.sponsor.nom}</span>
        {vue.sponsor.ville && <span style={{ fontSize: 13, color: C.inkSecondary }}>{vue.sponsor.ville}</span>}
      </div>
      <div style={{ fontSize: 12, color: C.inkSecondary }}>
        {vue.sponsor.url
          ? <>{`${t.boutique} : `}<span style={{ fontFamily: F.mono }}>{vue.sponsor.url}</span></>
          : t.sansBoutique}
      </div>

      {/* ce que ses offres ont donné */}
      <Card padding="14px 16px" gap={10}>
        <SectionLabel icon="gift" color={C.teal}>{t.mesOffres}</SectionLabel>
        {vue.offres.length === 0 && <div style={{ fontSize: 13, color: C.inkSecondary }}>{t.aucuneOffre}</div>}
        {vue.offres.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>{[t.titre, t.lot, t.voucher, t.regle, t.fin, t.vues, t.parts, t.clics, t.gagnant, ''].map((h, i) => (
                  <th key={i} style={entete}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {vue.offres.map((o) => (
                  <tr key={o.id}>
                    <td style={{ ...cellule, fontWeight: 600, color: C.ink }}>{o.titre}</td>
                    <td style={cellule}>{o.lot ?? '—'}</td>
                    <td style={{ ...cellule, fontFamily: F.mono }}>{o.voucher ?? '—'}</td>
                    <td style={cellule}>{o.regle_pct ? `${o.regle_pct} %` : t.ouverte}</td>
                    <td style={{ ...cellule, fontFamily: F.mono }}>{o.fin}</td>
                    <td style={{ ...cellule, fontFamily: F.mono }}>{o.vues}</td>
                    <td style={{ ...cellule, fontFamily: F.mono }}>{o.participations}</td>
                    <td style={{ ...cellule, fontFamily: F.mono, fontWeight: 700, color: C.accentDeep }}>{o.clics}</td>
                    <td style={cellule}>{o.gagnant ? o.gagnant.nom : '—'}</td>
                    <td style={{ ...cellule, textAlign: 'right' }}>
                      {o.tirage_le
                        ? <span style={{ fontSize: 11, color: C.inkQuiet }}>{t.tire}</span>
                        : (
                          <button type="button" disabled={o.participations === 0} onClick={() => void tirer(o)}
                            style={{ ...BOUTON_SOBRE, opacity: o.participations ? 1 : 0.5 }}>
                            {t.tirer}
                          </button>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', borderRadius: R.md, background: C.surfaceAlt, border: `1px solid ${C.border}` }}>
          <span style={{ fontSize: 11.5, fontWeight: 600, color: C.ink }}>{t.nouvelle}</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 8 }}>
            <Champ label={t.titre} value={titre} onChange={setTitre} />
            <Champ label={t.lot} value={lot} onChange={setLot} />
            <Champ label={t.voucher} value={voucher} onChange={setVoucher} mono />
            <Champ label={t.regle} value={regle} onChange={setRegle} type="number" aide={t.regleAide} mono />
            <Champ label={t.debut} value={debut} onChange={setDebut} type="date" mono />
            <Champ label={t.fin} value={fin} onChange={setFin} type="date" mono />
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" disabled={!titre.trim()} onClick={() => void creer()}
              style={{ ...BOUTON, opacity: titre.trim() ? 1 : 0.5 }}>{t.creer}</button>
            {erreur && <span style={{ fontSize: 12, color: C.negative }}>{erreur}</span>}
          </div>
        </div>
      </Card>

      {/* à qui il parle */}
      <Card padding="14px 16px" gap={10}>
        <SectionLabel icon="activity" color={C.teal}>{t.audience}</SectionLabel>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
          {[[a.athletes, t.athletes], [a.cliqueurs, t.cliqueurs]].map(([n, label]) => (
            <div key={String(label)} style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontFamily: F.display, fontSize: 26, fontWeight: 600, color: C.ink, lineHeight: 1.1 }}>{n}</span>
              <span style={{ fontSize: 11.5, color: C.inkSecondary }}>{label}</span>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: C.ink, marginTop: 4 }}>{t.sports}</div>
        {a.sports.map((x) => <Barre key={x.nom} nom={x.nom} n={x.n} total={a.athletes} />)}
        <div style={{ fontSize: 11.5, fontWeight: 600, color: C.ink, marginTop: 4 }}>{t.ages}</div>
        {a.ages.map((x) => <Barre key={x.tranche} nom={x.tranche} n={x.n} total={a.athletes} />)}
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 11, color: C.inkQuiet, lineHeight: 1.45, marginTop: 4 }}>
          <Icon name="info" size={12} />
          <span>{t.anonyme}</span>
        </div>
      </Card>
    </div>
  );
}
