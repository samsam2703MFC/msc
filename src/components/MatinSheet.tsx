/* Le matin, en quatre temps — le parcours de l'athlète, tous les jours.

     1. Le signal      FC de repos et HRV, le poids si tu veux. Sans eux, le
                       coach parle sans savoir, et rien ne s'ouvre.
     2. Hier           La dernière séance passée restée sans réponse : faite,
                       ou pas faite et pourquoi. On la règle avant d'en
                       planifier une autre.
     3. Aujourd'hui    La séance du jour, et ce que le coach en dit une fois
                       le signal lu : garder, réduire, allonger, déplacer,
                       sauter. La proposition s'applique, ou pas.
     4. C'est parti    Ce qui est retenu pour aujourd'hui, et on entre.

   Le panneau ne se ferme pas de lui-même : pas de scrim cliquable, pas
   d'Échap. La première étape est obligatoire ; les deux suivantes se passent
   d'un « Plus tard » — un parcours qu'on ne peut pas traverser est un mur, et
   un mur, on le contourne en n'ouvrant plus l'application. */

import { useState } from 'react';
import * as db from '../data/db';
import { libelleAjustement } from '../data/analyse';
import type { Lang } from '../data/types';
import { C, F, R } from '../design/theme';
import { Avatar } from './Avatar';
import { Bilan } from './Bilan';
import { CoachAvatar } from './CoachAvatar';
import { Icon } from './Icon';
import { Mono } from './primitives';
import type { App } from '../state/useApp';

const T: Record<Lang, Record<string, string>> = {
  fr: {
    bonjour: 'Bonjour', titre: 'Ton corps ce matin',
    aide: 'Le plan et la forme se lisent sur ces deux chiffres. Sans eux, rien ne s’ouvre.',
    fc: 'FC de repos', hrv: 'HRV', poids: 'Poids', optionnel: 'optionnel',
    entrer: 'Enregistrer et continuer', enCours: 'Enregistrement…',
    fcAide: 'entre 25 et 120 bpm', hrvAide: 'entre 5 et 300 ms',
    etape: 'Étape', sur: 'sur',
    hierTitre: 'Et hier ?', hierAide: 'Une séance passée attend encore ta réponse. Le coach ne replanifie pas pareil selon ce que tu dis.',
    aujourdhuiTitre: 'Aujourd’hui', aujourdhuiAide: 'Ce que le plan prévoit — et ce que le coach en dit, maintenant qu’il a lu ton matin.',
    demander: 'Demander au coach', demandeEnCours: 'Le coach lit ton matin…', redemander: 'Redemander',
    motDuCoach: 'Le mot du coach', appliquer: 'Appliquer', applique: 'Appliqué', retirer: 'Retirer',
    garder: 'Garder le plan',
    rien: 'Rien de prévu aujourd’hui : repos.',
    pretTitre: 'C’est parti', pretAide: 'Voilà ta journée. Bonne séance.',
    plusTard: 'Plus tard', suivant: 'Continuer', entrerApp: 'Entrer',
    sansCle: 'Le coach n’a pas répondu — le plan tient tel quel.',
  },
  pl: {
    bonjour: 'Dzień dobry', titre: 'Twoje ciało dziś rano',
    aide: 'Plan i forma czytają się z tych dwóch liczb. Bez nich nic się nie otwiera.',
    fc: 'Tętno spoczynkowe', hrv: 'HRV', poids: 'Waga', optionnel: 'opcjonalnie',
    entrer: 'Zapisz i dalej', enCours: 'Zapisywanie…',
    fcAide: 'od 25 do 120 bpm', hrvAide: 'od 5 do 300 ms',
    etape: 'Krok', sur: 'z',
    hierTitre: 'A wczoraj?', hierAide: 'Miniony trening wciąż czeka na odpowiedź. Trener planuje inaczej zależnie od tego, co powiesz.',
    aujourdhuiTitre: 'Dzisiaj', aujourdhuiAide: 'Co przewiduje plan — i co mówi trener, teraz gdy zna twój poranek.',
    demander: 'Zapytaj trenera', demandeEnCours: 'Trener czyta twój poranek…', redemander: 'Zapytaj ponownie',
    motDuCoach: 'Słowo trenera', appliquer: 'Zastosuj', applique: 'Zastosowane', retirer: 'Cofnij',
    garder: 'Zostaw plan',
    rien: 'Nic dziś nie zaplanowano: odpoczynek.',
    pretTitre: 'Do dzieła', pretAide: 'Oto twój dzień. Dobrego treningu.',
    plusTard: 'Później', suivant: 'Dalej', entrerApp: 'Wejdź',
    sansCle: 'Trener nie odpowiedział — plan zostaje bez zmian.',
  },
};

