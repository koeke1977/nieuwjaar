import template from "./users.html?raw";
import "./users.css";

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
let registrations = [];
let environment = "live";
let root = null;

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: "same-origin", ...options, headers: { ...(options.body ? {"Content-Type":"application/json"} : {}), ...(options.headers || {}) } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "De aanvraag is mislukt.");
  return result;
}

function feedback(message, error = false) {
  const target = root?.querySelector("[data-family-users-feedback]");
  if (target) { target.textContent = message; target.classList.toggle("family-user-feedback-error", error); }
}

function renderRows(users) {
  root.querySelector("[data-family-users-count]").textContent = users.length + (users.length === 1 ? " account" : " accounts");
  const list = root.querySelector("[data-family-users-list]");
  if (!users.length) { list.innerHTML = '<p class="catalog-note">Nog geen familieaccounts. Nodig hierboven het eerste gezin uit.</p>'; return; }
  list.innerHTML = users.map(user => {
    const status = user.status === "active" ? "Actief" : user.status === "disabled" ? "Geblokkeerd" : "Uitgenodigd";
    const links = user.registrations.map(link => '<span class="family-user-link"><span>'+escapeHtml(registrations.find(item => item.id === link.registrationId)?.name || link.registrationId)+'</span><select aria-label="Toegangsrol" data-user-action="role" data-user-id="'+user.id+'" data-link-id="'+link.linkId+'" data-previous-role="'+(link.role || "editor")+'"><option value="owner" '+(link.role==="owner"?"selected":"")+'>Beheerder</option><option value="editor" '+(link.role==="editor"?"selected":"")+'>Bewerker</option><option value="viewer" '+(link.role==="viewer"?"selected":"")+'>Lezer</option></select><button type="button" data-user-action="unlink" data-user-id="'+user.id+'" data-link-id="'+link.linkId+'" aria-label="Koppeling verwijderen">×</button></span>').join("");
    const available = registrations.filter(item => !user.registrations.some(link => link.registrationId === item.id));
    const linkEditor = available.length ? '<form class="family-user-link-form" data-link-user="'+user.id+'"><select name="registrationId" aria-label="Extra inschrijving"><option value="">Extra inschrijving koppelen</option>'+available.map(item => '<option value="'+escapeHtml(item.id)+'">'+escapeHtml(item.name)+'</option>').join("")+'</select><button type="submit">Koppelen</button></form>' : '';
    return '<article class="family-user-row"><div class="family-user-main"><strong>'+escapeHtml(user.displayName || user.email)+'</strong><small>'+escapeHtml(user.email)+' · <span class="family-user-status '+(user.status==="disabled"?"disabled":"")+'">'+status+'</span></small><div class="family-user-links">'+(links || '<span>Geen koppeling in deze omgeving</span>')+'</div>'+linkEditor+'</div><div class="family-user-actions">'+(user.status==="invited" ? '<button class="button button-small button-outline" data-user-action="resend" data-user-id="'+user.id+'">Opnieuw uitnodigen</button>' : '')+(user.status==="disabled" ? '<button class="button button-small button-outline" data-user-action="activate" data-user-id="'+user.id+'">Deblokkeren</button>' : user.status==="active" ? '<button class="button button-small button-outline" data-user-action="disable" data-user-id="'+user.id+'">Blokkeren</button>' : '')+(user.status==="active" ? '<button class="text-button" data-user-action="sessions" data-user-id="'+user.id+'">Sessies intrekken</button>' : '')+'<button class="text-button danger-text" data-user-action="delete" data-user-id="'+user.id+'" data-user-email="'+escapeHtml(user.email)+'">Definitief verwijderen</button>'+'</div></article>';
  }).join("");
}

async function loadNormalizedEditions() {
  const select = root?.querySelector("[data-normalized-editions]");
  if (!select) return;
  const result = await api("/api/admin/events");
  const options = (result.events || []).flatMap(event => (event.editions || [])
    .filter(edition => !["archived"].includes(edition.status) && event.status !== "archived")
    .map(edition => ({ id: edition.id, label: event.name + " · " + edition.label })));
  select.innerHTML = '<option value="">Kies een evenementeditie</option>' + options.map(item => '<option value="'+escapeHtml(item.id)+'">'+escapeHtml(item.label)+'</option>').join("");
  if (!options.length) select.innerHTML = '<option value="">Maak eerst een evenement en editie aan</option>';
}

function renderNormalizedFamilyOptions(families) {
  const select = root?.querySelector("[data-normalized-family-options]");
  if (!select) return;
  select.innerHTML = '<option value="">Kies een familie</option>' + families.map(family => '<option value="'+escapeHtml(family.id)+'">'+escapeHtml(family.name)+'</option>').join("");
}

