/* Les partenaires du club.

   Un sponsor local — le magasin de sport du coin, la boulangerie du dimanche
   — met un lot en jeu : dix gels, une paire de chaussettes, un massage. Les
   athlètes participent en s'entraînant : l'offre peut demander d'avoir fait
   une part de ses séances de la semaine, et c'est le plan qui le dit, pas une
   case à cocher. L'admin tire au sort, le gagnant le voit dans son
   application, et tout le monde voit le bon d'achat — un code, et le lien
   vers la boutique.

   Ce qui se compte, parce que c'est ce qui se vend à un sponsor : les vues de
   son offre, les participations, les gagnants, et les clics vers sa boutique
   avec le code. Rien de plus — pas d'achat dans l'application : l'achat se
   fait chez lui, avec son code, et c'est lui qui le voit passer.

   Une vue se compte une fois par athlète et par jour ; un clic, chaque fois —
   quelqu'un qui revient sur la boutique est quelqu'un qui revient. */

import { bd, ligne, lignes } from './bd.mjs';

export class SponsorError extends Error {
  constructor(message, code = 400) {
    super(message);
    this.code = code;
  }
}

const texte = (v, max) => String(v ?? '').trim().slice(0, max);
const dateIso = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '')) ? String(v) : null);
const entier = (v, min, max, defaut) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return defaut;
  return Math.max(min, Math.min(max, Math.round(n)));
};

const formeSponsor = (s) => ({
  id: s.id, nom: s.nom, ville: s.ville ?? null, url: s.url ?? null, actif: Boolean(s.actif), cree_le: s.cree_le,
});

const formeOffre = (o) => ({
  id: o.id,
  sponsor_id: o.sponsor_id,
  titre: o.titre,
  lot: o.lot ?? null,
  voucher: o.voucher ?? null,
  regle_pct: Number(o.regle_pct ?? 0),
  debut: o.debut,
  fin: o.fin,
  tirage_le: o.tirage_le ?? null,
  gagnant: o.gagnant_id
    ? { id: o.gagnant_id, nom: [o.gagnant_prenom, o.gagnant_nom].filter(Boolean).join(' ') || o.gagnant_nom }
    : null,
  participations: Number(o.participations ?? 0),
});

/* ------------------------------------------------------- le back office */

export async function partenaires() {
  const [sponsors, offres] = await Promise.all([
    lignes('SELECT id, nom, ville, url, actif, cree_le FROM msc_sponsor ORDER BY actif DESC, nom'),
    lignes(
      `SELECT o.*, a.nom AS gagnant_nom, a.prenom AS gagnant_prenom,
              (SELECT COUNT(*) FROM msc_participation p WHERE p.offre_id = o.id) AS participations
       FROM msc_offre o LEFT JOIN msc_athlete a ON a.id = o.gagnant_id
       ORDER BY o.debut DESC, o.id DESC`,
    ),
  ]);
  return {
    sponsors: sponsors.map((s) => ({
      ...formeSponsor(s),
      offres: offres.filter((o) => o.sponsor_id === s.id).map(formeOffre),
    })),
  };
}

export async function ecrireSponsor(corps = {}) {
  const nom = texte(corps.nom, 80);
  if (!nom) throw new SponsorError('Un sponsor a un nom.');
  const ville = texte(corps.ville, 80) || null;
  const url = texte(corps.url, 255) || null;
  if (url && !/^https?:\/\/\S+$/i.test(url)) throw new SponsorError('L’adresse de la boutique commence par http:// ou https://.');
  const actif = corps.actif === undefined ? 1 : (corps.actif ? 1 : 0);
  if (corps.id) {
    const [r] = await bd().execute(
      'UPDATE msc_sponsor SET nom = ?, ville = ?, url = ?, actif = ? WHERE id = ?',
      [nom, ville, url, actif, Number(corps.id)],
    );
    if (r.affectedRows === 0 && !(await ligne('SELECT id FROM msc_sponsor WHERE id = :id', { id: Number(corps.id) }))) {
      throw new SponsorError(`Aucun sponsor ${corps.id}.`, 404);
    }
    return formeSponsor(await ligne('SELECT * FROM msc_sponsor WHERE id = :id', { id: Number(corps.id) }));
  }
  const [r] = await bd().execute(
    'INSERT INTO msc_sponsor (nom, ville, url, actif) VALUES (?, ?, ?, ?)',
    [nom, ville, url, actif],
  );
  return formeSponsor(await ligne('SELECT * FROM msc_sponsor WHERE id = :id', { id: r.insertId }));
}

