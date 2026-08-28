/* App state. Mirrors the prototype's state machine one-for-one:
   the analysis and the plan recalculation are the two async steps, everything
   else is a toggle. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as db from '../data/db';
import type { Lang, ScreenKey, TypeCode } from '../data/types';

const ANALYSE_MS = 1400;
const RECALC_MS = 1500;
const LANG_KEY = 'msc.lang';

export type Job = 'idle' | 'running' | 'done';

function storedLang(): Lang {
  try {
    const v = localStorage.getItem(LANG_KEY);
    if (v === 'fr' || v === 'pl') return v;
  } catch {
    /* private mode, or storage disabled — fall through to the default */
  }
  return 'fr';
}

export function useApp() {
  const [screen, setScreen] = useState<ScreenKey>('today');

  /* Where the plan is. Defaults to the real date, clamped into the plan's
     span; the settings sheet lets you move it to walk the thirty weeks. */
  const [date, setDate] = useState(() => db.positionDuPlan(db.aujourdhuiISO()).date);
  const semaine = useMemo(() => db.positionDuPlan(date).semaine, [date]);

  const [lang, setLangState] = useState<Lang>(storedLang);
  const [stravaOn, setStravaOn] = useState(false);

  /* Today */
  const [done, setDone] = useState(true);
  const [rpe, setRpe] = useState(8);
  const [note, setNote] = useState('');
  const [ana, setAna] = useState<Job>('done');
  const [nextApplied, setNextApplied] = useState(false);

  /* Coach */
  const [recalc, setRecalc] = useState<Job>('idle');
  const [excuse, setExcuse] = useState<string | null>(null);
  const [excuseApplied, setExcuseApplied] = useState(false);
  const [applied, setApplied] = useState<Record<number, boolean>>({});

  /* Overlays */
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [typeCode, setTypeCode] = useState<TypeCode | null>(null);

  const anaTimer = useRef<number | undefined>(undefined);
  const recalcTimer = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      window.clearTimeout(anaTimer.current);
      window.clearTimeout(recalcTimer.current);
    },
    [],
  );

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(LANG_KEY, next);
    } catch {
      /* preference just won't survive a reload */
    }
  }, []);

  /* Claude reads the session back and answers; re-running replays it. */
  const runAnalyse = useCallback(() => {
    setAna((current) => {
      if (current === 'running') return current;
      window.clearTimeout(anaTimer.current);
      anaTimer.current = window.setTimeout(() => setAna('done'), ANALYSE_MS);
      return 'running';
    });
  }, []);

  /* Recalculating the remaining 27 weeks; a second press folds the result away. */
  const runRecalc = useCallback(() => {
    setRecalc((current) => {
      if (current === 'running') return current;
      if (current === 'done') return 'idle';
      window.clearTimeout(recalcTimer.current);
      recalcTimer.current = window.setTimeout(() => setRecalc('done'), RECALC_MS);
      return 'running';
    });
  }, []);

  const pickExcuse = useCallback((code: string) => {
    setExcuse((current) => (current === code ? null : code));
    setExcuseApplied(false);
  }, []);

  const toggleAdjustment = useCallback((id: number) => {
    setApplied((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const allerA = useCallback((iso: string) => setDate(db.positionDuPlan(iso).date), []);

  return {
    screen,
    setScreen,
    date,
    semaine,
    allerA,
    lang,
    setLang,
    stravaOn,
    toggleStrava: useCallback(() => setStravaOn((v) => !v), []),

    done,
    toggleDone: useCallback(() => setDone((v) => !v), []),
    rpe,
    setRpe,
    note,
    setNote,
    ana,
    runAnalyse,
    nextApplied,
    toggleNextApplied: useCallback(() => setNextApplied((v) => !v), []),

    recalc,
    runRecalc,
    excuse,
    pickExcuse,
    excuseApplied,
    toggleExcuseApplied: useCallback(() => setExcuseApplied((v) => !v), []),
    applied,
    toggleAdjustment,

    settingsOpen,
    openSettings: useCallback(() => setSettingsOpen(true), []),
    closeSettings: useCallback(() => setSettingsOpen(false), []),
    sessionId,
    openSession: useCallback((id: number) => setSessionId(id), []),
    closeSession: useCallback(() => setSessionId(null), []),
    typeCode,
    openType: useCallback((code: TypeCode) => setTypeCode(code), []),
    closeType: useCallback(() => setTypeCode(null), []),
  };
}

export type App = ReturnType<typeof useApp>;