async async function loadNormalizedFamilies() {
  const target = root?.querySelector("[data-normalized-families]");
  if (!target) return;
  try {
    const result = await api("/api/admin/families");
    const families = result.families || [];
    renderNormalizedFamilyOptions(families);
    root.querySelector("[data-normalized-family-count]").textContent = families.length + (families.length === 1 ? " families" : " families");
    if (!families.length) {
      target.innerHTML = '<p class="catalog-note">Er zijn nog geen relationele families aangemaakt.</p>';
      return;
    }
    target.innerHTML = families.map(family => {
      const accounts = family.accounts.map(account =>
        '<span class="family-user-link"><span>'+escapeHtml(account.displayName || account.email)+' · '+escapeHtml(account.email)+'</span><select aria-label="Familierol" data-normalized-membership-role data-family-id="'+escapeHtml(family.id)+'" data-user-id="'+escapeHtml(account.id)+'" data-previous-role="'+escapeHtml(account.role || "editor")+'"><option value="owner" '+(account.role==="owner"?"selected":"")+'>Beheerder</option><option value="editor" '+(account.role==="editor"?"selected":"")+'>Bewerker</option><option value="viewer" '+(account.role==="viewer"?"selected":"")+'>Lezer</option></select><button type="button" data-normalized-membership-remove data-family-id="'+escapeHtml(family.id)+'" data-user-id="'+escapeHtml(account.id)+'" aria-label="Account loskoppelen">×</button><small>'+escapeHtml(account.status || "")+'</small></span>'
      ).join("");
      const registrations = family.registrations.map(item =>
        '<div class="family-normalized-registration"><strong>'+escapeHtml(item.event || "Evenement")+'</strong><span>'+escapeHtml(item.edition || "Editie")+' · '+escapeHtml(item.name || "Inschrijving")+'</span><small>'+escapeHtml(item.status || "")+' · '+escapeHtml(item.financeStrategy || "geen financiële strategie")+(item.invalidData ? " · gegevens nakijken" : "")+'</small></div>'
      ).join("");
      return '<article class="family-user-row"><div class="family-user-main"><strong>'+escapeHtml(family.name || "Familie")+'</strong><small>'+escapeHtml(family.contactEmail || "Geen contactadres")+'</small><div class="family-users-links">'+(accounts || '<span>Geen accounts gekoppeld</span>')+'</div><div class="family-normalized-registrations">'+(registrations || '<span>Geen evenementinschrijvingen</span>')+'</div></div></article>';
    }).join("");
  } catch (error) {
    target.innerHTML = '<p class="catalog-note">'+escapeHtml(error.message || "Relationele gegevens niet beschikbaar.")+'</p>';
    root.querySelector("[data-normalized-family-count]").textContent = "Niet beschikbaar";
  }
}

async function loadUsers() {
  const result = await api("/api/admin/family-users?environment="+encodeURIComponent(environment));
  renderRows(result.users || []);
}

export function renderAdminUsersSection(currentRegistrations, currentEnvironment) {
  registrations = Array.isArray(currentRegistrations) ? currentRegistrations : [];
  environment = currentEnvironment;
  const wrapper = document.createElement("div");
  wrapper.innerHTML = template;
  const select = wrapper.querySelector('select[name="registrationId"]');
  select.innerHTML = '<option value="">Kies een inschrijving</option>' + registrations.map(item => '<option value="'+escapeHtml(item.id)+'">'+escapeHtml(item.name)+'</option>').join("");
  return wrapper.innerHTML;
}

