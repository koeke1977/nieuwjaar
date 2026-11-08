import { startFamilyAuth } from "./pages/family-auth/family-auth.js";
import { state } from "./data/admin-store.js";
import "./pages/beheer/beheer.css";
import {
  session,
  adminApi,
  loadEverything,
  loadFamiliesAndAccounts,
  loadBackups,
  renderApp,
  renderSoon,
  startLiveRefresh,
  hasUnsavedChanges
} from "./pages/beheer/admin-core.js";
import * as navigation from "./pages/beheer/actions/navigation.js";
import * as registrations from "./pages/beheer/actions/registrations.js";
import * as finance from "./pages/beheer/actions/finance.js";
import * as edition from "./pages/beheer/actions/edition.js";
import * as accounts from "./pages/beheer/actions/accounts.js";

// data-action="…" → handler(button); <form id="…"> → handler(form, event, id)
const AREAS = [navigation, registrations, finance, edition, accounts];
const CLICKS = Object.assign({}, ...AREAS.map(area => area.clicks || {}));
const FORMS = Object.assign({}, ...AREAS.map(area => area.forms || {}));
const FORM_ALIASES = { "add-expense-form": "expense-form", "edit-expense-form": "expense-form" };

function handleClick(event) {
  const sectionButton = event.target.closest("[data-section]");
  if (sectionButton) {
    Object.assign(state, {
      activeSection: sectionButton.dataset.section,
      beheerFamilyId: null,
      beheerUserFamilyId: null,
      beheerEventView: null,
      editingExpenseId: null,
      editingAdminMemberIndex: null,
      beheerRenaming: false
    });
    if (state.activeSection === "users")
      loadFamiliesAndAccounts()
        .then(renderSoon)
        .catch(() => {});
    if (state.activeSection === "settings") loadBackups();
    renderApp();
    window.scrollTo(0, 0);
    return;
  }
  const action = event.target.closest("[data-action]");
  if (!action) return;
  const type = action.dataset.action;
  if (Object.hasOwn(CLICKS, type)) CLICKS[type](action);
}

async function handleSubmit(event) {
  const form = event.target;
  const inviteForm = form.closest?.("[data-invite-account]");
  if (inviteForm && !Object.hasOwn(FORMS, form.id)) return accounts.inviteAccount(inviteForm, event);
  const key = FORM_ALIASES[form.id] || form.id;
  if (Object.hasOwn(FORMS, key)) await FORMS[key](form, event, form.id);
}

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

export async function startApp() {
  const path = location.pathname.replace(/\/+$/, "") || "/";
  if (
    path === "/familie" ||
    path === "/familie/portaal" ||
    path === "/familie/wachtwoord-vergeten" ||
    /^\/familie\/activeren\/[^/]+$/.test(path) ||
    /^\/familie\/wachtwoord-reset\/[^/]+$/.test(path) ||
    /^\/familie\/email-bevestigen\/[^/]+$/.test(path)
  ) {
    startFamilyAuth();
    return;
  }
  // Retired: personal family links and the test environment.
  if (/^\/familie\/[^/]+$/.test(path)) {
    location.replace("/familie");
    return;
  }
  if (path === "/test") {
    location.replace("/beheer");
    return;
  }
  if (path !== "/beheer") {
    renderLandingPage();
    return;
  }
  document.addEventListener("click", handleClick);
  // Warn before closing the page while changes (e.g. cash payments) are not saved yet.
  window.addEventListener("beforeunload", event => {
    if (!hasUnsavedChanges()) return;
    event.preventDefault();
    event.returnValue = "";
  });
  document.addEventListener("submit", handleSubmit);
  document.addEventListener("change", accounts.handleAccountMenu);
  document.addEventListener("change", edition.handleImageUpload);
  document.addEventListener("change", registrations.handleBarInput);
  document.addEventListener("input", edition.rememberMessageDraft);
  document.addEventListener(
    "toggle",
    event => {
      const details = event.target.closest?.("[data-member-id]");
      if (!details) return;
      state.beheerOpenMembers = state.beheerOpenMembers || new Set();
      if (details.open) state.beheerOpenMembers.add(details.dataset.memberId);
      else state.beheerOpenMembers.delete(details.dataset.memberId);
    },
    true
  );
  try {
    session.authenticated = Boolean((await adminApi("/api/admin/session", undefined, "GET")).authenticated);
  } catch {
    session.authenticated = false;
  }
  if (session.authenticated) {
    try {
      await loadEverything();
    } catch (error) {
      session.error = error?.message || true;
      console.error("Admin load failed:", error);
    }
  }
  startLiveRefresh();
  renderApp();
}
