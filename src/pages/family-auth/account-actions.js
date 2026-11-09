// "Mijn account": the forms and buttons of screens/account.js.
import { portal, account, request, feedback, render } from "./portal-core.js";

const API = "/api/family-account/";

async function loadSettings() {
  account.settings = await request(API + "account", undefined, "GET");
  render();
}

// The message sits at the top of the page; on a phone the form can be far below it.
function say(message, kind) {
  feedback(message, kind);
  portal.view.querySelector("[data-feedback]")?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
}

export const clicks = {
  "open-help": () => {
    account.view.helpOpen = true;
    render();
    window.scrollTo?.(0, 0);
  },
  "close-help": () => {
    account.view.helpOpen = false;
    render();
  },
  "open-settings": async () => {
    account.view.helpOpen = false;
    account.view.settingsOpen = true;
    account.settings = null;
    render();
    try {
      await loadSettings();
    } catch (error) {
      say(error.message);
    }
  },
  "close-settings": () => {
    account.view.settingsOpen = false;
    render();
  },
  "remove-family-user": async control => {
    if (!window.confirm(control.dataset.name + " de toegang tot jullie gezin ontnemen?")) return;
    try {
      await request(
        API + "family-invite",
        { familyId: control.dataset.family, userId: control.dataset.user },
        "DELETE"
      );
      await loadSettings();
      say(control.dataset.name + " heeft geen toegang meer.", "success");
    } catch (error) {
      say(error.message);
    }
  }
};

const FORMS = {
  name: async form => {
    const { displayName } = await request(API + "change-name", { displayName: form.elements.displayName.value.trim() });
    account.user = { ...account.user, displayName };
    render();
    say("Je naam is bewaard.", "success");
  },
  password: async form => {
    const { currentPassword, newPassword, confirmPassword } = form.elements;
    if (newPassword.value !== confirmPassword.value) throw new Error("De nieuwe wachtwoorden komen niet overeen.");
    await request(API + "change-password", { currentPassword: currentPassword.value, newPassword: newPassword.value });
    form.reset();
    say("Je wachtwoord is gewijzigd. Op je andere toestellen ben je afgemeld.", "success");
  },
  email: async form => {
    const newEmail = form.elements.newEmail.value.trim();
    await request(API + "change-email", { newEmail, password: form.elements.password.value });
    form.reset();
    say(
      "We stuurden een bevestigingsmail naar " + newEmail + ". Je adres wijzigt zodra je op de link klikt.",
      "success"
    );
  },
  invite: async form => {
    const email = form.elements.email.value.trim();
    await request(API + "family-invite", {
      familyId: form.dataset.family,
      displayName: form.elements.displayName.value.trim(),
      email
    });
    await loadSettings();
    say("De uitnodiging is verstuurd naar " + email + ".", "success");
  }
};

export async function handleAccountSubmit(event) {
  const form = event.target.closest("[data-account-form]");
  if (!form) return;
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await FORMS[form.dataset.accountForm](form);
  } catch (error) {
    say(error.message);
  } finally {
    button.disabled = false;
  }
}

// The link in the confirmation mail opens /familie/email-bevestigen/<token>.
export async function confirmEmailLink(token) {
  try {
    const result = await request(API + "confirm-email", { token });
    return { message: "Je e-mailadres is gewijzigd naar " + result.email + ".", kind: "success" };
  } catch (error) {
    return { message: error.message, kind: "error" };
  }
}
