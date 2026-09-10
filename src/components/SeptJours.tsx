/* Les sept prochains jours — l'adaptation à jours glissants.

   Le coach lit le signal du matin (FC de repos et HRV contre leur base, le
   score), ce que la semaine a donné jusqu'ici (faite, autrement, manquée, ce
   qui a bloqué), et replanifie les sept jours qui viennent — pas la semaine
   du calendrier, les sept jours à partir d'aujourd'hui. Chaque ligne dit ce
   que devient la séance ; celles qui la changent (une autre quantité, un
   autre jour) s'acceptent une par une, comme les ajustements de la semaine,
   et c'est le moteur qui écrit la séance. Une décision à trancher plus tard
   (la sortie longue si la HRV tient samedi) reste une règle, pas un pari. */

import * as db from '../data/db';
import { libelleAjustement } from '../data/analyse';
import type { GlissantJour, Lang } from '../data/types';
import { C, F, R } from '../design/theme';
import { Icon } from './Icon';
import { Observations } from './Observations';
import { AccentButton, Card, IconLine, Mono, SectionLabel } from './primitives';
import type { App } from '../state/useApp';

const T: Record<Lang, Record<string, string>> = {
  fr: {
    titre: 'Les 7 prochains jours', intro: 'Le coach lit le signal du matin — FC de repos, HRV — et ce que la semaine a donné, puis replanifie les sept jours qui viennent.',
    lancer: 'Replanifier avec le signal du matin', encore: 'Replanifier à nouveau', enCours: 'Le coach replanifie…',
    signal: 'Le signal du matin', implication: 'Ce que ça implique', decision: 'À trancher',
    garder: 'plan normal', reduire: 'réduite', allonger: 'allongée', deplacer: 'déplacée', sauter: 'sautée', repos: 'repos',
    journee_dure_ok: 'journée dure possible', qualite_ok: 'qualité possible', facile: 'facile seulement', repos_verdict: 'repos',
    accepter: 'Appliquer à la séance', retirer: 'Retirer',
  },
  pl: {
    titre: 'Najbliższe 7 dni', intro: 'Trener czyta poranny sygnał — tętno spoczynkowe, HRV — i to, co dał tydzień, po czym planuje na nowo najbliższe siedem dni.',
    lancer: 'Zaplanuj na nowo z porannym sygnałem', encore: 'Zaplanuj ponownie', enCours: 'Trener planuje…',
    signal: 'Poranny sygnał', implication: 'Co to oznacza', decision: 'Do rozstrzygnięcia',
    garder: 'bez zmian', reduire: 'skrócony', allonger: 'wydłużony', deplacer: 'przeniesiony', sauter: 'pominięty', repos: 'odpoczynek',
    journee_dure_ok: 'ciężki dzień możliwy', qualite_ok: 'jakość możliwa', facile: 'tylko lekko', repos_verdict: 'odpoczynek',
    accepter: 'Zastosuj do treningu', retirer: 'Cofnij',
  },
};

const VERDICT_ICONE: Record<string, { icon: string; couleur: string }> = {
  journee_dure_ok: { icon: 'sparkles', couleur: C.accentDeep },
  qualite_ok: { icon: 'circle-check', couleur: C.accentDeep },
  facile: { icon: 'clock-alert', couleur: C.warning },
  repos: { icon: 'battery-low', couleur: C.negative },
};

/* La couleur de l'action porte toujours son mot à côté. */
function teinteAction(action: GlissantJour['action']): { fond: string; encre: string } {
  if (action === 'reduire' || action === 'allonger') return { fond: C.warningBg, encre: C.warning };
  if (action === 'deplacer') return { fond: C.accentSoft, encre: C.teal };
  if (action === 'sauter') return { fond: 'rgba(216,90,48,0.12)', encre: C.negative };
  if (action === 'repos') return { fond: 'transparent', encre: C.inkQuiet };
  return { fond: C.surfaceAlt, encre: C.inkSecondary };
}

function jourCourt(date: string, lang: Lang): { jour: string; num: string } {
  const d = new Date(`${date}T00:00:00`);
  return {
    jour: d.toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'pl-PL', { weekday: 'short' }).replace('.', '').toUpperCase(),
    num: String(d.getDate()),
  };
}

