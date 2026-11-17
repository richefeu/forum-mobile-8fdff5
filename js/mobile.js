// Forum mobile : consultation sur téléphone, en lecture seule, à partir de donnees.json
// (fichier préparé hors du site par preparer-donnees.html, éventuellement chiffré par un code d'accès).
// Chargé après js/commun.js, dont il reprend les fonctions d'affichage (plans, salles, créneaux).
'use strict';

const $ = (s) => document.querySelector(s);
let cfg = null;
let d = null;
let images = {};
let dateDonnees = '';
const etat = { q: '', demi: '', creneau: 0, planDemi: '', planLarge: false };

// ------------------------------------------------------------------ remplacements de commun.js (images dans donnees.json)
// eslint-disable-next-line no-global-assign
urlLogo = (e) => (e?.logo ? images[e.logo] || '' : '');
// eslint-disable-next-line no-global-assign
urlPlan = (etage) => images[`plan:${etage.id}`] || '';

// ------------------------------------------------------------------ outils
const sansAccent = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const correspond = (txt, q) => !q || sansAccent(txt).includes(q);
const lien = (h, html, cls = '') => `<a class="${cls}" href="#${h}">${html}</a>`;
const lienEtu = (nom) => `s/${encodeURIComponent(nom)}`;
const lienGrp = (nom) => `g/${encodeURIComponent(nom)}`;
const groupeDe = (nom) => cfg.etuParNom.get(nom)?.groupe || d.etudiant_groupe[nom] || '';
const parHeure = (a, b) => DEMIS.indexOf(a.demi) - DEMIS.indexOf(b.demi) || a.creneau - b.creneau || a.table_no - b.table_no;
const badgeAttente = (r) => (r.statut === 'valide' ? '' : ' <span class="badge attente">en attente</span>');
const presente = (e) => ['sr', 'pres'].some((t) => DEMIS.some((dm) => (e[t]?.[dm] || 0) > 0));

function membres() {
  const m = new Map();
  for (const e of cfg.etudiants) {
    const g = groupeDe(e.nom);
    if (g) m.set(g, (m.get(g) || []).concat(e.nom));
  }
  return m;
}

/** « 9h25-9h45 » → minutes de début et de fin. */
function bornes(lib) {
  const t = String(lib).match(/(\d{1,2})\s*h\s*(\d{0,2})/gi) || [];
  const min = (x) => { const [, h, m] = x.match(/(\d{1,2})\s*h\s*(\d{0,2})/i); return Number(h) * 60 + Number(m || 0); };
  return t.length ? [min(t[0]), min(t[t.length - 1])] : [0, 0];
}

/** Créneau en cours (ou le prochain) le jour du forum ; sinon le premier créneau du matin. */
function creneauActuel() {
  const maintenant = new Date();
  const jour = `${maintenant.getFullYear()}-${String(maintenant.getMonth() + 1).padStart(2, '0')}-${String(maintenant.getDate()).padStart(2, '0')}`;
  if (jour === cfg.forum.date) {
    const m = maintenant.getHours() * 60 + maintenant.getMinutes();
    for (const demi of DEMIS) {
      const l = cfg.forum.creneaux[demi] || [];
      for (let i = 0; i < l.length; i++) if (m <= bornes(l[i])[1]) return { demi, creneau: i + 1, enCours: m >= bornes(l[i])[0] };
    }
  }
  return { demi: DEMIS[0], creneau: 1, enCours: false };
}

/** Lieu d'une entreprise : salle(s) et étage(s), avec la couleur de la salle. */
function lieuxEntreprise(e, demi = '') {
  const reps = cfg.plan.reperes.filter((r) => r.entreprise_id === e.id && repereActif(r, demi));
  const vus = new Set();
  const lieux = reps.map((r) => ({ salle: r.salle || e.salle || '', etage: cfg.plan.etages.find((x) => x.id === r.etage)?.nom || '', pr: precisionsRepere(r, !demi, e) }))
    .filter((l) => { const k = `${l.salle}|${l.etage}|${l.pr.join()}`; if (vus.has(k)) return false; vus.add(k); return true; });
  if (!lieux.length && e.salle) lieux.push({ salle: e.salle, etage: '', pr: [] });
  return lieux;
}
const htmlSalle = (salle, extra = '') => `<span class="salle">${pastilleSalle(cfg.plan, salle)}${esc(salle || 'Salle à préciser')}${extra ? ` <span class="doux">${esc(extra)}</span>` : ''}</span>`;

