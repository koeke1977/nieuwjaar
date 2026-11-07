// Financiële domeinlogica. Alle bedragen worden in gehele eurocenten verwerkt.
export function getRegistrationCounts(registration) {
  if (registration.aggregateCounts) {
    return {
      people: Math.max(0, Number(registration.aggregateCounts.people) || 0),
      adults: Math.max(0, Number(registration.aggregateCounts.adults) || 0),
      children: Math.max(0, Number(registration.aggregateCounts.children) || 0),
      meat: Math.max(0, Number(registration.aggregateCounts.meat) || 0)
    };
  }
  const members = registration.members || [];
  if (members.length) {
    return {
      people: members.length,
      adults: members.filter(person => person.type === "Volwassene").length,
      children: members.filter(person => person.type === "Kind").length,
      meat: members.reduce((sum, person) =>
        sum + Object.values(person.orders || {}).reduce((personSum, qty) => personSum + Math.max(0, Number(qty) || 0), 0), 0)
    };
  }
  return {
    people: (Number(registration.adults) || 0) + (Number(registration.children) || 0),
    adults: Number(registration.adults) || 0,
    children: Number(registration.children) || 0,
    meat: 0
  };
}

// Open bar: a personal bar bill per person (in cents), entered by the organisation after the
// party. It is charged directly to that person; it is not split over anyone else.
export function memberBarCents(member) {
  return Math.max(0, Math.floor(Number(member?.barCents) || 0));
}
const registrationBarCents = registration => (registration?.members || []).reduce((sum, person) => sum + memberBarCents(person), 0);

// Largest-remainder verdeling: som van shares is altijd exact amountCents.
export function splitCents(amountCents, weightedRows, { strict = false } = {}) {
  const amount = Number(amountCents);
  const rows = Array.isArray(weightedRows) ? weightedRows : [];
  const totalWeight = rows.reduce((sum, row) => sum + Math.max(0, Number(row.weight) || 0), 0);
  if (!Number.isSafeInteger(amount) || amount < 0 || totalWeight <= 0) {
    if (strict) throw new Error("Deze verdeelsleutel heeft geen deelnemers of porties om de kost over te verdelen.");
    return [];
  }
  const shares = rows.map((row, index) => {
    const exact = amount * Math.max(0, Number(row.weight) || 0) / totalWeight;
    const base = Math.floor(exact);
    return { id: row.id, cents: base, remainder: exact - base, index };
  });
  let remaining = amount - shares.reduce((sum, row) => sum + row.cents, 0);
  [...shares].sort((a, b) => b.remainder - a.remainder || a.index - b.index)
    .slice(0, remaining).forEach(row => { shares[row.index].cents += 1; });
  return shares.map(({ id, cents }) => ({ id, cents }));
}

export function getExpenseShares(expense, registrations, { strict = false } = {}) {
  if (!expense || !Array.isArray(registrations)) {
    if (strict) throw new Error("De kost of deelnemerslijst is ongeldig.");
    return [];
  }
  const weightedRows = registrations.map(registration => {
    const counts = getRegistrationCounts(registration);
    const weight = expense.method === "general" ? counts.people
      : expense.method === "adults" ? counts.adults
      : expense.method === "meat" ? counts.meat : 0;
    return { id: registration.id, weight };
  }).filter(row => row.weight > 0);
  return splitCents(expense.amountCents, weightedRows, { strict });
}

