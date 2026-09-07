/* Coach — the real life of an athlete first (the five reasons a day goes
   sideways), then the gap the plan has drifted into, then the weekly verdict
   and the adjustments to accept one by one. */

import { useState } from 'react';

import * as db from '../data/db';
import { ecartDeSemaine } from '../data/analyse';
import type { TourDeChat } from '../data/analyse';
import { C, F, R } from '../design/theme';
import { Icon } from '../components/Icon';
import {
  AccentButton,
  Card,
  Grid,
  IconLine,
  Mono,
  SectionLabel,
  StatCell,
  TypeSquare,
} from '../components/primitives';
import type { App } from '../state/useApp';

export function CoachScreen({ app }: { app: App }) {
  const lang = app.lang;
  const ui = db.ui(lang);

  const weekly = db.one('msc_analyse', (r) => r.type === 'hebdo' && r.semaine === app.semaine);

  /* The gap is arithmetic: planned against done, for the sessions that have
     come due. It is recomputed on every render and exists for every week — so
     the recalculation can be asked for anywhere, not only where a row happens
     to have been seeded. What is stored is Claude's reading of it. */
  const calcule = ecartDeSemaine(app.semaine, app.date);
  const ecart = db.one('msc_ecart', (r) => r.semaine === app.semaine);
  const enRetard = calcule.retard_min > 0 || calcule.sautees > 0;
  const excuses = db.select('msc_excuse');
  const picked = app.excuse ? db.mustOne('msc_excuse', (r) => r.code === app.excuse) : null;
  const adjustments = weekly ? db.select('msc_ajustement', (r) => r.analyse_id === weekly.id) : [];

  /* The rules are evaluated, not narrated: these are the signals the app has
     for the current week, and `evaluer` decides which rules fire. */
  const signaux = {
    rpe_qualite: app.rpe,
    derive_longue: db.athlete.derive_reference_pct,
    fc_repos_delta: 0,
  };
  const declenchees = db.evaluer(signaux);
  const codesDeclenches = new Set(declenchees.map((r) => r.code));

  const recRunning = app.recalc === 'running';
  const recDone = app.recalc === 'done';

  /* '2026-10-18' → '18/10' */
  const stamp = weekly ? `${weekly.date.slice(8)}/${weekly.date.slice(5, 7)} · ${weekly.modele}` : '—';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* today is not going to go as planned */}
      <Card padding="16px 18px">
        <SectionLabel icon="circle-help">{ui.excuseLabel}</SectionLabel>

        <Grid cols={2} gap={8}>
          {excuses.map((e) => {
            const on = app.excuse === e.code;
            return (
              <button
                key={e.code}
                type="button"
                className="msc-hover-accent"
                aria-pressed={on}
                onClick={() => app.pickExcuse(e.code)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 12px',
                  minHeight: 56,
                  borderRadius: 12,
                  border: `1px solid ${on ? C.accent : C.border}`,
                  background: on ? C.accentSoft : C.surface,
                  color: on ? C.accentDeep : C.inkMuted,
                }}
              >
                <Icon name={e.icon} size={16} />
                <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.3, textAlign: 'left' }}>
                  {e.label[lang]}
                </div>
              </button>
            );
          })}
        </Grid>

        {picked && (
          <div
            style={{
              borderRadius: 12,
              background: C.page,
              border: `1px solid ${C.accent}`,
              padding: 14,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <SectionLabel icon="bot" color={C.teal}>
              {ui.excuseAnswer}
            </SectionLabel>
            <div style={{ fontSize: 14, lineHeight: 1.5, color: C.inkBody }}>
              {picked.reponse[lang]}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <TypeSquare
                icon={db.type(picked.type).icon}
                color={db.type(picked.type).color}
                size={30}
                label={db.type(picked.type).label[lang]}
                onClick={() => app.openType(picked.type)}
              />
              <Mono size={13} color={C.ink}>
                {picked.remplacement[lang]}
              </Mono>
            </div>
            <AccentButton
              label={app.excuseApplied ? ui.applyOn : ui.applyOff}
              icon={app.excuseApplied ? 'check' : 'wand-sparkles'}
              active={app.excuseApplied}
              onClick={app.toggleExcuseApplied}
              full={false}
              size="sm"
            />
          </div>
        )}
      </Card>

      <ReglesCard app={app} declenchees={codesDeclenches} />

      {/* the gap — recalculated, never made up for */}
      <div
        style={{
          borderRadius: R.card,
          background: enRetard ? C.warningBg : C.surface,
          border: `1px solid ${enRetard ? C.warning : C.border}`,
          padding: 18,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <SectionLabel
          icon={enRetard ? 'triangle-alert' : 'circle-check'}
          color={enRetard ? C.warning : C.accentDeep}
        >
          {enRetard ? ui.gapLabel : ui.gapNone}
        </SectionLabel>

        {/* Claude's reading of the gap — only once it has been asked for. */}
        {ecart && (
          <div style={{ fontSize: 14, lineHeight: 1.5, color: C.inkBody }}>{ecart.texte[lang]}</div>
        )}

        <Grid cols={3} gap={10}>
          {calcule.stats.map((s) => (
            <StatCell
              key={s.label[lang]}
              icon={s.icon}
              value={s.valeur}
              label={s.label[lang]}
              color={enRetard ? C.warning : C.inkSecondary}
            />
          ))}
        </Grid>

        <AccentButton
          label={recRunning ? ui.recalcRunning : recDone ? ui.recalcDoneBtn : ui.recalcIdle}
          icon={recRunning ? 'loader' : recDone ? 'check' : 'refresh-cw'}
          active={recRunning || recDone}
          onClick={app.runRecalc}
        />

        {app.recalcErreur && (
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
            <span>{app.recalcErreur}</span>
          </div>
        )}
      </div>

      {recDone && ecart && (
        <Card featured padding="16px 18px" gap={10}>
          {ecart.recalcul.map((r) => (
            <IconLine
              key={r.portee}
              icon="git-commit-horizontal"
              iconSize={15}
              lead={r.portee}
              leadWidth={52}
              leadSize={11}
              fontSize={13}
              lineHeight={1.45}
            >
              {r.texte[lang]}
            </IconLine>
          ))}
        </Card>
      )}

      {/* the weekly verdict */}
      {weekly && <Card gap={10}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <SectionLabel icon="message-square-quote" color={C.teal}>
            {ui.verdictLabel}
          </SectionLabel>
          <Mono size={10} color={C.inkQuiet}>
            {stamp}
          </Mono>
        </div>
        <div style={{ fontSize: 14, lineHeight: 1.5, color: C.inkBody }}>
          {weekly.verdict[lang]}
        </div>
      </Card>}

      <Grid cols={2} gap={10}>
        {(weekly?.blocs ?? []).map((b) => (
          <Card key={b.icon} padding={14} gap={8}>
            <Icon name={b.icon} size={18} color={b.couleur} />
            {b.items[lang].map((item) => (
              <div key={item} style={{ fontSize: 12, lineHeight: 1.4, color: C.inkBody }}>
                {item}
              </div>
            ))}
          </Card>
        ))}
      </Grid>

      {/* adjustments, accepted one at a time */}
      {adjustments.map((a) => {
        const on = !!app.applied[a.id];
        const type = db.type(a.type);
        return (
          <Card
            key={a.id}
            borderColor={on ? C.accent : C.border}
            padding="14px 16px"
            gap={0}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}
          >
            <TypeSquare
              icon={type.icon}
              color={type.color}
              size={34}
              label={type.label[lang]}
              onClick={() => app.openType(type.code)}
            />
            <div
              style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: C.ink, lineHeight: 1.35 }}>
                {a.quoi[lang]}
              </div>
              <div style={{ fontSize: 11, color: C.inkQuiet }}>{a.quand[lang]}</div>
            </div>
            <button
              type="button"
              className="msc-hover-bright"
              aria-pressed={on}
              aria-label={on ? ui.applyOn : ui.applyOff}
              onClick={() => app.toggleAdjustment(a.id)}
              style={{
                width: 38,
                height: 38,
                borderRadius: R.md,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: on ? C.accentSoft : C.accent,
                color: on ? C.accentDeep : C.accentInk,
                border: `1px solid ${C.accent}`,
                flexShrink: 0,
              }}
            >
              <Icon name={on ? 'check' : 'plus'} size={18} />
            </button>
          </Card>
        );
      })}

      <Conversation
        tours={app.chats.coach ?? []}
        busy={app.chatEnCours === 'coach'}
        erreur={app.chatErreur}
        thinking={ui.chatThinking}
      />
      <ChatBar
        placeholder={ui.askPlaceholder}
        busy={app.chatEnCours !== null}
        onSend={(q) =>
          void app.demanderCoach(
            'coach',
            q,
            `L'athlète regarde la semaine ${app.semaine} (bloc ${db.blocDeSemaine(app.semaine).code}), au ${app.date}.`,
          )
        }
      />
    </div>
  );
}

