/* La semaine — planned versus done, the days of this week, and the block's
   pace grid. Each past session wears one of three colours: done (green), done
   otherwise (orange — too short, or another sport that day), missed (red).

   The totals are computed by the engine from the plan, the activities and the
   journal; the pace grid is the "Allures" sheet, derived rather than stored.
   The type legend lives on the Coach screen; a type opens from any session. */

import * as db from '../data/db';
import type { Lang, StatutCode } from '../data/types';
import { C } from '../design/theme';
import { Icon } from '../components/Icon';
import { Card, Grid, Mono, SectionLabel, TypeSquare } from '../components/primitives';
import type { App } from '../state/useApp';

/* Les trois couleurs, dites par un mot à côté de l'icône : jamais la couleur
   seule. Les lignes msc_statut portent l'icône et la teinte ; ces replis
   servent à un instantané en cache d'avant les deux nouveaux statuts. */
const LEGENDE: Record<Lang, Record<'fait' | 'partiel' | 'manque', string>> = {
  fr: { fait: 'faite', partiel: 'autrement', manque: 'manquée' },
  pl: { fait: 'zrobiony', partiel: 'inaczej', manque: 'pominięty' },
};
const REPLI: Partial<Record<StatutCode, { icon: string; couleur: string }>> = {
  partiel: { icon: 'circle-minus', couleur: C.warning },
  manque: { icon: 'circle-x', couleur: C.negative },
};

export function visuelDuStatut(code: StatutCode): { icon: string; couleur: string } {
  return db.one('msc_statut', (r) => r.code === code)
    ?? REPLI[code]
    ?? db.mustOne('msc_statut', (r) => r.code === 'prevu');
}

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
  const grille = db.grilleAllures(bloc.code);
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
                {LEGENDE[lang][code]}
              </span>
            );
          })}
        </div>
      </Card>

      {/* the pace grid for this block — computed from the two references */}
      <Card padding="16px 18px" gap={10}>
        <SectionLabel icon="gauge">
          {`${fr ? 'Allures · bloc' : 'Tempa · blok'} ${bloc.code} · ${db.format10k(db.reference(bloc.code))}`}
        </SectionLabel>
        <div style={{ fontSize: 12, color: C.inkQuiet, lineHeight: 1.4 }}>{bloc.quoi[lang]}</div>
        {grille.map((g) => (
          <div
            key={g.zone.code}
            style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 2 }}
          >
            <Icon name={g.zone.icon} size={14} color={C.inkSecondary} />
            <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: C.inkBody }}>
              {g.zone.label[lang]}
            </div>
            <Mono size={10} color={C.inkQuiet}>
              {g.zone.ecart_s === 0
                ? 'réf.'
                : `${g.zone.ecart_s > 0 ? '+' : '−'}${Math.abs(g.zone.ecart_s)} s`}
            </Mono>
            <Mono size={13} color={C.ink} style={{ minWidth: 66, textAlign: 'right' }}>
              {g.allure}
            </Mono>
          </div>
        ))}
      </Card>
    </div>
  );
}
