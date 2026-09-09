/* Aujourd'hui — the day's session out of the plan, its computed paces, the
   journal, and Claude's read of it once the session has been analysed.

   No pace on this screen is stored. Each one is `allure(zone, bloc)`: the
   block's 10 km reference plus the zone's offset. */

import * as db from '../data/db';
import { appliquerAdaptation } from '../data/analyse';
import type { Lang, MscPlanSession } from '../data/types';
import { C, F, R } from '../design/theme';
import { CoachAvatar } from '../components/CoachAvatar';
import { Icon } from '../components/Icon';
import { Limites } from '../components/Limites';
import { Observations } from '../components/Observations';
import {
  AccentButton,
  BarChart,
  Card,
  Grid,
  IconLine,
  Mono,
  SectionLabel,
  StatCell,
  TypeChip,
} from '../components/primitives';
import type { App } from '../state/useApp';

export function TodayScreen({ app }: { app: App }) {
  const lang: Lang = app.lang;
  const ui = db.ui(lang);

  const jour = db.select('msc_session', (s) => s.date === app.date);
  const session = db.sessionDuJour(app.date);
  if (!session) return null;

  const autres = jour.filter((s) => s.id !== session.id);
  const type = db.type(session.type);

  /* Computed, never stored: the block's reference plus each zone's offset. */
  const allures = session.zones.map((code) => ({
    zone: db.zone(code),
    valeur: db.allure(code, session.bloc),
  }));

  const analyse = db.one(
    'msc_analyse',
    (r) => r.type === 'seance' && r.session_id === session.id,
  );
  const adaptation = analyse
    ? db.one('msc_adaptation', (r) => r.analyse_id === analyse.id)
    : undefined;

  const anaRunning = app.ana === 'running';
  const anaDone = app.ana === 'done' && !!analyse;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Card featured gap={14}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <TypeChip
            label={type.label[lang]}
            icon={type.icon}
            color={type.color}
            onClick={() => app.openType(type.code)}
            info
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.inkSecondary }}>
            <Icon name="clock" size={14} />
            <Mono>{session.meta[lang]}</Mono>
          </div>
        </div>

        <div
          style={{
            fontFamily: F.display,
            fontSize: 22,
            fontWeight: 600,
            lineHeight: 1.2,
            letterSpacing: '-0.01em',
          }}
        >
          {(session.titre_court ?? session.titre)[lang]}
        </div>

        <IconLine icon="target">{session.detail[lang]}</IconLine>

        {db.consigne(session, lang) && (
          <IconLine icon="circle-check" iconColor={C.inkSecondary} color={C.inkMuted}>
            {db.consigne(session, lang)}
          </IconLine>
        )}
      </Card>

      {/* the paces the engine derives for this block */}
      {allures.length > 0 && (
        <Grid cols={allures.length >= 3 ? 3 : allures.length} gap={10}>
          {allures.map((a) => (
            <Card key={a.zone.code} padding={12} gap={6}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: C.inkSecondary }}>
                <Icon name={a.zone.icon} size={14} />
                <div style={{ fontSize: 10 }}>{a.zone.label[lang]}</div>
              </div>
              <Mono size={15} color={C.ink}>
                {a.valeur}
              </Mono>
            </Card>
          ))}
        </Grid>
      )}

      {/* planned load — durée × RPE, the workbook's own metric */}
      <Card padding="14px 18px" gap={8}>
        <SectionLabel icon="scale">{lang === 'fr' ? 'Charge planifiée' : 'Planowane obciążenie'}</SectionLabel>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <Mono size={20} color={C.ink}>
            {session.charge}
          </Mono>
          <Mono size={11} color={C.inkQuiet}>
            {`${session.duree_min} min × RPE ${session.rpe_cible}`}
          </Mono>
        </div>
      </Card>

      {autres.length > 0 && <AussiAujourdhui sessions={autres} app={app} />}

      {/* the journal — the one table filled in by hand each day */}
      <Card gap={16}>
        <AccentButton
          label={app.done ? ui.doneOn : ui.doneOff}
          icon={app.done ? 'check' : 'circle'}
          active={app.done}
          onClick={app.toggleDone}
        />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <label
              htmlFor="msc-rpe"
              style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.inkSecondary }}
            >
              <Icon name="activity" size={15} />
              <div style={{ fontSize: 12 }}>{ui.rpeLabel}</div>
            </label>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <Mono size={20} color={C.ink}>
                {app.rpe}
              </Mono>
              <Mono size={11} color={C.inkQuiet}>
                {`charge ${db.charge(session.duree_min, app.rpe)}`}
              </Mono>
            </div>
          </div>
          <input
            id="msc-rpe"
            type="range"
            min={1}
            max={10}
            step={1}
            value={app.rpe}
            onChange={(e) => app.setRpe(Number(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>

        {/* Ce qui a bloqué — demandé après chaque séance, et poussé dès que
            Strava en ramène une sans réponse. Le coach le lit avant d'ajuster. */}
        <Limites
          lang={lang}
          valeur={app.limites}
          onToggle={app.toggleLimite}
          disabled={db.droit !== 'ecriture'}
          nudge={app.limites.length === 0 && !!db.one('msc_activity', (a) => a.session_id === session.id)}
        />

        <textarea
          placeholder={ui.notePlaceholder}
          rows={2}
          value={app.note}
          onChange={(e) => app.setNote(e.target.value)}
          onBlur={() => void app.enregistrerJournal()}
          style={{
            width: '100%',
            resize: 'none',
            borderRadius: R.md,
            border: `1px solid ${C.border}`,
            background: C.page,
            color: C.ink,
            padding: 12,
            fontFamily: F.body,
            fontSize: 14,
          }}
        />
      </Card>

      {/* Claude's read of the session — only where there is one */}
      <Card borderColor={anaDone ? C.accent : C.border} gap={14}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          {/* Le coach choisi, en tête : c'est lui qui parle. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <CoachAvatar code={db.athlete.coach} taille={30} />
            <SectionLabel icon="sparkles" color={C.teal}>
              {ui.anaLabel}
            </SectionLabel>
          </div>
          <Mono size={10} color={C.inkQuiet}>
            {analyse?.modele ?? '—'}
          </Mono>
        </div>

        <AccentButton
          label={anaRunning ? ui.anaRunning : anaDone ? ui.anaDoneBtn : ui.anaIdle}
          icon={anaRunning ? 'loader' : anaDone ? 'rotate-ccw' : 'sparkles'}
          active={anaRunning || anaDone}
          onClick={app.runAnalyse}
        />

        {/* A call that failed says so. The panel below is the previous
            analysis, if there was one — it is not this one. */}
        {app.anaErreur && (
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              padding: '8px 10px',
              borderRadius: 10,
              background: C.warningBg,
              color: C.warning,
              fontSize: 11,
              lineHeight: 1.4,
            }}
          >
            <Icon name="triangle-alert" size={14} />
            <span>{app.anaErreur}</span>
          </div>
        )}

        {anaDone && analyse && (
          <Analyse
            lang={lang}
            ui={ui}
            analyse={analyse}
            adaptation={adaptation}
            app={app}
            cible={session.zones[0] ? db.allureSecondes(session.zones[0], session.bloc) : undefined}
          />
        )}
      </Card>
    </div>
  );
}