// ------------------------------------------------------------------ vues
function vueChercher() {
  const q = sansAccent(etat.q.trim());
  let html = `<div class="recherche"><input type="search" id="cherche" placeholder="Étudiant, groupe ou entreprise" value="${esc(etat.q)}" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Rechercher"></div>`;
  if (!q) {
    const ents = cfg.entreprises.filter(presente).length;
    html += `<div class="carte accueil"><p><strong>${esc(cfg.forum.nom)}</strong><br>${esc(dateForum())}</p>
      <p class="doux">${ents} entreprises · ${cfg.etudiants.length} étudiants · ${d.inscriptions.length} rendez-vous</p>
      <p class="doux">Tapez quelques lettres d'un nom pour retrouver ses rendez-vous, ou d'une entreprise pour sa salle et son planning.</p></div>`;
  } else {
    const m = membres();
    const ents = cfg.entreprises.filter((e) => presente(e) && correspond(`${e.nom} ${e.court || ''}`, q)).sort((a, b) => tri(nomEnt(a), nomEnt(b)));
    const etus = cfg.etudiants.filter((e) => correspond(e.nom, q)).sort((a, b) => tri(a.nom, b.nom));
    const grps = cfg.groupes.filter((g) => correspond(g.nom, q)).sort((a, b) => tri(a.nom, b.nom));
    const bloc = (titre, l, f) => (l.length ? `<h2 class="sous-titre">${titre} <span class="doux">(${l.length})</span></h2><div class="liste">${l.slice(0, 40).map(f).join('')}</div>${l.length > 40 ? '<p class="doux">… précisez la recherche.</p>' : ''}` : '');
    html += bloc('Étudiants', etus, (e) => lien(lienEtu(e.nom), `<span class="l-nom">${esc(e.nom)}</span><span class="l-info">${esc([libParcours(e), groupeDe(e.nom)].filter(Boolean).join(' · '))}</span>`, 'ligne'))
      + bloc('Groupes', grps, (g) => lien(lienGrp(g.nom), `<span class="l-nom">Groupe ${esc(g.nom)}</span><span class="l-info">${esc((m.get(g.nom) || []).length)} membre(s)</span>`, 'ligne'))
      + bloc('Entreprises', ents, (e) => ligneEntreprise(e));
    if (!ents.length && !etus.length && !grps.length) html += '<p class="doux centre">Aucun résultat.</p>';
  }
  $('#vue').innerHTML = html;
  const champ = $('#cherche');
  champ.addEventListener('input', () => {
    etat.q = champ.value;
    const pos = champ.selectionStart;
    vueChercher();
    const c = $('#cherche'); c.focus(); c.setSelectionRange(pos, pos);
  });
  if (!q && !matchMedia('(pointer: coarse)').matches) champ.focus();
}

function ligneEntreprise(e) {
  const lieux = lieuxEntreprise(e);
  const txt = lieux.map((l) => htmlSalle(l.salle)).join('<br>');
  const logo = urlLogo(e);
  return lien(`e/${e.id}`, `${logo ? `<img class="l-logo" src="${esc(logo)}" alt="">` : '<span class="l-logo"></span>'}<span class="l-nom">${esc(nomEnt(e))}</span><span class="l-info">${txt || '<span class="doux">Salle à préciser</span>'}</span>`, 'ligne avec-logo');
}

function vueEntreprises() {
  const ents = cfg.entreprises.filter(presente).sort((a, b) => tri(nomEnt(a), nomEnt(b)));
  $('#vue').innerHTML = `<h2 class="sous-titre">Entreprises <span class="doux">(${ents.length})</span></h2><div class="liste">${ents.map(ligneEntreprise).join('')}</div>`;
}

