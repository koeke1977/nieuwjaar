// Signing in and out: login, forgotten password, activation and reset links, password hints.
import { portal, account, request, show, feedback, submit, loadAccount } from "./portal-core.js";

export const clicks = {
  "show-forgot": () => show("forgot"),
  "show-login": () => show("login"),
  logout: async () => {
    try {
      await request("/api/family-account/logout", {});
      portal.token = "";
      account.items = [];
      account.view.settingsOpen = false;
      account.view.helpOpen = false;
      account.settings = null;
      show("login");
    } catch (error) {
      feedback(error.message);
    }
  }
};

const updatePasswordHints = form => {
  if (!form || !["activate", "reset"].includes(form.dataset.form)) return;
  const password = form.elements.password?.value || "";
  const confirm = form.elements.confirm?.value || "";
  const lengthHint = form.querySelector("[data-password-hint]");
  const confirmHint = form.querySelector("[data-confirm-hint]");
  if (lengthHint) {
    const valid = password.length >= 12;
    lengthHint.textContent =
      password.length + "/12 tekens" + (valid ? " · voldoende" : " · nog " + (12 - password.length) + " te gaan");
    lengthHint.dataset.valid = String(valid);
  }
  if (confirmHint) {
    const touched = confirm.length > 0;
    confirmHint.textContent = !touched
      ? "Vul hetzelfde wachtwoord opnieuw in."
      : password === confirm
        ? "De wachtwoorden komen overeen."
        : "De wachtwoorden komen nog niet overeen.";
    confirmHint.dataset.valid = String(touched && password === confirm);
  }
};

export function handlePasswordInput(event) {
  const form = event.target.closest('form[data-form="activate"], form[data-form="reset"]');
  if (form) updatePasswordHints(form);
}

export function handleSignInSubmit(event) {
  const form = event.target.closest("form[data-form]");
  if (!form) return;
  event.preventDefault();
  const data = new FormData(form);
  const values = Object.fromEntries(data.entries());
  if (form.dataset.form === "login")
    submit(form, async () => {
      await request("/api/family-account/login", { email: values.email, password: values.password });
      await loadAccount();
    });
  if (form.dataset.form === "forgot")
    submit(form, async () => {
      await request("/api/family-account/forgot-password", { email: values.email });
      show("login");
      feedback(
        "Als dit e-mailadres bij een actief account hoort, ontvang je een e-mail met verdere instructies.",
        "success"
      );
    });
  if (form.dataset.form === "activate")
    submit(form, async () => {
      if (values.password.length < 12) throw new Error("Kies een wachtwoord van minstens 12 tekens.");
      if (values.password !== values.confirm) throw new Error("De wachtwoorden komen niet overeen.");
      await request("/api/family-account/activate", {
        token: portal.token,
        password: values.password,
        displayName: values.displayName
      });
      portal.token = "";
      await loadAccount();
    });
  if (form.dataset.form === "reset")
    submit(form, async () => {
      if (values.password.length < 12) throw new Error("Kies een wachtwoord van minstens 12 tekens.");
      if (values.password !== values.confirm) throw new Error("De wachtwoorden komen niet overeen.");
      await request("/api/family-account/reset-password", { token: portal.token, password: values.password });
      portal.token = "";
      show("login");
      feedback("Je wachtwoord is aangepast. Je kunt nu aanmelden.", "success");
    });
}
