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
      '<div class="admin-edition-row"><span><strong>'+escapeHtml(edition.label)+'</strong><br><small>'+escapeHtml(edition.startsAt || "Datum nog niet bepaald")+(edition.endsAt ? " – "+escapeHtml(edition.endsAt) : "")+'</small></span><span class="status neutral">'+escapeHtml(edition.status)+'</span><button type="button" class="button button-small button-outline" data-edit-edition="'+escapeHtml(edition.id)+'" data-parent-event="'+escapeHtml(event.id)+'">Wijzigen</button><button type="button" class="button button-small button-outline" data-edit-catalog="'+escapeHtml(edition.id)+'" data-parent-event="'+escapeHtml(event.id)+'">Catalogus ('+(edition.catalog || []).length+')</button></div>'
    ).join("") : '<p class="catalog-note">Nog geen edities voor dit evenement.</p>';
    return '<article class="admin-event-card"><div class="admin-event-card-head"><div><h3>'+escapeHtml(event.name)+'</h3><p>'+escapeHtml(event.description || "Geen beschrijving toegevoegd.")+'</p><div class="admin-event-meta">Code: '+escapeHtml(event.slug)+' · Financieel: '+escapeHtml(event.financeStrategy)+'</div></div><span class="status '+(event.status==="active"?"success":"neutral")+'">'+escapeHtml(event.status)+'</span><button type="button" class="button button-small button-outline" data-edit-event="'+escapeHtml(event.id)+'">Evenement wijzigen</button></div><div class="admin-editions">'+editions+'</div><form class="admin-edition-form" data-create-edition="'+escapeHtml(event.id)+'"><input name="label" maxlength="100" placeholder="Naam nieuwe editie" aria-label="Naam nieuwe editie" required><input name="startsAt" type="date" aria-label="Startdatum"><input name="endsAt" type="date" aria-label="Einddatum"><button class="button button-small button-dark" type="submit">+ Editie</button></form></article>';
  }).join("");
}

