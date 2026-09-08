#!/usr/bin/env bash
# Prépare le serveur pour MySmartCoach. À lancer en root, une fois.
#
#   bash deploy/preparer.sh
#
# Il est idempotent : relancé, il ne détruit rien et ne régénère ni la clé de
# déploiement, ni le .env, ni le mot de passe de la base. Ce qui existe déjà est
# laissé tel quel et signalé.
#
# Pourquoi un fichier plutôt qu'un bloc à coller : quarante lignes collées dans
# un terminal se font manger dès que la session bronche — et si l'invite n'est
# pas un shell mais `login`, elles partent en tentatives de connexion, mot de
# passe compris. Un fichier ne se trompe pas d'interlocuteur.

set -euo pipefail

RACINE=${RACINE:-/srv/msc}
UTILISATEUR=${UTILISATEUR:-msc}
BASE=${BASE:-msc}

[ "$(id -u)" -eq 0 ] || { echo "À lancer en root."; exit 1; }

dire() { printf '\n\033[1m%s\033[0m\n' "$*"; }
deja() { printf '   existe déjà, laissé tel quel : %s\n' "$*"; }

dire "1 · Node"
if ! command -v node > /dev/null; then
  echo "   Node n'est pas installé. Le serveur en a besoin (22 ou plus)."
  echo "   curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt install -y nodejs"
  exit 1
fi
majeure=$(node --version | sed 's/^v\([0-9]*\).*/\1/')
echo "   node $(node --version)"
[ "$majeure" -ge 22 ] || {
  echo "   Trop ancien : --env-file-if-exists demande Node 22."
  echo "   curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt install -y nodejs"
  exit 1
}

dire "2 · l'utilisateur et l'arborescence"
# `adduser --system` donne /usr/sbin/nologin par défaut. C'est le bon réflexe
# pour un compte de service, et c'est faux ici : le déploiement ouvre une
# session pour lancer rsync et le script de bascule. Sans shell, il se fait
# refuser sans que rien ne dise pourquoi.
if id "$UTILISATEUR" > /dev/null 2>&1; then
  deja "utilisateur $UTILISATEUR"
else
  adduser --system --group --home "$RACINE" --shell /bin/bash "$UTILISATEUR" > /dev/null
  echo "   créé : $UTILISATEUR"
fi
shell=$(getent passwd "$UTILISATEUR" | cut -d: -f7)
case "$shell" in
  */nologin|*/false|"")
    usermod --shell /bin/bash "$UTILISATEUR"
    echo "   shell corrigé : $shell → /bin/bash" ;;
  *) echo "   shell : $shell" ;;
esac
install -d -o "$UTILISATEUR" -g "$UTILISATEUR" -m 755 "$RACINE" "$RACINE/releases" "$RACINE/var"
install -d -o "$UTILISATEUR" -g "$UTILISATEUR" -m 700 "$RACINE/var/photos" "$RACINE/.ssh"
echo "   $RACINE/{releases,var,var/photos,.ssh}"

dire "3 · la clé de déploiement"
CLE="$RACINE/.ssh/msc_deploy"
if [ -f "$CLE" ]; then deja "$CLE"
else
  sudo -u "$UTILISATEUR" ssh-keygen -q -t ed25519 -f "$CLE" -C "deploiement msc" -N ""
  echo "   créée : $CLE"
fi
touch "$RACINE/.ssh/authorized_keys"
if ! grep -qxFf "$CLE.pub" "$RACINE/.ssh/authorized_keys" 2>/dev/null; then
  cat "$CLE.pub" >> "$RACINE/.ssh/authorized_keys"
  echo "   moitié publique ajoutée à authorized_keys"
else deja "l'entrée dans authorized_keys"; fi
chown "$UTILISATEUR:$UTILISATEUR" "$RACINE/.ssh/authorized_keys"
chmod 600 "$RACINE/.ssh/authorized_keys"

dire "4 · la base"
if ! command -v mysql > /dev/null; then
  echo "   ni mysql ni mariadb. Installe l'un des deux, puis relance :"
  echo "   apt install -y mariadb-server"
  exit 1
fi

# L'accès administrateur, sans jamais poser le mot de passe sur une ligne de
# commande : `ps` est lisible par tout le monde, et un mot de passe qui passe
# par là est un mot de passe publié. Un fichier temporaire en 600 le porte.
CNF=$(mktemp); chmod 600 "$CNF"
trap 'rm -f "$CNF"' EXIT
admin() { mysql --defaults-extra-file="$CNF" "$@"; }
identifiants() { printf '[client]\nuser=root\npassword=%s\n' "$1" > "$CNF"; }

BASE_OK=0
printf '[client]\n' > "$CNF"      # socket d'abord : c'est le cas Debian/Ubuntu
if admin -e 'SELECT 1' > /dev/null 2>&1; then
  echo "   accès administrateur par socket"; BASE_OK=1
