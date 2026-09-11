/* Importe un plan écrit à la main — la grille du classeur de l'athlète — dans
   la base, comme plan actif.

       npm run db:importer-plan -- db/plans/sam-verheyden-2026-2027.json
       npm run db:importer-plan -- db/plans/sam-verheyden-2026-2027.json --athlete 1 --ecrire
       npm run db:importer-plan -- <plan.json> --refs 4:10 3:40 --ecrire

   Sans --ecrire, rien n'est écrit : le script traduit la grille et dit ce
   qu'il en ferait — blocs, semaines, séances par type, heures par phase,
   compétitions, et ce qu'il n'a pas su lire. C'est ce qu'on relit avant
   d'écrire.

   La grille (db/plans/*.json) est le classeur lu tel quel : une ligne par
   semaine, sept cellules de jours en texte libre (« FRAC / 10m warm /
   3×4m @3:55 / 10m cool »), la ligne « — MUSCU » qui la suit, les totaux, la
   colonne RACE. Ce fichier traduit ce texte en séances du moteur : une
   discipline, un type, une durée, un RPE cible, des zones — et garde le texte
   d'origine dans le déroulé, parce que c'est lui que l'athlète a écrit.

   Deux choses que le moteur ne sait pas prendre telles quelles :

   - Les allures. Le classeur les écrit (« @3:55 ») ; le moteur les calcule
     depuis la référence 10 km de l'athlète et le `part` du bloc. Le fichier
     pose donc les deux références (`references`) et, phase par phase, où
     elle se situe entre les deux (`parts`) — l'intention de la phase, posée à
     la main. Sans `parts`, on déduit de l'allure du fractionné la référence
     10 km que la phase suppose ; elle s'affiche dans les deux cas, pour voir
     où le classeur et le moteur divergent. Les allures affichées seront
     celles du moteur, à quelques secondes de celles du classeur ; le texte
     d'origine reste lisible à côté.

   - Les courses. La colonne RACE porte le nom et la date de l'épreuve, mais
     pas toujours sur la bonne ligne : « SEMI (21/02) » est écrit sur la
     semaine du 22/02, la veille. La date entre parenthèses fait foi : la
     séance de course se pose ce jour-là, et la cellule « 🏆 RACE » du
     dimanche devient un repos. Les compétitions elles-mêmes viennent de la
     liste `competitions` du fichier, avec leur discipline et leur cible. */

import { readFile } from 'node:fs/promises';
import { bd, fermer, ligne } from '../server/bd.mjs';
import { enregistrerPlan } from '../server/depots.mjs';

/* ------------------------------------------------------------ arguments */

const args = process.argv.slice(2);
const fichier = args.find((a) => !a.startsWith('--'));
const ecrire = args.includes('--ecrire');
const option = (nom, n = 1) => {
  const i = args.indexOf(nom);
  return i === -1 ? null : args.slice(i + 1, i + 1 + n);
};
const athleteId = Number(option('--athlete')?.[0] ?? 1);
const refs = option('--refs', 2);

if (!fichier) {
  console.error('usage : npm run db:importer-plan -- <plan.json> [--athlete 1] [--refs 4:10 3:40] [--ecrire]');
  process.exit(1);
}

/* ------------------------------------------------------------ lecture */

function secondes(mmss) {
  const m = String(mmss).trim().match(/^(\d{1,2}):([0-5]\d)$/);
  if (!m) throw new Error(`Allure illisible : « ${mmss} » (attendu m:ss)`);
  return Number(m[1]) * 60 + Number(m[2]);
}
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

const JOURS = ['LUNDI', 'MARDI', 'MERCREDI', 'JEUDI', 'VENDREDI', 'SAMEDI', 'DIMANCHE'];
const JOUR = {
  LUNDI: { long: 'Lundi', fr: 'LUN', pl: 'PON' },
  MARDI: { long: 'Mardi', fr: 'MAR', pl: 'WT' },
  MERCREDI: { long: 'Mercredi', fr: 'MER', pl: 'ŚR' },
  JEUDI: { long: 'Jeudi', fr: 'JEU', pl: 'CZW' },
  VENDREDI: { long: 'Vendredi', fr: 'VEN', pl: 'PT' },
  SAMEDI: { long: 'Samedi', fr: 'SAM', pl: 'SOB' },
  DIMANCHE: { long: 'Dimanche', fr: 'DIM', pl: 'ND' },
};

