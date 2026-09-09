#!/usr/bin/env bash
# Ouvre la porte d'entrée : un relais devant l'application.
# À lancer en root, sur le serveur, une fois.
#
#   bash deploy/publier.sh <domaine>       → HTTPS, certificat Let's Encrypt
#   bash deploy/publier.sh <adresse IP>    → HTTP seul, sous un chemin
#
# Il est idempotent : relancé, il ne redemande pas de certificat et ne réécrit
# pas ce que certbot a écrit.
#
# Il ne suppose pas la machine vierge. Une machine qui sert déjà des sites a
# déjà un serveur web sur 80 et 443, et lui en poser un second à côté ne fait
# rien d'autre qu'un service qui refuse de démarrer, pendant que le premier
# continue de répondre avec le certificat d'un autre site.

set -euo pipefail

RACINE=${RACINE:-/srv/msc}
CIBLE=${1:-}
COURRIEL=${2:-${COURRIEL:-}}

[ "$(id -u)" -eq 0 ] || { echo "À lancer en root."; exit 1; }

dire() { printf '\n\033[1m%s\033[0m\n' "$*"; }

ADRESSES=$(hostname -I)
IP=$(awk '{print $1}' <<< "$ADRESSES")

if [ -z "$CIBLE" ]; then
  cat <<EOF
Usage : bash deploy/publier.sh <domaine|adresse IP> [courriel]

  bash deploy/publier.sh mon-domaine.fr     HTTPS, certificat automatique.
  bash deploy/publier.sh $IP        HTTP seul, sous /msc.

Une adresse IP ne peut pas avoir de certificat : Let's Encrypt ne certifie que
des noms. Le mode IP sert donc l'application en clair — pratique pour essayer,
et à ne pas laisser ainsi une fois qu'elle porte de vraies données.
EOF
  exit 1
fi

# Un nom, ou une adresse ? Les deux chemins n'ont presque rien en commun.
if grep -qE '^([0-9]{1,3}\.){3}[0-9]{1,3}$' <<< "$CIBLE"; then MODE=ip; else MODE=domaine; fi
echo "cible : $CIBLE  ($MODE)"

dire "1 · la cible mène-t-elle ici"
if [ "$MODE" = domaine ]; then
  # Une validation ratée coûte un jeton de quota chez Let's Encrypt (cinq par
  # heure et par nom). Vérifier avant vaut mieux que d'y aller voir.
  resolu=$(getent ahostsv4 "$CIBLE" 2>/dev/null | awk 'NR==1{print $1}')
  [ -n "$resolu" ] || { echo "   « $CIBLE » ne résout vers rien. Le DNS d'abord."; exit 1; }
  echo "   $CIBLE → $resolu"
else
  resolu=$CIBLE
  echo "   adresse littérale, aucun DNS en jeu — c'est tout l'intérêt :"
  echo "   un résolveur qui réécrit les réponses ne peut rien réécrire ici."
fi
# Comparer à TOUTES les adresses de la machine, pas à la première : une
# interface Docker ou un second réseau suffit à faire passer la bonne en
# deuxième, et le script refuserait de partir pour une IP parfaitement juste.
if ! grep -qwF "$resolu" <<< "$ADRESSES"; then
  echo "   ⚠ $resolu n'est pas une adresse de cette machine."
  echo "     Elle se voit en : $ADRESSES"
  echo "     Légitime derrière un NAT ou un répartiteur ; sinon c'est une erreur."
  echo "     Pour passer outre :  FORCER=1 bash \$0 $CIBLE"
  [ "${FORCER:-0}" = 1 ] || exit 1
  echo "   FORCER=1 — on y va quand même."
fi

dire "2 · qui tient déjà les ports"
# La question qu'il faut poser en premier. Deux serveurs web sur une machine,
# c'est le second qui ne démarre pas — et rien dans un navigateur ne le dit.
qui() { ss -tlnp 2>/dev/null | awk -v p=":$1\$" '$4 ~ p' \
        | grep -oE '"[^"]+"' | head -1 | tr -d '"'; }
SUR80=$(qui 80 || true); SUR443=$(qui 443 || true)
echo "   port 80  : ${SUR80:-personne}"
echo "   port 443 : ${SUR443:-personne}"

