import { state } from "./demo-data.js";

// The admin works on one event edition at a time (state.activeEditionId), loaded from
// /api/admin/editions/:id/state. This module maps between that API shape and the admin
// state the screens use, and produces the payload that is saved back.

const clone = value => JSON.parse(JSON.stringify(value ?? null));

// Every stored member field must be listed here, otherwise an admin save would drop it.
const memberPayload = person => ({
  id: person.id, name: person.name, type: person.type, orders: { ...(person.orders || {}) },
  ...((person.diet || []).length ? { diet: [...person.diet] } : {}),
  ...(person.notes ? { notes: person.notes } : {}),
  ...(Number(person.barCents) > 0 ? { barCents: Number(person.barCents) } : {})
});
const registrationPayload = reg => ({
  id: reg.id, familyId: reg.familyId || null, name: reg.name,
  members: (reg.members || []).map(memberPayload), revision: Number(reg.revision) || 0
});
const productPayload = product => ({ id: product.id, name: product.name, image: product.image || null, active: product.active !== false });

// Canonical payload: fixed field order so it can be compared as text.
export function payloadFrom(source) {
  return {
    editionId: source.editionId,
    eventName: source.eventName,
    editionLabel: source.editionLabel,
    startsAt: source.startsAt || null,
    orderDeadline: source.orderDeadline || null,
    catalog: (source.catalog || []).map(productPayload),
    registrations: (source.registrations || []).map(registrationPayload),
    expenses: clone(source.expenses || []),
    payments: clone(source.payments || []),
    costsFinalized: Boolean(source.costsFinalized),
    costsFinalizedAt: source.costsFinalizedAt || null,
    financeRevision: Number(source.financeRevision) || 0,
    configRevision: Number(source.configRevision) || 0
  };
}

// Payload of what the admin currently has on screen.
export function currentPayload() {
  return payloadFrom({
    editionId: state.activeEditionId,
    eventName: state.eventName,
    editionLabel: state.activeEvent?.name,
    startsAt: state.startsAt,
    orderDeadline: state.orderDeadline,
    catalog: state.catalog,
    registrations: state.registrations,
    expenses: state.expenses,
    payments: state.payments,
    costsFinalized: state.costsFinalized,
    costsFinalizedAt: state.costsFinalizedAt,
    financeRevision: state.financeRevision,
    configRevision: state.configRevision
  });
}

function keepSelectionValid() {
  const ids = new Set((state.registrations || []).map(item => item.id));
  if (!ids.has(state.managingRegistrationId)) state.managingRegistrationId = state.registrations[0]?.id || null;
  if (state.beheerFamilyId && !ids.has(state.beheerFamilyId)) state.beheerFamilyId = null;
  if (state.editingExpenseId && !(state.expenses || []).some(item => item.id === state.editingExpenseId)) state.editingExpenseId = null;
}

// Apply an edition (API shape or payload) to the admin state.
export function applyEdition(edition, { keepUi = true } = {}) {
  const switching = state.activeEditionId !== edition.editionId;
  state.activeEditionId = edition.editionId;
  if (edition.eventId) state.activeEventId = edition.eventId;
  state.eventName = edition.eventName;
  state.activeEvent = { id: edition.editionId, name: edition.editionLabel, status: edition.editionStatus || state.activeEvent?.status || "open" };
  if (edition.editionStatus) state.editionStatus = edition.editionStatus;
  if (edition.financeStrategy) state.financeStrategy = edition.financeStrategy;
  state.startsAt = edition.startsAt || null;
  state.orderDeadline = edition.orderDeadline || null;
  state.catalog = clone(edition.catalog || []);
  state.registrations = clone(edition.registrations || []).map(reg => ({
    ...reg,
    adults: (reg.members || []).filter(p => p.type === "Volwassene").length || Number(reg.adults) || 0,
    children: (reg.members || []).filter(p => p.type === "Kind").length || Number(reg.children) || 0
  }));
  state.expenses = clone(edition.expenses || []);
  state.payments = clone(edition.payments || []);
  state.costsFinalized = Boolean(edition.costsFinalized);
  state.costsFinalizedAt = edition.costsFinalizedAt || null;
  state.financeRevision = Number(edition.financeRevision) || 0;
  state.configRevision = Number(edition.configRevision) || 0;
  if (!keepUi || switching) {
    state.beheerFamilyId = null;
    state.editingAdminMemberIndex = null;
    state.editingExpenseId = null;
    state.beheerRenaming = false;
  }
  keepSelectionValid();
}
