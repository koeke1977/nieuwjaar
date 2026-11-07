import { state } from "./demo-data.js";

const clone = value => JSON.parse(JSON.stringify(value));

function makeEditionId(name) {
  const slug = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${slug || "editie"}-${Date.now().toString(36)}`;
}

export function archiveCurrentAndStartNewEdition(name, copyCatalog = true) {
  const cleanName = String(name || "").trim();
  if (!cleanName) throw new Error("Geef de nieuwe editie een naam.");
  if (!state.activeEvent || state.activeEvent.status !== "active") throw new Error("Er is geen actieve editie om af te sluiten.");
  if (state.editionArchive.some(item => item.event?.name?.toLowerCase() === cleanName.toLowerCase())) {
    throw new Error("Er bestaat al een gearchiveerde editie met deze naam.");
  }

  const archivedAt = new Date().toISOString();
  const archive = {
    event: { ...clone(state.activeEvent), status: "archived", archivedAt },
    registrations: clone(state.registrations),
    expenses: clone(state.expenses),
    payments: clone(state.payments),
    costsFinalized: state.costsFinalized,
    costsFinalizedAt: state.costsFinalizedAt,
    catalog: clone(state.catalog),
    archivedAt
  };
  state.editionArchive = [...(state.editionArchive || []), archive];

  state.activeEvent = { id: makeEditionId(cleanName), name: cleanName, status: "active", createdAt: archivedAt };
  state.registrations = [];
  state.expenses = [];
  state.payments = [];
  state.costsFinalized = false;
  state.costsFinalizedAt = null;
  state.catalog = copyCatalog ? clone(archive.catalog) : [];
  state.activeRegistrationId = null;
  state.managingRegistrationId = null;
  state.editingMember = null;
  state.editingOwnMemberIndex = null;
  state.editingAdminMemberIndex = null;
  state.editingExpenseId = null;
  state.activeConsole = "admin";
  state.activeSection = "events";
  state.beheerEventView = "edition";
  state.beheerEditionTab = "edition";
  return archive;
}