RELAIS=${SUR443:-${SUR80:-}}
case "$RELAIS" in
  apache2|httpd) RELAIS=apache ;;
  nginx)         RELAIS=nginx ;;
  "")            RELAIS=nginx; echo "   personne — on installe nginx"
                 apt-get update -qq && apt-get install -y -qq nginx ;;
  *) echo; echo "   « $RELAIS » tient déjà la porte, et je ne sais pas le configurer."
     echo "   À faire à la main : un mandataire vers http://127.0.0.1:PORT."; exit 1 ;;
esac
echo "   relais retenu : $RELAIS"

if [ "$RELAIS" = apache ] && systemctl list-unit-files nginx.service > /dev/null 2>&1; then
  if systemctl is-enabled nginx > /dev/null 2>&1 || systemctl is-active nginx > /dev/null 2>&1; then
    systemctl disable --now nginx > /dev/null 2>&1 || true
    echo "   nginx arrêté et désactivé : il ne peut pas se lier, Apache a les ports"
  fi
fi

PORT=$(sed -n 's/^PORT=//p' "$RACINE/.env" 2>/dev/null | head -1); PORT=${PORT:-8787}
echo "   l'application est attendue sur 127.0.0.1:$PORT"

dire "3 · sous quel chemin"
# Le montage DOIT correspondre au « base » avec lequel dist/ a été construit :
# sinon le navigateur demande /msc/assets/… là où le relais n'écoute qu'à la
# racine, et la page reste blanche sans une erreur qui le dise. Plutôt que de
# le supposer, on le lit dans l'index construit — c'est lui qui fait foi.
INDEX="$RACINE/current/dist/index.html"
if [ -n "${CHEMIN:-}" ]; then
  MONTAGE="/${CHEMIN#/}"; MONTAGE="${MONTAGE%/}"
  echo "   imposé par CHEMIN : ${MONTAGE:-/}"
elif [ -f "$INDEX" ]; then
  MONTAGE=$(sed -n 's|.*<script[^>]*src="\(/[^"]*\)/assets/.*|\1|p' "$INDEX" | head -1)
  echo "   lu dans $INDEX : ${MONTAGE:-/ (racine)}"
else
  MONTAGE=/msc
  echo "   pas encore de version déployée — on prend $MONTAGE (le défaut du build)"
fi
[ "$MODE" = domaine ] || [ -n "$MONTAGE" ] || {
  echo "   ⚠ montage à la racine sur une IP : possible, mais il écrase le site"
  echo "     par défaut de cette machine pour les requêtes à l'adresse nue."; }

dire "4 · la configuration du relais"
if [ "$RELAIS" = nginx ]; then
  install -d /etc/nginx/snippets
  { echo "# Écrit par deploy/publier.sh — les modifications à la main seront écrasées."
    echo "client_max_body_size 12m;"
    echo "gzip on;"
    echo "gzip_types text/css application/javascript application/json application/manifest+json;"
    echo "location ${MONTAGE:-/}/ {"
    echo "  proxy_pass http://127.0.0.1:$PORT/;"
    echo '  proxy_set_header Host $host;'
    echo '  proxy_set_header X-Forwarded-Proto $scheme;'
    echo '  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;'
    echo "}"
  } | sed 's|^location //|location /|' > /etc/nginx/snippets/msc-proxy.conf
  SITE=/etc/nginx/sites-available/msc
  if ! grep -q ssl_certificate "$SITE" 2>/dev/null; then
    printf 'server {\n  listen 80;\n  listen [::]:80;\n  server_name %s;\n  include snippets/msc-proxy.conf;\n}\n' \
      "$CIBLE" > "$SITE"
  fi
  ln -sfn "$SITE" /etc/nginx/sites-enabled/msc
  nginx -t && systemctl reload nginx
  echo "   nginx rechargé"
