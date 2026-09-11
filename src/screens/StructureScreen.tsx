/* La semaine type d'un athlète : sept jours, deux créneaux, et ce qui en
   découle.

   C'est la matrice que tout le reste suit. Une case dit trois choses, et
   l'écran les montre dans cet ordre parce que c'est l'ordre où on les décide :

     le sport        ce qui ne bouge pas — le mardi, c'est du seuil à pied
     le type         ce qu'on y fait, dans une liste propre à ce sport
     les allures     calculées du type et des références 10 km, jamais saisies

   Le générateur pose son plan là-dessus, et le coach recalcule chaque jour en
   la suivant : il change la quantité et l'intensité, jamais le sport du
   créneau. Une case vide, c'est du repos — on ne le range pas, il se lit à
   l'absence.

   Rien ne s'enregistre tout seul : on modifie, puis on enregistre. Une matrice
   à moitié changée envoyée à chaque frappe donnerait un plan différent à
   chaque touche. */

import { useEffect, useMemo, useState } from 'react';
import * as api from '../data/api';
import * as db from '../data/db';
import { JOURS, SPORTS, matrice, modele, typeParDefaut, typesPour, volumeSemaine, zonesDuType } from '../data/structure';
import type { Lang, MscStructure, TypeCode } from '../data/types';
import { C, F, R } from '../design/theme';
import { Icon } from '../components/Icon';
import { Card, Mono, SectionLabel } from '../components/primitives';
import type { App } from '../state/useApp';

const T = {
  fr: {
    titre: 'La semaine type',
    intro: 'Sept jours, deux créneaux. Chaque créneau porte un sport et un type d’entraînement ; les allures se calculent. C’est la matrice que le coach suit pour recalculer l’entraînement chaque jour — il change la quantité et l’intensité, jamais le sport du créneau.',
    creneau1: '1er créneau', creneau2: '2e créneau',
    vide: '— repos —', sport: 'Sport', type: 'Type', duree: 'Durée',
    min: 'min', retirer: 'Vider ce créneau',
    volume: 'Volume de la semaine type',
    allures: 'Allures cibles',
    sansAllure: 'pas d’allure au km — séries, sensations, watts',
    enregistrer: 'Enregistrer la semaine type', enregistre: 'Enregistrée', enCours: 'Enregistrement…',
    modeles: 'Modèles de semaine',
    depart: 'Semaine de départ',
    modelesAide: 'Un modèle remplit la grille ; rien n’est écrit chez l’athlète tant que la semaine type n’est pas enregistrée.',
    nomModele: 'Nom du modèle',
    enregistrerModele: 'Enregistrer comme modèle',
    supprimer: 'Supprimer',
    confirmer: 'Supprimer ?',
    creneauxMot: 'créneaux',
    vidone: 'Aucun créneau : le coach n’a pas de structure à suivre, il posera la semaine lui-même.',
    bloc: 'bloc',
    lecture: 'Compte en lecture seule.',
  },
  pl: {
    titre: 'Tydzień wzorcowy',
    intro: 'Siedem dni, dwa okna dziennie. Każde okno ma sport i typ treningu; tempa liczą się same. To macierz, którą trener stosuje przy codziennym przeliczaniu — zmienia ilość i intensywność, nigdy sport okna.',
    creneau1: '1. okno', creneau2: '2. okno',
    vide: '— odpoczynek —', sport: 'Sport', type: 'Typ', duree: 'Czas',
    min: 'min', retirer: 'Wyczyść okno',
    volume: 'Objętość tygodnia wzorcowego',
    allures: 'Tempa docelowe',
    sansAllure: 'bez tempa na km — serie, odczucia, waty',
    enregistrer: 'Zapisz tydzień wzorcowy', enregistre: 'Zapisano', enCours: 'Zapisywanie…',
    modeles: 'Wzorce tygodnia',
    depart: 'Tydzień startowy',
    modelesAide: 'Wzorzec wypełnia siatkę; u zawodnika nic się nie zapisuje, dopóki nie zapiszesz tygodnia wzorcowego.',
    nomModele: 'Nazwa wzorca',
    enregistrerModele: 'Zapisz jako wzorzec',
    supprimer: 'Usuń',
    confirmer: 'Usunąć?',
    creneauxMot: 'okien',
    vidone: 'Brak okien: trener nie ma struktury do naśladowania, ułoży tydzień sam.',
    bloc: 'blok',
    lecture: 'Konto tylko do odczytu.',
  },
} satisfies Record<Lang, unknown>;

