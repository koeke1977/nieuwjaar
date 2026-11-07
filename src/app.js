import { startFamilyAuth } from "./pages/family-auth/family-auth.js";
import { state } from "./data/demo-data.js";
import { renderBeheer, normalizeSection, setBeheerAccounts, setBeheerFamilies, MESSAGE_TEMPLATES } from "./pages/beheer/beheer-view.js";
import "./pages/beheer/beheer.css";
import { money } from "./utils/format.js";
import { getExpenseShares, getFinancialSummary } from "./utils/finance.js";
import { loadAdminState, loadEdition, loadEvents, saveAdminState, refreshAdminStateIfChanged, startNextEdition, createEvent } from "./services/admin-state.js";

const markCostsProvisional = () => { state.costsFinalized = false; state.costsFinalizedAt = null; };
const makeId = (prefix = "lid") => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const EDITION_KEY = "beheer.edition";
const remembered = () => { try { return localStorage.getItem(EDITION_KEY); } catch { return null; } };
const rememberEdition = id => { try { if (id) localStorage.setItem(EDITION_KEY, id); } catch { /* private mode */ } };

let adminAuthenticated = false;
let loginError = "";
let statePersistenceReady = false;
let persistenceTimer = null;
let persistenceInFlight = false;
let persistenceAgain = false;
let persistenceError = "";

// ---------------- Saving ----------------
async function flushAdminState() {
  if (!adminAuthenticated || !statePersistenceReady) throw new Error("De opslag is niet klaar. Herlaad de pagina.");
  clearTimeout(persistenceTimer);
  while (persistenceInFlight) await new Promise(resolve => setTimeout(resolve, 25));
  clearTimeout(persistenceTimer);
  persistenceAgain = false;
  persistenceInFlight = true;
  try {
    const result = await saveAdminState();
    if (result?.createdRegistrations) await loadFamiliesAndAccounts().catch(() => {});
  } catch (error) {
    persistenceError = error.message || "Opslaan is mislukt.";
    statePersistenceReady = false;
    throw error;
  } finally {
    persistenceInFlight = false;
  }
}

function scheduleAdminStateSave() {
  if (!adminAuthenticated || !statePersistenceReady) return;
  clearTimeout(persistenceTimer);
  persistenceTimer = setTimeout(async () => {
    if (persistenceInFlight) { persistenceAgain = true; return; }
    persistenceInFlight = true;
    try {
      const result = await saveAdminState();
      if (result?.createdRegistrations) { await loadFamiliesAndAccounts().catch(() => {}); liveRenderPending = true; }
      if (result?.merged) liveRenderPending = true;
      if (result?.conflicts?.length) console.warn("Admin save merged with conflicts (admin version kept):", result.conflicts);
      renderWhenIdle();
    } catch (error) {
      persistenceError = error.message || "Opslaan is mislukt.";
      statePersistenceReady = false;
      console.error("Admin save failed:", error);
      renderApp();
    } finally {
      persistenceInFlight = false;
      if (persistenceAgain) { persistenceAgain = false; scheduleAdminStateSave(); }
    }
  }, 500);
}

// ---------------- Live updates ----------------
const LIVE_REFRESH_MS = 8000;
let liveRenderPending = false;
function adminBusy() {
  if (state.editingExpenseId || state.editingAdminMemberIndex != null || state.beheerRenaming) return true;
  const active = document.activeElement;
  if (active?.closest?.(".bh-app") && ["INPUT", "SELECT", "TEXTAREA"].includes(active.tagName)) return true;
  return [...document.querySelectorAll(".bh-main input, .bh-main select, .bh-main textarea")].some(field =>
    field.type === "checkbox" ? field.checked !== field.defaultChecked
      : field.tagName === "SELECT" ? [...field.options].some(option => option.selected !== option.defaultSelected)
      : field.value !== field.defaultValue);
}
function renderWhenIdle() {
  if (!liveRenderPending || adminBusy()) return;
  liveRenderPending = false;
  const scroll = window.scrollY;
  renderApp();
  window.scrollTo(0, scroll);
}
async function pollAdminState() {
  if (!adminAuthenticated || !statePersistenceReady || document.hidden || persistenceInFlight) return;
  try { if (await refreshAdminStateIfChanged()) liveRenderPending = true; }
  catch (error) { console.warn("Live refresh failed:", error); }
  renderWhenIdle();
}
function startLiveRefresh() {
  setInterval(pollAdminState, LIVE_REFRESH_MS);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) pollAdminState(); });
  document.addEventListener("focusout", () => setTimeout(renderWhenIdle, 300));
}

