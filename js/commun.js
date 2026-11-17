// Fonctions partagées par la page étudiant et la page responsable.
'use strict';

const DEMIS = ['matin', 'apres_midi'];
const NOM_DEMI = { matin: 'Matin', apres_midi: 'Après-midi' };
const NOM_TYPE = { sr: 'Speed recruiting', pres: 'Présentation' };
// Étudiants externes (autre école) : année fictive dont la règle est forum.regles.EXTERNE (même code que l'API).
const PARCOURS_EXTERNE = 'EXTERNE';

/** Appel de l'API PHP. Lève une Error avec le message du serveur en cas de refus. */
async function api(action, donnees = null, params = {}) {
  const url = new URL((window.FORUM_RACINE || '') + 'api/api.php', location.href);
  url.searchParams.set('action', action);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const opts = { credentials: 'same-origin', cache: 'no-store' };
  if (donnees !== null) {
    opts.method = 'POST';
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(donnees);
  }
  let rep;
  try {
    rep = await fetch(url, opts);
  } catch (e) {
    throw new Error('Serveur injoignable. Vérifiez votre connexion.');
  }
  let json;
  try { json = await rep.json(); } catch (e) { throw new Error(`Réponse invalide du serveur (${rep.status}).`); }
  if (!json.ok) { const err = new Error(json.erreur || 'Erreur'); err.status = rep.status; throw err; }
  return json;
}

/** Charge la configuration (forum, entreprises, étudiants, groupes), stockée en base. */
async function chargerConfig() {
  const j = await api('config');
  const cfg = { forum: j.forum, entreprises: j.entreprises, etudiants: j.etudiants, groupes: j.groupes, plan: j.plan || { etages: [], salles: [], reperes: [] }, version: j.version };
  // les externes rejoignent la liste des étudiants (sans adresse : le serveur ne la donne jamais ici)
  const internes = new Set(cfg.etudiants.map((e) => e.nom));
  cfg.etudiants = [...cfg.etudiants, ...(j.externes || []).filter((x) => !internes.has(x.nom))
    .map((x) => ({ nom: x.nom, parcours: PARCOURS_EXTERNE, groupe: '', ecole: x.ecole, externe: true }))];
  cfg.entParId = new Map(cfg.entreprises.map((e) => [e.id, e]));
  cfg.etuParNom = new Map(cfg.etudiants.map((e) => [e.nom, e]));
  cfg.grpParNom = new Map(cfg.groupes.map((g) => [g.nom, g]));
  return cfg;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nomEnt = (e) => (e ? (e.court || e.nom) : '(entreprise retirée)');
const tri = (a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' });

function libCreneau(cfg, demi, n) {
  return cfg.forum.creneaux[demi][n - 1] || `créneau ${n}`;
}

/** Nom d'une table : celui choisi par le responsable, sinon « table 2 ». */
const nomTable = (e, t) => e?.noms_tables?.[t]?.trim() || `table ${t}`;

/** Entreprises ayant au moins une table pour ce type et cette demi-journée, triées par nom. */
function entreprisesDe(cfg, type, demi) {
  return cfg.entreprises.filter((e) => (e[type]?.[demi] || 0) > 0).sort((a, b) => tri(nomEnt(a), nomEnt(b)));
}

function estBloque(ent, demi, n, type) {
  // Présentations : liste propre « bloques_pres » si elle existe, sinon la liste commune « bloques ».
  const liste = type === 'pres' && ent.bloques_pres ? ent.bloques_pres : ent.bloques;
  return (liste?.[demi] || []).includes(n);
}

function regle(cfg, type, participant) {
  // Présentation : le participant est un groupe, ou un étudiant inscrit seul.
  const p = (type === 'pres' && cfg.grpParNom.get(participant) || cfg.etuParNom.get(participant))?.parcours;
  return cfg.forum.regles[p] || null;
}

/** Année BUT à afficher : « BUT2 », ou « Externe · École » pour un étudiant d'une autre école. */
const libParcours = (e) => (e?.externe ? `Externe · ${e.ecole}` : e?.parcours || '');

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(String(iso).replace(' ', 'T'));
  return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function notifier(texte, genre = 'info') {
  let zone = document.getElementById('notifs');
  if (!zone) { zone = document.createElement('div'); zone.id = 'notifs'; document.body.append(zone); }
  const n = document.createElement('div');
  n.className = `notif ${genre === 'erreur' ? 's-probleme' : genre === 'ok' ? 's-valide' : 's-conseil'}`;
  n.setAttribute('role', 'status');
  n.textContent = texte;
  zone.append(n);
  setTimeout(() => n.remove(), genre === 'erreur' ? 7000 : 4000);
}

/**
 * Fenêtre modale (remplace alert/confirm). Renvoie une promesse résolue avec la valeur
 * du bouton cliqué (null si fermée) et l'élément de la modale pour lire les champs.
 */
function modale(titre, contenuHtml, boutons = [{ texte: 'OK', valeur: true }]) {
  return new Promise((resoudre) => {
    const voile = document.createElement('div');
    voile.className = 'voile';
    voile.innerHTML = `<div class="modale" role="dialog" aria-modal="true"><h3>${esc(titre)}</h3><div>${contenuHtml}</div><div class="boutons"></div></div>`;
    const boite = voile.querySelector('.modale');
    const fermer = (v) => { document.removeEventListener('keydown', clavier); voile.remove(); resoudre({ valeur: v, boite }); };
    const clavier = (ev) => { if (ev.key === 'Escape') fermer(null); };
    for (const b of boutons) {
      const el = document.createElement('button');
      el.textContent = b.texte;
      el.className = b.classe || '';
      el.addEventListener('click', () => fermer(b.valeur));
      boite.querySelector('.boutons').append(el);
    }
    voile.addEventListener('click', (ev) => { if (ev.target === voile) fermer(null); });
    document.addEventListener('keydown', clavier);
    document.body.append(voile);
    (boite.querySelector('input, select') || boite.querySelector('.boutons button:last-child'))?.focus();
  });
}

const confirmer = async (titre, html, texteOui = 'Confirmer') =>
  (await modale(titre, html, [{ texte: 'Annuler', valeur: false, classe: 'secondaire' }, { texte: texteOui, valeur: true }])).valeur === true;

/** Rafraîchissement périodique, suspendu quand l'onglet n'est pas visible. */
function rafraichirToutesLes(secondes, fn) {
  setInterval(() => { if (!document.hidden) fn(); }, Math.max(5, secondes) * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) fn(); });
}

