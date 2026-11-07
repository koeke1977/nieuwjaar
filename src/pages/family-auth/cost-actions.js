// Costs a family enters itself, with a photo of the receipt.
import { account, activeItem, request, feedback, render, refreshAccount } from "./portal-core.js";

// Phone photos are made smaller before upload (max 1600 px, JPEG); PDFs and HEIC go as they are.
async function shrinkImage(file) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || typeof createImageBitmap !== "function")
    return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1.5 * 1024 * 1024) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.82));
    return blob ? new File([blob], "kasticket.jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}

export const clicks = {
  "edit-expense": control => {
    account.view.editingExpenseId = control.dataset.id;
    render();
  },
  "cancel-edit-expense": () => {
    account.view.editingExpenseId = null;
    render();
  },
  "delete-expense": async control => {
    const item = activeItem();
    if (!item || !window.confirm("Deze kost verwijderen? De afrekening wordt opnieuw berekend.")) return;
    try {
      await request(
        "/api/family-account/expenses",
        { edition: item.edition, registrationId: item.registration.id, expenseId: control.dataset.id },
        "DELETE"
      );
      account.signature = null;
      await refreshAccount();
      feedback("De kost is verwijderd.", "success");
    } catch (error) {
      feedback(error.message);
    }
  }
};

export async function handleExpenseSubmit(event) {
  const expenseForm = event.target.closest("[data-family-expense]");
  if (!expenseForm) return;
  event.preventDefault();
  const item = activeItem();
  if (!item) return;
  const amountCents = Math.round(Number(String(expenseForm.elements.amount.value).replace(",", ".")) * 100);
  const button = expenseForm.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    let receipt;
    const chosen = expenseForm.elements.receipt?.files?.[0];
    if (chosen) {
      button.textContent = "Kasticket uploaden…";
      const upload = new FormData();
      upload.append("file", await shrinkImage(chosen));
      upload.append("edition", item.edition);
      upload.append("registrationId", item.registration.id);
      const response = await fetch("/api/family-account/receipts", {
        method: "POST",
        credentials: "same-origin",
        body: upload
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Het kasticket kon niet worden opgeladen.");
      receipt = result.receipt;
    }
    button.textContent = "Bewaren…";
    await request("/api/family-account/expenses", {
      edition: item.edition,
      registrationId: item.registration.id,
      expense: {
        receipt,
        id: expenseForm.dataset.familyExpense || undefined,
        description: expenseForm.elements.description.value.trim(),
        amountCents,
        date: expenseForm.elements.date.value,
        method: expenseForm.elements.method.value
      }
    });
    account.view.editingExpenseId = null;
    account.view.addCostOpen = false;
    account.signature = null;
    await refreshAccount();
    feedback("De kost is bewaard en verdeeld.", "success");
  } catch (error) {
    feedback(error.message);
    button.disabled = false;
    button.textContent = expenseForm.dataset.familyExpense ? "Bewaren" : "Kost toevoegen";
  }
}
