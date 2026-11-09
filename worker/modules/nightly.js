// The nightly jobs. Each runs on its own, and if one fails the organisation gets a mail:
// a failure in the Cloudflare log alone would go unnoticed for weeks.
import { esc } from "../../src/utils/html.js";
import { pruneActivity } from "./activity.js";
import { backupDatabase } from "./backup.js";
import { pruneOrphanReceipts } from "./receipts.js";

const JOBS = [
  { name: "Back-up van de database", important: true, run: backupDatabase },
  { name: "Opruimen van kastickets", run: pruneOrphanReceipts },
  { name: "Opruimen van oude activiteit", run: env => pruneActivity(env) }
];

export function failureMail(failures) {
  const backup = failures.some(failure => failure.job.important);
  return {
    subject: backup
      ? "Waarschuwing: de nachtelijke back-up is mislukt"
      : "Waarschuwing: een nachtelijke taak is mislukt",
    html:
      '<div style="font-family:Arial,sans-serif;color:#242424;line-height:1.6"><h2>Nachtelijke taak mislukt</h2><ul>' +
      failures
        .map(failure => "<li><strong>" + esc(failure.job.name) + "</strong>: " + esc(failure.message) + "</li>")
        .join("") +
      "</ul>" +
      (backup
        ? "<p>Maak een back-up via Beheer → Instellingen → Back-ups → <em>Nu back-up maken</em>. Lukt dat ook niet, laat dit dan nakijken.</p>"
        : "<p>De back-up zelf is wel gelukt. Dit is niet dringend, maar laat het nakijken als dit vaker gebeurt.</p>") +
      '<p><a href="https://nieuwjaar.datuur.be/beheer">Naar het beheer</a></p></div>'
  };
}

export async function runNightlyJobs(env, sendMail, jobs = JOBS) {
  const results = await Promise.allSettled(jobs.map(job => job.run(env)));
  const failures = [];
  results.forEach((result, index) => {
    const job = jobs[index];
    if (result.status === "fulfilled") console.log(job.name + " done:", result.value);
    else {
      console.error(job.name + " failed:", result.reason);
      failures.push({
        job,
        message: String(result.reason?.message || result.reason || "Onbekende fout").slice(0, 300)
      });
    }
  });
  if (!failures.length) return { failures: 0 };
  const mail = failureMail(failures);
  try {
    await sendMail(env, env.ORGANIZER_EMAIL || "registratie@datuur.be", mail.subject, mail.html);
  } catch (error) {
    console.error("Nightly failure mail failed:", error?.message);
  }
  return { failures: failures.length };
}
