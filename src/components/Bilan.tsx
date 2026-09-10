/* Le bilan d'une séance : ce qui s'est vraiment passé.

   Une séance passée n'a que deux fins possibles, et l'écran pose la question
   dans ces termes plutôt qu'avec une coche muette : je l'ai faite, ou je ne
   l'ai pas faite. Chaque réponse ouvre la sienne.

     faite      → l'activité Strava, le ressenti (RPE), ce qui a bloqué, la note
     pas faite  → pourquoi, dans un vocabulaire fermé, et la note

   Les deux moitiés ne se mélangent pas : « ce qui a bloqué » n'a pas de sens
   sans séance, et « pourquoi pas » n'en a pas avec. Répondre à l'une efface
   l'autre — dans la base comme à l'écran.

   Côté Strava, trois cas et trois phrases : l'activité est appariée et on la
   montre ; elle ne l'est pas et un bouton va la chercher ; elle est là mais
   sur une autre ligne (un vélo à la place de la course, une sortie que la
   durée n'a pas su rapprocher) et l'athlète la désigne — c'est lui qui sait,
   et son choix survit aux synchros suivantes. */

import { useEffect, useState } from 'react';
import * as db from '../data/db';
import type { Lang, Raison } from '../data/types';
import { C, F, R } from '../design/theme';
import { visuelDuStatut } from '../data/statut';
import { Icon } from './Icon';
import { Limites } from './Limites';
import { Card, Mono } from './primitives';
import type { App } from '../state/useApp';

const VOCAB: Array<{ code: Raison; icon: string; label: Record<Lang, string> }> = [
  { code: 'pas_envie', icon: 'battery-low', label: { fr: 'Pas envie', pl: 'Nie miałem ochoty' } },
  { code: 'pas_le_temps', icon: 'clock-alert', label: { fr: 'Pas le temps', pl: 'Brak czasu' } },
  { code: 'fatigue', icon: 'bed', label: { fr: 'Trop fatigué', pl: 'Za duże zmęczenie' } },
  { code: 'douleur', icon: 'bandage', label: { fr: 'Une douleur', pl: 'Ból' } },
  { code: 'malade', icon: 'thermometer', label: { fr: 'Malade', pl: 'Choroba' } },
  { code: 'meteo', icon: 'cloud-rain', label: { fr: 'La météo', pl: 'Pogoda' } },
  { code: 'voyage', icon: 'plane', label: { fr: 'En déplacement', pl: 'W podróży' } },
  { code: 'imprevu', icon: 'calendar-x', label: { fr: 'Un imprévu', pl: 'Coś wypadło' } },
  { code: 'autrement', icon: 'repeat', label: { fr: 'J’ai fait autre chose', pl: 'Zrobiłem coś innego' } },
];

/** Le libellé court d'un motif — le back office s'en sert aussi. */
export function raisonEnClair(code: string, lang: Lang): string {
  return VOCAB.find((v) => v.code === code)?.label[lang] ?? code;
}

