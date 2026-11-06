import { state } from "../data/demo-data.js";
import { getPersistableEnvironmentData, restorePersistedEnvironmentData } from "../data/environment-store.js";

let revisions = { test: null, live: null };
let lastSaved = { test: null, live: null };

export async function loadAdminState() {
  const response = await fetch("/api/admin/state", { credentials: "same-origin" });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "De opgeslagen gegevens konden niet worden geladen.");
  restorePersistedEnvironmentData(result.environments);
  revisions = { test: result.revisions?.test ?? null, live: result.revisions?.live ?? null };
  lastSaved = {
    test: result.environments?.test ? JSON.stringify(result.environments.test) : null,
    live: result.environments?.live ? JSON.stringify(result.environments.live) : null
  };
  return result;
}

export async function saveAdminState() {
  const environment = state.activeEnvironment;
  if (!["test", "live"].includes(environment)) throw new Error("Ongeldige opslagomgeving.");
  const snapshot = getPersistableEnvironmentData();
  const serialized = JSON.stringify(snapshot[environment]);
  if (serialized === lastSaved[environment]) return { saved: true, unchanged: true, revision: revisions[environment] };
  const response = await fetch("/api/admin/state", {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      environment,
      data: snapshot[environment],
      revision: revisions[environment]
    })
  });
  const result = await response.json().catch(() => ({}));
  if (response.status === 409) {
    throw new Error("Deze editie is intussen door een gezinslid of een andere admin gewijzigd. Je lokale wijzigingen zijn niet overschreven. Herlaad de admin om de nieuwste gegevens op te halen.");
  }
  if (!response.ok) throw new Error(result.error || "De gegevens konden niet worden opgeslagen.");
  revisions[environment] = result.revision;
  lastSaved[environment] = serialized;
  return result;
}