export function getFinancialSummary(registrations, expenses, payments = []) {
  const rows = registrations.map(registration => ({
    id: registration.id, name: registration.name, advancedCents: 0, shareCents: 0, balanceCents: 0, paidCents: 0
  }));
  const byId = new Map(rows.map(row => [row.id, row]));
  for (const expense of (Array.isArray(expenses) ? expenses : [])) {
    const payer = byId.get(expense.advancedBy);
    if (payer) payer.advancedCents += Number(expense.amountCents) || 0;
    for (const share of getExpenseShares(expense, registrations)) {
      const row = byId.get(share.id);
      if (row) row.shareCents += share.cents;
    }
  }
  for (const registration of registrations) {
    const row = byId.get(registration.id);
    if (row) { row.barCents = registrationBarCents(registration); row.shareCents += row.barCents; }
  }
  // A payment is money a family paid in; kind "refund" is money paid back to a family.
  for (const payment of (Array.isArray(payments) ? payments : [])) {
    const row = byId.get(payment.registrationId);
    if (!row) continue;
    if (payment.kind === "refund") row.refundedCents = (row.refundedCents || 0) + payment.amountCents;
    else row.paidCents += payment.amountCents;
  }
  rows.forEach(row => {
    row.balanceCents = row.advancedCents - row.shareCents;
    row.amountDueCents = Math.max(0, -row.balanceCents);
    row.paidCents = row.paidCents || 0;
    row.refundedCents = row.refundedCents || 0;
    row.remainingCents = Math.max(0, row.amountDueCents - row.paidCents);
    row.overpaidCents = Math.max(0, row.paidCents - row.amountDueCents);
    // Still to pay back: advanced more than the own share, or paid more than due, minus refunds.
    row.creditCents = Math.max(0, Math.max(0, row.balanceCents) + row.overpaidCents - row.refundedCents);
    row.paymentStatus = row.remainingCents > 0 ? (row.paidCents > 0 ? "Gedeeltelijk betaald" : "Openstaand")
      : row.creditCents > 0 ? (row.refundedCents > 0 ? "Gedeeltelijk terugbetaald" : "Terug te betalen")
      : row.refundedCents > 0 ? "Terugbetaald"
      : row.amountDueCents === 0 ? "Geen bedrag verschuldigd" : "Betaald";
  });
  return rows;
}

// Verdeel het aandeel van een inschrijving verder over de individuele leden.
// Eerst per inschrijving verdelen en daarna per lid voorkomt afrondingsverschillen met de afrekening.
function memberPortions(member) {
  return Object.values(member?.orders || {}).reduce((sum, qty) => sum + Math.max(0, Number(qty) || 0), 0);
}

function memberWeight(member, method) {
  return method === "general" ? 1
    : method === "adults" ? (member.type === "Volwassene" ? 1 : 0)
    : method === "meat" ? memberPortions(member) : 0;
}

// Verdeel het aandeel van één inschrijving in één kost over haar leden.
export function getMemberExpenseShares(registrationShareCents, members, method) {
  if (!registrationShareCents || !Array.isArray(members) || !members.length) return [];
  const weightedMembers = members.map(member => ({ id: member.id, weight: memberWeight(member, method) }))
    .filter(row => row.weight > 0);
  if (!weightedMembers.length) return [];
  return splitCents(registrationShareCents, weightedMembers);
}

export function getMemberCostSummary(registration, registrations = [], expenses = []) {
  // Een nieuwe editie of een ongeldige actieve selectie heeft nog geen gekoppelde inschrijving.
  if (!registration) return [];
  const members = registration.members || [];
  const totals = new Map(members.map(member => [member.id, 0]));
  for (const expense of expenses) {
    const registrationShares = getExpenseShares(expense, registrations);
    const registrationShare = registrationShares.find(share => share.id === registration.id)?.cents || 0;
    for (const share of getMemberExpenseShares(registrationShare, members, expense.method)) {
      totals.set(share.id, (totals.get(share.id) || 0) + share.cents);
    }
  }
  return members.map(member => ({ id: member.id, name: member.name, cents: (totals.get(member.id) || 0) + memberBarCents(member) }));
}

export const COST_METHODS = {
  general: { label: "Algemene kosten", appliesTo: "Iedereen, ook kinderen", unit: ["persoon", "personen"] },
  adults: { label: "Kosten voor volwassenen (18+)", appliesTo: "Alleen volwassenen", unit: ["volwassene", "volwassenen"] },
  meat: { label: "Vlees", appliesTo: "Volgens het aantal bestelde porties", unit: ["portie", "porties"] },
  // Purchases for the bar are not split: the personal bar bills cover them.
  bar: { label: "Bar", appliesTo: "Persoonlijke barrekening per persoon", unit: ["persoon", "personen"] }
};

