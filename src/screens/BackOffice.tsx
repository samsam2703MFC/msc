/* Le back office : les courses encodées, et ce qu'elles disent de la
   progression.

   Une compétition appartient à l'athlète et pas au plan — c'est ce qui laisse
   les résultats survivre aux plans qui les visaient, et une courbe traverser
   trois ans et quatre plans sans s'en apercevoir. */

import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import * as db from '../data/db';
import { chrono, versChrono } from '../data/engine';
import { equivalent10k } from '../data/generateur';
import { TYPES_COURSE, disciplineEnClair, nomDuType, typeCourse, typesGroupes } from '../data/courses';
import type { Lang, MscCompetition } from '../data/types';
import { C, F, R } from '../design/theme';
import { Icon } from '../components/Icon';
import { Card, SectionLabel } from '../components/primitives';
import { Courbe } from '../components/Courbe';
import type { Point } from '../components/Courbe';
import type { App } from '../state/useApp';

const T: Record<Lang, Record<string, string>> = {
  fr: {
    progression: 'Progression · équivalent 10 km',
    courses: 'Compétitions',
    ajouter: 'Encoder une course',
    aucune: 'Aucune course encodée.',
    pasAssez: 'Deux résultats au moins pour tracer une courbe.',
    date: 'Date', nom: 'Nom', lieu: 'Lieu', distance: 'Distance (km)',
    type: 'Type', objectif: 'Objectif', aucunObjectif: '— aucun —', sansPlan: 'sans plan actif',
    temps: 'Temps (h:mm:ss)', classement: 'Classement', partants: 'Partants',
    enregistrer: 'Enregistrer', annuler: 'Annuler', supprimer: 'Supprimer',
    aVenir: 'à venir', abandon: 'abandon',
    allure: 'Allure', nouvelle: 'Nom de la course', oui: 'Oui, supprimer', supprimerConfirme: 'Supprimer ?',
    aide: 'Chaque case se modifie sur place. Entrée ou ✓ enregistre la ligne, Échap annule. La dernière ligne ajoute une course : un temps vide, c’est une course à venir. Le type pose la distance ; « Objectif » relie le start à un objectif du plan.',
  },
  pl: {
    progression: 'Postęp · ekwiwalent 10 km',
    courses: 'Zawody',
    ajouter: 'Dodaj zawody',
    aucune: 'Brak zapisanych zawodów.',
    pasAssez: 'Potrzeba co najmniej dwóch wyników.',
    date: 'Data', nom: 'Nazwa', lieu: 'Miejsce', distance: 'Dystans (km)',
    type: 'Typ', objectif: 'Cel', aucunObjectif: '— brak —', sansPlan: 'brak aktywnego planu',
    temps: 'Czas (h:mm:ss)', classement: 'Miejsce', partants: 'Startujących',
    enregistrer: 'Zapisz', annuler: 'Anuluj', supprimer: 'Usuń',
    aVenir: 'wkrótce', abandon: 'nie ukończono',
    allure: 'Tempo', nouvelle: 'Nazwa zawodów', oui: 'Tak, usuń', supprimerConfirme: 'Usunąć?',
    aide: 'Każde pole edytuje się w miejscu. Enter lub ✓ zapisuje wiersz, Esc cofa. Ostatni wiersz dodaje zawody: pusty czas to zawody, które dopiero będą. Typ ustawia dystans; „Cel” wiąże start z celem planu.',
  },
};

/* Une allure en secondes par km. Le moteur écrit les allures partout ailleurs,
   mais celle-ci est mesurée sur une course, pas prescrite. */