function dateISO(premierLundi, semaine, jourIndex) {
  const d = new Date(`${premierLundi}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + (semaine - 1) * 7 + jourIndex);
  return d.toISOString().slice(0, 10);
}

/* Le texte d'une cellule, ligne par ligne, sans les vides. */
const lignes = (cellule) => String(cellule ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
const minutes = (texte) => {
  const m = String(texte).match(/(\d+)\s*-\s*(\d+)m\b/);
  if (m) return Math.round((Number(m[1]) + Number(m[2])) / 2);
  const u = String(texte).match(/(\d+)m\b/);
  return u ? Number(u[1]) : null;
};
const allure = (texte) => {
  const m = String(texte).match(/@\s*(\d):(\d\d)/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/* Les écarts des zones, les mêmes que msc_zone : ce qu'il faut ajouter à la
   référence 10 km pour avoir l'allure de la zone. */
const ECART = { recup: 95, ef: 75, endactive: 55, marathon: 30, semi: 14, seuil: 10, allure10: 0, vma: -10 };

const RPE = { recup: 3, ef: 4, longue: 5, seuil: 7, vma: 8, allure10: 7, velo: 4, nage: 4, force: 5,
              course: 9, repos: 0, compromis: 4, montagne: 5 };

const PL = {
  recup: 'Rozbieganie', ef: 'Bieg spokojny', longue: 'Długie wybieganie', seuil: 'Próg', vma: 'Interwały VO2max',
  allure10: 'Tempo 10 km', velo: 'Rower', nage: 'Pływanie', force: 'Siłownia', course: 'Zawody', repos: 'Odpoczynek',
  compromis: 'Kompromis', montagne: 'Góry',
};

/* ------------------------------------------------- une cellule → une séance */

/**
 * Lit une cellule de jour. Rend la séance (sans date ni bloc : la semaine les
 * pose), ou null pour une cellule vide. `estimation` dit quand un nombre est
 * déduit plutôt que lu, pour le rapport.
 */
function lireCellule(cellule, jour, totaux, avertir) {
  const l = lignes(cellule);
  if (l.length === 0) return null;
  const tete = l[0];
  const brut = l.join(' · ');
  const meta = (duree, rpe, extra = '') => `${duree} min${extra ? ` · ${extra}` : ''} · RPE ${rpe}`;

  if (/^🏆|^RACE/u.test(tete)) {
    /* La course elle-même se pose à sa date (voir plus bas) ; ici, la
       cellule du dimanche est un repos qui garde le nom de l'épreuve. */
    const nom = l.slice(1).join(' ') || tete.replace(/^🏆\s*RACE\s*/u, '');
    return {
      discipline: 'Repos', type: 'repos', duree_min: 0, rpe_cible: 0, zones: [],
      titre: { fr: `Repos — ${nom}`, pl: `Odpoczynek — ${nom}` },
      titre_court: { fr: `Repos · ${nom}`, pl: `Odpoczynek · ${nom}` },
      meta: { fr: 'repos', pl: 'odpoczynek' },
      detail: { fr: `Jour de repos autour de l'épreuve : ${nom}.`, pl: `Dzień odpoczynku wokół zawodów: ${nom}.` },
    };
  }

  if (/^RÉCUP/i.test(tete)) {
    const duree = minutes(brut) ?? 45;
    return {
      discipline: 'Course à pied', type: 'recup', duree_min: duree, rpe_cible: RPE.recup, zones: ['recup'],
      titre: { fr: `Récupération ${duree} min`, pl: `Rozbieganie ${duree} min` },
      titre_court: { fr: `Récup ${duree}'`, pl: `Rozb. ${duree}'` },
      meta: { fr: meta(duree, RPE.recup), pl: meta(duree, RPE.recup) },
      detail: { fr: `${duree} min très facile, sans montre. Classeur : ${brut}`, pl: `${duree} min bardzo spokojnie. Plan: ${brut}` },
      consigne: { fr: 'À l’effort, pas à l’allure', pl: 'Według wysiłku, nie tempa' },
    };
  }

  if (/^NAT REC/i.test(tete)) {
    const duree = minutes(brut) ?? 25;
    return {
      discipline: 'Natation', type: 'nage', duree_min: duree, rpe_cible: 2, zones: [],
      titre: { fr: `Nage de récupération ${duree} min`, pl: `Pływanie regeneracyjne ${duree} min` },
      titre_court: { fr: `Nage récup ${duree}'`, pl: `Pływ. regen. ${duree}'` },
      meta: { fr: meta(duree, 2), pl: meta(duree, 2) },
      detail: { fr: `Nage souple, technique. Classeur : ${brut}`, pl: `Luźne pływanie, technika. Plan: ${brut}` },
    };
  }

  if (/^NAT/i.test(tete)) {
    const km = tete.match(/(\d+(?:\.\d+)?)\s*km/i);
    const m = km ? Math.round(Number(km[1]) * 1000) : totaux.nat_km ? Math.round(Number(totaux.nat_km) * 1000) : null;
    /* Deux minutes aux cent mètres, échauffement compris : une estimation, le
       classeur ne donne que la distance. */
    const duree = m ? Math.min(120, Math.round(m / 100 * 2)) : 45;
    if (!km) avertir(`${jour} : nage sans distance lisible (« ${tete} »)`);
    return {
      discipline: 'Natation', type: 'nage', duree_min: duree, rpe_cible: RPE.nage, zones: [], natation_m: m ?? undefined,
      titre: { fr: `Natation ${m ? `${m / 1000} km` : ''}`.trim(), pl: `Pływanie ${m ? `${m / 1000} km` : ''}`.trim() },
      titre_court: { fr: `Nage ${m ? `${m / 1000} km` : ''}`.trim(), pl: `Pływ. ${m ? `${m / 1000} km` : ''}`.trim() },
      meta: { fr: meta(duree, RPE.nage, m ? `${m} m` : ''), pl: meta(duree, RPE.nage, m ? `${m} m` : '') },
      detail: { fr: l.slice(1).join(' · ') || brut, pl: l.slice(1).join(' · ') || brut },
      estimation: 'durée de nage',
    };
  }

  if (/^VÉLO|^VELO/i.test(tete)) {
    const optionnel = /\bOU\b/.test(brut) || /REPOS/.test(brut);
    const duree = minutes(brut) ?? (optionnel ? 60 : (Number(totaux.velo_min) || 60));
    return {
      discipline: 'Vélo', type: 'velo', duree_min: duree, rpe_cible: optionnel ? 3 : RPE.velo, zones: [],
      titre: { fr: optionnel ? 'Vélo Z2, ou repos' : `Vélo ${duree} min · Z2`, pl: optionnel ? 'Rower Z2 albo odpoczynek' : `Rower ${duree} min · Z2` },
      titre_court: { fr: optionnel ? 'Vélo Z2 / repos' : `Vélo ${duree}'`, pl: optionnel ? 'Rower Z2 / odp.' : `Rower ${duree}'` },
      meta: { fr: meta(duree, optionnel ? 3 : RPE.velo, 'Z2'), pl: meta(duree, optionnel ? 3 : RPE.velo, 'Z2') },
      detail: {
        fr: optionnel ? 'Sortie facile en Z2 si les jambes le veulent ; sinon repos, sans regret.' : `Endurance en Z2, montagne. Classeur : ${brut}`,
        pl: optionnel ? 'Spokojna jazda w Z2, jeśli nogi chcą; inaczej odpoczynek.' : `Wytrzymałość w Z2, góry. Plan: ${brut}`,
      },
      estimation: optionnel ? 'durée du vélo facultatif' : undefined,
    };
  }

  if (/^LONG/i.test(tete)) {
    const duree = minutes(tete) ?? (Number(totaux.long_min) || 90);
    const progressif = /→/.test(brut);
    /* La distance n'est pas dans le classeur : 6:20/km en moyenne sur une
       sortie qui va de 6:45 à 6:00. Une estimation, dite comme telle. */
    const km = Math.round((duree / 6.33) * 2) / 2;
    return {
      discipline: 'Course à pied', type: 'longue', duree_min: duree, rpe_cible: RPE.longue,
      zones: progressif ? ['ef', 'endactive'] : ['ef'], distance_km: km,
      titre: { fr: `Sortie longue ${duree} min`, pl: `Długie wybieganie ${duree} min` },
      titre_court: { fr: `Longue ${duree}'`, pl: `Długie ${duree}'` },
      meta: { fr: meta(duree, RPE.longue, `≈ ${km} km`), pl: meta(duree, RPE.longue, `≈ ${km} km`) },
      detail: {
        fr: progressif ? `${duree} min en progressif : facile d'abord, endurance active sur la fin. Classeur : ${brut}` : `${duree} min en endurance fondamentale. Classeur : ${brut}`,
        pl: progressif ? `${duree} min progresywnie: najpierw spokojnie, aktywna wytrzymałość na końcu. Plan: ${brut}` : `${duree} min w spokojnej wytrzymałości. Plan: ${brut}`,
      },
      estimation: 'distance de la longue',
    };
  }

  if (/^FRAC/i.test(tete)) {
    const corps = l.slice(1).filter((x) => !/warm|cool/i.test(x)).join(' · ');
    const total = Number(totaux.frac_min) || 40;
    const rep = corps.match(/(\d+)\s*×\s*(\d+)m/);
    const pace = allure(corps);
    if (/facile/i.test(corps)) {
      const duree = minutes(corps) ?? total;
      return {
        discipline: 'Course à pied', type: 'ef', duree_min: duree + 20, rpe_cible: RPE.ef, zones: ['ef'],
        titre: { fr: `Footing facile ${duree} min`, pl: `Spokojny bieg ${duree} min` },
        titre_court: { fr: `Facile ${duree}'`, pl: `Spokojnie ${duree}'` },
        meta: { fr: meta(duree + 20, RPE.ef), pl: meta(duree + 20, RPE.ef) },
        detail: { fr: `Semaine allégée : ${duree} min faciles entre échauffement et retour au calme. Classeur : ${brut}`, pl: `Lżejszy tydzień: ${duree} min spokojnie. Plan: ${brut}` },
      };
    }
    if (/trail/i.test(corps)) {
      const duree = minutes(corps) ?? total;
      return {
        discipline: 'Course à pied', type: 'montagne', duree_min: duree + 20, rpe_cible: RPE.montagne, zones: ['ef'],
        titre: { fr: `Trail ${duree} min`, pl: `Trail ${duree} min` },
        titre_court: { fr: `Trail ${duree}'`, pl: `Trail ${duree}'` },
        meta: { fr: meta(duree + 20, RPE.montagne), pl: meta(duree + 20, RPE.montagne) },
        detail: { fr: `${duree} min de trail, à l'effort. Classeur : ${brut}`, pl: `${duree} min trailu, według wysiłku. Plan: ${brut}` },
      };
    }
    /* Le type suit la longueur des répétitions et l'allure : des répétitions
       courtes sont de la VMA ; longues et à l'allure marathon, de l'allure
       marathon ; longues et plus vite, du seuil. */
    const reps = rep ? Number(rep[1]) : null;
    const repMin = rep ? Number(rep[2]) : null;
    let type = 'vma';
    let zone = 'vma';
    if (repMin != null && repMin >= 5) {
      if (pace != null && pace >= 250) { type = 'allure10'; zone = 'marathon'; }
      else { type = 'seuil'; zone = 'seuil'; }
    }
    if (!rep) avertir(`${jour} : fractionné sans répétitions lisibles (« ${corps} »)`);
    const rpe = type === 'vma' ? RPE.vma : RPE.seuil;
    const titreFr = type === 'vma' ? 'Fractionné VMA' : type === 'seuil' ? 'Fractionné au seuil' : 'Blocs à l’allure marathon';
    return {
      discipline: 'Course à pied', type, duree_min: total, rpe_cible: rpe, zones: [zone],
      titre: { fr: `${titreFr}${rep ? ` · ${reps} × ${repMin}'` : ''}`, pl: `${PL[type]}${rep ? ` · ${reps} × ${repMin}'` : ''}` },
      titre_court: { fr: rep ? `${reps} × ${repMin}'` : 'Fractionné', pl: rep ? `${reps} × ${repMin}'` : 'Interwały' },
      meta: { fr: meta(total, rpe), pl: meta(total, rpe) },
      detail: { fr: `10 min d'échauffement, ${corps}, 10 min de retour au calme. Classeur : ${brut}`, pl: `10 min rozgrzewki, ${corps}, 10 min schłodzenia. Plan: ${brut}` },
      consigne: pace ? { fr: `Le classeur écrit @${mmss(pace)} ; l'allure affichée est celle du moteur pour ce bloc.`, pl: `Plan podaje @${mmss(pace)}; wyświetlane tempo liczy silnik dla tego bloku.` } : undefined,
      allure_classeur: pace, zone_classeur: zone, rep_min: repMin,
    };
  }

  avertir(`${jour} : cellule non reconnue (« ${tete} »)`);
  return {
    discipline: 'Course à pied', type: 'compromis', duree_min: minutes(brut) ?? 45, rpe_cible: RPE.compromis, zones: [],
    titre: { fr: tete, pl: tete }, titre_court: { fr: tete.slice(0, 40), pl: tete.slice(0, 40) },
    meta: { fr: 'à préciser', pl: 'do ustalenia' }, detail: { fr: brut, pl: brut },
  };
}

