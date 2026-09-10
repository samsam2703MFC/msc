/* Un réglage posé depuis le serveur, sans passer par l'écran.

     npm run param                         liste les réglages et d'où ils viennent
     npm run param -- anthropic.cle        demande la valeur au clavier (sans l'afficher)
                                           et la range — scellée si c'est un secret
     npm run param -- coach.modele claude-opus-5
                                           une valeur en clair sur la ligne de commande
     npm run param -- anthropic.cle --effacer
                                           efface : retour à l'environnement, puis au défaut

   C'est la même écriture que celle de Créer → Réglages : un secret est scellé
   avec MSC_SECRET_KEY avant d'entrer en base, et une valeur en clair pour un
   secret n'existe pas — d'où pas de requête SQL à taper. La valeur d'un secret
   se saisit au clavier plutôt que sur la ligne de commande, pour ne pas rester
   dans l'historique du shell. */

import { createInterface } from 'node:readline';
import { fermer } from '../server/bd.mjs';
import { ParamError, ecrire, tous } from '../server/params.mjs';

const [cle, ...reste] = process.argv.slice(2);

function lireCache(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    process.stderr.write(question);
    /* Sans écho : readline réécrit la ligne à chaque touche, on lui donne du vide. */
    rl._writeToOutput = () => {};
    rl.question('', (reponse) => { process.stderr.write('\n'); rl.close(); resolve(reponse); });
  });
}

try {
  if (!cle) {
    for (const p of await tous()) {
      const valeur = p.type === 'secret' ? (p.renseigne ? `renseignée ${p.apercu ?? ''}${p.illisible ? ' — ILLISIBLE (scellée avec une autre MSC_SECRET_KEY)' : ''}` : 'absente') : String(p.valeur ?? '—');
      console.log(`${p.cle.padEnd(26)} ${valeur.padEnd(32)} ${p.source}${p.unite ? ` · ${p.unite}` : ''}`);
    }
  } else if (reste.includes('--effacer')) {
    await ecrire(cle, null);
    console.log(`${cle} : effacée (retour à l'environnement, puis au défaut).`);
  } else {
    const def = (await tous()).find((p) => p.cle === cle);
    if (!def) throw new ParamError(`paramètre inconnu : ${cle}`, 404);
    let valeur = reste.find((r) => !r.startsWith('--'));
    if (valeur === undefined) {
      valeur = process.stdin.isTTY
        ? await lireCache(`${def.libelle.fr} — valeur${def.type === 'secret' ? ' (invisible)' : ''} : `)
        : (await new Promise((r) => { let s = ''; process.stdin.on('data', (d) => { s += d; }); process.stdin.on('end', () => r(s)); })).trim();
    }
    if (!valeur) throw new ParamError('valeur vide — pour effacer, ajoute --effacer');
    const p = await ecrire(cle, valeur);
    console.log(
      p.type === 'secret'
        ? `${cle} : renseignée ${p.apercu ?? ''} (scellée), source ${p.source}.`
        : `${cle} = ${p.valeur}, source ${p.source}.`,
    );
  }
} catch (e) {
  console.error(e instanceof ParamError ? e.message : (e?.message ?? e));
  process.exitCode = 1;
} finally {
  await fermer();
}
