/* Le calendrier commun : qui court quoi, et quand. Toutes les compétitions
   de tous les athlètes, mois par mois, chacune avec l'avatar de celui qui la
   court. Ce qui vient : la cible du plan ; ce qui est couru : le chrono. */

import { useEffect, useState } from 'react';
import * as api from '../data/api';
import * as db from '../data/db';
import type { CalendrierEntree, Lang } from '../data/types';
import { C, F, R } from '../design/theme';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import type { App } from '../state/useApp';

const MOIS: Record<Lang, string[]> = {
  fr: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
  pl: ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'],
};
const JOURS: Record<Lang, string[]> = {
  fr: ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'],
  pl: ['nd', 'pon', 'wt', 'śr', 'czw', 'pt', 'sob'],
};

const T: Record<Lang, Record<string, string>> = {
  fr: { chargement: 'Lecture du calendrier…', vide: 'Aucune compétition encodée.', aVenir: 'à venir', abandon: 'abandon',
        passe: 'Déjà couru', objectif: 'objectif', principal: 'objectif principal', moi: 'toi', jours: 'j' },
  pl: { chargement: 'Wczytywanie kalendarza…', vide: 'Brak zawodów.', aVenir: 'nadchodzi', abandon: 'DNF',
        passe: 'Już za nami', objectif: 'cel', principal: 'cel główny', moi: 'ty', jours: 'dni' },
};

const ICONE: Record<string, string> = {
  'Course à pied': 'footprints', Vélo: 'bike', Natation: 'waves', Hyrox: 'dumbbell', Trail: 'mountain',
};

function chrono(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}h${String(m).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

function Entree({ e, lang, aujourdhui, moi }: { e: CalendrierEntree; lang: Lang; aujourdhui: string; moi: boolean }) {
  const t = T[lang];
  const d = new Date(`${e.date}T00:00:00`);
  const passee = e.date < aujourdhui;
  const dans = Math.round((Date.parse(`${e.date}T00:00:00`) - Date.parse(`${aujourdhui}T00:00:00`)) / 86_400_000);
  const nomAthlete = [e.athlete.prenom, e.athlete.nom].filter(Boolean).join(' ');
  const affiche = e.athlete.surnom || e.athlete.prenom || e.athlete.nom;

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0',
        borderTop: `1px solid ${C.border}`, opacity: passee && !e.resultat ? 0.6 : 1,
      }}
    >
      {/* la date, en colonne : le jour en gros, le jour de semaine dessous */}
      <div style={{ width: 40, textAlign: 'center', flexShrink: 0 }}>
        <div style={{ fontFamily: F.display, fontSize: 20, fontWeight: 600, color: C.ink, lineHeight: 1 }}>{d.getDate()}</div>
        <div style={{ fontSize: 10, color: C.inkQuiet, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{JOURS[lang][d.getDay()]}</div>
      </div>
      <Avatar nom={nomAthlete} taille={38} sousTitre={affiche} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <Icon name={ICONE[e.discipline] ?? 'flag'} size={14} color={C.inkSecondary} />
          <div style={{ fontSize: 14, fontWeight: 600, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {e.nom}
          </div>
          {e.principal && <Icon name="target" size={13} color={C.accentDeep} />}
        </div>
        <div style={{ fontSize: 12, color: C.inkSecondary, marginTop: 2 }}>
          {`${e.distance_km} km${e.lieu ? ` · ${e.lieu}` : ''}`}
          {e.cible && <span style={{ color: C.inkQuiet }}>{` · ${t.objectif} ${e.cible[lang]}`}</span>}
          {moi && <span style={{ color: C.accentDeep, fontWeight: 600 }}>{` · ${t.moi}`}</span>}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        {e.resultat ? (
          <div style={{ fontFamily: F.mono, fontSize: 14, color: e.resultat.abandon ? C.negative : C.ink }}>
            {e.resultat.abandon ? t.abandon : e.resultat.temps_s != null ? chrono(e.resultat.temps_s) : '—'}
          </div>
        ) : passee ? (
          <div style={{ fontSize: 11, color: C.inkQuiet }}>{t.passe}</div>
        ) : (
          <div style={{ fontFamily: F.mono, fontSize: 12, color: dans <= 14 ? C.accentDeep : C.inkQuiet }}>
            {dans === 0 ? '🏁' : `J−${dans}`}
          </div>
        )}
      </div>
    </div>
  );
}

export function CalendrierScreen({ app }: { app: App }) {
  const t = T[app.lang];
  const [entrees, setEntrees] = useState<CalendrierEntree[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const aujourdhui = db.aujourdhuiISO();

  useEffect(() => {
    let vivant = true;
    api.calendrier()
      .then((r) => { if (vivant) setEntrees(r.competitions); })
      .catch((e) => { if (vivant) setErreur(e instanceof Error ? e.message : String(e)); });
    return () => { vivant = false; };
  }, [app.version]);

  if (erreur) return <div style={{ fontSize: 12, color: C.negative }}>{erreur}</div>;
  if (entrees === null) return <div style={{ color: C.inkSecondary, fontSize: 13 }}>{t.chargement}</div>;
  if (entrees.length === 0) return <div style={{ color: C.inkSecondary, fontSize: 13 }}>{t.vide}</div>;

  /* Par mois, du plus proche au plus lointain ; le passé ferme la marche,
     le plus récent d'abord — ce qu'on ouvre le plus souvent est en haut. */
  const aVenir = entrees.filter((e) => e.date >= aujourdhui);
  const passees = entrees.filter((e) => e.date < aujourdhui).reverse();
  const groupes = (liste: CalendrierEntree[]) => {
    const m = new Map<string, CalendrierEntree[]>();
    for (const e of liste) {
      const cle = e.date.slice(0, 7);
      if (!m.has(cle)) m.set(cle, []);
      m.get(cle)!.push(e);
    }
    return [...m.entries()];
  };
  const titreMois = (cle: string) => `${MOIS[app.lang][Number(cle.slice(5, 7)) - 1]} ${cle.slice(0, 4)}`;

  const Bloc = ({ liste, titre }: { liste: CalendrierEntree[]; titre?: string }) => (
    <>
      {titre && (
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.inkQuiet, marginTop: 6 }}>
          {titre}
        </div>
      )}
      {groupes(liste).map(([cle, es]) => (
        <div key={cle} style={{ borderRadius: R.card, border: `1px solid ${C.border}`, background: C.surface, padding: '12px 14px 4px', boxShadow: C.shadowCard }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <Icon name="calendar-days" size={15} color={C.teal} />
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.teal }}>
              {titreMois(cle)}
            </div>
          </div>
          {es.map((e) => <Entree key={e.id} e={e} lang={app.lang} aujourdhui={aujourdhui} moi={e.athlete.id === db.athleteId} />)}
        </div>
      ))}
    </>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Bloc liste={aVenir} />
      {passees.length > 0 && <Bloc liste={passees} titre={t.passe} />}
    </div>
  );
}
