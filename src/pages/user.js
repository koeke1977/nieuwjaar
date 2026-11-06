import { state, family } from "../data/demo-data.js";
import { money, total } from "../utils/format.js";
const esc = value => String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function renderMeatPanel(compact = false) {
  const products = state.catalog.filter(item => item.active);
  return `<section class="panel">
    <div class="section-heading"><div><h2>Onze vleesbestelling</h2><p>Herken elk product aan de foto. De bestelling wordt per persoon bijgehouden.</p></div><span class="status success">In te vullen</span></div>
    <div class="meat-catalog">${products.map(item => {
      const count = family.meat.find(meat => meat.name === item.name)?.count || 0;
      return `<article class="meat-card"><div class="meat-card-image">${item.image ? `<img src="${item.image}" alt="${esc(item.name)}">` : '<div class="meat-placeholder"><span>♨</span><small>Foto volgt</small></div>'}</div>
        <div class="meat-card-info"><strong>${esc(item.name)}</strong><span>${count} besteld</span></div>
        <div class="quantity-control"><button type="button" disabled>−</button><strong>${count}</strong><button type="button" disabled>+</button></div></article>`;
    }).join("")}</div>
    <div class="order-list">${family.members.map(person => `<div class="order-row"><strong>${esc(person.name)}</strong><span>${person.order} porties</span><button class="button button-small button-outline" data-action="edit-order" data-name="${esc(person.name)}">Aanpassen</button></div>`).join("")}</div>
    <div class="family-meat"><div class="section-heading"><div><h3>Totaal voor ons gezin</h3><p>Handig om op de avond zelf terug te vinden.</p></div><strong class="total-number">${total(family.meat)} porties</strong></div>
    <div class="meat-chips">${family.meat.map(item => `<span>${esc(item.name)}<b>${item.count}</b></span>`).join("")}</div></div>
    ${compact ? '<button class="button button-dark full" data-section="meat">Bestelling bekijken <span>→</span></button>' : ""}</section>`;
}
function renderBalancePanel(compact = false) {
  return `<section class="panel"><div class="section-heading"><div><h2>Onze afrekening</h2><p>Een transparant overzicht van voorschotten en kosten.</p></div><span class="status neutral">Voorlopig</span></div>
    <div class="balance-lines"><div><span>Voorgeschoten door ons gezin</span><strong>${money(family.advanced)}</strong></div><div><span>Ons aandeel in de kosten</span><strong>${money(family.share)}</strong></div></div>
    <div class="balance-total"><span>Ons saldo</span><strong class="positive">+${money(family.advanced-family.share)}</strong></div>
    <div class="bring-card"><div><small>BEDRAG MEE TE BRENGEN</small><strong>${money(family.bring)}</strong><p>Dit bedrag is door de admin meegedeeld.</p></div><span class="bring-icon">💶</span></div>
    ${compact ? '<button class="button button-outline" data-section="balance">Volledige afrekening <span>→</span></button>' : ""}</section>`;
}
function renderUserOverview() {
  return `<section class="welcome"><div><p class="eyebrow">PERSOONLIJKE OMGEVING</p><h1>Hallo, familie Thomaes!</h1><p>Hier vinden jullie alles voor de nieuwjaarsbijeenkomst.</p></div><div class="welcome-icon">🥂</div></section>
    <section class="stats-grid"><article class="stat-card"><span class="stat-icon">♧</span><strong>4</strong><small>Deelnemers</small></article><article class="stat-card"><span class="stat-icon">♨</span><strong>12</strong><small>Vleesporties</small></article><article class="stat-card"><span class="stat-icon">€</span><strong>${money(family.bring)}</strong><small>Voorlopig mee te brengen</small></article></section>
    <section class="panel"><div class="section-heading"><div><h2>Ons gezin</h2><p>De personen die bij deze inschrijving horen.</p></div><span class="status success">Compleet</span></div>
    <div class="member-list">${family.members.map(person => `<div class="member-row"><span class="person-avatar">${esc(person.name[0])}</span><div class="member-name"><strong>${esc(person.name)}</strong><small>${esc(person.type)}</small></div><span class="check">✓</span></div>`).join("")}</div>
    <button class="button button-outline" data-section="family">Gezin beheren <span>→</span></button></section>${renderMeatPanel(true)}${renderBalancePanel(true)}`;
}
export function renderUserContent(activeSection) {
  if (activeSection === "family") return `<section class="page-heading"><p class="eyebrow">DEELNEMERS</p><h1>Ons gezin</h1><p>Beheer de leden van jullie inschrijving.</p></section><section class="panel"><div class="section-heading"><h2>Gezinsleden</h2><button class="button button-outline">+ Lid toevoegen</button></div><div class="member-list">${family.members.map(person => `<div class="member-row"><span class="person-avatar">${esc(person.name[0])}</span><div class="member-name"><strong>${esc(person.name)}</strong><small>${esc(person.type)}</small></div><button class="text-button">Wijzigen</button></div>`).join("")}</div></section>`;
  if (activeSection === "meat") return `<section class="page-heading"><p class="eyebrow">BESTELLING</p><h1>Vlees voor ons gezin</h1><p>Bekijk het vleesgamma en de bestelling per persoon.</p></section>${renderMeatPanel()}`;
  if (activeSection === "balance") return `<section class="page-heading"><p class="eyebrow">FINANCIEEL OVERZICHT</p><h1>Onze afrekening</h1><p>De actuele stand van jullie inschrijving.</p></section>${renderBalancePanel()}`;
  return renderUserOverview();
}
