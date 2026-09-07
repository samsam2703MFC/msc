/* MySmartCoach — the MSC database (msc_ prefix).

   The plan itself lives in ./plan.generated (imported from the workbook) and
   its mechanic in ./reference + ./engine. What is left here is the reference
   vocabulary (types, statuses, UI copy) and a seeded example of what the
   Anthropic API writes back — analyses, adaptations, adjustments. Those seeded
   rows are anchored on session 1052, the plan's first quality session
   (semaine 7, "CAP · Seuil — 5 × 3'", 14/10/2026), and their figures follow the
   worked example in the workbook's "Suivi & ajustement" sheet.
   Ported verbatim from the Claude Design handoff. Every screen reads these
   tables; no data is hard-coded in the UI. Access them through ./db, which is
   the seam a real backend replaces. */

import type {
  Lang,
  MscActivity,
  MscAdaptation,
  MscAjustement,
  MscAnalyse,
  MscDaily,
  MscEcart,
  MscExcuse,
  MscJournal,
  MscMetric,
  MscSource,
  MscStatut,
  MscType,
  MscUiStrings,
} from './types';

export const msc_type: MscType[] = [
  { code: 'ef', icon: 'footprints', color: '#02A988', label: { fr: 'EF', pl: 'Wytrzymałość' }, gain: { fr: 'Mieux durer', pl: 'Wytrzymałość' },
    why: { fr: "Le socle : base aérobie et résistance des tendons. C'est ce tissu qui limite, pas le souffle.", pl: 'Fundament: baza tlenowa i odporność ścięgien. To ona ogranicza, nie oddech.' },
    sci: { fr: ['Le volume lent augmente densité mitochondriale et capillarisation.', 'Les tendons s’adaptent plus lentement que le cardio.'], pl: ['Wolna objętość zwiększa gęstość mitochondriów i kapilaryzację.', 'Ścięgna adaptują się wolniej niż układ krążenia.'] } },
  { code: 'recup', icon: 'leaf', color: '#5C6B7A', label: { fr: 'Récup', pl: 'Regeneracja' }, gain: { fr: 'Récupérer', pl: 'Regeneracja' },
    why: { fr: 'Du volume qui ne coûte rien. Elle existe pour rendre demain possible.', pl: 'Objętość, która nic nie kosztuje. Ma umożliwić jutrzejszy trening.' },
    sci: { fr: ['La circulation active évacue les métabolites sans nouveau stress.', 'Toute intensité ajoutée ici annule son intérêt.'], pl: ['Aktywne krążenie usuwa metabolity bez nowego bodźca.', 'Dodana intensywność niweczy jej sens.'] } },
  { code: 'endactive', icon: 'wind', color: '#0284B2', label: { fr: 'End. active', pl: 'Wytrz. aktywna' }, gain: { fr: 'Mieux durer', pl: 'Wytrzymałość' },
    why: { fr: 'La transition entre footing et seuil, sans le coût nerveux du seuil.', pl: 'Przejście między truchtem a progiem, bez nerwowego kosztu progu.' },
    sci: { fr: ['Plus de fibres recrutées, en restant sous le seuil lactique.'], pl: ['Więcej włókien angażowanych, wciąż pod progiem laktatowym.'] } },
  { code: 'seuil', icon: 'gauge', color: '#038870', label: { fr: 'Seuil', pl: 'Próg' }, gain: { fr: 'Aller plus vite', pl: 'Szybkość' },
    why: { fr: 'Repousser le point où le lactate s’accumule. La séance la plus rentable du plan.', pl: 'Przesunąć moment kumulacji laktatu. Najbardziej opłacalny trening planu.' },
    sci: { fr: ['La vitesse au seuil prédit mieux le 10 km et le semi que la VO2max.', 'Le muscle apprend à recycler le lactate comme carburant.'], pl: ['Prędkość progowa przewiduje 10 km i półmaraton lepiej niż VO2max.', 'Mięsień uczy się odzyskiwać laktat jako paliwo.'] } },
  { code: 'allure10', icon: 'timer', color: '#029CD0', label: { fr: 'Allure 10 km', pl: 'Tempo 10 km' }, gain: { fr: 'Aller plus vite', pl: 'Szybkość' },
    why: { fr: 'Accumuler du temps à l’allure cible pour qu’elle devienne une habitude.', pl: 'Kumulować czas w tempie docelowym, aż stanie się nawykiem.' },
    sci: { fr: ['La foulée s’économise en répétant exactement l’allure visée.', 'RPE 7–8 : au-dessus, tu cours la semaine 20 en semaine 15.'], pl: ['Krok ekonomizuje się przez powtarzanie dokładnie tego tempa.', 'RPE 7–8: wyżej biegniesz 20. tydzień w 15.'] } },
  { code: 'vma', icon: 'zap', color: '#056B90', label: { fr: 'VMA / 5 km', pl: 'VO2max / 5 km' }, gain: { fr: 'Aller plus vite', pl: 'Szybkość' },
    why: { fr: 'Travailler au-dessus de l’objectif pour que l’objectif devienne facile.', pl: 'Praca powyżej celu, żeby cel stał się łatwy.' },
    sci: { fr: ['Les fractions courtes sollicitent le débit cardiaque maximal.', 'L’économie de course progresse aussi par la raideur musculo-tendineuse.'], pl: ['Krótkie odcinki angażują maksymalną pojemność minutową serca.', 'Ekonomia biegu rośnie też przez sztywność mięśniowo-ścięgnistą.'] } },
  { code: 'longue', icon: 'route', color: '#02A988', label: { fr: 'Longue', pl: 'Długi bieg' }, gain: { fr: 'Mieux durer', pl: 'Wytrzymałość' },
    why: { fr: 'Durée sous tension, et les derniers kilomètres simulés sur jambes fatiguées.', pl: 'Czas pod obciążeniem i ostatnie kilometry na zmęczonych nogach.' },
    sci: { fr: ['L’oxydation des lipides et le glycogène augmentent avec la durée.', 'Les blocs en fin entraînent la résistance à la fatigue.'], pl: ['Utlenianie tłuszczów i glikogen rosną z czasem trwania.', 'Bloki na końcu trenują odporność na zmęczenie.'] } },
  { code: 'montagne', icon: 'mountain', color: '#BA7517', label: { fr: 'Montagne', pl: 'Góry' }, gain: { fr: 'Encaisser', pl: 'Odporność' },
    why: { fr: 'Force spécifique et temps debout. Pas une séance d’allure.', pl: 'Siła specyficzna i czas na nogach. To nie trening tempa.' },
    sci: { fr: ['La descente impose un travail excentrique protecteur à terme.', 'La marche en côte maintient l’effort sous le seuil.'], pl: ['Zbieg wymusza pracę ekscentryczną, która później chroni.', 'Marsz na podbiegu utrzymuje wysiłek pod progiem.'] } },
  { code: 'test', icon: 'timer-reset', color: '#E24B4A', label: { fr: 'Test', pl: 'Test' }, gain: { fr: 'Mesurer', pl: 'Pomiar' },
    why: { fr: 'Mesurer, pas performer. Il recale toutes les semaines suivantes.', pl: 'Mierzyć, nie startować. Kalibruje wszystkie kolejne tygodnie.' },
    sci: { fr: ['30 min en contre-la-montre approchent la vitesse au seuil.', 'C’est la régularité de l’allure qui rend le résultat exploitable.'], pl: ['30-minutowa próba przybliża prędkość progową.', 'Równe tempo czyni wynik użytecznym.'] } },
  { code: 'force', icon: 'dumbbell', color: '#C9A227', label: { fr: 'Force', pl: 'Siła' }, gain: { fr: 'Encaisser', pl: 'Odporność' },
    why: { fr: 'La protection tendineuse d’abord, la force Hyrox ensuite.', pl: 'Najpierw ochrona ścięgien, potem siła do Hyrox.' },
    sci: { fr: ['La musculation lourde améliore l’économie de course de 2 à 8 %.', 'Plus de raideur tendineuse : plus d’énergie élastique restituée.'], pl: ['Trening siłowy poprawia ekonomię biegu o 2–8 %.', 'Większa sztywność ścięgien: więcej energii elastycznej.'] } },
  { code: 'compromis', icon: 'repeat', color: '#D85A30', label: { fr: 'Compromis', pl: 'Kompromis' }, gain: { fr: 'Encaisser', pl: 'Odporność' },
    why: { fr: 'Courir sur jambes déjà chargées. Rien d’autre ne le travaille.', pl: 'Bieg na obciążonych nogach. Nic innego tego nie trenuje.' },
    sci: { fr: ['Le transfert force → course est là où la performance chute le plus.'], pl: ['Transfer siła → bieg to miejsce największego spadku wydajności.'] } },
  { code: 'nage', icon: 'waves', color: '#0284B2', label: { fr: 'Nage', pl: 'Pływanie' }, gain: { fr: 'Mieux durer', pl: 'Wytrzymałość' },
    why: { fr: 'Deux à quatre heures de charge aérobie sans une seule impaction.', pl: 'Dwie do czterech godzin obciążenia tlenowego bez uderzeń.' },
    sci: { fr: ['Charge cardiovasculaire réelle, contrainte mécanique quasi nulle.'], pl: ['Realne obciążenie krążenia, znikome obciążenie mechaniczne.'] } },
  { code: 'velo', icon: 'bike', color: '#2F5479', label: { fr: 'Vélo Z2', pl: 'Rower Z2' }, gain: { fr: 'Mieux durer', pl: 'Wytrzymałość' },
    why: { fr: 'La variable d’ajustement : il remplit les heures manquantes sans impact.', pl: 'Zmienna dostosowawcza: wypełnia brakujące godziny bez uderzeń.' },
    sci: { fr: ['La zone 2 stricte construit la base à coût de récupération minimal.', 'Cadence 85–95 : moins de tension musculaire, jambes préservées.'], pl: ['Ścisła strefa 2 buduje bazę przy minimalnym koszcie regeneracji.', 'Kadencja 85–95: mniejsze napięcie, nogi zachowane na bieg.'] } },
  { code: 'repos', icon: 'moon', color: '#7E9090', label: { fr: 'Repos', pl: 'Odpoczynek' }, gain: { fr: 'Progresser', pl: 'Postęp' },
    why: { fr: 'L’entraînement crée le stimulus ; le repos crée la forme.', pl: 'Trening tworzy bodziec; odpoczynek tworzy formę.' },
    sci: { fr: ['La surcompensation a lieu pendant la récupération, pas à l’effort.', 'Une séance ajoutée ici fatigue, elle ne renforce pas.'], pl: ['Superkompensacja zachodzi w regeneracji, nie w wysiłku.', 'Trening dodany tutaj zmęczy, nie wzmocni.'] } },
  { code: 'course', icon: 'flag', color: '#E24B4A', label: { fr: 'Course', pl: 'Zawody' }, gain: { fr: 'Mesurer', pl: 'Pomiar' },
    why: { fr: 'Le jour où le plan est jugé. Quatre dans la saison, une seule qui compte.', pl: 'Dzień, w którym plan jest oceniany. Cztery w sezonie, tylko jedne się liczą.' },
    sci: { fr: ['Une course de préparation cale l’allure mieux que n’importe quelle séance.', 'L’affûtage rend 2 à 3 % de performance : il se prépare, il ne s’improvise pas.'], pl: ['Zawody przygotowawcze kalibrują tempo lepiej niż jakikolwiek trening.', 'Tapering daje 2–3 % wydajności: przygotowuje się go, nie improwizuje.'] } },
  { code: 'biere', icon: 'beer', color: '#C9A227', label: { fr: 'Bière', pl: 'Piwo' }, gain: { fr: 'Tenir 30 semaines', pl: 'Wytrwać 30 tygodni' },
    why: { fr: 'Un plan qu’on ne peut jamais quitter, on le quitte pour de bon. Une bière prévue vaut mieux qu’un abandon.', pl: 'Plan, z którego nigdy nie można wyjść, porzuca się na dobre. Zaplanowane piwo jest lepsze niż rezygnacja.' },
    sci: { fr: ['L’adhésion à long terme prédit mieux le résultat que la perfection d’une semaine.', 'À placer après la séance, jamais la veille d’une qualité : l’alcool coupe le sommeil profond.'], pl: ['Długoterminowa konsekwencja przewiduje wynik lepiej niż idealny tydzień.', 'Po treningu, nigdy przed dniem jakościowym: alkohol tnie głęboki sen.'] } },
  { code: 'chocolat', icon: 'cookie', color: '#8D1D2C', label: { fr: 'Chocolat', pl: 'Czekolada' }, gain: { fr: 'Se faire plaisir', pl: 'Przyjemność' },
    why: { fr: 'Parce que c’est bon. Et parce qu’un plaisir programmé enlève trois écarts non programmés.', pl: 'Bo jest dobra. I bo zaplanowana przyjemność usuwa trzy niezaplanowane odstępstwa.' },
    sci: { fr: ['Le noir à 70 % apporte des flavanols associés à une meilleure fonction vasculaire.', 'Les glucides post-séance accélèrent la resynthèse du glycogène.'], pl: ['Gorzka 70 % dostarcza flawanoli powiązanych z lepszą funkcją naczyń.', 'Węglowodany po treningu przyspieszają resyntezę glikogenu.'] } },
  { code: 'gavage', icon: 'ham', color: '#D85A30', label: { fr: 'Repas de gaveur', pl: 'Żarcie jak świnia' }, gain: { fr: 'Recharger', pl: 'Doładowanie' },
    why: { fr: 'Après une longue, le corps réclame. Un gros repas assumé vaut mieux que trois jours de grignotage.', pl: 'Po długim biegu ciało się domaga. Świadomie duży posiłek jest lepszy niż trzy dni podjadania.' },
    sci: { fr: ['Une recharge glucidique restaure le glycogène plus vite qu’un déficit prolongé.', 'Le déficit chronique fait chuter la performance et la densité osseuse avant le poids.'], pl: ['Doładowanie węglowodanowe odbudowuje glikogen szybciej niż przedłużony deficyt.', 'Chroniczny deficyt obniża wydolność i gęstość kości szybciej niż wagę.'] } },
];




