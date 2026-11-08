// Admin login/logout, family accounts and invitations, test mail, backups.
import { state } from "../../../data/admin-store.js";
import {
  session,
  renderApp,
  adminApi,
  flushAdminState,
  loadEverything,
  loadFamiliesAndAccounts,
  loadBackups
} from "../admin-core.js";

// Account actions disable their button while the call runs and reload the accounts afterwards.
const accountCall = (action, path, body, method, message) => {
  action.disabled = true;
  adminApi(path, body, method)
    .then(async () => {
      if (message) window.alert(message);
      await loadFamiliesAndAccounts();
      renderApp();
    })
    .catch(error => {
      window.alert(error.message);
      action.disabled = false;
    });
};

export const clicks = {
  "resend-account-invite": action => {
    accountCall(
      action,
      "/api/admin/family-users/" + encodeURIComponent(action.dataset.user) + "/resend",
      undefined,
      "POST",
      "De uitnodiging is opnieuw verstuurd."
    );
    return;
  },
  "account-status": action => {
    accountCall(
      action,
      "/api/admin/family-users/" + encodeURIComponent(action.dataset.user),
      { status: action.dataset.status },
      "PATCH"
    );
    return;
  },
  "account-unlock": action => {
    accountCall(
      action,
      "/api/admin/family-users/" + encodeURIComponent(action.dataset.user) + "/unlock",
      undefined,
      "POST",
      "Het account is ontgrendeld: aanmelden en wachtwoordherstel werken weer."
    );
    return;
  },
  "account-sessions": action => {
    accountCall(
      action,
      "/api/admin/family-users/" + encodeURIComponent(action.dataset.user) + "/sessions",
      undefined,
      "POST",
      "Dit account is op alle toestellen afgemeld."
    );
    return;
  },
  "account-delete": action => {
    const email = action.dataset.email || "";
    const confirmation = window.prompt(
      "Dit verwijdert het account en zijn toegang. Het gezin, de inschrijvingen, bestellingen en betalingen blijven behouden. Typ exact dit e-mailadres om te bevestigen:\n\n" +
        email
    );
    if (confirmation !== email) return;
    accountCall(
      action,
      "/api/admin/family-users/" + encodeURIComponent(action.dataset.user),
      { confirmEmail: email },
      "DELETE",
      "Het account is verwijderd."
    );
    return;
  },
  "create-backup": action => {
    action.disabled = true;
    action.textContent = "Bezig…";
    adminApi("/api/admin/backups", {})
      .then(result => {
        window.alert("Back-up gemaakt (" + Math.round(result.bytes / 1024) + " kB).");
        return loadBackups();
      })
      .catch(error => {
        window.alert(error.message);
        action.disabled = false;
        action.textContent = "Nu back-up maken";
      });
    return;
  },
  "admin-logout": action => {
    (async () => {
      try {
        await flushAdminState();
      } catch (error) {
        window.alert(error.message);
        renderApp();
        return;
      }
      fetch("/api/admin/logout", { method: "POST", credentials: "same-origin" }).finally(() => {
        session.authenticated = false;
        window.location.href = "/";
      });
    })();
    return;
  }
};

export const forms = {
  "admin-login-form": async (form, event) => {
    event.preventDefault();
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    button.textContent = "Even controleren…";
    session.loginError = "";
    try {
      await adminApi("/api/admin/login", { password: form.elements.password.value });
      session.authenticated = true;
      try {
        await loadEverything();
      } catch (loadError) {
        session.error = loadError.message || true;
        console.error("Admin load failed:", loadError);
      }
      state.activeSection = "events";
      renderApp();
    } catch (error) {
      session.loginError = error.message || "Aanmelden is niet gelukt.";
      renderApp();
    }
    return;
  },
  "mail-test-form": async (form, event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = "Verzenden…";
    try {
      await adminApi("/api/admin/mail-test", { recipient: form.elements.recipient.value.trim() });
      window.alert("Testmail verzonden. Controleer ook je ongewenste e-mail.");
      form.reset();
    } catch (error) {
      window.alert(error.message || "De testmail kon niet worden verzonden.");
    } finally {
      button.disabled = false;
      button.textContent = "Testmail versturen";
    }
    return;
  }
};

// Invite form on a family (Toegang): its id varies, so it is found by data-invite-account.
export async function inviteAccount(inviteForm, event) {
  event.preventDefault();
  const button = inviteForm.querySelector('button[type="submit"]');
  const familyId = inviteForm.dataset.inviteAccount;
  const displayName = inviteForm.elements.displayName.value.trim(),
    email = inviteForm.elements.email.value.trim();
  button.disabled = true;
  button.textContent = "Versturen…";
  try {
    await flushAdminState(); // a just-added family must exist in the database first
    const result = await adminApi("/api/admin/families/memberships", { familyId, displayName, email });
    await loadFamiliesAndAccounts();
    renderApp();
    window.alert(
      result.invited
        ? "Uitnodiging verstuurd naar " + email + "."
        : "Het bestaande account van " + email + " is aan dit gezin gekoppeld."
    );
  } catch (error) {
    window.alert(error.message || "De uitnodiging kon niet worden verstuurd.");
    button.disabled = false;
    button.textContent = "Uitnodiging versturen";
  }
  return;
}