/* Les bornes de vraisemblance : un 0 ou un 400 est une faute de frappe, pas
   une mesure, et il vaut mieux la refuser ici qu'en faire une alerte. */
const FC = { min: 25, max: 120 };
const HRV = { min: 5, max: 300 };
const POIDS = { min: 30, max: 250 };

function nombre(s: string): number | null {
  const n = Number(s.replace(',', '.'));
  return s.trim() !== '' && Number.isFinite(n) ? n : null;
}

function Champ({
  label, unite, aide, value, onChange, valide, requis,
}: {
  label: string; unite: string; aide?: string; value: string; onChange: (v: string) => void;
  valide: boolean; requis: boolean;
}) {
  const touche = value.trim() !== '';
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: C.inkSecondary, fontWeight: 600, whiteSpace: 'nowrap' }}>
        {label}{requis ? ' *' : ''}
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{
            flex: 1, minWidth: 0, boxSizing: 'border-box', padding: '12px 14px', borderRadius: R.md,
            border: `1px solid ${touche && !valide ? C.negative : touche && valide ? C.accent : C.border}`,
            background: C.surface, color: C.ink, fontSize: 22, fontFamily: F.mono,
          }}
        />
        <span style={{ fontSize: 13, color: C.inkQuiet, minWidth: 34 }}>{unite}</span>
      </span>
      {/* la borne sous le champ, en rouge seulement quand la valeur tapée la dépasse */}
      {aide && (
        <span style={{ fontSize: 10.5, color: touche && !valide ? C.negative : C.inkQuiet }}>{aide}</span>
      )}
    </label>
  );
}

/* Les étapes, dans l'ordre. « hier » saute quand il n'y a rien en attente. */
type Etape = 'signal' | 'hier' | 'aujourdhui' | 'pret';

/* La dernière séance passée restée sans réponse : ni coche, ni activité
   appariée. On ne remonte pas plus loin qu'une semaine — au-delà, ce n'est
   plus le parcours du matin, c'est un rattrapage, et il vit dans Semaine. */
function seanceEnAttente(aujourdhui: string): number | undefined {
  const debut = new Date(`${aujourdhui}T00:00:00Z`);
  debut.setUTCDate(debut.getUTCDate() - 7);
  const depuis = debut.toISOString().slice(0, 10);
  return db
    .select('msc_session', (s) => s.date < aujourdhui && s.date >= depuis && s.type !== 'repos')
    .sort((a, b) => b.date.localeCompare(a.date))
    .find((s) => db.one('msc_journal', (j) => j.session_id === s.id)?.fait === undefined
      && !db.one('msc_activity', (a) => a.session_id === s.id))
    ?.id;
}