elif [ -r /etc/mysql/debian.cnf ] \
     && mysql --defaults-file=/etc/mysql/debian.cnf -e 'SELECT 1' > /dev/null 2>&1; then
  # Debian et Ubuntu installent un compte d'entretien à droits complets, dont
  # les identifiants sont dans ce fichier lisible par root seul. C'est la porte
  # prévue pour ça, et elle évite de demander un mot de passe que personne n'a
  # forcément sous la main.
  cp /etc/mysql/debian.cnf "$CNF"
  echo "   accès administrateur par /etc/mysql/debian.cnf (debian-sys-maint)"; BASE_OK=1
elif [ -n "${MYSQL_ROOT_PASSWORD:-}" ] \
     && identifiants "$MYSQL_ROOT_PASSWORD" && admin -e 'SELECT 1' > /dev/null 2>&1; then
  echo "   accès administrateur par MYSQL_ROOT_PASSWORD"; BASE_OK=1
elif [ -t 0 ]; then
  echo "   le root MySQL de cette machine demande un mot de passe."
  read -rsp "   mot de passe root MySQL : " mdp_root; echo
  identifiants "$mdp_root"; unset mdp_root
  if admin -e 'SELECT 1' > /dev/null 2>&1; then
    echo "   accès administrateur accordé"; BASE_OK=1
  else
    echo "   refusé."
  fi
fi

ENV="$RACINE/.env"
if [ -f "$ENV" ]; then
  deja "$ENV — mot de passe de base et clé de scellement conservés"
  MDP=$(sed -n 's/^MSC_DB_PASSWORD=//p' "$ENV")
else
  MDP=$(openssl rand -base64 24)
