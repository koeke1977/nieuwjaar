import { esc } from "./html.js";

// Categories of participants, shared by the server, the admin and the family portal.
//   Volwassene  — 18+, shares in all costs including 18+ costs
//   Kind        — shares in general costs and meat, never in 18+ costs
//   Avondgast   — comes after dinner: no meat, no shared costs; only a personal bar bill
export const ADULT = "Volwassene";
export const CHILD = "Kind";
export const EVENING = "Avondgast";
export const MEMBER_TYPES = [ADULT, CHILD, EVENING];

export const isMemberType = type => MEMBER_TYPES.includes(type);
export const isEveningGuest = person => person?.type === EVENING;
// Dinner guests: everyone who shares in the costs of the evening.
export const isDinnerGuest = person => person?.type === ADULT || person?.type === CHILD;

export const TYPE_LABELS = { [ADULT]: "Volwassene (18+)", [CHILD]: "Kind", [EVENING]: "Avondgast (na het eten)" };
export const typeLabel = type => TYPE_LABELS[type] || "Deelnemer";

export const typeOptions = selected =>
  MEMBER_TYPES.map(
    type =>
      '<option value="' +
      type +
      '"' +
      (type === selected ? " selected" : "") +
      ">" +
      esc(TYPE_LABELS[type]) +
      "</option>"
  ).join("");

export function countByType(members = []) {
  return {
    adults: members.filter(person => person?.type === ADULT).length,
    children: members.filter(person => person?.type === CHILD).length,
    evening: members.filter(isEveningGuest).length
  };
}

// "2 volwassenen · 1 kind · 3 avondgasten" (empty categories left out, except when nobody).
export function countsText(members = []) {
  const { adults, children, evening } = countByType(members);
  const parts = [];
  if (adults) parts.push(adults + " " + (adults === 1 ? "volwassene" : "volwassenen"));
  if (children) parts.push(children + " " + (children === 1 ? "kind" : "kinderen"));
  if (evening) parts.push(evening + " " + (evening === 1 ? "avondgast" : "avondgasten"));
  return parts.join(" · ") || "nog niemand";
}