const CHAMP: React.CSSProperties = {
  padding: '6px 8px', borderRadius: R.sm, border: `1px solid ${C.border}`,
  background: C.surface, color: C.ink, fontSize: 12, fontFamily: F.body, width: '100%',
};

export function StructureScreen({ app, large = false }: { app: App; large?: boolean }) {
  const lang = app.lang;
  const t = T[lang];
  const lecture = db.droit !== 'ecriture';

  /* La matrice se modifie en local et part d'un bloc : c'est une décision, pas
     une suite de frappes. `version` la relit quand l'athlète change. */
  const rangee = db.select('msc_structure');
  const [creneaux, setCreneaux] = useState<MscStructure[]>(rangee);
  const [job, setJob] = useState<'idle' | 'envoi' | 'fait'>('idle');
  const [erreur, setErreur] = useState<string | null>(null);
  useEffect(() => { setCreneaux(db.select('msc_structure')); setJob('idle'); }, [app.version, db.athleteId]);

  /* Le bloc courant donne la référence sur laquelle les allures se calculent —
     elles ne sont pas les mêmes en réamorçage et en bloc final. */
  const bloc = useMemo(() => {
    const semaine = db.positionDuPlan(app.date).semaine;
    return semaine > 0 ? db.blocDeSemaine(semaine) : null;
  }, [app.date]);

  const grille = matrice(creneaux);
  const volume = volumeSemaine(creneaux);

  const poser = (jour: number, creneau: 1 | 2, patch: Partial<MscStructure> | null) => {
    setJob('idle');
    setCreneaux((liste) => {
      const autres = liste.filter((c) => !(c.jour === jour && c.creneau === creneau));
      if (patch === null) return autres;
      const actuel = liste.find((c) => c.jour === jour && c.creneau === creneau);
      const sport = patch.discipline ?? actuel?.discipline ?? SPORTS[0].code;
      const type = patch.type_code
        ?? (patch.discipline && patch.discipline !== actuel?.discipline
          ? typeParDefaut(patch.discipline)
          : actuel?.type_code ?? typeParDefaut(sport));
      return [...autres, {
        jour, creneau, discipline: sport, type_code: type,
        duree_min: patch.duree_min ?? actuel?.duree_min ?? 45,
      }].sort((a, b) => a.jour - b.jour || a.creneau - b.creneau);
    });
  };

  const enregistrer = async () => {
    setJob('envoi'); setErreur(null);
    try {
      await api.ecrireStructure(creneaux.map((c) => ({
        jour: c.jour, creneau: c.creneau, discipline: c.discipline,
        type_code: c.type_code, duree_min: c.duree_min,
      })));
      await app.recharger(db.athleteId);
      setJob('fait');
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
      setJob('idle');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Card padding="14px 18px" gap={8}>
        <SectionLabel icon="calendar-days" color={C.teal}>{`${t.titre} · ${db.athlete.nom}`}</SectionLabel>
        <div style={{ fontSize: 12.5, color: C.inkSecondary, lineHeight: 1.5 }}>{t.intro}</div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <Mono size={18} color={C.ink}>{`${Math.floor(volume / 60)}h${String(volume % 60).padStart(2, '0')}`}</Mono>
            <span style={{ fontSize: 11, color: C.inkSecondary }}>{t.volume}</span>
          </div>
          {bloc && (
            <Mono size={11} color={C.inkQuiet}>
              {`${t.bloc} ${bloc.code} · ${db.format10k(db.reference(bloc.code))}`}
            </Mono>
          )}
        </div>
        {creneaux.length === 0 && (
          <div style={{ fontSize: 12, color: C.warning, lineHeight: 1.45 }}>{t.vidone}</div>
        )}
      </Card>

      {!lecture && (
        <Modeles
          t={t}
          creneaux={creneaux}
          onPoser={(c) => { setJob('idle'); setCreneaux(c); }}
        />
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: large ? 'repeat(auto-fit, minmax(280px, 1fr))' : '1fr',
          gap: 10,
        }}
      >
        {JOURS.map((j) => (
          <Card key={j.index} padding="12px 14px" gap={8}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: C.teal }}>
                {j.long[lang]}
              </div>
              <Mono size={10} color={C.inkQuiet}>
                {(() => {
                  const m = grille[j.index].reduce((tot, c) => tot + (c?.duree_min ?? 0), 0);
                  return m > 0 ? `${m} ${t.min}` : t.vide;
                })()}
              </Mono>
            </div>
            {([1, 2] as const).map((rang) => (
              <Creneau
                key={rang}
                t={t}
                lang={lang}
                lecture={lecture}
                rang={rang}
                valeur={grille[j.index][rang - 1]}
                bloc={bloc?.code ?? null}
                onChange={(patch) => poser(j.index, rang, patch)}
              />
            ))}
          </Card>
        ))}
      </div>

      <Card padding="12px 16px" gap={8}>
        {erreur && <div style={{ fontSize: 12, color: C.negative }}>{erreur}</div>}
        {lecture ? (
          <div style={{ fontSize: 11.5, color: C.inkQuiet }}>{t.lecture}</div>
        ) : (
          <>
            <button
              type="button"
              disabled={job === 'envoi'}
              onClick={() => void enregistrer()}
              style={{
                alignSelf: 'flex-start',
                padding: '10px 16px', borderRadius: R.md, border: 'none', fontSize: 13, fontWeight: 700,
                background: job === 'fait' ? C.accentSoft : C.accent,
                color: job === 'fait' ? C.accentDeep : C.accentInk,
              }}
            >
              {job === 'envoi' ? t.enCours : job === 'fait' ? t.enregistre : t.enregistrer}
            </button>
          </>
        )}
      </Card>
    </div>
  );
}

