/* Manage the Strava push subscription.

   Separate from `npm run server` on purpose: creating a subscription makes
   Strava call the callback URL back, synchronously, from the internet — which
   a laptop running `npm run dev` is not on. So this is a thing you run once,
   pointed at a deployment or a tunnel, rather than something that happens at
   startup and fails every morning.

       npm run strava:webhook -- etat
       npm run strava:webhook -- abonner https://exemple.tld/api/strava/webhook
       npm run strava:webhook -- desabonner 123456

   Strava allows one subscription per application, so `abonner` on an
   application that already has one is an error, not a second subscription. */

import { abonnements, abonner, config, configure, desabonner } from '../server/strava.mjs';

const USAGE = `usage :
  npm run strava:webhook -- etat
  npm run strava:webhook -- abonner <url-de-callback-publique>
  npm run strava:webhook -- desabonner <id>`;

function sortir(message, code = 1) {
  console.error(message);
  process.exit(code);
}

const [commande, argument] = process.argv.slice(2);

if (!configure()) {
  sortir('STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET non définis. Voir .env.example.');
}
if (!config().verifyToken && commande === 'abonner') {
  sortir('STRAVA_VERIFY_TOKEN non défini : Strava ne pourrait pas valider le callback.');
}

try {
  if (commande === 'etat') {
    const liste = await abonnements();
    if (liste.length === 0) {
      console.log('Aucun abonnement. Les activités ne remonteront que sur synchro manuelle.');
    } else {
      for (const a of liste) {
        console.log(`#${a.id}  ${a.callback_url}  créé le ${a.created_at}`);
      }
    }
  } else if (commande === 'abonner') {
    if (!argument) sortir(USAGE);
    if (!argument.startsWith('https://')) {
      sortir('Strava exige un callback en HTTPS, joignable depuis internet.');
    }
    const a = await abonner(argument);
    console.log(`Abonnement #${a.id} créé sur ${argument}.`);
  } else if (commande === 'desabonner') {
    if (!argument) sortir(USAGE);
    await desabonner(argument);
    console.log(`Abonnement #${argument} supprimé.`);
  } else {
    sortir(USAGE);
  }
} catch (e) {
  sortir(`Échec : ${e.message}`);
}
