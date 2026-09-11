/* La semaine — planned versus done, the days of this week, and the block's
   pace grid. Each past session wears one of three colours: done (green), done
   otherwise (orange — too short, or another sport that day), missed (red).

   The totals are computed by the engine from the plan, the activities and the
   journal; the pace grid is the "Allures" sheet, derived rather than stored.
   The type legend lives on the Coach screen; a type opens from any session. */

import * as db from '../data/db';
import { motDuStatut, visuelDuStatut } from '../data/statut';
import { JOURS, SPORTS } from '../data/structure';
import type { Lang, MscPlanSession } from '../data/types';
import { C } from '../design/theme';
import { Annee } from '../components/Annee';
import { raisonEnClair } from '../components/Bilan';
import { Icon } from '../components/Icon';
import { Card, Grid, Mono, SectionLabel, TypeSquare } from '../components/primitives';
import type { App } from '../state/useApp';

function heures(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`;
}

export function WeekScreen({ app }: { app: App }) {
  const lang = app.lang;
  const fr = lang === 'fr';

  /* Faite : une activité appariée d'une durée raisonnable, ou la coche de
     l'athlète. Une sortie sur un jour de repos n'est la séance de personne. */
  const etat = db.etatDesSeances();
  const faites = etat.faites;
  const bilan = db.bilanSemaine(app.semaine);
  const jours = db.sessionsDeSemaine(app.semaine);
  const bloc = db.blocDeSemaine(app.semaine);
  const semaine = db.semaine(app.semaine);

  const realise = {
    minutes: jours.filter((s) => faites.has(s.id)).reduce((t, s) => t + s.duree_min, 0),
    km: jours.filter((s) => faites.has(s.id)).reduce((t, s) => t + (s.distance_km ?? 0), 0),
    metres: jours.filter((s) => faites.has(s.id)).reduce((t, s) => t + (s.natation_m ?? 0), 0),
  };

  const totaux = [
    { code: 'duree', icon: 'clock', label: fr ? 'Durée' : 'Czas',
      done: heures(realise.minutes), plan: heures(bilan.prevu.minutes) },
    { code: 'course', icon: 'footprints', label: fr ? 'Course' : 'Bieg',
      done: `${realise.km.toFixed(0)} km`, plan: `${bilan.prevu.km.toFixed(0)} km` },
    { code: 'nage', icon: 'waves', label: fr ? 'Nage' : 'Pływanie',
      done: `${realise.metres} m`, plan: `${bilan.prevu.metres} m` },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* the whole plan at a glance — a tap on a week goes there */}
      <Annee app={app} />

      {/* where the week sits in the plan */}
      <Card padding="14px 18px" gap={8}>
        <SectionLabel icon="calendar-days">
          {`${fr ? 'Semaine' : 'Tydzień'} ${app.semaine} / ${db.derniereSemaine} · ${fr ? 'bloc' : 'blok'} ${bloc.code}`}
        </SectionLabel>
        <div style={{ fontSize: 13, color: C.inkBody, lineHeight: 1.45 }}>
          {semaine?.phase ?? bloc.nom[lang]}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <Mono size={11} color={C.inkQuiet}>
            {`${fr ? 'charge planifiée' : 'planowane obciążenie'} ${bilan.prevu.charge}`}
          </Mono>
        </div>
      </Card>

      {/* Ce qui vient, à partir d'aujourd'hui — pas la semaine civile, qui est
          à moitié passée dès mercredi. C'est la même lecture que le coach a de
          son côté : sept jours glissants, sport, durée, allure. */}
      <Sept app={app} etat={etat} />

      {/* Ma semaine type, et ce qui s'en écarte cette semaine. */}
      <SemaineType jours={jours} lang={lang} />

      <Grid cols={3} gap={10}>
        {totaux.map((t) => (
          <Card key={t.code} padding={12} gap={6}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: C.inkSecondary }}>
              <Icon name={t.icon} size={14} />
              <div style={{ fontSize: 10 }}>{t.label}</div>
            </div>
            <Mono size={15} color={C.ink}>
              {t.done}
            </Mono>
            <Mono size={10} color={C.inkQuiet}>
              {`/ ${t.plan}`}
            </Mono>
          </Card>
        ))}
      </Grid>

      <Card padding={0} gap={0} style={{ overflow: 'hidden' }}>
        {jours.map((d) => {
          const statut = visuelDuStatut(db.statutDe(d, app.date, etat));
          const type = db.type(d.type);
          return (
            <button
              key={d.id}
              type="button"
              className="msc-hover-surface"
              onClick={() => app.openSession(d.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '12px 14px',
                borderTop: `1px solid ${C.borderSoft}`,
                width: '100%',
              }}
            >
              <Mono size={11} style={{ width: 30, textAlign: 'left' }}>
                {d.jour[lang]}
              </Mono>
              <TypeSquare
                icon={type.icon}
                color={type.color}
                label={type.label[lang]}
                onClick={() => app.openType(type.code)}
              />
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  textAlign: 'left',
                }}
              >
                <div style={{ fontSize: 14, color: C.ink }}>{d.titre_court[lang]}</div>
                <div style={{ fontSize: 11, color: C.inkQuiet }}>{d.meta[lang]}</div>
                {/* Une séance sautée porte son motif : la ligne dit pourquoi
                    plutôt que de laisser une croix rouge sans explication. */}
                {(() => {
                  const j = db.one('msc_journal', (r) => r.session_id === d.id);
                  if (j?.fait !== false || !j.raisons?.length) return null;
                  return (
                    <div style={{ fontSize: 11, color: C.negative }}>
                      {j.raisons.map((r) => raisonEnClair(r, lang).toLowerCase()).join(' · ')}
                    </div>
                  );
                })()}
              </div>
              <Icon name={statut.icon} size={17} color={statut.couleur} />
            </button>
          );
        })}
        {/* ce que les couleurs veulent dire — un mot avec chaque icône */}
        <div
          style={{
            display: 'flex', flexWrap: 'wrap', gap: '4px 14px', padding: '8px 16px 10px',
            borderTop: `1px solid ${C.borderSoft}`, fontSize: 11, color: C.inkSecondary,
          }}
        >
          {(['fait', 'partiel', 'manque'] as const).map((code) => {
            const v = visuelDuStatut(code);
            return (
              <span key={code} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <Icon name={v.icon} size={13} color={v.couleur} />
                {motDuStatut(code, lang)}
              </span>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

/* La semaine type, en tête de la semaine réelle.

   La matrice dit la forme qui ne bouge pas : le mardi c'est la nage, le
   mercredi la qualité, le samedi la longue. Le plan, lui, bouge — le coach
   recalcule, l'athlète déplace. Cette bande met les deux l'une sur l'autre :
   sept jours, le sport prévu par la matrice, et un point quand le jour, cette
   semaine, ne porte pas ce sport-là.

   Rien n'est calculé en base pour ça : la matrice est déjà dans l'instantané,
   et les séances aussi. Sans matrice, la carte ne s'affiche pas — il n'y a
   rien à comparer. */
function SemaineType({ jours, lang }: { jours: MscPlanSession[]; lang: Lang }) {
  const fr = lang === 'fr';
  const creneaux = db.select('msc_structure');
  if (creneaux.length === 0) return null;

  /* Le sport que chaque jour porte vraiment, cette semaine — rangé par la
     date, pas par le nom du jour : la matrice compte de lundi (0) à dimanche
     (6), et `getDay()` compte de dimanche. Une date ne se traduit pas. */
  const reels = new Map<number, string[]>();
  for (const s of jours) {
    if (s.discipline === 'Repos') continue;
    const i = (new Date(`${s.date}T00:00:00`).getDay() + 6) % 7;
    reels.set(i, [...(reels.get(i) ?? []), s.discipline]);
  }

  const colonnes = JOURS.map((j, i) => {
    const prevus = creneaux.filter((c) => c.jour === i).map((c) => c.discipline);
    const reel = reels.get(i) ?? [];
    /* « Écart » : la matrice attend un sport que la semaine ne porte pas, ou
       l'inverse. On compare des ensembles, pas des listes — deux créneaux du
       même sport le même jour ne comptent pas pour deux. */
    const attendu = new Set(prevus);
    const fait = new Set(reel);
    const ecart = [...attendu].some((sp) => !fait.has(sp)) || [...fait].some((sp) => !attendu.has(sp));
    return { jour: j, prevus, ecart };
  });
  const ecarts = colonnes.filter((c) => c.ecart).length;

  return (
    <Card padding="14px 16px" gap={10}>
      <SectionLabel icon="repeat">{fr ? 'Ma semaine type' : 'Mój tydzień wzorcowy'}</SectionLabel>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
        {colonnes.map((c) => (
          <div
            key={c.jour.index}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              padding: '6px 2px', borderRadius: 10,
              background: c.ecart ? C.warningBg : C.surfaceAlt,
            }}
          >
            <Mono size={9} color={C.inkQuiet}>{c.jour.court[lang]}</Mono>
            {c.prevus.length === 0
              ? <Icon name="moon" size={13} color={C.inkQuiet} />
              : c.prevus.map((sp, k) => (
                <Icon
                  key={`${sp}-${k}`}
                  name={SPORTS.find((x) => x.code === sp)?.icon ?? 'circle'}
                  size={13}
                  color={c.ecart ? C.warning : C.inkSecondary}
                />
              ))}
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11.5, color: C.inkSecondary, lineHeight: 1.45 }}>
        {ecarts === 0
          ? (fr
            ? 'Cette semaine suit ta semaine type : même sport, aux mêmes jours.'
            : 'Ten tydzień trzyma się wzorca: te same sporty, w te same dni.')
          : (fr
            ? `${ecarts} jour${ecarts > 1 ? 's' : ''} s’écarte${ecarts > 1 ? 'nt' : ''} de ta semaine type — le coach a changé le sport, ou le jour est vide.`
            : `${ecarts} dzień/dni odbiega od wzorca — trener zmienił sport albo dzień jest pusty.`)}
      </div>
    </Card>
  );
}

/* Les sept prochains jours, glissants. Pas d'appel au coach ici : c'est le
   calendrier tel qu'il est écrit, lu depuis aujourd'hui. L'adaptation, elle,
   est dans l'onglet Coach — elle demande le signal du matin. */
function Sept({ app, etat }: { app: App; etat: ReturnType<typeof db.etatDesSeances> }) {
  const lang = app.lang;
  const fr = lang === 'fr';
  const jour = (n: number) => new Date(Date.parse(`${app.date}T00:00:00Z`) + n * 86_400_000)
    .toISOString().slice(0, 10);
  const sept = Array.from({ length: 7 }, (_, i) => jour(i));
  const toutes = db.select('msc_session');

  return (
    <Card padding="14px 16px" gap={8}>
      <SectionLabel icon="calendar-days">
        {fr ? 'Les 7 prochains jours' : 'Najbliższe 7 dni'}
      </SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {sept.map((d, i) => {
          const duJour = toutes.filter((s) => s.date === d && s.discipline !== 'Repos');
          const nom = new Date(`${d}T00:00:00`).toLocaleDateString(fr ? 'fr-FR' : 'pl-PL',
            { weekday: 'short', day: 'numeric' });
          return (
            <div
              key={d}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0',
                borderTop: i === 0 ? 'none' : `1px solid ${C.borderSoft}`,
              }}
            >
              <Mono size={11} color={d === app.date ? C.accentDeep : C.inkQuiet}
                style={{ width: 58, flexShrink: 0, textTransform: 'uppercase' }}>
                {i === 0 ? (fr ? 'auj.' : 'dziś') : nom}
              </Mono>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                {duJour.length === 0 && (
                  <span style={{ fontSize: 12.5, color: C.inkQuiet }}>{fr ? 'repos' : 'odpoczynek'}</span>
                )}
                {duJour.map((s) => {
                  const statut = visuelDuStatut(db.statutDe(s, app.date, etat));
                  const type = db.type(s.type);
                  const allures = s.zones.map((z) => db.allure(z, s.bloc))
                    .filter((x, j, liste) => liste.indexOf(x) === j).join(' · ');
                  return (
                    <button
                      key={s.id}
                      type="button"
                      className="msc-hover-surface"
                      onClick={() => app.openSession(s.id)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                        textAlign: 'left', padding: 0,
                      }}
                    >
                      <Icon name={statut.icon} size={12} color={statut.couleur} />
                      <span style={{ fontSize: 13, color: C.ink, flex: 1, minWidth: 0 }}>
                        {`${s.discipline} · ${type.label[lang]}`}
                      </span>
                      <Mono size={11} color={C.inkQuiet}>
                        {`${s.duree_min}′${allures ? ` · ${allures}` : ''}`}
                      </Mono>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