export function MatinSheet({ app }: { app: App }) {
  const t = T[app.lang];
  const lang = app.lang;
  const aujourdhui = db.aujourdhuiISO();
  /* Choisie une fois, à l'ouverture : répondre la retire de la liste des
     séances en attente, et sans ce gel la carte sauterait à la suivante sous
     les doigts — on croirait que sa réponse n'a pas pris. */
  const [hierId] = useState(() => seanceEnAttente(aujourdhui));

  const [etape, setEtape] = useState<Etape>(
    app.matinRequis ? 'signal' : hierId ? 'hier' : 'aujourdhui',
  );
  const [fc, setFc] = useState('');
  const [hrv, setHrv] = useState('');
  const [poids, setPoids] = useState('');
  const [job, setJob] = useState<'idle' | 'saving'>('idle');
  const [erreur, setErreur] = useState<string | null>(null);

  const fcN = nombre(fc);
  const hrvN = nombre(hrv);
  const poidsN = nombre(poids);
  const fcOk = fcN != null && fcN >= FC.min && fcN <= FC.max;
  const hrvOk = hrvN != null && hrvN >= HRV.min && hrvN <= HRV.max;
  const poidsOk = poids.trim() === '' || (poidsN != null && poidsN >= POIDS.min && poidsN <= POIDS.max);
  const pret = fcOk && hrvOk && poidsOk && job === 'idle';

  const prenom = db.athlete.prenom || db.athlete.surnom || db.athlete.nom;
  /* Quatre étapes annoncées, trois quand il n'y a rien en attente d'hier. */
  const etapes: Etape[] = hierId ? ['signal', 'hier', 'aujourdhui', 'pret'] : ['signal', 'aujourdhui', 'pret'];
  const rang = etapes.indexOf(etape) + 1;

  const suivante = (courante: Etape): Etape => {
    const i = etapes.indexOf(courante);
    return etapes[Math.min(i + 1, etapes.length - 1)];
  };

  const envoyer = async () => {
    if (!pret || fcN == null || hrvN == null) return;
    setJob('saving'); setErreur(null);
    try {
      await app.validerMatin({
        fc_repos: Math.round(fcN),
        hrv_ms: Math.round(hrvN),
        poids_kg: poidsN == null ? undefined : Math.round(poidsN * 10) / 10,
      });
      setJob('idle');
      setEtape(suivante('signal'));
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
      setJob('idle');
    }
  };

  const titre = etape === 'signal' ? t.titre
    : etape === 'hier' ? t.hierTitre
      : etape === 'aujourdhui' ? t.aujourdhuiTitre : t.pretTitre;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={titre}
      style={{ position: 'absolute', inset: 0, zIndex: 120, background: C.scrim, display: 'flex', alignItems: 'flex-end' }}
    >
      <div
        className="msc-scroll"
        style={{
          width: '100%', maxHeight: '92%', overflowY: 'auto', background: C.surface,
          borderRadius: '22px 22px 0 0', padding: '22px 22px 40px',
          display: 'flex', flexDirection: 'column', gap: 16,
          boxShadow: '0 -8px 30px rgba(0,0,0,0.18)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Avatar nom={[db.athlete.prenom, db.athlete.nom].filter(Boolean).join(' ')} taille={52} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 12, color: C.teal, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              {`${t.bonjour} ${prenom}`}
            </div>
            <div style={{ fontFamily: F.display, fontSize: 22, fontWeight: 600, color: C.ink, letterSpacing: '-0.01em' }}>
              {titre}
            </div>
          </div>
          <Mono size={11} color={C.inkQuiet}>{`${t.etape} ${rang}/${etapes.length}`}</Mono>
        </div>

        {/* La progression, en points : où j'en suis, et combien il en reste. */}
        <div style={{ display: 'flex', gap: 5 }}>
          {etapes.map((e, i) => (
            <span
              key={e}
              style={{
                flex: 1, height: 3, borderRadius: R.full,
                background: i < rang ? C.accent : C.surfaceAlt,
              }}
            />
          ))}
        </div>

        {etape === 'signal' && (
          <form onSubmit={(e) => { e.preventDefault(); void envoyer(); }} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: C.inkSecondary, lineHeight: 1.5 }}>
              <Icon name="heart-pulse" size={16} color={C.accentDeep} />
              <span>{t.aide}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 12 }}>
              <Champ label={t.fc} unite="bpm" aide={t.fcAide} value={fc} onChange={setFc} valide={fcOk} requis />
              <Champ label={t.hrv} unite="ms" aide={t.hrvAide} value={hrv} onChange={setHrv} valide={hrvOk} requis />
            </div>
            <Champ label={t.poids} unite="kg" aide={t.optionnel} value={poids} onChange={setPoids} valide={poidsOk} requis={false} />
            {erreur && <div style={{ fontSize: 12, color: C.negative }}>{erreur}</div>}
            <button
              type="submit"
              disabled={!pret}
              style={{
                padding: '14px 16px', borderRadius: R.md, background: C.accent, color: C.accentInk,
                fontWeight: 700, fontSize: 15, border: 'none', opacity: pret ? 1 : 0.45,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
            >
              <Icon name={job === 'saving' ? 'loader' : 'sun'} size={18} />
              {job === 'saving' ? t.enCours : t.entrer}
            </button>
          </form>
        )}

        {etape === 'hier' && hierId !== undefined && (
          <>
            <div style={{ fontSize: 12.5, color: C.inkSecondary, lineHeight: 1.5 }}>{t.hierAide}</div>
            <Bilan app={app} sessionId={hierId} />
            <Boutons
              principal={{ label: t.suivant, onClick: () => setEtape(suivante('hier')) }}
              secondaire={{ label: t.plusTard, onClick: () => setEtape(suivante('hier')) }}
            />
          </>
        )}

        {etape === 'aujourdhui' && (
          <Aujourdhui app={app} t={t} lang={lang} onSuivant={() => setEtape('pret')} />
        )}

        {etape === 'pret' && (
          <>
            <div style={{ fontSize: 12.5, color: C.inkSecondary, lineHeight: 1.5 }}>{t.pretAide}</div>
            <SeanceDuJour app={app} lang={lang} t={t} />
            <Boutons principal={{ label: t.entrerApp, onClick: app.finirMatin }} />
          </>
        )}
      </div>
    </div>
  );
}

function Boutons({
  principal, secondaire,
}: {
  principal: { label: string; onClick: () => void };
  secondaire?: { label: string; onClick: () => void };
}) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      {secondaire && (
        <button
          type="button"
          className="msc-hover-surface"
          onClick={secondaire.onClick}
          style={{ padding: '12px 14px', borderRadius: R.md, border: `1px solid ${C.border}`, background: C.surface, color: C.inkMuted, fontSize: 13, fontWeight: 600 }}
        >
          {secondaire.label}
        </button>
      )}
      <button
        type="button"
        onClick={principal.onClick}
        style={{
          flex: 1, padding: '14px 16px', borderRadius: R.md, background: C.accent, color: C.accentInk,
          fontWeight: 700, fontSize: 15, border: 'none',
        }}
      >
        {principal.label}
      </button>
    </div>
  );
}