// ---------------- Server calls ----------------
async function adminApi(path, body, method = "POST") {
  const response = await fetch(path, { method, credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "De aanvraag is mislukt.");
  return result;
}
async function loadFamiliesAndAccounts() {
  if (!adminAuthenticated) return;
  const [families, accounts] = await Promise.all([adminApi("/api/admin/families", undefined, "GET"), adminApi("/api/admin/family-users", undefined, "GET")]);
  state.beheerFamiliesCache = families.families || [];
  setBeheerFamilies(state.beheerFamiliesCache);
  setBeheerAccounts(accounts.users || []);
}
async function loadBackups() {
  try { state.backups = (await adminApi("/api/admin/backups", undefined, "GET")).backups || []; }
  catch (error) { console.warn("Backups unavailable:", error); state.backups = []; }
  liveRenderPending = true; renderWhenIdle();
}
async function loadEverything() {
  const editionId = await loadAdminState(remembered());
  rememberEdition(editionId);
  statePersistenceReady = true;
  await loadFamiliesAndAccounts();
}
async function switchEdition(editionId, tab = "overview") {
  if (editionId && editionId !== state.activeEditionId) {
    await flushAdminState();
    await loadEdition(editionId);
    rememberEdition(editionId);
  }
  state.activeSection = "events";
  state.beheerEventView = "edition";
  state.beheerEditionTab = tab;
  state.beheerFamilyId = null;
  renderApp();
  window.scrollTo(0, 0);
}
const recount = registration => {
  registration.adults = (registration.members || []).filter(person => person.type === "Volwassene").length;
  registration.children = (registration.members || []).filter(person => person.type === "Kind").length;
};

// ---------------- Rendering ----------------
function renderLandingPage() {
  document.querySelector("#app").innerHTML = `
    <main style="min-height:100vh;display:grid;place-items:center;padding:32px 20px;background:#f5f3ef;color:#242424;font-family:inherit;text-align:center">
      <section style="width:min(100%,520px);padding:48px 32px;background:#fff;border:1px solid #e8e4dd;border-radius:20px;box-shadow:0 18px 55px rgba(35,30,20,.07)">
        <p style="margin:0 0 16px;font-size:12px;letter-spacing:.2em;font-weight:700;color:#9a8058">SAMEN VIEREN</p>
        <h1 style="margin:0 0 16px;font-size:clamp(30px,6vw,42px);line-height:1.1">Welkom.</h1>
        <p style="margin:0 0 24px;color:#68645e;font-size:16px;line-height:1.7">Gezinnen melden zich aan in het familieportaal met het e-mailadres waarop ze de uitnodiging ontvingen.</p>
        <a href="/familie" style="display:inline-block;padding:14px 22px;border-radius:12px;background:#172b42;color:#fff;font-weight:700;text-decoration:none">Naar het familieportaal</a>
      </section>
    </main>`;
}
function renderAdminLogin() { return `<main class="admin-login-shell"><section class="admin-login-card"><p class="eyebrow">EVENEMENTEN · BEHEER</p><h1>Admin aanmelden</h1><p>Deze omgeving is uitsluitend toegankelijk voor de organisator.</p><form id="admin-login-form"><label for="admin-password">Adminwachtwoord</label><input id="admin-password" name="password" type="password" autocomplete="current-password" required>${loginError ? `<p class="admin-login-error" role="alert">${loginError}</p>` : ""}<button class="button button-dark full" type="submit">Aanmelden</button></form></section></main>`; }
function renderApp() {
  if (!adminAuthenticated) { document.querySelector("#app").innerHTML = renderAdminLogin(); return; }
  const notice = persistenceError
    ? String(persistenceError === true ? "De gegevens konden niet worden geladen." : persistenceError).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;") + " Wijzigingen worden niet bewaard. Herlaad de pagina om de nieuwste gegevens op te halen."
    : "";
  state.activeSection = normalizeSection(state.activeSection);
  document.querySelector("#app").innerHTML = renderBeheer({ section: state.activeSection, notice });
  scheduleAdminStateSave();
}

// ---------------- Clicks ----------------
function handleClick(event) {
  const sectionButton = event.target.closest("[data-section]");
  if (sectionButton) {
    Object.assign(state, { activeSection: sectionButton.dataset.section, beheerFamilyId: null, beheerUserFamilyId: null, beheerEventView: null, editingExpenseId: null, editingAdminMemberIndex: null, beheerRenaming: false });
    if (state.activeSection === "users") loadFamiliesAndAccounts().then(() => { liveRenderPending = true; renderWhenIdle(); }).catch(() => {});
    if (state.activeSection === "settings") loadBackups();
    renderApp(); window.scrollTo(0, 0); return;
  }
  const action = event.target.closest("[data-action]");
  if (!action) return;
  const type = action.dataset.action;
  const go = changes => { Object.assign(state, changes); renderApp(); };

  if (type === "open-edition") { switchEdition(action.dataset.id || state.activeEditionId).catch(error => window.alert(error.message)); return; }
  if (type === "close-edition") { go({ beheerEventView: null, beheerFamilyId: null }); window.scrollTo(0, 0); return; }
  if (type === "edition-tab") { go({ activeSection: "events", beheerEventView: "edition", beheerEditionTab: action.dataset.tab, beheerFamilyId: null, editingExpenseId: null, editingAdminMemberIndex: null, beheerRenaming: false }); return; }
  if (type === "open-family") { go({ activeSection: "events", beheerEventView: "edition", beheerEditionTab: "registrations", beheerFamilyId: action.dataset.id, beheerUserFamilyId: null, editingAdminMemberIndex: null, beheerRenaming: false, beheerOpenMembers: new Set() }); window.scrollTo(0, 0); return; }
  if (type === "close-family") { go({ beheerFamilyId: null, editingAdminMemberIndex: null, beheerRenaming: false }); return; }
  if (type === "users-tab") { go({ beheerUsersTab: action.dataset.tab, beheerUserFamilyId: null }); return; }
  if (type === "open-user-family") { go({ activeSection: "users", beheerUserFamilyId: action.dataset.id, beheerFamilyId: null, editingAdminMemberIndex: null, beheerRenaming: false }); window.scrollTo(0, 0); return; }
  if (type === "close-user-family") { go({ beheerUserFamilyId: null, editingAdminMemberIndex: null, beheerRenaming: false }); return; }
  if (type === "rename-registration") { go({ beheerRenaming: true }); document.querySelector("#rename-registration-form input")?.focus(); return; }
  if (type === "cancel-rename") { go({ beheerRenaming: false }); return; }

  if (type === "message-template") {
    const template = MESSAGE_TEMPLATES[action.dataset.template];
    const form = document.querySelector("#family-message-form");
    if (!template) return;
    state.beheerMessageDraft = { audience: action.dataset.template === "reminder" ? "no-order" : (form?.elements.audience.value || "all"), subject: template.subject(), message: template.message() };
    renderApp();
    document.querySelector("#family-message-form textarea")?.focus();
    return;
  }
  if (type === "unregister-family") {
    const registration = state.registrations.find(item => item.id === action.dataset.id);
    if (!registration) return;
    const linked = state.expenses.filter(item => item.advancedBy === registration.id).length + state.payments.filter(item => item.registrationId === registration.id).length;
    if (linked) { window.alert(registration.name + " heeft nog " + linked + " kost(en) of betaling(en) in deze editie. Verwijder of wijzig die eerst bij Financiën, en schrijf het gezin daarna uit."); return; }
    if (!window.confirm(registration.name + " uitschrijven uit " + state.eventName + " " + state.activeEvent.name + "? De bestelling van deze editie vervalt. Het gezin en zijn accounts blijven bestaan onder Gebruikers.")) return;
    state.registrations = state.registrations.filter(item => item.id !== registration.id);
    markCostsProvisional();
    go({ beheerFamilyId: null, editingAdminMemberIndex: null });
    return;
  }
  if (type === "register-family") {
    // Register a known family for the open edition, starting from the members of its last registration.
    const familyId = action.dataset.id;
    registerFamily(familyId);
    return;
  }
  if (type === "admin-quantity") {
    const registration = state.registrations.find(item => item.id === action.dataset.registration);
    const person = registration?.members?.find(item => item.id === action.dataset.person);
    const product = state.catalog.find(item => item.id === action.dataset.product);
    if (!person || !product) return;
    person.orders = person.orders || {};
    person.orders[product.id] = Math.max(0, Math.min(99, (Number(person.orders[product.id]) || 0) + Number(action.dataset.delta)));
    markCostsProvisional(); renderApp(); return;
  }

  // Accounts
  const accountCall = (path, body, method, message) => {
    action.disabled = true;
    adminApi(path, body, method).then(async () => { if (message) window.alert(message); await loadFamiliesAndAccounts(); renderApp(); })
      .catch(error => { window.alert(error.message); action.disabled = false; });
  };
  if (type === "resend-account-invite") { accountCall("/api/admin/family-users/" + encodeURIComponent(action.dataset.user) + "/resend", undefined, "POST", "De uitnodiging is opnieuw verstuurd."); return; }
  if (type === "account-status") { accountCall("/api/admin/family-users/" + encodeURIComponent(action.dataset.user), { status: action.dataset.status }, "PATCH"); return; }
  if (type === "account-sessions") { accountCall("/api/admin/family-users/" + encodeURIComponent(action.dataset.user) + "/sessions", undefined, "POST", "Dit account is op alle toestellen afgemeld."); return; }
  if (type === "account-delete") {
    const email = action.dataset.email || "";
    const confirmation = window.prompt("Dit verwijdert het account en zijn toegang. Het gezin, de inschrijvingen, bestellingen en betalingen blijven behouden. Typ exact dit e-mailadres om te bevestigen:\n\n" + email);
    if (confirmation !== email) return;
    accountCall("/api/admin/family-users/" + encodeURIComponent(action.dataset.user), { confirmEmail: email }, "DELETE", "Het account is verwijderd.");
    return;
  }

  if (type === "create-backup") {
    action.disabled = true; action.textContent = "Bezig…";
    adminApi("/api/admin/backups", {}).then(result => { window.alert("Back-up gemaakt (" + Math.round(result.bytes / 1024) + " kB)."); return loadBackups(); })
      .catch(error => { window.alert(error.message); action.disabled = false; action.textContent = "Nu back-up maken"; });
    return;
  }
  if (type === "admin-logout") {
    (async () => { try { await flushAdminState(); } catch (error) { window.alert(error.message); renderApp(); return; }
      fetch("/api/admin/logout", { method: "POST", credentials: "same-origin" }).finally(() => { adminAuthenticated = false; window.location.href = "/"; });
    })(); return;
  }

  // Finance
  if (type === "edit-expense") { go({ editingExpenseId: action.dataset.id }); return; }
  if (type === "cancel-edit-expense") { go({ editingExpenseId: null }); return; }
  if (type === "finalize-costs") { if (!window.confirm("Bevestig je dat alle kosten en facturen voor deze editie zijn ontvangen en ingevoerd? Daarna worden de bedragen als definitief getoond.")) return; go({ costsFinalized: true, costsFinalizedAt: new Date().toISOString() }); return; }
  if (type === "reopen-costs") { if (!window.confirm("De eindafrekening opnieuw voorlopig maken?")) return; markCostsProvisional(); renderApp(); return; }
  if (type === "delete-expense") {
    const expense = state.expenses.find(item => item.id === action.dataset.id);
    if (!expense || !window.confirm(`Verwijder de kost "${expense.description}" van ${money(expense.amountCents / 100)} definitief? De verdeling en saldi worden opnieuw berekend.`)) return;
    state.expenses = state.expenses.filter(item => item.id !== expense.id);
    markCostsProvisional(); renderApp(); return;
  }
  if (type === "delete-payment") {
    const payment = state.payments.find(item => item.id === action.dataset.id);
    if (!payment || !window.confirm("Deze betaling verwijderen? Het openstaande saldo wordt opnieuw berekend.")) return;
    state.payments = state.payments.filter(item => item.id !== payment.id); renderApp(); return;
  }

  // Members (act on state.managingRegistrationId, set by the page that shows them)
  if (type === "edit-member") { go({ editingAdminMemberIndex: Number(action.dataset.index) }); return; }
  if (type === "cancel-edit-admin-member") { go({ editingAdminMemberIndex: null }); return; }
  if (type === "delete-member") {
    const registration = state.registrations.find(item => item.id === state.managingRegistrationId);
    const index = Number(action.dataset.index);
    if (!registration?.members?.[index] || !window.confirm(`Verwijder ${registration.members[index].name} uit deze inschrijving?`)) return;
    registration.members.splice(index, 1); recount(registration); markCostsProvisional(); renderApp(); return;
  }

  // Products
  if (type === "print") window.print();
  if (type === "toggle-product") { const product = state.catalog.find(item => item.id === action.dataset.id); if (product) product.active = !product.active; renderApp(); }
  if (type === "remove-image") {
    const product = state.catalog.find(item => item.id === action.dataset.id); if (!product) return;
    const oldImage = product.image; product.image = null; renderApp();
    if (oldImage?.startsWith("/media/")) fetch("/api/admin/product-image", { method: "DELETE", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: oldImage }) }).catch(error => console.error("Photo delete failed:", error));
  }
}