else
  a2enmod proxy proxy_http headers deflate > /dev/null 2>&1 || true
  {
    echo "# Écrit par deploy/publier.sh — les modifications à la main seront écrasées."
    echo
    echo "# Une photo de balance envoyée par le téléphone dépasse le défaut d'Apache."
    echo "LimitRequestBody 12582912"
    echo
    echo "ProxyPreserveHost On"
    if [ "$MODE" = domaine ]; then
      echo
      echo "# Le « ! » retire ce chemin du mandataire, et il doit venir AVANT la règle"
      echo "# générale : Apache prend la première qui correspond. Sans lui, la"
      echo "# validation du certificat part vers l'application, qui répond 404 sur un"
      echo "# jeton qu'elle n'a jamais vu — et certbot échoue sur un domaine pourtant"
      echo "# joignable. L'Alias que pose certbot ne gagne pas contre mod_proxy."
      echo "ProxyPass $MONTAGE/.well-known/acme-challenge/ !"
    fi
    echo
    echo "# Les barres obliques finales des DEUX côtés : c'est elles qui retirent le"
    echo "# préfixe. « $MONTAGE/api/sante » arrive au serveur comme « /api/sante », et"
    echo "# le serveur Node continue d'ignorer où il est monté."
    echo "ProxyPass        $MONTAGE/ http://127.0.0.1:$PORT/"
    echo "ProxyPassReverse $MONTAGE/ http://127.0.0.1:$PORT/"
    echo
    echo "# %{REQUEST_SCHEME} et non « https » en dur : ce fragment sert aussi le"
    echo "# vhost en clair, et l'application se croirait derrière du TLS sans lui."
    echo "RequestHeader set X-Forwarded-Proto expr=%{REQUEST_SCHEME}"
    echo
    echo "AddOutputFilterByType DEFLATE text/css application/javascript application/json application/manifest+json"
    echo
    echo "# Le serveur pose déjà les bons en-têtes de cache — un an sur les fichiers"
    echo "# hachés d'assets/, no-cache sur index.html et le service worker. Ne rien"
    echo "# réécrire ici : mettre index.html en cache, c'est livrer une version que"
    echo "# le navigateur refusera de remplacer."
  } > /etc/apache2/conf-available/msc-proxy.conf
  echo "   /etc/apache2/conf-available/msc-proxy.conf  (montage : ${MONTAGE:-/})"

  SITE=/etc/apache2/sites-available/msc.conf
  {
    echo "<VirtualHost *:80>"
    echo "  ServerName $CIBLE"
    # Sans ça, « /msc » sans barre finale ne correspond à aucune règle et tombe
    # sur le site par défaut de la machine — un 404 signé Apache, déroutant.
    [ -n "$MONTAGE" ] && echo "  RedirectMatch ^$MONTAGE\$ $MONTAGE/"
    echo "  Include conf-available/msc-proxy.conf"
    echo "  ErrorLog \${APACHE_LOG_DIR}/msc-error.log"
    echo "  CustomLog \${APACHE_LOG_DIR}/msc-access.log combined"
    echo "</VirtualHost>"
  } > "$SITE"
  echo "   $SITE"
  a2ensite msc > /dev/null
  apache2ctl configtest
  systemctl reload apache2
  echo "   apache2 rechargé — les autres sites de la machine sont intacts"
fi

dire "5 · le pare-feu"
if command -v ufw > /dev/null && ufw status 2>/dev/null | grep -q '^Status: active'; then
  ufw allow 80/tcp > /dev/null; ufw allow 443/tcp > /dev/null
  echo "   ufw : 80 et 443 ouverts"
else
  echo "   pas d'ufw actif — les ports répondent déjà de l'extérieur."
fi

