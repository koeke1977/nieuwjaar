import template from "./family-auth.html?raw";
import "./family-auth.css";

const root = () => document.querySelector("#app");
const request = async (path, body) => {
  const response = await fetch(path, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Er liep iets mis. Probeer opnieuw.");
  return result;
};

export async function startFamilyAuth() {
  root().innerHTML = template;
  const view = root();
  const path = location.pathname;
  const activation = path.match(/^\/familie\/activeren\/([^/]+)\/?$/);
  const reset = path.match(/^\/familie\/wachtwoord-reset\/([^/]+)\/?$/);
  let token = activation?.[1] || reset?.[1] || "";
  let currentPanel = activation ? "activate" : reset ? "reset" : path === "/familie/wachtwoord-vergeten" ? "forgot" : "login";
  const show = (name) => {
    currentPanel = name;
    view.querySelectorAll("[data-panel]").forEach(panel => { panel.hidden = panel.dataset.panel !== name; });
    feedback("");
  };
  const feedback = (message, kind = "error") => {
    const node = view.querySelector("[data-feedback]");
    node.textContent = message;
    node.hidden = !message;
    node.dataset.kind = kind;
  };
  const submit = async (form, callback, successMessage) => {
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try { await callback(new FormData(form)); if (successMessage) feedback(successMessage, "success"); }
    catch (error) { feedback(error.message || "Er liep iets mis."); }
    finally { button.disabled = false; }
  };

  view.addEventListener("click", async event => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (action === "show-forgot") show("forgot");
    if (action === "show-login") show("login");
    if (action === "logout") {
      try { await request("/api/family-account/logout", {}); token = ""; show("login"); }
      catch (error) { feedback(error.message); }
    }
  });
  view.addEventListener("submit", event => {
    const form = event.target.closest("form[data-form]");
    if (!form) return;
    event.preventDefault();
    const data = new FormData(form);
    const values = Object.fromEntries(data.entries());
    if (form.dataset.form === "login") submit(form, async () => {
      await request("/api/family-account/login", { email: values.email, password: values.password });
      await loadAccount();
    });
    if (form.dataset.form === "forgot") submit(form, async () => {
      await request("/api/family-account/forgot-password", { email: values.email });
      show("login"); feedback("Als dit e-mailadres bij een actief account hoort, ontvang je een e-mail met verdere instructies.", "success");
    });
    if (form.dataset.form === "activate") submit(form, async () => {
      if (values.password !== values.confirm) throw new Error("De wachtwoorden komen niet overeen.");
      await request("/api/family-account/activate", { token, password: values.password, displayName: values.displayName });
      token = ""; await loadAccount();
    });
    if (form.dataset.form === "reset") submit(form, async () => {
      if (values.password !== values.confirm) throw new Error("De wachtwoorden komen niet overeen.");
      await request("/api/family-account/reset-password", { token, password: values.password });
      token = ""; show("login"); feedback("Je wachtwoord is aangepast. Je kunt nu aanmelden.", "success");
    });
  });

  async function loadAccount() {
    const response = await fetch("/api/family-account/session", { credentials: "same-origin" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.authenticated) { show("login"); return; }
    view.querySelector("[data-account-heading]").textContent = result.user?.displayName ? "Welkom, " + result.user.displayName + "." : "Welkom.";
    view.querySelector("[data-account-email]").textContent = result.user?.email || "";
    show("account");
  }

  if (!activation && !reset && currentPanel !== "forgot") {
    try { await loadAccount(); } catch { show("login"); }
  } else {
    show(currentPanel);
  }
}
