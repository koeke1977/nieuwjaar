import { state } from "../data/demo-data.js";

export function renderHeader() {
  const editionName = state.activeEvent?.name || "Nieuwjaar";
  const active = state.activeEvent?.status === "active";
  return `
    <header class="topbar">
      <a class="brand" href="#" aria-label="Nieuwjaar start">
        <span class="brand-mark">✳</span>
        <span><strong>NIEUWJAAR</strong><small>${editionName.toUpperCase()}</small></span>
      </a>
      <div class="topbar-right">
        <span class="edition-pill"><i></i> ${active ? "Inschrijving actief" : "Geen actieve editie"}</span>
        <button class="avatar" aria-label="Profiel">K</button>
      </div>
    </header>`;
}
