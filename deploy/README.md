# Mettre MySmartCoach en ligne

**C'est le dépôt qui a l'accès, pas moi.** Les identifiants du serveur vivent
dans les secrets GitHub, `.github/workflows/deploiement.yml` s'en sert, et ils
ne passent ni par le code, ni par une conversation, ni par ta presse-papier.

La préparation du serveur (§ *Le serveur, une fois*) se fait à la main, une
seule fois. Tout le reste part ensuite d'un bouton dans l'onglet Actions.

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

## Le serveur, une fois

Un script, pas un bloc à coller. En root, sur le serveur :

```sh
git clone --depth 1 -b main https://github.com/samsam2703MFC/msc /tmp/msc
bash /tmp/msc/deploy/preparer.sh
```

Le `-b main` n'est pas décoratif : `git clone` prend la branche **par défaut** du
dépôt, qui n'est pas forcément celle qu'on déploie. Tant que le défaut n'est pas
`main` (Settings → Branches), un clone sans `-b` rend une version antérieure —
sans message d'erreur, et le script manque simplement à l'appel.

Il est idempotent : relancé, il ne régénère ni la clé de déploiement, ni le
`.env`, ni le mot de passe de la base — ce qui existe est laissé et signalé. Il
finit en disant les trois choses qui restent à la main, dont la seule à copier :
`base64 -w0 /srv/msc/.ssh/msc_deploy`, en une ligne, dans `DEPLOY_SSH_KEY`.

**Pourquoi un fichier.** Quarante lignes collées dans un terminal se font manger
dès que la session bronche, et si l'invite n'est pas un shell mais `login`,
elles partent en tentatives de connexion — mot de passe compris, échoué en clair
à l'écran. C'est arrivé. Un fichier ne se trompe pas d'interlocuteur.

Le détail de ce qu'il fait, si tu préfères à la main :

```sh
# 1 · un utilisateur qui n'est pas root, et l'arborescence
sudo adduser --system --group --home /srv/msc msc
sudo -u msc mkdir -p /srv/msc/{releases,var}

# 2 · la base, et un utilisateur MySQL qui n'a de droits que sur elle
sudo mysql -e "CREATE DATABASE msc CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  CREATE USER 'msc'@'localhost' IDENTIFIED BY '<un mot de passe long>';
  GRANT ALL PRIVILEGES ON msc.* TO 'msc'@'localhost'; FLUSH PRIVILEGES;"

# 3 · les secrets, hors des versions
sudo -u msc install -m 600 /dev/null /srv/msc/.env
sudo -u msc editor /srv/msc/.env        # voir « Les variables » ci-dessus

# 4 · le service (l'unité est plus bas), et le droit de le redémarrer
sudo systemctl enable msc
echo 'msc ALL=(root) NOPASSWD: /bin/systemctl restart msc' \
  | sudo tee /etc/sudoers.d/msc-restart
```

Le déploiement peut partir dès ici : il crée la version, migre, bascule et
redémarre. Restent deux gestes qui ne se font qu'une fois, sur la base neuve :

```sh
cd /srv/msc/current
npm run db:seed                      # le classeur — JAMAIS sur une base vivante
npm run compte -- motdepasse sam@mysmartcoach.local
```

`db:seed` vide les tables du plan avant de les remplir. Sur une base qui sert,
c'est le plan de l'athlète et les analyses qui y sont attachées qui
disparaissent — c'est pourquoi le script de déploiement ne l'appelle jamais.

Le seed crée un compte **sans mot de passe utilisable** : un mot de passe par
défaut est un mot de passe public. `compte -- lister` le signale par
`⚠ sans mot de passe`.

## Ce que le dépôt doit savoir

`Settings → Secrets and variables → Actions`. Les deux colonnes ne servent pas
à la même chose : ce qui est dans *Variables* est lisible par qui voit le
dépôt, ce qui est dans *Secrets* ne se relit plus une fois posé.

Les cinq `DEPLOY_*` ci-dessous sont des **Variables** — un nom d'hôte n'est pas
un secret, et pouvoir le relire quand un déploiement se comporte bizarrement
vaut mieux que de le masquer. Mais le workflow accepte un secret du même nom :
se tromper d'onglet est l'erreur qu'on fait une fois, et refuser de partir pour
ça ne protège personne. Les deux clés SSH, elles, n'ont leur place que dans
*Secrets*.

