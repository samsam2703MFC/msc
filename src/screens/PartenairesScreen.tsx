/* Les partenaires, dans le back office.

   Les sponsors et leurs offres — un lot, un code, une règle, des dates — le
   tirage au sort d'un bouton, et l'analyse : ce que chaque sponsor a reçu
   (vues, participations, gagnants, clics vers sa boutique) et ce que chaque
   athlète en fait. C'est ce qui se montre à un sponsor quand on lui demande
   de remettre un lot le mois prochain. */

import { useEffect, useState } from 'react';
import * as api from '../data/api';
import type { AnalysePartenaires, Offre, SponsorAvecOffres } from '../data/api';
import type { Lang } from '../data/types';
import { C, F, R } from '../design/theme';
import { Icon } from '../components/Icon';
import { Card, SectionLabel } from '../components/primitives';
import type { App } from '../state/useApp';

const T = {
  fr: {
    chargement: 'Lecture des partenaires…',
    intro: 'Un sponsor local met un lot en jeu ; les athlètes participent en s’entraînant ; tu tires au sort. Le bon d’achat — un code, et sa boutique s’il en a une — se voit dans leur application. Ce qui se compte : les vues, les participations, les gagnants, les clics vers la boutique.',
    sponsors: 'Sponsors', aucun: 'Aucun sponsor encore.', nouveau: 'Nouveau sponsor', nom: 'Nom', ville: 'Ville',
    url: 'Boutique (adresse)', urlAide: 'Facultatif : un kiné n’a pas de boutique, son code se montre au cabinet.',
    compte: 'Son compte (id)', compteAide: 'Le compte fournisseur qui tient ce sponsor : il se connecte et ne voit que ses offres et une audience anonyme. Crée-le dans Comptes, rôle « fournisseur », puis pose son id ici.',
    creer: 'Créer', enregistrer: 'Enregistrer', actif: 'actif', inactif: 'inactif', desactiver: 'Désactiver', activer: 'Réactiver',
    offres: 'Offres', aucuneOffre: 'Aucune offre.', nouvelleOffre: 'Nouvelle offre', titre: 'Titre', lot: 'Lot à gagner',
    voucher: 'Code (voucher)', regle: 'Séances faites requises', regleAide: '% des séances de la semaine — 0 : tout le monde peut participer',
    debut: 'Début', fin: 'Fin', participations: 'participations', tirer: 'Tirer au sort', tire: 'Tirage fait', gagnant: 'gagnant',
    analyse: 'Analyse', parSponsor: 'Par sponsor', parAthlete: 'Par athlète', vues: 'Vues', clics: 'Clics', gagnants: 'Gagnants',
    gagnes: 'Gagnés', dernierClic: 'Dernier clic', athlete: 'Athlète', sponsor: 'Sponsor', personne: 'personne',
  },
  pl: {
    chargement: 'Wczytywanie partnerów…',
    intro: 'Lokalny sponsor daje nagrodę; zawodnicy biorą udział trenując; ty losujesz. Voucher — kod i sklep, jeśli go ma — widać w ich aplikacji. Liczymy: wyświetlenia, udziały, zwycięzców, kliknięcia do sklepu.',
    sponsors: 'Sponsorzy', aucun: 'Brak sponsorów.', nouveau: 'Nowy sponsor', nom: 'Nazwa', ville: 'Miasto',
    url: 'Sklep (adres)', urlAide: 'Opcjonalnie: fizjo nie ma sklepu, kod pokazuje się w gabinecie.',
    compte: 'Jego konto (id)', compteAide: 'Konto dostawcy prowadzące tego sponsora: loguje się i widzi tylko swoje oferty i anonimową publiczność. Utwórz je w Kontach, rola „fournisseur”, i wpisz tu id.',
    creer: 'Utwórz', enregistrer: 'Zapisz', actif: 'aktywny', inactif: 'nieaktywny', desactiver: 'Wyłącz', activer: 'Włącz',
    offres: 'Oferty', aucuneOffre: 'Brak ofert.', nouvelleOffre: 'Nowa oferta', titre: 'Tytuł', lot: 'Nagroda',
    voucher: 'Kod (voucher)', regle: 'Wymagane treningi', regleAide: '% treningów tygodnia — 0: każdy może wziąć udział',
    debut: 'Start', fin: 'Koniec', participations: 'udziałów', tirer: 'Losuj', tire: 'Wylosowano', gagnant: 'zwycięzca',
    analyse: 'Analiza', parSponsor: 'Wg sponsora', parAthlete: 'Wg zawodnika', vues: 'Wyśw.', clics: 'Kliknięcia', gagnants: 'Zwycięzcy',
    gagnes: 'Wygrane', dernierClic: 'Ostatnie kliknięcie', athlete: 'Zawodnik', sponsor: 'Sponsor', personne: 'nikt',
  },
} satisfies Record<Lang, unknown>;

