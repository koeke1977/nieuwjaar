import "./style.css";

const state = {
  activeConsole: "user",
  activeSection: "overview",
  paymentNote: "",
  payments: [
    { household: "Familie Thomaes-Beckers", due: 185, paid: 185, method: "Cash" },
    { household: "Familie Ben-Tina", due: 240, paid: 200, method: "Cash" },
    { household: "Inge", due: 95, paid: 0, method: "—" },
    { household: "Familie Olivier-Kelly", due: 165, paid: 165, method: "Overschrijving" }
  ],
  meats: [
    { name: "Steak", count: 28 },
    { name: "Kip", count: 14 },
    { name: "Saté", count: 8 },
    { name: "Worst", count: 15 },
    { name: "Hamburger", count: 5 },
    { name: "Witte pens", count: 6 },
    { name: "Sparerib", count: 18 },
    { name: "Bolletjes op stok", count: 13 }
  ]
};

const family = {
  name: "Familie Thomaes-Beckers",
  members: [
    { name: "Koen", type: "Volwassene", order: 3 },
    { name: "Isabella", type: "Volwassene", order: 2 },
    { name: "Emma", type: "Kind", order: 4 },
    { name: "Lisa", type: "Kind", order: 3 }
  ],
  meat: [
    { name: "Steak", count: 4 },
    { name: "Kip", count: 3 },
    { name: "Saté", count: 2 },
    { name: "Worst", count: 3 }
  ],
  advanced: 250,
  share: 185,
  bring: 185
};

const money = value => new Intl.NumberFormat("nl-BE", {
  style: "currency", currency: "EUR"
}).format(value);

const total = items => items.reduce((sum, item) => sum + item.count, 0);
const received = () => state.payments.reduce((sum, p) => sum + p.paid, 0);
const outstanding = () => state.payments.reduce((sum, p) => sum + Math.max(0, p.due - p.paid), 0);

function header() {
  return `
    <header class="topbar">
      <a class="brand" href="#" aria-label="Nieuwjaar start">
        <span class="brand-mark">✳</span>
        <span><strong>NIEUWJAAR</strong><small>EDITIE 2026–2027</small></span>
      </a>
      <div class="topbar-right">
        <span class="edition-pill"><i></i> Inschrijving actief</span>
        <button class="avatar" aria-label="Profiel">K</button>
      </div>
    </header>`;
}

function consoleSwitcher() {
  return `
    <div class="console-switch" role="tablist" aria-label="Console kiezen">
      <button class="${state.activeConsole === "user" ? "selected" : ""}" data-console="user">Deelnemersportaal</button>
      <button class="${state.activeConsole === "admin" ? "selected" : ""}" data-console="admin">Admin Console</button>
    </div>`;
}

function userNav() {
  const links = [
    ["overview", "⌂", "Overzicht"],
    ["family", "♧", "Gezin"],
    ["meat", "♨", "Vlees"],
    ["balance", "€", "Afrekening"]
  ];
  return `<nav class="side-nav">${links.map(([id, icon, label]) =>
    `<button data-section="${id}" class="${state.activeSection === id ? "active" : ""}"><span>${icon}</span>${label}</button>`
  ).join("")}</nav>`;
}

function userOverview() {
  return `
    <section class="welcome">
      <div><p class="eyebrow">PERSOONLIJKE OMGEVING</p><h1>Hallo, familie Thomaes!</h1><p>Hier vinden jullie alles voor de nieuwjaarsbijeenkomst.</p></div>
      <div class="welcome-icon">🥂</div>
    </section>
    <section class="stats-grid">
      <article class="stat-card"><span class="stat-icon">♧</span><strong>4</strong><small>Deelnemers</small></article>
      <article class="stat-card"><span class="stat-icon">♨</span><strong>12</strong><small>Vleesporties</small></article>
      <article class="stat-card"><span class="stat-icon">€</span><strong>${money(family.bring)}</strong><small>Voorlopig mee te brengen</small></article>
    </section>
    <section class="panel">
      <div class="section-heading"><div><h2>Ons gezin</h2><p>De personen die bij deze inschrijving horen.</p></div><span class="status success">Compleet</span></div>
      <div class="member-list">${family.members.map(person => `
        <div class="member-row"><span class="person-avatar">${person.name[0]}</span><div class="member-name"><strong>${person.name}</strong><small>${person.type}</small></div><span class="check">✓</span></div>
      `).join("")}</div>
      <button class="button button-outline" data-section="family">Gezin beheren <span>→</span></button>
    </section>
    ${meatPanel(true)}
    ${balancePanel(true)}`;
}