/* Ce que Strava renvoie — agrégats uniquement, jamais les streams bruts. */
export const msc_activity: MscActivity[] = [
  { id_strava: 148120, session_id: 1050, date: '2026-10-13', sport: 'swim', duree_min: 70, statut: 'fait' },
  { id_strava: 148377, session_id: 1052, date: '2026-10-14', sport: 'run', duree_min: 68, allure_moy: '4:56/km', fc_moy: 168,
    /* Five threshold blocks against a 4:55 target — the drift the analysis reads. */
    splits_blocs: [292, 293, 295, 299, 304], statut: 'fait' },
];

export const msc_journal: MscJournal[] = [
  { date: '2026-10-14', session_id: 1052, rpe_ressenti: 8, sommeil: 7.2, douleurs: [] },
];

export const msc_daily: MscDaily[] = [
  { date: '2026-10-08', fc_repos: 47 }, { date: '2026-10-09', fc_repos: 46 },
  { date: '2026-10-10', fc_repos: 46 }, { date: '2026-10-11', fc_repos: 45 },
  { date: '2026-10-12', fc_repos: 45 }, { date: '2026-10-13', fc_repos: 44 },
  { date: '2026-10-14', fc_repos: 44 },
];

export const msc_metric: MscMetric[] = [
  { code: 'acwr', icon: 'scale', valeur: '1,18', couleur: '#038870', seuil: 1.5, serie: [0.82, 0.9, 0.95, 1.02, 1.1, 1.05, 1.18],
    nom: { fr: 'Charge aiguë / chronique', pl: 'Obciążenie ostre / chroniczne' },
    formule: { fr: 'charge 7 j ÷ moyenne 28 j · seuil 1,5', pl: '7 dni ÷ średnia 28 dni · próg 1,5' } },
  { code: 'fc_repos', icon: 'heart-pulse', valeur: '54 bpm', couleur: '#038870', serie: [57, 56, 56, 55, 55, 54, 54],
    nom: { fr: 'FC au repos', pl: 'Tętno spoczynkowe' },
    formule: { fr: 'moyenne glissante 7 jours', pl: 'średnia krocząca 7 dni' } },
  { code: 'derive', icon: 'trending-down', valeur: '6,4 %', couleur: '#BA7517', seuil: 8, serie: [14, 11, 9.5, 8.2, 7.1, 6.4],
    nom: { fr: 'Dérive cardiaque', pl: 'Dryf tętna' },
    formule: { fr: 'sorties longues · seuil 8 %', pl: 'długie wybiegania · próg 8 %' } },
  { code: 'allure_fc', icon: 'trending-up', valeur: '−6 s/km', couleur: '#038870', serie: [0.4, 0.55, 0.62, 0.7, 0.78, 0.88, 1],
    nom: { fr: 'Allure à FC constante', pl: 'Tempo przy stałym tętnie' },
    formule: { fr: 'la vraie progression, sur les EF', pl: 'prawdziwy postęp, na wytrzymałości' } },
];


