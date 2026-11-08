// Family accounts: passwords, the session cookie, sessions and the login limit.
const encoder = new TextEncoder();
export const FAMILY_ACCOUNT_COOKIE = "ny_family_account";
export const FAMILY_ACCOUNT_TTL_SECONDS = 7 * 24 * 60 * 60;

export async function hashPassword(password, base64Url) {
  try {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iterations = 100000;
    const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, key, 256);
    return "pbkdf2$" + iterations + "$" + base64Url(salt) + "$" + base64Url(new Uint8Array(bits));
  } catch (error) {
    const name = typeof error?.name === "string" ? error.name : "Error";
    const message = typeof error?.message === "string" ? error.message : "Onbekende Web Crypto-fout";
    console.error("Family account password hashing failed:", { name, message, stack: error?.stack || "" });
    throw new Error("Family account password hashing failed (" + name + "): " + message);
  }
}

export async function verifyFamilyPassword(password, stored, base64Url, fromBase64Url) {
  const [scheme, iterationsText, saltText, expected] = String(stored || "").split("$");
  const iterations = Number(iterationsText);
  if (
    scheme !== "pbkdf2" ||
    !Number.isInteger(iterations) ||
    iterations < 100000 ||
    iterations > 100000 ||
    !saltText ||
    !expected
  )
    return false;
  let salt;
  try {
    salt = fromBase64Url(saltText);
  } catch {
    return false;
  }
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, key, 256);
  const actual = base64Url(new Uint8Array(bits));
  if (actual.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < actual.length; i++) mismatch |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return mismatch === 0;
}

export function familyAccountCookie(value, maxAge) {
  return (
    FAMILY_ACCOUNT_COOKIE +
    "=" +
    value +
    "; HttpOnly; Secure; SameSite=Strict; Path=/api/family-account; Max-Age=" +
    maxAge
  );
}

export async function createFamilyAccountSession(env, userId, now, sha256, base64Url) {
  const token = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.prepare(
    "INSERT INTO family_user_sessions (user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?)"
  )
    .bind(userId, await sha256(token), now, now + FAMILY_ACCOUNT_TTL_SECONDS)
    .run();
  return token;
}

export async function familyLoginLimit(env, email, ip, sha256, now) {
  const emailKey = await sha256("family-email:" + email);
  const ipKey = await sha256("family-ip:" + ip);
  const rows = await env.DB.prepare(
    "SELECT scope_hash, attempts, window_started FROM family_login_limits WHERE scope_hash IN (?, ?)"
  )
    .bind(emailKey, ipKey)
    .all();
  const limits = new Map((rows.results || []).map(row => [row.scope_hash, row]));
  const checks = [
    { key: emailKey, max: 30 },
    { key: ipKey, max: 100 }
  ];
  return {
    blocked: checks.some(check => {
      const row = limits.get(check.key);
      return row && now - row.window_started < 15 * 60 && row.attempts >= check.max;
    }),
    recordFailure: async () => {
      for (const check of checks) {
        const row = limits.get(check.key);
        if (!row || now - row.window_started >= 15 * 60) {
          await env.DB.prepare(
            "INSERT INTO family_login_limits (scope_hash, attempts, window_started) VALUES (?, 1, ?) ON CONFLICT(scope_hash) DO UPDATE SET attempts = 1, window_started = excluded.window_started"
          )
            .bind(check.key, now)
            .run();
        } else {
          await env.DB.prepare("UPDATE family_login_limits SET attempts = attempts + 1 WHERE scope_hash = ?")
            .bind(check.key)
            .run();
        }
      }
    },
    clearEmail: async () => {
      await env.DB.prepare("DELETE FROM family_login_limits WHERE scope_hash = ?").bind(emailKey).run();
    }
  };
}

export async function familyAccountSession(request, env, cookieValue, sha256) {
  const token = cookieValue(request, FAMILY_ACCOUNT_COOKIE);
  if (!token) return null;
  return env.DB.prepare(
    "SELECT s.id AS session_id, s.user_id, s.expires_at, u.email, u.display_name, u.status FROM family_user_sessions s JOIN family_users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ? AND s.revoked_at IS NULL AND u.status = 'active'"
  )
    .bind(await sha256(token), Math.floor(Date.now() / 1000))
    .first();
}
