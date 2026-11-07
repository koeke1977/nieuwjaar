import { getFinancialSummary } from "../utils/finance.js";

// Shared in-memory state for the admin and the legacy link portal. It starts empty and is
// filled from the database (app_state "live"); there is no demo or test data anymore.
export const state = {
  activeEvent: { id: "nieuwjaar-2026-2027", name: "Nieuwjaar 2026–2027", status: "active" },
  expenses: [],
  editionArchive: [],
  costsFinalized: false,
  costsFinalizedAt: null,
  activeConsole: "user", activeSection: "overview", activeRegistrationId: null, editingMember: null, managingRegistrationId: null,
  registrations: [],
  payments: [],
  // Default catalog for a brand-new edition (product photos ship with the app).
  catalog: ["Steak","Kip","Saté","Worst","Hamburger","Witte pens","Sparerib","Bolletjes op stok"]
    .map((name, i) => {
      const id = ["steak","kip","sate","worst","hamburger","witte-pens","sparerib","bolletjes"][i];
      const images = { steak:"/images/steak.jpg", kip:"/images/kip.jpg", sate:"/images/sate.jpg", worst:"/images/worst.jpg", hamburger:"/images/hamburger.jpg", "witte-pens":"/images/witte-pens.jpg", sparerib:"/images/spareribs.jpg", bolletjes:"/images/bolletjes-op-stok.jpg" };
      return { id, name, active: true, image: images[id] };
    })
};
export function getActiveRegistration() {
  return state.registrations.find(item => item.id === state.activeRegistrationId) || state.registrations[0];
}
export function getActiveFamily() {
  const registration = getActiveRegistration();
  if (!registration) return { name: "", members: [], advanced: 0, share: 0, bring: 0, paid: 0, remaining: 0, balance: 0, paymentStatus: "Geen inschrijving" };
  const summary = getFinancialSummary(state.registrations, state.expenses, state.payments)
    .find(row => row.id === registration.id);
  return {
    name: registration.name,
    members: registration.members || [],
    advanced: (summary?.advancedCents || 0) / 100,
    share: (summary?.shareCents || 0) / 100,
    bring: (summary?.remainingCents || 0) / 100,
    paid: (summary?.paidCents || 0) / 100,
    remaining: (summary?.remainingCents || 0) / 100,
    balance: (summary?.balanceCents || 0) / 100,
    paymentStatus: summary?.paymentStatus || "Geen bedrag verschuldigd"
  };
}

// Alleen bestellingen uit actieve inschrijvingen tellen mee in de huidige editie.
export function getFamilyMeat(registration = getActiveRegistration()) {
  const activeMembers = registration?.members || [];
  return state.catalog.map(product => ({
    id: product.id,
    name: product.name,
    count: activeMembers.reduce((sum, person) => sum + (Number(person.orders?.[product.id]) || 0), 0)
  }));
}
export function getGlobalMeatTotals() {
  const activeMembers = state.registrations.flatMap(registration => registration.members || []);
  return state.catalog.map(product => ({
    name: product.name,
    count: activeMembers.reduce((sum, person) => sum + (Number(person.orders?.[product.id]) || 0), 0)
  }));
}
export function getPersonMeatTotal(person) {
  return Object.values(person.orders || {}).reduce((sum, count) => sum + (Number(count) || 0), 0);
}