/** Exécute fn (qui reconstruit une partie de la page) en gardant la position de lecture : défilement de la page et des tableaux. */
function conserverPosition(racine, fn) {
  const zones = () => [...racine.querySelectorAll('.tableau-defilant, .grille-conteneur')];
  const avant = zones().map((z) => [z.scrollLeft, z.scrollTop]);
  const x = window.scrollX;
  const y = window.scrollY;
  fn();
  zones().forEach((z, i) => { if (avant[i]) [z.scrollLeft, z.scrollTop] = avant[i]; });
  window.scrollTo(x, y);
}

/** Une liste déroulante ou un champ de cette zone est-il en cours d'utilisation ? (hors champ de recherche, conservé) */
const saisieEnCours = (racine) => { const a = document.activeElement; return !!a && racine.contains(a) && a.matches('select, input:not([type=search]), textarea'); };

/** Ouvre un fichier CSV (séparateur ;, BOM pour Excel) au téléchargement. */
function telechargerCsv(nomFichier, lignes) {
  const cell = (v) => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const txt = '﻿' + lignes.map((l) => l.map(cell).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([txt], { type: 'text/csv;charset=utf-8' }));
  a.download = nomFichier;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function enteteForum(cfg) {
  const f = cfg.forum;
  const date = f.date ? new Date(f.date + 'T12:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '';
  const limite = f.date_limite ? ` · Inscriptions jusqu'au ${new Date(f.date_limite).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' })}` : '';
  document.querySelector('header.bandeau h1').textContent = f.nom;
  document.querySelector('header.bandeau .info').textContent = `${date}${limite} · Responsable : ${f.responsable}`;
  document.title = f.nom;
}

// ------------------------------------------------------------------ logos et plans
const urlImage = (cle, version) => `${window.FORUM_RACINE || ''}api/api.php?action=image&cle=${encodeURIComponent(cle)}&v=${encodeURIComponent(version)}`;

/** Adresse du logo : stocké en base (« base:<version> ») ou fichier du site (« logos/image001.png »). */
function urlLogo(e) {
  if (!e?.logo) return '';
  return e.logo.startsWith('base:') ? urlImage(`logo_${e.id}`, e.logo.slice(5)) : `${window.FORUM_RACINE || ''}affichage/${e.logo}`;
}

/** Couleur de la salle de ce nom, si elle est dessinée sur un plan. */
const couleurSalle = (plan, nom) => (plan.salles || []).find((s) => s.nom === nom)?.couleur || '';
const pastilleSalle = (plan, nom) => { const c = couleurSalle(plan, nom); return c ? `<i class="pastille" style="background:${esc(c)}"></i>` : ''; };

const polygonesSalles = (salles) => salles.map((s) => `<polygon points="${s.points.map((p) => p.join(',')).join(' ')}" fill="${esc(s.couleur)}" fill-opacity=".42" stroke="${esc(s.couleur)}" stroke-width="1.5" vector-effect="non-scaling-stroke"></polygon>`).join('');

/** Centre de gravité d'un polygone (pour y écrire le nom de la salle). */
function centrePolygone(points) {
  let a = 0; let x = 0; let y = 0;
  points.forEach(([x1, y1], i) => {
    const [x2, y2] = points[(i + 1) % points.length];
    const k = x1 * y2 - x2 * y1;
    a += k; x += (x1 + x2) * k; y += (y1 + y2) * k;
  });
  if (Math.abs(a) < 1e-6) return [points[0][0], points[0][1]];
  return [x / (3 * a), y / (3 * a)];
}

/** Le point est-il dans le polygone ? */
function dansPolygone(x, y, points) {
  let dedans = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i]; const [xj, yj] = points[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) dedans = !dedans;
  }
  return dedans;
}