/** Swim in the morning, bike at night — the plan doubles up most Tuesdays. */
function AussiAujourdhui({ sessions, app }: { sessions: MscPlanSession[]; app: App }) {
  const lang = app.lang;
  return (
    <Card padding="14px 16px" gap={10}>
      <SectionLabel icon="calendar-days">
        {lang === 'fr' ? "Aussi aujourd'hui" : 'Także dzisiaj'}
      </SectionLabel>
      {sessions.map((s) => {
        const t = db.type(s.type);
        return (
          <button
            key={s.id}
            type="button"
            className="msc-hover-surface"
            onClick={() => app.openSession(s.id)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, borderRadius: 8 }}
          >
            <Icon name={t.icon} size={16} color={t.color} />
            <div style={{ flex: 1, minWidth: 0, fontSize: 13, color: C.ink, textAlign: 'left' }}>
              {s.titre_court[lang]}
            </div>
            <Mono size={11} color={C.inkQuiet}>
              {s.meta[lang]}
            </Mono>
          </button>
        );
      })}
    </Card>
  );
}

function Analyse({
  lang,
  ui,
  analyse,
  adaptation,
  app,
  cible,
}: {
  lang: Lang;
  ui: ReturnType<typeof db.ui>;
  analyse: NonNullable<ReturnType<typeof db.one<'msc_analyse'>>>;
  adaptation: ReturnType<typeof db.one<'msc_adaptation'>>;
  app: App;
  cible?: number;
}) {
  const activity = db.one('msc_activity', (a) => a.session_id === analyse.session_id);
  const splits = activity?.splits_blocs ?? [];
  const visee = adaptation
    ? db.one('msc_session', (s) => s.id === adaptation.session_id)
    : undefined;
  /* La proposition est une zone et une part ; ce que ça donne — la ligne barrée
     et celle qui la remplace — se calcule ici, avec le moteur. */
  const applique = adaptation && visee ? appliquerAdaptation(adaptation, visee) : undefined;
  /* Bars are read against the target pace, so the drift is the story. */
  const base = cible ?? Math.min(...splits);
  const top = Math.max(...splits, base + 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Grid cols={3} gap={10}>
        {(analyse.stats ?? []).map((s) => (
          <StatCell
            key={s.label[lang]}
            icon={s.icon}
            value={s.valeur}
            label={s.label[lang]}
            color={s.couleur}
          />
        ))}
      </Grid>

      {splits.length > 0 && (
        <BarChart
          height={52}
          gap={6}
          labels={splits.map((_, i) => `B${i + 1}`)}
          data={splits.map((v, i) => ({
            h: `${Math.max(8, Math.round(((v - base + 2) / (top - base + 2)) * 100))}%`,
            bg: i === splits.length - 1 ? C.warning : C.accentBar,
          }))}
        />
      )}

      <div style={{ fontSize: 14, lineHeight: 1.5, color: C.inkBody }}>{analyse.verdict[lang]}</div>

      {/* ce qui va, ce qui ne va pas, ce que ça change au plan */}
      <Observations analyse={analyse} lang={lang} />

      {/* La proposition est une zone et une part ; les minutes et l'allure se
          calculent ici, avec le moteur, donc elles suivent la référence. */}
      {adaptation && visee && applique && (
        <div
          style={{
            borderRadius: 12,
            background: C.page,
            border: `1px solid ${C.border}`,
            padding: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <SectionLabel icon="wand-sparkles" color={C.teal}>
            {ui.nextLabel}
          </SectionLabel>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Le « avant » vient de la proposition, pas de la séance : une fois
                acceptée, la séance PORTE la nouvelle durée, et lire `visee` ici
                écrirait « 54 min → 54 min ». */}
            <Mono size={11} color={C.inkQuiet} style={{ textDecoration: 'line-through' }}>
              {`${visee.titre_court[lang]} · ${applique.session_avant}`}
            </Mono>
            <Icon name="arrow-right" size={14} color={C.accentDeep} />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <TypeChip
              label={db.type(visee.type).label[lang]}
              icon={db.type(visee.type).icon}
              color={db.type(visee.type).color}
              onClick={() => app.openType(visee.type)}
              compact
            />
            <Mono size={13} color={C.ink}>
              {applique.session_apres}
            </Mono>
          </div>

          <div style={{ fontSize: 13, lineHeight: 1.45, color: C.inkMuted }}>
            {adaptation.pourquoi[lang]}
          </div>

          {/* L'acceptation part au serveur : c'est une décision de l'athlète,
              elle doit survivre au rechargement de la page. */}
          <AccentButton
            label={adaptation.applique ? ui.applyOn : ui.applyOff}
            icon={adaptation.applique ? 'check' : 'wand-sparkles'}
            active={adaptation.applique}
            onClick={() =>
              void app.accepter('msc_adaptation', adaptation.id, !adaptation.applique)
            }
            full={false}
            size="sm"
          />
        </div>
      )}
    </div>
  );
}