function catalogProductRow(product = {}, index = 0) {
  return '<div class="admin-catalog-item" data-catalog-item><div class="admin-catalog-item-fields"><label>Productnaam<input name="name" maxlength="100" required value="'+escapeHtml(product.name || "")+'" placeholder="Bijv. Steak"></label><label>Productcode<input name="id" maxlength="64" pattern="[A-Za-z0-9_-]{1,64}" required value="'+escapeHtml(product.id || "")+'" placeholder="bijv. steak"></label><label class="admin-catalog-image-field">Afbeelding (optioneel)<input name="image" maxlength="1000" value="'+escapeHtml(product.image || "")+'" placeholder="/media/products/… of https://…"></label></div><div class="admin-catalog-item-footer"><label class="admin-catalog-active"><input name="active" type="checkbox" '+(product.active === false ? "" : "checked")+'> Actief in familieportal</label><button type="button" class="button button-small button-outline" data-remove-catalog-item>Verwijderen</button></div></div>';
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
  const migrateButton = root.querySelector("[data-backfill-run]");
  let migrationPreviewSafe = false;

  root.querySelector("[data-backfill-preview]")?.addEventListener("click", async event => {
    const button = event.currentTarget;
    const target = root.querySelector("[data-backfill-result]");
    button.disabled = true;
    button.textContent = "Controleren…";
    target.textContent = "Bestaande gegevens worden alleen gelezen…";
    try {
      const result = await api("/api/admin/events/backfill-preview");
      const totals = result.totals || {};
      migrationPreviewSafe = result.readOnly === true && result.canBackfill === true && Number(totals.orphanedRegistrationLinks || 0) === 0 && Number(totals.orphanedAccountLinks || 0) === 0 && Number(totals.unsupportedEnvironmentLinks || 0) === 0;
      if (migrateButton) migrateButton.disabled = !migrationPreviewSafe;
      const rows = (result.environments || []).map(row =>
        '<div class="admin-backfill-row"><strong>'+escapeHtml(row.eventName)+' · '+escapeHtml(row.environment)+'</strong><span>'+row.registrations+' inschrijvingen</span><span>'+row.registrationsWithAccounts+' met account</span><span>'+row.accountLinks+' accountkoppelingen</span><span>'+row.orphanedRegistrationLinks+' verweesde koppelingen</span></div>'
      ).join("");
      const validation = (result.validationErrors || []).map(message => '<p class="catalog-note" data-error="true">'+escapeHtml(message)+'</p>').join("");
      target.innerHTML = validation + '<div class="admin-backfill-totals"><strong>'+Number(totals.familyAccounts||0)+' accounts</strong><strong>'+Number(totals.registrations||0)+' inschrijvingen</strong><strong>'+Number(totals.registrationsWithoutAccounts||0)+' zonder account</strong><strong>'+Number(totals.orphanedRegistrationLinks||0)+' verweesde koppelingen</strong></div>'+rows+'<p class="catalog-note">'+(migrationPreviewSafe ? "Controle geslaagd. De gegevensovername kan veilig worden gestart." : "Controle niet volledig geslaagd. De gegevensovername blijft geblokkeerd.")+' Er zijn geen gegevens aangemaakt, aangepast of verwijderd.</p>';
      feedback("Controle afgerond. Er is niets gewijzigd.");
    } catch (error) {
      migrationPreviewSafe = false;
      if (migrateButton) migrateButton.disabled = true;
      target.textContent = error.message;
      feedback(error.message, true);
    } finally {
      button.disabled = false;
      button.textContent = "Controle opnieuw uitvoeren";
    }
  });

  migrateButton?.addEventListener("click", async () => {
    if (!migrationPreviewSafe) return;
    const confirmation = window.prompt("Deze stap kopieert de huidige test- en livegegevens naar de nieuwe evenemententabellen. De oude gegevens blijven behouden. Er worden geen testgegevens verwijderd. Typ exact MIGRATE LEGACY DATA om te bevestigen:");
    if (confirmation !== "MIGRATE LEGACY DATA") return;
    migrateButton.disabled = true;
    feedback("Gegevens worden transactioneel overgenomen…");
    try {
      const result = await api("/api/admin/events/backfill", { method:"POST", body:JSON.stringify({confirm:confirmation}) });
      feedback("Overname afgerond: "+(result.migrated || []).map(row => row.environment+": "+row.registrations+" inschrijvingen").join(" · "));
      migrationPreviewSafe = false;
      const previewButton = root.querySelector("[data-backfill-preview]");
      previewButton?.click();
      await loadEvents();
    } catch (error) {
      feedback(error.message, true);
      migrateButton.disabled = false;
    }
  });
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
  root.querySelector("[data-admin-events-list]").addEventListener("click", async event => {
    const eventButton = event.target.closest("[data-edit-event]");
    const editionButton = event.target.closest("[data-edit-edition]");
    const catalogButton = event.target.closest("[data-edit-catalog]");
    if (catalogButton) {
      const card = catalogButton.closest(".admin-event-card");
      card.querySelector(".admin-inline-editor")?.remove();
      try {
        const result = await api("/api/admin/events");
        const item = (result.events || []).find(row => row.id === catalogButton.dataset.parentEvent);
        const edition = item?.editions.find(row => row.id === catalogButton.dataset.editCatalog);
        if (!edition) { feedback("Editie niet gevonden. Vernieuw de pagina en probeer opnieuw.", true); return; }
        const editor = document.createElement("form");
        editor.className = "admin-inline-editor admin-catalog-editor";
        editor.dataset.updateCatalog = edition.id;
        editor.dataset.parentEvent = item.id;
        const products = edition.catalog || [];
        const rows = products.map((product,index) => catalogProductRow(product,index)).join("");
        editor.innerHTML = '<div class="admin-catalog-editor-heading"><div><strong>Productcatalogus · '+escapeHtml(edition.label)+'</strong><p>Beheer de producten, afbeeldingen en zichtbaarheid voor deze editie.</p></div><button type="button" class="button button-small button-outline" data-add-catalog-item>+ Product toevoegen</button></div><div class="admin-catalog-items" data-catalog-items>'+rows+'</div><div class="admin-inline-actions"><button class="button button-small button-dark" type="submit">Catalogus opslaan</button><button class="button button-small button-outline" type="button" data-cancel-inline-edit>Annuleren</button></div>';
        card.append(editor);
        editor.scrollIntoView({behavior:"smooth",block:"nearest"});
      } catch (error) { feedback(error.message, true); }
      return;
    }
    if (event.target.closest("[data-cancel-inline-edit]")) {
      event.target.closest(".admin-inline-editor")?.remove();
      return;
    }
    if (event.target.closest("[data-add-catalog-item]")) {
      const editor = event.target.closest(".admin-catalog-editor");
      const list = editor?.querySelector("[data-catalog-items]");
      if (list) {
        list.insertAdjacentHTML("beforeend", catalogProductRow({active:true}, list.children.length));
        list.lastElementChild?.querySelector('[name="name"]')?.focus();
      }
      return;
    }
    if (event.target.closest("[data-remove-catalog-item]")) {
      event.target.closest("[data-catalog-item]")?.remove();
      return;
    }
    if (eventButton) {
      const card = eventButton.closest(".admin-event-card");
      card.querySelector(".admin-inline-editor")?.remove();
      try {
        const result = await api("/api/admin/events");
        const item = (result.events || []).find(row => row.id === eventButton.dataset.editEvent);
        if (!item) return;
        const editor = document.createElement("form");
        editor.className = "admin-inline-editor";
        editor.dataset.updateEvent = item.id;
        editor.innerHTML = '<label>Naam evenement<input name="name" maxlength="100" required value="'+escapeHtml(item.name)+'"></label><label>Beschrijving<textarea name="description" maxlength="1000" rows="2">'+escapeHtml(item.description || "")+'</textarea></label><label>Financiële verdeelmethode<select name="financeStrategy"><option value="nieuwjaar">Nieuwjaar · bestaande afrekening</option><option value="per_person">Gelijk per deelnemer</option><option value="per_adult">Per volwassene</option><option value="per_order">Per bestelling/portie</option><option value="none">Geen financiële afrekening</option></select></label><label>Status<select name="status"><option value="draft">Concept</option><option value="active">Actief</option><option value="archived">Gearchiveerd</option></select></label><div class="admin-inline-actions"><button class="button button-small button-dark" type="submit">Wijzigingen opslaan</button><button class="button button-small button-outline" type="button" data-cancel-inline-edit>Annuleren</button></div>';
        editor.querySelector('[name="financeStrategy"]').value = item.financeStrategy;
        editor.querySelector('[name="status"]').value = item.status;
        card.append(editor);
      } catch (error) { feedback(error.message, true); }
      return;
    }
    if (editionButton) {
      const card = editionButton.closest(".admin-event-card");
      card.querySelector(".admin-inline-editor")?.remove();
      try {
        const result = await api("/api/admin/events");
        const item = (result.events || []).find(row => row.id === editionButton.dataset.parentEvent);
        const edition = item?.editions.find(row => row.id === editionButton.dataset.editEdition);
        if (!edition) { feedback("Editie niet gevonden. Vernieuw de pagina en probeer opnieuw.", true); return; }
        const editor = document.createElement("form");
        editor.className = "admin-inline-editor";
        editor.dataset.updateEdition = edition.id;
        editor.dataset.parentEvent = item.id;
        editor.innerHTML = '<label>Naam editie<input name="label" maxlength="100" required value="'+escapeHtml(edition.label)+'"></label><label>Startdatum<input name="startsAt" type="date" value="'+escapeHtml(edition.startsAt || "")+'"></label><label>Einddatum<input name="endsAt" type="date" value="'+escapeHtml(edition.endsAt || "")+'"></label><label>Status<select name="status"><option value="draft">Concept</option><option value="open">Open</option><option value="closed">Gesloten</option><option value="archived">Gearchiveerd</option></select></label><div class="admin-inline-actions"><button class="button button-small button-dark" type="submit">Wijzigingen opslaan</button><button class="button button-small button-outline" type="button" data-cancel-inline-edit>Annuleren</button></div>';
        editor.querySelector('[name="status"]').value = edition.status;
        card.append(editor);
      } catch (error) { feedback(error.message, true); }
      return;
    }
  });
  root.querySelector("[data-admin-events-list]").addEventListener("submit", async event => {
    const catalogEditor = event.target.closest("[data-update-catalog]");
    if (catalogEditor) {
      event.preventDefault();
      const form = event.target;
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        const catalog = [...form.querySelectorAll("[data-catalog-item]")].map(row => ({
          id: row.querySelector('[name="id"]').value.trim(),
          name: row.querySelector('[name="name"]').value.trim(),
          image: row.querySelector('[name="image"]').value.trim(),
          active: row.querySelector('[name="active"]').checked
        }));
        if (catalog.length > 200) throw new Error("Een catalogus mag maximaal 200 producten bevatten.");
        const ids = catalog.map(product => product.id);
        if (new Set(ids).size !== ids.length) throw new Error("Elke productcode moet uniek zijn binnen deze catalogus.");
        if (catalog.some(product => !product.id || !product.name)) throw new Error("Vul voor elk product een naam en productcode in.");
        await api("/api/admin/events/"+encodeURIComponent(form.dataset.parentEvent)+"/editions/"+encodeURIComponent(form.dataset.updateCatalog)+"/catalog", {method:"PUT",body:JSON.stringify({catalog})});
        feedback("Catalogus opgeslagen.");
        await loadEvents();
      } catch (error) {
        feedback(error.message, true);
        button.disabled = false;
      }
      return;
    }
    const eventEditor = event.target.closest("[data-update-event]");
    const editionEditor = event.target.closest("[data-update-edition]");
    if (eventEditor || editionEditor) {
      event.preventDefault();
      const form = event.target;
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        const values = Object.fromEntries(new FormData(form).entries());
        const path = eventEditor
          ? "/api/admin/events/"+encodeURIComponent(form.dataset.updateEvent)
          : "/api/admin/events/"+encodeURIComponent(form.dataset.parentEvent)+"/editions/"+encodeURIComponent(form.dataset.updateEdition);
        await api(path, {method:"PATCH", body:JSON.stringify(values)});
        feedback(eventEditor ? "Evenement bijgewerkt." : "Editie bijgewerkt.");
        await loadEvents();
      } catch (error) {
        feedback(error.message, true);
        button.disabled = false;
      }
      return;
    }
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
