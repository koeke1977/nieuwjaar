import { getPersistableEnvironmentData, restorePersistedEnvironmentData } from "../data/environment-store.js";

export async function loadAdminState() {
  const response = await fetch("/api/admin/state", { credentials: "same-origin" });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "De opgeslagen gegevens konden niet worden geladen.");
  restorePersistedEnvironmentData(result.environments);
  return result;
}

export async function saveAdminState() {
  const response = await fetch("/api/admin/state", {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ environments: getPersistableEnvironmentData() })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "De gegevens konden niet worden opgeslagen.");
  return result;
}