function registerFamily(familyId) {
  if (state.editionStatus === "archived") { window.alert("Deze editie is afgesloten. Open de actieve editie om gezinnen in te schrijven."); return; }
  if (state.registrations.some(item => item.familyId === familyId)) return;
  const family = (state.beheerFamiliesCache || []).find(item => item.id === familyId);
  const latest = family?.registrations?.[0];
  const members = (latest?.members || []).map(person => ({ id: person.id, name: person.name, type: person.type, orders: {} }));
  const id = makeId("inschrijving");
  const registration = { id, familyId, name: family?.name || latest?.name || "Gezin", members, revision: 0 };
  recount(registration);
  state.registrations.push(registration);
  markCostsProvisional();
  renderApp();
}

// ---------------- Forms ----------------
async function handleSubmit(event) {
  const form = event.target;
  const id = form.id;

  if (id === "admin-login-form") {
    event.preventDefault();
    const button = form.querySelector("button[type=submit]");
    button.disabled = true; button.textContent = "Even controleren…"; loginError = "";
    try {
      await adminApi("/api/admin/login", { password: form.elements.password.value });
      adminAuthenticated = true;
      try { await loadEverything(); } catch (loadError) { persistenceError = loadError.message || true; console.error("Admin load failed:", loadError); }
      state.activeSection = "events"; renderApp();
    } catch (error) { loginError = error.message || "Aanmelden is niet gelukt."; renderApp(); }
    return;
  }

  if (id === "event-settings-form") {
    event.preventDefault();
    const eventName = form.elements.eventName.value.trim(), editionName = form.elements.editionName.value.trim();
    if (!eventName || !editionName) { window.alert("Vul de naam van het evenement en van de editie in."); return; }
    state.eventName = eventName;
    state.activeEvent = { ...state.activeEvent, name: editionName };
    state.startsAt = (form.elements.startsAt?.value || "").slice(0, 16) || null;
    state.orderDeadline = (form.elements.orderDeadline?.value || "").slice(0, 16) || null;
    renderApp();
    flushAdminState().then(loadEvents).then(renderApp).catch(error => window.alert(error.message));
    return;
  }

  if (id === "new-edition-form") {
    event.preventDefault();
    const name = form.elements.editionName.value.trim();
    if (!name) { window.alert("Geef de nieuwe editie een naam."); return; }
    if (!window.confirm(`"${state.eventName} ${state.activeEvent.name}" wordt afgesloten (je kan de editie later nog openen). Daarna start "${name}". Gezinnen en accounts blijven bestaan en schrijven zich opnieuw in. Doorgaan?`)) return;
    try {
      await flushAdminState();
      const editionId = await startNextEdition(name, form.elements.copyCatalog.checked);
      rememberEdition(editionId);
      await loadFamiliesAndAccounts();
      Object.assign(state, { activeSection: "events", beheerEventView: "edition", beheerEditionTab: "registrations" });
      renderApp();
    } catch (error) { window.alert(error.message); }
    return;
  }

  if (id === "create-event-form") {
    event.preventDefault();
    const name = form.elements.eventName.value.trim(), editionName = form.elements.editionName.value.trim();
    if (!name || !editionName) return;
    try {
      await flushAdminState();
      const editionId = await createEvent(name, editionName);
      rememberEdition(editionId);
      Object.assign(state, { activeSection: "events", beheerEventView: "edition", beheerEditionTab: "products" });
      renderApp();
    } catch (error) { window.alert(error.message); }
    return;
  }

  if (id === "rename-registration-form") {
    event.preventDefault();
    const registration = state.registrations.find(item => item.id === form.dataset.id);
    const name = form.elements.registrationName.value.trim();
    if (!registration || !name) return;
    registration.name = name; state.beheerRenaming = false; renderApp(); return;
  }

  const inviteForm = form.closest?.("[data-invite-account]");
  if (inviteForm) {
    event.preventDefault();
    const button = inviteForm.querySelector('button[type="submit"]');
    const familyId = inviteForm.dataset.inviteAccount;
    const displayName = inviteForm.elements.displayName.value.trim(), email = inviteForm.elements.email.value.trim();
    button.disabled = true; button.textContent = "Versturen…";
    try {
      await flushAdminState(); // a just-added family must exist in the database first
      const result = await adminApi("/api/admin/families/memberships", { familyId, displayName, email });
      await loadFamiliesAndAccounts();
      renderApp();
      window.alert(result.invited ? "Uitnodiging verstuurd naar " + email + "." : "Het bestaande account van " + email + " is aan dit gezin gekoppeld.");
    } catch (error) { window.alert(error.message || "De uitnodiging kon niet worden verstuurd."); button.disabled = false; button.textContent = "Uitnodiging versturen"; }
    return;
  }

  if (id === "mail-test-form") {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true; button.textContent = "Verzenden…";
    try { await adminApi("/api/admin/mail-test", { recipient: form.elements.recipient.value.trim() }); window.alert("Testmail verzonden. Controleer ook je ongewenste e-mail."); form.reset(); }
    catch (error) { window.alert(error.message || "De testmail kon niet worden verzonden."); }
    finally { button.disabled = false; button.textContent = "Testmail versturen"; }
    return;
  }

  if (id === "order-for-family-form") {
    event.preventDefault();
    const registration = state.registrations.find(item => item.id === form.elements.registrationId.value);
    if (!registration) return;
    // Open the family's order screen with every member expanded, ready for + / −.
    Object.assign(state, { activeSection: "events", beheerEventView: "edition", beheerEditionTab: "registrations", beheerFamilyId: registration.id, editingAdminMemberIndex: null, beheerRenaming: false,
      beheerOpenMembers: new Set((registration.members || []).map(person => person.id)) });
    renderApp();
    document.querySelector(".bh-members")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  if (id === "family-message-form") {
    event.preventDefault();
    const audience = form.elements.audience.value, subject = form.elements.subject.value.trim(), message = form.elements.message.value.trim();
    const label = form.elements.audience.selectedOptions[0]?.textContent || "";
    if (!subject || !message) return;
    if (!window.confirm("Dit bericht nu versturen naar " + label.toLowerCase() + "?\n\nOnderwerp: " + subject)) return;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true; button.textContent = "Versturen…";
    try {
      const result = await adminApi("/api/admin/editions/" + encodeURIComponent(state.activeEditionId) + "/message", { audience, subject, message });
      state.beheerMessageDraft = null;
      renderApp();
      window.alert("Bericht verstuurd naar " + result.sent + " " + (result.sent === 1 ? "ontvanger" : "ontvangers") + "." + (result.failed?.length ? "\nNiet gelukt voor: " + result.failed.join(", ") : ""));
    } catch (error) { window.alert(error.message); button.disabled = false; button.textContent = "Bericht versturen"; }
    return;
  }

  if (id === "register-family-form") {
    event.preventDefault();
    const familyId = form.elements.familyId.value;
    if (familyId) registerFamily(familyId);
    return;
  }

  if (id === "add-registration-form") {
    event.preventDefault();
    const name = form.elements.registrationName.value.trim();
    if (!name) { window.alert("Vul een naam voor het gezin in."); return; }
    if (state.editionStatus === "archived") { window.alert("Deze editie is afgesloten. Open de actieve editie om een gezin in te schrijven."); return; }
    const registrationId = makeId("inschrijving"), familyId = makeId("gezin");
    state.registrations.push({ id: registrationId, familyId, name, adults: 0, children: 0, members: [], revision: 0 });
    state.managingRegistrationId = registrationId;
    if (form.dataset.context === "users") state.beheerUserFamilyId = familyId; else state.beheerFamilyId = registrationId;
    state.beheerOpenMembers = new Set();
    renderApp(); window.scrollTo(0, 0); return;
  }

  if (id === "add-member-form") {
    event.preventDefault();
    const registration = state.registrations.find(item => item.id === state.managingRegistrationId);
    const name = form.elements.memberName.value.trim(), type = form.elements.memberType.value;
    if (!registration || !name || !["Volwassene", "Kind"].includes(type)) return;
    registration.members = registration.members || [];
    if (registration.members.length >= 30) { window.alert("Een inschrijving kan maximaal 30 personen bevatten."); return; }
    registration.members.push({ id: makeId("lid"), name, type, orders: Object.fromEntries(state.catalog.map(product => [product.id, 0])) });
    recount(registration); markCostsProvisional(); renderApp(); return;
  }

  if (id === "edit-admin-member-form") {
    event.preventDefault();
    const registration = state.registrations.find(item => item.id === state.managingRegistrationId);
    const member = registration?.members?.[Number(form.dataset.index)];
    const name = form.elements.memberName.value.trim(), type = form.elements.memberType.value;
    if (!member || !name || !["Volwassene", "Kind"].includes(type)) { window.alert("Vul een geldige naam in en kies Volwassene of Kind."); return; }
    member.name = name; member.type = type;
    const diet = [...form.querySelectorAll('input[name="diet"]:checked')].map(input => input.value);
    const notes = (form.elements.notes?.value || "").trim();
    if (diet.length) member.diet = diet; else delete member.diet;
    if (notes) member.notes = notes; else delete member.notes;
    recount(registration); markCostsProvisional(); state.editingAdminMemberIndex = null; renderApp(); return;
  }

  if (id === "add-expense-form" || id === "edit-expense-form") {
    event.preventDefault();
    const description = form.elements.description.value.trim();
    const amount = Number(form.elements.amount.value), amountCents = Math.round(amount * 100);
    const date = form.elements.date.value, method = form.elements.method.value, advancedBy = form.elements.advancedBy.value;
    if (!description || !Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amountCents) || !date || !advancedBy || !["general", "adults", "meat", "bar"].includes(method) || !(advancedBy === "kas" || state.registrations.some(item => item.id === advancedBy))) {
      window.alert("Controleer de omschrijving, het bedrag, de datum, de verdeelsleutel en wie voorschoot."); return;
    }
    const existing = id === "edit-expense-form" ? state.expenses.find(item => item.id === state.editingExpenseId) : null;
    const expense = { id: existing?.id || makeId("kost"), description, amountCents, date, method, advancedBy };
    // Bar purchases are not divided (the personal bar bills cover them).
    if (method !== "bar") { try { getExpenseShares(expense, state.registrations, { strict: true }); } catch (error) { window.alert(error.message); return; } }
    if (existing) Object.assign(existing, expense); else state.expenses.push(expense);
    state.editingExpenseId = null; markCostsProvisional(); renderApp(); return;
  }

  if (id === "add-payment-form") {
    event.preventDefault();
    const registrationId = form.elements.registrationId.value;
    const amount = Number(form.elements.amount.value), amountCents = Math.round(amount * 100);
    const date = form.elements.date.value, method = form.elements.method.value;
    if (!state.registrations.some(item => item.id === registrationId) || !Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amountCents) || !date || !["cash", "bank"].includes(method)) {
      window.alert("Controleer het gezin, het bedrag, de datum en de betaalwijze."); return;
    }
    const balance = getFinancialSummary(state.registrations, state.expenses, state.payments).find(row => row.id === registrationId);
    if (!balance || amountCents > balance.remainingCents) { window.alert(`Het bedrag is hoger dan het openstaande saldo van ${money((balance?.remainingCents || 0) / 100)}.`); return; }
    state.payments.push({ id: makeId("betaling"), registrationId, amountCents, date, method });
    renderApp(); return;
  }

  if (id === "add-refund-form") {
    event.preventDefault();
    const registrationId = form.elements.registrationId.value;
    const amount = Number(form.elements.amount.value), amountCents = Math.round(amount * 100);
    const date = form.elements.date.value, method = form.elements.method.value;
    const balance = getFinancialSummary(state.registrations, state.expenses, state.payments).find(row => row.id === registrationId);
    if (!balance || !Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amountCents) || !date || !["cash", "bank"].includes(method)) { window.alert("Controleer het gezin, het bedrag, de datum en de betaalwijze."); return; }
    if (amountCents > balance.creditCents) { window.alert(`Het bedrag is hoger dan wat dit gezin nog terugkrijgt (${money(balance.creditCents / 100)}).`); return; }
    state.payments.push({ id: makeId("terugbetaling"), registrationId, amountCents, date, method, kind: "refund" });
    renderApp(); return;
  }

  if (id === "add-product-form") {
    event.preventDefault();
    const name = form.elements.productName.value.trim(); if (!name) return;
    if (state.catalog.some(item => item.name.toLowerCase() === name.toLowerCase())) { window.alert("Dit product bestaat al."); return; }
    const productId = name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) + "-" + Date.now().toString(36);
    state.catalog.push({ id: productId, name, active: true, image: null });
    renderApp();
  }
}

