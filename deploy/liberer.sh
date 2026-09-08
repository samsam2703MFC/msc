#!/usr/bin/env bash
# Installe une version déjà construite et bascule dessus.
#
# Ce script tourne SUR le serveur, appelé par le workflow de déploiement. Il ne
# construit rien : le runner l'a fait, ce qui évite d'avoir les outils de build
# et leur mémoire sur une machine de production.
#
#   /srv/msc/
#     .env                  hors des versions, 600 — les secrets
#     var/                  hors des versions — les photos reçues
#     releases/<sha>/       une par déploiement
#     current -> releases/<sha>
#
# L'ordre compte : on migre AVANT de basculer. Une migration qui échoue laisse
# donc l'ancienne version en place et en marche, plutôt qu'une version neuve
# devant une base qu'elle ne comprend pas.

set -euo pipefail

RACINE="${1:?usage: liberer.sh <racine> <sha>}"
SHA="${2:?usage: liberer.sh <racine> <sha>}"
VERSION="$RACINE/releases/$SHA"
SERVICE="${MSC_SERVICE:-msc}"
GARDER="${MSC_GARDER:-5}"

echo "→ version $SHA"
cd "$VERSION"

# Le .env vit à la racine et ne bouge pas d'un déploiement à l'autre.
ln -sfn "$RACINE/.env" "$VERSION/.env"
ln -sfn "$RACINE/var" "$VERSION/var"

# Seulement les dépendances d'exécution : le build est déjà fait.
npm ci --omit=dev --no-audit --no-fund

# Le schéma. `db:migrate` est idempotent — CREATE TABLE IF NOT EXISTS — donc le
# rejouer ne coûte rien. Ce qu'il ne sait pas faire, c'est revenir en arrière :
# le jour où une migration détruit une colonne, il faudra une sauvegarde prise
# juste avant, et ce commentaire ne suffira plus.
npm run db:migrate

# db:seed n'est JAMAIS lancé ici. Il vide les tables du plan avant de les
# remplir : sur une base vivante, c'est le plan de l'athlète et les analyses qui
# y sont attachées qui disparaissent. Il ne se lance qu'une fois, à la main, sur
# une base neuve.

ln -sfn "$VERSION" "$RACINE/current.tmp"
mv -Tf "$RACINE/current.tmp" "$RACINE/current"
echo "→ current → $SHA"

if systemctl is-enabled --quiet "$SERVICE" 2>/dev/null; then
  sudo systemctl restart "$SERVICE"
  echo "→ $SERVICE redémarré"

  # `systemctl restart` rend la main sans attendre que le processus tienne : un
  # service qui meurt au démarrage ressemble alors à un déploiement réussi. On
  # demande donc à l'application elle-même, ICI, sur la boucle locale.
  #
  # C'est aussi ce qui sépare deux échecs qu'on confond sinon : l'application
  # qui ne démarre pas, et l'application qui tourne mais qu'on n'atteint pas de
  # l'extérieur — une URL fausse, un port fermé, un proxy absent. Le premier est
  # un déploiement raté ; le second ne l'est pas.
  PORT_APP="$(sed -n 's/^PORT=//p' "$RACINE/.env" 2>/dev/null | head -1)"
  PORT_APP="${PORT_APP:-8787}"
  SANTE=""
  for _ in $(seq 1 20); do
    SANTE="$(curl -fsS --max-time 3 "http://127.0.0.1:$PORT_APP/api/sante" 2>/dev/null)" && break
    sleep 1
  done
  if [ -n "$SANTE" ]; then
    echo "→ l'application répond sur 127.0.0.1:$PORT_APP"
    echo "  $SANTE"
  else
    echo "✗ l'application ne répond pas sur 127.0.0.1:$PORT_APP après 20 s."
    echo "  Le journal dit pourquoi :  journalctl -u $SERVICE -n 40 --no-pager"
    exit 1
  fi
else
  echo "⚠ le service $SERVICE n'est pas connu de systemd — redémarre à la main"
fi

# On garde quelques versions pour pouvoir revenir en arrière d'un coup de
# symlink, pas davantage : chacune traîne son node_modules.
#
# Jamais celle sur laquelle `current` pointe, en revanche. Ici cette garde ne
# devrait pas se déclencher — on vient de basculer, donc `current` est la plus
# récente — mais elle tient même si l'ordre des opérations change un jour, et
# supprimer la version en service casserait le service au prochain redémarrage.
#
# Un retour en arrière suivi d'un déploiement, lui, élague normalement la
# version sur laquelle on était revenu : on a choisi d'avancer.
EN_SERVICE="$(basename "$(readlink -f "$RACINE/current")")"
cd "$RACINE/releases"
ls -1dt */ 2>/dev/null | sed 's:/$::' | tail -n "+$((GARDER + 1))" | while read -r vieille; do
  [ "$vieille" = "$EN_SERVICE" ] && continue
  rm -rf -- "$vieille"
done
echo "→ $(ls -1d */ 2>/dev/null | wc -l) versions gardées"
