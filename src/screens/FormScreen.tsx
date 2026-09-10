/* État de forme — la mesure du jour (le poids et la FC de repos, lus sur une
   photo de la balance), les deux courbes de forme (la base endurance, la
   récupération HRV), puis les quatre métriques calculées sur les activités et
   le journal.

   Chaque carte est une valeur, sa série, et la formule derrière. */

import { useRef, useState } from 'react';

import * as api from '../data/api';
import * as db from '../data/db';
import type { Lang, MesureAttente } from '../data/types';
import { C, F, R } from '../design/theme';
import { FormeCourbes } from '../components/FormeCourbes';
import { Icon } from '../components/Icon';
import { BarChart, Card, Mono, bars } from '../components/primitives';
import type { App } from '../state/useApp';

export function FormScreen({ app }: { app: App }) {
  const lang = app.lang;
  const metrics = db.select('msc_metric');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <MesureCard app={app} />

      <FormeCourbes courbes={db.courbes} lang={lang} />

      {metrics.map((m) => (
        <Card key={m.code} padding="16px 18px">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <Icon name={m.icon} size={18} color={m.couleur} />
              <div style={{ fontSize: 14, fontWeight: 600, color: C.ink }}>{m.nom[lang]}</div>
            </div>
            <div
              style={{
                fontFamily: F.mono,
                fontSize: 19,
                color: m.valeur ? m.couleur : C.inkQuiet,
                flexShrink: 0,
              }}
            >
              {m.valeur ?? '—'}
            </div>
          </div>

          {/* Une métrique se calcule depuis les activités et les mesures. Tant
              qu'il n'y en a pas assez, elle n'a ni valeur ni série — et le dire
              vaut mieux que peindre une barre sur rien. */}
          {m.serie?.length ? (
            <BarChart height={38} gap={4} data={bars(m.serie, m.seuil, C.warning)} />
          ) : (
            <div style={{ fontSize: 11, color: C.inkQuiet, fontStyle: 'italic' }}>
              {lang === 'fr' ? 'Pas encore assez de données' : 'Za mało danych'}
            </div>
          )}

          <div style={{ fontSize: 11, color: C.inkQuiet }}>{m.formule[lang]}</div>
        </Card>
      ))}
    </div>
  );
}


/* ------------------------------------------------------------ la mesure */

const T: Record<Lang, Record<string, string>> = {
  fr: {
    titre: 'Poids et FC de repos',
    prendre: 'Photographier la balance',
    envoi: 'Claude lit la photo…',
    lu: 'Lu sur la photo',
    poids: 'Poids (kg)',
    fc: 'FC de repos (bpm)',
    confirmer: 'Confirmer',
    rejeter: 'Rejeter',
    aujourdhui: 'Aujourd’hui',
    rien: 'Rien enregistré pour ce jour.',
    illisible: 'Claude n’a rien pu lire. Saisis les chiffres à la main.',
    doute: 'Lecture incertaine — vérifie avant de confirmer.',
  },
  pl: {
    titre: 'Waga i tętno spoczynkowe',
    prendre: 'Zrób zdjęcie wagi',
    envoi: 'Claude czyta zdjęcie…',
    lu: 'Odczytane ze zdjęcia',
    poids: 'Waga (kg)',
    fc: 'Tętno spoczynkowe (bpm)',
    confirmer: 'Potwierdź',
    rejeter: 'Odrzuć',
    aujourdhui: 'Dzisiaj',
    rien: 'Nic nie zapisano na ten dzień.',
    illisible: 'Claude nic nie odczytał. Wpisz liczby ręcznie.',
    doute: 'Odczyt niepewny — sprawdź przed potwierdzeniem.',
  },
};

const CHAMP: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  borderRadius: R.md,
  border: `1px solid ${C.border}`,
  background: C.surface,
  color: C.ink,
  padding: '9px 10px',
  fontFamily: F.mono,
  fontSize: 14,
};

