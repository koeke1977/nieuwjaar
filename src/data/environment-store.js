import { state } from "./demo-data.js";

// Production only: the admin works on exactly one edition, stored as app_state "live".
export const LIVE = "live";

const clone = value => JSON.parse(JSON.stringify(value));
// Persisted edition fields. UI selection (active/managing registration) is deliberately
// not persisted: saving it made merely browsing the admin bump the shared revision.
const fields = [
  "activeEvent",
  "expenses",
  "editionArchive",
  "costsFinalized",
  "costsFinalizedAt",
  "registrations",
  "payments",
  "catalog"
];

const emptyLiveData = {
  activeEvent: { id: "nieuwjaar-2026-2027-live", name: "Nieuwjaar 2026–2027", status: "active" },
  expenses: [],
  editionArchive: [],
  costsFinalized: false,
  costsFinalizedAt: null,
  registrations: [],
  payments: [],
  catalog: clone(state.catalog)
};

state.activeEnvironment = LIVE;
state.environmentData = { live: clone(emptyLiveData) };

function captureEnvironment() {
  return Object.fromEntries(fields.map(field => [field, clone(state[field])]));
}

function keepSelectionValid() {
  const ids = new Set((state.registrations || []).map(item => item.id));
  if (!ids.has(state.activeRegistrationId)) state.activeRegistrationId = state.registrations[0]?.id || null;
  if (!ids.has(state.managingRegistrationId)) state.managingRegistrationId = state.registrations[0]?.id || null;
  if (state.beheerFamilyId && !ids.has(state.beheerFamilyId)) state.beheerFamilyId = null;
  if (state.editingExpenseId && !(state.expenses || []).some(item => item.id === state.editingExpenseId)) state.editingExpenseId = null;
}

const safeImage = image => typeof image === "string" && (image.startsWith("/images/") || image.startsWith("/media/")) ? image : null;

export function getPersistableEnvironmentData() {
  state.environmentData.live = captureEnvironment();
  const snapshot = clone(state.environmentData);
  snapshot.live.catalog = (snapshot.live.catalog || []).map(product => ({ ...product, image: safeImage(product.image) }));
  snapshot.live.editionArchive = (snapshot.live.editionArchive || []).map(edition => ({ ...edition, catalog: (edition.catalog || []).map(product => ({ ...product, image: safeImage(product.image) })) }));
  return snapshot;
}

// Replace the edition data with a newer server version, keeping the admin's UI state
// (open family, edit forms) intact where it still makes sense.
export function applyLatestEnvironmentData(environment, data) {
  if (environment !== LIVE || !data || typeof data !== "object") return;
  state.environmentData.live = clone(data);
  fields.forEach(field => { if (field in data) state[field] = clone(data[field]); });
  keepSelectionValid();
}

export function restorePersistedEnvironmentData(environments) {
  const data = environments?.live && typeof environments.live === "object" ? environments.live : emptyLiveData;
  state.environmentData.live = clone(data);
  fields.forEach(field => { state[field] = clone(data[field] ?? emptyLiveData[field]); });
  state.editingMember = null;
  state.editingOwnMemberIndex = null;
  state.editingAdminMemberIndex = null;
  state.editingExpenseId = null;
  keepSelectionValid();
}
