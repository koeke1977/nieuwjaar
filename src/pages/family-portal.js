import { state } from "../data/demo-data.js";
import { renderHeader } from "../components/header.js";
import { renderUserNavigation } from "../components/navigation.js";
import { renderUserContent } from "./user.js";

let saving = false;
let notice = "";
let error = "";
let bound = false;

function render() {
  const registration = state.registrations.find(row => row.id === state.activeRegistrationId);
  document.querySelector("#app").innerHTML = `${renderHeader()}<main class="shell">
    <div class="family-session-bar"><span>Persoonlijke inschrijving · ${registration?.name || ""}</span><button class="text-button" data-family-logout>Uitloggen</button></div>
    <div class="workspace">${renderUserNavigation(state.activeSection)}<div class="content">${renderUserContent(state.activeSection)}
    <div class="family-save-status" role="status">${error || notice || (saving ? "Opslaan…" : "Wijzigingen worden automatisch bewaard.")}</div></div></div>
    <footer>Nieuwjaar <span>·</span> Samen vieren, alles geregeld.</footer></main>`;
}
async function saveRegistration() {
  if (saving) return;
  const registration = state.registrations.find(row => row.id === state.activeRegistrationId);
  if (!registration) return;
  saving = true; notice = "Wijzigingen opslaan…"; error = ""; render();
  try {
    const response = await fetch("/api/family/registration", { method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ members: registration.members || [] }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Opslaan is niet gelukt.");
    Object.assign(registration, result.registration); notice = "Alles is bewaard.";
  } catch (e) { error = e.message || "Opslaan is niet gelukt."; }
  finally { saving = false; render(); }
}
function handleClick(event) {
  if (event.target.closest("[data-family-logout]")) {
    fetch("/api/family/logout", { method: "POST", credentials: "same-origin" }).finally(() => location.href = "/"); return;
  }
  const section = event.target.closest("[data-section]");
  if (section) { state.activeSection = section.dataset.section; state.editingMember = null; render(); return; }
  const action = event.target.closest("[data-action]");
  if (!action || saving) return;
  const registration = state.registrations.find(row => row.id === state.activeRegistrationId);
  const members = registration?.members || [];
  if (action.dataset.action === "edit-own-member") { state.editingOwnMemberIndex = Number(action.dataset.index); render(); return; }
  if (action.dataset.action === "cancel-edit-own-member") { state.editingOwnMemberIndex = null; render(); return; }
  if (action.dataset.action === "delete-own-member") {
    const i = Number(action.dataset.index);
    if (members.length <= 1) { window.alert("Een inschrijving moet minstens één deelnemer bevatten."); return; }
    if (!window.confirm(`Verwijder ${members[i]?.name || "dit gezinslid"}?`)) return;
    members.splice(i, 1); registration.adults = members.filter(p => p.type === "Volwassene").length; registration.children = members.filter(p => p.type === "Kind").length; saveRegistration(); return;
  }
  if (action.dataset.action === "edit-order") { state.editingMember = state.editingMember === action.dataset.personId ? null : action.dataset.personId; render(); return; }
  if (action.dataset.action === "close-order-editor") { state.editingMember = null; render(); return; }
  if (action.dataset.action === "change-quantity" || action.dataset.action === "quantity") {
    event.preventDefault();
    const person = members.find(p => p.id === action.dataset.personId);
    const productId = action.dataset.product;
    const product = state.catalog.find(p => p.id === productId);
    if (!person || !product || !["-1", "1"].includes(action.dataset.delta)) {
      error = "Deze bestelling kon niet worden aangepast. Herlaad de persoonlijke link en probeer opnieuw.";
      render();
      return;
    }
    person.orders = person.orders || {};
    const current = Number(person.orders[productId]) || 0;
    person.orders[productId] = Math.max(0, Math.min(99, current + Number(action.dataset.delta)));
    saveRegistration();
    return;
  }
}
function handleSubmit(event) {
  const form = event.target, registration = state.registrations.find(row => row.id === state.activeRegistrationId);
  if (!registration || saving) return;
  if (form.id === "add-own-member-form") {
    event.preventDefault();
    const name = form.elements.memberName.value.trim(), type = form.elements.memberType.value;
    if (!name || !["Volwassene", "Kind"].includes(type)) return;
    const orders = Object.fromEntries(state.catalog.map(p => [p.id, 0]));
    registration.members = [...(registration.members || []), { id: crypto.randomUUID(), name, type, orders }];
    registration.adults = registration.members.filter(p => p.type === "Volwassene").length; registration.children = registration.members.filter(p => p.type === "Kind").length; saveRegistration(); return;
  }
  if (form.id === "edit-own-member-form") {
    event.preventDefault(); const person = registration.members[Number(form.dataset.index)]; if (!person) return;
    const name = form.elements.memberName.value.trim(), type = form.elements.memberType.value;
    if (!name || !["Volwassene", "Kind"].includes(type)) return;
    person.name = name; person.type = type;
    registration.adults = registration.members.filter(p => p.type === "Volwassene").length; registration.children = registration.members.filter(p => p.type === "Kind").length;
    state.editingOwnMemberIndex = null; saveRegistration();
  }
}
async function load(token) {
  document.querySelector("#app").innerHTML = '<main class="admin-login-shell"><section class="admin-login-card"><h1>Welkom</h1><p>We laden jullie persoonlijke inschrijving…</p></section></main>';
  try {
    const login = await fetch("/api/family/session", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
    const loginData = await login.json().catch(() => ({})); if (!login.ok) throw new Error(loginData.error || "Deze persoonlijke link is niet geldig.");
    const response = await fetch("/api/family/session", { credentials: "same-origin" });
    const data = await response.json().catch(() => ({})); if (!response.ok || !data.authenticated) throw new Error(data.error || "Aanmelden is niet gelukt.");
    state.registrations = data.registrations || [data.registration]; state.activeRegistrationId = data.registration.id;
    state.managingRegistrationId = data.registration.id; state.catalog = data.catalog || []; state.expenses = data.expenses || [];
    state.payments = data.payments || []; state.costsFinalized = Boolean(data.costsFinalized); state.activeEvent = data.edition || state.activeEvent;
    state.activeConsole = "user"; state.activeSection = "overview";
    if (!bound) { document.addEventListener("click", handleClick, true); document.addEventListener("submit", handleSubmit, true); bound = true; }
    notice = "Jullie persoonlijke inschrijving is geladen."; render();
  } catch (e) {
    document.querySelector("#app").innerHTML = `<main class="admin-login-shell"><section class="admin-login-card"><h1>Geen toegang</h1><p>${String(e.message || "Deze persoonlijke link is niet geldig.")}</p></section></main>`;
  }
}
export function startFamilyPortal() {
  const token = decodeURIComponent(location.pathname.split("/").filter(Boolean)[1] || "");
  if (!token) { document.querySelector("#app").innerHTML = '<main class="admin-login-shell"><section class="admin-login-card"><h1>Persoonlijke link ontbreekt</h1></section></main>'; return; }
  load(token);
}