/* Sorties de l'API Anthropic, horodatées et conservées. */
export const msc_analyse: MscAnalyse[] = [
  { id: 9001, date: '2026-10-14', type: 'seance', session_id: 1052, modele: 'haiku-4-5', cout_eur: 0.008,
    verdict: { fr: 'Parti 5 s/km trop vite : le 4ᵉ bloc lâche de 7 s/km. Le travail au seuil a eu lieu.', pl: 'Start o 5 s/km za szybko: czwarty blok traci 7 s/km. Praca progowa się odbyła.' },
    stats: [
      { valeur: '+7 s/km', icon: 'trending-down', couleur: '#BA7517', label: { fr: 'dérive B1 → B4', pl: 'spadek B1 → B4' } },
      { valeur: '5:07/km', icon: 'gauge', couleur: '#0A1C33', label: { fr: 'moyenne · cible 5:12', pl: 'średnia · cel 5:12' } },
      { valeur: '8', icon: 'activity', couleur: '#BA7517', label: { fr: 'RPE · cible 7', pl: 'RPE · cel 7' } },
    ] },
  { id: 9002, date: '2026-10-18', type: 'hebdo', semaine: 7, modele: 'sonnet-5', cout_eur: 0.07,
    verdict: { fr: 'Charge sous contrôle (ACWR 1,18), allure à FC constante en progrès de 6 s/km.', pl: 'Obciążenie pod kontrolą (ACWR 1,18), tempo przy stałym tętnie lepsze o 6 s/km.' },
    blocs: [
      { icon: 'circle-check', couleur: '#038870', items: { fr: ['Dérive cardiaque : +14 % → +6,4 %.', 'FC repos stable à 54 bpm.'], pl: ['Dryf tętna: +14 % → +6,4 %.', 'Tętno spoczynkowe stabilne, 54 bpm.'] } },
      { icon: 'triangle-alert', couleur: '#BA7517', items: { fr: ['Footings 25 s/km trop vite.', 'La nage du vendredi saute chaque semaine.'], pl: ['Wybiegania o 25 s/km za szybko.', 'Piątkowe pływanie wypada co tydzień.'] } },
    ] },
];

