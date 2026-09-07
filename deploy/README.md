# Mettre MySmartCoach en ligne

Ce carnet se déroule **depuis ta machine**, avec tes clés. Rien ici ne demande de
coller un identifiant dans une conversation.

## Ce qu'on déploie

Un processus Node et une base MySQL. C'est tout.

```
node server/index.mjs      sert la PWA construite (dist/) ET l'API, même origine
MySQL 8                    la base, migrée et semée une fois
```

Le serveur sert lui-même `dist/` : un processus au lieu de deux, et surtout la
**même origine** — plus de CORS, un cookie de session qui voyage normalement, et
un service worker qui contrôle vraiment la page. Un nginx devant reste une bonne
idée pour TLS et la compression, mais il n'est pas nécessaire au fonctionnement.

Prérequis sur le serveur : Node 22 ou plus (`--env-file-if-exists` en dépend),
MySQL 8 (ou MariaDB 10.11), et de quoi faire du TLS.

## Les variables

Dans un `.env` sur le serveur, **hors du dépôt**, en `chmod 600`. Le modèle
complet est `.env.example` ; voici ce qui change en production.

| | |
|---|---|
| `NODE_ENV=production` | **obligatoire.** Il condamne `MSC_ATHLETE_ID` et met `Secure` sur le cookie de session. `check:api` vérifie les deux. |
| `MSC_SECRET_KEY` | 32 octets. Chiffre les jetons Strava **et** signe les sessions. La perdre : tous les comptes Strava à relier, toutes les sessions invalidées. Elle ne va ni dans le dépôt ni dans la base. |
| `MSC_DB_*` | un utilisateur MySQL dédié à `msc`, avec les droits sur cette base seule — pas `root`. |
| `ANTHROPIC_API_KEY` | sans elle, les routes du coach répondent 401 et le reste marche. |
| `STRAVA_*` | `STRAVA_REDIRECT_URI` doit être ton vrai domaine en HTTPS, et le domaine doit être enregistré comme *Authorization Callback Domain* sur l'application Strava. |
| `MSC_ATHLETE_ID` | **ne pas définir.** C'est la porte de service du développement. |

```sh
# la clé, une fois
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## L'ordre

```sh
# 1 · la base, une seule fois
mysql -u root -p -e "CREATE DATABASE msc CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  CREATE USER 'msc'@'localhost' IDENTIFIED BY '<un mot de passe long>';
  GRANT ALL PRIVILEGES ON msc.* TO 'msc'@'localhost'; FLUSH PRIVILEGES;"

# 2 · le code, les dépendances, le build
git clone <le dépôt> /srv/msc && cd /srv/msc
npm ci
npm run build

# 3 · le schéma, puis le classeur
npm run db:migrate
npm run db:seed

# 4 · un mot de passe pour le compte que le seed a créé
npm run compte -- lister
npm run compte -- motdepasse sam@mysmartcoach.local

# 5 · démarrer
NODE_ENV=production npm run server
```

Le seed crée un compte **sans mot de passe utilisable** — c'est délibéré, un
mot de passe par défaut est un mot de passe public. `compte -- lister` le
signale par `⚠ sans mot de passe`.

## Vérifier

```sh
curl -s https://<domaine>/api/sante
# {"ok":true,"cle":true,"strava":true,"scellement":true}
```

Les quatre drapeaux disent ce qui manque : `cle` la clé Anthropic, `strava` les
identifiants Strava, `scellement` la `MSC_SECRET_KEY`. `ok` seul ne veut pas
dire que tout est configuré.

Puis, contre la base de production **avant de l'ouvrir** :

```sh
npm run check:db     # l'aller-retour et les garde-fous
npm run check:api    # l'API par HTTP, le contrôle d'accès, la posture prod
```

`check:api` crée et détruit ses propres comptes de contrôle ; il ne touche pas
aux tiens. Il lance aussi un second serveur en `NODE_ENV=production` pour
vérifier que la porte de service est bien condamnée.

## Mettre à jour

```sh
git pull && npm ci && npm run build && npm run db:migrate && <relancer le service>
```

`db:migrate` est idempotent (`CREATE TABLE IF NOT EXISTS`) : il ne casse rien à
être rejoué. Ce n'est pas encore un système de migrations versionnées — le jour
où le schéma change **après** la mise en production, il faudra
`db/migrations/NNNN-*.sql` et un journal de ce qui a été appliqué. Le dire
plutôt que de le découvrir en perdant des données.

## Le webhook Strava

Il ne peut pas être créé depuis une machine de développement : Strava valide
l'URL de rappel de façon synchrone, depuis internet. C'est donc une étape
d'après-déploiement.

```sh
npm run strava:webhook -- abonner https://<domaine>/api/strava/webhook
npm run strava:webhook -- etat
```

Sans abonnement tout fonctionne, la carte affiche simplement *synchro manuelle*.

## Les fichiers à sauvegarder

- **La base**, évidemment : `mysqldump --single-transaction msc`.
- **`MSC_SECRET_KEY`**, séparément de la base. Une sauvegarde qui contient les
  deux offre les jetons Strava en clair à qui la lit ; une base sans la clé ne
  vaut rien de ce côté-là, et c'est le but.
- **`MSC_PHOTOS_DIR`** quand le pipeline photo existera. La base n'y garde que
  des chemins.

## Deux appendices, si tu es sur un VPS

### systemd — `/etc/systemd/system/msc.service`

```ini
[Unit]
Description=MySmartCoach
After=network.target mysql.service

[Service]
Type=simple
User=msc
WorkingDirectory=/srv/msc
EnvironmentFile=/srv/msc/.env
Environment=NODE_ENV=production
ExecStart=/usr/bin/node server/index.mjs
Restart=on-failure
RestartSec=5
# Le processus n'a besoin d'écrire que dans MSC_PHOTOS_DIR.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/srv/msc/var

[Install]
WantedBy=multi-user.target
```

### nginx — TLS, compression, et rien d'autre

```nginx
server {
  listen 443 ssl http2;
  server_name <domaine>;

  # certificats : certbot, ou ce que fournit l'hébergeur

  # Une photo de balance envoyée par le téléphone dépasse le défaut d'nginx.
  client_max_body_size 12m;

  gzip on;
  gzip_types text/css application/javascript application/json application/manifest+json;

  location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

Le serveur pose déjà les bons en-têtes de cache — un an sur les fichiers hachés
de `assets/`, `no-cache` sur `index.html` et le service worker. Ne les
réécris pas dans nginx : mettre `index.html` ou `sw.js` en cache, c'est livrer
une version que le navigateur refusera de remplacer.