function urlPlan(etage) {
  return etage.image?.startsWith('base:') ? urlImage(`plan_${etage.id}`, etage.image.slice(5)) : `${window.FORUM_RACINE || ''}affichage/plans/${etage.fichier || ''}`;
}

/**
 * Un repère vaut pour toute la journée et les deux activités, sauf s'il précise demi, type (activité) ou table.
 * Sa salle remplace, si elle est renseignée, la salle par défaut de l'entreprise.
 */
const repereActif = (r, demi, type) => (!demi || !r.demi || r.demi === demi) && (!type || !r.type || r.type === type);

/** Salle d'une entreprise pour un créneau donné : le repère le plus précis qui en indique une, sinon la salle par défaut. */
function salleDe(plan, e, demi, type, table) {
  let meilleur = null;
  let score = -1;
  for (const r of plan.reperes) {
    if (r.entreprise_id !== e.id || !r.salle || !repereActif(r, demi, type) || (r.table && table && r.table !== table)) continue;
    const s = (r.demi ? 1 : 0) + (r.type ? 1 : 0) + (r.table ? 1 : 0);
    if (s > score) { score = s; meilleur = r; }
  }
  return meilleur ? meilleur.salle : (e.salle || '');
}

/** Entreprise présente sur cette demi-journée (au moins une table) ? */
const presenteDemi = (e, demi) => ['sr', 'pres'].some((t) => (e[t]?.[demi] || 0) > 0);

/** Numéro de chaque entreprise placée et présente sur la demi-journée, par ordre alphabétique : il relie la liste au plan. */
function numerosReperes(plan, entreprises, demi) {
  const ids = new Set(plan.reperes.filter((r) => repereActif(r, demi)).map((r) => r.entreprise_id));
  const placees = entreprises.filter((e) => ids.has(e.id) && presenteDemi(e, demi)).sort((a, b) => tri(nomEnt(a), nomEnt(b)));
  return new Map(placees.map((e, i) => [e.id, i + 1]));
}

/** Liste alphabétique des entreprises : numéro du point, nom, et salle sur la couleur du plan. */
function htmlListeEntreprises(plan, entreprises, demi, numeros, avecEtage) {
  // Nom d'étage abrégé dans la liste : « Rez-de-chaussée » devient « RDC ».
  const nomEtage = (id) => {
    const n = plan.etages.find((x) => x.id === id)?.nom || '';
    return n.length > 11 ? n.split(/[\s-]+/).map((m) => m[0]).join('').toUpperCase() : n;
  };
  return entreprises.filter((e) => presenteDemi(e, demi)).map((e) => {
    const reps = plan.reperes.filter((r) => r.entreprise_id === e.id && repereActif(r, demi));
    const vus = new Set();
    const lieux = reps.map((r) => ({ salle: r.salle || e.salle || '', etage: r.etage, pr: reps.length > 1 ? precisionsRepere(r, false, e) : [] }))
      .filter((l) => { const k = `${l.salle}|${l.etage}|${l.pr.join()}`; if (vus.has(k)) return false; vus.add(k); return true; });
    if (!lieux.length && e.salle) lieux.push({ salle: e.salle, etage: '', pr: [] });
    if (!lieux.length) return '';
    return { n: nomEnt(e), html: `<div class="ligne-ent"><b class="repere-pt ${numeros.has(e.id) ? '' : 'sans'}">${numeros.get(e.id) ?? ''}</b><span class="ligne-nom">${esc(nomEnt(e))}</span><span class="ligne-lieux">${lieux.map((l) => {
      const c = couleurSalle(plan, l.salle);
      const txt = [l.salle || (l.etage && avecEtage ? '' : 'Salle à préciser'), avecEtage ? nomEtage(l.etage) : '', ...l.pr].filter(Boolean).join(' · ');
      return `<span class="ligne-lieu" ${c ? `style="background:${esc(c)}99;border-color:${esc(c)}"` : ''}>${esc(txt)}</span>`;
    }).join('')}</span></div>` };
  }).filter(Boolean).sort((a, b) => tri(a.n, b.n)).map((x) => x.html).join('');
}

