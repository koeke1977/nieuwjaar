export const state = {
  activeConsole: "user",
  activeSection: "overview",
  payments: [
    { household: "Familie Thomaes-Beckers", due: 185, paid: 185, method: "Cash" },
    { household: "Familie Ben-Tina", due: 240, paid: 200, method: "Cash" },
    { household: "Inge", due: 95, paid: 0, method: "—" },
    { household: "Familie Olivier-Kelly", due: 165, paid: 165, method: "Overschrijving" }
  ],
  meats: [
    { name: "Steak", count: 28 }, { name: "Kip", count: 14 },
    { name: "Saté", count: 8 }, { name: "Worst", count: 15 },
    { name: "Hamburger", count: 5 }, { name: "Witte pens", count: 6 },
    { name: "Sparerib", count: 18 }, { name: "Bolletjes op stok", count: 13 }
  ]
};

export const family = {
  name: "Familie Thomaes-Beckers",
  members: [
    { name: "Koen", type: "Volwassene", order: 3 },
    { name: "Isabella", type: "Volwassene", order: 2 },
    { name: "Emma", type: "Kind", order: 4 },
    { name: "Lisa", type: "Kind", order: 3 }
  ],
  meat: [
    { name: "Steak", count: 4 }, { name: "Kip", count: 3 },
    { name: "Saté", count: 2 }, { name: "Worst", count: 3 }
  ],
  advanced: 250, share: 185, bring: 185
};
