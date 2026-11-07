import { state } from "./demo-data.js";

const clone = value => JSON.parse(JSON.stringify(value));
const fields = [
  "activeEvent",
  "expenses",
  "editionArchive",
  "costsFinalized",
  "costsFinalizedAt",
  "registrations",
  "payments",
  "catalog"
  // activeRegistrationId / managingRegistrationId are UI selection only. They are no longer
  // persisted: saving them made merely browsing the admin bump the shared app_state revision,
  // which caused needless "intussen gewijzigd" conflicts for families saving at the same time.
];

function captureEnvironment() {
  return Object.fromEntries(fields.map(field => [field, clone(state[field])]));
}

function applyEnvironment(data) {
  fields.forEach(field => {
    state[field] = clone(data[field]);
  });
  state.activeRegistrationId = state.registrations.some(item => item.id === state.activeRegistrationId)
    ? state.activeRegistrationId
    : (state.registrations[0]?.id || null);
  state.managingRegistrationId = state.registrations.some(item => item.id === state.managingRegistrationId)
    ? state.managingRegistrationId
    : (state.registrations[0]?.id || null);
  state.editingMember = null;
  state.editingOwnMemberIndex = null;
  state.editingAdminMemberIndex = null;
  state.editingExpenseId = null;
}

const initialTestData = captureEnvironment();
const liveCatalog = clone(state.catalog);
const initialLiveData = {
  activeEvent: { id: "nieuwjaar-2026-2027-live", name: "Nieuwjaar 2026–2027", status: "active" },
  expenses: [],
  editionArchive: [],
  costsFinalized: false,
  costsFinalizedAt: null,
  registrations: [],
  payments: [],
  catalog: liveCatalog,
  activeRegistrationId: null,
  managingRegistrationId: null
};

state.activeEnvironment = "test";
state.environmentData = {
  test: initialTestData,
  live: initialLiveData
};

export function switchEnvironment(environment) {
  if (!["test", "live"].includes(environment) || environment === state.activeEnvironment) return false;
  state.environmentData[state.activeEnvironment] = captureEnvironment();
  applyEnvironment(state.environmentData[environment]);
  state.activeEnvironment = environment;
  state.activeSection = "overview";
  return true;
}

export function resetTestEnvironment() {
  if (state.activeEnvironment !== "test") return false;
  const freshTestData = clone(initialTestData);
  state.environmentData.test = freshTestData;
  applyEnvironment(freshTestData);
  state.activeSection = "overview";
  return true;
}

export function getEnvironmentLabel() {
  return state.activeEnvironment === "test" ? "Testomgeving" : "Echte editie";
}

const clonePersisted = value => JSON.parse(JSON.stringify(value));

export function getPersistableEnvironmentData() {
  state.environmentData[state.activeEnvironment] = captureEnvironment();
  const snapshot = clonePersisted(state.environmentData);
  for (const environment of ["test", "live"]) {
    snapshot[environment].catalog = (snapshot[environment].catalog || []).map(product => ({ ...product, image: typeof product.image === "string" && (product.image.startsWith("/images/") || product.image.startsWith("/media/")) ? product.image : null }));
    snapshot[environment].editionArchive = (snapshot[environment].editionArchive || []).map(edition => ({ ...edition, catalog: (edition.catalog || []).map(product => ({ ...product, image: typeof product.image === "string" && (product.image.startsWith("/images/") || product.image.startsWith("/media/")) ? product.image : null })) }));
  }
  return snapshot;
}

// Replace the data of one environment with a newer server version, keeping the
// admin's UI state (open family, edit forms) intact where it still makes sense.
export function applyLatestEnvironmentData(environment, data) {
  if (!data || typeof data !== "object") return;
  state.environmentData[environment] = clonePersisted(data);
  if (environment !== state.activeEnvironment) return;
  fields.forEach(field => { if (field in data) state[field] = clonePersisted(data[field]); });
  const ids = new Set((state.registrations || []).map(item => item.id));
  if (!ids.has(state.activeRegistrationId)) state.activeRegistrationId = state.registrations[0]?.id || null;
  if (!ids.has(state.managingRegistrationId)) state.managingRegistrationId = state.registrations[0]?.id || null;
  if (state.beheerFamilyId && !ids.has(state.beheerFamilyId)) state.beheerFamilyId = null;
  if (state.editingExpenseId && !(state.expenses || []).some(item => item.id === state.editingExpenseId)) state.editingExpenseId = null;
}

export function restorePersistedEnvironmentData(environments) {
  if (!environments || typeof environments !== "object") return;
  for (const environment of ["test", "live"]) {
    const data = environments[environment];
    if (!data || typeof data !== "object") continue;
    state.environmentData[environment] = clonePersisted(data);
  }
  applyEnvironment(state.environmentData[state.activeEnvironment] || initialTestData);
}