| Secrets | |
|---|---|
| `DEPLOY_SSH_KEY` | la clé privée de déploiement, en entier, `-----BEGIN` compris |
| `DEPLOY_KNOWN_HOSTS` | facultatif — `deploy/known_hosts` suffit, voir ci-dessous |

**Les clés d'hôte sont dans le dépôt**, `deploy/known_hosts`. Ce n'est pas un
oubli : une clé d'hôte est publique par construction, et l'épingler dans un
fichier versionné vaut mieux que dans un secret. Elle se relit, donc une
divergence se voit ; elle se versionne, donc un changement de serveur laisse
une trace datée ; et elle ne passe plus par un collage, qui ampute le préfixe
`|1|` d'une entrée hachée une fois sur deux.

Pour un autre serveur, remplace le fichier :

```sh
ssh-keyscan -H <hôte> 2>/dev/null > deploy/known_hosts   # 2>/dev/null : les
                                    # commentaires sortent sur stderr
ssh-keygen -lf deploy/known_hosts                        # relis les empreintes
```

Le secret `DEPLOY_KNOWN_HOSTS` reste prioritaire s'il contient des clés
lisibles, pour un serveur qu'on ne veut pas nommer dans le dépôt.

| Variables | |
|---|---|
| `DEPLOY_HOST` · `DEPLOY_USER` · `DEPLOY_PATH` | `<domaine>` · `msc` · `/srv/msc` |
| `DEPLOY_PORT` | seulement si SSH n'est pas sur 22 |
| `DEPLOY_URL` | `https://<domaine>` — le workflow vérifie `/api/sante` après la bascule |

```sh
# une clé qui ne sert qu'à ça, sans phrase de passe (un runner ne la tape pas)
ssh-keygen -t ed25519 -f ~/.ssh/msc_deploy -C "deploiement msc" -N ""

# la moitié publique va sur le serveur
ssh-copy-id -i ~/.ssh/msc_deploy.pub msc@<domaine>

# la privée dans le secret GitHub — SUR UNE LIGNE, en base64
base64 -w0 ~/.ssh/msc_deploy   # → secret DEPLOY_SSH_KEY
```

**Colle-la en base64.** Une clé PEM fait une douzaine de lignes qui commencent
par des tirets, et c'est exactement ce qu'une sélection à la souris ou un champ
de formulaire ampute : le déploiement répond alors « error in libcrypto » puis
« Permission denied », deux messages qui ne disent pas que le problème est un
collage. Le base64 n'a ni tiret, ni saut de ligne, ni barre verticale — rien à
perdre. Le workflow le décode, et accepte aussi la forme PEM quand elle arrive
intacte.

Les clés d'hôte, elles, sont déjà dans `deploy/known_hosts` : rien à coller.

La clé de déploiement n'a pas besoin d'être `root` et ne doit pas l'être : le
seul droit privilégié qu'elle a est de redémarrer un service, par la ligne de
sudoers ci-dessus.

Le workflow `deploiement.yml` se déclenche **à la main** (onglet Actions →
*déploiement* → Run workflow) ou sur une poussée vers `main`. Tant que rien
n'est poussé sur `main`, rien ne part. Un environnement GitHub nommé
`production` est déjà référencé : y ajouter un *required reviewer* met une
approbation manuelle devant chaque déploiement.

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

Le bouton *Run workflow*. Le workflow construit sur le runner, envoie dans
`releases/<sha>`, migre, bascule le lien `current` et redémarre — dans cet
ordre, parce qu'une migration qui échoue doit laisser l'ancienne version en
place et en marche plutôt qu'une version neuve devant une base qu'elle ne
comprend pas.

Cinq versions sont gardées. Revenir en arrière est un lien symbolique :

```sh
ls -1dt /srv/msc/releases/*/          # la précédente est la deuxième
sudo -u msc ln -sfn /srv/msc/releases/<sha> /srv/msc/current
sudo systemctl restart msc
```

`db:migrate` est idempotent (`CREATE TABLE IF NOT EXISTS`) : il ne casse rien à
être rejoué. Ce qu'il ne sait pas faire, c'est revenir en arrière — un retour
de version ne défait pas une migration, et le jour où l'une d'elles détruit une
colonne, la seule issue est une sauvegarde prise juste avant. Ce n'est pas encore un système de migrations versionnées — le jour
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
Group=msc
# `current` est un lien vers la version en service ; systemd le suit au
# démarrage, donc un retour en arrière est un lien à refaire et un redémarrage.
WorkingDirectory=/srv/msc/current
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