fi
SQL="CREATE DATABASE IF NOT EXISTS \`$BASE\`
       CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
     CREATE USER IF NOT EXISTS '$UTILISATEUR'@'localhost' IDENTIFIED BY '<le mot de passe de MSC_DB_PASSWORD>';
     GRANT ALL PRIVILEGES ON \`$BASE\`.* TO '$UTILISATEUR'@'localhost';
     FLUSH PRIVILEGES;"

if [ "$BASE_OK" = 1 ]; then
  admin -e "CREATE DATABASE IF NOT EXISTS \`$BASE\`
              CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
            CREATE USER IF NOT EXISTS '$UTILISATEUR'@'localhost' IDENTIFIED BY '$MDP';
            ALTER USER '$UTILISATEUR'@'localhost' IDENTIFIED BY '$MDP';
            GRANT ALL PRIVILEGES ON \`$BASE\`.* TO '$UTILISATEUR'@'localhost';
            FLUSH PRIVILEGES;"
  echo "   base « $BASE », utilisateur « $UTILISATEUR » avec droits sur elle seule"
else
  # La base n'est pas ce qui bloque un déploiement : le SSH l'est. Continuer
  # laisse l'essai de connexion se faire, qui est ce qu'on est venu vérifier.
  BASE_A_FAIRE=1
  echo "   pas d'accès administrateur — la base est LAISSÉE À FAIRE."
  echo "   Le reste continue : ce qui bloque un déploiement, c'est le SSH."
fi

dire "5 · le .env"
if [ -f "$ENV" ]; then deja "$ENV"
else
  install -o "$UTILISATEUR" -g "$UTILISATEUR" -m 600 /dev/null "$ENV"
  cat > "$ENV" <<EOF
# MySmartCoach — production. chmod 600, hors du dépôt.
NODE_ENV=production
PORT=8787

# 32 octets. Chiffre les jetons Strava ET signe les sessions.
# La perdre : tous les comptes Strava à relier, toutes les sessions invalidées.
# À sauvegarder AILLEURS que la base qu'elle protège.
MSC_SECRET_KEY=$(openssl rand -base64 32)

MSC_DB_HOST=127.0.0.1
MSC_DB_PORT=3306
MSC_DB_USER=$UTILISATEUR
MSC_DB_PASSWORD=$MDP
MSC_DB_NAME=$BASE
MSC_PHOTOS_DIR=$RACINE/var/photos

# Sans elle, les routes du coach répondent 401 et le reste marche.
ANTHROPIC_API_KEY=

# https://www.strava.com/settings/api — le domaine doit être enregistré
# comme « Authorization Callback Domain » sur l'application Strava.
STRAVA_CLIENT_ID=
STRAVA_CLIENT_SECRET=
STRAVA_REDIRECT_URI=https://$(hostname -I | awk '{print $1}')/api/strava/callback
STRAVA_APP_ORIGIN=https://$(hostname -I | awk '{print $1}')
STRAVA_VERIFY_TOKEN=$(openssl rand -hex 16)

# MSC_ATHLETE_ID : NE PAS DÉFINIR. Porte de service du développement,
# refusée quand NODE_ENV=production.
EOF
  chown "$UTILISATEUR:$UTILISATEUR" "$ENV"; chmod 600 "$ENV"
  echo "   créé : $ENV (clé de scellement et mot de passe tirés ici)"
fi

dire "6 · le service"
cat > /etc/systemd/system/msc.service <<EOF
[Unit]
Description=MySmartCoach
After=network.target mysql.service mariadb.service

[Service]
Type=simple
User=$UTILISATEUR
WorkingDirectory=$RACINE/current
EnvironmentFile=$ENV
ExecStart=/usr/bin/node server/index.mjs
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable msc > /dev/null 2>&1 || true
echo "   msc.service installé et activé (il démarrera au premier déploiement)"

# Le seul droit privilégié de la clé de déploiement : redémarrer un service.
echo "$UTILISATEUR ALL=(root) NOPASSWD: /bin/systemctl restart msc" > /etc/sudoers.d/msc-restart
chmod 440 /etc/sudoers.d/msc-restart
echo "   sudoers : $UTILISATEUR peut redémarrer msc, et rien d'autre"

dire "7 · l'essai de connexion"
# Le déploiement ouvre une session avec cette clé. Autant l'essayer ICI, où
# l'erreur est lisible en une seconde, plutôt que de la découvrir par un
# aller-retour GitHub qui ne dit que « Permission denied ».
if sudo -u "$UTILISATEUR" ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new \
     -o ConnectTimeout=5 -i "$CLE" "$UTILISATEUR@127.0.0.1" true 2> /tmp/essai_ssh.log; then
  echo "   la clé ouvre bien une session $UTILISATEUR@127.0.0.1"
else
  echo "   ÉCHEC — le déploiement échouera pareil. Ce que ssh dit :"
  sed 's/^/     /' /tmp/essai_ssh.log
  echo "   À regarder, dans cet ordre :"
  echo "     - le shell de $UTILISATEUR : $(getent passwd "$UTILISATEUR" | cut -d: -f7)"
  echo "     - les droits : $(stat -c '%a %U' "$RACINE") sur $RACINE,"
  echo "       $(stat -c '%a %U' "$RACINE/.ssh") sur .ssh,"
  echo "       $(stat -c '%a %U' "$RACINE/.ssh/authorized_keys") sur authorized_keys"
  echo "     - sshd : AllowUsers / DenyUsers / PubkeyAuthentication"
  echo "   sshd explique toujours son refus dans /var/log/auth.log."
fi
echo "   empreinte de la clé : $(ssh-keygen -lf "$CLE" | cut -d' ' -f1,2)"

dire "Ce qui reste à faire, à la main"
if [ "${BASE_A_FAIRE:-0}" = 1 ]; then
  cat <<EOF
   0. LA BASE, qui n'a pas pu être créée faute d'accès administrateur MySQL.
      Là où tu administres MySQL, avec le mot de passe qui est déjà dans
      $ENV (ligne MSC_DB_PASSWORD) :

$SQL

      Ou relance ce script avec : MYSQL_ROOT_PASSWORD='…' bash \$0

EOF
fi
cat <<EOF
   1. Le secret GitHub DEPLOY_SSH_KEY. En lignes COURTES, qui ne se replient
      pas — le déploiement enlève les blancs avant de décoder :

        base64 -w 60 $CLE

      Une longue ligne unique s'affiche repliée, et une sélection à la souris y
      prend le visible : tantôt il en manque la fin, tantôt elle emporte
      l'invite d'à côté. Des lignes de 60 caractères tiennent dans n'importe
      quel terminal, et se sélectionnent en bloc sans surprise.

      Ne la colle nulle part ailleurs : celle-là est privée.

      Longueur attendue : $(base64 -w0 "$CLE" | tr -d '\n' | wc -c) caractères
      Empreinte          : $(base64 -w0 "$CLE" | tr -d '\n' | sha256sum | cut -c1-12)

      Le déploiement affiche ces deux nombres pour ce qu'il a REÇU, calculés de
      la même façon — blancs retirés. S'ils diffèrent, ce n'est pas la même
      chose des deux côtés : trop court, il manque la fin ; trop long, la
      sélection a emporté autre chose avec.

   2. Les variables GitHub, si ce n'est pas déjà fait :
        DEPLOY_HOST=$(hostname -I | awk '{print $1}')  DEPLOY_USER=$UTILISATEUR  DEPLOY_PATH=$RACINE

   3. Dans $ENV : ANTHROPIC_API_KEY et les identifiants Strava.

   4. La porte d'entrée — l'application n'écoute que sur la boucle locale :
        bash $(dirname "$0")/publier.sh <domaine>
      nginx, le certificat et la redirection. Sans TLS le cookie de session
      porte « Secure » et n'est jamais renvoyé : personne ne peut se connecter.
      Sans domaine à toi : $(hostname -I | awk '{print $1}').sslip.io en est un.

   5. Après le premier déploiement, sur la base neuve SEULEMENT :
        cd $RACINE/current
        sudo -u $UTILISATEUR npm run db:seed:serveur
        sudo -u $UTILISATEUR npm run compte -- creer <email> "<nom>"
        sudo -u $UTILISATEUR npm run compte -- acces <email> 1 ecriture

      db:seed:serveur, et surtout pas db:seed : celui-ci empaquette des sources
      qui ne partent pas au serveur, installe esbuild sur la production et
      échoue sur des imports absents. Le runner a empaqueté le classeur dans
      outils/db-seed.mjs, qui n'a besoin que de mysql2.

      Il vide les tables du plan avant de les remplir : JAMAIS sur une base
      qui sert. Le compte créé est sans mot de passe utilisable — un mot de
      passe par défaut est un mot de passe public.
EOF
