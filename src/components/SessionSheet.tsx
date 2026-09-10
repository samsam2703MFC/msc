/* A session, opened from the week: its type and why it exists, the paces
   computed for its block, the run sheet, and a chat bar about this session. */

import * as db from '../data/db';
import type { Lang } from '../data/types';
import { C, R } from '../design/theme';
import { ChatBar, Conversation } from '../screens/CoachScreen';
import { visuelDuStatut } from '../data/statut';
import { Icon } from './Icon';
import { GainPill, SheetHeading } from './SheetHeading';
import { Card, Grid, IconLine, Mono } from './primitives';
import { Sheet, SheetCloseButton } from './Sheet';
import type { App } from '../state/useApp';

/* « Faite ? » — la coche de l'athlète sur une séance passée. Strava compte à
   part ; ici c'est ce qu'il dit, lui, et ça prime. */
const FAITE: Record<Lang, Record<string, string>> = {
  fr: {
    question: 'Faite ?', oui: 'Faite', non: 'Pas faite',
    fait: 'faite', partiel: 'faite autrement', manque: 'manquée', aujourdhui: 'aujourd’hui', prevu: 'à venir', repos: 'repos', adapte: 'adaptée',
    strava: 'Strava a apparié',
  },
  pl: {
    question: 'Zrobiony?', oui: 'Zrobiony', non: 'Nie zrobiony',
    fait: 'zrobiony', partiel: 'zrobiony inaczej', manque: 'pominięty', aujourdhui: 'dzisiaj', prevu: 'zaplanowany', repos: 'odpoczynek', adapte: 'dostosowany',
    strava: 'Strava dopasowała',
  },
};

/* Suggested openers — UI copy, so they sit with the component, not in msc_. */
const CHAT: Record<Lang, { placeholder: string; prompts: string[] }> = {
  fr: {
    placeholder: 'Une question sur cette séance',
    prompts: ['Je peux la déplacer ?', 'Trop dur pour moi ?', 'Comment je la rate ?'],
  },
  pl: {
    placeholder: 'Pytanie o ten trening',
    prompts: ['Mogę go przenieść?', 'Za trudny dla mnie?', 'Jak go zepsuć?'],
  },
};