function ficheEntreprise(id) {
  const e = cfg.entParId.get(Number(id));
  if (!e) { $('#vue').innerHTML = '<p class="doux centre">Entreprise introuvable.</p>'; return; }
  const m = membres();
  const logo = urlLogo(e);
  const lieux = lieuxEntreprise(e);
  const etages = [...new Set(cfg.plan.reperes.filter((r) => r.entreprise_id === e.id).map((r) => r.etage))];
  const plans = etages.map((id2) => {
    const et = cfg.plan.etages.find((x) => x.id === id2);
    if (!et) return '';
    const p = { ...cfg.plan, style_reperes: 'point', reperes: cfg.plan.reperes.filter((r) => r.entreprise_id === e.id) };
    return `<div class="mini-plan"><div class="doux">${esc(et.nom)}</div>${htmlPlan(p, cfg.entParId, et, { numeros: new Map([[e.id, '★']]), salles: lieux.map((l) => l.salle).filter(Boolean) })}</div>`;
  }).join('');
  let blocs = '';
  for (const type of ['sr', 'pres']) {
    for (const demi of DEMIS) {
      const nb = e[type]?.[demi] || 0;
      if (!nb) continue;
      const salle = salleDe(cfg.plan, e, demi, type, 1);
      let lignes = '';
      (cfg.forum.creneaux[demi] || []).forEach((lib, i) => {
        const n = i + 1;
        for (let t = 1; t <= nb; t++) {
          const r = d.inscriptions.find((x) => x.entreprise_id === e.id && x.type === type && x.demi === demi && x.table_no === t && x.creneau === n);
          let qui = '<span class="doux">Libre</span>';
          if (estBloque(e, demi, n, type)) qui = '<span class="doux">Indisponible</span>';
          else if (r) qui = occupant(r, m);
          lignes += `<div class="creneau"><span class="h">${t === 1 ? esc(lib) : ''}${nb > 1 ? `<small>${esc(nomTable(e, t))}</small>` : ''}</span><span class="qui">${qui}</span></div>`;
        }
      });
      blocs += `<section class="carte"><h3>${NOM_TYPE[type]} — ${NOM_DEMI[demi].toLowerCase()}</h3>${salle ? `<div class="bloc-salle">${htmlSalle(salle)}</div>` : ''}${lignes}</section>`;
    }
  }
  $('#vue').innerHTML = `<div class="carte entete-fiche">${logo ? `<img class="fiche-logo" src="${esc(logo)}" alt="">` : ''}<h2>${esc(e.nom)}</h2>
      <div class="lieux">${lieux.length ? lieux.map((l) => `<div>${htmlSalle(l.salle, [l.etage, ...l.pr].filter(Boolean).join(' · '))}</div>`).join('') : '<div class="doux">Salle à préciser</div>'}</div>
      ${plans}</div>${blocs || '<p class="doux centre">Aucun créneau prévu.</p>'}`;
  apresImages($('#vue'), () => placerNomsSalles($('#vue')));
}

/** Qui occupe ce créneau : étudiant, groupe (avec ses membres) ou étudiant seul en présentation. */
function occupant(r, m) {
  if (r.type === 'pres' && cfg.grpParNom.has(r.participant)) {
    const mem = m.get(r.participant) || [];
    return `${lien(lienGrp(r.participant), `<strong>Groupe ${esc(r.participant)}</strong>`)}${badgeAttente(r)}${mem.length ? `<small>${mem.map((x) => lien(lienEtu(x), esc(x))).join(', ')}</small>` : ''}`;
  }
  const etu = cfg.etuParNom.get(r.participant);
  return `${lien(lienEtu(r.participant), `<strong>${esc(r.participant)}</strong>`)}${r.type === 'pres' ? ' (seul·e)' : ''}${badgeAttente(r)}${etu ? `<small>${esc(libParcours(etu))}</small>` : ''}`;
}