function meatPanel(compact = false) {
  return `
    <section class="panel">
      <div class="section-heading"><div><h2>Onze vleesbestelling</h2><p>Iedereen heeft zijn eigen bestelling.</p></div><span class="status success">In te vullen</span></div>
      <div class="order-list">${family.members.map(person => `
        <div class="order-row"><strong>${person.name}</strong><span>${person.order} porties</span><button class="button button-small button-outline" data-action="edit-order" data-name="${person.name}">Aanpassen</button></div>
      `).join("")}</div>
      <div class="family-meat">
        <div class="section-heading"><div><h3>Totaal voor ons gezin</h3><p>Handig om op de avond zelf terug te vinden.</p></div><strong class="total-number">${total(family.meat)} porties</strong></div>
        <div class="meat-chips">${family.meat.map(item => `<span>${item.name}<b>${item.count}</b></span>`).join("")}</div>
      </div>
      ${compact ? '<button class="button button-dark full" data-section="meat">Bestelling bekijken <span>→</span></button>' : ""}
    </section>`;
}

function balancePanel(compact = false) {
  return `
    <section class="panel">
      <div class="section-heading"><div><h2>Onze afrekening</h2><p>Een transparant overzicht van voorschotten en kosten.</p></div><span class="status neutral">Voorlopig</span></div>
      <div class="balance-lines"><div><span>Voorgeschoten door ons gezin</span><strong>${money(family.advanced)}</strong></div><div><span>Ons aandeel in de kosten</span><strong>${money(family.share)}</strong></div></div>
      <div class="balance-total"><span>Ons saldo</span><strong class="positive">+${money(family.advanced - family.share)}</strong></div>
      <div class="bring-card"><div><small>BEDRAG MEE TE BRENGEN</small><strong>${money(family.bring)}</strong><p>Dit bedrag is door de admin meegedeeld.</p></div><span class="bring-icon">💶</span></div>
      ${compact ? '<button class="button button-outline" data-section="balance">Volledige afrekening <span>→</span></button>' : ""}
    </section>`;
}

function userContent() {
  if (state.activeSection === "family") return `
    <section class="page-heading"><p class="eyebrow">DEELNEMERS</p><h1>Ons gezin</h1><p>Beheer de leden van jullie inschrijving.</p></section>
    <section class="panel"><div class="section-heading"><h2>Gezinsleden</h2><button class="button button-outline">+ Lid toevoegen</button></div>
      <div class="member-list">${family.members.map(p => `<div class="member-row"><span class="person-avatar">${p.name[0]}</span><div class="member-name"><strong>${p.name}</strong><small>${p.type}</small></div><button class="text-button">Wijzigen</button></div>`).join("")}</div>
    </section>`;
  if (state.activeSection === "meat") return `<section class="page-heading"><p class="eyebrow">BESTELLING</p><h1>Vlees voor ons gezin</h1><p>De bestelling wordt per persoon bijgehouden.</p></section>${meatPanel(false)}`;
  if (state.activeSection === "balance") return `<section class="page-heading"><p class="eyebrow">FINANCIEEL OVERZICHT</p><h1>Onze afrekening</h1><p>De actuele stand van jullie inschrijving.</p></section>${balancePanel(false)}`;
  return userOverview();
}

function adminNav() {
  const links = [["overview","▦","Dashboard"],["meat","♨","BBQ-overzicht"],["payments","€","Betalingen"],["expenses","＋","Kosten & inkomsten"],["settlement","◎","Eindafrekening"]];
  return `<nav class="side-nav">${links.map(([id, icon, label]) => `<button data-section="${id}" class="${state.activeSection === id ? "active" : ""}"><span>${icon}</span>${label}</button>`).join("")}</nav>`;
}

function adminOverview() {
  return `
    <section class="welcome"><div><p class="eyebrow">ORGANISATIE</p><h1>Admin dashboard</h1><p>Alles voor de nieuwjaarsbijeenkomst op één plek.</p></div><div class="welcome-icon">✦</div></section>
    <section class="stats-grid">
      <article class="stat-card"><span class="stat-icon">♧</span><strong>51</strong><small>Deelnemers</small></article>
      <article class="stat-card"><span class="stat-icon">♨</span><strong>${total(state.meats)}</strong><small>Vleesporties</small></article>
      <article class="stat-card"><span class="stat-icon">€</span><strong>${money(received())}</strong><small>Ontvangen betalingen</small></article>
      <article class="stat-card"><span class="stat-icon">◷</span><strong>${money(outstanding())}</strong><small>Nog te ontvangen</small></article>
    </section>
    <div class="admin-grid">
      <section class="panel"><div class="section-heading"><div><h2>BBQ – totaaloverzicht</h2><p>Definitieve aantallen voor de grill.</p></div><span class="status success">Bestelling</span></div>
        ${meatTable()}
        <button class="button button-outline" data-section="meat">Volledig BBQ-overzicht <span>→</span></button>
      </section>
      <section class="panel"><div class="section-heading"><div><h2>Betalingen</h2><p>Stand van de ontvangen bedragen.</p></div></div>
        <div class="payment-summary"><div><span>Ontvangen</span><strong class="positive">${money(received())}</strong></div><div><span>Openstaand</span><strong>${money(outstanding())}</strong></div></div>
        <button class="button button-dark full" data-section="payments">Betaling registreren <span>→</span></button>
      </section>
    </div>
    ${settlementPanel()}`;
}

function meatTable() {
  return `<div class="data-table">${state.meats.map(item => `<div><span>${item.name}</span><strong>${item.count}</strong></div>`).join("")}<div class="table-total"><span>Totaal</span><strong>${total(state.meats)}</strong></div></div>`;
}