export function initAdminUsersSection() {
  root = document.querySelector(".content");
  if (!root?.querySelector("#family-user-create-form")) return;
  loadUsers().catch(error => feedback(error.message, true));
  loadNormalizedFamilies();
  loadNormalizedEditions().catch(error => {
    const feedbackTarget = root.querySelector("[data-normalized-family-feedback]");
    if (feedbackTarget) feedbackTarget.textContent = error.message;
  });
  root.querySelector("[data-create-normalized-family]")?.addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget, button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const values = Object.fromEntries(new FormData(form).entries());
      await api("/api/admin/families", { method: "POST", body: JSON.stringify(values) });
      form.reset();
      const target = root.querySelector("[data-normalized-family-feedback]");
      if (target) target.textContent = "Familie en inschrijving zijn aangemaakt.";
      await loadNormalizedFamilies();
    } catch (error) {
      const target = root.querySelector("[data-normalized-family-feedback]");
      if (target) target.textContent = error.message;
    } finally { button.disabled = false; }
  });
  root.querySelector("[data-normalized-families]")?.addEventListener("change", async event => {
    const select = event.target.closest("[data-normalized-membership-role]");
    if (!select) return;
    const previous = select.dataset.previousRole || "editor";
    select.disabled = true;
    try {
      await api("/api/admin/families/"+encodeURIComponent(select.dataset.familyId)+"/memberships/"+encodeURIComponent(select.dataset.userId), { method: "PATCH", body: JSON.stringify({ role: select.value }) });
      select.dataset.previousRole = select.value;
      const target = root.querySelector("[data-normalized-family-feedback]");
      if (target) target.textContent = "Familierol aangepast.";
    } catch (error) {
      select.value = previous;
      const target = root.querySelector("[data-normalized-family-feedback]");
      if (target) target.textContent = error.message;
    } finally { select.disabled = false; }
  });
  root.querySelector("[data-normalized-families]")?.addEventListener("click", async event => {
    const button = event.target.closest("[data-normalized-membership-remove]");
    if (!button) return;
    if (!window.confirm("Dit account loskoppelen van deze familie? Het account en de inschrijvingen blijven behouden.")) return;
    button.disabled = true;
    try {
      await api("/api/admin/families/"+encodeURIComponent(button.dataset.familyId)+"/memberships/"+encodeURIComponent(button.dataset.userId), { method: "DELETE" });
      const target = root.querySelector("[data-normalized-family-feedback]");
      if (target) target.textContent = "Account losgekoppeld van de familie.";
      await loadNormalizedFamilies();
    } catch (error) {
      const target = root.querySelector("[data-normalized-family-feedback]");
      if (target) target.textContent = error.message;
      button.disabled = false;
    }
  });
  root.querySelector("[data-add-normalized-member]")?.addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget, button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const values = Object.fromEntries(new FormData(form).entries());
      const result = await api("/api/admin/families/memberships", { method: "POST", body: JSON.stringify(values) });
      form.reset();
      const target = root.querySelector("[data-normalized-family-feedback]");
      if (target) target.textContent = result.mailFailed ? result.error : result.invited ? "Account gekoppeld en uitnodiging verzonden." : "Account aan de familie gekoppeld.";
      await loadNormalizedFamilies();
    } catch (error) {
      const target = root.querySelector("[data-normalized-family-feedback]");
      if (target) target.textContent = error.message;
    } finally { button.disabled = false; }
  });
  const form = root.querySelector("#family-user-create-form");
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    feedback("Uitnodiging wordt aangemaakt…");
    const values = Object.fromEntries(new FormData(form).entries());
    try {
      const result = await api("/api/admin/family-users", { method:"POST", body:JSON.stringify({...values, environment}) });
      feedback(result.invited ? "Account aangemaakt en uitnodiging verzonden." : "Inschrijving aan het bestaande account gekoppeld.");
      form.reset();
      await loadUsers();
    } catch (error) { feedback(error.message, true); }
    finally { button.disabled = false; }
  });
  root.querySelector("[data-family-users-list]").addEventListener("submit", async event => {
    const form = event.target.closest("[data-link-user]");
    if (!form) return;
    event.preventDefault();
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      await api("/api/admin/family-users/"+form.dataset.linkUser+"/registrations", {
        method: "POST", body: JSON.stringify({ environment, registrationId: form.elements.registrationId.value })
      });
      feedback("Inschrijving gekoppeld.");
      await loadUsers();
    } catch (error) { feedback(error.message, true); button.disabled = false; }
  });
  root.querySelector("[data-family-users-list]").addEventListener("change", async event => {
    const select = event.target.closest('select[data-user-action="role"]');
    if (!select) return;
    const previous = select.dataset.previousRole || "editor";
    select.disabled = true;
    try {
      await api("/api/admin/family-users/"+select.dataset.userId+"/registrations", {
        method: "PATCH", body: JSON.stringify({ linkId: Number(select.dataset.linkId), role: select.value })
      });
      feedback("Toegangsrol aangepast.");
      select.dataset.previousRole = select.value;
    } catch (error) {
      select.value = previous;
      feedback(error.message, true);
    } finally { select.disabled = false; }
  });
  root.querySelector("[data-family-users-list]").addEventListener("click", async event => {
    const button = event.target.closest("[data-user-action]");
    if (!button) return;
    const action = button.dataset.userAction, id = button.dataset.userId;
    if (action === "unlink" && !window.confirm("Deze inschrijvingskoppeling verwijderen? De inschrijving zelf blijft behouden.")) return;
    if (action === "delete") {
      const email = button.dataset.userEmail || "";
      const confirmation = window.prompt("Dit verwijdert het account en de bijbehorende testinschrijving met alle gezinsleden en bestellingen. Live-inschrijvingen blijven behouden. Typ exact dit e-mailadres om te bevestigen:\n\n" + email);
      if (confirmation !== email) return;
    }
    button.disabled = true;
    try {
      if (action === "unlink") await api("/api/admin/family-users/"+id+"/registrations?linkId="+encodeURIComponent(button.dataset.linkId), {method:"DELETE"});
      if (action === "delete") await api("/api/admin/family-users/"+id, {method:"DELETE", body:JSON.stringify({confirmEmail:button.dataset.userEmail, removeTestRegistration:true})});
      if (action === "resend") await api("/api/admin/family-users/"+id+"/resend", {method:"POST"});
      if (action === "sessions") await api("/api/admin/family-users/"+id+"/sessions", {method:"POST"});
      if (action === "disable" || action === "activate") await api("/api/admin/family-users/"+id, {method:"PATCH",body:JSON.stringify({status:action==="disable"?"disabled":"active"})});
      feedback(action==="resend" ? "Nieuwe uitnodiging verzonden." : action==="sessions" ? "Alle actieve sessies zijn ingetrokken." : action==="unlink" ? "Inschrijvingskoppeling verwijderd." : action==="delete" ? "Account en bijbehorende testinschrijving definitief verwijderd." : "Accountstatus aangepast.");
      await loadUsers();
    } catch (error) { feedback(error.message, true); button.disabled = false; }
  });
}