function seanceMuscu(cellule) {
  const l = lignes(cellule);
  const duree = minutes(l[0] ?? '') ?? 45;
  const exercices = l.slice(1).join(' · ');
  return {
    discipline: 'Musculation', type: 'force', duree_min: duree, rpe_cible: RPE.force, zones: [],
    titre: { fr: `Musculation ${duree} min`, pl: `Siłownia ${duree} min` },
    titre_court: { fr: `Muscu ${duree}'`, pl: `Siła ${duree}'` },
    meta: { fr: `${duree} min · RPE ${RPE.force}`, pl: `${duree} min · RPE ${RPE.force}` },
    detail: { fr: exercices || 'Circuit du classeur.', pl: exercices || 'Obwód z planu.' },
    consigne: { fr: 'Force de protection : tendons et gainage avant la charge', pl: 'Siła ochronna: ścięgna i core przed obciążeniem' },
  };
}

function seanceCourse(c) {
  const dureeParDistance = c.discipline === 'Vélo' ? Math.round(c.cible_haute_s / 60) : Math.round(c.cible_haute_s / 60);
  const zone = c.discipline !== 'Course à pied' ? [] : c.distance_km >= 40 ? ['marathon'] : c.distance_km >= 20 ? ['semi'] : ['allure10'];
  return {
    discipline: c.discipline, type: 'course', duree_min: Math.min(600, dureeParDistance), rpe_cible: RPE.course, zones: zone,
    distance_km: c.discipline === 'Course à pied' ? c.distance_km : undefined,
    titre: { fr: `🏆 ${c.nom}`, pl: `🏆 ${c.nom}` },
    titre_court: { fr: c.nom, pl: c.nom },
    meta: { fr: `${c.distance_km} km · ${c.cible}`, pl: `${c.distance_km} km · ${c.cible}` },
    detail: { fr: `${c.nom}, ${c.distance_km} km. Objectif : ${c.cible}.`, pl: `${c.nom}, ${c.distance_km} km. Cel: ${c.cible}.` },
    but: { fr: c.cible, pl: c.cible },
  };
}

