import { randomBytes, pbkdf2Sync } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const terminal = createInterface({ input: stdin, output: stdout });
try {
  const password = await terminal.question("Nieuw adminwachtwoord: ");
  if (password.length < 14) throw new Error("Gebruik minstens 14 tekens.");
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(password, salt, 100000, 32, "sha256");
  console.log("\nCloudflare secret value (kopieer dit volledige resultaat):");
  console.log(`${salt.toString("base64url")}:${hash.toString("base64url")}`);
} finally {
  terminal.close();
}
