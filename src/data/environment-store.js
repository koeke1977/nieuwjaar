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
  "catalog",
  "activeRegistrationId",
  "managingRegistrationId"
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
const liveCatalog = clone(state.catalog).map(product => ({ ...product, image: null }));
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
