/* Où vit l'application, et donc où vit son API.
 *
 * Vite pose `import.meta.env.BASE_URL` à la valeur de `base` : « / » quand
 * l'application est servie à la racine d'un domaine, « /msc/ » quand elle est
 * publiée sous un chemin. Le relais devant le serveur retire ce préfixe avant
 * de passer la requête, si bien que le serveur Node continue de ne connaître
 * que « /api/… » et n'a rien à savoir de l'endroit où il est monté.
 *
 * Six constantes portaient « /api » en dur, chacune dans son fichier. Une
 * seule le compose maintenant : déplacer l'application ne se fait plus à six
 * endroits, dont on en oublie un.
 *
 * Le repli sur « / » n'est pas de la prudence décorative : les contrôles
 * empaquettent ces modules avec esbuild pour Node, où `import.meta.env`
 * n'existe pas — Vite le fabrique, esbuild ne le fabrique pas. Sans repli,
 * `check:strava` meurt à l'import sur « Cannot read properties of undefined ».
 */
const BASE = import.meta.env?.BASE_URL ?? '/';

export const RACINE_API = `${BASE}api`.replace(/\/{2,}/g, '/');
