/* Le back office : les courses encodées, et ce qu'elles disent de la
   progression.

   Une compétition appartient à l'athlète et pas au plan — c'est ce qui laisse
   les résultats survivre aux plans qui les visaient, et une courbe traverser
   trois ans et quatre plans sans s'en apercevoir. */

import { useState } from 'react';

import * as db from '../data/db';
import { equivalent10k } from '../data/generateur';
import type { Lang, MscCompetition } from '../data/types';
import { C, F, R } from '../design/theme';
import { Icon } from '../components/Icon';
import { Card, Mono, SectionLabel } from '../components/primitives';
import { Courbe } from '../components/Courbe';
import type { Point } from '../components/Courbe';
import type { App } from '../state/useApp';

const T: Record<Lang, Record<string, string>> = {
  fr: {
    progression: 'Progression · équivalent 10 km',
    poids: 'Poids',
    courses: 'Compétitions',
    ajouter: 'Encoder une course',
    aucune: 'Aucune course encodée.',
    pasAssez: 'Deux résultats au moins pour tracer une courbe.',
    pasDePoids: 'Aucune mesure de poids confirmée.',
    date: 'Date', nom: 'Nom', lieu: 'Lieu', distance: 'Distance (km)',
    temps: 'Temps (h:mm:ss)', classement: 'Classement', partants: 'Partants',
    enregistrer: 'Enregistrer', annuler: 'Annuler', supprimer: 'Supprimer',
    aVenir: 'à venir', abandon: 'abandon',
  },
  pl: {
    progression: 'Postęp · ekwiwalent 10 km',
    poids: 'Waga',
    courses: 'Zawody',
    ajouter: 'Dodaj zawody',
    aucune: 'Brak zapisanych zawodów.',
    pasAssez: 'Potrzeba co najmniej dwóch wyników.',
    pasDePoids: 'Brak potwierdzonych pomiarów wagi.',
    date: 'Data', nom: 'Nazwa', lieu: 'Miejsce', distance: 'Dystans (km)',
    temps: 'Czas (h:mm:ss)', classement: 'Miejsce', partants: 'Startujących',
    enregistrer: 'Zapisz', annuler: 'Anuluj', supprimer: 'Usuń',
    aVenir: 'wkrótce', abandon: 'nie ukończono',
  },
};

/* Une allure en secondes par km. Le moteur écrit les allures partout ailleurs,
   mais celle-ci est mesurée sur une course, pas prescrite. */
