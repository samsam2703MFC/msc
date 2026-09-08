#!/usr/bin/env bash
# Ouvre la porte d'entrée : un relais devant l'application, en HTTPS.
# À lancer en root, sur le serveur, une fois.
#
#   bash deploy/publier.sh <domaine> [courriel]
#
# L'application écoute sur 127.0.0.1 et n'a jamais été jointe de l'extérieur.
# Il est idempotent — relancé, il ne redemande pas de certificat et ne réécrit
# pas ce que certbot a écrit.
#
# TLS n'est pas décoratif ici : en production le cookie de session porte
# `Secure`, donc en HTTP le navigateur ne le renvoie jamais et personne ne peut
# se connecter. L'application répondrait, et la connexion échouerait sans dire
# pourquoi.
#
# Il ne suppose PAS que la machine est vierge. Une machine qui sert déjà des
# sites a déjà un serveur web sur 80 et 443, et lui en poser un second à côté
# ne fait rien d'autre qu'un service qui refuse de démarrer. C'est arrivé — un
# nginx installé sur un Apache qui tenait déjà les deux ports, et une erreur de
# certificat dans le navigateur qui n'en disait rien.

set -euo pipefail

RACINE=${RACINE:-/srv/msc}
DOMAINE=${1:-}
COURRIEL=${2:-${COURRIEL:-}}

[ "$(id -u)" -eq 0 ] || { echo "À lancer en root."; exit 1; }

dire() { printf '\n\033[1m%s\033[0m\n' "$*"; }

ADRESSES=$(hostname -I)                  # toutes : une machine en a souvent
IP=$(awk '{print $1}' <<< "$ADRESSES")   # plusieurs, et la première n'est pas
                                         # forcément celle que le DNS vise

if [ -z "$DOMAINE" ]; then
  cat <<EOF
Usage : bash deploy/publier.sh <domaine> [courriel]

Il faut un NOM, pas une adresse IP : Let's Encrypt ne certifie pas les IP, et
sans certificat le cookie de session (« Secure » en production) n'est jamais
renvoyé — l'application répond et personne ne peut se connecter.

Sans domaine à toi, il y en a un gratuit qui marche tout de suite :

    bash deploy/publier.sh $IP.sslip.io

sslip.io résout n'importe quel « <ip>.sslip.io » vers cette IP, sans compte et
sans DNS à configurer. Let's Encrypt le certifie comme n'importe quel autre
nom. C'est laid dans la barre d'adresse et ça marche ; le jour où tu as un
vrai domaine, relance ce script avec, rien d'autre à défaire.
EOF
  exit 1
fi

dire "1 · le nom pointe-t-il ici"
# Une validation ratée coûte un jeton de quota chez Let's Encrypt (cinq par
# heure et par nom). Vérifier avant vaut mieux que d'y aller voir.
resolu=$(getent ahostsv4 "$DOMAINE" 2>/dev/null | awk 'NR==1{print $1}')
if [ -z "$resolu" ]; then
  echo "   « $DOMAINE » ne résout vers rien. Le DNS d'abord, ce script ensuite."
  exit 1
fi
echo "   $DOMAINE → $resolu"
# Comparer à TOUTES les adresses de la machine, pas à la première : une
# interface Docker ou un second réseau suffit à faire passer la bonne en
# deuxième, et le script refuserait de partir pour une IP parfaitement juste.
if ! grep -qwF "$resolu" <<< "$ADRESSES"; then
  echo "   ⚠ le nom pointe vers $resolu, que cette machine n'a pas."
  echo "     Elle se voit en : $ADRESSES"
  echo "     Légitime derrière un NAT ou un répartiteur ; sinon le DNS pointe"
  echo "     ailleurs et certbot échouera. Pour passer outre :"
  echo "       FORCER=1 bash \$0 $DOMAINE"
  [ "${FORCER:-0}" = 1 ] || exit 1
  echo "   FORCER=1 — on y va quand même."
fi

dire "2 · qui tient déjà les ports"
# La question qu'il fallait poser en premier. Deux serveurs web sur une machine,
# c'est le second qui ne démarre pas — et rien dans un navigateur ne le dit.
qui() { ss -tlnp 2>/dev/null | awk -v p=":$1\$" '$4 ~ p' \
        | grep -oE '"[^"]+"' | head -1 | tr -d '"'; }
SUR80=$(qui 80 || true)
SUR443=$(qui 443 || true)
echo "   port 80  : ${SUR80:-personne}"
echo "   port 443 : ${SUR443:-personne}"

