/* Les réglages du back office : le catalogue msc_param, groupe par groupe.

   Chaque ligne dit d'où vient la valeur qui s'applique — réglée ici, variable
   d'environnement, ou défaut du code — parce qu'un réglage qui a l'air actif
   sans l'être est pire qu'un réglage absent. Un secret ne redescend jamais :
   on sait qu'il est renseigné, on voit sa fin, on peut le remplacer ou
   l'effacer. */

import { useEffect, useState } from 'react';
import * as api from '../data/api';
import type { Lang, MscParam } from '../data/types';
import { C, F, R } from '../design/theme';
import { Icon } from '../components/Icon';
import type { App } from '../state/useApp';

const GROUPES: Array<{ code: string; icon: string; nom: Record<Lang, string> }> = [
  { code: 'moteur', icon: 'gauge', nom: { fr: 'Moteur', pl: 'Silnik' } },
  { code: 'forme', icon: 'heart-pulse', nom: { fr: 'Forme', pl: 'Forma' } },
  { code: 'coach', icon: 'bot', nom: { fr: 'Coach', pl: 'Trener' } },
  { code: 'niveau', icon: 'zap', nom: { fr: 'Niveaux', pl: 'Poziomy' } },
  { code: 'strava', icon: 'link', nom: { fr: 'Strava', pl: 'Strava' } },
  { code: 'securite', icon: 'user', nom: { fr: 'Sécurité', pl: 'Bezpieczeństwo' } },
];

const T: Record<Lang, Record<string, string>> = {
  fr: {
    chargement: 'Lecture des réglages…', enregistrer: 'Enregistrer', effacer: 'Effacer',
    renseigne: 'renseignée', absente: 'absente', nouveau: 'Nouvelle valeur — jamais réaffichée',
    illisible: 'renseignée mais illisible : scellée avec une autre clé de serveur (MSC_SECRET_KEY). Ressaisis-la.',
    base: 'réglé ici', env: 'variable d’environnement', defaut: 'défaut du code',
    intro: 'Ce qui s’applique, et d’où ça vient. Un réglage vide retombe sur la variable d’environnement, puis sur le défaut.',
  },
  pl: {
    chargement: 'Wczytywanie ustawień…', enregistrer: 'Zapisz', effacer: 'Wyczyść',
    renseigne: 'ustawiony', absente: 'brak', nouveau: 'Nowa wartość — nigdy nie pokazywana ponownie',
    illisible: 'ustawiony, ale nieczytelny: zapieczętowany innym kluczem serwera (MSC_SECRET_KEY). Wpisz ponownie.',
    base: 'ustawione tutaj', env: 'zmienna środowiskowa', defaut: 'domyślne z kodu',
    intro: 'Co obowiązuje i skąd pochodzi. Puste ustawienie wraca do zmiennej środowiskowej, potem do domyślnej.',
  },
};

const ENTREE = {
  width: '100%', minWidth: 0, boxSizing: 'border-box' as const,
  padding: '9px 11px', borderRadius: R.md, border: `1px solid ${C.border}`,
  background: C.surface, color: C.ink, fontSize: 14, fontFamily: F.mono,
};

