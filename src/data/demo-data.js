export const state = {
  activeConsole: "user", activeSection: "overview", editingMember: null,
  registrations: [
    { id:"olivier-kelly", name:"Olivier & Kelly", adults:2, children:2 },
    { id:"boef-claudia", name:"Boef & Claudia", adults:2, children:2 },
    { id:"koen-isabella", name:"Koen & Isabella", adults:2, children:2 },
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
  meats: [
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
    { name: "Koen", type: "Volwassene", orders: { steak: 1, kip: 1, sate: 1 } },
    { name: "Isabella", type: "Volwassene", orders: { steak: 1, sate: 1 } },
    { name: "Emma", type: "Kind", orders: { steak: 1, kip: 1, worst: 1 } },
    { name: "Lisa", type: "Kind", orders: { steak: 1, kip: 1, worst: 2 } }
  ],
  advanced: 250, share: 185, bring: 185
};

// Bestaande groepsaantallen bevatten de huidige voorbeeldfamilie. Alleen het verschil
// met de oorspronkelijke familieaantallen wordt op de globale totalen toegepast.
const initialFamilyCounts = { steak: 4, kip: 3, sate: 2, worst: 3 };
export function getFamilyMeat() {
  return state.catalog.map(product => ({
    id: product.id, name: product.name,
    count: family.members.reduce((sum, person) => sum + (Number(person.orders[product.id]) || 0), 0)
  }));
}
export function getGlobalMeatTotals() {
  const familyTotals = getFamilyMeat();
  return state.catalog.map(product => {
    const original = state.meats.find(item => item.name === product.name)?.count || 0;
    const baseline = initialFamilyCounts[product.id] || 0;
    const current = familyTotals.find(item => item.id === product.id)?.count || 0;
    return { name: product.name, count: Math.max(0, original + current - baseline) };
  });
}
export function getPersonMeatTotal(person) {
  return Object.values(person.orders).reduce((sum, count) => sum + (Number(count) || 0), 0);
}