const ENTREE: React.CSSProperties = {
  width: '100%', minWidth: 0, boxSizing: 'border-box', padding: '8px 10px', borderRadius: R.md,
  border: `1px solid ${C.border}`, background: C.surface, color: C.ink, fontSize: 13, fontFamily: F.body,
};
const BOUTON: React.CSSProperties = {
  padding: '7px 12px', borderRadius: R.md, background: C.accent, color: C.accentInk, fontWeight: 700, fontSize: 12, border: 'none',
};
const BOUTON_SOBRE: React.CSSProperties = {
  padding: '7px 12px', borderRadius: R.md, border: `1px solid ${C.border}`, color: C.inkMuted, fontSize: 12, fontWeight: 600, background: C.surface,
};
const entete: React.CSSProperties = {
  textAlign: 'left', padding: '6px 8px', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em',
  textTransform: 'uppercase', color: C.inkSecondary, borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap',
};
const cellule: React.CSSProperties = { padding: '7px 8px', borderTop: `1px solid ${C.borderSoft}`, fontSize: 12.5, whiteSpace: 'nowrap' };

function Champ({ label, value, onChange, type = 'text', aide, mono = false }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; aide?: string; mono?: boolean;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <span style={{ fontSize: 11, color: C.inkSecondary }}>{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} style={{ ...ENTREE, fontFamily: mono ? F.mono : F.body }} />
      {aide && <span style={{ fontSize: 10.5, color: C.inkQuiet, lineHeight: 1.4 }}>{aide}</span>}
    </label>
  );
}

const aujourdhui = () => new Date().toISOString().slice(0, 10);
const dansUnMois = () => new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

