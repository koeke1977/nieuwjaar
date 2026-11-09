import test from "node:test";
import assert from "node:assert/strict";
import { runNightlyJobs } from "../worker/modules/nightly.js";

const quietly = async run => {
  const { log, error } = console;
  console.log = console.error = () => {};
  try {
    return await run();
  } finally {
    console.log = log;
    console.error = error;
  }
};
const mailer = () => {
  const mails = [];
  return { mails, send: async (env, to, subject, html) => mails.push({ to, subject, html }) };
};
const ok = (name, important) => ({ name, important, run: async () => "klaar" });
const broken = (name, important, message = "R2 <niet> bereikbaar") => ({
  name,
  important,
  run: async () => {
    throw new Error(message);
  }
});

test("nothing goes wrong: no mail", async () => {
  const { mails, send } = mailer();
  const result = await quietly(() => runNightlyJobs({}, send, [ok("Back-up", true), ok("Opruimen")]));
  assert.equal(result.failures, 0);
  assert.equal(mails.length, 0);
});

test("a failed backup sends a warning, and the other jobs still run", async () => {
  const { mails, send } = mailer();
  let cleaned = false;
  const cleanup = {
    name: "Opruimen",
    run: async () => {
      cleaned = true;
    }
  };
  const result = await quietly(() => runNightlyJobs({}, send, [broken("Back-up", true), cleanup]));
  assert.equal(result.failures, 1);
  assert.ok(cleaned, "one failure does not stop the rest");
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, "registratie@datuur.be");
  assert.match(mails[0].subject, /back-up is mislukt/);
  assert.match(mails[0].html, /Nu back-up maken/);
  assert.ok(mails[0].html.includes("R2 &lt;niet&gt; bereikbaar"), "the error is escaped");
});

test("the warning goes to the organiser's address when set; a smaller failure is worded calmly", async () => {
  const { mails, send } = mailer();
  await quietly(() =>
    runNightlyJobs({ ORGANIZER_EMAIL: "koen@x.be" }, send, [ok("Back-up", true), broken("Opruimen")])
  );
  assert.equal(mails[0].to, "koen@x.be");
  assert.match(mails[0].subject, /nachtelijke taak is mislukt/);
  assert.match(mails[0].html, /De back-up zelf is wel gelukt/);
});

test("several failures give one mail, and a failing mail does not break the night", async () => {
  const { mails, send } = mailer();
  await quietly(() => runNightlyJobs({}, send, [broken("Back-up", true), broken("Opruimen")]));
  assert.equal(mails.length, 1);
  const result = await quietly(() =>
    runNightlyJobs(
      {},
      async () => {
        throw new Error("Geen mail");
      },
      [broken("Back-up", true)]
    )
  );
  assert.equal(result.failures, 1);
});

test("the real nightly jobs report a failure when storage is missing", async () => {
  const { mails, send } = mailer();
  const result = await quietly(() => runNightlyJobs({}, send));
  assert.ok(result.failures >= 1);
  assert.match(mails[0].html, /Back-up van de database/);
});
