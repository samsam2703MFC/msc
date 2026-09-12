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
import { Sheet, SheetCloseButton } from './Sheet';
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

  /* Pas de `position: relative` ici : la feuille se pose sur le cadre de
     l'application, pas dans les 38 pixels de l'avatar. */
  return (
    <div style={{ flexShrink: 0 }}>
      <button
        type="button"
        onClick={demander}
        aria-label={`${t.ouvrir} — ${coach.nom[lang]}`}
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
          padding: 0, border: 'none', background: 'transparent', cursor: 'pointer',
        }}
      >
        <span style={{ position: 'relative', lineHeight: 0 }}>
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
        </span>
        {/* Sous l'avatar, son nom : sinon on ne sait pas qui va parler. */}
        <span
          style={{
            fontSize: 10, fontWeight: 600, color: C.inkSecondary, lineHeight: 1,
            maxWidth: taille + 24, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          {coach.nom[lang]}
        </span>
      </button>

      {/* Une feuille, et pas une bulle accrochée à l'avatar : accrochée, elle
          sortait par la gauche de l'écran dès que le texte dépassait deux
          lignes — et c'est le panneau que toute l'application utilise déjà. */}
      {ouvert && (
        <Sheet onClose={() => setOuvert(false)} zIndex={110} label={t.ouvrir} gap={12}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <CoachAvatar code={db.athlete.coach} taille={40} />
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <span style={{ fontFamily: F.display, fontSize: 17, fontWeight: 700, color: C.ink }}>
                {coach.nom[lang]}
              </span>
              <span style={{ fontSize: 11.5, color: C.inkQuiet }}>{t.ouvrir}</span>
            </div>
          </div>
          <div style={{ fontSize: 14.5, color: C.inkBody, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
            {encours
              ? <span style={{ color: C.inkQuiet }}>{t.encours}</span>
              : dernier?.texte
                ?? <span style={{ color: C.negative }}>{app.chatErreur ?? ''}</span>}
          </div>
          {!encours && !dernier && !app.chatErreur && (
            <div style={{ fontSize: 12.5, color: C.inkQuiet, fontStyle: 'italic' }}>{coach.devise[lang]}</div>
          )}
          <SheetCloseButton label={t.fermer} onClick={() => setOuvert(false)} />
        </Sheet>
      )}
    </div>
  );
}
