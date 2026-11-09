// Family portal API: finds the route. The work is in ./family/.
import * as auth from "./family/auth-routes.js";
import * as portal from "./family/portal-routes.js";
import * as cost from "./family/cost-routes.js";
import * as account from "./family/account-routes.js";
import { cancelRegistration } from "./family/cancel-route.js";
import { setGuestListAnswer } from "./family/guest-list.js";

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
  "DELETE expenses": cost.saveOrDeleteExpense,
  "GET account": account.accountInfo,
  "POST change-password": account.changePassword,
  "POST change-email": account.changeEmail,
  "POST confirm-email": account.confirmEmail,
  "POST family-invite": account.inviteFamilyAccount,
  "DELETE family-invite": account.removeFamilyAccount,
  "POST cancel-registration": cancelRegistration,
  "POST guest-list": setGuestListAnswer
};

export async function handleFamilyAccountApi(request, env, url, dependencies) {
  if (!env.DB) return dependencies.json({ error: "Database niet geconfigureerd." }, 503);
  const route = request.method + " " + url.pathname.replace(/^\/api\/family-account\//, "");
  if (!Object.hasOwn(ROUTES, route)) return dependencies.json({ error: "Niet gevonden." }, 404);
  const now = Math.floor(Date.now() / 1000);
  return ROUTES[route]({ ...dependencies, request, env, url, now });
}
