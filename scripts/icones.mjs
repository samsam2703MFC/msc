/* Les icônes de l'application, générées depuis une seule source.

   Le dessin est la jauge de forme — l'arc émeraude → bleu, l'aiguille blanche —
   sur le bleu marine du thème. Il est écrit ici en SVG et rendu en PNG par le
   Chromium de Playwright, aux tailles que chaque plate-forme réclame :

     icon.svg                    le favicon vectoriel, coins arrondis
     icon-192.png, icon-512.png  le manifeste, purpose « any » : coins arrondis,
                                 transparents — l'icône telle quelle
     icon-maskable-*.png         purpose « maskable » : Android découpe lui-même
                                 (cercle, goutte, carré arrondi) dans une image
                                 pleine ; le dessin tient dans la zone sûre, le
                                 cercle central de 80 %
     apple-touch-icon.png        180 px, plein — iOS arrondit lui-même
     favicon-32.png, -64.png     l'onglet du navigateur

   Sans ça, Android range l'icône dans un disque blanc avec un carré rétréci au
   milieu, et le raccourci d'un site en HTTP prend une lettre. `npm run icones`
   les refait toutes ; ne pas retoucher les PNG à la main. */

import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const MARINE = '#0A1C33';
const EMERAUDE = '#02C9A0';
const BLEU = '#029CD0';

/* La jauge, dans un carré de 512 : un arc de 270° ouvert vers le bas, et une
   aiguille qui pointe en haut à droite — « ça monte ». */
function jauge() {
  return `
    <defs>
      <linearGradient id="arc" x1="0" y1="1" x2="1" y2="0">
        <stop offset="0" stop-color="${EMERAUDE}"/>
        <stop offset="1" stop-color="${BLEU}"/>
      </linearGradient>
    </defs>
    <path d="M 150 384 A 176 176 0 1 1 362 384" fill="none" stroke="url(#arc)" stroke-width="54" stroke-linecap="round"/>
    <line x1="256" y1="288" x2="356" y2="200" stroke="#FFFFFF" stroke-width="30" stroke-linecap="round"/>
    <circle cx="256" cy="288" r="30" fill="#FFFFFF"/>`;
}

/**
 * @param plein   vrai : le fond couvre tout le carré (maskable, Apple) ; faux :
 *                un carré arrondi, coins transparents
 * @param echelle la part du carré que le dessin occupe — 0.72 pour tenir dans
 *                la zone sûre d'une icône maskable
 */
function svg({ plein, echelle }) {
  const fond = plein
    ? `<rect width="512" height="512" fill="${MARINE}"/>`
    : `<rect width="512" height="512" rx="112" fill="${MARINE}"/>`;
  const decalage = (512 - 512 * echelle) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  ${fond}
  <g transform="translate(${decalage} ${decalage}) scale(${echelle})">${jauge()}
  </g>
</svg>`;
}

const SORTIES = [
  { fichier: 'icon-192.png', taille: 192, plein: false, echelle: 0.9 },
  { fichier: 'icon-512.png', taille: 512, plein: false, echelle: 0.9 },
  { fichier: 'icon-maskable-192.png', taille: 192, plein: true, echelle: 0.72 },
  { fichier: 'icon-maskable-512.png', taille: 512, plein: true, echelle: 0.72 },
  { fichier: 'apple-touch-icon.png', taille: 180, plein: true, echelle: 0.86 },
  { fichier: 'favicon-64.png', taille: 64, plein: false, echelle: 0.96 },
  { fichier: 'favicon-32.png', taille: 32, plein: false, echelle: 0.96 },
];

await mkdir('public', { recursive: true });
await writeFile('public/icon.svg', `${svg({ plein: false, echelle: 0.9 })}\n`);
console.log('+ public/icon.svg');

const navigateur = await chromium.launch(
  process.env.MSC_CHROMIUM ? { executablePath: process.env.MSC_CHROMIUM, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] },
);
try {
  for (const s of SORTIES) {
    const page = await navigateur.newPage({ viewport: { width: s.taille, height: s.taille }, deviceScaleFactor: 1 });
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:transparent">${svg({ plein: s.plein, echelle: s.echelle })
        .replace('width="512" height="512"', `width="${s.taille}" height="${s.taille}"`)}</body></html>`,
    );
    const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: s.taille, height: s.taille } });
    await writeFile(`public/${s.fichier}`, png);
    console.log(`+ public/${s.fichier} (${s.taille} px, ${png.length} o)`);
    await page.close();
  }
} finally {
  await navigateur.close();
}