/** The adjustment rules, and which of them the week's signals currently fire.
    This is the mechanic itself: each rule names a signal and a threshold, so
    the app evaluates them rather than reciting them. */
function ReglesCard({ app, declenchees }: { app: App; declenchees: ReadonlySet<string> }) {
  const lang = app.lang;
  const gravites: Record<string, string> = {
    stop: C.negative,
    allege: C.warning,
    ajuste: C.accentDeep,
  };
  return (
    <Card padding="16px 18px" gap={10}>
      <SectionLabel icon="scale">
        {lang === 'fr' ? "Règles d'ajustement" : 'Reguły dostosowania'}
      </SectionLabel>
      {db.select('msc_regle').map((r) => {
        const on = declenchees.has(r.code);
        return (
          <div
            key={r.code}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              padding: '10px 12px',
              borderRadius: 10,
              border: `1px solid ${on ? C.accent : C.border}`,
              background: on ? C.accentSoft : 'transparent',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 999,
                  background: gravites[r.gravite],
                  flexShrink: 0,
                }}
              />
              <div style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600, color: C.ink }}>
                {r.si[lang]}
              </div>
              {on && <Icon name="circle-check" size={14} color={C.accentDeep} />}
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.4, color: C.inkBody, paddingLeft: 14 }}>
              {r.alors[lang]}
            </div>
            <div style={{ fontSize: 11, lineHeight: 1.4, color: C.inkQuiet, paddingLeft: 14 }}>
              {r.pourquoi[lang]}
            </div>
          </div>
        );
      })}
    </Card>
  );
}