/* Adaptation issue de l'analyse de séance : proposition, jamais écriture directe. */
export const msc_adaptation: MscAdaptation[] = [
  { id: 7001, analyse_id: 9001, session_id: 1055, type: 'recup', session_avant: { fr: 'Footing de récupération · 58 min', pl: 'Trucht regeneracyjny · 58 min' },
    session_apres: '45 min · 6:20/km',
    pourquoi: { fr: 'Le seuil a coûté plus que prévu. On protège la sortie longue de samedi.', pl: 'Próg kosztował więcej niż zakładano. Chronimy sobotni długi bieg.' } },
];

export const msc_ajustement: MscAjustement[] = [
  { id: 7101, analyse_id: 9002, session_id: 1056, type: 'longue', quand: { fr: 'Samedi · S7', pl: 'Sobota · T7' }, quoi: { fr: 'Sortie longue 1h37 → 1h20', pl: 'Długi bieg 1h37 → 1h20' } },
  { id: 7102, analyse_id: 9002, session_id: 1054, type: 'nage', quand: { fr: 'Vendredi · S7', pl: 'Piątek · T7' }, quoi: { fr: 'Nage 2 000 → 2 600 m', pl: 'Pływanie 2 000 → 2 600 m' } },
  { id: 7103, analyse_id: 9002, semaine: 10, type: 'test', quand: { fr: 'Semaine 10', pl: 'Tydzień 10' }, quoi: { fr: 'Test de 30 min décalé d’une semaine', pl: 'Test 30 min przesunięty o tydzień' } },
];