/* ---------------------------------------------------- la grille → le plan */

function traduire(doc, refsSecondes) {
  const avertissements = [];
  const avertir = (m) => avertissements.push(m);
  const [refA, refC] = refsSecondes;

  /* Les blocs : une phase = un bloc, dans l'ordre. */
  const phases = [];
  for (const s of doc.semaines) {
    const p = phases.find((x) => x.nom === s.phase);
    if (p) p.a = s.semaine;
    else phases.push({ nom: s.phase, de: s.semaine, a: s.semaine, allures: [] });
  }
  const codes = 'ABCDEFGHIJKLMNOP';

  const sessions = [];
  const semaines = [];
  const parDate = new Map();

  for (const s of doc.semaines) {
    const phase = phases.find((x) => x.nom === s.phase);
    const bloc = codes[phases.indexOf(phase)];
    semaines.push({ semaine: s.semaine, bloc, phase: s.phase });

    for (const [i, jour] of JOURS.entries()) {
      const date = dateISO(doc.premier_lundi, s.semaine, i);
      const seance = lireCellule(s.jours[jour], `S${s.semaine} ${jour}`, s.totaux, avertir);
      if (seance?.allure_classeur) {
        phase.allures.push(seance.allure_classeur - ECART[seance.zone_classeur]);
      }
      const commun = { date, semaine: s.semaine, bloc, jour_long: JOUR[jour].long, jour: { fr: JOUR[jour].fr, pl: JOUR[jour].pl }, phase: s.phase };
      if (seance) {
        const { allure_classeur, zone_classeur, rep_min, estimation, ...propre } = seance;
        sessions.push({ ...commun, ...propre, _estimation: estimation });
      } else {
        sessions.push({
          ...commun, discipline: 'Repos', type: 'repos', duree_min: 0, rpe_cible: 0, zones: [],
          titre: { fr: 'Repos', pl: 'Odpoczynek' }, titre_court: { fr: 'Repos', pl: 'Odpoczynek' },
          meta: { fr: 'repos', pl: 'odpoczynek' }, detail: { fr: 'Repos complet.', pl: 'Pełny odpoczynek.' },
        });
      }
      if (s.muscu?.[jour]) {
        sessions.push({ ...commun, ...seanceMuscu(s.muscu[jour]) });
      }
      parDate.set(date, (parDate.get(date) ?? 0) + 1);
    }
  }

  /* Le `part` de chaque bloc. Le fichier peut le poser phase par phase
     (`parts`) — c'est l'intention de la phase, et c'est ce qu'on préfère.
     Sinon, la référence 10 km que ses fractionnés supposent, entre les deux
     références de l'athlète ; une phase sans fractionné lisible hérite de la
     précédente. La référence supposée s'affiche dans les deux cas, pour voir
     où le classeur et le moteur divergent. */
  let dernierPart = 0;
  const blocs = phases.map((p, i) => {
    let part = dernierPart;
    let ref10 = null;
    if (p.allures.length) {
      const tri = [...p.allures].sort((a, b) => a - b);
      ref10 = tri[Math.floor(tri.length / 2)];
      part = Math.max(0, Math.min(1, (refA - ref10) / (refA - refC)));
      part = Math.round(part * 1000) / 1000;
    }
    if (doc.parts && p.nom in doc.parts) part = Math.max(0, Math.min(1, Number(doc.parts[p.nom]) || 0));
    dernierPart = part;
    return {
      code: codes[i], part, de: p.de, a: p.a, ref10,
      nom: { fr: p.nom, pl: p.nom },
      quoi: { fr: `Semaines ${p.de}–${p.a} du classeur.`, pl: `Tygodnie ${p.de}–${p.a} z planu.` },
    };
  });

  /* Les courses, à leur vraie date : la séance de course remplace celle du
     jour (la récup du lundi, la longue du dimanche) et garde les autres. */
  const debut = sessions[0].date;
  const fin = sessions[sessions.length - 1].date;
  const objectifs = [];
  for (const c of doc.competitions ?? []) {
    if (c.date < debut || c.date > fin) {
      avertir(`compétition hors du plan : ${c.nom} (${c.date})`);
      continue;
    }
    const idx = sessions.findIndex((x) => x.date === c.date && x.discipline !== 'Musculation');
    const modele = sessions[idx] ?? sessions.find((x) => x.date === c.date);
    const seance = { ...modele, ...seanceCourse(c) };
    if (idx >= 0) sessions[idx] = seance;
    else sessions.push(seance);
    objectifs.push({
      date: c.date, nom: c.nom, discipline: c.discipline, distance_km: c.distance_km,
      principal: Boolean(c.principal), cible_s: c.cible_s, cible_haute_s: c.cible_haute_s,
      cible: { fr: c.cible, pl: c.cible },
    });
  }
  sessions.sort((a, b) => a.date.localeCompare(b.date) || (a.discipline === 'Musculation' ? 1 : 0) - (b.discipline === 'Musculation' ? 1 : 0));

  return { blocs, semaines, sessions, objectifs, avertissements };
}

