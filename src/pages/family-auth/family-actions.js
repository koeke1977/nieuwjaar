// The family's own registration: self-register for an edition, people, meat order.
import { portal, account, activeItem, request, feedback, render, scheduleSave, refreshAccount } from "./portal-core.js";

export const clicks = {
  "self-register": async control => {
    control.disabled = true;
    control.textContent = "Inschrijven…";
    try {
      await request("/api/family-account/register", {
        edition: control.dataset.edition,
        familyId: control.dataset.family
      });
      account.signature = null;
      await refreshAccount();
      const created = account.items.find(item => item.edition === control.dataset.edition);
      if (created) {
        account.activeId = created.registration.id;
        account.view = { tab: "family", editingMemberId: null, openPeople: null };
        render();
      }
      feedback("Jullie zijn ingeschreven. Controleer de gezinsleden en kies daarna jullie bestelling.", "success");
    } catch (error) {
      feedback(error.message);
      control.disabled = false;
      control.textContent = "Inschrijven";
    }
  }
};

// Only for owners and editors (not viewers): (control, item, members) of the active registration.
export const editorClicks = {
  quantity: (control, item, members) => {
    const person = members.find(entry => entry.id === control.dataset.person);
    const product = control.dataset.product;
    if (!person || person.type === "Avondgast" || !item.catalog.some(entry => entry.id === product)) return;
    person.orders = person.orders || {};
    person.orders[product] = Math.max(
      0,
      Math.min(99, (Number(person.orders[product]) || 0) + Number(control.dataset.delta))
    );
    render();
    scheduleSave(item);
  },
  "edit-member": control => {
    account.view.editingMemberId = control.dataset.person;
    render();
    portal.view.querySelector("[data-edit-member] input")?.focus();
  },
  "cancel-edit-member": () => {
    account.view.editingMemberId = null;
    render();
  },
  "remove-member": (control, item, members) => {
    const index = Number(control.dataset.index);
    const person = members[index];
    if (!person || members.length <= 1) return;
    const portions = Object.values(person.orders || {}).reduce((sum, qty) => sum + (Number(qty) || 0), 0);
    if (
      !window.confirm(
        person.name +
          " verwijderen uit jullie inschrijving?" +
          (portions ? " Ook de " + portions + " bestelde porties vervallen." : "")
      )
    )
      return;
    members.splice(index, 1);
    render();
    scheduleSave(item, { immediate: true });
  }
};

// Remember which people are expanded in the order tab across re-renders.
export function rememberOpenPeople(event) {
  const details = event.target.closest?.("[data-order-person]");
  if (!details) return;
  if (!account.view.openPeople) {
    account.view.openPeople = new Set(
      [...portal.view.querySelectorAll("[data-order-person][open]")].map(node => node.dataset.orderPerson)
    );
  }
  if (details.open) account.view.openPeople.add(details.dataset.orderPerson);
  else account.view.openPeople.delete(details.dataset.orderPerson);
}

// Add a person, or save the edit form of one (name, category, allergies, note).
export function handleMemberSubmit(event) {
  const item = activeItem();
  const addForm = event.target.closest("[data-add-member]");
  const editForm = event.target.closest("[data-edit-member]");
  if (!addForm && !editForm) return;
  event.preventDefault();
  if (!item || item.accessRole === "viewer") return;
  const name = event.target.elements.memberName.value.trim();
  const type = event.target.elements.memberType.value;
  if (!name || !["Volwassene", "Kind", "Avondgast"].includes(type)) return;
  const members = item.registration.members || (item.registration.members = []);
  if (addForm) {
    if (members.length >= 30) {
      feedback("Een inschrijving kan maximaal 30 personen bevatten.");
      return;
    }
    members.push({ id: crypto.randomUUID(), name, type, orders: {} });
  } else {
    const person = members.find(entry => entry.id === editForm.dataset.editMember);
    if (!person) return;
    person.name = name;
    person.type = type;
    if (type === "Avondgast") person.orders = {}; // evening guests order no meat
    const diet = [...editForm.querySelectorAll('input[name="diet"]:checked')].map(input => input.value);
    const notes = (editForm.elements.notes?.value || "").trim();
    if (diet.length) person.diet = diet;
    else delete person.diet;
    if (notes) person.notes = notes;
    else delete person.notes;
    account.view.editingMemberId = null;
  }
  render();
  scheduleSave(item, { immediate: true });
}