RELAIS=${SUR443:-${SUR80:-}}
case "$RELAIS" in
  apache2|httpd) RELAIS=apache ;;
  nginx)         RELAIS=nginx ;;
  "")
    RELAIS=nginx
    echo "   personne — on installe nginx"
    apt-get update -qq && apt-get install -y -qq nginx ;;
  *)
    echo
    echo "   « $RELAIS » tient déjà la porte, et je ne sais pas le configurer."
    echo "   Poser un second serveur web à côté ne ferait qu'un service qui"
    echo "   refuse de se lier aux ports. À faire à la main : un mandataire"
    echo "   vers http://127.0.0.1:PORT pour $DOMAINE, et un certificat."
    exit 1 ;;
esac
echo "   relais retenu : $RELAIS"

# nginx installé par une exécution précédente, alors qu'Apache tenait les
# ports : il échoue à démarrer à chaque redémarrage de la machine. Le taire.
if [ "$RELAIS" = apache ] && systemctl list-unit-files nginx.service > /dev/null 2>&1; then
  if systemctl is-enabled nginx > /dev/null 2>&1 || systemctl is-active nginx > /dev/null 2>&1; then
    systemctl disable --now nginx > /dev/null 2>&1 || true
    echo "   nginx arrêté et désactivé : il ne peut pas se lier, Apache a les ports"
  fi
fi

PORT=$(sed -n 's/^PORT=//p' "$RACINE/.env" 2>/dev/null | head -1)
PORT=${PORT:-8787}
echo "   l'application est attendue sur 127.0.0.1:$PORT"

dire "3 · la configuration du relais"
# Le mandataire vit dans un fragment à part, TOUJOURS réécrit. Le bloc de site,
# lui, n'est écrit qu'une fois : certbot l'édite pour y mettre le TLS, et le
# réécrire ici effacerait son travail à chaque passage.
if [ "$RELAIS" = nginx ]; then
  install -d /etc/nginx/snippets
  cat > /etc/nginx/snippets/msc-proxy.conf <<EOF
# Écrit par deploy/publier.sh — les modifications à la main seront écrasées.

# Une photo de balance envoyée par le téléphone dépasse le défaut d'nginx.
client_max_body_size 12m;

gzip on;
gzip_types text/css application/javascript application/json application/manifest+json;

location / {
  proxy_pass http://127.0.0.1:$PORT;
  proxy_set_header Host \$host;
  proxy_set_header X-Forwarded-Proto \$scheme;
  proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;

  # Le serveur pose déjà les bons en-têtes de cache — un an sur les fichiers
  # hachés d'assets/, no-cache sur index.html et le service worker. Ne rien
  # réécrire ici : mettre index.html ou sw.js en cache, c'est livrer une
  # version que le navigateur refusera de remplacer.
}
EOF
  echo "   /etc/nginx/snippets/msc-proxy.conf"

  SITE=/etc/nginx/sites-available/msc
  if grep -q ssl_certificate "$SITE" 2>/dev/null; then
    echo "   $SITE porte déjà du TLS, laissé tel quel"
  else
    cat > "$SITE" <<EOF
server {
  listen 80;
  listen [::]:80;
  server_name $DOMAINE;
  include snippets/msc-proxy.conf;
}
EOF
    echo "   $SITE (en clair pour l'instant — certbot y met le TLS juste après)"
  fi
  ln -sfn "$SITE" /etc/nginx/sites-enabled/msc
  nginx -t
  systemctl reload nginx
  echo "   nginx rechargé"

else
  # mod_proxy et mod_headers ne sont pas actifs par défaut sur Debian.
  a2enmod proxy proxy_http headers deflate > /dev/null 2>&1 || true
  cat > /etc/apache2/conf-available/msc-proxy.conf <<EOF
# Écrit par deploy/publier.sh — les modifications à la main seront écrasées.

# Une photo de balance envoyée par le téléphone dépasse le défaut d'Apache.
LimitRequestBody 12582912

ProxyPreserveHost On

# Le « ! » retire ce chemin du mandataire, et il doit venir AVANT la règle
# générale : Apache prend la première qui correspond. Sans lui, la validation
# du certificat part vers l'application Node, qui répond 404 sur un jeton
# qu'elle n'a jamais vu — et certbot échoue sur un domaine parfaitement joignable.
# Un ProxyPass qui avale « / » avale aussi /.well-known/acme-challenge/, et
# l'Alias que pose certbot ne gagne pas contre mod_proxy.
ProxyPass /.well-known/acme-challenge/ !

ProxyPass        / http://127.0.0.1:$PORT/
ProxyPassReverse / http://127.0.0.1:$PORT/

# %{REQUEST_SCHEME} et non « https » en dur : ce fragment sert AUSSI le vhost
# en clair, tant que certbot n'est pas passé. En dur, l'application se croirait
# derrière du TLS avant qu'il existe.
RequestHeader set X-Forwarded-Proto expr=%{REQUEST_SCHEME}

AddOutputFilterByType DEFLATE text/css application/javascript application/json application/manifest+json

