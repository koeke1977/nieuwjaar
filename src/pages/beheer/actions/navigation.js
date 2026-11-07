// Moving around in /beheer: sections, edition tabs, opening a family.
import { state } from "../../../data/admin-store.js";
import { go, renderApp, switchEdition } from "../admin-core.js";

export const clicks = {
  "open-edition": action => {
    switchEdition(action.dataset.id || state.activeEditionId).catch(error => window.alert(error.message));
    return;
  },
  "close-edition": action => {
    go({ beheerEventView: null, beheerFamilyId: null });
    window.scrollTo(0, 0);
    return;
  },
  "edition-tab": action => {
    go({
      activeSection: "events",
      beheerEventView: "edition",
      beheerEditionTab: action.dataset.tab,
      beheerFamilyId: null,
      editingExpenseId: null,
      editingAdminMemberIndex: null,
      beheerRenaming: false
    });
    return;
  },
  "open-family": action => {
    go({
      activeSection: "events",
      beheerEventView: "edition",
      beheerEditionTab: "registrations",
      beheerFamilyId: action.dataset.id,
      beheerUserFamilyId: null,
      editingAdminMemberIndex: null,
      beheerRenaming: false,
      beheerOpenMembers: new Set()
    });
    window.scrollTo(0, 0);
    return;
  },
  "close-family": action => {
    go({ beheerFamilyId: null, editingAdminMemberIndex: null, beheerRenaming: false });
    return;
  },
  "users-tab": action => {
    go({ beheerUsersTab: action.dataset.tab, beheerUserFamilyId: null });
    return;
  },
  "open-user-family": action => {
    go({
      activeSection: "users",
      beheerUserFamilyId: action.dataset.id,
      beheerFamilyId: null,
      editingAdminMemberIndex: null,
      beheerRenaming: false
    });
    window.scrollTo(0, 0);
    return;
  },
  "close-user-family": action => {
    go({ beheerUserFamilyId: null, editingAdminMemberIndex: null, beheerRenaming: false });
    return;
  },
  "rename-registration": action => {
    go({ beheerRenaming: true });
    document.querySelector("#rename-registration-form input")?.focus();
    return;
  },
  "cancel-rename": action => {
    go({ beheerRenaming: false });
    return;
  }
};

export const forms = {
  "order-for-family-form": async (form, event) => {
    event.preventDefault();
    const registration = state.registrations.find(item => item.id === form.elements.registrationId.value);
    if (!registration) return;
    // Open the family's order screen with every member expanded, ready for + / −.
    Object.assign(state, {
      activeSection: "events",
      beheerEventView: "edition",
      beheerEditionTab: "registrations",
      beheerFamilyId: registration.id,
      editingAdminMemberIndex: null,
      beheerRenaming: false,
      beheerOpenMembers: new Set((registration.members || []).map(person => person.id))
    });
    renderApp();
    document.querySelector(".bh-members")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
};
