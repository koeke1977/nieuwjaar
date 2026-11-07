export function renderConsoleSwitcher(activeConsole) {
  return `<div class="console-switch" role="tablist" aria-label="Console kiezen">
    <button class="${activeConsole === "user" ? "selected" : ""}" data-console="user">Deelnemersportaal</button>
    <button class="${activeConsole === "admin" ? "selected" : ""}" data-console="admin">Admin Console</button>
  </div>`;
}
function renderNavigation(links, activeSection) {
  return `<nav class="side-nav">${links.map(([id, icon, label]) =>
    `<button data-section="${id}" class="${activeSection === id ? "active" : ""}"><span>${icon}</span>${label}</button>`
  ).join("")}</nav>`;
}
export const renderUserNavigation = activeSection => renderNavigation([
  ["overview","⌂","Overzicht"],["family","♧","Gezin"],["meat","♨","Vlees"],["balance","€","Afrekening"]
], activeSection);