/** The coach's free-text line. */
export function ChatBar({
  placeholder,
  onSend,
  busy,
}: {
  placeholder: string;
  onSend: (question: string) => void;
  busy?: boolean;
}) {
  const [value, setValue] = useState('');
  const pret = value.trim() !== '' && !busy;

  const envoyer = () => {
    if (!pret) return;
    onSend(value.trim());
    setValue('');
  };

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') envoyer();
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        disabled={busy}
        style={{
          flex: 1,
          minWidth: 0,
          borderRadius: R.md,
          border: `1px solid ${C.border}`,
          background: busy ? C.surfaceAlt : C.surface,
          color: C.ink,
          padding: 12,
          fontFamily: F.body,
          fontSize: 14,
        }}
      />
      <button
        type="button"
        className="msc-hover-emerald"
        onClick={envoyer}
        disabled={!pret}
        aria-label={placeholder}
        style={{
          width: 46,
          borderRadius: R.md,
          background: pret ? C.accent : C.surfaceAlt,
          color: pret ? C.accentInk : C.inkQuiet,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={busy ? 'loader' : 'send'} size={18} />
      </button>
    </div>
  );
}

/** The thread above a chat bar. Nothing at all until something has been said. */
export function Conversation({
  tours,
  busy,
  erreur,
  thinking,
}: {
  tours: TourDeChat[];
  busy?: boolean;
  erreur?: string | null;
  thinking: string;
}) {
  if (tours.length === 0 && !busy && !erreur) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {tours.map((t, i) => (
        <div
          key={`${i}-${t.role}`}
          style={{
            alignSelf: t.role === 'user' ? 'flex-end' : 'flex-start',
            maxWidth: '88%',
            borderRadius: 12,
            padding: '9px 12px',
            fontSize: 13,
            lineHeight: 1.45,
            background: t.role === 'user' ? C.accentSoft : C.surface,
            border: `1px solid ${t.role === 'user' ? C.accent : C.border}`,
            color: t.role === 'user' ? C.ink : C.inkBody,
            whiteSpace: 'pre-wrap',
          }}
        >
          {t.texte}
        </div>
      ))}

      {busy && (
        <div
          style={{
            alignSelf: 'flex-start',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 12,
            color: C.inkQuiet,
          }}
        >
          <Icon name="loader" size={14} />
          {thinking}
        </div>
      )}

      {erreur && (
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
          <span>{erreur}</span>
        </div>
      )}
    </div>
  );
}
