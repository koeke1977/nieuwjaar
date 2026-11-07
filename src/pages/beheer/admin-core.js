// Beheer core: login state, saving (debounced, with merge on conflict), live refresh, server calls
// and rendering. The click and form handlers live in ./actions/.
import { state } from "../../data/admin-store.js";
import { renderBeheer, normalizeSection, setBeheerAccounts, setBeheerFamilies } from "./beheer-view.js";
import { esc } from "../../utils/html.js";
import { loadAdminState, loadEdition, saveAdminState, refreshAdminStateIfChanged } from "../../services/admin-state.js";

export const markCostsProvisional = () => {
  state.costsFinalized = false;
  state.costsFinalizedAt = null;
};
export const makeId = (prefix = "lid") =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const EDITION_KEY = "beheer.edition";
const remembered = () => {
  try {
    return localStorage.getItem(EDITION_KEY);
  } catch {
    return null;
  }
};
export const rememberEdition = id => {
  try {
    if (id) localStorage.setItem(EDITION_KEY, id);
  } catch {
    /* private mode */
  }
};

// Login and save status, changed by the login/logout actions too.
export const session = { authenticated: false, loginError: "", error: "" };
let statePersistenceReady = false;
let persistenceTimer = null;
let persistenceInFlight = false;
let persistenceAgain = false;

// ---------------- Saving ----------------
export async function flushAdminState() {
  if (!session.authenticated || !statePersistenceReady) throw new Error("De opslag is niet klaar. Herlaad de pagina.");
  clearTimeout(persistenceTimer);
  while (persistenceInFlight) await new Promise(resolve => setTimeout(resolve, 25));
  clearTimeout(persistenceTimer);
  persistenceAgain = false;
  persistenceInFlight = true;
  try {
    const result = await saveAdminState();
    if (result?.createdRegistrations) await loadFamiliesAndAccounts().catch(() => {});
  } catch (error) {
    session.error = error.message || "Opslaan is mislukt.";
    statePersistenceReady = false;
    throw error;
  } finally {
    persistenceInFlight = false;
  }
}

export function scheduleAdminStateSave() {
  if (!session.authenticated || !statePersistenceReady) return;
  clearTimeout(persistenceTimer);
  persistenceTimer = setTimeout(async () => {
    if (persistenceInFlight) {
      persistenceAgain = true;
      return;
    }
    persistenceInFlight = true;
    try {
      const result = await saveAdminState();
      if (result?.createdRegistrations) {
        await loadFamiliesAndAccounts().catch(() => {});
        liveRenderPending = true;
      }
      if (result?.merged) liveRenderPending = true;
      if (result?.conflicts?.length)
        console.warn("Admin save merged with conflicts (admin version kept):", result.conflicts);
      renderWhenIdle();
    } catch (error) {
      session.error = error.message || "Opslaan is mislukt.";
      statePersistenceReady = false;
      console.error("Admin save failed:", error);
      renderApp();
    } finally {
      persistenceInFlight = false;
      if (persistenceAgain) {
        persistenceAgain = false;
        scheduleAdminStateSave();
      }
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
    field.type === "checkbox"
      ? field.checked !== field.defaultChecked
      : field.tagName === "SELECT"
        ? [...field.options].some(option => option.selected !== option.defaultSelected)
        : field.value !== field.defaultValue
  );
}
function renderWhenIdle() {
  if (!liveRenderPending || adminBusy()) return;
  liveRenderPending = false;
  const scroll = window.scrollY;
  renderApp();
  window.scrollTo(0, scroll);
}
async function pollAdminState() {
  if (!session.authenticated || !statePersistenceReady || document.hidden || persistenceInFlight) return;
  try {
    if (await refreshAdminStateIfChanged()) liveRenderPending = true;
  } catch (error) {
    console.warn("Live refresh failed:", error);
  }
  renderWhenIdle();
}
export function startLiveRefresh() {
  setInterval(pollAdminState, LIVE_REFRESH_MS);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) pollAdminState();
  });
  document.addEventListener("focusout", () => setTimeout(renderWhenIdle, 300));
}

// ---------------- Server calls ----------------
export async function adminApi(path, body, method = "POST") {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "De aanvraag is mislukt.");
  return result;
}
export async function loadFamiliesAndAccounts() {
  if (!session.authenticated) return;
  const [families, accounts] = await Promise.all([
    adminApi("/api/admin/families", undefined, "GET"),
    adminApi("/api/admin/family-users", undefined, "GET")
  ]);
  state.beheerFamiliesCache = families.families || [];
  setBeheerFamilies(state.beheerFamiliesCache);
  setBeheerAccounts(accounts.users || []);
}
export async function loadBackups() {
  try {
    state.backups = (await adminApi("/api/admin/backups", undefined, "GET")).backups || [];
  } catch (error) {
    console.warn("Backups unavailable:", error);
    state.backups = [];
  }
  liveRenderPending = true;
  renderWhenIdle();
}
export async function loadEverything() {
  const editionId = await loadAdminState(remembered());
  rememberEdition(editionId);
  statePersistenceReady = true;
  await loadFamiliesAndAccounts();
}
export async function switchEdition(editionId, tab = "overview") {
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
export const recount = registration => {
  registration.adults = (registration.members || []).filter(person => person.type === "Volwassene").length;
  registration.children = (registration.members || []).filter(person => person.type === "Kind").length;
};

// ---------------- Rendering ----------------
function renderAdminLogin() {
  return `<main class="admin-login-shell"><section class="admin-login-card"><p class="eyebrow">EVENEMENTEN · BEHEER</p><h1>Admin aanmelden</h1><p>Deze omgeving is uitsluitend toegankelijk voor de organisator.</p><form id="admin-login-form"><label for="admin-password">Adminwachtwoord</label><input id="admin-password" name="password" type="password" autocomplete="current-password" required>${session.loginError ? `<p class="admin-login-error" role="alert">${esc(session.loginError)}</p>` : ""}<button class="button button-dark full" type="submit">Aanmelden</button></form></section></main>`;
}
export function renderApp() {
  if (!session.authenticated) {
    document.querySelector("#app").innerHTML = renderAdminLogin();
    return;
  }
  const notice = session.error
    ? String(session.error === true ? "De gegevens konden niet worden geladen." : session.error)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;") +
      " Wijzigingen worden niet bewaard. Herlaad de pagina om de nieuwste gegevens op te halen."
    : "";
  state.activeSection = normalizeSection(state.activeSection);
  document.querySelector("#app").innerHTML = renderBeheer({ section: state.activeSection, notice });
  scheduleAdminStateSave();
}

// Re-render with fresh data as soon as the admin is not typing.
export function renderSoon() {
  liveRenderPending = true;
  renderWhenIdle();
}

export function go(changes) {
  Object.assign(state, changes);
  renderApp();
}