// Personal bar bill typed in euros on the Bar tab.
function handleBarInput(event) {
  const input = event.target.closest?.("[data-bar-input]");
  if (!input) return;
  const registration = state.registrations.find(item => item.id === input.dataset.registration);
  const person = registration?.members?.find(item => item.id === input.dataset.person);
  if (!person) return;
  const cents = Math.round(Math.max(0, Math.min(100000, Number(String(input.value).replace(",", ".")) || 0)) * 100);
  if (cents) person.barCents = cents; else delete person.barCents;
  markCostsProvisional();
  renderApp();
}
function rememberMessageDraft(event) {
  const form = event.target.closest?.("#family-message-form");
  if (form) state.beheerMessageDraft = { audience: form.elements.audience.value, subject: form.elements.subject.value, message: form.elements.message.value };
}
async function handleImageUpload(event) {
  const input = event.target; if (!input.matches("[data-upload-image]")) return;
  const file = input.files?.[0]; if (!file) return;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { window.alert("Gebruik een JPG-, PNG- of WebP-afbeelding."); input.value = ""; return; }
  if (file.size > 5 * 1024 * 1024) { window.alert("De afbeelding mag maximaal 5 MB groot zijn."); input.value = ""; return; }
  const product = state.catalog.find(item => item.id === input.dataset.uploadImage); if (!product) return;
  const oldImage = product.image;
  const label = input.closest(".catalog-admin-actions")?.querySelector("label");
  if (label) label.textContent = "Uploaden…";
  try {
    const body = new FormData(); body.append("file", file); body.append("productId", product.id);
    const response = await fetch("/api/admin/product-image", { method: "POST", credentials: "same-origin", body });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "De foto kon niet worden opgeslagen.");
    product.image = result.image;
    try { await flushAdminState(); } // store the new photo reference before deleting the old photo
    catch (saveError) {
      product.image = oldImage;
      await fetch("/api/admin/product-image", { method: "DELETE", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: result.image }) }).catch(() => {});
      throw new Error("De foto is geüpload, maar kon niet veilig worden gekoppeld. De vorige foto blijft behouden. " + (saveError.message || ""));
    }
    renderApp();
    if (oldImage?.startsWith("/media/")) fetch("/api/admin/product-image", { method: "DELETE", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: oldImage }) }).catch(() => {});
  } catch (error) { window.alert(error.message || "De foto kon niet worden opgeslagen."); }
  finally { input.value = ""; }
}