function allure(s: number): string {
  const t = Math.round(s);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

function chrono(s: number): string {
  const t = Math.round(s);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

/** « 1:24:30 », « 42:10 » ou « 2530 » → secondes. */
function versSecondes(v: string): number | null {
  const parts = v.trim().split(':').map((x) => Number(x));
  if (parts.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

export function BackOffice({ app }: { app: App }) {
  const lang = app.lang;
  const t = T[lang];
  const [edite, setEdite] = useState<Partial<MscCompetition> | null>(null);

  const courses = db.select('msc_competition');
  const courues = courses
    .filter((c) => c.resultat && !c.resultat.abandon)
    .sort((a, b) => a.date.localeCompare(b.date));

  /* La comparaison n'a de sens qu'une fois les distances ramenées à la même :
     un semi couru à 5:00/km et un 10 km couru à 5:00/km ne disent pas la même
     forme. Riegel fait cette conversion, et le générateur s'en sert déjà pour
     poser la référence d'un bloc — c'est la même fonction. */
  const progression: Point[] = courues.map((c) => ({
    date: c.date,
    valeur: equivalent10k(c.resultat!.temps_s, c.distance_km),
    label: `${c.nom} · ${chrono(c.resultat!.temps_s)}`,
  }));

  const poids: Point[] = db
    .select('msc_mesure')
    .filter((m) => m.poids_kg !== undefined)
    .map((m) => ({ date: m.date, valeur: m.poids_kg as number, label: m.date }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Card padding="16px 18px" gap={10}>
        <SectionLabel icon="trending-up" color={C.teal}>{t.progression}</SectionLabel>
        <Courbe
          points={progression}
          couleur="#038870"
          basMieux
          format={(v) => `${allure(v)}/km`}
          vide={t.pasAssez}
        />
      </Card>

      <Card padding="16px 18px" gap={10}>
        <SectionLabel icon="scale" color={C.teal}>{t.poids}</SectionLabel>
        <Courbe
          points={poids}
          couleur="#029CD0"
          format={(v) => `${v.toFixed(1)} kg`}
          vide={t.pasDePoids}
        />
      </Card>

      <Card padding="16px 18px" gap={10}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <SectionLabel icon="calendar-days" color={C.teal}>{t.courses}</SectionLabel>
          <button
            type="button"
            onClick={() => setEdite({ date: db.aujourdhuiISO(), distance_km: 10 })}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '5px 11px', borderRadius: R.full,
              background: C.accent, color: C.accentInk, fontSize: 11, fontWeight: 600,
            }}
          >
            <Icon name="plus" size={13} />
            {t.ajouter}
          </button>
        </div>

        {app.coursesErreur && (
          <div
            style={{
              display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 10px',
              borderRadius: R.md, background: C.warningBg, color: C.warning,
              fontSize: 11, lineHeight: 1.4,
            }}
          >
            <Icon name="triangle-alert" size={14} />
            <span>{app.coursesErreur}</span>
          </div>
        )}

        {courses.length === 0 && !edite && (
          <div style={{ fontSize: 11, color: C.inkQuiet, fontStyle: 'italic' }}>{t.aucune}</div>
        )}

        {[...courses]
          .sort((a, b) => b.date.localeCompare(a.date))
          .map((c) => (
            <button
              key={c.id}
              type="button"
              className="msc-hover-surface"
              onClick={() => setEdite(c)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '9px 2px',
                borderTop: `1px solid ${C.borderSoft}`, textAlign: 'left', width: '100%',
              }}
            >
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.ink }}>{c.nom}</div>
                <Mono size={10} color={C.inkQuiet}>
                  {`${c.date} · ${c.distance_km} km${c.lieu ? ` · ${c.lieu}` : ''}`}
                </Mono>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                {c.resultat ? (
                  <>
                    <Mono size={13} color={c.resultat.abandon ? C.inkQuiet : C.ink}>
                      {c.resultat.abandon ? t.abandon : chrono(c.resultat.temps_s)}
                    </Mono>
                    {!c.resultat.abandon && (
                      <div style={{ fontSize: 10, color: C.inkQuiet }}>
                        {`${allure(c.resultat.allure_s_km)}/km`}
                        {c.resultat.classement ? ` · ${c.resultat.classement}ᵉ` : ''}
                      </div>
                    )}
                  </>
                ) : (
                  <Mono size={11} color={C.inkQuiet}>{t.aVenir}</Mono>
                )}
              </div>
            </button>
          ))}
      </Card>

      {edite && (
        <Formulaire
          app={app}
          course={edite}
          onFerme={() => setEdite(null)}
        />
      )}
    </div>
  );
}

const CHAMP: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', borderRadius: R.md,
  border: `1px solid ${C.border}`, background: C.surface, color: C.ink,
  padding: '9px 10px', fontFamily: F.body, fontSize: 14,
};

function Ligne({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
      <span style={{ fontSize: 10, color: C.inkSecondary }}>{label}</span>
      {children}
    </label>
  );
}

