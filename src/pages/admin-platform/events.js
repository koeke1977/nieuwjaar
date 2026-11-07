import template from "./events.html?raw";
import "./events.css";

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
let root;

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: "same-origin", ...options,
    headers: { ...(options.body ? {"Content-Type":"application/json"} : {}), ...(options.headers || {}) } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "De aanvraag is mislukt.");
  return result;
}

function feedback(message, error = false) {
  const target = root?.querySelector("[data-admin-events-feedback]");
  if (!target) return;
  target.textContent = message;
  target.dataset.error = String(error);
}

function renderEvents(events) {
  root.querySelector("[data-admin-events-count]").textContent = events.length + (events.length === 1 ? " evenement" : " evenementen");
  const target = root.querySelector("[data-admin-events-list]");
  if (!events.length) {
    target.innerHTML = '<div class="panel"><p class="catalog-note">Nog geen evenementen aangemaakt. Maak hierboven je eerste evenement aan.</p></div>';
    return;
  }
  target.innerHTML = events.map(event => {
    const editions = event.editions.length ? event.editions.map(edition =>
      '<div class="admin-edition-row"><span><strong>'+escapeHtml(edition.label)+'</strong><br><small>'+escapeHtml(edition.startsAt || "Datum nog niet bepaald")+(edition.endsAt ? " – "+escapeHtml(edition.endsAt) : "")+'</small></span><span class="status neutral">'+escapeHtml(edition.status)+'</span></div>'
    ).join("") : '<p class="catalog-note">Nog geen edities voor dit evenement.</p>';
    return '<article class="admin-event-card"><div class="admin-event-card-head"><div><h3>'+escapeHtml(event.name)+'</h3><p>'+escapeHtml(event.description || "Geen beschrijving toegevoegd.")+'</p><div class="admin-event-meta">Code: '+escapeHtml(event.slug)+' · Financieel: '+escapeHtml(event.financeStrategy)+'</div></div><span class="status '+(event.status==="active"?"success":"neutral")+'">'+escapeHtml(event.status)+'</span></div><div class="admin-editions">'+editions+'</div><form class="admin-edition-form" data-create-edition="'+escapeHtml(event.id)+'"><input name="label" maxlength="100" placeholder="Naam nieuwe editie" aria-label="Naam nieuwe editie" required><input name="startsAt" type="date" aria-label="Startdatum"><input name="endsAt" type="date" aria-label="Einddatum"><button class="button button-small button-dark" type="submit">+ Editie</button></form></article>';
  }).join("");
}

async function loadEvents() {
  try {
    const result = await api("/api/admin/events");
    renderEvents(result.events || []);
  } catch (error) {
    root.querySelector("[data-admin-events-list]").innerHTML = '<div class="panel"><p class="catalog-note">'+escapeHtml(error.message)+'</p></div>';
    feedback(error.message, true);
  }
}

export function renderAdminEventsSection() {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = template;
  return wrapper.innerHTML;
}

export function initAdminEventsSection() {
  root = document.querySelector(".content");
  if (!root?.querySelector("#admin-event-create-form")) return;
  loadEvents();
  root.querySelector("#admin-event-create-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const values = Object.fromEntries(new FormData(form).entries());
      await api("/api/admin/events", { method:"POST", body:JSON.stringify(values) });
      form.reset();
      feedback("Evenement aangemaakt.");
      await loadEvents();
    } catch (error) { feedback(error.message, true); }
    finally { button.disabled = false; }
  });
  root.querySelector("[data-admin-events-list]").addEventListener("submit", async event => {
    const form = event.target.closest("[data-create-edition]");
    if (!form) return;
    event.preventDefault();
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      const values = Object.fromEntries(new FormData(form).entries());
      await api("/api/admin/events/"+encodeURIComponent(form.dataset.createEdition)+"/editions", { method:"POST", body:JSON.stringify(values) });
      feedback("Editie aangemaakt.");
      await loadEvents();
    } catch (error) { feedback(error.message, true); button.disabled = false; }
  });
}
