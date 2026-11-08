// Families asking to cancel when the organisation has to decide. Kept in the edition's config
// (config.cancelRequests = { registrationId: { at } }), outside its revision: no save conflicts.
import { parse } from "./common.js";

export async function setCancelRequest(env, editionId, registrationId, at) {
  const row = await env.DB.prepare("SELECT config_json FROM event_editions WHERE id = ?").bind(editionId).first();
  if (!row) return;
  const config = parse(row.config_json, {}) || {};
  const requests = { ...config.cancelRequests };
  if (at) requests[registrationId] = { at };
  else delete requests[registrationId];
  if (Object.keys(requests).length) config.cancelRequests = requests;
  else delete config.cancelRequests;
  await env.DB.prepare("UPDATE event_editions SET config_json = ? WHERE id = ?")
    .bind(JSON.stringify(config), editionId)
    .run();
}
