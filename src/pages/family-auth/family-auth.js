import template from "./family-auth.html?raw";
import "./family-auth.css";
import "./family-account.css";
import { renderAccount } from "./family-account-view.js";

const root = () => document.querySelector("#app");
const request = async (path, body, method = "POST") => {
  const response = await fetch(path, { method, credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Er liep iets mis. Probeer opnieuw.");
  return result;
};
const SAVE_DELAY_MS = 450;
const LIVE_REFRESH_MS = 20000;
const clone = value => JSON.parse(JSON.stringify(value ?? null));

export async function startFamilyAuth() {
  root().innerHTML = template;
  const view = root();
  const path = location.pathname;
  const activation = path.match(/^\/familie\/activeren\/([^/]+)\/?$/);
  const reset = path.match(/^\/familie\/wachtwoord-reset\/([^/]+)\/?$/);
  let token = activation?.[1] || reset?.[1] || "";
  let currentPanel = activation ? "activate" : reset ? "reset" : path === "/familie/wachtwoord-vergeten" ? "forgot" : "login";

  // Signed-in state
  const account = { user: null, items: [], activeId: null, view: { tab: "overview", editingMemberId: null, openPeople: null } };
  const activeItem = () => account.items.find(item => item.registration.id === account.activeId) || account.items[0];

  const show = (name) => {
    currentPanel = name;
    view.querySelectorAll("[data-panel]").forEach(panel => { panel.hidden = panel.dataset.panel !== name; });
    feedback("");
  };
  const feedback = (message, kind = "error") => {
    const node = view.querySelector("[data-feedback]");
    node.textContent = message;
    node.hidden = !message;
    node.dataset.kind = kind;
  };
  const submit = async (form, callback, successMessage) => {
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try { await callback(new FormData(form)); if (successMessage) feedback(successMessage, "success"); }
    catch (error) { feedback(error.message || "Er liep iets mis."); }
    finally { button.disabled = false; }
  };

  function render() {
    const target = view.querySelector("[data-account-registrations]");
    if (!target) return;
    target.innerHTML = renderAccount(account);
  }

  // ---- Saving: optimistic UI, debounced and serialized per registration ----
  function scheduleSave(item, { immediate = false } = {}) {
    clearTimeout(item.saveTimer);
    item.dirty = true;
    item.saveTimer = setTimeout(() => flushSave(item), immediate ? 0 : SAVE_DELAY_MS);
  }
  async function flushSave(item) {
    if (item.saving) { item.saveAgain = true; return; }
    if (!item.dirty) return;
    item.saving = true; item.dirty = false;
    feedback("Bewaren…", "success");
    let failure = null;
    const sent = clone(item.registration.members);
    try {
      const result = await request("/api/family-account/registration", {
        edition: item.edition, registrationId: item.registration.id,
        // base = the members as last seen from the server: conflicts are detected per family,
        // so other families saving at the same time never block this save.
        revision: item.revision, base: item.base, members: sent
      }, "PUT");
      item.revision = result.revision;
      item.base = sent;
      // All legacy registrations of one edition share the app_state revision.
      if (item.edition === "live") {
        account.items.forEach(entry => { if (entry.edition === item.edition) entry.revision = result.revision; });
      }
    } catch (error) {
      failure = error;
      // Pending local edits are based on a rejected state: drop them and reload the server truth.
      clearTimeout(item.saveTimer);
      item.dirty = false; item.saveAgain = false;
    }
    item.saving = false;
    if (item.saveAgain || item.dirty) { item.saveAgain = false; scheduleSave(item, { immediate: true }); return; }
    // Reload so the cost breakdown reflects the new order (meat shares depend on all families).
    await refreshAccount().catch(() => {});
    feedback(failure ? (failure.message || "Opslaan is niet gelukt.") : "Alles is bewaard.", failure ? "error" : "success");
  }

  async function refreshAccount() {
    const response = await fetch("/api/family-account/session", { credentials: "same-origin" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.authenticated) { show("login"); return false; }
    const signature = JSON.stringify(result);
    if (signature === account.signature && !account.items.some(item => item.dirty || item.saving)) return true;
    account.signature = signature;
    account.user = result.user || null;
    const previous = new Map(account.items.map(item => [item.registration.id, item]));
    account.items = (result.registrations || []).map(item => {
      const old = previous.get(item.registration.id);
      // Keep local edits that are still waiting to be saved.
      if (old && (old.dirty || old.saving)) return old;
      item.base = clone(item.registration.members || []);
      return item;
    });
    if (!account.items.some(item => item.registration.id === account.activeId)) account.activeId = account.items[0]?.registration.id || null;
    render();
    return true;
  }
  async function loadAccount() {
    if (await refreshAccount()) show("account");
  }

  // Live refresh: pick up cost changes by the organizer and edits by other family members,
  // but never while this person is typing or has unsaved changes.
  const busy = () => {
    if (currentPanel !== "account" || document.hidden) return true;
    if (account.items.some(item => item.dirty || item.saving) || account.view.editingMemberId) return true;
    const active = document.activeElement;
    if (active && view.contains(active) && ["INPUT", "SELECT", "TEXTAREA"].includes(active.tagName)) return true;
    return [...view.querySelectorAll(".fa-app input")].some(input => input.value !== input.defaultValue);
  };
  const liveRefresh = () => { if (!busy()) refreshAccount().catch(() => {}); };
  setInterval(liveRefresh, LIVE_REFRESH_MS);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) liveRefresh(); });

  view.addEventListener("click", async event => {
    const control = event.target.closest("[data-action], [data-tab], [data-tab-target], [data-switch-registration]");
    if (!control) return;
    if (control.dataset.tab || control.dataset.tabTarget) {
      account.view.tab = control.dataset.tab || control.dataset.tabTarget;
      account.view.editingMemberId = null;
      render();
      view.querySelector(".fa-tabs")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      return;
    }
    if (control.dataset.switchRegistration) {
      account.activeId = control.dataset.switchRegistration;
      account.view = { tab: "overview", editingMemberId: null, openPeople: null };
      render(); return;
    }
    const action = control.dataset.action;
    if (action === "show-forgot") show("forgot");
    if (action === "show-login") show("login");
    if (action === "logout") {
      try { await request("/api/family-account/logout", {}); token = ""; account.items = []; show("login"); }
      catch (error) { feedback(error.message); }
      return;
    }
    const item = activeItem();
    if (!item || item.accessRole === "viewer") return;
    const members = item.registration.members || (item.registration.members = []);
    if (action === "quantity") {
      const person = members.find(entry => entry.id === control.dataset.person);
      const product = control.dataset.product;
      if (!person || !item.catalog.some(entry => entry.id === product)) return;
      person.orders = person.orders || {};
      person.orders[product] = Math.max(0, Math.min(99, (Number(person.orders[product]) || 0) + Number(control.dataset.delta)));
      render();
      scheduleSave(item);
    }
    if (action === "edit-member") { account.view.editingMemberId = control.dataset.person; render(); view.querySelector("[data-edit-member] input")?.focus(); }
    if (action === "cancel-edit-member") { account.view.editingMemberId = null; render(); }
    if (action === "remove-member") {
      const index = Number(control.dataset.index);
      const person = members[index];
      if (!person || members.length <= 1) return;
      const portions = Object.values(person.orders || {}).reduce((sum, qty) => sum + (Number(qty) || 0), 0);
      if (!window.confirm(person.name + " verwijderen uit jullie inschrijving?" + (portions ? " Ook de " + portions + " bestelde porties vervallen." : ""))) return;
      members.splice(index, 1);
      render();
      scheduleSave(item, { immediate: true });
    }
  });

  // Remember which people are expanded in the order tab across re-renders.
  view.addEventListener("toggle", event => {
    const details = event.target.closest?.("[data-order-person]");
    if (!details) return;
    if (!account.view.openPeople) {
      account.view.openPeople = new Set([...view.querySelectorAll("[data-order-person][open]")].map(node => node.dataset.orderPerson));
    }
    if (details.open) account.view.openPeople.add(details.dataset.orderPerson);
    else account.view.openPeople.delete(details.dataset.orderPerson);
  }, true);

  view.addEventListener("submit", event => {
    const item = activeItem();
    const addForm = event.target.closest("[data-add-member]");
    const editForm = event.target.closest("[data-edit-member]");
    if (!addForm && !editForm) return;
    event.preventDefault();
    if (!item || item.accessRole === "viewer") return;
    const name = event.target.elements.memberName.value.trim();
    const type = event.target.elements.memberType.value;
    if (!name || !["Volwassene", "Kind"].includes(type)) return;
    const members = item.registration.members || (item.registration.members = []);
    if (addForm) {
      if (members.length >= 30) { feedback("Een inschrijving kan maximaal 30 personen bevatten."); return; }
      members.push({ id: crypto.randomUUID(), name, type, orders: {} });
    } else {
      const person = members.find(entry => entry.id === editForm.dataset.editMember);
      if (!person) return;
      person.name = name; person.type = type;
      account.view.editingMemberId = null;
    }
    render();
    scheduleSave(item, { immediate: true });
  });

  const updatePasswordHints = form => {
    if (!form || !["activate", "reset"].includes(form.dataset.form)) return;
    const password = form.elements.password?.value || "";
    const confirm = form.elements.confirm?.value || "";
    const lengthHint = form.querySelector("[data-password-hint]");
    const confirmHint = form.querySelector("[data-confirm-hint]");
    if (lengthHint) {
      const valid = password.length >= 12;
      lengthHint.textContent = password.length + "/12 tekens" + (valid ? " · voldoende" : " · nog " + (12 - password.length) + " te gaan");
      lengthHint.dataset.valid = String(valid);
    }
    if (confirmHint) {
      const touched = confirm.length > 0;
      confirmHint.textContent = !touched ? "Vul hetzelfde wachtwoord opnieuw in." : password === confirm ? "De wachtwoorden komen overeen." : "De wachtwoorden komen nog niet overeen.";
      confirmHint.dataset.valid = String(touched && password === confirm);
    }
  };

  view.addEventListener("input", event => {
    const form = event.target.closest('form[data-form="activate"], form[data-form="reset"]');
    if (form) updatePasswordHints(form);
  });

  view.addEventListener("submit", event => {
    const form = event.target.closest("form[data-form]");
    if (!form) return;
    event.preventDefault();
    const data = new FormData(form);
    const values = Object.fromEntries(data.entries());
    if (form.dataset.form === "login") submit(form, async () => {
      await request("/api/family-account/login", { email: values.email, password: values.password });
      await loadAccount();
    });
    if (form.dataset.form === "forgot") submit(form, async () => {
      await request("/api/family-account/forgot-password", { email: values.email });
      show("login"); feedback("Als dit e-mailadres bij een actief account hoort, ontvang je een e-mail met verdere instructies.", "success");
    });
    if (form.dataset.form === "activate") submit(form, async () => {
      if (values.password.length < 12) throw new Error("Kies een wachtwoord van minstens 12 tekens.");
      if (values.password !== values.confirm) throw new Error("De wachtwoorden komen niet overeen.");
      await request("/api/family-account/activate", { token, password: values.password, displayName: values.displayName });
      token = ""; await loadAccount();
    });
    if (form.dataset.form === "reset") submit(form, async () => {
      if (values.password.length < 12) throw new Error("Kies een wachtwoord van minstens 12 tekens.");
      if (values.password !== values.confirm) throw new Error("De wachtwoorden komen niet overeen.");
      await request("/api/family-account/reset-password", { token, password: values.password });
      token = ""; show("login"); feedback("Je wachtwoord is aangepast. Je kunt nu aanmelden.", "success");
    });
  });

  if (!activation && !reset && currentPanel !== "forgot") {
    try { await loadAccount(); } catch { show("login"); }
  } else {
    show(currentPanel);
  }
}