/** Précisions d'un repère, en clair : matin, SR, table 2. */
function precisionsRepere(r, avecDemi = true, e = null) {
  return [avecDemi && r.demi ? NOM_DEMI[r.demi].toLowerCase() : '', r.type === 'sr' ? 'SR' : r.type === 'pres' ? 'prés.' : '', r.table ? nomTable(e, r.table) : ''].filter(Boolean);
}

/**
 * Plan d'un étage avec ses repères (coordonnées en % de l'image, indépendantes de la taille d'affichage).
 * options : edition, selection (indice du repère choisi), demi (ne montre que les repères de cette demi-journée).
 */
function htmlPlan(plan, entParId, etage, options = {}) {
  const { edition = false, selection = null, demi = '', numeros = null, salles: nomsVisibles = null } = options;
  const enPoints = plan.style_reperes !== 'logo';
  const reperes = plan.reperes.map((r, i) => ({ ...r, i })).filter((r) => r.etage === etage.id && repereActif(r, demi)).map((r) => {
    if (r.autre) {
      // autre table (accueil, café…) : une étiquette à son nom, sur tous les plans
      const t = (plan.autres || []).find((x) => x.id === r.autre);
      if (!t) return '';
      return `<div class="repere autre${selection === r.i ? ' choisi' : ''}" data-i="${r.i}" style="left:${Number(r.x)}%;top:${Number(r.y)}%" title="${esc(t.nom)}${r.salle ? ` — ${esc(r.salle)}` : ''}">
        <span>${esc(t.nom)}</span>${edition ? '<button type="button" class="repere-suppr" aria-label="Retirer ce repère">×</button>' : ''}</div>`;
    }
    const e = entParId.get(r.entreprise_id);
    if (!e) return '';
    if (numeros && !numeros.has(e.id)) return '';
    if (enPoints) {
      const salle = r.salle || e.salle;
      const pr = precisionsRepere(r, !demi, e);
      return `<div class="repere point${selection === r.i ? ' choisi' : ''}" data-i="${r.i}" style="left:${Number(r.x)}%;top:${Number(r.y)}%" title="${esc(e.nom)}${salle ? ` — ${esc(salle)}` : ''}${pr.length ? ` (${esc(pr.join(', '))})` : ''}">
        <b class="repere-pt">${numeros ? numeros.get(e.id) : ''}</b>${edition ? `<span class="repere-nom">${esc(nomEnt(e))}${pr.length ? ` <em>${esc(pr.join(' · '))}</em>` : ''}</span><button type="button" class="repere-suppr" aria-label="Retirer ce repère">×</button>` : ''}</div>`;
    }
    const logo = urlLogo(e);
    const salle = r.salle || e.salle;
    const tags = precisionsRepere(r, !demi, e);
    return `<div class="repere${selection === r.i ? ' choisi' : ''}" data-i="${r.i}" style="left:${Number(r.x)}%;top:${Number(r.y)}%" title="${esc(e.nom)}${salle ? ` — ${esc(salle)}` : ''}">
      ${logo ? `<img src="${esc(logo)}" alt="" draggable="false">` : ''}<span>${esc(nomEnt(e))}</span>${tags.length ? `<em>${esc(tags.join(' · '))}</em>` : ''}${edition ? '<button type="button" class="repere-suppr" aria-label="Retirer ce repère">×</button>' : ''}</div>`;
  }).join('');
  const salles = (plan.salles || []).filter((s) => s.etage === etage.id);
  // nomsVisibles : n'écrire que le nom de certaines salles (par exemple celle d'une entreprise sur un petit plan)
  const noms = plan.noms_salles === false ? '' : salles.filter((s) => !nomsVisibles || nomsVisibles.includes(s.nom)).map((s) => {
    // Position provisoire au centre de la salle ; placerNomsSalles() la déplace une fois le plan affiché.
    const [x, y] = centrePolygone(s.points);
    return `<div class="salle-nom" style="left:${x}%;top:${y}%" data-points="${esc(JSON.stringify(s.points))}">${esc(s.nom)}</div>`;
  }).join('');
  // Ordre : couleurs des salles, plan par-dessus (fusion « produit » : même un plan à fond blanc laisse voir les couleurs), puis noms et repères.
  return `<div class="plan-zone" data-etage="${esc(etage.id)}"><svg class="plan-salles" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${polygonesSalles(salles)}</svg><img class="plan-fond" src="${esc(urlPlan(etage))}" alt="Plan : ${esc(etage.nom)}" draggable="false">${noms}${reperes}</div>`;
}

