// Three-way merge of the shared edition state (app_state).
// base   = what this client last loaded/saved
// mine   = this client's current state
// theirs = the latest state on the server (changed by someone else meanwhile)
// Changes on both sides are combined per field, and per item (by id) for lists.
// When both sides changed the very same item, "mine" wins and the item id is reported.

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function mergeValue(base, mine, theirs) {
  if (same(mine, base)) return theirs;
  if (same(theirs, base)) return mine;
  return mine;
}

function mergeList(base = [], mine = [], theirs = [], conflicts, label) {
  const byId = list =>
    new Map((Array.isArray(list) ? list : []).filter(item => item && item.id != null).map(item => [item.id, item]));
  const baseMap = byId(base),
    mineMap = byId(mine),
    theirsMap = byId(theirs);
  const result = [];
  const seen = new Set();
  const decide = id => {
    const b = baseMap.get(id),
      m = mineMap.get(id),
      t = theirsMap.get(id);
    if (m && t) {
      if (same(m, b)) return t;
      if (same(t, b) || same(m, t)) return m;
      conflicts.push(label + ":" + id);
      return m;
    }
    if (m && !t) return b && same(m, b) ? null : m; // they deleted it; keep only if I changed it
    if (!m && t) return b && same(t, b) ? null : t; // I deleted it; keep only if they changed it
    return null;
  };
  // Keep the server order, then append items that only exist locally.
  for (const item of [...(Array.isArray(theirs) ? theirs : []), ...(Array.isArray(mine) ? mine : [])]) {
    if (!item || item.id == null || seen.has(item.id)) continue;
    seen.add(item.id);
    const merged = decide(item.id);
    if (merged) result.push(merged);
  }
  return result;
}

const LIST_FIELDS = ["registrations", "expenses", "payments", "catalog"];

export function mergeEditionState(base, mine, theirs) {
  const conflicts = [];
  if (!base || !theirs) return { merged: mine, conflicts };
  const merged = { ...theirs };
  for (const key of new Set([...Object.keys(base), ...Object.keys(mine), ...Object.keys(theirs)])) {
    merged[key] = LIST_FIELDS.includes(key)
      ? mergeList(base[key], mine[key], theirs[key], conflicts, key)
      : mergeValue(base[key], mine[key], theirs[key]);
    if (merged[key] === undefined) delete merged[key];
  }
  // costsFinalized follows the same rule: a family edit that reopened the costs on the
  // server is kept unless this admin explicitly changed the flag locally.
  return { merged, conflicts };
}
