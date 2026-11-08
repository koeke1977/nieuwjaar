// Familieportaal core: shared state, server calls, saving (optimistic, debounced, serialized per
// registration), refreshing the account, feedback messages and the live/countdown timers.
import { renderAccount } from "./family-account-view.js";
import { countdownState } from "./countdown.js";

const SAVE_DELAY_MS = 450;
const LIVE_REFRESH_MS = 20000;

export const request = async (path, body, method = "POST") => {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Er liep iets mis. Probeer opnieuw.");
  return result;
};
const clone = value => JSON.parse(JSON.stringify(value ?? null));

// The page root, the visible panel (login, forgot, activate, reset, account) and the token
// from an activation or reset link.
export const portal = { view: null, panel: "login", token: "" };

// Signed-in state
export const account = {
  user: null,
  items: [],
  activeId: null,
  view: { tab: "overview", editingMemberId: null, openPeople: null }
};
export const activeItem = () =>
  account.items.find(item => item.registration.id === account.activeId) || account.items[0];

export const show = name => {
  portal.panel = name;
  portal.view.querySelectorAll("[data-panel]").forEach(panel => {
    panel.hidden = panel.dataset.panel !== name;
  });
  feedback("");
};
export const feedback = (message, kind = "error") => {
  const node = portal.view.querySelector("[data-feedback]");
  node.textContent = message;
  node.hidden = !message;
  node.dataset.kind = kind;
};
export const submit = async (form, callback, successMessage) => {
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await callback(new FormData(form));
    if (successMessage) feedback(successMessage, "success");
  } catch (error) {
    feedback(error.message || "Er liep iets mis.");
  } finally {
    button.disabled = false;
  }
};

export function render() {
  const target = portal.view.querySelector("[data-account-registrations]");
  if (!target) return;
  target.innerHTML = renderAccount(account);
}

// ---- Saving: optimistic UI, debounced and serialized per registration ----
export function scheduleSave(item, { immediate = false } = {}) {
  clearTimeout(item.saveTimer);
  item.dirty = true;
  item.saveTimer = setTimeout(() => flushSave(item), immediate ? 0 : SAVE_DELAY_MS);
}
async function flushSave(item) {
  if (item.saving) {
    item.saveAgain = true;
    return;
  }
  if (!item.dirty) return;
  item.saving = true;
  item.dirty = false;
  feedback("Bewaren…", "success");
  let failure = null;
  const sent = clone(item.registration.members);
  try {
    const result = await request(
      "/api/family-account/registration",
      {
        edition: item.edition,
        registrationId: item.registration.id,
        // Each family has its own row and revision, so other families never block this save.
        revision: item.revision,
        members: sent
      },
      "PUT"
    );
    item.revision = result.revision;
  } catch (error) {
    failure = error;
    // Pending local edits are based on a rejected state: drop them and reload the server truth.
    clearTimeout(item.saveTimer);
    item.dirty = false;
    item.saveAgain = false;
  }
  item.saving = false;
  if (item.saveAgain || item.dirty) {
    item.saveAgain = false;
    scheduleSave(item, { immediate: true });
    return;
  }
  // Reload so the cost breakdown reflects the new order (meat shares depend on all families).
  await refreshAccount().catch(() => {});
  feedback(failure ? failure.message || "Opslaan is niet gelukt." : "Alles is bewaard.", failure ? "error" : "success");
}

export async function refreshAccount() {
  const response = await fetch("/api/family-account/session", { credentials: "same-origin" });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.authenticated) {
    show("login");
    return false;
  }
  const signature = JSON.stringify(result);
  if (signature === account.signature && !account.items.some(item => item.dirty || item.saving)) return true;
  account.signature = signature;
  account.user = result.user || null;
  account.openEditions = result.openEditions || [];
  const previous = new Map(account.items.map(item => [item.registration.id, item]));
  account.items = (result.registrations || []).map(item => {
    const old = previous.get(item.registration.id);
    // Keep local edits that are still waiting to be saved.
    if (old && (old.dirty || old.saving)) return old;
    return item;
  });
  if (!account.items.some(item => item.registration.id === account.activeId))
    account.activeId = account.items[0]?.registration.id || null;
  render();
  return true;
}
export async function loadAccount() {
  if (await refreshAccount()) show("account");
}

// Live refresh: pick up cost changes by the organizer and edits by other family members,
// but never while this person is typing or has unsaved changes.
const busy = () => {
  const view = portal.view;
  if (portal.panel !== "account" || document.hidden) return true;
  if (account.items.some(item => item.dirty || item.saving) || account.view.editingMemberId) return true;
  if (account.view.settingsOpen) return true;
  const active = document.activeElement;
  if (active && view.contains(active) && ["INPUT", "SELECT", "TEXTAREA"].includes(active.tagName)) return true;
  return [...view.querySelectorAll(".fa-app input")].some(input => input.value !== input.defaultValue);
};
const liveRefresh = () => {
  if (!busy()) refreshAccount().catch(() => {});
};

export function startTimers() {
  setInterval(liveRefresh, LIVE_REFRESH_MS);
  // Countdown ticks every second without re-rendering the page.
  setInterval(() => {
    portal.view.querySelectorAll("[data-countdown]").forEach(card => {
      const state = countdownState(card.dataset.countdown, card.dataset.countdownEvent);
      if (!state) return;
      const text = card.querySelector("[data-count-text]");
      if (text && text.textContent !== state.text) text.textContent = state.text;
      if (state.parts)
        [state.parts.days, state.parts.hours, state.parts.minutes, state.parts.seconds].forEach((n, i) => {
          const node = card.querySelector('[data-count-part="' + i + '"]');
          if (node) node.textContent = String(n).padStart(i ? 2 : 1, "0");
        });
    });
  }, 1000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) liveRefresh();
  });
}
