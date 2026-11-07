import { state } from "../data/demo-data.js";
import { getPersistableEnvironmentData, restorePersistedEnvironmentData, applyLatestEnvironmentData } from "../data/environment-store.js";
import { mergeEditionState } from "../utils/state-merge.js";

let revisions = { test: null, live: null };
let lastSaved = { test: null, live: null };
const MAX_MERGE_ATTEMPTS = 3;

async function fetchState() {
  const response = await fetch("/api/admin/state", { credentials: "same-origin" });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "De opgeslagen gegevens konden niet worden geladen.");
  return result;
}

export async function loadAdminState() {
  const result = await fetchState();
  restorePersistedEnvironmentData(result.environments);
  revisions = { test: result.revisions?.test ?? null, live: result.revisions?.live ?? null };
  // Compare against what the client would persist, so loading alone never triggers a save.
  const snapshot = getPersistableEnvironmentData();
  lastSaved = {
    test: result.environments?.test ? JSON.stringify(snapshot.test) : null,
    live: result.environments?.live ? JSON.stringify(snapshot.live) : null
  };
  return result;
}

export function hasUnsavedAdminChanges() {
  const environment = state.activeEnvironment;
  return JSON.stringify(getPersistableEnvironmentData()[environment]) !== lastSaved[environment];
}

// Pull changes made by families (or another admin) when there is nothing pending locally.
// Returns true when the local state was updated.
export async function refreshAdminStateIfChanged() {
  const environment = state.activeEnvironment;
  if (hasUnsavedAdminChanges()) return false;
  const result = await fetchState();
  const latest = result.environments?.[environment];
  const revision = result.revisions?.[environment] ?? null;
  if (!latest || revision === revisions[environment]) return false;
  if (hasUnsavedAdminChanges()) return false; // the admin started editing while we were fetching
  applyLatestEnvironmentData(environment, latest);
  revisions[environment] = revision;
  lastSaved[environment] = JSON.stringify(getPersistableEnvironmentData()[environment]);
  return true;
}

async function putState(environment, data, revision) {
  const response = await fetch("/api/admin/state", {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ environment, data, revision })
  });
  const result = await response.json().catch(() => ({}));
  return { response, result };
}

export async function saveAdminState() {
  const environment = state.activeEnvironment;
  if (!["test", "live"].includes(environment)) throw new Error("Ongeldige opslagomgeving.");
  let mine = getPersistableEnvironmentData()[environment];
  let serialized = JSON.stringify(mine);
  if (serialized === lastSaved[environment]) return { saved: true, unchanged: true, revision: revisions[environment] };
  let conflicts = [];
  for (let attempt = 0; attempt < MAX_MERGE_ATTEMPTS; attempt++) {
    const { response, result } = await putState(environment, mine, revisions[environment]);
    if (response.ok) {
      revisions[environment] = result.revision;
      lastSaved[environment] = serialized;
      // Keep the local state equal to what was stored (it may contain merged changes).
      if (attempt > 0) applyLatestEnvironmentData(environment, mine);
      return { ...result, merged: attempt > 0, conflicts };
    }
    if (response.status !== 409) throw new Error(result.error || "De gegevens konden niet worden opgeslagen.");
    // Someone else saved meanwhile (usually a family changing its order): merge and retry.
    const latest = await fetchState();
    const theirs = latest.environments?.[environment];
    const base = lastSaved[environment] ? JSON.parse(lastSaved[environment]) : null;
    if (!theirs || !base) break;
    const outcome = mergeEditionState(base, mine, theirs);
    conflicts = conflicts.concat(outcome.conflicts);
    mine = outcome.merged;
    serialized = JSON.stringify(mine);
    revisions[environment] = latest.revisions?.[environment] ?? null;
    // The server version is now our base for the next attempt.
    lastSaved[environment] = JSON.stringify(theirs);
    if (serialized === lastSaved[environment]) {
      applyLatestEnvironmentData(environment, theirs);
      lastSaved[environment] = JSON.stringify(getPersistableEnvironmentData()[environment]);
      return { saved: true, unchanged: true, merged: true, conflicts, revision: revisions[environment] };
    }
  }
  throw new Error("Deze editie werd meerdere keren tegelijk gewijzigd. Herlaad de pagina om de nieuwste gegevens op te halen.");
}
