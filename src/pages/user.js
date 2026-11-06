import { state, getActiveFamily, getFamilyMeat, getPersonMeatTotal } from "../data/demo-data.js";
const family = () => getActiveFamily();
import { money, total } from "../utils/format.js";
const esc = value => String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function renderPersonEditor(person) {
  const products = state.catalog.filter(item => item.active);
  return `<div class="person-order-editor"><p>Bestelling voor <strong>${esc(person.name)}</strong></p><div class="person-order-grid">${products.map(product => {
    const count = Number(person.orders[product.id]) || 0;
    return `<div class="person-order-item"><span>${esc(product.name)}</span><div class="quantity-control"><button type="button" data-action="change-quantity" data-person-id="${esc(person.id)}" data-product="${esc(product.id)}" data-delta="-1" ${count===0?"disabled":""}>−</button><strong>${count}</strong><button type="button" data-action="change-quantity" data-person="${esc(person.name)}" data-product="${esc(product.id)}" data-delta="1">+</button></div></div>`;
  }).join("")}</div><button class="button button-small button-outline" data-action="close-order-editor">Gereed</button></div>`;
}
function renderMeatPanel(compact = false) {
  const products = state.catalog.filter(item => item.active);
  const totals = getFamilyMeat();
  return `<section class="panel">
    <div class="section-heading"><div><h2>Onze vleesbestelling</h2><p>Vul per gezinslid de gewenste aantallen in. De totalen worden automatisch berekend.</p></div><span class="status success">In te vullen</span></div>
    <div class="meat-catalog">${products.map(item => {
      const count = totals.find(meat => meat.id === item.id)?.count || 0;
      return `<article class="meat-card"><div class="meat-card-image">${item.image ? `<img src="${item.image}" alt="${esc(item.name)}">` : '<div class="meat-placeholder"><span>♨</span><small>Foto volgt</small></div>'}</div>
        <div class="meat-card-info"><strong>${esc(item.name)}</strong><span>${count} besteld</span></div>
        <div class="quantity-control quantity-summary"><strong>${count} stuks voor ons gezin</strong></div></article>`;
    }).join("")}</div>
    <div class="order-list">${family().members.map(person => `<div class="person-order-block"><div class="order-row"><strong>${esc(person.name)}</strong><span>${getPersonMeatTotal(person)} porties</span><button class="button button-small button-outline" data-action="edit-order" data-person-id="${esc(person.id)}">${state.editingMember===person.id?"Bewerken":"Aanpassen"}</button></div>${state.editingMember===person.id?renderPersonEditor(person):""}</div>`).join("")}</div>
    <div class="family-meat"><div class="section-heading"><div><h3>Totaal voor ons gezin</h3><p>Automatisch opgeteld uit de bestellingen van alle gezinsleden.</p></div><strong class="total-number">${total(totals)} porties</strong></div>
    <div class="meat-chips">${totals.filter(item => item.count>0).map(item => `<span>${esc(item.name)}<b>${item.count}</b></span>`).join("") || "<span>Nog geen bestelling</span>"}</div></div>
    ${compact ? '<button class="button button-dark full" data-section="meat">Bestelling bekijken <span>→</span></button>' : ""}</section>`;
}
function renderBalancePanel(compact = false) {
  return `<section class="panel"><div class="section-heading"><div><h2>Onze afrekening</h2><p>Een transparant overzicht van voorschotten en kosten.</p></div><span class="status neutral">Voorlopig</span></div>
    <div class="balance-lines"><div><span>Voorgeschoten door ons gezin</span><strong>${money(family().advanced)}</strong></div><div><span>Ons aandeel in de kosten</span><strong>${money(family().share)}</strong></div></div>
    <div class="balance-total"><span>Ons saldo</span><strong class="positive">+${money(family().advanced-family().share)}</strong></div>
    <div class="bring-card"><div><small>BEDRAG MEE TE BRENGEN</small><strong>${money(family().bring)}</strong><p>Dit bedrag is door de admin meegedeeld.</p></div><span class="bring-icon">💶</span></div>
    ${compact ? '<button class="button button-outline" data-section="balance">Volledige afrekening <span>→</span></button>' : ""}</section>`;
}
function renderUserOverview() {
  return `<section class="welcome"><div><p class="eyebrow">PERSOONLIJKE OMGEVING</p><h1>Hallo, ${esc(family().name)}!</h1><p>Hier vinden jullie alles voor de nieuwjaarsbijeenkomst.</p></div><div class="welcome-icon">🥂</div></section>
    <section class="stats-grid"><article class="stat-card"><span class="stat-icon">♧</span><strong>${family().members.length}</strong><small>Deelnemers</small></article><article class="stat-card"><span class="stat-icon">♨</span><strong>${total(getFamilyMeat())}</strong><small>Vleesporties</small></article><article class="stat-card"><span class="stat-icon">€</span><strong>${money(family().bring)}</strong><small>Voorlopig mee te brengen</small></article></section>
    <section class="panel"><div class="section-heading"><div><h2>Onze inschrijving</h2><p>De personen die bij ${esc(family().name)} horen.</p></div><span class="status success">Compleet</span></div>
    <div class="member-list">${family().members.map(person => `<div class="member-row"><span class="person-avatar">${esc(person.name[0])}</span><div class="member-name"><strong>${esc(person.name)}</strong><small>${esc(person.type)}</small></div><span class="check">✓</span></div>`).join("")}</div>
    <button class="button button-outline" data-section="family">Inschrijving beheren <span>→</span></button></section>${renderMeatPanel(true)}${renderBalancePanel(true)}`;
}
export function renderUserContent(activeSection) {
  if (activeSection === "family") return `<section class="page-heading"><p class="eyebrow">DEELNEMERS</p><h1>${family().members.length > 1 ? "Ons gezin" : "Mijn inschrijving"}</h1><p>Beheer zelf de personen die bij deze inschrijving horen.</p></section><section class="panel"><div class="section-heading"><div><h2>Deelnemers</h2><p>${family().members.length} geregistreerd</p></div></div><div class="member-list">${family().members.map((person,index) => `<div class="member-row"><span class="person-avatar">${esc(person.name[0])}</span><div class="member-name"><strong>${esc(person.name)}</strong><small>${esc(person.type)}</small></div><button class="button button-small button-outline" data-action="edit-own-member" data-index="${index}">Wijzigen</button>${family().members.length > 1 ? `<button class="text-button" data-action="delete-own-member" data-index="${index}">Verwijderen</button>` : ""}</div>`).join("")}</div><form class="catalog-add-form" id="add-own-member-form"><label>Persoon toevoegen</label><div class="member-add-grid"><input name="memberName" maxlength="80" placeholder="Naam van de persoon" required><select name="memberType"><option value="Volwassene">Volwassene (18+)</option><option value="Kind">Kind</option></select><button class="button button-dark" type="submit">+ Lid toevoegen</button></div></form></section>`;
  if (activeSection === "meat") return `<section class="page-heading"><p class="eyebrow">BESTELLING</p><h1>Vlees voor ons gezin</h1><p>Bekijk het vleesgamma en vul de bestelling per persoon in.</p></section>${renderMeatPanel()}`;
  if (activeSection === "balance") return `<section class="page-heading"><p class="eyebrow">FINANCIEEL OVERZICHT</p><h1>Onze afrekening</h1><p>De actuele stand van jullie inschrijving.</p></section>${renderBalancePanel()}`;
  return renderUserOverview();
}
