import { state, getGlobalMeatTotals } from "../data/demo-data.js";
import { money, total, received, outstanding } from "../utils/format.js";
import { getExpenseShares, getFinancialSummary } from "../utils/finance.js";
const esc = value => String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function renderMeatTable() {
  const totals=getGlobalMeatTotals();
  return `<table class="meat-print-table"><thead><tr><th>Vleesproduct</th><th>Aantal</th></tr></thead><tbody>${totals.map(item => `<tr><td>${esc(item.name)}</td><td>${item.count}</td></tr>`).join("")}</tbody><tfoot><tr><th>Totaal aantal porties</th><th>${total(totals)}</th></tr></tfoot></table>`;
}
function renderOrderDetails() {
  return state.registrations.map(registration => {
    const members = registration.members || [];
    const familyTotal = state.catalog.reduce((sum, product) =>
      sum + members.reduce((memberSum, person) => memberSum + (Number(person.orders?.[product.id]) || 0), 0), 0);
    return `<section class="order-family-block">
      <div class="section-heading"><div><h3>${esc(registration.name)}</h3><p>${members.length} deelnemers · bestellingen per persoon</p></div><strong class="total-number">${familyTotal} porties</strong></div>
      ${members.length ? `<div class="order-detail-table-wrap"><table class="order-detail-table"><thead><tr><th>Persoon</th><th>Categorie</th>${state.catalog.map(product => `<th>${esc(product.name)}</th>`).join("")}<th>Totaal</th></tr></thead><tbody>${members.map(person => {
        const quantities = state.catalog.map(product => Number(person.orders?.[product.id]) || 0);
        return `<tr><td><strong>${esc(person.name)}</strong></td><td>${esc(person.type || "—")}</td>${quantities.map(count => `<td>${count || "–"}</td>`).join("")}<td><strong>${quantities.reduce((sum,count)=>sum+count,0)}</strong></td></tr>`;
      }).join("")}</tbody></table></div>` : '<p class="catalog-note">Nog geen individuele leden of bestellingen ingevoerd.</p>'}
    </section>`;
  }).join("") || '<p class="catalog-note">Er zijn nog geen inschrijvingen voor deze editie.</p>';
}
function renderMemberManager(registration) {
  const members=registration.members||[];
  return `<section class="panel member-manager"><div class="section-heading"><div><h2>Leden van ${esc(registration.name)}</h2><p>Leg per persoon de naam en categorie vast. Bestellingen blijven per persoon bewaard.</p></div><span class="status neutral">${members.length} namen</span></div>
  ${members.length?members.map((person,index)=>state.editingAdminMemberIndex===index?`<form class="member-inline-edit" id="edit-admin-member-form" data-index="${index}"><input name="memberName" maxlength="80" value="${esc(person.name)}" required><select name="memberType"><option value="Volwassene" ${person.type==="Volwassene"?"selected":""}>Volwassene (18+)</option><option value="Kind" ${person.type==="Kind"?"selected":""}>Kind</option></select><button class="button button-small button-dark" type="submit">Bewaren</button><button class="button button-small button-outline" type="button" data-action="cancel-edit-admin-member">Annuleren</button></form>`:`<div class="member-row"><span class="person-avatar">${esc(person.name[0]||"?")}</span><div class="member-name"><strong>${esc(person.name)}</strong><small>${esc(person.type)}</small></div><button class="button button-small button-outline" data-action="edit-member" data-index="${index}">Wijzigen</button><button class="text-button" data-action="delete-member" data-index="${index}">Verwijderen</button></div>`).join(""):`<p class="catalog-note">Er zijn nog geen individuele namen geregistreerd. De historische aantallen blijven voorlopig behouden tot je de ledenlijst invult.</p>`}
  <form class="catalog-add-form" id="add-member-form"><label>Persoon toevoegen</label><div class="member-add-grid"><input name="memberName" maxlength="80" placeholder="Naam van de persoon" required><select name="memberType"><option value="Volwassene">Volwassene (18+)</option><option value="Kind">Kind</option></select><button class="button button-dark" type="submit">+ Lid toevoegen</button></div></form></section>`;
}
function renderRegistrations() {
  const people=state.registrations.reduce((sum,item)=>sum+item.adults+item.children,0);
  const adults=state.registrations.reduce((sum,item)=>sum+item.adults,0);
  const children=state.registrations.reduce((sum,item)=>sum+item.children,0);
  const archivedPeople=state.previousEditionRegistrations.reduce((sum,item)=>sum+item.adults+item.children,0);
  return `<section class="page-heading"><p class="eyebrow">DEELNEMERSBEHEER</p><h1>Inschrijvingen huidige editie</h1><p>Beheer hier de nieuwe gezinnen en individuele deelnemers. Oude edities blijven apart bewaard.</p></section>
  <section class="stats-grid"><article class="stat-card"><strong>${state.registrations.length}</strong><small>Inschrijvingen</small></article><article class="stat-card"><strong>${people}</strong><small>Deelnemers totaal</small></article><article class="stat-card"><strong>${adults}</strong><small>Volwassenen (18+)</small></article><article class="stat-card"><strong>${children}</strong><small>Kinderen</small></article></section>
  <section class="panel"><div class="section-heading"><div><h2>Nieuwe inschrijving</h2><p>Voeg een gezin of alleenstaande toe.</p></div><span class="status success">Huidige editie</span></div>
  <form class="catalog-add-form" id="add-registration-form"><label>Inschrijving toevoegen</label><div class="registration-form-grid"><input name="registrationName" maxlength="80" placeholder="Naam gezin of deelnemer" required><input name="adults" type="number" min="0" max="30" value="1" aria-label="Aantal volwassenen" required><input name="children" type="number" min="0" max="30" value="0" aria-label="Aantal kinderen" required><button class="button button-dark" type="submit">+ Toevoegen</button></div><p class="catalog-note">Voeg daarna de namen van de individuele deelnemers toe.</p></form>
  <div class="section-heading"><div><h2>Actieve inschrijvingen</h2><p>Deze lijst hoort bij de huidige editie.</p></div><span class="status neutral">${people} personen</span></div>
  ${state.registrations.length ? `<div class="registration-list">${state.registrations.map(item=>`<article class="registration-row"><div class="registration-name"><strong>${esc(item.name)}</strong><small>${item.adults} volwassenen · ${item.children} kinderen</small></div><strong class="registration-total">${item.adults+item.children}</strong><button class="button button-small button-outline" data-action="manage-members" data-id="${esc(item.id)}">Leden beheren</button></article>`).join("")}</div>` : '<p class="catalog-note">Nog geen inschrijvingen voor deze editie.</p>'}
  </section>
  ${state.registrations.some(item=>item.id===state.managingRegistrationId) ? renderMemberManager(state.registrations.find(item=>item.id===state.managingRegistrationId)) : ""}
  <details class="panel archive-panel"><summary><strong>Archief vorige editie</strong> <span class="muted">· ${archivedPeople} deelnemers · alleen lezen</span></summary><p class="catalog-note">Historische aantallen ter referentie. Deze gegevens zijn niet wijzigbaar en tellen niet mee in de huidige editie.</p><div class="registration-list">${state.previousEditionRegistrations.map(item=>`<article class="registration-row"><div class="registration-name"><strong>${esc(item.name)}</strong><small>${item.adults} volwassenen · ${item.children} kinderen</small></div><strong class="registration-total">${item.adults+item.children}</strong><span class="status neutral">Archief</span></article>`).join("")}</div></details>`;
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
  <p class="catalog-note">Prototype: foto's en bestellingen worden tijdelijk in deze browser bewaard. Permanente opslag en synchronisatie volgen met Cloudflare R2 en D1.</p></section>`;
}
function renderPaymentRows() {
  const summaries=getFinancialSummary(state.registrations,state.expenses,state.payments);
  return summaries.map(row=>{
    const status=row.remainingCents===0?(row.amountDueCents===0?'<span class="status neutral">Geen saldo</span>':'<span class="status success">Betaald</span>'):row.paidCents>0?'<span class="status warning">Gedeeltelijk</span>':'<span class="status neutral">Openstaand</span>';
    const history=state.payments.filter(payment=>payment.registrationId===row.id);
    return `<article class="payment-row payment-settlement-row"><div class="payment-person"><strong>${esc(row.name)}</strong><small>Verschuldigd: ${money(row.amountDueCents/100)} · Ontvangen: ${money(row.paidCents/100)} · Nog te betalen: <b>${money(row.remainingCents/100)}</b></small>${history.length?`<details class="payment-history"><summary>${history.length} betaling(en) bekijken</summary>${history.map(payment=>`<div><span>${esc(payment.date)} · ${esc(payment.method==="cash"?"Cash":"Overschrijving")}</span><b>${money(payment.amountCents/100)}</b><button class="text-button danger-text" data-action="delete-payment" data-id="${esc(payment.id)}">Verwijderen</button></div>`).join("")}</details>`:""}</div><div class="payment-right">${status}</div></article>`;
  }).join("")||'<p class="catalog-note">Voeg eerst inschrijvingen toe.</p>';
}

