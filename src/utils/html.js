// Small helpers shared by every screen (admin, family portal) and the e-mail templates.

// Escape text for safe use inside HTML (element content and attribute values).
export const esc = value =>
  String(value ?? "").replace(
    /[&<>"']/g,
    char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]
  );

// ---- html`…` templates with automatic escaping ----
// Every ${value} is escaped, unless it is itself built with html`…` (or raw()). Arrays are joined.
// Templates can be written over several lines (like JSX): a line break plus indentation
// disappears next to a tag ("<li>⏎  <b>" → "<li><b>") and becomes one space elsewhere
// ("lange⏎  zin" → "lange zin").
class SafeHtml {
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

// Tests set globalThis.__HTML_STRICT__ to catch HTML that was built as plain text by mistake
// (it would show up on screen as "&lt;span…").
const LOOKS_LIKE_MARKUP =
  /<\/?(div|span|li|ul|ol|button|section|p|strong|small|b|em|i|label|input|select|option|form|header|nav|article|details|summary|table|thead|tbody|tfoot|tr|td|th|a|img|h[1-6]|fieldset|legend|main|textarea)\b[^>]*>/i;

function part(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(part).join("");
  const text = String(value);
  if (globalThis.__HTML_STRICT__ && LOOKS_LIKE_MARKUP.test(text)) {
    throw new Error("Plain text that looks like HTML was escaped: " + text.slice(0, 120));
  }
  return esc(text);
}

// An empty result is returned as "" so `rows || fallback` keeps working.
export function html(strings, ...values) {
  let out = "";
  strings.forEach((text, i) => {
    out += text.replace(/[ \t]*\n\s*/g, (gap, at, whole) =>
      whole[at - 1] === ">" || whole[at + gap.length] === "<" ? "" : " "
    );
    if (i < values.length) out += part(values[i]);
  });
  return out === "" ? "" : new SafeHtml(out);
}

// Mark trusted markup (never user input) as HTML.
export const raw = value => (value === null || value === undefined || value === "" ? "" : new SafeHtml(String(value)));

// Join a list of html`…` pieces with a separator; "" when nothing is left.
export function joinHtml(list, separator = "") {
  const out = (Array.isArray(list) ? list : []).map(part).join(part(separator));
  return out === "" ? "" : new SafeHtml(out);
}

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
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("nl-BE", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  });
};
