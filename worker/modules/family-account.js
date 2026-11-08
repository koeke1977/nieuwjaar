// Family portal API: finds the route. The work is in ./family/.
import * as auth from "./family/auth-routes.js";
import * as portal from "./family/portal-routes.js";
import * as cost from "./family/cost-routes.js";

// "METHOD path below /api/family-account/" → handler
const ROUTES = {
  "POST login": auth.login,
  "POST logout": auth.logout,
  "POST activate": auth.activate,
  "POST forgot-password": auth.forgotPassword,
  "POST reset-password": auth.resetPassword,
  "GET session": portal.portalData,
  "POST register": portal.selfRegister,
  "PUT registration": portal.saveRegistration,
  "POST receipts": cost.uploadReceipt,
  "GET receipts": cost.readReceipt,
  "POST expenses": cost.saveOrDeleteExpense,
  "DELETE expenses": cost.saveOrDeleteExpense
};

export async function handleFamilyAccountApi(request, env, url, dependencies) {
  if (!env.DB) return dependencies.json({ error: "Database niet geconfigureerd." }, 503);
  const route = request.method + " " + url.pathname.replace(/^\/api\/family-account\//, "");
  if (!Object.hasOwn(ROUTES, route)) return dependencies.json({ error: "Niet gevonden." }, 404);
  const now = Math.floor(Date.now() / 1000);
  return ROUTES[route]({ ...dependencies, request, env, url, now });
}