/** Rendez-vous d'un étudiant ou d'un groupe, dans l'ordre de la journée. */
function htmlRendezVous(liste, nomSeul = '') {
  if (!liste.length) return '<p class="doux">Aucun rendez-vous.</p>';
  let demiPrec = '';
  return liste.sort(parHeure).map((r) => {
    const e = cfg.entParId.get(r.entreprise_id);
    const titre = r.demi !== demiPrec ? `<h3 class="demi">${NOM_DEMI[r.demi]}</h3>` : '';
    demiPrec = r.demi;
    const salle = e ? salleDe(cfg.plan, e, r.demi, r.type, r.table_no) : '';
    const table = e && (e[r.type]?.[r.demi] || 0) > 1 ? nomTable(e, r.table_no) : '';
    return `${titre}<div class="rdv"><span class="h">${esc(libCreneau(cfg, r.demi, r.creneau))}</span><span class="rdv-corps">
      ${e ? lien(`e/${e.id}`, `<strong>${esc(nomEnt(e))}</strong>`) : '<strong>(entreprise retirée)</strong>'}${badgeAttente(r)}
      <small>${NOM_TYPE[r.type]}${r.type === 'pres' && nomSeul && r.participant === nomSeul ? ' (seul·e)' : ''}${table ? ` · ${esc(table)}` : ''}</small>
      <small>${htmlSalle(salle)}</small></span></div>`;
  }).join('');
}

function ficheEtudiant(nom) {
  const e = cfg.etuParNom.get(nom);
  if (!e) { $('#vue').innerHTML = '<p class="doux centre">Étudiant introuvable.</p>'; return; }
  const g = groupeDe(nom);
  const rdv = d.inscriptions.filter((r) => (r.type === 'sr' && r.participant === nom) || (r.type === 'pres' && (r.participant === nom || (g && r.participant === g))));
  $('#vue').innerHTML = `<div class="carte entete-fiche"><h2>${esc(nom)}</h2><div class="doux">${esc(libParcours(e))}${g ? ` · ${lien(lienGrp(g), `groupe ${esc(g)}`)}` : ''}</div></div>
    <div class="carte">${htmlRendezVous(rdv, nom)}</div>`;
}

function ficheGroupe(nom) {
  const g = cfg.grpParNom.get(nom);
  if (!g) { $('#vue').innerHTML = '<p class="doux centre">Groupe introuvable.</p>'; return; }
  const mem = membres().get(nom) || [];
  const rdv = d.inscriptions.filter((r) => r.type === 'pres' && r.participant === nom);
  $('#vue').innerHTML = `<div class="carte entete-fiche"><h2>Groupe ${esc(nom)}</h2><div class="doux">${esc(g.parcours || '')}</div>
      <div class="membres">${mem.map((x) => lien(lienEtu(x), esc(x), 'puce')).join('') || '<span class="doux">Aucun membre</span>'}</div></div>
    <div class="carte">${htmlRendezVous(rdv)}</div>`;
}

