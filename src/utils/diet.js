// Allergies and notes per person. Shared by the server (validation) and the screens.
export const DIET_OPTIONS = ["Vegetarisch", "Geen varkensvlees", "Glutenvrij", "Lactosevrij", "Notenallergie"];
export const NOTE_MAX = 200;

// Returns { diet, notes } with only known options and a trimmed note, or null when invalid.
export function cleanDiet(person) {
  const diet = person?.diet === undefined ? [] : person.diet;
  const notes = person?.notes === undefined || person.notes === null ? "" : person.notes;
  if (!Array.isArray(diet) || diet.some(item => !DIET_OPTIONS.includes(item)) || typeof notes !== "string" || notes.trim().length > NOTE_MAX) return null;
  return { diet: DIET_OPTIONS.filter(option => diet.includes(option)), notes: notes.trim() };
}

// Only add the fields when there is something to store (keeps existing data unchanged).
export function withDiet(target, person) {
  const clean = cleanDiet(person);
  if (!clean) return null;
  if (clean.diet.length) target.diet = clean.diet;
  if (clean.notes) target.notes = clean.notes;
  return target;
}

export const hasDiet = person => Boolean((person?.diet || []).length || person?.notes);
