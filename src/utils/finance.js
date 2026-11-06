// Financiële domeinlogica. Alle bedragen worden in gehele eurocenten verwerkt.
export function getRegistrationCounts(registration) {
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
export function splitCents(amountCents, weightedRows) {
  const amount = Math.round(Number(amountCents));
  const totalWeight = weightedRows.reduce((sum, row) => sum + Math.max(0, Number(row.weight) || 0), 0);
  if (!Number.isInteger(amount) || amount < 0 || totalWeight <= 0) {
    throw new Error("Deze verdeelsleutel heeft geen deelnemers of porties om de kost over te verdelen.");
  }
  const shares = weightedRows.map((row, index) => {
    const exact = amount * Math.max(0, Number(row.weight) || 0) / totalWeight;
    const base = Math.floor(exact);
    return { id: row.id, cents: base, remainder: exact - base, index };
  });
  let remaining = amount - shares.reduce((sum, row) => sum + row.cents, 0);
  [...shares].sort((a, b) => b.remainder - a.remainder || a.index - b.index)
    .slice(0, remaining).forEach(row => { shares[row.index].cents += 1; });
  return shares.map(({ id, cents }) => ({ id, cents }));
}

export function getExpenseShares(expense, registrations) {
  const weightedRows = registrations.map(registration => {
    const counts = getRegistrationCounts(registration);
    const weight = expense.method === "general" ? counts.people
      : expense.method === "adults" ? counts.adults
      : expense.method === "meat" ? counts.meat : 0;
    return { id: registration.id, weight };
  }).filter(row => row.weight > 0);
  return splitCents(expense.amountCents, weightedRows);
}

export function getFinancialSummary(registrations, expenses, payments = []) {
  const rows = registrations.map(registration => ({
    id: registration.id, name: registration.name, advancedCents: 0, shareCents: 0, balanceCents: 0, paidCents: 0
  }));
  const byId = new Map(rows.map(row => [row.id, row]));
  for (const expense of expenses) {
    const payer = byId.get(expense.advancedBy);
    if (payer) payer.advancedCents += expense.amountCents;
    for (const share of getExpenseShares(expense, registrations)) {
      const row = byId.get(share.id);
      if (row) row.shareCents += share.cents;
    }
  }
  for (const payment of payments) {
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
