// Edition settings, products and photos, next edition, new event, message to families.
import { state } from "../../../data/admin-store.js";
import { loadEvents, startNextEdition, createEvent } from "../../../services/admin-state.js";
import { MESSAGE_TEMPLATES } from "../beheer-view.js";
import { renderApp, flushAdminState, loadFamiliesAndAccounts, rememberEdition, adminApi } from "../admin-core.js";

export const clicks = {
  print: action => {
    window.print();
  },
  "message-template": action => {
    const template = MESSAGE_TEMPLATES[action.dataset.template];
    const form = document.querySelector("#family-message-form");
    if (!template) return;
    state.beheerMessageDraft = {
      audience: action.dataset.template === "reminder" ? "no-order" : form?.elements.audience.value || "all",
      subject: template.subject(),
      message: template.message()
    };
    renderApp();
    document.querySelector("#family-message-form textarea")?.focus();
    return;
  },
  "toggle-product": action => {
    const product = state.catalog.find(item => item.id === action.dataset.id);
    if (product) product.active = !product.active;
    renderApp();
  },
  "remove-image": action => {
    const product = state.catalog.find(item => item.id === action.dataset.id);
    if (!product) return;
    const oldImage = product.image;
    product.image = null;
    renderApp();
    if (oldImage?.startsWith("/media/"))
      fetch("/api/admin/product-image", {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: oldImage })
      }).catch(error => console.error("Photo delete failed:", error));
  }
};

export const forms = {
  "event-settings-form": async (form, event) => {
    event.preventDefault();
    const eventName = form.elements.eventName.value.trim(),
      editionName = form.elements.editionName.value.trim();
    if (!eventName || !editionName) {
      window.alert("Vul de naam van het evenement en van de editie in.");
      return;
    }
    state.eventName = eventName;
    state.activeEvent = { ...state.activeEvent, name: editionName };
    state.startsAt = (form.elements.startsAt?.value || "").slice(0, 16) || null;
    state.orderDeadline = (form.elements.orderDeadline?.value || "").slice(0, 16) || null;
    renderApp();
    flushAdminState()
      .then(loadEvents)
      .then(renderApp)
      .catch(error => window.alert(error.message));
    return;
  },
  "new-edition-form": async (form, event) => {
    event.preventDefault();
    const name = form.elements.editionName.value.trim();
    if (!name) {
      window.alert("Geef de nieuwe editie een naam.");
      return;
    }
    if (
      !window.confirm(
        `"${state.eventName} ${state.activeEvent.name}" wordt afgesloten (je kan de editie later nog openen). Daarna start "${name}". Gezinnen en accounts blijven bestaan en schrijven zich opnieuw in. Doorgaan?`
      )
    )
      return;
    try {
      await flushAdminState();
      const editionId = await startNextEdition(name, form.elements.copyCatalog.checked);
      rememberEdition(editionId);
      await loadFamiliesAndAccounts();
      Object.assign(state, { activeSection: "events", beheerEventView: "edition", beheerEditionTab: "registrations" });
      renderApp();
    } catch (error) {
      window.alert(error.message);
    }
    return;
  },
  "create-event-form": async (form, event) => {
    event.preventDefault();
    const name = form.elements.eventName.value.trim(),
      editionName = form.elements.editionName.value.trim();
    if (!name || !editionName) return;
    try {
      await flushAdminState();
      const editionId = await createEvent(name, editionName);
      rememberEdition(editionId);
      Object.assign(state, { activeSection: "events", beheerEventView: "edition", beheerEditionTab: "products" });
      renderApp();
    } catch (error) {
      window.alert(error.message);
    }
    return;
  },
  "family-message-form": async (form, event) => {
    event.preventDefault();
    const audience = form.elements.audience.value,
      subject = form.elements.subject.value.trim(),
      message = form.elements.message.value.trim();
    const label = form.elements.audience.selectedOptions[0]?.textContent || "";
    if (!subject || !message) return;
    if (!window.confirm("Dit bericht nu versturen naar " + label.toLowerCase() + "?\n\nOnderwerp: " + subject)) return;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = "Versturen…";
    try {
      const result = await adminApi("/api/admin/editions/" + encodeURIComponent(state.activeEditionId) + "/message", {
        audience,
        subject,
        message
      });
      state.beheerMessageDraft = null;
      renderApp();
      window.alert(
        "Bericht verstuurd naar " +
          result.sent +
          " " +
          (result.sent === 1 ? "ontvanger" : "ontvangers") +
          "." +
          (result.failed?.length ? "\nNiet gelukt voor: " + result.failed.join(", ") : "")
      );
    } catch (error) {
      window.alert(error.message);
      button.disabled = false;
      button.textContent = "Bericht versturen";
    }
    return;
  },
  "add-product-form": async (form, event) => {
    event.preventDefault();
    const name = form.elements.productName.value.trim();
    if (!name) return;
    if (state.catalog.some(item => item.name.toLowerCase() === name.toLowerCase())) {
      window.alert("Dit product bestaat al.");
      return;
    }
    const productId =
      name
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 50) +
      "-" +
      Date.now().toString(36);
    state.catalog.push({ id: productId, name, active: true, image: null });
    renderApp();
  }
};

export function rememberMessageDraft(event) {
  const form = event.target.closest?.("#family-message-form");
  if (form)
    state.beheerMessageDraft = {
      audience: form.elements.audience.value,
      subject: form.elements.subject.value,
      message: form.elements.message.value
    };
}

export async function handleImageUpload(event) {
  const input = event.target;
  if (!input.matches("[data-upload-image]")) return;
  const file = input.files?.[0];
  if (!file) return;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    window.alert("Gebruik een JPG-, PNG- of WebP-afbeelding.");
    input.value = "";
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    window.alert("De afbeelding mag maximaal 5 MB groot zijn.");
    input.value = "";
    return;
  }
  const product = state.catalog.find(item => item.id === input.dataset.uploadImage);
  if (!product) return;
  const oldImage = product.image;
  const label = input.closest(".catalog-admin-actions")?.querySelector("label");
  if (label) label.textContent = "Uploaden…";
  try {
    const body = new FormData();
    body.append("file", file);
    body.append("productId", product.id);
    const response = await fetch("/api/admin/product-image", { method: "POST", credentials: "same-origin", body });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "De foto kon niet worden opgeslagen.");
    product.image = result.image;
    try {
      await flushAdminState();
    } catch (saveError) {
      // store the new photo reference before deleting the old photo
      product.image = oldImage;
      await fetch("/api/admin/product-image", {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: result.image })
      }).catch(() => {});
      throw new Error(
        "De foto is geüpload, maar kon niet veilig worden gekoppeld. De vorige foto blijft behouden. " +
          (saveError.message || "")
      );
    }
    renderApp();
    if (oldImage?.startsWith("/media/"))
      fetch("/api/admin/product-image", {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: oldImage })
      }).catch(() => {});
  } catch (error) {
    window.alert(error.message || "De foto kon niet worden opgeslagen.");
  } finally {
    input.value = "";
  }
}