const T = {
  fr: {
    titre: 'Comment ça s’est passé ?',
    oui: 'Je l’ai faite', non: 'Pas faite',
    fait: 'faite', partiel: 'faite autrement', manque: 'manquée', aujourdhui: 'aujourd’hui',
    prevu: 'à venir', repos: 'repos', adapte: 'adaptée',
    pourquoi: 'Pourquoi ?',
    pourquoiAide: 'Ce n’est pas un aveu : le coach ne replanifie pas de la même façon selon la réponse. « Pas le temps » déplace, « pas envie » allège, une douleur protège.',
    ressenti: 'Ton ressenti', rpe: 'RPE', charge: 'charge',
    strava: 'Strava',
    appariee: 'Séance retrouvée sur Strava',
    chercher: 'Chercher sur Strava', chercheEnCours: 'Lecture de Strava…',
    rien: 'Rien d’apparié à cette séance pour l’instant.',
    pasLie: 'Strava n’est pas relié : Paramètres · Strava, ou coche « Je l’ai faite » et donne ton ressenti à la main.',
    autresDuJour: 'Ce jour-là, Strava a aussi :',
    cetteLa: 'C’était celle-ci',
    manuelle: 'appariée à la main',
    note: 'Un mot pour le coach (facultatif)',
    lecture: 'Compte en lecture seule.',
  },
  pl: {
    titre: 'Jak poszło?',
    oui: 'Zrobiłem', non: 'Nie zrobiłem',
    fait: 'zrobiony', partiel: 'zrobiony inaczej', manque: 'pominięty', aujourdhui: 'dzisiaj',
    prevu: 'zaplanowany', repos: 'odpoczynek', adapte: 'dostosowany',
    pourquoi: 'Dlaczego?',
    pourquoiAide: 'To nie spowiedź: trener planuje inaczej zależnie od odpowiedzi. „Brak czasu” przesuwa, „brak ochoty” odciąża, ból chroni.',
    ressenti: 'Twoje odczucie', rpe: 'RPE', charge: 'obciążenie',
    strava: 'Strava',
    appariee: 'Trening znaleziony na Stravie',
    chercher: 'Szukaj na Stravie', chercheEnCours: 'Odczyt Stravy…',
    rien: 'Nic nie dopasowano do tego treningu.',
    pasLie: 'Strava niepołączona: Ustawienia · Strava, albo zaznacz „Zrobiłem” i wpisz odczucie ręcznie.',
    autresDuJour: 'Tego dnia Strava ma też:',
    cetteLa: 'To był ten',
    manuelle: 'dopasowany ręcznie',
    note: 'Słowo do trenera (opcjonalnie)',
    lecture: 'Konto tylko do odczytu.',
  },
} satisfies Record<Lang, unknown>;

const PUCE: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
  borderRadius: R.full, fontSize: 11, fontWeight: 600,
};