/* ------------------------------------------------------------- rapport */

function rapport(doc, plan) {
  const { blocs, semaines, sessions, objectifs, avertissements } = plan;
  console.log(`\n${doc.athlete} — ${semaines.length} semaines, ${sessions.length} séances, ${blocs.length} blocs, ${objectifs.length} compétitions`);
  console.log(`du ${sessions[0].date} au ${sessions[sessions.length - 1].date}\n`);

  console.log('=== blocs ===');
  for (const b of blocs) {
    const heures = sessions.filter((s) => s.bloc === b.code).reduce((t, s) => t + s.duree_min, 0) / 60;
    console.log(`  ${b.code}  S${String(b.de).padStart(2)}–S${String(b.a).padEnd(2)}  part ${b.part.toFixed(3)}  réf10 ${b.ref10 ? mmss(b.ref10) : '  —  '}  ${heures.toFixed(1).padStart(5)} h  ${b.nom.fr}`);
  }

  console.log('\n=== séances par type ===');
  const parType = new Map();
  for (const s of sessions) {
    const t = parType.get(s.type) ?? { n: 0, min: 0 };
    t.n += 1; t.min += s.duree_min;
    parType.set(s.type, t);
  }
  for (const [type, t] of [...parType.entries()].sort((a, b) => b[1].min - a[1].min)) {
    console.log(`  ${type.padEnd(10)} ${String(t.n).padStart(4)}   ${(t.min / 60).toFixed(1).padStart(6)} h`);
  }

  console.log('\n=== compétitions ===');
  for (const o of objectifs) {
    const s = sessions.find((x) => x.date === o.date && x.type === 'course');
    console.log(`  ${o.date}  S${String(s?.semaine ?? '?').padEnd(2)} ${o.nom.padEnd(34)} ${o.discipline.padEnd(13)} ${String(o.distance_km).padStart(7)} km  ${o.cible.fr}${o.principal ? '  ★ principal' : ''}`);
  }

  const estimes = sessions.filter((s) => s._estimation);
  console.log(`\n=== estimations (le classeur ne donne pas le nombre) ===`);
  for (const e of new Set(estimes.map((s) => s._estimation))) {
    console.log(`  ${e} : ${estimes.filter((s) => s._estimation === e).length} séances`);
  }

  if (doc.a_preciser?.length) {
    console.log('\n=== à préciser (du fichier) ===');
    for (const a of doc.a_preciser) console.log(`  · ${a}`);
  }
  if (avertissements.length) {
    console.log(`\n=== avertissements (${avertissements.length}) ===`);
    for (const a of avertissements.slice(0, 40)) console.log(`  ⚠ ${a}`);
    if (avertissements.length > 40) console.log(`  … et ${avertissements.length - 40} de plus`);
  }

  console.log('\n=== une semaine, pour voir (S7) ===');
  for (const s of sessions.filter((x) => x.semaine === 7)) {
    console.log(`  ${s.date} ${s.jour_long.padEnd(9)} ${s.discipline.padEnd(13)} ${s.type.padEnd(9)} ${String(s.duree_min).padStart(4)}'  RPE ${s.rpe_cible}  ${s.zones.join('+').padEnd(12)} ${s.titre.fr}`);
  }
}