# Le serveur pose déjà les bons en-têtes de cache — un an sur les fichiers
# hachés d'assets/, no-cache sur index.html et le service worker. Ne rien
# réécrire ici : mettre index.html ou sw.js en cache, c'est livrer une version
# que le navigateur refusera de remplacer.
EOF
  echo "   /etc/apache2/conf-available/msc-proxy.conf"

  SITE=/etc/apache2/sites-available/msc.conf
  if [ -f "$SITE" ] && grep -q 'Include conf-available/msc-proxy.conf' "$SITE"; then
    echo "   $SITE existe déjà, laissé tel quel"
  else
    cat > "$SITE" <<EOF
<VirtualHost *:80>
  ServerName $DOMAINE
  Include conf-available/msc-proxy.conf
  ErrorLog \${APACHE_LOG_DIR}/msc-error.log
  CustomLog \${APACHE_LOG_DIR}/msc-access.log combined
</VirtualHost>
EOF
    echo "   $SITE (en clair pour l'instant — certbot y met le TLS juste après)"
  fi
  # Nommé : les autres sites de cette machine gardent les leurs, celui-ci ne
  # répond que pour $DOMAINE.
  a2ensite msc > /dev/null
  apache2ctl configtest
  systemctl reload apache2
  echo "   apache2 rechargé — les autres sites de la machine sont intacts"
fi

dire "4 · le pare-feu"
if command -v ufw > /dev/null && ufw status 2>/dev/null | grep -q '^Status: active'; then
  if [ "$RELAIS" = nginx ]; then ufw allow 'Nginx Full' > /dev/null
  else ufw allow 80/tcp > /dev/null; ufw allow 443/tcp > /dev/null; fi
  echo "   ufw : 80 et 443 ouverts"
else
  echo "   pas d'ufw actif — rien à ouvrir ici."
  echo "   Les deux ports répondent déjà de l'extérieur, donc c'est réglé."
fi

dire "5 · le certificat"
if [ "$RELAIS" = nginx ]; then PLUGIN=python3-certbot-nginx; set -- --nginx
else                           PLUGIN=python3-certbot-apache; set -- --apache; fi
command -v certbot > /dev/null || apt-get install -y -qq certbot "$PLUGIN"
dpkg -s "$PLUGIN" > /dev/null 2>&1 || apt-get install -y -qq "$PLUGIN"

# La lignée qui couvre un domaine ne porte PAS forcément son nom : certbot
# nomme d'après le premier domaine de la PREMIÈRE demande, et un panneau
# d'hébergeur nomme comme il veut. Ici la lignée qui couvre
# 185.180.206.46.sslip.io s'appelle 185.180.206.46.
#
# Et on ne la cherche pas dans « certbot certificates » : lire un rapport, c'est
# dépendre de son format. Cette recherche-là n'a rien rendu pendant que certbot,
# lui, trouvait très bien la lignée. Les certificats, eux, ne dépendent d'aucun
# affichage — on leur demande directement quels noms ils couvrent.
LIGNEE=""; TYPE=""; ECHEANCE=""
for rep in /etc/letsencrypt/live/*/; do
  [ -f "$rep/cert.pem" ] || continue
  openssl x509 -in "$rep/cert.pem" -noout -ext subjectAltName 2>/dev/null \
    | tr ',' '\n' | tr -d ' ' | grep -qxF "DNS:$DOMAINE" || continue
  LIGNEE=$(basename "$rep")
  TYPE=$(sed -n 's/^key_type *= *//p' "/etc/letsencrypt/renewal/$LIGNEE.conf" 2>/dev/null | head -1)
  if [ -z "$TYPE" ]; then
    case "$(openssl x509 -in "$rep/cert.pem" -noout -text | grep -m1 'Public Key Algorithm')" in
      *ecPublicKey*) TYPE=ecdsa ;; *) TYPE=rsa ;;
    esac
  fi
  ECHEANCE=$(openssl x509 -in "$rep/cert.pem" -noout -enddate | cut -d= -f2)
  break
done

if [ -n "$LIGNEE" ]; then
  echo "   un certificat couvre déjà $DOMAINE — lignée « $LIGNEE », clé $TYPE"
  echo "   valable jusqu'au $ECHEANCE : rien de neuf ne sera émis"
  # --key-type doit RÉPÉTER le type existant. Sans lui, certbot applique son
  # défaut, y voit un changement de type de clé, et s'arrête pour demander
  # confirmation — ce qui, en --non-interactive, est un échec sec.
  set -- "$@" --cert-name "$LIGNEE" --key-type "$TYPE" --keep-until-expiring