/* La séance du jour, telle qu'elle est maintenant — après une adaptation
   acceptée, c'est déjà la nouvelle. */
function SeanceDuJour({ app, lang, t }: { app: App; lang: Lang; t: Record<string, string> }) {
  const session = db.sessionDuJour(db.aujourdhuiISO());
  if (!session) {
    return <div style={{ fontSize: 13, color: C.inkSecondary }}>{t.rien}</div>;
  }
  const type = db.type(session.type);
  return (
    <button
      type="button"
      className="msc-hover-surface"
      onClick={() => app.openSession(session.id)}
      style={{
        display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
        padding: '12px 14px', borderRadius: R.md, border: `1px solid ${C.border}`, background: C.page,
      }}
    >
      <div style={{ width: 34, height: 34, borderRadius: R.md, flexShrink: 0, display: 'grid', placeItems: 'center', background: C.surface, border: `1px solid ${C.border}`, color: type.color }}>
        <Icon name={type.icon} size={17} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, color: C.ink }}>{session.titre_court[lang]}</div>
        <Mono size={11} color={C.inkQuiet}>{`${session.duree_min} min · RPE ${session.rpe_cible}`}</Mono>
      </div>
      <Icon name="chevron-right" size={16} color={C.inkQuiet} />
    </button>
  );
}

/* L'étape 3 : la séance du jour, et le mot du coach quand on le demande.

   Le coach lit le signal qu'on vient de taper — c'est pour ça que l'étape est
   ici et pas ailleurs — et rend une ligne par jour ; on ne montre que celle
   d'aujourd'hui, avec de quoi l'appliquer ou la laisser. */
function Aujourdhui({
  app, t, lang, onSuivant,
}: {
  app: App; t: Record<string, string>; lang: Lang; onSuivant: () => void;
}) {
  const aujourdhui = db.aujourdhuiISO();
  const analyse = db.select('msc_analyse', (a) => a.type === 'glissant').sort((a, b) => b.id - a.id)[0];
  const jour = analyse?.glissant?.jours?.find((j) => j.date === aujourdhui);
  const ajustement = analyse
    ? db.select('msc_ajustement', (a) => a.analyse_id === analyse.id)
      .find((a) => a.session_id !== undefined && a.session_id === jour?.session_id)
    : undefined;
  const libelle = ajustement ? libelleAjustement(ajustement, lang) : undefined;
  const running = app.glissant === 'running';
  /* Le coach a répondu pour aujourd'hui si son analyse date d'aujourd'hui. */
  const frais = analyse?.date === aujourdhui;

  return (
    <>
      <div style={{ fontSize: 12.5, color: C.inkSecondary, lineHeight: 1.5 }}>{t.aujourdhuiAide}</div>
      <SeanceDuJour app={app} lang={lang} t={t} />

      {frais && jour && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 14px', borderRadius: R.md, background: C.accentSoft, border: `1px solid ${C.accent}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <CoachAvatar code={db.athlete.coach} taille={26} />
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: C.accentDeep }}>
              {t.motDuCoach}
            </div>
          </div>
          <div style={{ fontSize: 13, color: C.ink, lineHeight: 1.5 }}>{jour.note}</div>
          {libelle && ajustement && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Mono size={11} color={C.inkSecondary}>{libelle.quoi}</Mono>
              <button
                type="button"
                onClick={() => void app.accepter('msc_ajustement', ajustement.id, !ajustement.applique)}
                style={{
                  padding: '7px 12px', borderRadius: R.full, fontSize: 12, fontWeight: 700, border: 'none',
                  background: ajustement.applique ? C.surface : C.accent,
                  color: ajustement.applique ? C.inkMuted : C.accentInk,
                  boxShadow: ajustement.applique ? `inset 0 0 0 1px ${C.border}` : 'none',
                }}
              >
                {ajustement.applique ? t.retirer : t.appliquer}
              </button>
            </div>
          )}
        </div>
      )}

      {app.glissantErreur && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 12, color: C.warning, lineHeight: 1.45 }}>
          <Icon name="triangle-alert" size={13} />
          <span>{t.sansCle}</span>
        </div>
      )}

      <Boutons
        principal={{ label: t.suivant, onClick: onSuivant }}
        secondaire={{
          label: running ? t.demandeEnCours : frais ? t.redemander : t.demander,
          onClick: () => { if (!running) app.runGlissant(); },
        }}
      />
    </>
  );
}
