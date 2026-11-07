// Shared in-memory state of the admin console. It starts empty and is filled from the
// database: the events overview, one loaded edition, and the global families/accounts.
export const state = {
  // events overview (GET /api/admin/events)
  events: [],
  // the loaded edition (GET /api/admin/editions/:id/state)
  activeEditionId: null,
  activeEventId: null,
  eventName: "",
  activeEvent: { id: null, name: "", status: "open" },
  editionStatus: "open",
  financeStrategy: "nieuwjaar",
  catalog: [],
  registrations: [],
  expenses: [],
  payments: [],
  costsFinalized: false,
  costsFinalizedAt: null,
  financeRevision: 0,
  configRevision: 0,
  // UI
  activeConsole: "admin",
  activeSection: "events",
  managingRegistrationId: null,
  editingAdminMemberIndex: null,
  editingExpenseId: null
};