export async function ecrireOffre(corps = {}) {
  const sponsor = await ligne('SELECT id FROM msc_sponsor WHERE id = :id', { id: Number(corps.sponsor_id) });
  if (!sponsor) throw new SponsorError(`Aucun sponsor ${corps.sponsor_id}.`, 404);
  const titre = texte(corps.titre, 120);
  if (!titre) throw new SponsorError('Une offre a un titre.');
  const lot = texte(corps.lot, 120) || null;
  const voucher = texte(corps.voucher, 40) || null;
  const regle = entier(corps.regle_pct, 0, 100, 0);
  const debut = dateIso(corps.debut) ?? new Date().toISOString().slice(0, 10);
  const fin = dateIso(corps.fin);
  if (!fin) throw new SponsorError('Une offre a une date de fin (AAAA-MM-JJ).');
  if (fin < debut) throw new SponsorError('La fin de l’offre est avant son début.');
  if (corps.id) {
    const [r] = await bd().execute(
      `UPDATE msc_offre SET sponsor_id = ?, titre = ?, lot = ?, voucher = ?, regle_pct = ?, debut = ?, fin = ?
       WHERE id = ?`,
      [sponsor.id, titre, lot, voucher, regle, debut, fin, Number(corps.id)],
    );
    if (r.affectedRows === 0 && !(await ligne('SELECT id FROM msc_offre WHERE id = :id', { id: Number(corps.id) }))) {
      throw new SponsorError(`Aucune offre ${corps.id}.`, 404);
    }
    return formeOffre(await uneOffre(Number(corps.id)));
  }
  const [r] = await bd().execute(
    `INSERT INTO msc_offre (sponsor_id, titre, lot, voucher, regle_pct, debut, fin)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [sponsor.id, titre, lot, voucher, regle, debut, fin],
  );
  return formeOffre(await uneOffre(r.insertId));
}

async function uneOffre(id) {
  return ligne(
    `SELECT o.*, a.nom AS gagnant_nom, a.prenom AS gagnant_prenom,
            (SELECT COUNT(*) FROM msc_participation p WHERE p.offre_id = o.id) AS participations
     FROM msc_offre o LEFT JOIN msc_athlete a ON a.id = o.gagnant_id WHERE o.id = :id`,
    { id },
  );
}

/** Le tirage : un participant au hasard, une fois. */
export async function tirer(offreId) {
  const o = await uneOffre(Number(offreId));
  if (!o) throw new SponsorError(`Aucune offre ${offreId}.`, 404);
  if (o.tirage_le) throw new SponsorError('Le tirage a déjà eu lieu.', 409);
  const participants = await lignes(
    `SELECT p.athlete_id, a.nom, a.prenom FROM msc_participation p JOIN msc_athlete a ON a.id = p.athlete_id
     WHERE p.offre_id = :o`,
    { o: o.id },
  );
  if (participants.length === 0) throw new SponsorError('Personne n’a participé : rien à tirer.');
  const gagnant = participants[Math.floor(Math.random() * participants.length)];
  await bd().execute('UPDATE msc_offre SET gagnant_id = ?, tirage_le = NOW(3) WHERE id = ?', [gagnant.athlete_id, o.id]);
  return {
    offre: formeOffre(await uneOffre(o.id)),
    gagnant: { id: gagnant.athlete_id, nom: gagnant.nom, prenom: gagnant.prenom ?? null },
    participants: participants.length,
  };
}

/**
 * Ce qui se vend à un sponsor, et ce que chaque athlète en fait. Deux tables :
 * par sponsor — offres, vues, participations, gagnants, clics — et par
 * athlète — participations, lots gagnés, clics vers les boutiques, le dernier.
 */
export async function analyse() {
  const [sponsors, athletes] = await Promise.all([
    lignes(
      `SELECT s.id, s.nom, s.ville, s.actif,
              (SELECT COUNT(*) FROM msc_offre o WHERE o.sponsor_id = s.id) AS offres,
              (SELECT COUNT(*) FROM msc_sponsor_evenement e WHERE e.sponsor_id = s.id AND e.type = 'vue') AS vues,
              (SELECT COUNT(*) FROM msc_participation p JOIN msc_offre o2 ON o2.id = p.offre_id WHERE o2.sponsor_id = s.id) AS participations,
              (SELECT COUNT(*) FROM msc_offre o3 WHERE o3.sponsor_id = s.id AND o3.gagnant_id IS NOT NULL) AS gagnants,
              (SELECT COUNT(*) FROM msc_sponsor_evenement e WHERE e.sponsor_id = s.id AND e.type = 'clic') AS clics
       FROM msc_sponsor s ORDER BY clics DESC, participations DESC, s.nom`,
    ),
    lignes(
      `SELECT a.id, a.nom, a.prenom,
              (SELECT COUNT(*) FROM msc_participation p WHERE p.athlete_id = a.id) AS participations,
              (SELECT COUNT(*) FROM msc_offre o WHERE o.gagnant_id = a.id) AS gagnes,
              (SELECT COUNT(*) FROM msc_sponsor_evenement e WHERE e.athlete_id = a.id AND e.type = 'clic') AS clics,
              (SELECT MAX(e.date) FROM msc_sponsor_evenement e WHERE e.athlete_id = a.id AND e.type = 'clic') AS dernier_clic
       FROM msc_athlete a ORDER BY clics DESC, participations DESC, a.nom`,
    ),
  ]);
  return {
    sponsors: sponsors.map((s) => ({
      id: s.id, nom: s.nom, ville: s.ville ?? null, actif: Boolean(s.actif),
      offres: Number(s.offres), vues: Number(s.vues), participations: Number(s.participations),
      gagnants: Number(s.gagnants), clics: Number(s.clics),
    })),
    athletes: athletes.map((a) => ({
      id: a.id, nom: a.nom, prenom: a.prenom ?? null,
      participations: Number(a.participations), gagnes: Number(a.gagnes), clics: Number(a.clics),
      dernier_clic: a.dernier_clic ?? null,
    })),
  };
}

/* ------------------------------------------------------------ l'athlète */

/* Sa semaine, telle que le plan la compte : les séances prévues et celles
   faites — une activité appariée ou sa coche. La même règle que l'aperçu du
   coach, pour que « 80 % » veuille dire la même chose des deux côtés. */
async function semaineDe(athleteId) {
  const plan = await ligne('SELECT id FROM msc_plan WHERE athlete_id = :a AND actif = 1 LIMIT 1', { a: athleteId });
  if (!plan) return { prevues: 0, faites: 0, part: 0 };
  const derniere = await ligne(
    `SELECT semaine FROM msc_session WHERE plan_id = :p AND date <= CURDATE()
     ORDER BY date DESC, ordre DESC LIMIT 1`,
    { p: plan.id },
  );
  if (!derniere) return { prevues: 0, faites: 0, part: 0 };
  const [prevu, faites] = await Promise.all([
    ligne(
      `SELECT COUNT(*) AS n FROM msc_session WHERE plan_id = :p AND semaine = :s AND discipline <> 'Repos'`,
      { p: plan.id, s: derniere.semaine },
    ),
    ligne(
      `SELECT COUNT(*) AS n FROM msc_session s
       WHERE s.plan_id = :p AND s.semaine = :s AND s.discipline <> 'Repos'
         AND (EXISTS (SELECT 1 FROM msc_activity a WHERE a.session_id = s.id)
           OR EXISTS (SELECT 1 FROM msc_journal j WHERE j.session_id = s.id AND j.fait = 1))`,
      { p: plan.id, s: derniere.semaine },
    ),
  ]);
  const prevues = Number(prevu?.n ?? 0);
  const n = Number(faites?.n ?? 0);
  return { prevues, faites: n, part: prevues ? Math.round((n / prevues) * 100) : 0 };
}

/** Les offres en cours, vues de cet athlète : ce qu'il peut faire de chacune. */
export async function pourAthlete(athleteId) {
  const [offres, semaine] = await Promise.all([
    lignes(
      `SELECT o.*, s.nom AS sponsor_nom, s.ville AS sponsor_ville, s.url AS sponsor_url,
              EXISTS (SELECT 1 FROM msc_participation p WHERE p.offre_id = o.id AND p.athlete_id = :a) AS participe
       FROM msc_offre o JOIN msc_sponsor s ON s.id = o.sponsor_id
       WHERE s.actif = 1 AND CURDATE() BETWEEN o.debut AND o.fin
       ORDER BY o.fin, o.id`,
      { a: athleteId },
    ),
    semaineDe(athleteId),
  ]);
  return {
    semaine,
    offres: offres.map((o) => ({
      id: o.id,
      sponsor: { id: o.sponsor_id, nom: o.sponsor_nom, ville: o.sponsor_ville ?? null, url: o.sponsor_url ?? null },
      titre: o.titre,
      lot: o.lot ?? null,
      voucher: o.voucher ?? null,
      regle_pct: Number(o.regle_pct ?? 0),
      debut: o.debut,
      fin: o.fin,
      participe: Boolean(Number(o.participe)),
      tire: Boolean(o.tirage_le),
      gagnant: o.gagnant_id === athleteId,
      eligible: Number(o.regle_pct ?? 0) === 0 || semaine.part >= Number(o.regle_pct),
    })),
  };
}

export async function participer(athleteId, offreId) {
  const { offres } = await pourAthlete(athleteId);
  const o = offres.find((x) => x.id === Number(offreId));
  if (!o) throw new SponsorError('Cette offre n’est plus en cours.', 404);
  if (o.tire) throw new SponsorError('Le tirage a déjà eu lieu.', 409);
  if (!o.eligible) throw new SponsorError(`Il faut avoir fait ${o.regle_pct} % de ses séances de la semaine pour participer.`, 403);
  await bd().execute('INSERT IGNORE INTO msc_participation (offre_id, athlete_id) VALUES (?, ?)', [o.id, athleteId]);
  return { ok: true };
}

/** Une vue (une par athlète, par offre et par jour) ou un clic vers la boutique. */
export async function noter(athleteId, corps = {}) {
  const type = corps.type === 'clic' ? 'clic' : corps.type === 'vue' ? 'vue' : null;
  if (!type) throw new SponsorError('Type attendu : vue ou clic.');
  const sponsor = await ligne('SELECT id FROM msc_sponsor WHERE id = :id', { id: Number(corps.sponsor_id) });
  if (!sponsor) throw new SponsorError(`Aucun sponsor ${corps.sponsor_id}.`, 404);
  const offreId = corps.offre_id ? Number(corps.offre_id) : null;
  if (type === 'vue') {
    const deja = await ligne(
      `SELECT id FROM msc_sponsor_evenement
       WHERE athlete_id = :a AND sponsor_id = :s AND offre_id <=> :o AND type = 'vue' AND DATE(date) = CURDATE()
       LIMIT 1`,
      { a: athleteId, s: sponsor.id, o: offreId },
    );
    if (deja) return { ok: true, deja: true };
  }
  await bd().execute(
    'INSERT INTO msc_sponsor_evenement (sponsor_id, offre_id, athlete_id, type) VALUES (?, ?, ?, ?)',
    [sponsor.id, offreId, athleteId, type],
  );
  return { ok: true };
}