if [ "$MODE" = domaine ]; then
  dire "6 · le certificat"
  if [ "$RELAIS" = nginx ]; then PLUGIN=python3-certbot-nginx; set -- --nginx
  else                           PLUGIN=python3-certbot-apache; set -- --apache; fi
  command -v certbot > /dev/null || apt-get install -y -qq certbot "$PLUGIN"
  dpkg -s "$PLUGIN" > /dev/null 2>&1 || apt-get install -y -qq "$PLUGIN"

  # La lignée qui couvre un domaine ne porte PAS forcément son nom : certbot
  # nomme d'après le premier domaine de la PREMIÈRE demande. On ne la cherche
  # pas dans « certbot certificates » — lire un rapport, c'est dépendre de son
  # format, et ça n'a rien rendu pendant que certbot trouvait très bien la
  # lignée. Les certificats, eux, ne dépendent d'aucun affichage.
  LIGNEE=""; TYPE=""; ECHEANCE=""
  for rep in /etc/letsencrypt/live/*/; do
    [ -f "$rep/cert.pem" ] || continue
    openssl x509 -in "$rep/cert.pem" -noout -ext subjectAltName 2>/dev/null \
      | tr ',' '\n' | tr -d ' ' | grep -qxF "DNS:$CIBLE" || continue
    LIGNEE=$(basename "$rep")
    TYPE=$(sed -n 's/^key_type *= *//p' "/etc/letsencrypt/renewal/$LIGNEE.conf" 2>/dev/null | head -1)
    [ -n "$TYPE" ] || case "$(openssl x509 -in "$rep/cert.pem" -noout -text | grep -m1 'Public Key Algorithm')" in
      *ecPublicKey*) TYPE=ecdsa ;; *) TYPE=rsa ;; esac
    ECHEANCE=$(openssl x509 -in "$rep/cert.pem" -noout -enddate | cut -d= -f2)
    break
  done
  if [ -n "$LIGNEE" ]; then
    echo "   un certificat couvre déjà $CIBLE — lignée « $LIGNEE », clé $TYPE"
    echo "   valable jusqu'au $ECHEANCE : rien de neuf ne sera émis"
    # --key-type doit RÉPÉTER le type existant : sans lui certbot applique son
    # défaut, y voit un changement de type, et s'arrête pour demander
    # confirmation — ce qui, en --non-interactive, est un échec sec.
    set -- "$@" --cert-name "$LIGNEE" --key-type "$TYPE" --keep-until-expiring
  else
    # --cert-name même sans lignée connue : sans lui certbot choisit SEUL à
    # laquelle rattacher la demande et peut tomber sur une qu'on n'a pas su
    # lire, puis refuser au nom d'une lignée absente de la commande.
    echo "   aucun certificat ne couvre $CIBLE ici — demande neuve"
    echo "   (lignées examinées : $(ls -1 /etc/letsencrypt/live 2>/dev/null | grep -v '^README$' | tr '\n' ' '))"
    set -- "$@" --cert-name "$CIBLE"
  fi
  if [ -n "$COURRIEL" ]; then set -- "$@" --agree-tos -m "$COURRIEL"
  else echo "   sans courriel : pas d'avis avant expiration"
       set -- "$@" --agree-tos --register-unsafely-without-email; fi

  if certbot "$@" -d "$CIBLE" --non-interactive --redirect; then
    echo "   certificat installé, HTTP redirigé vers HTTPS"
  else
    echo; echo "   certbot a échoué. LIS D'ABORD la ligne qu'il vient d'imprimer :"
    echo "   il nomme souvent la cause exacte. Sinon, par ordre de probabilité :"
    echo "     · le port 80 fermé chez l'hébergeur — la validation passe par LUI."
    echo "     · le DNS pointe ailleurs (vu : $resolu ; la machine a : $ADRESSES)"
    echo "     · cinq essais ratés dans l'heure : Let's Encrypt fait patienter."
    echo "   Rien n'est cassé — $RELAIS sert $CIBLE en clair. Relancer reprend ici."
    exit 1
  fi
  systemctl list-timers --all 2>/dev/null | grep -q certbot || [ -f /etc/cron.d/certbot ] \
    && echo "   renouvellement automatique : en place" \
    || echo "   ⚠ RIEN ne renouvellera ce certificat. certbot annonce « a scheduled
     task » sans vérifier qu'elle existe.  certbot renew --dry-run"
  RACINE_URL="https://$CIBLE$MONTAGE"
else
  dire "6 · pas de certificat, et pourquoi"
  cat <<EOF
   Let's Encrypt ne certifie que des NOMS. Sur $CIBLE il n'y a donc pas de
   HTTPS, et le cookie de session voyagera en clair : qui lit le réseau entre
   ton navigateur et ce serveur prend la session. Acceptable pour essayer, pas
   pour de vraies données.

   Or en production ce cookie porte « Secure », ce qui interdit au navigateur
   de le renvoyer hors HTTPS. Laissé tel quel, tout aurait l'air de marcher —
   le serveur répond, la connexion rend 200 — et la requête suivante serait
   anonyme. Il faut donc lever le drapeau, explicitement.
