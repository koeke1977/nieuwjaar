export const state = {
  activeEvent: { id: "nieuwjaar-2026-2027", name: "Nieuwjaar 2026–2027", status: "active" },
  expenses: [],
  activeConsole: "user", activeSection: "overview", activeRegistrationId: "koen-isabella", editingMember: null, managingRegistrationId: "koen-isabella",
  // Demo-inschrijving voor de huidige editie; productie start met een lege lijst.
  registrations: [
    { id:"koen-isabella", name:"Koen & Isabella", adults:2, children:2, members: [] }
  ],
  // Historische cijfers van de vorige editie: uitsluitend archief, nooit actief bewerken.
  previousEditionRegistrations: [
    { id:"olivier-kelly", name:"Olivier & Kelly", adults:2, children:2 },
    { id:"boef-claudia", name:"Boef & Claudia", adults:2, children:2 },
    { id:"koen-isabella-old", name:"Koen & Isabella", adults:2, children:2 },
    { id:"lorenzo-kim", name:"Lorenzo & Kim", adults:2, children:2 },
    { id:"ben-tina", name:"Ben & Tina", adults:4, children:2 },
    { id:"inge", name:"Inge", adults:1, children:2 },
    { id:"jurgen-nathalie", name:"Jurgen & Nathalie", adults:2, children:2 },
    { id:"filip-nathalie", name:"Filip & Nathalie", adults:2, children:2 },
    { id:"maaike-jelke", name:"Maaike & Jelke", adults:2, children:0 },
    { id:"wim-annelies", name:"Wim & Annelies", adults:2, children:3 },
    { id:"jong-geweld", name:"Jong geweld", adults:11, children:0 }
  ],
  payments: [
    { household: "Familie Thomaes-Beckers", due: 185, paid: 185, method: "Cash" },
    { household: "Familie Ben-Tina", due: 240, paid: 200, method: "Cash" },
    { household: "Inge", due: 95, paid: 0, method: "—" },
    { household: "Familie Olivier-Kelly", due: 165, paid: 165, method: "Overschrijving" }
  ],
  previousEditionMeats: [
    { name: "Steak", count: 28 }, { name: "Kip", count: 14 }, { name: "Saté", count: 8 },
    { name: "Worst", count: 15 }, { name: "Hamburger", count: 5 }, { name: "Witte pens", count: 6 },
    { name: "Sparerib", count: 18 }, { name: "Bolletjes op stok", count: 13 }
  ],
  catalog: ["Steak","Kip","Saté","Worst","Hamburger","Witte pens","Sparerib","Bolletjes op stok"]
    .map((name, i) => ({ id: ["steak","kip","sate","worst","hamburger","witte-pens","sparerib","bolletjes"][i], name, active: true, image: null }))
};
export const family = {
  name: "Familie Thomaes-Beckers",
  members: [
    { id: "koen", name: "Koen", type: "Volwassene", orders: { steak: 1, kip: 1, sate: 1 } },
    { id: "isabella", name: "Isabella", type: "Volwassene", orders: { steak: 1, sate: 1 } },
    { id: "emma", name: "Emma", type: "Kind", orders: { steak: 1, kip: 1, worst: 1 } },
    { id: "lisa", name: "Lisa", type: "Kind", orders: { steak: 1, kip: 1, worst: 2 } }
  ],
  advanced: 250, share: 185, bring: 185
};

// De bekende voorbeeldleden zijn gekoppeld aan dezelfde registratie die de admin beheert.
state.registrations.find(item => item.id === "koen-isabella").members = family.members;
state.registrations.find(item => item.id === "koen-isabella").financial = { advanced: family.advanced, share: family.share, bring: family.bring };
export function getActiveRegistration() {
  return state.registrations.find(item => item.id === state.activeRegistrationId) || state.registrations[0];
}
export function getActiveFamily() {
  const registration = getActiveRegistration();
  return { name: registration.name, members: registration.members || [], advanced: registration.financial?.advanced || 0, share: registration.financial?.share || 0, bring: registration.financial?.bring || 0 };
}

// Alleen bestellingen uit actieve inschrijvingen tellen mee in de huidige editie.
// Historische aantallen staan apart in previousEditionMeats en worden nooit opgeteld.
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