export function SessionSheet({ app, sessionId }: { app: App; sessionId: number }) {
  const lang = app.lang;
  const ui = db.ui(lang);

  const session = db.mustOne('msc_session', (r) => r.id === sessionId);
  const type = db.type(session.type);
  const chat = CHAT[lang];

  /* One thread per session, and the session itself is what the coach is asked
     about — so the brief goes with every question rather than being restated. */
  const cle = `session:${session.id}`;
  const contexte = [
    `Séance : ${session.titre[lang]}`,
    `${session.jour_long} ${session.date} · semaine ${session.semaine} · bloc ${session.bloc} · ${session.discipline}`,
    `${session.duree_min} min · RPE cible ${session.rpe_cible} · charge ${session.charge}`,
    session.detail[lang],
  ].join('\n');

  /* Paces are derived for the session's block, not stored on the session. */
  const paces = session.zones.map((code) => ({
    zone: db.zone(code),
    valeur: db.allure(code, session.bloc),
  }));

  return (
    <Sheet
      onClose={app.closeSession}
      zIndex={85}
      label={session.titre[lang]}
      paddingBottom={40}
      gap={14}
      scrollable
    >
      <SheetHeading
        icon={type.icon}
        color={type.color}
        eyebrow={type.label[lang]}
        eyebrowColor={type.color}
        title={session.titre[lang]}
        titleSize={19}
        trailing={<GainPill>{type.gain[lang]}</GainPill>}
        onType={() => app.openType(type.code)}
      />

      {session.type !== 'repos' && session.date <= app.date && <Faite app={app} sessionId={session.id} />}

      <IconLine icon="target">{session.detail[lang]}</IconLine>

      {db.consigne(session, lang) && (
        <IconLine icon="circle-check" iconColor={C.inkSecondary} color={C.inkMuted}>
          {db.consigne(session, lang)}
        </IconLine>
      )}

      {paces.length > 0 && (
        <Grid cols={3} gap={10}>
          {paces.map(({ zone, valeur }) => (
            <div
              key={zone.code}
              style={{
                borderRadius: 12,
                border: `1px solid ${C.border}`,
                padding: 10,
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: C.inkSecondary }}>
                <Icon name={zone.icon} size={13} />
                <div style={{ fontSize: 10 }}>{zone.label[lang]}</div>
              </div>
              <Mono size={14} color={C.ink}>
                {valeur}
              </Mono>
            </div>
          ))}
        </Grid>
      )}

      <Card background={C.page} padding={14} gap={6} style={{ borderRadius: 12, boxShadow: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Mono size={11} color={C.inkQuiet}>
            {`${session.duree_min} min × RPE ${session.rpe_cible}`}
          </Mono>
          <Mono size={14} color={C.ink}>
            {`${lang === 'fr' ? 'charge' : 'obciążenie'} ${session.charge}`}
          </Mono>
        </div>
        <Mono size={11} color={C.inkQuiet}>
          {`${session.jour_long} ${session.date} · ${session.phase}`}
        </Mono>
      </Card>

      <Conversation
        tours={app.chats[cle] ?? []}
        busy={app.chatEnCours === cle}
        erreur={app.chatErreur}
        thinking={ui.chatThinking}
      />
      <ChatBar
        placeholder={chat.placeholder}
        busy={app.chatEnCours !== null}
        onSend={(q) => void app.demanderCoach(cle, q, contexte)}
      />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {chat.prompts.map((q) => (
          <button
            key={q}
            type="button"
            className="msc-hover-accent"
            onClick={() => void app.demanderCoach(cle, q, contexte)}
            disabled={app.chatEnCours !== null}
            style={{
              padding: '6px 10px',
              borderRadius: 999,
              border: `1px solid ${C.border}`,
              fontSize: 11,
              color: C.inkMuted,
            }}
          >
            {q}
          </button>
        ))}
      </div>

      <SheetCloseButton label={ui.modalClose} onClick={app.closeSession} />
    </Sheet>
  );
}

/* L'état de la séance et les deux boutons. La coche s'enregistre tout de
   suite ; toucher de nouveau la même la retire (on revient à ce que Strava
   dit). En lecture seule, l'état se lit sans se changer. */
function Faite({ app, sessionId }: { app: App; sessionId: number }) {
  const lang = app.lang;
  const t = FAITE[lang];
  const session = db.mustOne('msc_session', (r) => r.id === sessionId);
  const statut = db.statutDe(session, app.date, db.etatDesSeances());
  const visuel = visuelDuStatut(statut);
  const coche = db.one('msc_journal', (j) => j.session_id === sessionId)?.fait ?? null;
  const activite = db.one('msc_activity', (a) => a.session_id === sessionId);
  const lecture = db.droit !== 'ecriture';

  const bouton = (valeur: boolean, icon: string, couleur: string, label: string) => {
    const actif = coche === valeur;
    return (
      <button
        type="button"
        className="msc-hover-accent"
        aria-pressed={actif}
        disabled={lecture}
        onClick={() => void app.marquerSeance(sessionId, actif ? null : valeur)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: R.full,
          border: `1px solid ${actif ? couleur : C.border}`,
          background: actif ? `${couleur}1A` : C.surface,
          color: actif ? couleur : C.inkMuted, fontSize: 12, fontWeight: 600,
          opacity: lecture ? 0.6 : 1,
        }}
      >
        <Icon name={icon} size={14} />
        {label}
      </button>
    );
  };

  return (
    <Card background={C.page} padding={14} gap={10} style={{ borderRadius: 12, boxShadow: 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: C.inkSecondary }}>{t.question}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: C.ink }}>
          <Icon name={visuel.icon} size={14} color={visuel.couleur} />
          {t[statut] ?? statut}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {bouton(true, 'circle-check', C.accentDeep, t.oui)}
        {bouton(false, 'circle-x', C.negative, t.non)}
      </div>
      {activite && (
        <Mono size={11} color={C.inkQuiet}>
          {`${t.strava} ${activite.duree_min} min · ${activite.sport}`}
        </Mono>
      )}
    </Card>
  );
}