export const msc_ecart: MscEcart[] = [
  { semaine: 7, retard: '−3h20', sautees: 2, realisation: '82 %',
    texte: { fr: 'Deux séances sautées, 3h20 de retard. Le coach réétalonne au lieu de faire rattraper.', pl: 'Dwa opuszczone treningi, 3h20 zaległości. Trener przelicza, zamiast kazać nadrabiać.' },
    stats: [
      { valeur: '−3h20', icon: 'clock', label: { fr: 'volume en retard', pl: 'zaległej objętości' } },
      { valeur: '2', icon: 'calendar-x', label: { fr: 'séances sautées', pl: 'opuszczone treningi' } },
      { valeur: '82 %', icon: 'percent', label: { fr: 'réalisation', pl: 'realizacja' } },
    ],
    recalcul: [
      { portee: 'S7–S8', texte: { fr: 'Volume ramené à 7h, nage avant la force.', pl: 'Objętość do 7h, pływanie przed siłą.' } },
      { portee: 'S9', texte: { fr: 'Test de 30 min déplacé en semaine 6.', pl: 'Test 30 min przeniesiony na tydzień 6.' } },
      { portee: 'S10–S23', texte: { fr: 'Progression lissée à +6 % / semaine. Semi du 22/11 conservé.', pl: 'Progresja wygładzona do +6 % / tydzień. Półmaraton 22/11 zachowany.' } },
    ] },
];

