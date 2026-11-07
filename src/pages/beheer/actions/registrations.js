// Registrations and their members: register, unregister, rename, add/edit/delete people, order.
import { state } from "../../../data/admin-store.js";
import { isMemberType, EVENING } from "../../../utils/member-types.js";
import { go, renderApp, makeId, recount, markCostsProvisional } from "../admin-core.js";

export const clicks = {
  "unregister-family": action => {
    const registration = state.registrations.find(item => item.id === action.dataset.id);
    if (!registration) return;
    const linked =
      state.expenses.filter(item => item.advancedBy === registration.id).length +
      state.payments.filter(item => item.registrationId === registration.id).length;
    if (linked) {
      window.alert(
        registration.name +
          " heeft nog " +
          linked +
          " kost(en) of betaling(en) in deze editie. Verwijder of wijzig die eerst bij Financiën, en schrijf het gezin daarna uit."
      );
      return;
    }
    if (
      !window.confirm(
        registration.name +
          " uitschrijven uit " +
          state.eventName +
          " " +
          state.activeEvent.name +
          "? De bestelling van deze editie vervalt. Het gezin en zijn accounts blijven bestaan onder Gebruikers."
      )
    )
      return;
    state.registrations = state.registrations.filter(item => item.id !== registration.id);
    markCostsProvisional();
    go({ beheerFamilyId: null, editingAdminMemberIndex: null });
    return;
  },
  "register-family": action => {
    // Register a known family for the open edition, starting from the members of its last registration.
    const familyId = action.dataset.id;
    registerFamily(familyId);
    return;
  },
  "admin-quantity": action => {
    const registration = state.registrations.find(item => item.id === action.dataset.registration);
    const person = registration?.members?.find(item => item.id === action.dataset.person);
    const product = state.catalog.find(item => item.id === action.dataset.product);
    if (!person || !product || person.type === EVENING) return;
    person.orders = person.orders || {};
    person.orders[product.id] = Math.max(
      0,
      Math.min(99, (Number(person.orders[product.id]) || 0) + Number(action.dataset.delta))
    );
    markCostsProvisional();
    renderApp();
    return;
  },
  "edit-member": action => {
    go({ editingAdminMemberIndex: Number(action.dataset.index) });
    return;
  },
  "cancel-edit-admin-member": action => {
    go({ editingAdminMemberIndex: null });
    return;
  },
  "delete-member": action => {
    const registration = state.registrations.find(item => item.id === state.managingRegistrationId);
    const index = Number(action.dataset.index);
    if (
      !registration?.members?.[index] ||
      !window.confirm(`Verwijder ${registration.members[index].name} uit deze inschrijving?`)
    )
      return;
    registration.members.splice(index, 1);
    recount(registration);
    markCostsProvisional();
    renderApp();
    return;
  }
};

export const forms = {
  "rename-registration-form": async (form, event) => {
    event.preventDefault();
    const registration = state.registrations.find(item => item.id === form.dataset.id);
    const name = form.elements.registrationName.value.trim();
    if (!registration || !name) return;
    registration.name = name;
    state.beheerRenaming = false;
    renderApp();
    return;
  },
  "register-family-form": async (form, event) => {
    event.preventDefault();
    const familyId = form.elements.familyId.value;
    if (familyId) registerFamily(familyId);
    return;
  },
  "add-registration-form": async (form, event) => {
    event.preventDefault();
    const name = form.elements.registrationName.value.trim();
    if (!name) {
      window.alert("Vul een naam voor het gezin in.");
      return;
    }
    if (state.editionStatus === "archived") {
      window.alert("Deze editie is afgesloten. Open de actieve editie om een gezin in te schrijven.");
      return;
    }
    const registrationId = makeId("inschrijving"),
      familyId = makeId("gezin");
    state.registrations.push({ id: registrationId, familyId, name, adults: 0, children: 0, members: [], revision: 0 });
    state.managingRegistrationId = registrationId;
    if (form.dataset.context === "users") state.beheerUserFamilyId = familyId;
    else state.beheerFamilyId = registrationId;
    state.beheerOpenMembers = new Set();
    renderApp();
    window.scrollTo(0, 0);
    return;
  },
  "add-member-form": async (form, event) => {
    event.preventDefault();
    const registration = state.registrations.find(item => item.id === state.managingRegistrationId);
    const name = form.elements.memberName.value.trim(),
      type = form.elements.memberType.value;
    if (!registration || !name || !isMemberType(type)) return;
    registration.members = registration.members || [];
    if (registration.members.length >= 30) {
      window.alert("Een inschrijving kan maximaal 30 personen bevatten.");
      return;
    }
    registration.members.push({
      id: makeId("lid"),
      name,
      type,
      orders: Object.fromEntries(state.catalog.map(product => [product.id, 0]))
    });
    recount(registration);
    markCostsProvisional();
    renderApp();
    return;
  },
  "edit-admin-member-form": async (form, event) => {
    event.preventDefault();
    const registration = state.registrations.find(item => item.id === state.managingRegistrationId);
    const member = registration?.members?.[Number(form.dataset.index)];
    const name = form.elements.memberName.value.trim(),
      type = form.elements.memberType.value;
    if (!member || !name || !isMemberType(type)) {
      window.alert("Vul een geldige naam in en kies een categorie.");
      return;
    }
    member.name = name;
    member.type = type;
    if (type === EVENING) member.orders = {}; // evening guests order no meat
    const diet = [...form.querySelectorAll('input[name="diet"]:checked')].map(input => input.value);
    const notes = (form.elements.notes?.value || "").trim();
    if (diet.length) member.diet = diet;
    else delete member.diet;
    if (notes) member.notes = notes;
    else delete member.notes;
    recount(registration);
    markCostsProvisional();
    state.editingAdminMemberIndex = null;
    renderApp();
    return;
  }
};

export function registerFamily(familyId) {
  if (state.editionStatus === "archived") {
    window.alert("Deze editie is afgesloten. Open de actieve editie om gezinnen in te schrijven.");
    return;
  }
  if (state.registrations.some(item => item.familyId === familyId)) return;
  const family = (state.beheerFamiliesCache || []).find(item => item.id === familyId);
  const latest = family?.registrations?.[0];
  const members = (latest?.members || []).map(person => ({
    id: person.id,
    name: person.name,
    type: person.type,
    orders: {}
  }));
  const id = makeId("inschrijving");
  const registration = { id, familyId, name: family?.name || latest?.name || "Gezin", members, revision: 0 };
  recount(registration);
  state.registrations.push(registration);
  markCostsProvisional();
  renderApp();
}

// Personal bar bill typed in euros on the Bar tab.
export function handleBarInput(event) {
  const input = event.target.closest?.("[data-bar-input]");
  if (!input) return;
  const registration = state.registrations.find(item => item.id === input.dataset.registration);
  const person = registration?.members?.find(item => item.id === input.dataset.person);
  if (!person) return;
  const cents = Math.round(Math.max(0, Math.min(100000, Number(String(input.value).replace(",", ".")) || 0)) * 100);
  if (cents) person.barCents = cents;
  else delete person.barCents;
  markCostsProvisional();
  renderApp();
}