function FormulaireOffre({ sponsorId, t, onFait }: { sponsorId: number; t: typeof T.fr; onFait: () => void }) {
  const [titre, setTitre] = useState('');
  const [lot, setLot] = useState('');
  const [voucher, setVoucher] = useState('');
  const [regle, setRegle] = useState('0');
  const [debut, setDebut] = useState(aujourdhui());
  const [fin, setFin] = useState(dansUnMois());
  const [erreur, setErreur] = useState<string | null>(null);
  const envoyer = async () => {
    setErreur(null);
    try {
      await api.ecrireOffre({ sponsor_id: sponsorId, titre, lot, voucher, regle_pct: Number(regle), debut, fin });
      setTitre(''); setLot(''); setVoucher('');
      onFait();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', borderRadius: R.md, background: C.surfaceAlt, border: `1px solid ${C.border}` }}>
      <span style={{ fontSize: 11.5, fontWeight: 600, color: C.ink }}>{t.nouvelleOffre}</span>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
        <Champ label={t.titre} value={titre} onChange={setTitre} />
        <Champ label={t.lot} value={lot} onChange={setLot} />
        <Champ label={t.voucher} value={voucher} onChange={setVoucher} mono />
        <Champ label={t.regle} value={regle} onChange={setRegle} type="number" aide={t.regleAide} mono />
        <Champ label={t.debut} value={debut} onChange={setDebut} type="date" mono />
        <Champ label={t.fin} value={fin} onChange={setFin} type="date" mono />
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button type="button" disabled={!titre.trim()} onClick={() => void envoyer()} style={{ ...BOUTON, opacity: titre.trim() ? 1 : 0.5 }}>{t.creer}</button>
        {erreur && <span style={{ fontSize: 12, color: C.negative }}>{erreur}</span>}
      </div>
    </div>
  );
}

function LigneSponsor({ s, t, lang, onChange }: { s: SponsorAvecOffres; t: typeof T.fr; lang: Lang; onChange: () => void }) {
  const [nom, setNom] = useState(s.nom);
  const [ville, setVille] = useState(s.ville ?? '');
  const [url, setUrl] = useState(s.url ?? '');
  const [compte, setCompte] = useState(s.compte_id ? String(s.compte_id) : '');
  const [erreur, setErreur] = useState<string | null>(null);
  const [ouvert, setOuvert] = useState(false);
  const modifie = nom !== s.nom || ville !== (s.ville ?? '') || url !== (s.url ?? '')
    || compte !== (s.compte_id ? String(s.compte_id) : '');

  const envoyer = async (corps: Partial<Parameters<typeof api.ecrireSponsor>[0]> = {}) => {
    setErreur(null);
    try {
      await api.ecrireSponsor({
        id: s.id, nom, ville, url, actif: s.actif,
        compte_id: compte.trim() ? Number(compte) : null,
        ...corps,
      });
      onChange();
    }
    catch (e) { setErreur(e instanceof Error ? e.message : String(e)); }
  };
  const tirer = async (o: Offre) => {
    setErreur(null);
    try { await api.tirerOffre(o.id); onChange(); }
    catch (e) { setErreur(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 0', borderTop: `1px solid ${C.borderSoft}`, opacity: s.actif ? 1 : 0.7 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Icon name="gift" size={16} color={s.actif ? C.teal : C.inkQuiet} />
        <span style={{ fontSize: 14, fontWeight: 600, color: C.ink }}>{s.nom}</span>
        {s.ville && <span style={{ fontSize: 12, color: C.inkSecondary }}>{s.ville}</span>}
        <span style={{ fontSize: 10.5, fontWeight: 600, padding: '1px 7px', borderRadius: R.full, background: s.actif ? C.accentSoft : C.surfaceAlt, color: s.actif ? C.accentDeep : C.inkQuiet }}>
          {s.actif ? t.actif : t.inactif}
        </span>
        <span style={{ fontSize: 11.5, color: C.inkQuiet }}>{`${s.offres.length} ${t.offres.toLowerCase()}`}</span>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={() => setOuvert((o) => !o)} style={BOUTON_SOBRE} aria-expanded={ouvert}>
          {ouvert ? '−' : '+'}
        </button>
      </div>

      {ouvert && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
            <Champ label={t.nom} value={nom} onChange={setNom} />
            <Champ label={t.ville} value={ville} onChange={setVille} />
            <Champ label={t.url} value={url} onChange={setUrl} mono aide={t.urlAide} />
            <Champ label={t.compte} value={compte} onChange={setCompte} mono aide={t.compteAide} />
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" disabled={!modifie} onClick={() => void envoyer({})} style={{ ...BOUTON, opacity: modifie ? 1 : 0.5 }}>{t.enregistrer}</button>
            <button type="button" onClick={() => void envoyer({ actif: !s.actif })} style={BOUTON_SOBRE}>{s.actif ? t.desactiver : t.activer}</button>
          </div>

          {s.offres.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead>
                  <tr>{[t.titre, t.lot, t.voucher, t.regle, t.debut, t.fin, t.participations, t.gagnant, ''].map((h, i) => <th key={i} style={entete}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {s.offres.map((o) => (
                    <tr key={o.id}>
                      <td style={cellule}>{o.titre}</td>
                      <td style={cellule}>{o.lot ?? '—'}</td>
                      <td style={{ ...cellule, fontFamily: F.mono }}>{o.voucher ?? '—'}</td>
                      <td style={{ ...cellule, fontFamily: F.mono }}>{o.regle_pct ? `${o.regle_pct} %` : '—'}</td>
                      <td style={{ ...cellule, fontFamily: F.mono }}>{o.debut}</td>
                      <td style={{ ...cellule, fontFamily: F.mono }}>{o.fin}</td>
                      <td style={{ ...cellule, fontFamily: F.mono }}>{o.participations}</td>
                      <td style={cellule}>{o.gagnant ? o.gagnant.nom : o.tirage_le ? t.personne : '—'}</td>
                      <td style={{ ...cellule, textAlign: 'right' }}>
                        {o.tirage_le
                          ? <span style={{ fontSize: 11, color: C.inkQuiet }}>{t.tire}</span>
                          : (
                            <button type="button" disabled={o.participations === 0} onClick={() => void tirer(o)} style={{ ...BOUTON_SOBRE, opacity: o.participations ? 1 : 0.5 }}>
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
          <FormulaireOffre sponsorId={s.id} t={t} onFait={onChange} />
          {erreur && <div style={{ fontSize: 12, color: C.negative }}>{erreur}</div>}
          <span style={{ fontSize: 10.5, color: C.inkQuiet }}>{lang === 'fr' ? 'Les dates sont en AAAA-MM-JJ.' : 'Daty w formacie RRRR-MM-DD.'}</span>
        </>
      )}
    </div>
  );
}

export function PartenairesScreen({ app }: { app: App }) {
  const lang = app.lang;
  const t = T[lang];
  const [donnees, setDonnees] = useState<{ sponsors: SponsorAvecOffres[] } | null>(null);
  const [analyse, setAnalyse] = useState<AnalysePartenaires | null>(null);
  const [nom, setNom] = useState('');
  const [ville, setVille] = useState('');
  const [url, setUrl] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);

  const relire = () => {
    api.adminPartenaires().then(setDonnees).catch((e) => setErreur(e instanceof Error ? e.message : String(e)));
    api.analysePartenaires().then(setAnalyse).catch(() => setAnalyse(null));
  };
  useEffect(() => { relire(); }, []);

  const creer = async () => {
    setErreur(null);
    try {
      await api.ecrireSponsor({ nom, ville, url });
      setNom(''); setVille(''); setUrl('');
      relire();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    }
  };

  if (!donnees) return <div style={{ color: C.inkSecondary, fontSize: 13 }}>{erreur ?? t.chargement}</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 12.5, color: C.inkSecondary, lineHeight: 1.5 }}>{t.intro}</div>

      <Card padding="14px 18px" gap={10}>
        <SectionLabel icon="gift" color={C.teal}>{`${t.sponsors} · ${donnees.sponsors.length}`}</SectionLabel>
        {donnees.sponsors.length === 0 && <div style={{ fontSize: 13, color: C.inkSecondary }}>{t.aucun}</div>}
        {donnees.sponsors.map((s) => <LigneSponsor key={s.id} s={s} t={t} lang={lang} onChange={relire} />)}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', borderRadius: R.md, background: C.surfaceAlt, border: `1px solid ${C.border}` }}>
          <span style={{ fontSize: 11.5, fontWeight: 600, color: C.ink }}>{t.nouveau}</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
            <Champ label={t.nom} value={nom} onChange={setNom} />
            <Champ label={t.ville} value={ville} onChange={setVille} />
            <Champ label={t.url} value={url} onChange={setUrl} mono aide={t.urlAide} />
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button type="button" disabled={!nom.trim()} onClick={() => void creer()} style={{ ...BOUTON, opacity: nom.trim() ? 1 : 0.5 }}>{t.creer}</button>
            {erreur && <span style={{ fontSize: 12, color: C.negative }}>{erreur}</span>}
          </div>
        </div>
      </Card>

      {analyse && (
        <Card padding="14px 18px" gap={12}>
          <SectionLabel icon="activity" color={C.teal}>{t.analyse}</SectionLabel>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: C.ink }}>{t.parSponsor}</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>{[t.sponsor, t.ville, t.offres, t.vues, t.participations, t.gagnants, t.clics].map((h, i) => <th key={i} style={entete}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {analyse.sponsors.map((s) => (
                  <tr key={s.id}>
                    <td style={{ ...cellule, fontWeight: 600, color: C.ink }}>{s.nom}</td>
                    <td style={cellule}>{s.ville ?? '—'}</td>
                    <td style={{ ...cellule, fontFamily: F.mono }}>{s.offres}</td>
                    <td style={{ ...cellule, fontFamily: F.mono }}>{s.vues}</td>
                    <td style={{ ...cellule, fontFamily: F.mono }}>{s.participations}</td>
                    <td style={{ ...cellule, fontFamily: F.mono }}>{s.gagnants}</td>
                    <td style={{ ...cellule, fontFamily: F.mono, fontWeight: 700, color: C.accentDeep }}>{s.clics}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: C.ink }}>{t.parAthlete}</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>{[t.athlete, t.participations, t.gagnes, t.clics, t.dernierClic].map((h, i) => <th key={i} style={entete}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {analyse.athletes.map((a) => (
                  <tr key={a.id}>
                    <td style={{ ...cellule, fontWeight: 600, color: C.ink }}>{[a.prenom, a.nom].filter(Boolean).join(' ')}</td>
                    <td style={{ ...cellule, fontFamily: F.mono }}>{a.participations}</td>
                    <td style={{ ...cellule, fontFamily: F.mono }}>{a.gagnes}</td>
                    <td style={{ ...cellule, fontFamily: F.mono, fontWeight: 700, color: C.accentDeep }}>{a.clics}</td>
                    <td style={{ ...cellule, fontFamily: F.mono, color: C.inkQuiet }}>{a.dernier_clic ? a.dernier_clic.slice(0, 10) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
