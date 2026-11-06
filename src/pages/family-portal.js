const esc = value => String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const makeId = () => "lid-" + crypto.randomUUID();
let registration = null;
let catalog = [];
let saving = false;
let notice = "";
let error = "";

function render() {
  const root = document.querySelector("#app");
  if (!registration) {
    root.innerHTML = `<main class="admin-login-shell"><section class="admin-login-card"><p class="eyebrow">NIEUWJAAR · GEZIN</p><h1>Gezinslink controleren</h1><p>${esc(error || "We controleren jullie persoonlijke toegang…")}</p><a class="admin-login-back" href="https://nieuwjaar.datuur.be/">Terug</a></section></main>`;
    return;
  }
  const members = registration.members || [];
  root.innerHTML = `<main class="shell family-portal-shell">
    <header class="family-portal-header"><p class="eyebrow">NIEUWJAAR · DEELNEMERSPORTAAL</p><h1>Welkom, ${esc(registration.name)}!</h1><p>Jullie persoonlijke inschrijving voor de nieuwjaarsbijeenkomst.</p></header>
    <section class="panel"><div class="section-heading"><div><h2>Jullie gezin</h2><p>Voeg alle deelnemers toe en kies per persoon de juiste categorie.</p></div><span class="status neutral">${members.length} deelnemers</span></div>
      <div class="member-list">${members.map((person,index)=>`<article class="member-row family-member-row"><div class="person-avatar">${esc(person.name.slice(0,1).toUpperCase())}</div><div class="member-name"><strong>${esc(person.name)}</strong><small>${esc(person.type)}</small></div><button class="button button-small button-outline" data-action="remove-member" data-index="${index}">Verwijderen</button></article>`).join("") || '<p class="catalog-note">Voeg hieronder de eerste persoon toe.</p>'}</div>
      <form id="family-add-member" class="catalog-add-form"><label>Persoon toevoegen</label><div class="family-add-grid"><input name="name" maxlength="80" placeholder="Voornaam en naam" required><select name="type"><option value="Volwassene">Volwassene (18+)</option><option value="Kind">Kind</option></select><button class="button button-dark" type="submit">+ Toevoegen</button></div></form>
    </section>
    <section class="panel"><div class="section-heading"><div><h2>Vleesbestelling</h2><p>Geef per gezinslid aan hoeveel porties jullie wensen.</p></div><span class="status success">Bestelling</span></div>
      ${members.map((person,index)=>`<div class="family-order-person"><h3>${esc(person.name)}</h3><div class="family-order-grid">${catalog.map(product=>{const quantity=Number(person.orders?.[product.id])||0;return `<div class="family-order-item"><span>${esc(product.name)}</span><div class="quantity-control"><button type="button" data-action="quantity" data-index="${index}" data-product="${esc(product.id)}" data-delta="-1" ${quantity===0?"disabled":""}>−</button><strong>${quantity}</strong><button type="button" data-action="quantity" data-index="${index}" data-product="${esc(product.id)}" data-delta="1">+</button></div></div>`}).join("")}</div></div>`).join("") || '<p class="catalog-note">Voeg eerst de gezinsleden toe. Daarna kan je hun bestelling invullen.</p>'}
    </section>
    <div class="family-save-status" role="status">${esc(error || notice || (saving ? "Opslaan…" : "Wijzigingen worden automatisch bewaard."))}</div>
    <footer>Nieuwjaar <span>·</span> Samen vieren, alles geregeld.</footer>
  </main>`;
}

async function save() {
  if (saving || !registration) return;
  saving = true; notice = "Wijzigingen opslaan…"; error = ""; render();
  try {
    const response = await fetch("/api/family/registration", { method:"PUT", credentials:"same-origin", headers:{"Content-Type":"application/json"}, body:JSON.stringify({members:registration.members || []}) });
    const result = await response.json().catch(()=>({}));
    if (!response.ok) throw new Error(result.error || "Opslaan is niet gelukt.");
    registration = result.registration;
    notice = "Alles is bewaard."; error = "";
  } catch (e) { error = e.message || "Opslaan is niet gelukt."; }
  finally { saving = false; render(); }
}

async function load(token) {
  render();
  try {
    const login = await fetch("/api/family/session", {method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({token})});
    const loginData = await login.json().catch(()=>({}));
    if (!login.ok) throw new Error(loginData.error || "Deze gezinslink is niet geldig.");
    const response = await fetch("/api/family/session", {credentials:"same-origin"});
    const data = await response.json().catch(()=>({}));
    if (!response.ok || !data.authenticated) throw new Error(data.error || "Aanmelden is niet gelukt.");
    registration = data.registration;
    catalog = data.catalog || [];
    notice = "Jullie gegevens worden automatisch bewaard.";
    render();
  } catch (e) { error = e.message || "Deze gezinslink is niet geldig."; render(); }
}

document.addEventListener("submit", event => {
  if (event.target.id !== "family-add-member") return;
  event.preventDefault();
  if (!registration || saving) return;
  const form = event.target;
  const name = form.elements.name.value.trim();
  const type = form.elements.type.value;
  if (!name || !["Volwassene","Kind"].includes(type)) return;
  const orders = Object.fromEntries(catalog.map(product => [product.id,0]));
  registration.members = [...(registration.members || []), {id:makeId(),name,type,orders}];
  save();
});
document.addEventListener("click", event => {
  const button = event.target.closest("[data-action]");
  if (!button || !registration || saving) return;
  const members = registration.members || [];
  const index = Number(button.dataset.index);
  if (button.dataset.action === "remove-member") {
    if (!members[index]) return;
    if (!window.confirm("Dit gezinslid verwijderen?")) return;
    members.splice(index,1);
    save();
  }
  if (button.dataset.action === "quantity") {
    const person = members[index];
    const productId = button.dataset.product;
    if (!person || !catalog.some(item=>item.id===productId)) return;
    person.orders = person.orders || {};
    person.orders[productId] = Math.max(0,Math.min(99,(Number(person.orders[productId])||0)+Number(button.dataset.delta)));
    save();
  }
});

export function startFamilyPortal() {
  const token = decodeURIComponent(location.pathname.split("/").filter(Boolean)[1] || "");
  if (!token) { error = "De persoonlijke gezinscode ontbreekt."; render(); return; }
  load(token);
}
