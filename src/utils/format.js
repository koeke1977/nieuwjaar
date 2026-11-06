export const money = value => new Intl.NumberFormat("nl-BE", {
  style: "currency",
  currency: "EUR"
}).format(value);

export const total = items => items.reduce((sum, item) => sum + item.count, 0);
export const received = payments => payments.reduce((sum, payment) => sum + payment.paid, 0);
export const outstanding = payments => payments.reduce(
  (sum, payment) => sum + Math.max(0, payment.due - payment.paid), 0
);
