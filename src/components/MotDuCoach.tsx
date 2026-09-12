/* Le coach, à côté de l'athlète, avec une bulle.

   L'avatar de l'athlète dit qui il est ; celui du coach dit qui lui parle. On
   le touche, et le coach lit la journée : ce que le matin a donné, ce que la
   séance du jour demande, et pourquoi elle est là dans le plan. Court — deux
   à quatre phrases — parce que c'est ce qu'on lit debout dans une cuisine.

   Le ton est celui du coach choisi pour cet athlète (msc_athlete.coach,
   réglable dans son profil et dans le back office) : le serveur le lit
   lui-même et le pose sur la réponse. L'écran ne le choisit pas — sinon on
   aurait deux vérités sur qui parle.

   Rien de neuf côté serveur : c'est la même route que les questions posées
   dans une fiche de séance, avec une question écrite ici et le contexte du
   jour. Le fil « jour:AAAA-MM-JJ » range la réponse comme les autres, et le
   back office la relit avec le reste. */

import { useState } from 'react';
import * as db from '../data/db';
import type { Lang } from '../data/types';
import { C, F, R } from '../design/theme';
import { coachDe } from '../data/coachs';
import { CoachAvatar } from './CoachAvatar';
import { Icon } from './Icon';
import type { App } from '../state/useApp';

const T: Record<Lang, Record<string, string>> = {
  fr: {
    ouvrir: 'Le mot du coach',
    question: 'Regarde ma journée : ce que mon matin dit de ma forme, ce que la séance d’aujourd’hui me demande, et pourquoi elle tombe là dans le plan. Deux à quatre phrases.',
    encours: 'Il regarde ta journée…',
    fermer: 'Fermer',
    repos: 'Journée de repos : dis-moi en deux phrases ce que ça vaut dans mon plan, et ce que je fais du reste de ma journée.',
  },
  pl: {
    ouvrir: 'Słowo trenera',
    question: 'Spójrz na mój dzień: co poranek mówi o mojej formie, czego wymaga dzisiejszy trening i dlaczego wypada właśnie tu w planie. Dwa do czterech zdań.',
    encours: 'Czyta twój dzień…',
    fermer: 'Zamknij',
    repos: 'Dzień odpoczynku: powiedz w dwóch zdaniach, ile jest wart w moim planie i co robię z resztą dnia.',
  },
};

/** Ce que le coach a sous les yeux : le jour, la forme du matin, la séance. */
function contexteDuJour(date: string, lang: Lang): string {
  const jour = db.select('msc_session', (s) => s.date === date && s.discipline !== 'Repos');
  const mesure = db.select('msc_mesure', (m) => m.date <= date).slice(-1)[0];
  const lignes: string[] = [`Jour : ${date}`];
  if (mesure) {
    lignes.push([
      `Ce matin : ${mesure.date}`,
      mesure.fc_repos ? `FC repos ${mesure.fc_repos} bpm` : null,
      mesure.hrv_ms ? `HRV ${mesure.hrv_ms} ms` : null,
      mesure.poids_kg ? `${mesure.poids_kg} kg` : null,
    ].filter(Boolean).join(' · '));
  }
  for (const s of jour) {
    lignes.push([
      `Séance : ${s.titre[lang]}`,
      `${s.discipline} · ${db.type(s.type).label[lang]} · ${s.duree_min} min · RPE ${s.rpe_cible}`,
      `semaine ${s.semaine} · bloc ${s.bloc} · ${s.phase}`,
      s.zones.length ? `allures : ${s.zones.map((z) => `${db.zone(z).label[lang]} ${db.allure(z, s.bloc)}`).join(' · ')}` : null,
      s.detail[lang],
    ].filter(Boolean).join('\n'));
  }
  if (jour.length === 0) lignes.push('Aucune séance aujourd’hui : jour de repos.');
  return lignes.join('\n');
}

export function MotDuCoach({ app, taille = 38 }: { app: App; taille?: number }) {
  const lang = app.lang;
  const t = T[lang];
  const [ouvert, setOuvert] = useState(false);
  const coach = coachDe(db.athlete.coach);
  const cle = `jour:${app.date}`;
  const tours = app.chats[cle] ?? [];
  const dernier = [...tours].reverse().find((x) => x.role === 'assistant');
  const encours = app.chatEnCours === cle;

  const demander = () => {
    setOuvert(true);
    if (dernier || encours) return;
    const aDesSeances = db.select('msc_session', (s) => s.date === app.date && s.discipline !== 'Repos').length > 0;
    void app.demanderCoach(cle, aDesSeances ? t.question : t.repos, contexteDuJour(app.date, lang));
  };

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        onClick={demander}
        aria-label={`${t.ouvrir} — ${coach.nom[lang]}`}
        style={{
          display: 'block', padding: 0, border: 'none', background: 'transparent',
          lineHeight: 0, position: 'relative',
        }}
      >
        <CoachAvatar code={db.athlete.coach} taille={taille} />
        {/* la bulle : ce qui dit qu'il a quelque chose à dire */}
        <span
          style={{
            position: 'absolute', right: -3, top: -3,
            width: 17, height: 17, borderRadius: R.full,
            background: C.accent, color: C.accentInk,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: `2px solid ${C.surface}`, boxSizing: 'border-box',
          }}
        >
          <Icon name="message-circle" size={9} />
        </span>
      </button>

      {ouvert && (
        <>
          {/* le voile : toucher à côté referme, comme une feuille */}
          <div
            onClick={() => setOuvert(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 79 }}
          />
          <div
            role="dialog"
            aria-label={t.ouvrir}
            style={{
              position: 'absolute', top: taille + 10, right: 0, zIndex: 80,
              width: 'min(300px, calc(100vw - 32px))',
              background: C.surface, borderRadius: R.card, border: `1px solid ${C.border}`,
              boxShadow: C.shadowSheet, padding: '12px 14px',
              display: 'flex', flexDirection: 'column', gap: 8,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <CoachAvatar code={db.athlete.coach} taille={26} />
              <span style={{ fontSize: 12.5, fontWeight: 600, color: C.ink }}>{coach.nom[lang]}</span>
            </div>
            <div style={{ fontSize: 13, color: C.inkBody, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
              {encours
                ? <span style={{ color: C.inkQuiet }}>{t.encours}</span>
                : dernier?.texte
                  ?? <span style={{ color: C.negative }}>{app.chatErreur ?? ''}</span>}
            </div>
            {!encours && !dernier && !app.chatErreur && (
              <div style={{ fontSize: 11.5, color: C.inkQuiet, fontStyle: 'italic' }}>{coach.devise[lang]}</div>
            )}
            <button
              type="button"
              onClick={() => setOuvert(false)}
              style={{
                alignSelf: 'flex-start', padding: '5px 10px', borderRadius: R.full,
                border: `1px solid ${C.border}`, background: C.surface,
                color: C.inkSecondary, fontSize: 11.5, fontWeight: 600, fontFamily: F.body,
              }}
            >
              {t.fermer}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
