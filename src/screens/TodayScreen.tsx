/* Aujourd'hui — the day's session, the journal, and Claude's read of it.
   Everything is a select on the msc_ tables; nothing is hard-coded. */

import * as db from '../data/db';
import type { Lang } from '../data/types';
import { C, F, R } from '../design/theme';
import { Icon } from '../components/Icon';
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
import { TODAY_ID } from '../state/useApp';

/** Blocks are compared against a 295s floor so the drift is readable. */
const SPLIT_FLOOR = 295;

export function TodayScreen({ app }: { app: App }) {
  const lang: Lang = app.lang;
  const ui = db.ui(lang);

  const today = db.mustOne('msc_session', (r) => r.id === TODAY_ID);
  const activity = db.mustOne('msc_activity', (r) => r.session_id === TODAY_ID);
  const analyse = db.mustOne(
    'msc_analyse',
    (r) => r.type === 'seance' && r.session_id === TODAY_ID,
  );
  const adaptation = db.mustOne('msc_adaptation', (r) => r.analyse_id === analyse.id);

  const todayType = db.type(today.type);
  const nextType = db.type(adaptation.type);

  const paces = (today.zones ?? []).map((code) =>
    db.mustOne('msc_zone', (r) => r.code === code && r.bloc === today.bloc),
  );
  const steps = db
    .select('msc_session_step', (r) => r.session_id === TODAY_ID)
    .sort((a, b) => a.ordre - b.ordre);

  const anaRunning = app.ana === 'running';
  const anaDone = app.ana === 'done';

  const splits = activity.splits_blocs ?? [];
  const splitTop = splits[splits.length - 1] ?? SPLIT_FLOOR + 1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* the session itself */}
      <Card featured gap={14}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <TypeChip
            label={todayType.label[lang]}
            icon={todayType.icon}
            color={todayType.color}
            onClick={() => app.openType(todayType.code)}
            info
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.inkSecondary }}>
            <Icon name="clock" size={14} />
            <Mono>{`${today.duree_min} min`}</Mono>
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
          {today.titre[lang]}
        </div>

        {today.but && <IconLine icon="target">{today.but[lang]}</IconLine>}
        {today.reussite && (
          <IconLine icon="circle-check" iconColor={C.inkSecondary} color={C.inkMuted}>
            {today.reussite[lang]}
          </IconLine>
        )}
      </Card>

      {/* paces, computed from msc_zone for this block */}
      <Grid cols={3} gap={10}>
        {paces.map((z) => (
          <Card key={z.code} padding={12} gap={6}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: C.inkSecondary }}>
              <Icon name={z.icon} size={14} />
              <div style={{ fontSize: 10 }}>{z.label[lang]}</div>
            </div>
            <Mono size={15} color={C.ink}>
              {z.allure}
            </Mono>
          </Card>
        ))}
      </Grid>

      {/* the run sheet */}
      <Card padding="16px 18px" gap={10}>
        {steps.map((s) => (
          <IconLine
            key={s.ordre}
            icon={s.icon}
            iconSize={16}
            lead={s.duree}
            fontSize={13}
            lineHeight={1.45}
          >
            {s.detail[lang]}
          </IconLine>
        ))}
      </Card>

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
            <Mono size={20} color={C.ink}>
              {app.rpe}
            </Mono>
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

        <textarea
          placeholder={ui.notePlaceholder}
          rows={2}
          value={app.note}
          onChange={(e) => app.setNote(e.target.value)}
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

      {/* Claude's read of the session, and what it does to tomorrow */}
      <Card borderColor={anaDone ? C.accent : C.border} gap={14}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <SectionLabel icon="sparkles" color={C.teal}>
            {ui.anaLabel}
          </SectionLabel>
          <Mono size={10} color={C.inkQuiet}>
            {analyse.modele}
          </Mono>
        </div>

        <AccentButton
          label={anaRunning ? ui.anaRunning : anaDone ? ui.anaDoneBtn : ui.anaIdle}
          icon={anaRunning ? 'loader' : anaDone ? 'rotate-ccw' : 'sparkles'}
          active={anaRunning || anaDone}
          onClick={app.runAnalyse}
        />

        {anaDone && (
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

            <BarChart
              height={52}
              gap={6}
              labels={splits.map((_, i) => `B${i + 1}`)}
              data={splits.map((v, i) => ({
                h: `${Math.round(((v - SPLIT_FLOOR) / (splitTop - SPLIT_FLOOR)) * 100)}%`,
                bg: i === splits.length - 1 ? C.warning : C.accentBar,
              }))}
            />

            <div style={{ fontSize: 14, lineHeight: 1.5, color: C.inkBody }}>
              {analyse.verdict[lang]}
            </div>

            {/* the adaptation — a proposal, applied only on demand */}
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
                <Mono size={11} color={C.inkQuiet} style={{ textDecoration: 'line-through' }}>
                  {adaptation.session_avant[lang]}
                </Mono>
                <Icon name="arrow-right" size={14} color={C.accentDeep} />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <TypeChip
                  label={nextType.label[lang]}
                  icon={nextType.icon}
                  color={nextType.color}
                  onClick={() => app.openType(nextType.code)}
                  compact
                />
                <Mono size={13} color={C.ink}>
                  {adaptation.session_apres}
                </Mono>
              </div>

              <div style={{ fontSize: 13, lineHeight: 1.45, color: C.inkMuted }}>
                {adaptation.pourquoi[lang]}
              </div>

              <AccentButton
                label={app.nextApplied ? ui.applyOn : ui.applyOff}
                icon={app.nextApplied ? 'check' : 'wand-sparkles'}
                active={app.nextApplied}
                onClick={app.toggleNextApplied}
                full={false}
                size="sm"
              />
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