export function SeptJours({ app }: { app: App }) {
  const lang = app.lang;
  const t = T[lang];
  const analyse = db.select('msc_analyse', (a) => a.type === 'glissant').sort((a, b) => b.id - a.id)[0];
  const contenu = analyse?.glissant;
  const ajustements = analyse ? db.select('msc_ajustement', (a) => a.analyse_id === analyse.id) : [];
  const running = app.glissant === 'running';
  const stamp = analyse ? `${analyse.date.slice(8)}/${analyse.date.slice(5, 7)} · ${analyse.modele}` : null;
  const verdict = contenu ? VERDICT_ICONE[contenu.signal.verdict] ?? VERDICT_ICONE.qualite_ok : null;

  return (
    <Card padding="16px 18px" gap={12}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <SectionLabel icon="calendar-days" color={C.teal}>{t.titre}</SectionLabel>
        {stamp && <Mono size={10} color={C.inkQuiet}>{stamp}</Mono>}
      </div>

      {!contenu && <div style={{ fontSize: 13, lineHeight: 1.5, color: C.inkBody }}>{t.intro}</div>}

      <AccentButton
        label={running ? t.enCours : contenu ? t.encore : t.lancer}
        icon={running ? 'loader' : 'refresh-cw'}
        active={running}
        onClick={app.runGlissant}
      />

      {app.glissantErreur && (
        <div
          style={{
            display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 10px', borderRadius: R.md,
            background: C.warningBg, color: C.warning, fontSize: 11, lineHeight: 1.4,
          }}
        >
          <Icon name="triangle-alert" size={14} />
          <span>{app.glissantErreur}</span>
        </div>
      )}

      {contenu && analyse && verdict && (
        <>
          {/* le signal du matin, avec les chiffres que le serveur a donnés au coach */}
          <div style={{ borderRadius: 12, background: C.page, border: `1px solid ${C.border}`, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name={verdict.icon} size={16} color={verdict.couleur} />
              <div style={{ fontSize: 14, fontWeight: 700, color: C.ink }}>{contenu.signal.titre}</div>
            </div>
            {contenu.signal.lignes.map((l, i) => (
              <div key={i} style={{ fontSize: 12.5, lineHeight: 1.45, color: C.inkBody }}>{l}</div>
            ))}
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, alignSelf: 'flex-start', marginTop: 2, padding: '3px 9px', borderRadius: R.full, background: C.surface, border: `1px solid ${verdict.couleur}`, color: verdict.couleur, fontSize: 11, fontWeight: 600 }}>
              <Icon name={verdict.icon} size={12} />
              {t[contenu.signal.verdict === 'repos' ? 'repos_verdict' : contenu.signal.verdict]}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.inkQuiet, fontWeight: 600, marginBottom: 4 }}>{t.implication}</div>
            <div style={{ fontSize: 13.5, lineHeight: 1.5, color: C.inkBody }}>{contenu.implication}</div>
          </div>

          {/* jour par jour */}
          <div style={{ display: 'flex', flexDirection: 'column', borderTop: `1px solid ${C.borderSoft}` }}>
            {contenu.jours.map((j, i) => {
              const { jour, num } = jourCourt(j.date, lang);
              const session = j.session_id ? db.one('msc_session', (s) => s.id === j.session_id) : undefined;
              const type = session ? db.type(session.type) : null;
              const aj = j.session_id ? ajustements.find((a) => a.session_id === j.session_id) : undefined;
              const libelle = aj ? libelleAjustement(aj, lang) : undefined;
              const teinte = teinteAction(j.action);
              const memeJour = i > 0 && contenu.jours[i - 1].date === j.date;
              return (
                <div key={`${j.date}-${i}`} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 0', borderBottom: `1px solid ${C.borderSoft}` }}>
                  <div style={{ width: 34, flexShrink: 0, textAlign: 'center', visibility: memeJour ? 'hidden' : 'visible' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: C.inkSecondary, letterSpacing: '0.04em' }}>{jour}</div>
                    <div style={{ fontFamily: F.mono, fontSize: 15, color: C.ink, lineHeight: 1.1 }}>{num}</div>
                  </div>
                  <button
                    type="button"
                    className="msc-hover-surface"
                    disabled={!session}
                    onClick={() => { if (session) app.openSession(session.id); }}
                    style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3, textAlign: 'left', fontFamily: F.body, padding: 0 }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {type && <Icon name={type.icon} size={14} color={type.color} />}
                      <span style={{ fontSize: 13, fontWeight: 600, color: j.action === 'sauter' ? C.inkQuiet : C.ink, textDecoration: j.action === 'sauter' ? 'line-through' : 'none' }}>
                        {j.titre}
                      </span>
                    </div>
                    {j.format && <div style={{ fontFamily: F.mono, fontSize: 11, color: C.inkSecondary }}>{j.format}</div>}
                    <div style={{ fontSize: 12, color: C.inkBody, lineHeight: 1.4 }}>{j.note}</div>
                    {libelle && (
                      <div style={{ fontSize: 11, color: aj?.applique ? C.accentDeep : C.inkQuiet }}>
                        {aj?.applique ? '✓ ' : ''}{libelle.quoi}
                      </div>
                    )}
                  </button>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                    <span style={{ padding: '2px 8px', borderRadius: R.full, background: teinte.fond, color: teinte.encre, fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>
                      {t[j.action]}
                    </span>
                    {aj && db.droit === 'ecriture' && (
                      <button
                        type="button"
                        className="msc-hover-bright"
                        aria-pressed={aj.applique}
                        aria-label={aj.applique ? t.retirer : t.accepter}
                        title={aj.applique ? t.retirer : t.accepter}
                        onClick={() => void app.accepter('msc_ajustement', aj.id, !aj.applique)}
                        style={{
                          width: 32, height: 32, borderRadius: R.md, display: 'flex', alignItems: 'center', justifyContent: 'center',
                          background: aj.applique ? C.accentSoft : C.accent, color: aj.applique ? C.accentDeep : C.accentInk,
                          border: `1px solid ${C.accent}`,
                        }}
                      >
                        <Icon name={aj.applique ? 'check' : 'plus'} size={16} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {contenu.decision && (
            <IconLine icon="flag" iconColor={C.teal} fontSize={13} lineHeight={1.45}>
              <strong>{`${t.decision} ${contenu.decision.quand}`}</strong>{` — ${contenu.decision.regle}`}
            </IconLine>
          )}

          <Observations analyse={analyse} lang={lang} />
        </>
      )}
    </Card>
  );
}
