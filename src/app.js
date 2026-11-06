import { state } from "./data/demo-data.js";
import { renderHeader } from "./components/header.js";
import { renderConsoleSwitcher, renderUserNavigation, renderAdminNavigation } from "./components/navigation.js";
import { renderUserContent } from "./pages/user.js";
import { renderAdminContent } from "./pages/admin.js";
import { money } from "./utils/format.js";

function renderApp() {
  const isAdmin = state.activeConsole === "admin";
  document.querySelector("#app").innerHTML = `
    ${renderHeader()}
    <main class="shell">
      ${renderConsoleSwitcher(state.activeConsole)}
      <div class="workspace">
        ${isAdmin ? renderAdminNavigation(state.activeSection) : renderUserNavigation(state.activeSection)}
        <div class="content">${isAdmin ? renderAdminContent(state.activeSection) : renderUserContent(state.activeSection)}</div>
      </div>
      <footer>Nieuwjaar <span>·</span> Samen vieren, alles geregeld.</footer>
    </main>`;
}

function handleClick(event) {
  const consoleButton = event.target.closest("[data-console]");
  if (consoleButton) {
    state.activeConsole = consoleButton.dataset.console;
    state.activeSection = "overview";
    renderApp();
    return;
  }

  const sectionButton = event.target.closest("[data-section]");
  if (sectionButton) {
    state.activeSection = sectionButton.dataset.section;
    renderApp();
    return;
  }

  const action = event.target.closest("[data-action]");
  if (!action) return;

  if (action.dataset.action === "receive") {
    const payment = state.payments[Number(action.dataset.index)];
    const remaining = Math.max(0, payment.due - payment.paid);
    const raw = window.prompt(
      `Hoeveel heeft ${payment.household} betaald?\nNog openstaand: ${money(remaining)}`,
      String(remaining)
    );
    if (raw === null) return;

    const amount = Number(raw.replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) {
      window.alert("Geef een geldig bedrag in.");
      return;
    }

    payment.paid = Math.round((payment.paid + amount) * 100) / 100;
    payment.method = "Cash";
    renderApp();
  }

  if (action.dataset.action === "print") window.print();
  if (action.dataset.action === "edit-order") {
    window.alert(`Bestelling aanpassen voor ${action.dataset.name} – invoer volgt in de volgende bouwstap.`);
  }
}

export function startApp() {
  document.addEventListener("click", handleClick);
  renderApp();
}
