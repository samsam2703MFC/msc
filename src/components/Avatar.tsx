/* L'avatar d'un athlète. Pas de photo — le pipeline photo n'existe pas encore,
   et un avatar ne doit pas attendre après lui. Des initiales sur une pastille,
   dont la teinte est tirée du nom : le même athlète a toujours la même, deux
   athlètes en ont presque toujours de différentes, et rien n'est stocké.

   La palette n'a qu'UNE couleur d'action (l'émeraude) : un arc-en-ciel de
   pastilles la trahirait. On puise donc dans un petit jeu de teintes déjà
   présentes dans les jetons — profondes, lisibles en blanc — assignées de
   façon stable plutôt qu'inventées. */
import { C, F, R } from '../design/theme';
import { AvatarNiveau } from './AvatarNiveau';

const TEINTES = [C.teal, C.accentDeep, C.warning, C.negative, C.ink] as const;

function initiales(nom: string): string {
  const mots = nom.trim().split(/\s+/).filter(Boolean);
  if (mots.length === 0) return '?';
  if (mots.length === 1) return mots[0].slice(0, 2).toUpperCase();
  return (mots[0][0] + mots[mots.length - 1][0]).toUpperCase();
}

/* Un hachage stable du nom → un index. djb2, sans dépendance : le but n'est pas
   la cryptographie, c'est que « Sam » tombe toujours sur la même teinte. */
export function teinteDe(nom: string): string {
  let h = 5381;
  for (let i = 0; i < nom.length; i += 1) h = ((h << 5) + h + nom.charCodeAt(i)) >>> 0;
  return TEINTES[h % TEINTES.length];
}

/* Avec un palier, l'avatar devient la tête transformée (AvatarNiveau), les
   initiales en badge ; sans, la pastille d'initiales. */
export function Avatar({ nom, taille = 38, onClick, sousTitre, palier }: {
  nom: string; taille?: number; onClick?: () => void; sousTitre?: string | null; palier?: number | null;
}) {
  const pastille = palier ? (
    <AvatarNiveau nom={nom} palier={palier} taille={taille} teinte={teinteDe(nom)} />
  ) : (
    <div
      role={onClick ? undefined : 'img'}
      aria-label={onClick ? undefined : nom}
      title={nom}
      style={{
        width: taille,
        height: taille,
        borderRadius: R.full,
        background: teinteDe(nom),
        color: '#FFFFFF',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: F.display,
        fontWeight: 600,
        fontSize: Math.round(taille * 0.4),
        lineHeight: 1,
        letterSpacing: '0.01em',
        flexShrink: 0,
        userSelect: 'none',
      }}
    >
      {initiales(nom)}
    </div>
  );
  if (!onClick && !sousTitre) return pastille;
  /* Sous l'avatar : le surnom, et rien d'autre. */
  const bloc = (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
      {pastille}
      {sousTitre && (
        <span style={{ fontSize: 10, fontWeight: 600, color: C.inkSecondary, lineHeight: 1, maxWidth: taille + 24, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {sousTitre}
        </span>
      )}
    </div>
  );
  if (!onClick) return bloc;
  return (
    <button type="button" onClick={onClick} aria-label={nom} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
      {bloc}
    </button>
  );
}