function renderExpenses() {
  const methodLabels = { general: "Algemene kost", adults: "18+ kost", meat: "Vleesjeskost" };
  const summaries = getFinancialSummary(state.registrations, state.expenses, state.payments);
  const expenseRows = state.expenses.map(expense => {
    const payer = state.registrations.find(item => item.id === expense.advancedBy);
    const shares = getExpenseShares(expense, state.registrations);
    if(state.editingExpenseId===expense.id) return `<article class="expense-row expense-edit-row">
      <form id="edit-expense-form" class="expense-form-grid">
        <input name="description" maxlength="120" aria-label="Omschrijving" value="${esc(expense.description)}" required>
        <input name="amount" type="number" min="0.01" step="0.01" aria-label="Bedrag in euro" value="${(expense.amountCents/100).toFixed(2)}" required>
        <input name="date" type="date" aria-label="Datum" value="${esc(expense.date)}" required>
        <select name="method" aria-label="Verdeelsleutel">
          <option value="general" ${expense.method==="general"?"selected":""}>Algemene kost – iedereen</option>
          <option value="adults" ${expense.method==="adults"?"selected":""}>18+ kost – volwassenen</option>
          <option value="meat" ${expense.method==="meat"?"selected":""}>Vleesjeskost – per portie</option>
        </select>
        <select name="advancedBy" aria-label="Voorgeschoten door" required>
          ${state.registrations.map(item=>`<option value="${esc(item.id)}" ${expense.advancedBy===item.id?"selected":""}>${esc(item.name)}</option>`).join("")}
        </select>
        <div class="expense-edit-actions"><button class="button button-dark" type="submit">Wijzigingen opslaan</button><button class="button button-outline" type="button" data-action="cancel-edit-expense">Annuleren</button></div>
      </form></article>`;
    return `<article class="expense-row"><div class="expense-main"><strong>${esc(expense.description)}</strong><small>${esc(expense.date)} · ${methodLabels[expense.method]} · voorgeschoten door ${esc(payer?.name || "Onbekend")}</small><div class="expense-actions"><button class="button button-small button-outline" data-action="edit-expense" data-id="${esc(expense.id)}">Aanpassen</button><button class="text-button danger-text" data-action="delete-expense" data-id="${esc(expense.id)}">Verwijderen</button></div></div><strong>${money(expense.amountCents / 100)}</strong><details class="expense-shares"><summary>Verdeling bekijken</summary><div>${shares.map(share => { const registration=state.registrations.find(item => item.id === share.id); return `<span>${esc(registration?.name || "Onbekend")} <b>${money(share.cents/100)}</b></span>`; }).join("")}</div></details></article>`;
  }).join("");
  return `<section class="panel"><div class="section-heading"><div><h2>Gemeenschappelijke kosten</h2><p>Elke uitgave wordt over de volledige groep verdeeld.</p></div><span class="status neutral">${state.expenses.length} uitgaven</span></div>
  <form class="catalog-add-form expense-form" id="add-expense-form"><label for="expense-description">Nieuwe uitgave registreren</label>
  <div class="expense-form-grid"><input id="expense-description" name="description" maxlength="120" placeholder="Omschrijving, bv. Beenhouwer" required><input name="amount" type="number" min="0.01" step="0.01" placeholder="Bedrag (€)" required><input name="date" type="date" value="${new Date().toISOString().slice(0,10)}" required><select name="method" aria-label="Verdeelsleutel"><option value="general">Algemene kost – iedereen</option><option value="adults">18+ kost – volwassenen</option><option value="meat">Vleesjeskost – per portie</option></select><select name="advancedBy" aria-label="Voorgeschoten door" required><option value="">Wie schoot voor?</option>${state.registrations.map(item=>`<option value="${esc(item.id)}">${esc(item.name)}</option>`).join("")}</select><button class="button button-dark" type="submit">+ Kost toevoegen</button></div>
  <p class="catalog-note">De volledige factuur wordt als voorschot toegekend aan de betaler. De kost zelf wordt volgens de gekozen verdeelsleutel verdeeld.</p></form>
  <div class="expense-list">${expenseRows || '<p class="catalog-note">Nog geen gemeenschappelijke kosten geregistreerd.</p>'}</div></section>
  <section class="panel"><div class="section-heading"><div><h2>Voorlopige kostenafrekening per inschrijving</h2><p>Voorschotten min het eigen aandeel in alle geregistreerde kosten.</p></div><span class="status neutral">Inclusief betalingen</span></div>
  <div class="financial-summary-list">${summaries.map(row=>`<div class="financial-summary-row"><div><strong>${esc(row.name)}</strong><small>Voorgeschoten ${money(row.advancedCents/100)} · Eigen aandeel ${money(row.shareCents/100)} · Betaald ${money(row.paidCents/100)} · Nog te betalen ${money(row.remainingCents/100)}</small></div><strong class="${row.balanceCents>=0?"positive":"negative"}">${money(row.balanceCents/100)}</strong></div>`).join("") || '<p class="catalog-note">Voeg eerst inschrijvingen toe.</p>'}</div>
  <p class="catalog-note">Positief = deze inschrijving heeft meer voorgeschoten dan haar eigen aandeel. Negatief = deze inschrijving moet nog bijdragen. Ontvangen betalingen zijn al in het resterende bedrag verwerkt.</p></section>`;
}