export const msc_statut: MscStatut[] = [
  { code: 'repos', icon: 'moon', couleur: '#7E9090' },
  { code: 'fait', icon: 'circle-check', couleur: '#038870' },
  { code: 'aujourdhui', icon: 'play', couleur: '#029CD0' },
  { code: 'adapte', icon: 'wand-sparkles', couleur: '#BA7517' },
  { code: 'prevu', icon: 'circle-dashed', couleur: '#7E9090' },
];


export const msc_source: MscSource[] = [
  { code: 'strava', etat: 'off', canal: 'OAuth',
    titre_absent: { fr: 'Take my data', pl: 'Take my data' },
    sous_absent: { fr: 'Strava non configuré sur le serveur', pl: 'Strava nieskonfigurowana na serwerze' },
    titre_off: { fr: 'Take my data', pl: 'Take my data' },
    sous_off: { fr: 'Connecter Strava · OAuth', pl: 'Połącz Strava · OAuth' },
    titre_liaison: { fr: 'Autorisation Strava…', pl: 'Autoryzacja Strava…' },
    sous_liaison: { fr: 'Termine la connexion dans la fenêtre Strava', pl: 'Dokończ połączenie w oknie Strava' },
    titre_on: { fr: 'Strava connecté', pl: 'Strava połączona' },
    sous_on: { fr: 'Dernière synchro', pl: 'Ostatnia synchronizacja' },
    sous_synchro: { fr: 'Synchronisation…', pl: 'Synchronizacja…' },
    jamais: { fr: 'jamais synchronisé', pl: 'nigdy nie synchronizowano' },
    webhook_on: { fr: 'webhook actif', pl: 'webhook aktywny' },
    webhook_off: { fr: 'synchro manuelle', pl: 'synchronizacja ręczna' },
    orphelines: { fr: 'activités hors plan', pl: 'aktywności poza planem' },
    delier: { fr: 'Délier', pl: 'Odłącz' } },
];

export const msc_ui: Record<Lang, MscUiStrings> = {
  fr: {
    screens: { today: "Aujourd'hui", week: 'La semaine', form: 'État de forme', coach: 'Coach', admin: 'Créer' },
    tabs: { today: "Aujourd'hui", week: 'Semaine', form: 'Forme', coach: 'Coach', admin: 'Créer' },
    doneOn: 'Séance faite', doneOff: 'Marquer la séance faite',
    rpeLabel: 'RPE ressenti', notePlaceholder: 'Sommeil, douleurs, sensations',
    anaLabel: 'Analyse de la séance', anaIdle: 'Analyser avec Claude', anaRunning: 'Claude analyse…', anaDoneBtn: 'Relancer l’analyse',
    nextLabel: 'La séance suivante s’adapte', applyOn: 'Appliqué', applyOff: 'Appliquer',
    legendLabel: 'Types d’entraînement', gapLabel: 'Écart détecté',
    recalcIdle: 'Recalculer le plan', recalcRunning: 'Claude recalcule le plan…', recalcDoneBtn: 'Plan recalculé',
    verdictLabel: 'Verdict', askPlaceholder: 'Une question au coach',
    chatThinking: 'Le coach lit tes données…', chatEmpty: 'Le coach répond depuis ton plan et tes activités.',
    excuseLabel: 'Aujourd’hui, ça ne va pas se passer comme prévu',
    excuseAnswer: 'Réponse du coach', excuseNew: 'Nouvelle séance',
    modalKind: "Type d'entraînement", modalSci: 'Ce que dit la science', modalClose: 'Fermer',
  },
  pl: {
    screens: { today: 'Dzisiaj', week: 'Tydzień', form: 'Forma', coach: 'Trener', admin: 'Utwórz' },
    tabs: { today: 'Dzisiaj', week: 'Tydzień', form: 'Forma', coach: 'Trener', admin: 'Utwórz' },
    doneOn: 'Wykonane', doneOff: 'Oznacz jako wykonane',
    rpeLabel: 'Odczuwany RPE', notePlaceholder: 'Sen, bóle, odczucia',
    anaLabel: 'Analiza treningu', anaIdle: 'Przeanalizuj z Claude', anaRunning: 'Claude analizuje…', anaDoneBtn: 'Ponów analizę',
    nextLabel: 'Kolejny trening się dostosowuje', applyOn: 'Zastosowane', applyOff: 'Zastosuj',
    legendLabel: 'Typy treningów', gapLabel: 'Wykryto odchylenie',
    recalcIdle: 'Przelicz plan', recalcRunning: 'Claude przelicza plan…', recalcDoneBtn: 'Plan przeliczony',
    verdictLabel: 'Ocena', askPlaceholder: 'Pytanie do trenera',
    chatThinking: 'Trener czyta twoje dane…', chatEmpty: 'Trener odpowiada na podstawie planu i twoich aktywności.',
    excuseLabel: 'Dziś nie pójdzie zgodnie z planem',
    excuseAnswer: 'Odpowiedź trenera', excuseNew: 'Nowy trening',
    modalKind: 'Typ treningu', modalSci: 'Co mówi nauka', modalClose: 'Zamknij',
  },
};