export function Reglage({
  p, lang, onSave,
}: {
  p: MscParam; lang: Lang; onSave: (cle: string, valeur: string | number | boolean | null) => Promise<void>;
}) {
  const t = T[lang];
  const secret = p.type === 'secret';
  const [texte, setTexte] = useState(secret ? '' : p.valeur == null ? '' : String(p.valeur));
  const [job, setJob] = useState<'idle' | 'saving'>('idle');
  const [erreur, setErreur] = useState<string | null>(null);

  /* Une relecture (après un autre enregistrement) remet le champ au propre. */
  useEffect(() => {
    if (!secret) setTexte(p.valeur == null ? '' : String(p.valeur));
  }, [p.valeur, secret]);

  const modifie = secret ? texte.trim() !== '' : texte.trim() !== (p.valeur == null ? '' : String(p.valeur));

  const envoyer = async (valeur: string | boolean | null) => {
    setJob('saving'); setErreur(null);
    try {
      await onSave(p.cle, valeur);
      if (secret) setTexte('');
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setJob('idle');
    }
  };

  const source = `${t[p.source]}${p.env && p.source !== 'base' ? ` · ${p.env}` : ''}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 0', borderTop: `1px solid ${C.border}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.ink }}>{p.libelle[lang]}</div>
        <div style={{ fontSize: 10, color: C.inkQuiet, whiteSpace: 'nowrap' }}>{source}</div>
      </div>
      {p.aide && <div style={{ fontSize: 11.5, color: C.inkSecondary, lineHeight: 1.4 }}>{p.aide[lang]}</div>}

      {p.type === 'booleen' ? (
        <button
          type="button"
          aria-pressed={Boolean(p.valeur)}
          disabled={job === 'saving'}
          onClick={() => void envoyer(!p.valeur)}
          style={{
            alignSelf: 'flex-start', padding: '6px 12px', borderRadius: R.full, fontSize: 12, fontWeight: 600,
            border: `1px solid ${p.valeur ? C.accent : C.border}`,
            background: p.valeur ? C.accentSoft : C.surface, color: p.valeur ? C.accentDeep : C.inkMuted,
          }}
        >
          {p.valeur ? 'oui' : 'non'}
        </button>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {secret && (
            <div
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12, lineHeight: 1.4,
                color: p.illisible ? C.negative : p.renseigne ? C.accentDeep : C.warning,
              }}
            >
              <Icon name={p.renseigne && !p.illisible ? 'circle-check' : 'triangle-alert'} size={13} />
              <span>{p.illisible ? t.illisible : p.renseigne ? `${t.renseigne} ${p.apercu ?? ''}` : t.absente}</span>
            </div>
          )}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type={secret ? 'password' : p.type === 'nombre' ? 'text' : 'text'}
              inputMode={p.type === 'nombre' ? 'decimal' : undefined}
              autoComplete={secret ? 'new-password' : 'off'}
              value={texte}
              placeholder={secret ? t.nouveau : p.defaut == null ? '' : String(p.defaut)}
              onChange={(e) => setTexte(e.target.value)}
              style={ENTREE}
            />
            {p.unite && <span style={{ fontSize: 11, color: C.inkQuiet, whiteSpace: 'nowrap' }}>{p.unite}</span>}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {modifie && (
              <button
                type="button"
                disabled={job === 'saving'}
                onClick={() => void envoyer(texte.trim())}
                style={{ padding: '7px 12px', borderRadius: R.md, background: C.accent, color: C.accentInk, fontWeight: 700, fontSize: 12, border: 'none' }}
              >
                {t.enregistrer}
              </button>
            )}
            {p.source === 'base' && (
              <button
                type="button"
                disabled={job === 'saving'}
                onClick={() => void envoyer(null)}
                style={{ padding: '7px 12px', borderRadius: R.md, border: `1px solid ${C.border}`, color: C.inkMuted, fontSize: 12, fontWeight: 600, background: C.surface }}
              >
                {t.effacer}
              </button>
            )}
          </div>
        </div>
      )}
      {erreur && <div style={{ fontSize: 12, color: C.negative }}>{erreur}</div>}
    </div>
  );
}

export function ParamScreen({ app, large = false }: { app: App; large?: boolean }) {
  const t = T[app.lang];
  const [params, setParams] = useState<MscParam[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    let vivant = true;
    api.params()
      .then((r) => { if (vivant) setParams(r.params); })
      .catch((e) => { if (vivant) setErreur(e instanceof Error ? e.message : String(e)); });
    return () => { vivant = false; };
  }, []);

  const enregistrer = async (cle: string, valeur: string | number | boolean | null) => {
    const r = await api.majParam(cle, valeur);
    setParams((ps) => (ps ?? []).map((p) => (p.cle === cle ? r.param : p)));
  };

  if (erreur) {
    return (
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 12px', borderRadius: R.md, background: C.warningBg, color: C.warning, fontSize: 12, lineHeight: 1.4 }}>
        <Icon name="triangle-alert" size={14} />
        <span>{erreur}</span>
      </div>
    );
  }
  if (params === null) return <div style={{ color: C.inkSecondary, fontSize: 13 }}>{t.chargement}</div>;

  return (
    /* Sur le bureau, les groupes se posent en colonnes ; le téléphone empile. */
    <div style={large
      ? { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 12, alignItems: 'start' }
      : { display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      <div style={{ fontSize: 12.5, color: C.inkSecondary, lineHeight: 1.5, gridColumn: '1 / -1' }}>{t.intro}</div>
      {GROUPES.map((g) => {
        const lignes = params.filter((p) => p.groupe === g.code).sort((a, b) => a.ordre - b.ordre);
        if (lignes.length === 0) return null;
        return (
          <div key={g.code} style={{ borderRadius: R.card, border: `1px solid ${C.border}`, background: C.surface, padding: '12px 14px', boxShadow: C.shadowCard }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <Icon name={g.icon} size={16} color={C.teal} />
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.teal }}>
                {g.nom[app.lang]}
              </div>
            </div>
            {lignes.map((p) => <Reglage key={p.cle} p={p} lang={app.lang} onSave={enregistrer} />)}
          </div>
        );
      })}
    </div>
  );
}