function renderSettlementPanel() {
  return `<section class="panel"><div class="section-heading"><div><h2>Groepsafrekening</h2><p>Alle individuele saldi samen moeten exact nul zijn.</p></div><span class="status success">Sluitend ontwerp</span></div><div class="settlement-zero"><span>Controle groepssaldo</span><strong>€ 0,00</strong><small>De eindafrekening is in evenwicht.</small></div></section>`;
}
function renderAdminOverview() {
  const totals=getGlobalMeatTotals();
  const financial=getFinancialSummary(state.registrations,state.expenses,state.payments);
  const receivedCents=state.payments.reduce((sum,payment)=>sum+payment.amountCents,0);
  const remainingCents=financial.reduce((sum,row)=>sum+row.remainingCents,0);
  return `<section class="welcome"><div><p class="eyebrow">ORGANISATIE</p><h1>Admin dashboard</h1><p>Alles voor de nieuwjaarsbijeenkomst op één plek.</p></div><div class="welcome-icon">✦</div></section>
  <section class="stats-grid"><article class="stat-card"><span class="stat-icon">♧</span><strong>${state.registrations.reduce((sum,item)=>sum+item.adults+item.children,0)}</strong><small>Deelnemers</small></article><article class="stat-card"><span class="stat-icon">♨</span><strong>${total(totals)}</strong><small>Vleesporties</small></article><article class="stat-card"><span class="stat-icon">€</span><strong>${money(receivedCents/100)}</strong><small>Ontvangen betalingen</small></article><article class="stat-card"><span class="stat-icon">◷</span><strong>${money(remainingCents/100)}</strong><small>Nog te ontvangen</small></article></section>
  <div class="admin-grid"><section class="panel"><div class="section-heading"><div><h2>BBQ – totaaloverzicht</h2><p>Actuele aantallen voor de grill.</p></div><span class="status success">Bestelling</span></div>${renderMeatTable()}<button class="button button-outline" data-section="meat">Volledig BBQ-overzicht <span>→</span></button></section>
  <section class="panel"><div class="section-heading"><div><h2>Betalingen</h2><p>Stand van de ontvangen bedragen.</p></div></div><div class="payment-summary"><div><span>Ontvangen</span><strong class="positive">${money(receivedCents/100)}</strong></div><div><span>Openstaand</span><strong>${money(remainingCents/100)}</strong></div></div><button class="button button-dark full" data-section="payments">Betaling registreren <span>→</span></button></section></div>${renderSettlementPanel()}`;
}
export function renderAdminContent(activeSection) {
  if (activeSection==="registrations") return renderRegistrations();
  if (activeSection==="catalog") return renderCatalogManager();
  if (activeSection==="meat") return `<section class="page-heading"><p class="eyebrow">KEUKEN & BBQ</p><h1>BBQ-totaaloverzicht</h1><p>De globale aantallen voor de slager én de individuele bestellingen per gezin.</p></section><section class="panel meat-overview-panel"><div class="section-heading"><div><h2>Bestelling per vleessoort</h2><p>Alle actieve inschrijvingen samen, inclusief producten zonder bestelling.</p></div><span class="status success">Actuele bestelling</span></div>${renderMeatTable()}<button class="button button-outline" data-action="print">BBQ-lijst afdrukken</button></section><section class="panel order-details-panel"><div class="section-heading"><div><h2>Wie bestelde wat?</h2><p>Detailoverzicht per gezin en per individuele deelnemer.</p></div><button class="button button-outline" data-action="print">Detail afdrukken</button></div>${renderOrderDetails()}</section>`;
  if (activeSection==="payments") {
    const summaries=getFinancialSummary(state.registrations,state.expenses,state.payments);
    const receivedCents=state.payments.reduce((sum,payment)=>sum+payment.amountCents,0);
    const remainingCents=summaries.reduce((sum,row)=>sum+row.remainingCents,0);
    return `<section class="page-heading"><p class="eyebrow">KASSA</p><h1>Betalingen ontvangen</h1><p>Registreer cash of overschrijvingen. Gedeeltelijke betalingen blijven openstaan tot het volledige bedrag ontvangen is.</p></section>
    <section class="stats-grid"><article class="stat-card"><strong>${money(receivedCents/100)}</strong><small>Ontvangen</small></article><article class="stat-card"><strong>${money(remainingCents/100)}</strong><small>Nog te ontvangen</small></article></section>
    <section class="panel"><div class="section-heading"><h2>Nieuwe betaling registreren</h2></div><form class="catalog-add-form expense-form" id="add-payment-form"><div class="expense-form-grid"><select name="registrationId" required><option value="">Van wie ontvangen?</option>${state.registrations.map(item=>`<option value="${esc(item.id)}">${esc(item.name)}</option>`).join("")}</select><input name="amount" type="number" min="0.01" step="0.01" placeholder="Bedrag (€)" required><input name="date" type="date" value="${new Date().toISOString().slice(0,10)}" required><select name="method"><option value="cash">Cash</option><option value="bank">Overschrijving</option></select><button class="button button-dark" type="submit">+ Betaling registreren</button></div><p class="catalog-note">Een betaling vermindert het openstaande saldo van die inschrijving. Online betalingen zijn niet inbegrepen.</p></form></section>
    <section class="panel"><div class="section-heading"><h2>Saldo per inschrijving</h2><span class="status neutral">${summaries.length} inschrijvingen</span></div><div class="payment-list">${renderPaymentRows()}</div></section>`;
  }
  if (activeSection==="expenses") return `<section class="page-heading"><p class="eyebrow">BOEKHOUDING</p><h1>Kosten & inkomsten</h1><p>Registreer gemeenschappelijke uitgaven en bekijk hoe ze over de inschrijvingen verdeeld worden.</p></section><section class="panel"><h2>Vaste verdeelsleutels</h2><div class="rule-list"><div><b>Algemene kost</b><span>Iedereen – volwassenen en kinderen</span></div><div><b>18+ kost</b><span>Alle volwassenen</span></div><div><b>Vleesjeskost</b><span>Volgens individueel bestelde vleesporties</span></div></div></section>${renderExpenses()}`;
  if (activeSection==="settlement") return `<section class="page-heading"><p class="eyebrow">AFREKENING</p><h1>Definitieve eindafrekening</h1><p>Alle voorschotten, kosten, inkomsten en ontvangen betalingen in evenwicht.</p></section>${renderSettlementPanel()}`;
  return renderAdminOverview();
}
