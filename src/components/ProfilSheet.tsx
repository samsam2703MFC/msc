/* Le profil de l'athlète, en touchant l'avatar : qui c'est, et de quoi on part. */

import { useEffect, useState } from 'react';
import * as api from '../data/api';
import * as db from '../data/db';
import type { Lang } from '../data/types';
import { C, F, R } from '../design/theme';
import { COACH, COACHS, coachDe } from '../data/coachs';
import { Avatar } from './Avatar';
import { CoachAvatar } from './CoachAvatar';
import { Sheet, SheetCloseButton } from './Sheet';
import { StravaCard } from './SettingsSheet';
import type { App } from '../state/useApp';

const T: Record<Lang, Record<string, string>> = {
  fr: {
    titre: 'Profil', prenom: 'Prénom', nom: 'Nom', surnom: 'Surnom (sous l’avatar)',
    annee: 'Année de naissance', poids: 'Poids', ans: 'ans', enregistrer: 'Enregistrer',
    enCours: 'Enregistrement…', fermer: 'Fermer', aucunPoids: 'aucune mesure confirmée',
    coach: 'Ton coach', coachAide: 'Le même plan, pas le même ton — dans l’analyse, le chat et le recalcul.',
  },
  pl: {
    titre: 'Profil', prenom: 'Imię', nom: 'Nazwisko', surnom: 'Pseudonim (pod awatarem)',
    annee: 'Rok urodzenia', poids: 'Waga', ans: 'lat', enregistrer: 'Zapisz',
    enCours: 'Zapisywanie…', fermer: 'Zamknij', aucunPoids: 'brak potwierdzonego pomiaru',
    coach: 'Twój trener', coachAide: 'Ten sam plan, inny ton — w analizie, czacie i przeliczeniu.',
  },
};

const ETIQUETTE = {
  fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase' as const,
  color: C.inkSecondary, fontWeight: 600,
};

/* Trois têtes, une sélectionnée. La ligne sous la grille dit comment celui-là
   parle, pour choisir en sachant. */
function ChoixCoach({ lang, valeur, onChange }: { lang: Lang; valeur: string; onChange: (c: string) => void }) {
  const t = T[lang];
  const choisi = coachDe(valeur);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={ETIQUETTE}>{t.coach}</span>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
        {COACHS.map((code) => {
          const on = valeur === code;
          return (
            <button
              key={code}
              type="button"
              className="msc-hover-accent"
              aria-pressed={on}
              onClick={() => onChange(code)}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                padding: '10px 6px', borderRadius: R.md,
                border: `1px solid ${on ? C.accent : C.border}`,
                background: on ? C.accentSoft : C.surface,
              }}
            >
              <CoachAvatar code={code} taille={52} />
              <div style={{ fontSize: 12, fontWeight: 600, color: on ? C.accentDeep : C.ink, textAlign: 'center' }}>
                {COACH[code].nom[lang]}
              </div>
            </button>
          );
        })}
      </div>
      <div style={{ fontSize: 12, color: C.inkSecondary, lineHeight: 1.45 }}>
        {choisi.ton[lang]} <span style={{ color: C.inkQuiet }}>{choisi.devise[lang]}</span>
      </div>
      <div style={{ fontSize: 11, color: C.inkQuiet, lineHeight: 1.4 }}>{t.coachAide}</div>
    </div>
  );
}

function Champ({ label, value, onChange, type = 'text', placeholder }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: C.inkSecondary, fontWeight: 600 }}>
        {label}
      </span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%', minWidth: 0, boxSizing: 'border-box',
          padding: '10px 12px', borderRadius: R.md, border: `1px solid ${C.border}`,
          background: C.surface, color: C.ink, fontSize: 15, fontFamily: F.body,
        }}
      />
    </label>
  );
}

/* Le formulaire seul, pour la feuille (téléphone) comme pour la page Profil
   du bureau : les mêmes champs, le même enregistrement. */