function Formulaire({
  app,
  course,
  onFerme,
}: {
  app: App;
  course: Partial<MscCompetition>;
  onFerme: () => void;
}) {
  const t = T[app.lang];
  const [date, setDate] = useState(course.date ?? '');
  const [nom, setNom] = useState(course.nom ?? '');
  const [lieu, setLieu] = useState(course.lieu ?? '');
  const [distance, setDistance] = useState(String(course.distance_km ?? 10));
  const [temps, setTemps] = useState(course.resultat ? chrono(course.resultat.temps_s) : '');
  const [classement, setClassement] = useState(String(course.resultat?.classement ?? ''));
  const [partants, setPartants] = useState(String(course.resultat?.partants ?? ''));
  const [envoi, setEnvoi] = useState(false);

  const nombre = (v: string) => {
    const n = Number(v.replace(',', '.'));
    return v.trim() === '' || !Number.isFinite(n) ? undefined : n;
  };

  const enregistrer = async () => {
    const secondes = temps.trim() ? versSecondes(temps) : null;
    setEnvoi(true);
    const ok = await app.enregistrerCompetition({
      id: course.id,
      date,
      nom: nom.trim(),
      lieu: lieu.trim() || undefined,
      distance_km: nombre(distance) ?? 10,
      /* Un temps vide n'est pas un résultat de zéro : c'est une course à venir,
         et `null` dit au serveur d'effacer le résultat s'il y en avait un. */
      resultat: secondes
        ? {
            temps_s: secondes,
            classement: nombre(classement),
            partants: nombre(partants),
            abandon: false,
          }
        : null,
    } as Parameters<typeof app.enregistrerCompetition>[0]);
    setEnvoi(false);
    if (ok) onFerme();
  };

  return (
    <Card padding="16px 18px" gap={10} borderColor={C.accent}>
      <SectionLabel icon="pencil" color={C.accentDeep}>
        {course.id ? nom || t.courses : t.ajouter}
      </SectionLabel>

      <div style={{ display: 'flex', gap: 8 }}>
        <Ligne label={t.date}>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={CHAMP} />
        </Ligne>
        <Ligne label={t.distance}>
          <input inputMode="decimal" value={distance} onChange={(e) => setDistance(e.target.value)} style={CHAMP} />
        </Ligne>
      </div>

      <Ligne label={t.nom}>
        <input value={nom} onChange={(e) => setNom(e.target.value)} style={CHAMP} />
      </Ligne>
      <Ligne label={t.lieu}>
        <input value={lieu} onChange={(e) => setLieu(e.target.value)} style={CHAMP} />
      </Ligne>

      <div style={{ display: 'flex', gap: 8 }}>
        <Ligne label={t.temps}>
          <input value={temps} onChange={(e) => setTemps(e.target.value)} placeholder="0:42:10" style={CHAMP} />
        </Ligne>
        <Ligne label={t.classement}>
          <input inputMode="numeric" value={classement} onChange={(e) => setClassement(e.target.value)} style={CHAMP} />
        </Ligne>
        <Ligne label={t.partants}>
          <input inputMode="numeric" value={partants} onChange={(e) => setPartants(e.target.value)} style={CHAMP} />
        </Ligne>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
        <button
          type="button"
          onClick={() => void enregistrer()}
          disabled={envoi || !date || !nom.trim()}
          style={{
            flex: 1, padding: '10px 16px', borderRadius: R.full,
            background: envoi || !date || !nom.trim() ? C.surfaceAlt : C.accent,
            color: envoi || !date || !nom.trim() ? C.inkQuiet : C.accentInk,
            fontWeight: 600, fontSize: 13,
          }}
        >
          {t.enregistrer}
        </button>
        <button
          type="button"
          onClick={onFerme}
          style={{
            padding: '10px 16px', borderRadius: R.full, border: `1px solid ${C.border}`,
            background: C.surface, color: C.inkSecondary, fontSize: 13,
          }}
        >
          {t.annuler}
        </button>
        {course.id && (
          <button
            type="button"
            onClick={() => {
              void app.supprimerCompetition(course.id as number);
              onFerme();
            }}
            aria-label={t.supprimer}
            style={{
              padding: '10px 12px', borderRadius: R.full, border: `1px solid ${C.border}`,
              background: C.surface, color: C.negative,
            }}
          >
            <Icon name="trash-2" size={15} />
          </button>
        )}
      </div>
    </Card>
  );
}