function allure(s: number): string {
  const t = Math.round(s);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

export function BackOffice({ app }: { app: App }) {
  const lang = app.lang;
  const t = T[lang];
  const refNouvelle = useRef<HTMLInputElement>(null);

  const courses = db.select('msc_competition');
  const courues = courses
    .filter((c) => c.resultat && !c.resultat.abandon)
    .sort((a, b) => a.date.localeCompare(b.date));

  /* La comparaison n'a de sens qu'une fois les distances ramenées à la même :
     un semi couru à 5:00/km et un 10 km couru à 5:00/km ne disent pas la même
     forme. Riegel fait cette conversion, et le générateur s'en sert déjà pour
     poser la référence d'un bloc — c'est la même fonction. */
  /* Les objectifs du plan actif : ce à quoi un start peut se relier. */
  const objectifs = db.select('msc_objectif');

  const progression: Point[] = courues.map((c) => ({
    date: c.date,
    valeur: equivalent10k(c.resultat!.temps_s, c.distance_km),
    label: `${c.nom} · ${chrono(c.resultat!.temps_s)}`,
  }));

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

      {/* Les courses, en tableau : chaque case se modifie sur place, la
          dernière ligne en ajoute une. Un formulaire à part obligeait à ouvrir
          chaque course pour corriger un temps ; ici on corrige et on valide. */}
      <Card padding="16px 18px" gap={10}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <SectionLabel icon="calendar-days" color={C.teal}>{t.courses}</SectionLabel>
          <button
            type="button"
            onClick={() => {
              refNouvelle.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
              refNouvelle.current?.focus();
            }}
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
            role="alert"
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

        <div style={{ fontSize: 11, color: C.inkQuiet, lineHeight: 1.4 }}>{t.aide}</div>

        {/* Le tableau déborde de la carte plutôt que d'écraser ses colonnes :
            sur un téléphone il défile, sur un écran il tient. */}
        <div style={{ overflowX: 'auto', margin: '0 -18px', padding: '0 18px', WebkitOverflowScrolling: 'touch' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 1180, fontSize: 13 }}>
            <thead>
              <tr>
                {[t.date, t.nom, t.type, t.lieu, 'km', t.temps, t.classement, t.partants, t.allure, t.objectif, ''].map((h, i) => (
                  <th
                    key={i}
                    scope="col"
                    style={{
                      textAlign: i >= 4 && i <= 7 ? 'right' : 'left', padding: '4px 6px',
                      fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
                      color: C.inkSecondary, borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...courses]
                .sort((a, b) => b.date.localeCompare(a.date))
                .map((c) => <Rangee key={c.id} app={app} course={c} lang={lang} objectifs={objectifs} />)}
              <Rangee app={app} course={null} lang={lang} objectifs={objectifs} refNom={refNouvelle} />
            </tbody>
          </table>
        </div>
        {courses.length === 0 && (
          <div style={{ fontSize: 11, color: C.inkQuiet, fontStyle: 'italic' }}>{t.aucune}</div>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------- une ligne */

interface Champs {
  date: string; nom: string; lieu: string; type: string; distance: string; temps: string; classement: string; partants: string;
}

function champsDe(c: Partial<MscCompetition> | null): Champs {
  return {
    date: c?.date ?? db.aujourdhuiISO(),
    nom: c?.nom ?? '',
    lieu: c?.lieu ?? '',
    type: c?.type_course ?? '',
    distance: String(c?.distance_km ?? 10),
    temps: c?.resultat && !c.resultat.abandon ? chrono(c.resultat.temps_s) : '',
    classement: c?.resultat?.classement ? String(c.resultat.classement) : '',
    partants: c?.resultat?.partants ? String(c.resultat.partants) : '',
  };
}

function nombre(v: string): number | undefined {
  const n = Number(v.replace(',', '.'));
  return v.trim() === '' || !Number.isFinite(n) ? undefined : n;
}

const CELLULE: React.CSSProperties = {
  width: '100%', minWidth: 0, boxSizing: 'border-box', padding: '6px 6px',
  color: C.ink, fontFamily: F.body, fontSize: 13,
};

const BOUTON_RANGEE: React.CSSProperties = {
  width: 28, height: 28, borderRadius: R.full, display: 'inline-flex', alignItems: 'center',
  justifyContent: 'center', border: `1px solid ${C.border}`, background: C.surface, color: C.inkMuted,
};

function Rangee({
  app, course, lang, objectifs, refNom,
}: {
  app: App; course: MscCompetition | null; lang: Lang;
  objectifs: Array<{ id: number; nom: Record<Lang, string>; date: string; competition_id?: number; type_course?: string }>;
  refNom?: React.RefObject<HTMLInputElement | null>;
}) {
  const t = T[lang];
  const nouvelle = course === null;
  /* La ligne repart de la course chaque fois que l'instantané la renvoie —
     après un enregistrement, la sienne ou celle d'une autre ligne. */
  const reference = JSON.stringify(champsDe(course));
  const [v, setV] = useState<Champs>(() => champsDe(course));
  const [envoi, setEnvoi] = useState(false);
  const [confirme, setConfirme] = useState(false);
  useEffect(() => {
    setV(JSON.parse(reference) as Champs);
    setConfirme(false);
  }, [reference]);

  const modifie = JSON.stringify(v) !== reference;
  const valide = v.date !== '' && v.nom.trim() !== '';
  const secondes = v.temps.trim() ? versChrono(v.temps) : null;
  const km = nombre(v.distance);
  const allureS = secondes && km ? secondes / km : null;

  const enregistrer = async () => {
    if (!valide || envoi) return;
    setEnvoi(true);
    const ok = await app.enregistrerCompetition({
      id: course?.id,
      date: v.date,
      nom: v.nom.trim(),
      lieu: v.lieu.trim() || undefined,
      type_course: v.type || undefined,
      discipline: disciplineEnClair(v.type || undefined, lang) || undefined,
      distance_km: km ?? 10,
      /* Un temps vide n'est pas un résultat de zéro : c'est une course à venir,
         et `null` dit au serveur d'effacer le résultat s'il y en avait un. */
      resultat: secondes
        ? { temps_s: secondes, classement: nombre(v.classement), partants: nombre(v.partants), abandon: false }
        : null,
    } as Parameters<typeof app.enregistrerCompetition>[0]);
    setEnvoi(false);
    if (ok && nouvelle) setV(champsDe(null));
  };

  const annuler = () => setV(JSON.parse(reference) as Champs);

  const clavier = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); void enregistrer(); }
    else if (e.key === 'Escape') { e.preventDefault(); annuler(); }
  };

  const champ = (
    cle: keyof Champs,
    label: string,
    extra: React.InputHTMLAttributes<HTMLInputElement> & { mono?: boolean; droite?: boolean } = {},
  ) => {
    const { mono, droite, ...props } = extra;
    return (
      <input
        ref={cle === 'nom' ? refNom : undefined}
        className="msc-cellule"
        aria-label={label}
        value={v[cle]}
        onChange={(e) => setV({ ...v, [cle]: e.target.value })}
        onKeyDown={clavier}
        disabled={envoi}
        style={{ ...CELLULE, fontFamily: mono ? F.mono : F.body, textAlign: droite ? 'right' : 'left' }}
        {...props}
      />
    );
  };

  const cellule: React.CSSProperties = { padding: '2px 1px', borderTop: `1px solid ${C.borderSoft}`, verticalAlign: 'middle' };

  return (
    <tr style={{ background: modifie ? C.accentSoft : 'transparent' }} data-nouvelle={nouvelle ? '' : undefined}>
      <td style={{ ...cellule, width: 132 }}>{champ('date', t.date, { type: 'date', mono: true })}</td>
      <td style={{ ...cellule, minWidth: 150 }}>{champ('nom', t.nom, { placeholder: nouvelle ? t.nouvelle : '' })}</td>
      <td style={{ ...cellule, minWidth: 150 }}>
        {/* Le type pose la distance officielle : un semi fait 21,097 km, et
            personne ne doit le retaper. */}
        <select
          className="msc-cellule"
          aria-label={t.type}
          value={v.type}
          onChange={(e) => {
            const type = typeCourse(e.target.value);
            setV({
              ...v,
              type: e.target.value,
              distance: type ? String(type.distance_km) : v.distance,
              nom: type && (!v.nom || TYPES_COURSE.some((x) => x.nom[lang] === v.nom)) ? type.nom[lang] : v.nom,
            });
          }}
          disabled={envoi}
          style={{ ...CELLULE, fontFamily: F.body }}
        >
          <option value="">{`— ${t.type.toLowerCase()} —`}</option>
          {typesGroupes(lang).map((g) => (
            <optgroup key={g.discipline} label={g.discipline}>
              {g.types.map((x) => <option key={x.code} value={x.code}>{x.nom}</option>)}
            </optgroup>
          ))}
        </select>
      </td>
      <td style={{ ...cellule, minWidth: 100 }}>{champ('lieu', t.lieu)}</td>
      <td style={{ ...cellule, width: 62 }}>{champ('distance', t.distance, { inputMode: 'decimal', mono: true, droite: true })}</td>
      <td style={{ ...cellule, width: 88 }}>{champ('temps', t.temps, { placeholder: nouvelle ? 'h:mm:ss' : '', inputMode: 'numeric', mono: true, droite: true })}</td>
      <td style={{ ...cellule, width: 60 }}>{champ('classement', t.classement, { inputMode: 'numeric', mono: true, droite: true })}</td>
      <td style={{ ...cellule, width: 64 }}>{champ('partants', t.partants, { inputMode: 'numeric', mono: true, droite: true })}</td>
      <td style={{ ...cellule, width: 70, padding: '2px 6px', fontFamily: F.mono, fontSize: 12, whiteSpace: 'nowrap', color: allureS ? C.ink : C.inkQuiet }}>
        {allureS ? `${allure(allureS)}/km` : course?.resultat?.abandon ? t.abandon : course && !secondes ? t.aVenir : ''}
      </td>
      <td style={{ ...cellule, minWidth: 150 }}>
        {/* Relier ce start à un objectif du plan : « cette course, c'est
            celle-là ». Sans plan actif, la colonne le dit. */}
        {nouvelle || !course ? (
          <span style={{ fontSize: 11, color: C.inkQuiet }}>—</span>
        ) : objectifs.length === 0 ? (
          <span style={{ fontSize: 11, color: C.inkQuiet }}>{t.sansPlan}</span>
        ) : (
          <select
            className="msc-cellule"
            aria-label={t.objectif}
            value={objectifs.find((o) => o.competition_id === course.id)?.id ?? ''}
            onChange={(e) => {
              const id = Number(e.target.value);
              if (id) void app.relierObjectif(id, course.id);
            }}
            disabled={envoi}
            style={{ ...CELLULE, fontFamily: F.body }}
          >
            <option value="">{t.aucunObjectif}</option>
            {objectifs.map((o) => (
              <option key={o.id} value={o.id}>
                {`${o.nom[lang]} · ${o.date}${o.type_course ? ` · ${nomDuType(o.type_course, lang)}` : ''}`}
              </option>
            ))}
          </select>
        )}
      </td>
      <td style={{ ...cellule, width: 70, padding: '2px 4px', whiteSpace: 'nowrap' }}>
        <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
          {modifie && (
            <>
              <button
                type="button"
                aria-label={t.enregistrer}
                title={t.enregistrer}
                disabled={!valide || envoi}
                onClick={() => void enregistrer()}
                style={{ ...BOUTON_RANGEE, background: valide ? C.accent : C.surfaceAlt, color: valide ? C.accentInk : C.inkQuiet, borderColor: valide ? C.accent : C.border }}
              >
                <Icon name="check" size={15} />
              </button>
              <button type="button" aria-label={t.annuler} title={t.annuler} onClick={annuler} style={BOUTON_RANGEE}>
                <Icon name="rotate-ccw" size={14} />
              </button>
            </>
          )}
          {!nouvelle && !modifie && (confirme ? (
            <>
              <button
                type="button"
                onClick={() => { setConfirme(false); void app.supprimerCompetition(course.id); }}
                style={{ padding: '4px 9px', borderRadius: R.full, background: C.negative, color: '#fff', fontSize: 11, fontWeight: 600, border: 'none', whiteSpace: 'nowrap' }}
              >
                {t.oui}
              </button>
              <button type="button" onClick={() => setConfirme(false)} style={{ ...BOUTON_RANGEE, width: 'auto', padding: '0 9px', fontSize: 11 }}>
                {t.annuler}
              </button>
            </>
          ) : (
            <button type="button" aria-label={t.supprimer} title={t.supprimerConfirme} onClick={() => setConfirme(true)} style={{ ...BOUTON_RANGEE, color: C.negative }}>
              <Icon name="trash-2" size={14} />
            </button>
          ))}
        </div>
      </td>
    </tr>
  );
}
