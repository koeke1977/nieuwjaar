// Small helpers shared by every screen (admin, family portal) and the e-mail templates.

// Escape text for safe use inside HTML (element content and attribute values).
export const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

const euroFormat = new Intl.NumberFormat("nl-BE", { style: "currency", currency: "EUR" });
// Amounts are kept in cents everywhere; this shows them as "€ 12,50".
export const euro = cents => euroFormat.format((Number(cents) || 0) / 100);

// plural(3, "portie", "porties") or plural(3, ["portie", "porties"]) → "3 porties"
export const plural = (count, one, many) => {
  if (Array.isArray(one)) [one, many] = one;
  return count + " " + (count === 1 ? one : many);
};

// "2026-12-20" → "20 dec 2026"; anything that is not a date shows as empty.
export const formatDate = value => {
  if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) return "";
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("nl-BE", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
};
