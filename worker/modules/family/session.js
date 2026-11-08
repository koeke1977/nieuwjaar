// Family accounts: passwords, the session cookie, sessions, the login limit and the reset-mail limit.
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
    { key: emailKey, max: LOGIN_MAX_PER_EMAIL },
    { key: ipKey, max: 100 }
  ];
  return {
    blocked: checks.some(check => {
      const row = limits.get(check.key);
      return row && now - row.window_started < LOGIN_WINDOW_SECONDS && row.attempts >= check.max;
    }),
    recordFailure: async () => {
      for (const check of checks) {
        const row = limits.get(check.key);
        if (!row || now - row.window_started >= LOGIN_WINDOW_SECONDS) {
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

// ---- Limits per e-mail address (only hashes are stored), and unlocking by the admin ----
const LOGIN_WINDOW_SECONDS = 15 * 60;
const LOGIN_MAX_PER_EMAIL = 30;
const RESET_WINDOW_SECONDS = 60 * 60;
const RESET_MAX_PER_EMAIL = 5;
const RESET_MAX_PER_IP = 30;
const loginEmailKey = (email, sha256) => sha256("family-email:" + email);
const resetEmailKey = (email, sha256) => sha256("family-reset-email:" + email);

// Password reset mails. Counted for every address, also unknown ones, so the answer does not
// reveal which addresses have an account.
export async function familyResetLimit(env, email, ip, sha256, now) {
  const checks = [
    { key: await resetEmailKey(email, sha256), max: RESET_MAX_PER_EMAIL },
    { key: await sha256("family-reset-ip:" + ip), max: RESET_MAX_PER_IP }
  ];
  const rows = await env.DB.prepare(
    "SELECT scope_hash, attempts, window_started FROM family_login_limits WHERE scope_hash IN (?, ?)"
  )
    .bind(checks[0].key, checks[1].key)
    .all();
  const limits = new Map((rows.results || []).map(row => [row.scope_hash, row]));
  return {
    blocked: checks.some(check => {
      const row = limits.get(check.key);
      return row && now - row.window_started < RESET_WINDOW_SECONDS && row.attempts >= check.max;
    }),
    record: async () => {
      const windowEnd = now - RESET_WINDOW_SECONDS;
      for (const check of checks) {
        await env.DB.prepare(
          "INSERT INTO family_login_limits (scope_hash, attempts, window_started) VALUES (?, 1, ?) ON CONFLICT(scope_hash) DO UPDATE SET attempts = CASE WHEN window_started <= ? THEN 1 ELSE attempts + 1 END, window_started = CASE WHEN window_started <= ? THEN excluded.window_started ELSE window_started END"
        )
          .bind(check.key, now, windowEnd, windowEnd)
          .run();
      }
    }
  };
}

// For the admin's account list: which addresses are locked right now? → Map(email → { login, reset })
export async function familyAccountLocks(env, emails, sha256, now) {
  const rows = await env.DB.prepare("SELECT scope_hash, attempts, window_started FROM family_login_limits").all();
  const limits = new Map((rows.results || []).map(row => [row.scope_hash, row]));
  const reached = (row, max, window) => Boolean(row && now - row.window_started < window && row.attempts >= max);
  const locks = new Map();
  for (const email of emails) {
    const address = String(email).trim().toLowerCase();
    locks.set(email, {
      login: reached(limits.get(await loginEmailKey(address, sha256)), LOGIN_MAX_PER_EMAIL, LOGIN_WINDOW_SECONDS),
      reset: reached(limits.get(await resetEmailKey(address, sha256)), RESET_MAX_PER_EMAIL, RESET_WINDOW_SECONDS)
    });
  }
  return locks;
}

// Clears the login and reset limits of one address (admin unlock, or after a successful reset).
export async function unlockFamilyEmail(env, email, sha256) {
  const address = String(email).trim().toLowerCase();
  await env.DB.prepare("DELETE FROM family_login_limits WHERE scope_hash IN (?, ?)")
    .bind(await loginEmailKey(address, sha256), await resetEmailKey(address, sha256))
    .run();
}