/* Les modèles : une semaine type qui marche pour un athlète marche souvent
   pour le suivant. On l'enregistre sous un nom, et on la repose ailleurs.

   Poser un modèle ne fait que remplir la grille — c'est « Enregistrer la
   semaine type » qui écrit chez l'athlète. Deux gestes, parce que ce sont deux
   décisions : choisir une forme, et la donner à quelqu'un. */
function Modeles({
  t, creneaux, onPoser,
}: {
  t: Record<string, string>;
  creneaux: MscStructure[];
  onPoser: (creneaux: MscStructure[]) => void;
}) {
  const [liste, setListe] = useState<api.Modele[]>([]);
  const [nom, setNom] = useState('');
  const [job, setJob] = useState<'idle' | 'envoi'>('idle');
  const [aSupprimer, setASupprimer] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const relire = () => {
    api.modeles().then((r) => setListe(r.modeles)).catch(() => setListe([]));
  };
  useEffect(relire, []);

  /* Un modèle rangé revient avec `duree_min: null` quand il n'en portait pas ;
     la grille, elle, ne connaît que « une durée ou rien ». */
  const poser = (m: api.Modele) => onPoser(m.creneaux.map((c) => ({
    jour: c.jour, creneau: c.creneau === 2 ? 2 : 1, discipline: c.discipline,
    type_code: c.type_code as TypeCode,
    ...(c.duree_min === null ? {} : { duree_min: c.duree_min }),
  })));

  const enregistrer = async () => {
    setJob('envoi'); setErreur(null);
    try {
      await api.ecrireModele(nom, creneaux.map((c) => ({
        jour: c.jour, creneau: c.creneau, discipline: c.discipline,
        type_code: c.type_code, duree_min: c.duree_min ?? null,
      })));
      setNom('');
      relire();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setJob('idle');
    }
  };

  const supprimer = async (cible: string) => {
    setASupprimer(null);
    try { await api.supprimerModele(cible); } catch { /* la relecture dira */ }
    relire();
  };

  const chip: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: R.full,
    border: `1px solid ${C.border}`, background: C.surface, color: C.inkMuted,
    fontSize: 12, fontWeight: 600,
  };

  return (
    <Card padding="12px 16px" gap={8}>
      <SectionLabel icon="repeat" color={C.teal}>{t.modeles}</SectionLabel>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {/* Celui d'origine, qui n'est rangé nulle part : il est dans le code,
            et c'est de lui qu'on part quand il n'y a encore rien. */}
        <button
          type="button"
          className="msc-hover-accent"
          style={chip}
          onClick={() => onPoser(modele({ natation: true, velo: true, salle: true }))}
        >
          <Icon name="sparkles" size={13} />
          {t.depart}
        </button>
        {liste.map((m) => (
          <span key={m.nom} style={{ ...chip, paddingRight: 4 }}>
            <button
              type="button"
              className="msc-hover-accent"
              onClick={() => poser(m)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.inkMuted, fontSize: 12, fontWeight: 600 }}
            >
              <Icon name="calendar-days" size={13} />
              {m.nom}
              <Mono size={10} color={C.inkQuiet}>{`${m.creneaux.length}`}</Mono>
            </button>
            {aSupprimer === m.nom ? (
              <button
                type="button"
                onClick={() => void supprimer(m.nom)}
                style={{ padding: '2px 8px', borderRadius: R.full, background: C.negative, color: C.surface, fontSize: 10, fontWeight: 700 }}
              >
                {t.confirmer}
              </button>
            ) : (
              <button
                type="button"
                aria-label={`${t.supprimer} ${m.nom}`}
                onClick={() => setASupprimer(m.nom)}
                style={{ width: 20, height: 20, borderRadius: R.full, color: C.inkQuiet, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <Icon name="trash-2" size={12} />
              </button>
            )}
          </span>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          value={nom}
          onChange={(e) => setNom(e.target.value)}
          placeholder={t.nomModele}
          aria-label={t.nomModele}
          maxLength={48}
          style={{ ...CHAMP, width: 190 }}
        />
        <button
          type="button"
          disabled={job === 'envoi' || nom.trim() === '' || creneaux.length === 0}
          onClick={() => void enregistrer()}
          style={{
            padding: '7px 12px', borderRadius: R.md, fontSize: 12, fontWeight: 600,
            border: `1px solid ${nom.trim() && creneaux.length ? C.accent : C.border}`,
            background: nom.trim() && creneaux.length ? C.accentSoft : C.surface,
            color: nom.trim() && creneaux.length ? C.accentDeep : C.inkQuiet,
          }}
        >
          {t.enregistrerModele}
        </button>
        <Mono size={10} color={C.inkQuiet}>{`${creneaux.length} ${t.creneauxMot}`}</Mono>
      </div>
      {erreur && <div style={{ fontSize: 12, color: C.negative }}>{erreur}</div>}
      <div style={{ fontSize: 11, color: C.inkQuiet, lineHeight: 1.45 }}>{t.modelesAide}</div>
    </Card>
  );
}

function Creneau({
  t, lang, rang, valeur, bloc, lecture, onChange,
}: {
  t: Record<string, string>; lang: Lang; rang: 1 | 2; valeur: MscStructure | null;
  bloc: string | null; lecture: boolean;
  onChange: (patch: Partial<MscStructure> | null) => void;
}) {
  const type = valeur ? db.type(valeur.type_code) : null;
  const zones = valeur ? zonesDuType(valeur.type_code, valeur.discipline) : [];

  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 10px',
        borderRadius: R.md, border: `1px solid ${valeur ? C.border : C.borderSoft}`,
        background: valeur ? C.surface : C.page,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 10.5, color: C.inkQuiet, fontWeight: 600 }}>
          {rang === 1 ? t.creneau1 : t.creneau2}
        </span>
        {valeur && !lecture && (
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label={t.retirer}
            title={t.retirer}
            style={{ padding: 2, borderRadius: R.sm, color: C.inkQuiet, background: 'transparent', border: 'none' }}
          >
            <Icon name="circle-x" size={14} />
          </button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 3fr) minmax(0, 2fr)', gap: 6 }}>
        <select
          aria-label={`${t.sport} ${rang}`}
          disabled={lecture}
          value={valeur?.discipline ?? ''}
          onChange={(e) => onChange(e.target.value ? { discipline: e.target.value } : null)}
          style={CHAMP}
        >
          <option value="">{t.vide}</option>
          {SPORTS.map((s) => <option key={s.code} value={s.code}>{s.nom[lang]}</option>)}
        </select>
        <select
          aria-label={`${t.type} ${rang}`}
          disabled={lecture || !valeur}
          value={valeur?.type_code ?? ''}
          onChange={(e) => onChange({ type_code: e.target.value as TypeCode })}
          style={{ ...CHAMP, opacity: valeur ? 1 : 0.5 }}
        >
          {valeur
            ? typesPour(valeur.discipline).map((code) => (
              <option key={code} value={code}>{db.type(code).label[lang]}</option>
            ))
            : <option value="">—</option>}
        </select>
        <input
          type="number"
          aria-label={`${t.duree} ${rang}`}
          disabled={lecture || !valeur}
          min={10}
          max={600}
          step={5}
          value={valeur?.duree_min ?? ''}
          onChange={(e) => onChange({ duree_min: Number(e.target.value) })}
          style={{ ...CHAMP, fontFamily: F.mono, opacity: valeur ? 1 : 0.5 }}
        />
      </div>

      {valeur && type && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Icon name={type.icon} size={12} color={type.color} />
          <Mono size={10.5} color={C.inkQuiet}>
            {zones.length && bloc
              ? `${t.allures} · ${zones.map((z) => `${db.zone(z).label[lang]} ${db.allure(z, bloc)}`).join(' · ')}`
              : t.sansAllure}
          </Mono>
        </div>
      )}
    </div>
  );
}