function vueMaintenant() {
  if (!etat.demi) Object.assign(etat, creneauActuel());
  const { demi, creneau } = etat;
  const libs = cfg.forum.creneaux[demi] || [];
  const actuel = creneauActuel();
  const m = membres();
  const puces = DEMIS.map((dm) => `<button class="puce ${dm === demi ? 'actif' : ''}" data-demi="${dm}">${NOM_DEMI[dm]}</button>`).join('');
  const creneaux = libs.map((lib, i) => `<button class="puce ${i + 1 === creneau ? 'actif' : ''} ${actuel.enCours && actuel.demi === demi && actuel.creneau === i + 1 ? 'en-cours' : ''}" data-creneau="${i + 1}">${esc(lib)}</button>`).join('');
  const lignes = [];
  for (const e of cfg.entreprises) {
    for (const type of ['sr', 'pres']) {
      const nb = e[type]?.[demi] || 0;
      for (let t = 1; t <= nb; t++) {
        if (estBloque(e, demi, creneau, type)) continue;
        const r = d.inscriptions.find((x) => x.entreprise_id === e.id && x.type === type && x.demi === demi && x.table_no === t && x.creneau === creneau);
        if (r) lignes.push({ e, type, t, nb, r });
      }
    }
  }
  lignes.sort((a, b) => tri(nomEnt(a.e), nomEnt(b.e)) || a.type.localeCompare(b.type) || a.t - b.t);
  $('#vue').innerHTML = `<div class="choix-creneau"><div class="puces">${puces}</div><div class="puces defile">${creneaux}</div></div>
    <h2 class="sous-titre">${esc(NOM_DEMI[demi])} · ${esc(libs[creneau - 1] || '')} <span class="doux">(${lignes.length} rendez-vous)</span></h2>
    <div class="liste">${lignes.map(({ e, type, t, nb, r }) => `<div class="ligne maintenant">
      <span class="l-nom">${lien(`e/${e.id}`, esc(nomEnt(e)))}<small>${type === 'sr' ? 'SR' : 'Présentation'}${nb > 1 ? ` · ${esc(nomTable(e, t))}` : ''} · ${htmlSalle(salleDe(cfg.plan, e, demi, type, t))}</small></span>
      <span class="l-qui">${occupant(r, m)}</span></div>`).join('') || '<p class="doux centre">Aucun rendez-vous sur ce créneau.</p>'}</div>`;
  $('#vue').querySelectorAll('[data-demi]').forEach((b) => b.addEventListener('click', () => { etat.demi = b.dataset.demi; etat.creneau = 1; vueMaintenant(); }));
  $('#vue').querySelectorAll('[data-creneau]').forEach((b) => b.addEventListener('click', () => { etat.creneau = Number(b.dataset.creneau); vueMaintenant(); }));
  $('#vue .puce.actif[data-creneau]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
}

function vuePlans() {
  if (!etat.planDemi) etat.planDemi = creneauActuel().demi;
  const demi = etat.planDemi;
  const numeros = numerosReperes(cfg.plan, cfg.entreprises, demi);
  const ents = cfg.entreprises.filter((e) => presenteDemi(e, demi)).sort((a, b) => tri(nomEnt(a), nomEnt(b)));
  $('#vue').innerHTML = `<div class="choix-creneau"><div class="puces">${DEMIS.map((dm) => `<button class="puce ${dm === demi ? 'actif' : ''}" data-demi="${dm}">${NOM_DEMI[dm]}</button>`).join('')}
      <button class="puce" id="agrandir">${etat.planLarge ? 'Réduire' : 'Agrandir'} les plans</button></div></div>
    ${cfg.plan.etages.map((et) => `<div class="carte"><h3>${esc(et.nom)}</h3><div class="plan-defile"><div class="plan-cadre ${etat.planLarge ? 'large' : ''}">${htmlPlan(cfg.plan, cfg.entParId, et, { demi, numeros })}</div></div></div>`).join('')}
    <div class="carte"><h3>Entreprises — ${NOM_DEMI[demi].toLowerCase()}</h3><div class="liste">${ents.map((e) => {
      const lieux = lieuxEntreprise(e, demi);
      return lien(`e/${e.id}`, `<b class="repere-pt ${numeros.has(e.id) ? '' : 'sans'}">${numeros.get(e.id) ?? ''}</b><span class="l-nom">${esc(nomEnt(e))}</span><span class="l-info">${lieux.map((l) => htmlSalle(l.salle)).join('<br>') || '<span class="doux">Salle à préciser</span>'}</span>`, 'ligne avec-numero');
    }).join('')}</div></div>`;
  $('#vue').querySelectorAll('[data-demi]').forEach((b) => b.addEventListener('click', () => { etat.planDemi = b.dataset.demi; vuePlans(); }));
  $('#agrandir').addEventListener('click', () => { etat.planLarge = !etat.planLarge; vuePlans(); });
  apresImages($('#vue'), () => placerNomsSalles($('#vue')));
}

// ------------------------------------------------------------------ navigation (#chercher, #e/12, #s/NOM…)
const ONGLETS = { chercher: vueChercher, maintenant: vueMaintenant, entreprises: vueEntreprises, plans: vuePlans };
let ongletCourant = 'chercher';

function router() {
  if (!cfg) return;
  const h = decodeURIComponent(location.hash.slice(1));
  const [quoi, ...reste] = h.split('/');
  const arg = reste.join('/');
  const fiche = { e: ficheEntreprise, s: ficheEtudiant, g: ficheGroupe }[quoi];
  if (fiche && arg) {
    fiche(arg);
  } else {
    ongletCourant = ONGLETS[quoi] ? quoi : 'chercher';
    ONGLETS[ongletCourant]();
  }
  $('#retour').classList.toggle('cache', !fiche);
  document.querySelectorAll('#onglets a').forEach((a) => a.classList.toggle('actif', !fiche && a.dataset.onglet === ongletCourant));
  if (fiche) window.scrollTo(0, 0);
}
window.addEventListener('hashchange', router);
$('#retour').addEventListener('click', () => { if (history.length > 1) history.back(); else location.hash = ongletCourant; });

// ------------------------------------------------------------------ chargement et déchiffrement de donnees.json
const deB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const CLE_CODE = 'forum-mobile-code';
const lireCode = () => { try { return localStorage.getItem(CLE_CODE) || ''; } catch (e) { return ''; } };
const ecrireCode = (c) => { try { if (c) localStorage.setItem(CLE_CODE, c); else localStorage.removeItem(CLE_CODE); } catch (e) { /* navigation privée */ } };

async function dechiffrer(paquet, code) {
  if (!crypto?.subtle) throw new Error('Ce site doit être ouvert en https pour lire des données protégées.');
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveKey']);
  const cle = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: deB64(paquet.sel), iterations: paquet.iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const clair = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: deB64(paquet.iv) }, cle, deB64(paquet.donnees));
  if (paquet.compression !== 'gzip') return JSON.parse(new TextDecoder().decode(clair));
  if (typeof DecompressionStream === 'undefined') throw new Error('Navigateur trop ancien : mettez à jour le téléphone (iOS 16.4 ou plus récent).');
  return new Response(new Blob([clair]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
}

function demanderCode(paquet, erreur = '') {
  return new Promise((ok) => {
    $('#vue').innerHTML = `<form class="carte code" id="form-code"><h2>Accès réservé</h2>
      <p class="doux">Saisissez le code d'accès communiqué par l'équipe du forum.</p>
      ${erreur ? `<p class="erreur">${esc(erreur)}</p>` : ''}
      <input type="password" id="code" autocomplete="current-password" aria-label="Code d'accès" required>
      <label class="case"><input type="checkbox" id="retenir" checked> Retenir sur ce téléphone</label>
      <button type="submit">Ouvrir</button></form>`;
    $('#code').focus();
    $('#form-code').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const code = $('#code').value;
      try {
        const donnees = await dechiffrer(paquet, code);
        ecrireCode($('#retenir').checked ? code : '');
        ok(donnees);
      } catch (e) {
        ok(demanderCode(paquet, /https|ancien/.test(e.message) ? e.message : 'Code incorrect.'));
      }
    });
  });
}

