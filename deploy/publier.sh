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
  if [ -f "$SITE" ]; then
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
# nomme une lignée d'après le premier domaine de la PREMIÈRE demande, et un
# panneau d'hébergeur nomme comme il veut. Chercher /etc/letsencrypt/live/<nom>
# rate donc un certificat qui existe bel et bien — et certbot refuse alors de
# partir en parlant d'un nom qu'on n'a jamais écrit nulle part.
EXISTANT=$(certbot certificates 2>/dev/null | awk -v d="$DOMAINE" '
  /Certificate Name:/ { nom=$NF; type=""; ok=0 }
  /Key Type:/         { type=tolower($NF) }
  /Domains:/          { ok=0; for (i=2;i<=NF;i++) if ($i==d) ok=1 }
  /Expiry Date:/      { if (ok) print nom"\t"type"\t"$3 }' | head -1)

if [ -n "$EXISTANT" ]; then
  NOM=$(cut -f1 <<< "$EXISTANT")
  TYPE=$(cut -f2 <<< "$EXISTANT")
  ECHEANCE=$(cut -f3 <<< "$EXISTANT")
  echo "   une lignée couvre déjà $DOMAINE : « $NOM », clé $TYPE, jusqu'au $ECHEANCE"
  echo "   on la réutilise et on l'installe dans $RELAIS"
  # --key-type doit RÉPÉTER le type existant. Sans lui, certbot applique son
  # défaut, y voit un changement de type de clé, et s'arrête pour demander
  # confirmation — ce qui, en --non-interactive, est un échec sec.
  set -- "$@" --cert-name "$NOM" --key-type "$TYPE" --keep-until-expiring
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
systemctl list-timers 2>/dev/null | grep -q certbot \
  && echo "   renouvellement automatique : minuterie certbot active" \
  || echo "   ⚠ pas de minuterie certbot — le certificat expirera dans 90 jours"

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
