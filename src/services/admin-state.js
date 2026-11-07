import { state } from "../data/admin-store.js";
import { applyEdition, currentPayload, payloadFrom } from "../data/edition-payload.js";
import { mergeEditionState } from "../utils/state-merge.js";

// Persistence for the admin: events overview plus one loaded edition.
// base      = payload as last loaded/saved from the server
// lastSaved = text of base, to detect unsaved local changes cheaply
let base = null;
let lastSaved = null;
let version = null;
const MAX_MERGE_ATTEMPTS = 3;

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: "same-origin", ...options, headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) } });
  const result = await response.json().catch(() => ({}));
  return { response, result };
}

async function fetchEdition(editionId) {
  const { response, result } = await api("/api/admin/editions/" + encodeURIComponent(editionId) + "/state");
  if (!response.ok) throw new Error(result.error || "De editie kon niet worden geladen.");
  return result;
}

function remember(serverState) {
  base = payloadFrom(serverState);
  lastSaved = JSON.stringify(base);
  version = serverState.version || null;
}

export async function loadEvents() {
  const { response, result } = await api("/api/admin/events");
  if (!response.ok) throw new Error(result.error || "De evenementen konden niet worden geladen.");
  state.events = result.events || [];
  return state.events;
}

// Pick the edition to work on: the remembered one if it still exists, otherwise the
// open edition of the first event, otherwise the most recent edition.
function defaultEditionId(preferred) {
  const editions = (state.events || []).flatMap(event => event.editions || []);
  if (preferred && editions.some(edition => edition.id === preferred)) return preferred;
  return editions.find(edition => edition.status === "open")?.id || editions[0]?.id || null;
}

export async function loadEdition(editionId) {
  const serverState = await fetchEdition(editionId);
  applyEdition(serverState, { keepUi: false });
  remember(serverState);
  return serverState;
}

export async function loadAdminState(preferredEditionId) {
  await loadEvents();
  const editionId = defaultEditionId(preferredEditionId);
  if (editionId) await loadEdition(editionId);
  return editionId;
}

function hasUnsavedAdminChanges() {
  if (!base || !state.activeEditionId) return false;
  return JSON.stringify(currentPayload()) !== lastSaved;
}

// Pull changes made by families or another admin when nothing is pending locally.
export async function refreshAdminStateIfChanged() {
  if (!state.activeEditionId || hasUnsavedAdminChanges()) return false;
  const { response, result } = await api("/api/admin/editions/" + encodeURIComponent(state.activeEditionId) + "/version");
  if (!response.ok || !result.version || result.version === version) return false;
  const serverState = await fetchEdition(state.activeEditionId);
  if (hasUnsavedAdminChanges()) return false; // the admin started editing meanwhile
  applyEdition(serverState);
  remember(serverState);
  return true;
}

// After a merge, revisions must be the server's so the next save passes its guards.
function withServerRevisions(merged, theirs) {
  const theirRegs = new Map(theirs.registrations.map(reg => [reg.id, reg]));
  return {
    ...merged,
    financeRevision: theirs.financeRevision,
    configRevision: theirs.configRevision,
    registrations: merged.registrations.map(reg => theirRegs.has(reg.id) ? { ...reg, revision: theirRegs.get(reg.id).revision } : { ...reg, revision: 0 })
  };
}

export async function saveAdminState() {
  if (!state.activeEditionId || !base) return { saved: true, unchanged: true };
  let mine = currentPayload();
  if (JSON.stringify(mine) === lastSaved) return { saved: true, unchanged: true };
  const editionId = state.activeEditionId;
  let conflicts = [];
  let createdRegistrations = mine.registrations.some(reg => !base.registrations.some(item => item.id === reg.id));
  for (let attempt = 0; attempt < MAX_MERGE_ATTEMPTS; attempt++) {
    const sent = mine;
    const { response, result } = await api("/api/admin/editions/" + encodeURIComponent(editionId) + "/state", { method: "PUT", body: JSON.stringify({ base, data: sent }) });
    if (response.ok) {
      remember(result.state);
      // Keep edits made while the request was in flight; only adopt the new revisions.
      const stillEditing = JSON.stringify(currentPayload()) !== JSON.stringify(sent);
      if (stillEditing) {
        const fresh = new Map(result.state.registrations.map(reg => [reg.id, reg.revision]));
        state.registrations.forEach(reg => { if (fresh.has(reg.id)) reg.revision = fresh.get(reg.id); });
        state.financeRevision = result.state.financeRevision;
        state.configRevision = result.state.configRevision;
      } else {
        applyEdition(result.state);
      }
      return { saved: true, merged: attempt > 0, conflicts, createdRegistrations };
    }
    if (response.status !== 409) throw new Error(result.error || "De gegevens konden niet worden opgeslagen.");
    // Someone else saved meanwhile: merge their version with ours and try again.
    const theirsState = await fetchEdition(editionId);
    const theirs = payloadFrom(theirsState);
    const outcome = mergeEditionState(base, mine, theirs);
    conflicts = conflicts.concat(outcome.conflicts);
    mine = withServerRevisions(payloadFrom(outcome.merged), theirs);
    remember(theirsState);
    applyEdition({ ...theirsState, ...mine });
    if (JSON.stringify(mine) === lastSaved) return { saved: true, unchanged: true, merged: true, conflicts };
  }
  throw new Error("Deze editie werd meerdere keren tegelijk gewijzigd. Herlaad de pagina om de nieuwste gegevens op te halen.");
}

export async function startNextEdition(label, copyCatalog) {
  const { response, result } = await api("/api/admin/editions/" + encodeURIComponent(state.activeEditionId) + "/next", { method: "POST", body: JSON.stringify({ label, copyCatalog }) });
  if (!response.ok) throw new Error(result.error || "De nieuwe editie kon niet worden gestart.");
  await loadEvents();
  await loadEdition(result.editionId);
  return result.editionId;
}

export async function createEvent(name, editionLabel) {
  const created = await api("/api/admin/events", { method: "POST", body: JSON.stringify({ name, description: "", financeStrategy: "nieuwjaar" }) });
  if (!created.response.ok) throw new Error(created.result.error || "Het evenement kon niet worden aangemaakt.");
  const edition = await api("/api/admin/events/" + encodeURIComponent(created.result.event.id) + "/editions", { method: "POST", body: JSON.stringify({ label: editionLabel }) });
  if (!edition.response.ok) throw new Error(edition.result.error || "De eerste editie kon niet worden aangemaakt.");
  await loadEvents();
  await loadEdition(edition.result.edition.id);
  return edition.result.edition.id;
}