export async function startApp() {
  const path = location.pathname.replace(/\/+$/, "") || "/";
  if (path === "/familie" || path === "/familie/portaal" || path === "/familie/wachtwoord-vergeten" ||
      /^\/familie\/activeren\/[^/]+$/.test(path) || /^\/familie\/wachtwoord-reset\/[^/]+$/.test(path)) {
    startFamilyAuth();
    return;
  }
  // Retired: personal family links and the test environment.
  if (/^\/familie\/[^/]+$/.test(path)) { location.replace("/familie"); return; }
  if (path === "/test") { location.replace("/beheer"); return; }
  if (path !== "/beheer") { renderLandingPage(); return; }
  document.addEventListener("click", handleClick);
  document.addEventListener("submit", handleSubmit);
  document.addEventListener("change", handleImageUpload);
  document.addEventListener("change", handleBarInput);
  document.addEventListener("input", rememberMessageDraft);
  document.addEventListener("toggle", event => {
    const details = event.target.closest?.("[data-member-id]"); if (!details) return;
    state.beheerOpenMembers = state.beheerOpenMembers || new Set();
    if (details.open) state.beheerOpenMembers.add(details.dataset.memberId); else state.beheerOpenMembers.delete(details.dataset.memberId);
  }, true);
  try { adminAuthenticated = Boolean((await adminApi("/api/admin/session", undefined, "GET")).authenticated); } catch { adminAuthenticated = false; }
  if (adminAuthenticated) {
    try { await loadEverything(); } catch (error) { persistenceError = error?.message || true; console.error("Admin load failed:", error); }
  }
  startLiveRefresh();
  renderApp();
}