export function Bilan({ app, sessionId }: { app: App; sessionId: number }) {
  const lang = app.lang;
  const t = T[lang];
  const session = db.mustOne('msc_session', (r) => r.id === sessionId);
  const journal = db.one('msc_journal', (j) => j.session_id === sessionId);
  const activite = db.one('msc_activity', (a) => a.session_id === sessionId);
  const statut = db.statutDe(session, app.date, db.etatDesSeances());
  const visuel = visuelDuStatut(statut);
  const lecture = db.droit !== 'ecriture';

  const coche = journal?.fait ?? null;
  const raisons = journal?.raisons ?? [];
  const [note, setNote] = useState(journal?.note ?? '');
  useEffect(() => { setNote(journal?.note ?? ''); }, [journal?.note]);

  /* Le RPE suit le doigt, mais ne part qu'au relâchement : un curseur qui
     écrit à chaque cran, c'est dix requêtes pour une réponse. */
  const rpeEcrit = journal?.rpe_ressenti || session.rpe_cible;
  const [rpe, setRpe] = useState(rpeEcrit);
  useEffect(() => { setRpe(rpeEcrit); }, [rpeEcrit]);

  /* Ce que Strava a ce jour-là et qui n'est allé sur aucune séance. */
  const orphelines = app.stravaOrphelines.filter((o) => o.date === session.date);

  const repondre = (valeur: boolean) => {
    void app.bilanSeance(sessionId, { fait: coche === valeur ? null : valeur });
  };

  const basculerRaison = (code: Raison) => {
    const suivantes = raisons.includes(code)
      ? raisons.filter((r) => r !== code)
      : [...raisons, code];
    void app.bilanSeance(sessionId, { fait: false, raisons: suivantes });
  };

  return (
    <Card background={C.page} padding={14} gap={12} style={{ borderRadius: 12, boxShadow: 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{t.titre}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: C.ink }}>
          <Icon name={visuel.icon} size={14} color={visuel.couleur} />
          {(t as Record<string, string>)[statut] ?? statut}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Choix
          actif={coche === true}
          couleur={C.accentDeep}
          icon="circle-check"
          label={t.oui}
          disabled={lecture}
          onClick={() => repondre(true)}
        />
        <Choix
          actif={coche === false}
          couleur={C.negative}
          icon="circle-x"
          label={t.non}
          disabled={lecture}
          onClick={() => repondre(false)}
        />
      </div>

      {coche === false && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.inkSecondary }}>
            <Icon name="circle-help" size={15} />
            <div style={{ fontSize: 12 }}>{t.pourquoi}</div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {VOCAB.map((v) => {
              const on = raisons.includes(v.code);
              return (
                <button
                  key={v.code}
                  type="button"
                  className="msc-hover-accent"
                  aria-pressed={on}
                  disabled={lecture}
                  onClick={() => basculerRaison(v.code)}
                  style={{
                    ...PUCE,
                    border: `1px solid ${on ? C.accent : C.border}`,
                    background: on ? C.accentSoft : C.surface,
                    color: on ? C.accentDeep : C.inkMuted,
                  }}
                >
                  <Icon name={v.icon} size={13} />
                  {v.label[lang]}
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: 11, color: C.inkQuiet, lineHeight: 1.45 }}>{t.pourquoiAide}</div>
        </div>
      )}

      {coche === true && (
        <>
          <Strava app={app} sessionId={sessionId} orphelines={orphelines} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <label htmlFor={`msc-rpe-${sessionId}`} style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.inkSecondary }}>
                <Icon name="activity" size={15} />
                <div style={{ fontSize: 12 }}>{`${t.ressenti} · ${t.rpe}`}</div>
              </label>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <Mono size={20} color={C.ink}>{rpe}</Mono>
                <Mono size={11} color={C.inkQuiet}>
                  {`${t.charge} ${db.charge(activite?.duree_min ?? session.duree_min, rpe)}`}
                </Mono>
              </div>
            </div>
            <input
              id={`msc-rpe-${sessionId}`}
              type="range"
              min={1}
              max={10}
              step={1}
              disabled={lecture}
              value={rpe}
              onChange={(e) => setRpe(Number(e.target.value))}
              onPointerUp={() => { if (rpe !== rpeEcrit) void app.bilanSeance(sessionId, { rpe }); }}
              onKeyUp={() => { if (rpe !== rpeEcrit) void app.bilanSeance(sessionId, { rpe }); }}
              onBlur={() => { if (rpe !== rpeEcrit) void app.bilanSeance(sessionId, { rpe }); }}
              style={{ width: '100%' }}
            />
          </div>
          <Limites
            lang={lang}
            valeur={journal?.limites ?? []}
            onToggle={(code) => {
              const actuelles = journal?.limites ?? [];
              const suivantes = code === 'rien'
                ? (actuelles.includes('rien') ? [] : ['rien'])
                : actuelles.includes(code)
                  ? actuelles.filter((l) => l !== code)
                  : [...actuelles.filter((l) => l !== 'rien'), code];
              void app.bilanSeance(sessionId, { limites: suivantes });
            }}
            disabled={lecture}
            nudge={(journal?.limites?.length ?? 0) === 0 && Boolean(activite)}
          />
        </>
      )}

      {coche !== null && (
        <textarea
          placeholder={t.note}
          aria-label={t.note}
          rows={2}
          value={note}
          disabled={lecture}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => { if ((journal?.note ?? '') !== note) void app.bilanSeance(sessionId, { note }); }}
          style={{
            width: '100%', resize: 'none', borderRadius: R.md, border: `1px solid ${C.border}`,
            background: C.surface, color: C.ink, padding: 10, fontFamily: F.body, fontSize: 13,
          }}
        />
      )}

      {lecture && <div style={{ fontSize: 11, color: C.inkQuiet }}>{t.lecture}</div>}
    </Card>
  );
}

