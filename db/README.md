# La base

`schema.sql` est le schéma, en un fichier, commenté. Il s'applique sur MySQL 8
et il est validé aussi sur MariaDB 10.11 — d'où l'absence de
`utf8mb4_0900_ai_ci` et des quelques tournures propres à l'un ou à l'autre.

```sh
npm run db:migrate            # crée la base si besoin, applique le schéma
npm run db:migrate -- --reset # détruit et recrée. Demande le nom de la base.
npm run db:seed               # charge le classeur : 243 séances, 4 blocs, 8 zones
npm run check:db              # l'aller-retour et les garde-fous
npm run check:api             # l'API par HTTP, cookie et contrôle d'accès compris

npm run compte -- lister                    # les comptes et leurs athlètes
npm run compte -- creer <email> "<nom>"     # en créer un (mot de passe demandé)
npm run compte -- acces <email> <athlete>   # lui donner un athlète
```

Le seed crée un compte sans mot de passe utilisable (`⚠ sans mot de passe` dans
`compte -- lister`) : donne-lui en un avec `compte -- motdepasse` avant de te
connecter.

Les quatre variables minimales sont dans `.env.example`. Le schéma est
idempotent (`CREATE TABLE IF NOT EXISTS`), donc `db:migrate` se relance sans
rien casser — ce n'est pas encore un système de migrations versionnées, et
`scripts/db-migrate.mjs` dit à quel moment il devra le devenir.

## Ce que le schéma tient, et ce qu'il refuse de tenir

**Aucune allure, aucune charge, aucun total n'est stocké s'il se calcule.** Le
moteur dérive chaque allure de deux nombres portés par l'athlète, et
`check:engine` le vérifie contre le classeur cellule par cellule. Une allure en
base serait une seconde vérité, et c'est celle qui se trompe le jour où le test
de 30 minutes réécrit la référence.

Ce qui est stocké est donc ce qui est **mesuré** — l'allure moyenne d'une
activité, les blocs de travail, le poids, la FC — ou **décidé** : la zone et la
part que le coach propose, jamais les minutes et l'allure qu'elles donnent.

**Relationnel pour ce qui se filtre, JSON pour ce qui ne se relit qu'en bloc.**
« Quelles séances sont au seuil » et « quels jours avec douleur tendineuse »
sont des questions que le plan pose vraiment : ce sont des tables
(`msc_session_zone`, `msc_journal_douleur`), et `check:db` les pose en SQL. Les
charges d'affichage produites par Claude — les statistiques d'une analyse, ses
blocs d'observation — ne se relisent jamais qu'entières : c'est du JSON.

## Les cinq sections

| | |
|---|---|
| 0 · comptes | `compte`, `msc_athlete`, `msc_acces` — un athlète a son compte, un coach en voit plusieurs |
| 1 · vocabulaire | types, zones, statuts, RPE, excuses, règles, sources, libellés — partagé par tous |
| 2 · le plan | `msc_plan` et ce qui en dépend : blocs, semaines, séances, objectifs, compétitions |
| 3 · le vécu | Strava, activités, journal, photos, extractions, mesures |
| 4 · le coach | analyses, adaptations, ajustements, écarts, fils de discussion |
| 5 · la synchro | `msc_mutation`, et le `maj_le` que porte chaque table lue par un client |

## Le plan est une entité

Il ne l'était pas tant qu'il n'y avait qu'un athlète et qu'un classeur. Un
athlète peut en avoir plusieurs : celui du classeur, puis celui que le
générateur produit ; un seul est actif.

C'est aussi ce qui répond à la question que le README principal laissait
ouverte — que devient le journal attaché au plan qu'on remplace. **Rien ne se
perd.** Le journal et les activités appartiennent à l'athlète et *pointent* vers
des séances ; supprimer un plan emporte ses séances et détache ce qui les
visait, sans effacer une ligne de ce que l'athlète a réellement fait.
`check:db` le vérifie, dans une transaction qu'il annule.

## La photo, le poids et la FC

Trois tables plutôt qu'une, parce que ce sont trois faits différents : le
fichier reçu (`msc_photo`), ce qu'un modèle a cru y lire (`msc_extraction`), et
la mesure qui fait foi (`msc_mesure`).

Ce qu'un modèle lit sur une balance floue ne devient pas le poids de l'athlète
sans qu'il l'ait vu : `msc_mesure.etat` vaut `propose` jusqu'à confirmation. Une
extraction ratée est **rejetée, pas effacée** — on veut savoir sur quoi le
modèle se trompe.

## Les compétitions

Une compétition appartient à l'athlète, pas au plan : c'est une course, courue
ou à courir. Un *objectif* est ce qu'un plan en vise ; un *résultat* est ce
qu'elle a donné.

Cette séparation est ce qui rend les graphiques d'évolution possibles : les
résultats survivent aux plans qui les visaient, et une courbe de progression sur
trois ans traverse quatre plans sans s'en apercevoir.

## Les jetons Strava

Ils sont chiffrés par l'application (AES-256-GCM, `server/bd.mjs`), avec une
clé qui n'est pas dans la base. Tant qu'ils vivaient dans un fichier 0600, les
protéger était une affaire de permissions Unix ; une base est sauvegardée,
répliquée, restaurée sur un poste de développement et lue par plus de monde
qu'un fichier — un jeton en clair dedans est un jeton qui finit dans un dump.