/* --------------------------------------------------------------- main */

try {
  const doc = JSON.parse(await readFile(fichier, 'utf8'));
  const athlete = await ligne('SELECT id, nom, prenom, ref_actuelle_s, ref_cible_s FROM msc_athlete WHERE id = :a', { a: athleteId });
  if (!athlete) throw new Error(`Aucun athlète ${athleteId}.`);

  /* Les références : --refs, sinon celles que le fichier pose, sinon celles
     de l'athlète en base. Le fichier ou --refs les écrivent sur l'athlète
     avec le plan : c'est la prémisse de ses allures. */
  const refsFichier = doc.references ? [doc.references.actuelle, doc.references.cible] : null;
  const refsSecondes = refs ? refs.map(secondes) : refsFichier ? refsFichier.map(secondes) : [athlete.ref_actuelle_s, athlete.ref_cible_s];
  const refsAEcrire = Boolean(refs || refsFichier);
  if (refsSecondes[0] <= refsSecondes[1]) throw new Error('La référence actuelle doit être plus lente que la cible.');
  console.log(`athlète #${athlete.id} ${[athlete.prenom, athlete.nom].filter(Boolean).join(' ')} — références 10 km ${mmss(refsSecondes[0])} → ${mmss(refsSecondes[1])} /km${refs ? ' (de --refs)' : refsFichier ? ' (du fichier)' : ' (de la base)'}`);
  if (doc.references?.pourquoi) console.log(`  ${doc.references.pourquoi}`);

  const plan = traduire(doc, refsSecondes);
  rapport(doc, plan);

  const nom = `${doc.athlete} — ${plan.semaines.length} semaines, ${plan.blocs.map((b) => b.nom.fr).join(' · ')}`.slice(0, 160);
  /* Rejouable sans doublon : le même plan déjà en base pour cet athlète n'est
     pas posé une seconde fois. --forcer pour le reposer quand même.

     « En base », et non « actif » : le jour où le coach lui en pose un autre,
     celui-ci cesse d'être actif — et la garde d'avant le réimportait alors à
     chaque déploiement, reprenant la main sur la décision du coach. Un plan de
     départ se pose une fois. */
  const dejaLa = await ligne(
    'SELECT id, debut FROM msc_plan WHERE athlete_id = :a AND nom = :n ORDER BY actif DESC, id DESC LIMIT 1',
    { a: athleteId, n: nom },
  );
  if (!ecrire) {
    console.log('\nÀ blanc. Relance avec --ecrire pour poser ce plan comme plan actif' + (refsAEcrire ? ' et ces références sur l’athlète.' : '.'));
    if (dejaLa) console.log(`(déjà en base : plan #${dejaLa.id}, actif — --forcer pour le reposer)`);
  } else if (dejaLa && !args.includes('--forcer')) {
    console.log(`\nDéjà en base : plan #${dejaLa.id} « ${nom} ». Rien à faire (--forcer pour le reposer).`);
  } else {
    if (refsAEcrire) {
      await bd().execute('UPDATE msc_athlete SET ref_actuelle_s = ?, ref_cible_s = ? WHERE id = ?', [refsSecondes[0], refsSecondes[1], athleteId]);
      console.log(`\nréférences de l'athlète : ${mmss(refsSecondes[0])} → ${mmss(refsSecondes[1])} /km`);
    }
    const sessions = plan.sessions.map(({ _estimation, ...s }) => s);
    const r = await enregistrerPlan(athleteId, { nom, origine: 'classeur', blocs: plan.blocs, semaines: plan.semaines, sessions, objectifs: plan.objectifs });
    console.log(`plan #${r.plan_id} actif : ${r.seances} séances, ${r.semaines} semaines, ${r.blocs} blocs, ${r.objectifs} objectifs, du ${r.debut} au ${r.fin}`);
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await fermer();
}
