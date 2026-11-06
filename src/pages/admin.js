import { state } from "../data/demo-data.js";
import { money, total, received, outstanding } from "../utils/format.js";
const esc = value => String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function renderMeatTable() {
  return `<div class="data-table">${state.meats.map(item => `<div><span>${esc(item.name)}</span><strong>${item.count}</strong></div>`).join("")}<div class="table-total"><span>Totaal</span><strong>${total(state.meats)}</strong></div></div>`;
}
function renderCatalogManager() {
  return `<section class="page-heading"><p class="eyebrow">PRODUCTBEHEER</p><h1>Vleescatalogus</h1><p>Beheer producten en foto's. Deelnemers zien alleen actieve producten.</p></section>
  <section class="panel"><div class="section-heading"><div><h2>Producten beheren</h2><p>Voeg producten toe, pas foto's aan of verberg producten tijdelijk.</p></div><span class="status neutral">${state.catalog.length} producten</span></div>
  <div class="catalog-admin-list">${state.catalog.map(item => `<article class="catalog-admin-row"><div class="catalog-admin-thumb">${item.image ? `<img src="${item.image}" alt="${esc(item.name)}">` : "<span>♨</span>"}</div>
  <div class="catalog-admin-name"><strong>${esc(item.name)}</strong><small>${item.active ? "Actief voor deelnemers" : "Niet zichtbaar voor deelnemers"}</small></div><div class="catalog-admin-actions">
  <label class="button button-small button-outline" for="photo-${esc(item.id)}">${item.image ? "Foto wijzigen" : "Foto toevoegen"}</label><input class="visually-hidden" id="photo-${esc(item.id)}" type="file" accept="image/png,image/jpeg,image/webp" data-upload-image="${esc(item.id)}">
  ${item.image ? `<button class="text-button" data-action="remove-image" data-id="${esc(item.id)}">Foto wissen</button>` : ""}
  <button class="text-button" data-action="toggle-product" data-id="${esc(item.id)}">${item.active ? "Deactiveren" : "Activeren"}</button></div></article>`).join("")}</div>
  <form class="catalog-add-form" id="add-product-form"><label for="new-product-name">Nieuw vleesproduct</label><div><input id="new-product-name" name="productName" type="text" maxlength="60" placeholder="Bijvoorbeeld: Kippenbrochette" required><button class="button button-dark" type="submit">+ Product toevoegen</button></div></form>
  <p class="catalog-note">Prototype: foto's worden tijdelijk in deze browser bewaard. Permanente opslag en synchronisatie volgen met Cloudflare R2 en D1.</p></section>`;
}
function renderPaymentRows() {
  return state.payments.map((payment,index) => { const remaining=Math.max(0,payment.due-payment.paid); const status=remaining===0?'<span class="status success">Betaald</span>':payment.paid>0?'<span class="status warning">Gedeeltelijk</span>':'<span class="status neutral">Openstaand</span>';
    return `<div class="payment-row"><div class="payment-person"><strong>${esc(payment.household)}</strong><small>Te betalen: ${money(payment.due)} · Ontvangen: ${money(payment.paid)}</small></div><div class="payment-right">${status}<button class="button button-small button-outline" data-action="receive" data-index="${index}">+ Ontvangen</button></div></div>`; }).join("");
}
function renderSettlementPanel() {
  return `<section class="panel"><div class="section-heading"><div><h2>Groepsafrekening</h2><p>Alle individuele saldi samen moeten exact nul zijn.</p></div><span class="status success">Sluitend ontwerp</span></div><div class="settlement-zero"><span>Controle groepssaldo</span><strong>€ 0,00</strong><small>De eindafrekening is in evenwicht.</small></div></section>`;
}
function renderAdminOverview() {
  return `<section class="welcome"><div><p class="eyebrow">ORGANISATIE</p><h1>Admin dashboard</h1><p>Alles voor de nieuwjaarsbijeenkomst op één plek.</p></div><div class="welcome-icon">✦</div></section>
  <section class="stats-grid"><article class="stat-card"><span class="stat-icon">♧</span><strong>51</strong><small>Deelnemers</small></article><article class="stat-card"><span class="stat-icon">♨</span><strong>${total(state.meats)}</strong><small>Vleesporties</small></article><article class="stat-card"><span class="stat-icon">€</span><strong>${money(received(state.payments))}</strong><small>Ontvangen betalingen</small></article><article class="stat-card"><span class="stat-icon">◷</span><strong>${money(outstanding(state.payments))}</strong><small>Nog te ontvangen</small></article></section>
  <div class="admin-grid"><section class="panel"><div class="section-heading"><div><h2>BBQ – totaaloverzicht</h2><p>Definitieve aantallen voor de grill.</p></div><span class="status success">Bestelling</span></div>${renderMeatTable()}<button class="button button-outline" data-section="meat">Volledig BBQ-overzicht <span>→</span></button></section>
  <section class="panel"><div class="section-heading"><div><h2>Betalingen</h2><p>Stand van de ontvangen bedragen.</p></div></div><div class="payment-summary"><div><span>Ontvangen</span><strong class="positive">${money(received(state.payments))}</strong></div><div><span>Openstaand</span><strong>${money(outstanding(state.payments))}</strong></div></div><button class="button button-dark full" data-section="payments">Betaling registreren <span>→</span></button></section></div>${renderSettlementPanel()}`;
}
export function renderAdminContent(activeSection) {
  if (activeSection==="catalog") return renderCatalogManager();
  if (activeSection==="meat") return `<section class="page-heading"><p class="eyebrow">KEUKEN & BBQ</p><h1>BBQ-totaaloverzicht</h1><p>De volledige bestelling per vleessoort, klaar om af te drukken.</p></section><section class="panel">${renderMeatTable()}<button class="button button-outline" data-action="print">BBQ-lijst afdrukken</button></section>`;
  if (activeSection==="payments") return `<section class="page-heading"><p class="eyebrow">KASSA</p><h1>Betalingen ontvangen</h1><p>Registreer cash, overschrijvingen en gedeeltelijke betalingen.</p></section><section class="stats-grid"><article class="stat-card"><strong>${money(received(state.payments))}</strong><small>Ontvangen</small></article><article class="stat-card"><strong>${money(outstanding(state.payments))}</strong><small>Nog te ontvangen</small></article></section><section class="panel"><div class="section-heading"><h2>Betalingslijst</h2><span class="status neutral">${state.payments.length} inschrijvingen</span></div><div class="payment-list">${renderPaymentRows()}</div></section>`;
  if (activeSection==="expenses") return `<section class="page-heading"><p class="eyebrow">BOEKHOUDING</p><h1>Kosten & inkomsten</h1><p>Alle kosten zijn gemeenschappelijk. De admin kiest per uitgave de verdeelsleutel.</p></section><section class="panel"><h2>Vaste verdeelsleutels</h2><div class="rule-list"><div><b>Algemene kost</b><span>Iedereen – volwassenen en kinderen</span></div><div><b>18+ kost</b><span>Alle volwassenen</span></div><div><b>Vleesjeskost</b><span>Volgens individueel bestelde vleesporties</span></div></div><p class="muted">Het invoerscherm voor kosten en inkomsten volgt in de volgende bouwstap.</p></section>`;
  if (activeSection==="settlement") return `<section class="page-heading"><p class="eyebrow">AFREKENING</p><h1>Definitieve eindafrekening</h1><p>Alle voorschotten, kosten, inkomsten en ontvangen betalingen in evenwicht.</p></section>${renderSettlementPanel()}`;
  return renderAdminOverview();
}