/**
 * Place le nom de chaque salle là où il ne cache aucun repère ni un autre nom : on essaie des positions dans
 * la salle et on garde celle qui chevauche le moins, de préférence en haut et centrée. À appeler une fois le
 * plan affiché à sa taille (les mesures se font sur la page) ; sans effet sur un plan caché.
 */
function placerNomsSalles(racine = document) {
  const surface = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  racine.querySelectorAll('.plan-zone').forEach((zone) => {
    const Z = zone.getBoundingClientRect();
    if (!Z.width || !Z.height) return;
    const obstacles = [...zone.querySelectorAll('.repere, .repere-nom')].map((el) => el.getBoundingClientRect());
    zone.querySelectorAll('.salle-nom[data-points]').forEach((nom) => {
      let pts;
      try { pts = JSON.parse(nom.dataset.points); } catch (e) { return; }
      const L = nom.getBoundingClientRect();
      const lw = (L.width / Z.width) * 100;
      const lh = (L.height / Z.height) * 100;
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      const [cx0] = centrePolygone(pts);
      const N = 14;
      // positions dans la salle, puis, en dernier recours, juste autour (au-dessus, au-dessous, à côté)
      const candidats = [];
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
          const cx = x0 + ((x1 - x0) * (i + 0.5)) / N;
          const cy = y0 + ((y1 - y0) * (j + 0.5)) / N;
          if (dansPolygone(cx, cy, pts)) candidats.push([cx, cy, 0]);
        }
      }
      const ym = (y0 + y1) / 2;
      candidats.push([cx0, y0 - lh / 2 - 0.4, 6], [cx0, y1 + lh / 2 + 0.4, 6.5], [x0 - lw / 2 - 0.4, ym, 7], [x1 + lw / 2 + 0.4, ym, 7]);
      let meilleur = null;
      for (const [cx, cy, exterieur] of candidats) {
        if (cx - lw / 2 < 0 || cx + lw / 2 > 100 || cy - lh / 2 < 0 || cy + lh / 2 > 100) continue;   // reste dans le plan
        const coins = [[cx - lw / 2, cy - lh / 2], [cx + lw / 2, cy - lh / 2], [cx - lw / 2, cy + lh / 2], [cx + lw / 2, cy + lh / 2]];
        const dehors = coins.filter(([a, b]) => !dansPolygone(a, b, pts)).length;
        const r = { left: Z.left + ((cx - lw / 2) / 100) * Z.width, right: Z.left + ((cx + lw / 2) / 100) * Z.width, top: Z.top + ((cy - lh / 2) / 100) * Z.height, bottom: Z.top + ((cy + lh / 2) / 100) * Z.height };
        const recouvrement = obstacles.reduce((s, o) => s + surface(r, o), 0) / Math.max(1, L.width * L.height);
        const score = recouvrement * 100 + (exterieur || dehors * 2) + ((cy - y0) / Math.max(1e-6, y1 - y0)) * 0.6 + (Math.abs(cx - cx0) / Math.max(1e-6, x1 - x0)) * 0.4;
        if (!meilleur || score < meilleur.score) meilleur = { score, cx, cy, r };
      }
      if (!meilleur) return;
      nom.style.left = `${meilleur.cx}%`;
      nom.style.top = `${meilleur.cy}%`;
      obstacles.push(meilleur.r);   // les noms suivants l'évitent aussi
    });
  });
}

/** Appelle fn quand toutes les images de racine sont chargées (pour mesurer les plans à leur vraie taille). */
function apresImages(racine, fn) {
  const imgs = [...racine.querySelectorAll('img')].filter((i) => !i.complete);
  if (!imgs.length) { fn(); return; }
  Promise.all(imgs.map((i) => new Promise((r) => { i.addEventListener('load', r, { once: true }); i.addEventListener('error', r, { once: true }); }))).then(fn);
}