EOF
  ENV="$RACINE/.env"
  if [ -f "$ENV" ]; then
    if grep -q '^MSC_SANS_TLS=' "$ENV"; then
      sed -i 's|^MSC_SANS_TLS=.*|MSC_SANS_TLS=1|' "$ENV"
      echo "   $ENV : MSC_SANS_TLS remis à 1"
    else
      printf '\n# Pas de TLS possible sur une IP nue : le cookie de session perd\n# « Secure », faute de quoi le navigateur ne le renvoie jamais.\nMSC_SANS_TLS=1\n' >> "$ENV"
      echo "   $ENV : MSC_SANS_TLS=1 ajouté"
    fi
    systemctl restart msc 2>/dev/null && echo "   msc redémarré" \
      || echo "   ⚠ msc n'a pas redémarré — il démarrera au prochain déploiement"
  else
    echo "   ⚠ $ENV absent : ajoute MSC_SANS_TLS=1 toi-même, sinon aucune connexion"
  fi
  RACINE_URL="http://$CIBLE$MONTAGE"
fi

dire "7 · l'essai"
if REPONSE=$(curl -fsS --max-time 10 "$RACINE_URL/api/sante" 2>&1); then
  echo "   $RACINE_URL/api/sante → $REPONSE"
  grep -q '"scellement":true' <<< "$REPONSE" \
    || echo "   ⚠ MSC_SECRET_KEY absente de $RACINE/.env : ni sessions ni jetons Strava"
  grep -q '"cle":true' <<< "$REPONSE" \
    || echo "   · ANTHROPIC_API_KEY absente : les routes du coach répondront 401"
  if PAGE=$(curl -fsS --max-time 10 "$RACINE_URL/" 2>&1); then
    # Une page qui répond mais dont les assets pointent ailleurs reste blanche,
    # sans une erreur qui le dise. Autant comparer ici.
    ATTENDU="${MONTAGE:-}/assets/"
    grep -q "$ATTENDU" <<< "$PAGE" \
      && echo "   la page demande bien ses assets sous $ATTENDU" \
      || { echo "   ⚠ la page ne demande PAS ses assets sous $ATTENDU :"
           grep -o 'src="[^"]*assets[^"]*"' <<< "$PAGE" | head -2 | sed 's/^/       /'
           echo "     dist/ a été construit pour un autre chemin. Reconstruis avec"
           echo "     MSC_BASE=${MONTAGE:-/} ou relance ce script après le déploiement."; }
  fi
else
  echo "   ÉCHEC. Ce que curl dit :"; sed 's/^/     /' <<< "$REPONSE"
  echo "   Dans cet ordre :"
  echo "     systemctl status msc                 l'application tourne-t-elle"
  echo "     curl -s 127.0.0.1:$PORT/api/sante    répond-elle en local"
  echo "     journalctl -u $RELAIS* -n 30         ce que le relais en dit"
fi

dire "Ce qui reste, dans GitHub"
cat <<EOF
   Settings → Secrets and variables → Actions, onglet Variables :

     DEPLOY_URL = $RACINE_URL

   C'est la dernière étape du déploiement : elle demande /api/sante là.
   Mets-la en VARIABLE et non en secret — masquée, une URL fausse devient
   invisible dans les journaux, au moment précis où il faudrait la lire.
EOF
[ "$MODE" = domaine ] && cat <<EOF

   Et dans $RACINE/.env, pour Strava :
     STRAVA_REDIRECT_URI=$RACINE_URL/api/strava/callback
     STRAVA_APP_ORIGIN=$RACINE_URL
   Le domaine doit être déclaré « Authorization Callback Domain » sur
   https://www.strava.com/settings/api.  Puis : systemctl restart msc
EOF
printf '\n\033[1mL'"'"'adresse : %s\033[0m\n\n' "$RACINE_URL/"
