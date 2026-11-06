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
  for (const payment of (Array.isArray(payments) ? payments : [])) {
    const row = byId.get(payment.registrationId);
    if (row) row.paidCents += payment.amountCents;
  }
  rows.forEach(row => {
    row.balanceCents = row.advancedCents - row.shareCents;
    row.amountDueCents = Math.max(0, -row.balanceCents);
    row.paidCents = row.paidCents || 0;
    row.remainingCents = Math.max(0, row.amountDueCents - row.paidCents);
    row.overpaidCents = Math.max(0, row.paidCents - row.amountDueCents);
    row.paymentStatus = row.remainingCents === 0 ? (row.amountDueCents === 0 ? "Geen bedrag verschuldigd" : "Betaald")
      : row.paidCents > 0 ? "Gedeeltelijk betaald" : "Openstaand";
  });
  return rows;
}

// Verdeel het aandeel van een inschrijving verder over de individuele leden.
// Eerst per inschrijving verdelen en daarna per lid voorkomt afrondingsverschillen met de afrekening.
export function getMemberCostSummary(registration, registrations = [], expenses = []) {
  // Een nieuwe editie of een ongeldige actieve selectie heeft nog geen gekoppelde inschrijving.
  if (!registration) return [];
  const members = registration.members || [];
  const totals = new Map(members.map(member => [member.id, 0]));
  for (const expense of expenses) {
    const registrationShares = getExpenseShares(expense, registrations);
    const registrationShare = registrationShares.find(share => share.id === registration.id)?.cents || 0;
    if (!registrationShare || !members.length) continue;
    const weightedMembers = members.map(member => {
      const meat = Object.values(member.orders || {}).reduce((sum, qty) => sum + Math.max(0, Number(qty) || 0), 0);
      const weight = expense.method === "general" ? 1
        : expense.method === "adults" ? (member.type === "Volwassene" ? 1 : 0)
        : expense.method === "meat" ? meat : 0;
      return { id: member.id, weight };
    }).filter(row => row.weight > 0);
    if (!weightedMembers.length) continue;
    for (const share of splitCents(registrationShare, weightedMembers)) {
      totals.set(share.id, (totals.get(share.id) || 0) + share.cents);
    }
  }
  return members.map(member => ({ id: member.id, name: member.name, cents: totals.get(member.id) || 0 }));
}
