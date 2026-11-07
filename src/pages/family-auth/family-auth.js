// Familieportaal: puts the page in place, routes clicks/forms to the right handlers, first load.
import template from "./family-auth.html?raw";
import "./family-auth.css";
import "./family-account.css";
import { portal, account, activeItem, show, render, loadAccount, startTimers } from "./portal-core.js";
import * as signIn from "./sign-in.js";
import * as family from "./family-actions.js";
import * as costs from "./cost-actions.js";

const CLICKS = { ...costs.clicks, ...family.clicks, ...signIn.clicks };

function handleClick(event) {
  const view = portal.view;
  const control = event.target.closest("[data-action], [data-tab], [data-tab-target], [data-switch-registration]");
  if (!control) return;
  if (control.dataset.tab || control.dataset.tabTarget) {
    account.view.tab = control.dataset.tab || control.dataset.tabTarget;
    account.view.editingMemberId = null;
    render();
    view.querySelector(".fa-tabs")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    return;
  }
  if (control.dataset.switchRegistration) {
    account.activeId = control.dataset.switchRegistration;
    account.view = { tab: "overview", editingMemberId: null, openPeople: null };
    render();
    return;
  }
  const action = control.dataset.action;
  if (Object.hasOwn(CLICKS, action)) return CLICKS[action](control);
  if (!Object.hasOwn(family.editorClicks, action)) return;
  const item = activeItem();
  if (!item || item.accessRole === "viewer") return;
  const members = item.registration.members || (item.registration.members = []);
  family.editorClicks[action](control, item, members);
}

export async function startFamilyAuth() {
  const view = document.querySelector("#app");
  view.innerHTML = template;
  portal.view = view;
  const path = location.pathname;
  const activation = path.match(/^\/familie\/activeren\/([^/]+)\/?$/);
  const reset = path.match(/^\/familie\/wachtwoord-reset\/([^/]+)\/?$/);
  portal.token = activation?.[1] || reset?.[1] || "";
  portal.panel = activation
    ? "activate"
    : reset
      ? "reset"
      : path === "/familie/wachtwoord-vergeten"
        ? "forgot"
        : "login";

  startTimers();
  view.addEventListener("click", handleClick);
  view.addEventListener("toggle", family.rememberOpenPeople, true);
  view.addEventListener("submit", costs.handleExpenseSubmit);
  view.addEventListener("submit", family.handleMemberSubmit);
  view.addEventListener("input", signIn.handlePasswordInput);
  view.addEventListener("submit", signIn.handleSignInSubmit);

  if (!activation && !reset && portal.panel !== "forgot") {
    try {
      await loadAccount();
    } catch {
      show("login");
    }
  } else {
    show(portal.panel);
  }
}