/* La vraie vie d'un sportif : motifs déclarés par l'athlète, réponse du coach. */
export const msc_excuse: MscExcuse[] = [
  { code: 'pas_envie', icon: 'battery-low', type: 'recup', session_id: 1052,
    label: { fr: 'Pas envie de m’entraîner', pl: 'Nie mam ochoty trenować' },
    reponse: { fr: 'On garde le geste, on enlève l’intensité. Vingt minutes valent mieux que zéro.', pl: 'Zostawiamy ruch, zdejmujemy intensywność. Dwadzieścia minut jest lepsze niż zero.' },
    remplacement: { fr: 'Récup 20 min · 6:20/km, sans montre', pl: 'Regeneracja 20 min · 6:20/km, bez zegarka' } },
  { code: 'pas_le_temps', icon: 'clock-alert', type: 'seuil', session_id: 1052,
    label: { fr: 'Pas le temps aujourd’hui', pl: 'Nie mam dziś czasu' },
    reponse: { fr: 'On garde le stimulus utile et on coupe le reste. Le seuil tient en 30 minutes.', pl: 'Zostawiamy użyteczny bodziec, resztę ucinamy. Próg mieści się w 30 minutach.' },
    remplacement: { fr: '3 × 3’ au seuil · 30 min total', pl: '3 × 3’ na progu · 30 min łącznie' } },
  { code: 'soiree', icon: 'wine', type: 'velo', session_id: 1055,
    label: { fr: 'Je bois ce soir', pl: 'Piję dziś wieczorem' },
    reponse: { fr: 'L’alcool coupe la récupération et le sommeil. On avance la qualité et on allège demain.', pl: 'Alkohol tnie regenerację i sen. Przesuwamy jakość i odciążamy jutro.' },
    remplacement: { fr: 'Demain : vélo Z2 45 min au lieu de la récup', pl: 'Jutro: rower Z2 45 min zamiast regeneracji' } },
  { code: 'fatigue', icon: 'bed', type: 'repos', session_id: 1052,
    label: { fr: 'Mal dormi, jambes lourdes', pl: 'Źle spałem, ciężkie nogi' },
    reponse: { fr: 'FC de repos à +4 bpm : le corps a déjà répondu. Repos complet, on décale la qualité.', pl: 'Tętno spoczynkowe +4 bpm: ciało już odpowiedziało. Pełny odpoczynek, jakość przesunięta.' },
    remplacement: { fr: 'Repos · seuil déplacé à jeudi', pl: 'Odpoczynek · próg przeniesiony na czwartek' } },
  { code: 'voyage', icon: 'plane', type: 'force', session_id: 1049,
    label: { fr: 'En déplacement, pas de salle', pl: 'W podróży, bez siłowni' },
    reponse: { fr: 'La force sans charge existe : la protection tendineuse ne demande pas de barre.', pl: 'Siła bez obciążenia istnieje: ochrona ścięgien nie wymaga sztangi.' },
    remplacement: { fr: 'Circuit poids du corps 25 min · mollets, fentes, gainage', pl: 'Obwód z ciężarem ciała 25 min · łydki, zakroki, core' } },
];