else
  # --cert-name même sans lignée connue. Sans lui, certbot choisit SEUL à quelle
  # lignée rattacher la demande et peut tomber sur une qu'on n'a pas su lire —
  # c'est exactement ce qui s'est produit, en refusant de partir au nom d'une
  # lignée qui n'apparaissait nulle part dans la commande qu'on lui donnait.
  echo "   aucun certificat ne couvre $DOMAINE ici — demande neuve"
  # Dire ce qui a été regardé : si certbot trouve malgré tout une lignée, la
  # liste ci-dessous est la moitié manquante du diagnostic, et l'avoir sous les
  # yeux tout de suite évite un aller-retour de plus.
  echo "   (lignées examinées : $(ls -1 /etc/letsencrypt/live 2>/dev/null \
        | grep -v '^README$' | tr '\n' ' ')${NULL:-})"
  set -- "$@" --cert-name "$DOMAINE"
fi

if [ -n "$COURRIEL" ]; then set -- "$@" --agree-tos -m "$COURRIEL"
else
  echo "   sans courriel : pas d'avis avant expiration (le renouvellement reste automatique)"
  set -- "$@" --agree-tos --register-unsafely-without-email
fi

# `set -e` tuerait le script sur l'échec de certbot, avec sa propre erreur —
# précise le plus souvent, mais noyée dans le défilement.
if certbot "$@" -d "$DOMAINE" --non-interactive --redirect; then
  echo "   certificat installé, HTTP redirigé vers HTTPS"
else
  echo
  echo "   certbot a échoué. LIS D'ABORD la ligne qu'il vient d'imprimer : il"
  echo "   nomme souvent la cause exacte, et elle n'est pas toujours ci-dessous."
  echo "   Sinon, dans l'ordre de probabilité :"
  echo "     · le port 80 fermé chez l'hébergeur — la validation passe par LUI,"
  echo "       pas par 443, et un pare-feu externe ne se voit pas d'ici."
  echo "     · le DNS pointe ailleurs (vu : $resolu ; la machine a : $ADRESSES)"
  echo "     · cinq essais ratés dans l'heure : Let's Encrypt fait patienter."
  echo "   Rien n'est cassé — $RELAIS sert $DOMAINE en clair, et relancer ce"
  echo "   script reprend exactement ici."
  exit 1
fi
# `systemctl list-timers` sans --all ne montre que les minuteries actives, et
# le paquet Debian installe AUSSI un cron. Chercher la seule minuterie répondait
# « rien ne renouvelle » à une machine qui renouvelle très bien — ou l'inverse,
# ce qui est pire.
if systemctl list-timers --all 2>/dev/null | grep -q certbot \
   || [ -f /etc/cron.d/certbot ]; then
  echo "   renouvellement automatique : en place"
else
  echo "   ⚠ RIEN ne renouvellera ce certificat. Il expirera, comme les autres."
  echo "     certbot annonce « a scheduled task » sans vérifier qu'elle existe."
  echo "     À regarder :  systemctl list-timers --all | grep certbot"
  echo "                   ls -l /etc/cron.d/certbot"
  echo "                   certbot renew --dry-run"
fi

dire "6 · l'essai"
# Ce que le déploiement va demander, demandé ici, où l'erreur est lisible.
if REPONSE=$(curl -fsS --max-time 10 "https://$DOMAINE/api/sante" 2>&1); then
  echo "   https://$DOMAINE/api/sante → $REPONSE"
  echo "$REPONSE" | grep -q '"scellement":true' \
    || echo "   ⚠ MSC_SECRET_KEY absente de $RACINE/.env : ni sessions ni jetons Strava"
  echo "$REPONSE" | grep -q '"cle":true' \
    || echo "   · ANTHROPIC_API_KEY absente : les routes du coach répondront 401"
else
  echo "   ÉCHEC. Ce que curl dit :"
  echo "$REPONSE" | sed 's/^/     /'
  echo "   Dans cet ordre :"
  echo "     systemctl status msc                 l'application tourne-t-elle"
  echo "     curl -s 127.0.0.1:$PORT/api/sante    répond-elle en local"
  echo "     journalctl -u $RELAIS* -n 30         ce que le relais en dit"
fi

dire "Ce qui reste, dans GitHub"
cat <<EOF
   Settings → Secrets and variables → Actions, onglet Variables :

     DEPLOY_URL = https://$DOMAINE

   C'est la dernière étape rouge du déploiement : elle demande /api/sante à
   cette adresse. Mets-la en VARIABLE et non en secret — masquée, elle ne se
   relit plus, et une URL fausse devient invisible dans les journaux.

   Et dans $RACINE/.env, pour Strava :

     STRAVA_REDIRECT_URI=https://$DOMAINE/api/strava/callback
     STRAVA_APP_ORIGIN=https://$DOMAINE

   Le domaine doit aussi être déclaré « Authorization Callback Domain » sur
   https://www.strava.com/settings/api — sinon Strava refuse la redirection.
   Puis : systemctl restart msc
EOF
