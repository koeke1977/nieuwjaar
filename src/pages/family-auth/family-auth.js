import template from "./family-auth.html?raw";
import "./family-auth.css";
import "./family-account.css";
import { renderAccount } from "./family-account-view.js";
import { countdownState } from "./countdown.js";

const root = () => document.querySelector("#app");
const request = async (path, body, method = "POST") => {
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
const SAVE_DELAY_MS = 450;
// Phone photos are made smaller before upload (max 1600 px, JPEG); PDFs and HEIC go as they are.
async function shrinkImage(file) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || typeof createImageBitmap !== "function")
    return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1.5 * 1024 * 1024) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.82));
    return blob ? new File([blob], "kasticket.jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}
const LIVE_REFRESH_MS = 20000;
const clone = value => JSON.parse(JSON.stringify(value ?? null));

export async function startFamilyAuth() {
  root().innerHTML = template;
  const view = root();
  const path = location.pathname;
  const activation = path.match(/^\/familie\/activeren\/([^/]+)\/?$/);
  const reset = path.match(/^\/familie\/wachtwoord-reset\/([^/]+)\/?$/);
  let token = activation?.[1] || reset?.[1] || "";
  let currentPanel = activation
    ? "activate"
    : reset
      ? "reset"
      : path === "/familie/wachtwoord-vergeten"
        ? "forgot"
        : "login";

  // Signed-in state
  const account = {
    user: null,
    items: [],
    activeId: null,
    view: { tab: "overview", editingMemberId: null, openPeople: null }
  };
  const activeItem = () => account.items.find(item => item.registration.id === account.activeId) || account.items[0];

  const show = name => {
    currentPanel = name;
    view.querySelectorAll("[data-panel]").forEach(panel => {
      panel.hidden = panel.dataset.panel !== name;
    });
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
    try {
      await callback(new FormData(form));
      if (successMessage) feedback(successMessage, "success");
    } catch (error) {
      feedback(error.message || "Er liep iets mis.");
    } finally {
      button.disabled = false;
    }
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
      // All legacy registrations of one edition share the app_state revision.
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
    feedback(
      failure ? failure.message || "Opslaan is niet gelukt." : "Alles is bewaard.",
      failure ? "error" : "success"
    );
  }

  async function refreshAccount() {
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
  const liveRefresh = () => {
    if (!busy()) refreshAccount().catch(() => {});
  };
  setInterval(liveRefresh, LIVE_REFRESH_MS);
  // Countdown ticks every second without re-rendering the page.
  setInterval(() => {
    view.querySelectorAll("[data-countdown]").forEach(card => {
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
      render();
      return;
    }
    const action = control.dataset.action;
    if (action === "edit-expense") {
      account.view.editingExpenseId = control.dataset.id;
      render();
      return;
    }
    if (action === "cancel-edit-expense") {
      account.view.editingExpenseId = null;
      render();
      return;
    }
    if (action === "delete-expense") {
      const item = activeItem();
      if (!item || !window.confirm("Deze kost verwijderen? De afrekening wordt opnieuw berekend.")) return;
      try {
        await request(
          "/api/family-account/expenses",
          { edition: item.edition, registrationId: item.registration.id, expenseId: control.dataset.id },
          "DELETE"
        );
        account.signature = null;
        await refreshAccount();
        feedback("De kost is verwijderd.", "success");
      } catch (error) {
        feedback(error.message);
      }
      return;
    }
    if (action === "self-register") {
      control.disabled = true;
      control.textContent = "Inschrijven…";
      try {
        await request("/api/family-account/register", {
          edition: control.dataset.edition,
          familyId: control.dataset.family
        });
        account.signature = null;
        await refreshAccount();
        const created = account.items.find(item => item.edition === control.dataset.edition);
        if (created) {
          account.activeId = created.registration.id;
          account.view = { tab: "family", editingMemberId: null, openPeople: null };
          render();
        }
        feedback("Jullie zijn ingeschreven. Controleer de gezinsleden en kies daarna jullie bestelling.", "success");
      } catch (error) {
        feedback(error.message);
        control.disabled = false;
        control.textContent = "Inschrijven";
      }
      return;
    }
    if (action === "show-forgot") show("forgot");
    if (action === "show-login") show("login");
    if (action === "logout") {
      try {
        await request("/api/family-account/logout", {});
        token = "";
        account.items = [];
        show("login");
      } catch (error) {
        feedback(error.message);
      }
      return;
    }
    const item = activeItem();
    if (!item || item.accessRole === "viewer") return;
    const members = item.registration.members || (item.registration.members = []);
    if (action === "quantity") {
      const person = members.find(entry => entry.id === control.dataset.person);
      const product = control.dataset.product;
      if (!person || person.type === "Avondgast" || !item.catalog.some(entry => entry.id === product)) return;
      person.orders = person.orders || {};
      person.orders[product] = Math.max(
        0,
        Math.min(99, (Number(person.orders[product]) || 0) + Number(control.dataset.delta))
      );
      render();
      scheduleSave(item);
    }
    if (action === "edit-member") {
      account.view.editingMemberId = control.dataset.person;
      render();
      view.querySelector("[data-edit-member] input")?.focus();
    }
    if (action === "cancel-edit-member") {
      account.view.editingMemberId = null;
      render();
    }
    if (action === "remove-member") {
      const index = Number(control.dataset.index);
      const person = members[index];
      if (!person || members.length <= 1) return;
      const portions = Object.values(person.orders || {}).reduce((sum, qty) => sum + (Number(qty) || 0), 0);
      if (
        !window.confirm(
          person.name +
            " verwijderen uit jullie inschrijving?" +
            (portions ? " Ook de " + portions + " bestelde porties vervallen." : "")
        )
      )
        return;
      members.splice(index, 1);
      render();
      scheduleSave(item, { immediate: true });
    }
  });

  // Remember which people are expanded in the order tab across re-renders.
  view.addEventListener(
    "toggle",
    event => {
      const details = event.target.closest?.("[data-order-person]");
      if (!details) return;
      if (!account.view.openPeople) {
        account.view.openPeople = new Set(
          [...view.querySelectorAll("[data-order-person][open]")].map(node => node.dataset.orderPerson)
        );
      }
      if (details.open) account.view.openPeople.add(details.dataset.orderPerson);
      else account.view.openPeople.delete(details.dataset.orderPerson);
    },
    true
  );

  view.addEventListener("submit", async event => {
    const expenseForm = event.target.closest("[data-family-expense]");
    if (!expenseForm) return;
    event.preventDefault();
    const item = activeItem();
    if (!item) return;
    const amountCents = Math.round(Number(String(expenseForm.elements.amount.value).replace(",", ".")) * 100);
    const button = expenseForm.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      let receipt;
      const chosen = expenseForm.elements.receipt?.files?.[0];
      if (chosen) {
        button.textContent = "Kasticket uploaden…";
        const upload = new FormData();
        upload.append("file", await shrinkImage(chosen));
        upload.append("edition", item.edition);
        upload.append("registrationId", item.registration.id);
        const response = await fetch("/api/family-account/receipts", {
          method: "POST",
          credentials: "same-origin",
          body: upload
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "Het kasticket kon niet worden opgeladen.");
        receipt = result.receipt;
      }
      button.textContent = "Bewaren…";
      await request("/api/family-account/expenses", {
        edition: item.edition,
        registrationId: item.registration.id,
        expense: {
          receipt,
          id: expenseForm.dataset.familyExpense || undefined,
          description: expenseForm.elements.description.value.trim(),
          amountCents,
          date: expenseForm.elements.date.value,
          method: expenseForm.elements.method.value
        }
      });
      account.view.editingExpenseId = null;
      account.view.addCostOpen = false;
      account.signature = null;
      await refreshAccount();
      feedback("De kost is bewaard en verdeeld.", "success");
    } catch (error) {
      feedback(error.message);
      button.disabled = false;
      button.textContent = expenseForm.dataset.familyExpense ? "Bewaren" : "Kost toevoegen";
    }
  });

  view.addEventListener("submit", event => {
    const item = activeItem();
    const addForm = event.target.closest("[data-add-member]");
    const editForm = event.target.closest("[data-edit-member]");
    if (!addForm && !editForm) return;
    event.preventDefault();
    if (!item || item.accessRole === "viewer") return;
    const name = event.target.elements.memberName.value.trim();
    const type = event.target.elements.memberType.value;
    if (!name || !["Volwassene", "Kind", "Avondgast"].includes(type)) return;
    const members = item.registration.members || (item.registration.members = []);
    if (addForm) {
      if (members.length >= 30) {
        feedback("Een inschrijving kan maximaal 30 personen bevatten.");
        return;
      }
      members.push({ id: crypto.randomUUID(), name, type, orders: {} });
    } else {
      const person = members.find(entry => entry.id === editForm.dataset.editMember);
      if (!person) return;
      person.name = name;
      person.type = type;
      if (type === "Avondgast") person.orders = {}; // evening guests order no meat
      const diet = [...editForm.querySelectorAll('input[name="diet"]:checked')].map(input => input.value);
      const notes = (editForm.elements.notes?.value || "").trim();
      if (diet.length) person.diet = diet;
      else delete person.diet;
      if (notes) person.notes = notes;
      else delete person.notes;
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
      lengthHint.textContent =
        password.length + "/12 tekens" + (valid ? " · voldoende" : " · nog " + (12 - password.length) + " te gaan");
      lengthHint.dataset.valid = String(valid);
    }
    if (confirmHint) {
      const touched = confirm.length > 0;
      confirmHint.textContent = !touched
        ? "Vul hetzelfde wachtwoord opnieuw in."
        : password === confirm
          ? "De wachtwoorden komen overeen."
          : "De wachtwoorden komen nog niet overeen.";
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
    if (form.dataset.form === "login")
      submit(form, async () => {
        await request("/api/family-account/login", { email: values.email, password: values.password });
        await loadAccount();
      });
    if (form.dataset.form === "forgot")
      submit(form, async () => {
        await request("/api/family-account/forgot-password", { email: values.email });
        show("login");
        feedback(
          "Als dit e-mailadres bij een actief account hoort, ontvang je een e-mail met verdere instructies.",
          "success"
        );
      });
    if (form.dataset.form === "activate")
      submit(form, async () => {
        if (values.password.length < 12) throw new Error("Kies een wachtwoord van minstens 12 tekens.");
        if (values.password !== values.confirm) throw new Error("De wachtwoorden komen niet overeen.");
        await request("/api/family-account/activate", {
          token,
          password: values.password,
          displayName: values.displayName
        });
        token = "";
        await loadAccount();
      });
    if (form.dataset.form === "reset")
      submit(form, async () => {
        if (values.password.length < 12) throw new Error("Kies een wachtwoord van minstens 12 tekens.");
        if (values.password !== values.confirm) throw new Error("De wachtwoorden komen niet overeen.");
        await request("/api/family-account/reset-password", { token, password: values.password });
        token = "";
        show("login");
        feedback("Je wachtwoord is aangepast. Je kunt nu aanmelden.", "success");
      });
  });

  if (!activation && !reset && currentPanel !== "forgot") {
    try {
      await loadAccount();
    } catch {
      show("login");
    }
  } else {
    show(currentPanel);
  }
}