function Choix({
  actif, couleur, icon, label, disabled, onClick,
}: {
  actif: boolean; couleur: string; icon: string; label: string; disabled: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="msc-hover-accent"
      aria-pressed={actif}
      disabled={disabled}
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 7, padding: '10px 16px', borderRadius: R.full,
        border: `1px solid ${actif ? couleur : C.border}`,
        background: actif ? `${couleur}1A` : C.surface,
        color: actif ? couleur : C.inkMuted, fontSize: 13, fontWeight: 700,
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <Icon name={icon} size={16} />
      {label}
    </button>
  );
}

/* La moitié Strava : ce qui est apparié, ou de quoi le trouver. */
function Strava({
  app, sessionId, orphelines,
}: {
  app: App; sessionId: number; orphelines: App['stravaOrphelines'];
}) {
  const t = T[app.lang];
  const fr = app.lang === 'fr';
  const activite = db.one('msc_activity', (a) => a.session_id === sessionId);
  const lecture = db.droit !== 'ecriture';
  const occupe = app.stravaJob !== 'idle';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.inkSecondary }}>
        <Icon name="link" size={15} />
        <div style={{ fontSize: 12 }}>{t.strava}</div>
      </div>

      {activite ? (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <Icon name="circle-check" size={14} color={C.accentDeep} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: C.ink }}>{t.appariee}</div>
            <Mono size={11} color={C.inkQuiet}>
              {[
                `${activite.duree_min} min`,
                activite.distance_km ? `${activite.distance_km.toFixed(1)} km` : null,
                activite.allure_moy ?? null,
                activite.fc_moy ? `FC ${activite.fc_moy}` : null,
                activite.appariee_main ? t.manuelle : null,
              ].filter(Boolean).join(' · ')}
            </Mono>
          </div>
        </div>
      ) : (
        <>
          <div style={{ fontSize: 11.5, color: C.inkSecondary, lineHeight: 1.45 }}>
            {app.stravaOn ? t.rien : t.pasLie}
          </div>
          {app.stravaOn && !lecture && (
            <div>
              <button
                type="button"
                className="msc-hover-accent"
                disabled={occupe}
                onClick={() => void app.synchroniser()}
                style={{
                  ...PUCE, border: `1px solid ${C.border}`, background: C.surface,
                  color: C.inkMuted, opacity: occupe ? 0.6 : 1,
                }}
              >
                <Icon name={occupe ? 'loader' : 'refresh-cw'} size={13} />
                {occupe ? t.chercheEnCours : t.chercher}
              </button>
            </div>
          )}
        </>
      )}

      {/* Ce que Strava a ce jour-là sans savoir quoi en faire : c'est
          l'athlète qui tranche, et son choix tient. */}
      {!activite && orphelines.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 11, color: C.inkQuiet }}>{t.autresDuJour}</div>
          {orphelines.map((o) => (
            <div
              key={o.id_strava}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                padding: '8px 10px', borderRadius: R.md, border: `1px solid ${C.borderSoft}`,
                background: C.surface,
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {o.nom || (fr ? 'Activité' : 'Aktywność')}
                </div>
                <Mono size={10.5} color={C.inkQuiet}>
                  {[`${o.duree_min} min`, o.sport, o.distance_m ? `${(o.distance_m / 1000).toFixed(1)} km` : null]
                    .filter(Boolean).join(' · ')}
                </Mono>
              </div>
              <button
                type="button"
                className="msc-hover-accent"
                disabled={lecture || occupe}
                onClick={() => void app.attacherActivite(sessionId, o.id_strava)}
                style={{
                  ...PUCE, border: `1px solid ${C.accent}`, background: C.accentSoft,
                  color: C.accentDeep, whiteSpace: 'nowrap', opacity: lecture || occupe ? 0.6 : 1,
                }}
              >
                {t.cetteLa}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
