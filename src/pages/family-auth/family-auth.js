import template from "./family-auth.html?raw";
import "./family-auth.css";

const root = () => document.querySelector("#app");
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const request = async (path, body, method = "POST") => {
  const response = await fetch(path, { method, credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Er liep iets mis. Probeer opnieuw.");
  return result;
};

export async function startFamilyAuth() {
  root().innerHTML = template;
  const view = root();
  const path = location.pathname;
  const activation = path.match(/^\/familie\/activeren\/([^/]+)\/?$/);
  const reset = path.match(/^\/familie\/wachtwoord-reset\/([^/]+)\/?$/);
  let token = activation?.[1] || reset?.[1] || "";
  let currentPanel = activation ? "activate" : reset ? "reset" : path === "/familie/wachtwoord-vergeten" ? "forgot" : "login";
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

  view.addEventListener("click", async event => {
    const control = event.target.closest("[data-action]");
    const action = control?.dataset.action;
    if (action === "show-forgot") show("forgot");
    if (action === "show-login") show("login");
    if (action === "logout") {
      try { await request("/api/family-account/logout", {}); token = ""; show("login"); }
      catch (error) { feedback(error.message); }
    }
    if (action === "quantity") {
      const card = control.closest("[data-registration]");
      const item = (window.__familyRegistrations || []).find(entry => entry.registration.id === card?.dataset.registration);
      const person = item?.registration.members.find(entry => entry.id === control.dataset.person);
      const product = control.dataset.product;
      if (!item || !person || !item.catalog.some(entry => entry.id === product)) return;
      person.orders = person.orders || {};
      person.orders[product] = Math.max(0, Math.min(99, (Number(person.orders[product]) || 0) + Number(control.dataset.delta)));
      await saveRegistration(item);
    }
  });
  view.addEventListener("submit", event => {
    const form = event.target.closest("[data-add-member]");
    if (!form) return;
    event.preventDefault();
    const item = (window.__familyRegistrations || []).find(entry => entry.registration.id === form.dataset.addMember);
    const name = form.elements.memberName.value.trim();
    const type = form.elements.memberType.value;
    if (!item || !name || !["Volwassene", "Kind"].includes(type)) return;
    item.registration.members = item.registration.members || [];
    item.registration.members.push({ id: crypto.randomUUID(), name, type, orders: {} });
    saveRegistration(item);
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
      if (values.password !== values.confirm) throw new Error("De wachtwoorden komen niet overeen.");
      await request("/api/family-account/activate", { token, password: values.password, displayName: values.displayName });
      token = ""; await loadAccount();
    });
    if (form.dataset.form === "reset") submit(form, async () => {
      if (values.password !== values.confirm) throw new Error("De wachtwoorden komen niet overeen.");
      await request("/api/family-account/reset-password", { token, password: values.password });
      token = ""; show("login"); feedback("Je wachtwoord is aangepast. Je kunt nu aanmelden.", "success");
    });
  });


  function renderRegistrations(items) {
    const target = view.querySelector("[data-account-registrations]");
    if (!items.length) {
      target.innerHTML = '<div class="family-auth-notice">Je account is actief, maar er is nog geen inschrijving aan gekoppeld. Neem contact op met de organisatie als je dit niet verwacht.</div>';
      return;
    }
    target.innerHTML = items.map(item => {
      const registration = item.registration || {};
      const members = Array.isArray(registration.members) ? registration.members : [];
      const catalog = Array.isArray(item.catalog) ? item.catalog : [];
      const orders = members.map(person => {
        const productControls = catalog.map(product => {
          const quantity = Number(person.orders?.[product.id]) || 0;
          return '<div class="family-account-product"><span>'+escapeHtml(product.name)+'</span><div><button type="button" data-action="quantity" data-person="'+escapeHtml(person.id)+'" data-product="'+escapeHtml(product.id)+'" data-delta="-1" aria-label="Minder">−</button><b>'+quantity+'</b><button type="button" data-action="quantity" data-person="'+escapeHtml(person.id)+'" data-product="'+escapeHtml(product.id)+'" data-delta="1" aria-label="Meer">+</button></div></div>';
        }).join("");
        return '<article class="family-account-member"><div class="family-account-person"><strong>'+escapeHtml(person.name)+'</strong><small>'+escapeHtml(person.type || "Deelnemer")+'</small></div><div class="family-account-products">'+(productControls || '<span>Geen actieve producten.</span>')+'</div></article>';
      }).join("");
      return '<section class="family-account-registration" data-registration="'+escapeHtml(registration.id)+'"><div class="family-account-registration-heading"><div><p class="family-auth-eyebrow">'+escapeHtml(item.event || "Nieuwjaar")+' · '+(item.edition==="test"?"TESTEDITIE":"LIVE-EDITIE")+'</p><h2>'+escapeHtml(registration.name || "Jullie inschrijving")+'</h2></div><span>'+members.length+' deelnemers</span></div><div class="family-account-members">'+(orders || '<p class="family-auth-notice">Er zijn nog geen individuele deelnemers toegevoegd aan deze inschrijving.</p>')+'</div><form class="family-account-add" data-add-member="'+escapeHtml(registration.id)+'"><input name="memberName" aria-label="Naam gezinslid" placeholder="Naam gezinslid" maxlength="80" required><select name="memberType" aria-label="Categorie"><option value="Volwassene">Volwassene</option><option value="Kind">Kind</option></select><button type="submit">Persoon toevoegen</button></form></section>';
    }).join("");
  }
  async function saveRegistration(item) {
    if (item.saving) return;
    item.saving = true;
    const card = view.querySelector('[data-registration="' + CSS.escape(item.registration.id) + '"]');
    card?.querySelectorAll("button, input, select").forEach(control => { control.disabled = true; });
    feedback("");
    try {
      const result = await request("/api/family-account/registration", {
        edition: item.edition, registrationId: item.registration.id,
        revision: item.revision, members: item.registration.members
      }, "PUT");
      item.revision = result.revision;
      item.registration = result.registration;
      // Alle inschrijvingen van dezelfde editie delen één app_state-revisie.
      // Werk die dus samen bij om onnodige conflicten bij een volgende save te vermijden.
      (window.__familyRegistrations || []).forEach(entry => {
        if (entry.edition === item.edition) entry.revision = result.revision;
      });
      renderRegistrations(window.__familyRegistrations || []);
      feedback("De wijzigingen zijn bewaard.", "success");
    } catch (error) {
      feedback(error.message || "Opslaan is niet gelukt.");
      if (error.message?.includes("gewijzigd")) await loadAccount();
    } finally {
      item.saving = false;
      card?.querySelectorAll("button, input, select").forEach(control => { control.disabled = false; });
    }
  }
  async function loadAccount() {
    const response = await fetch("/api/family-account/session", { credentials: "same-origin" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.authenticated) { show("login"); return; }
    view.querySelector("[data-account-heading]").textContent = result.user?.displayName ? "Welkom, " + result.user.displayName + "." : "Welkom.";
    view.querySelector("[data-account-email]").textContent = result.user?.email || "";
    window.__familyRegistrations = result.registrations || [];
    renderRegistrations(window.__familyRegistrations);
    show("account");
  }

  if (!activation && !reset && currentPanel !== "forgot") {
    try { await loadAccount(); } catch { show("login"); }
  } else {
    show(currentPanel);
  }
}