function paymentRows() {
  return state.payments.map((p, i) => {
    const remaining = Math.max(0, p.due - p.paid);
    const status = remaining === 0 ? '<span class="status success">Betaald</span>' : p.paid > 0 ? '<span class="status warning">Gedeeltelijk</span>' : '<span class="status neutral">Openstaand</span>';
    return `<div class="payment-row"><div class="payment-person"><strong>${p.household}</strong><small>Te betalen: ${money(p.due)} · Ontvangen: ${money(p.paid)}</small></div><div class="payment-right">${status}<button class="button button-small button-outline" data-action="receive" data-index="${i}">+ Ontvangen</button></div></div>`;
  }).join("");
}

function settlementPanel() {
  return `
    <section class="panel"><div class="section-heading"><div><h2>Groepsafrekening</h2><p>Alle individuele saldi samen moeten exact nul zijn.</p></div><span class="status success">Sluitend ontwerp</span></div>
      <div class="settlement-zero"><span>Controle groepssaldo</span><strong>€ 0,00</strong><small>De eindafrekening is in evenwicht.</small></div>
    </section>`;
}

function adminContent() {
  if (state.activeSection === "meat") return `<section class="page-heading"><p class="eyebrow">KEUKEN & BBQ</p><h1>BBQ-totaaloverzicht</h1><p>De volledige bestelling per vleessoort, klaar om af te drukken.</p></section><section class="panel">${meatTable()}<button class="button button-outline" data-action="print">BBQ-lijst afdrukken</button></section>`;
  if (state.activeSection === "payments") return `
    <section class="page-heading"><p class="eyebrow">KASSA</p><h1>Betalingen ontvangen</h1><p>Registreer cash, overschrijvingen en gedeeltelijke betalingen.</p></section>
    <section class="stats-grid"><article class="stat-card"><strong>${money(received())}</strong><small>Ontvangen</small></article><article class="stat-card"><strong>${money(outstanding())}</strong><small>Nog te ontvangen</small></article></section>
    <section class="panel"><div class="section-heading"><h2>Betalingslijst</h2><span class="status neutral">${state.payments.length} inschrijvingen</span></div><div class="payment-list">${paymentRows()}</div></section>`;
  if (state.activeSection === "expenses") return `<section class="page-heading"><p class="eyebrow">BOEKHOUDING</p><h1>Kosten & inkomsten</h1><p>Alle kosten zijn gemeenschappelijk. De admin kiest per uitgave de verdeelsleutel.</p></section><section class="panel"><h2>Vaste verdeelsleutels</h2><div class="rule-list"><div><b>Algemene kost</b><span>Iedereen – volwassenen en kinderen</span></div><div><b>18+ kost</b><span>Alle volwassenen</span></div><div><b>Vleesjeskost</b><span>Volgens individueel bestelde vleesporties</span></div></div><p class="muted">Het invoerscherm voor kosten en inkomsten volgt in de volgende bouwstap.</p></section>`;
  if (state.activeSection === "settlement") return `<section class="page-heading"><p class="eyebrow">AFREKENING</p><h1>Definitieve eindafrekening</h1><p>Alle voorschotten, kosten, inkomsten en ontvangen betalingen in evenwicht.</p></section>${settlementPanel()}`;
  return adminOverview();
}

function render() {
  const isAdmin = state.activeConsole === "admin";
  document.querySelector("#app").innerHTML = `
    ${header()}
    <main class="shell">
      ${consoleSwitcher()}
      <div class="workspace">
        ${isAdmin ? adminNav() : userNav()}
        <div class="content">${isAdmin ? adminContent() : userContent()}</div>
      </div>
      <footer>Nieuwjaar <span>·</span> Samen vieren, alles geregeld.</footer>
    </main>`;
}

document.addEventListener("click", event => {
  const consoleButton = event.target.closest("[data-console]");
  if (consoleButton) {
    state.activeConsole = consoleButton.dataset.console;
    state.activeSection = "overview";
    render();
    return;
  }
  const sectionButton = event.target.closest("[data-section]");
  if (sectionButton) {
    state.activeSection = sectionButton.dataset.section;
    render();
    return;
  }
  const action = event.target.closest("[data-action]");
  if (!action) return;
  if (action.dataset.action === "receive") {
    const payment = state.payments[Number(action.dataset.index)];
    const raw = window.prompt(`Hoeveel heeft ${payment.household} betaald?\nNog openstaand: ${money(payment.due - payment.paid)}`, String(Math.max(0, payment.due - payment.paid)));
    if (raw === null) return;
    const amount = Number(raw.replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) {
      window.alert("Geef een geldig bedrag in.");
      return;
    }
    payment.paid = Math.round((payment.paid + amount) * 100) / 100;
    payment.method = "Cash";
    render();
  }
  if (action.dataset.action === "print") window.print();
  if (action.dataset.action === "edit-order") window.alert(`Bestelling aanpassen voor ${action.dataset.name} – invoer volgt in de volgende bouwstap.`);
});

render();