// Volledige, uitlegbare afrekening van één inschrijving. Bevat alleen gegevens van
// deze inschrijving plus totalen van het evenement; nooit namen of bedragen van andere gezinnen.
export function getFamilyFinanceBreakdown(registration, registrations = [], expenses = [], payments = []) {
  if (!registration) return null;
  const members = Array.isArray(registration.members) ? registration.members : [];
  const ownCounts = getRegistrationCounts(registration);
  const eventCounts = registrations.reduce((sum, item) => {
    const counts = getRegistrationCounts(item);
    return { people: sum.people + counts.people, adults: sum.adults + counts.adults, meat: sum.meat + counts.meat };
  }, { people: 0, adults: 0, meat: 0 });
  const unitsFor = (counts, method) => method === "general" ? counts.people : method === "adults" ? counts.adults : method === "meat" ? counts.meat : 0;

  const memberRows = new Map(members.map(member => [member.id, {
    id: member.id, name: member.name, type: member.type, portions: memberPortions(member),
    barCents: memberBarCents(member), totalCents: memberBarCents(member), byMethod: { general: 0, adults: 0, meat: 0, bar: memberBarCents(member) }
  }]));
  const categories = new Map();
  const expenseRows = [];
  let advancedCents = 0;
  for (const expense of Array.isArray(expenses) ? expenses : []) {
    if (!expense || !COST_METHODS[expense.method]) continue;
    const amountCents = Number(expense.amountCents) || 0;
    if (expense.advancedBy === registration.id) advancedCents += amountCents;
    // A bar purchase is not a shared cost; only the family that advanced it sees it (in its own costs).
    if (expense.method === "bar") {
      if (expense.advancedBy === registration.id) expenseRows.push({ id: expense.id, description: expense.description || "Aankoop bar", date: expense.date || null, method: "bar", amountCents, familyCents: 0, familyUnits: 0, totalUnits: 0, advancedByUs: true, enteredByFamily: expense.enteredBy === "family", receipt: expense.receipt || null, members: [], notShared: true });
      continue;
    }
    const familyCents = getExpenseShares(expense, registrations).find(share => share.id === registration.id)?.cents || 0;
    const memberShares = getMemberExpenseShares(familyCents, members, expense.method);
    for (const share of memberShares) {
      const row = memberRows.get(share.id);
      if (!row) continue;
      row.totalCents += share.cents;
      row.byMethod[expense.method] += share.cents;
    }
    const familyUnits = unitsFor(ownCounts, expense.method);
    const totalUnits = unitsFor(eventCounts, expense.method);
    expenseRows.push({
      id: expense.id, description: expense.description || COST_METHODS[expense.method].label,
      date: expense.date || null, method: expense.method, amountCents, familyCents,
      familyUnits, totalUnits, advancedByUs: expense.advancedBy === registration.id,
      enteredByFamily: expense.enteredBy === "family",
      // Only the family's own receipts are passed on (privacy).
      receipt: expense.advancedBy === registration.id && expense.receipt ? expense.receipt : null,
      members: memberShares
    });
    const category = categories.get(expense.method) || { method: expense.method, ...COST_METHODS[expense.method], amountCents: 0, familyCents: 0, familyUnits, totalUnits };
    category.amountCents += amountCents;
    category.familyCents += familyCents;
    categories.set(expense.method, category);
  }
  const familyBar = registrationBarCents(registration);
  if (familyBar > 0) {
    categories.set("bar", { method: "bar", ...COST_METHODS.bar, personal: true, amountCents: familyBar, familyCents: familyBar, familyUnits: 0, totalUnits: 0,
      perMember: members.filter(member => memberBarCents(member) > 0).map(member => ({ id: member.id, name: member.name, cents: memberBarCents(member) })) });
  }
  const paymentRows = (Array.isArray(payments) ? payments : [])
    .filter(payment => payment && payment.registrationId === registration.id)
    .map(payment => ({ id: payment.id, date: payment.date || null, amountCents: Number(payment.amountCents) || 0, method: payment.method || null, kind: payment.kind === "refund" ? "refund" : "payment" }));
  const summary = getFinancialSummary(registrations, expenses, payments).find(row => row.id === registration.id)
    || { shareCents: 0, advancedCents, paidCents: 0, refundedCents: 0, balanceCents: advancedCents, remainingCents: 0, overpaidCents: 0, amountDueCents: 0, creditCents: Math.max(0, advancedCents), paymentStatus: "Geen bedrag verschuldigd" };
  return {
    totals: {
      shareCents: summary.shareCents,
      advancedCents: summary.advancedCents,
      paidCents: summary.paidCents,
      refundedCents: summary.refundedCents,
      amountDueCents: summary.amountDueCents,
      remainingCents: summary.remainingCents,
      // Tegoed: meer voorgeschoten dan het eigen aandeel, of meer betaald dan verschuldigd, min terugbetalingen.
      creditCents: summary.creditCents,
      paymentStatus: summary.paymentStatus
    },
    counts: { family: ownCounts, event: eventCounts },
    categories: [...categories.values()],
    expenses: expenseRows,
    members: [...memberRows.values()],
    payments: paymentRows
  };
}