export function ProfilForm({ app, onDone }: { app: App; onDone: () => void }) {
  const t = T[app.lang];
  const athlete = db.athlete;
  const [prenom, setPrenom] = useState(athlete.prenom ?? '');
  const [nom, setNom] = useState(athlete.nom);
  const [surnom, setSurnom] = useState(athlete.surnom ?? '');
  const [annee, setAnnee] = useState(athlete.annee_naissance ? String(athlete.annee_naissance) : '');
  const [coach, setCoach] = useState<string>(coachDe(athlete.coach).code);
  const [poids, setPoids] = useState<number | null | undefined>(undefined);
  const [job, setJob] = useState<'idle' | 'saving'>('idle');
  const [erreur, setErreur] = useState<string | null>(null);

  /* Le poids vient des mesures, pas du profil : la dernière confirmée, lue par
     la vue coach, qui sait déjà l'exclure si elle est datée dans le futur. */
  useEffect(() => {
    let vivant = true;
    api.apercu()
      .then((r) => { if (vivant) setPoids(r.athletes.find((x) => x.id === athlete.id)?.mesure?.poids_kg ?? null); })
      .catch(() => { if (vivant) setPoids(null); });
    return () => { vivant = false; };
  }, [athlete.id]);

  const age = annee && /^\d{4}$/.test(annee) ? new Date().getFullYear() - Number(annee) : null;
  const affiche = [prenom.trim(), nom.trim()].filter(Boolean).join(' ') || athlete.nom;

  const enregistrer = async () => {
    setJob('saving'); setErreur(null);
    try {
      await app.majProfil({
        prenom: prenom.trim() || null, nom: nom.trim(), surnom: surnom.trim() || null,
        annee_naissance: annee ? Number(annee) : null,
        coach,
      });
      onDone();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setJob('idle');
    }
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <Avatar nom={affiche} taille={56} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: F.display, fontSize: 20, fontWeight: 600, color: C.ink, letterSpacing: '-0.01em' }}>
            {affiche}
          </div>
          <div style={{ fontSize: 12, color: C.inkSecondary, marginTop: 2 }}>
            {surnom.trim() ? `« ${surnom.trim()} »` : ''}
            {surnom.trim() && age != null ? ' · ' : ''}
            {age != null ? `${age} ${t.ans}` : ''}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 10 }}>
        <Champ label={t.prenom} value={prenom} onChange={setPrenom} />
        <Champ label={t.nom} value={nom} onChange={setNom} />
      </div>
      <Champ label={t.surnom} value={surnom} onChange={setSurnom} />
      <Champ label={t.annee} value={annee} onChange={setAnnee} type="number" placeholder="1986" />

      <ChoixCoach lang={app.lang} valeur={coach} onChange={setCoach} />

      <div style={{ borderRadius: R.md, border: `1px solid ${C.border}`, padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: C.inkSecondary, fontWeight: 600 }}>{t.poids}</span>
        <span style={{ fontFamily: F.mono, fontSize: 15, color: poids ? C.ink : C.inkQuiet }}>
          {poids === undefined ? '…' : poids == null ? t.aucunPoids : `${poids} kg`}
        </span>
      </div>

      {erreur && <div style={{ fontSize: 12, color: C.negative }}>{erreur}</div>}

      <button
        type="button"
        onClick={() => void enregistrer()}
        disabled={job === 'saving' || !nom.trim()}
        style={{
          padding: '13px 16px', borderRadius: R.md, background: C.accent, color: C.accentInk,
          fontWeight: 700, fontSize: 15, border: 'none', opacity: job === 'saving' || !nom.trim() ? 0.6 : 1,
        }}
      >
        {job === 'saving' ? t.enCours : t.enregistrer}
      </button>
    </>
  );
}

/* La feuille de l'athlète, sous son avatar : son profil, ses références
   10 km, son Strava. Ce qui est à l'application — la langue, le jour du
   plan, le compte, la version — est sous la roue dentée, et nulle part ici. */
export function ProfilSheet({ app }: { app: App }) {
  const t = T[app.lang];
  const fr = app.lang === 'fr';
  return (
    <Sheet onClose={app.closeProfil} zIndex={95} label={t.titre} scrollable>
      <ProfilForm app={app} onDone={app.closeProfil} />
      <div style={{ borderRadius: 12, background: C.page, border: `1px solid ${C.border}`, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: C.inkSecondary, fontWeight: 600 }}>
          {fr ? 'Références 10 km' : 'Odniesienia 10 km'}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: F.mono, fontSize: 13 }}>
          <span style={{ color: C.ink }}>{db.format10k(db.athlete.ref_actuelle_s)}</span>
          <span style={{ color: C.accentDeep }}>→</span>
          <span style={{ color: C.accentDeep }}>{db.format10k(db.athlete.ref_cible_s)}</span>
        </div>
        <div style={{ fontSize: 11, color: C.inkSecondary, lineHeight: 1.4 }}>
          {fr
            ? "Toutes les allures du plan sont calculées depuis ces deux nombres. Le test de 30' recale le premier."
            : 'Wszystkie tempa planu liczone są z tych dwóch liczb. Test 30 min przelicza pierwszą.'}
        </div>
      </div>
      <StravaCard app={app} />
      <SheetCloseButton label={t.fermer} onClick={app.closeProfil} />
    </Sheet>
  );
}