function MesureCard({ app }: { app: App }) {
  const lang = app.lang;
  const t = T[lang];
  const fichier = useRef<HTMLInputElement>(null);

  const attente = db.select('mesures_attente')[0] as MesureAttente | undefined;
  const confirmee = db
    .select('msc_mesure')
    .filter((m) => m.date <= app.date)
    .slice(-1)[0];

  if (attente) return <Proposition app={app} attente={attente} />;

  return (
    <Card padding="16px 18px" gap={12} borderColor={C.border}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <Icon name="scale" size={17} color={C.teal} />
          <div style={{ fontSize: 13, fontWeight: 600, color: C.ink }}>{t.titre}</div>
        </div>
        {confirmee ? (
          <Mono size={13} color={C.ink}>
            {[
              confirmee.poids_kg !== undefined ? `${confirmee.poids_kg} kg` : null,
              confirmee.fc_repos !== undefined ? `${confirmee.fc_repos} bpm` : null,
            ].filter(Boolean).join(' · ') || '—'}
          </Mono>
        ) : (
          <Mono size={11} color={C.inkQuiet}>{t.rien}</Mono>
        )}
      </div>

      {/* `capture` ouvre l'appareil photo plutôt que la galerie sur téléphone ;
          sur ordinateur l'attribut est ignoré et c'est un sélecteur de fichier. */}
      <input
        ref={fichier}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        capture="environment"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void app.envoyerPhoto(f);
        }}
      />
      <button
        type="button"
        onClick={() => fichier.current?.click()}
        disabled={app.photoJob === 'envoi'}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          padding: '11px 16px',
          borderRadius: R.full,
          background: app.photoJob === 'envoi' ? C.surfaceAlt : C.accent,
          color: app.photoJob === 'envoi' ? C.inkQuiet : C.accentInk,
          fontWeight: 600,
          fontSize: 13,
        }}
      >
        <Icon name={app.photoJob === 'envoi' ? 'loader' : 'camera'} size={16} />
        {app.photoJob === 'envoi' ? t.envoi : t.prendre}
      </button>

      {app.photoErreur && <Alerte texte={app.photoErreur} />}
    </Card>
  );
}

/* Ce que le modèle a lu n'est pas encore le poids de l'athlète. Cette carte est
   la seule porte entre les deux, et elle laisse corriger avant de passer. */
function Proposition({ app, attente }: { app: App; attente: MesureAttente }) {
  const lang = app.lang;
  const t = T[lang];
  const [poids, setPoids] = useState(attente.poids_kg?.toString() ?? '');
  const [fc, setFc] = useState(attente.fc_repos?.toString() ?? '');

  const nombre = (v: string) => {
    /* Une balance affiche « 74,5 » et un clavier de téléphone tape la virgule. */
    const n = Number(v.replace(',', '.'));
    return v.trim() === '' || !Number.isFinite(n) ? null : n;
  };

  return (
    <Card padding="16px 18px" gap={12} borderColor={C.accent}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <Icon name="camera" size={17} color={C.accentDeep} />
        <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: C.ink }}>{t.lu}</div>
        <Mono size={11} color={C.inkQuiet}>{attente.date}</Mono>
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <img
          src={api.urlPhoto(attente.photo_id)}
          alt=""
          style={{
            width: 96,
            height: 96,
            objectFit: 'cover',
            borderRadius: R.md,
            border: `1px solid ${C.border}`,
            flexShrink: 0,
          }}
        />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {attente.lu && (
            <Mono size={11} color={C.inkSecondary}>{attente.lu}</Mono>
          )}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontSize: 10, color: C.inkSecondary }}>{t.poids}</span>
            <input
              inputMode="decimal"
              value={poids}
              onChange={(e) => setPoids(e.target.value)}
              style={CHAMP}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontSize: 10, color: C.inkSecondary }}>{t.fc}</span>
            <input
              inputMode="numeric"
              value={fc}
              onChange={(e) => setFc(e.target.value)}
              style={CHAMP}
            />
          </label>
        </div>
      </div>

      {attente.echec && <Alerte texte={t.illisible} />}
      {!attente.echec && attente.confiance !== 'haute' && <Alerte texte={t.doute} />}
      {app.photoErreur && <Alerte texte={app.photoErreur} />}

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={() =>
            void app.confirmerMesure({
              date: attente.date,
              poids_kg: nombre(poids),
              fc_repos: nombre(fc),
            })
          }
          style={{
            flex: 1,
            padding: '10px 16px',
            borderRadius: R.full,
            background: C.accent,
            color: C.accentInk,
            fontWeight: 600,
            fontSize: 13,
          }}
        >
          {t.confirmer}
        </button>
        <button
          type="button"
          onClick={() => void app.confirmerMesure({ date: attente.date, rejeter: true })}
          style={{
            padding: '10px 16px',
            borderRadius: R.full,
            border: `1px solid ${C.border}`,
            background: C.surface,
            color: C.inkSecondary,
            fontSize: 13,
          }}
        >
          {t.rejeter}
        </button>
      </div>
    </Card>
  );
}

function Alerte({ texte }: { texte: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        padding: '8px 10px',
        borderRadius: R.md,
        background: C.warningBg,
        color: C.warning,
        fontSize: 11,
        lineHeight: 1.4,
      }}
    >
      <Icon name="triangle-alert" size={14} />
      <span>{texte}</span>
    </div>
  );
}