async function chargerDonnees() {
  let rep;
  try {
    rep = await fetch('donnees.json', { cache: 'no-cache' });
    if (!rep.ok) throw new Error(`donnees.json introuvable (${rep.status}).`);
  } catch (e) {
    throw new Error(`Données indisponibles : ${e.message}`);
  }
  let paquet = await rep.json();
  if (paquet.format === 'forum-mobile-chiffre') {
    const memo = lireCode();
    let donnees = null;
    if (memo) { try { donnees = await dechiffrer(paquet, memo); } catch (e) { ecrireCode(''); } }
    paquet = donnees || await demanderCode(paquet);
  }
  if (paquet.format !== 'forum-mobile') throw new Error('donnees.json n\'a pas le format attendu : préparez-le avec preparer-donnees.html.');
  return paquet;
}

function dateForum() {
  return cfg.forum.date ? new Date(`${cfg.forum.date}T12:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '';
}

async function demarrer() {
  try {
    const D = await chargerDonnees();
    images = D.images || {};
    dateDonnees = D.date;
    cfg = { ...D.config };
    cfg.entParId = new Map(cfg.entreprises.map((e) => [e.id, e]));
    cfg.etuParNom = new Map(cfg.etudiants.map((e) => [e.nom, e]));
    cfg.grpParNom = new Map(cfg.groupes.map((g) => [g.nom, g]));
    d = { inscriptions: D.inscriptions, etudiant_groupe: D.etudiant_groupe || {} };
    $('#titre').textContent = cfg.forum.nom;
    document.title = cfg.forum.nom;
    $('#info').textContent = `Données du ${new Date(dateDonnees).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}${D.validees ? ' · inscriptions validées' : ''}`;
    router();
  } catch (e) {
    $('#vue').innerHTML = `<div class="carte"><p class="erreur">${esc(e.message)}</p><p class="doux">Vérifiez la connexion puis rechargez la page.</p></div>`;
  }
}

// Mise en cache pour consulter sans réseau (Wi-Fi saturé) : https uniquement.
if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('sw.js').catch(() => {});
demarrer();
