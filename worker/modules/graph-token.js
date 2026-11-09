// The Microsoft 365 access token for sending mail. It stays valid for about an hour, so it is reused:
// a Worker request may make only a limited number of outside calls, and a new token for every mail
// would use up two calls per mail and cut off mass mails halfway.
const MARGIN_SECONDS = 120;
let cached = null;

export function forgetGraphToken() {
  cached = null;
}

export async function graphAccessToken(env, now = Date.now()) {
  const tenantId = env.O365_TENANT_ID,
    clientId = env.O365_CLIENT_ID;
  const clientSecret = env.O365_CLIENT_SECRET;
  const key = tenantId + "/" + clientId;
  if (cached && cached.key === key && cached.expiresAt > now) return cached.token;
  const tokenResponse = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials"
      })
    }
  );
  if (!tokenResponse.ok) {
    let authError = null;
    try {
      authError = await tokenResponse.json();
    } catch {
      /* Microsoft-response was geen JSON. */
    }
    const errorCode = typeof authError?.error === "string" ? authError.error : "unknown_error";
    const description =
      typeof authError?.error_description === "string"
        ? authError.error_description.replace(/[\\r\\n]+/g, " ").slice(0, 700)
        : "Microsoft gaf geen foutomschrijving terug.";
    const correlationId = typeof authError?.correlation_id === "string" ? authError.correlation_id : "";
    const traceId = typeof authError?.trace_id === "string" ? authError.trace_id : "";
    console.error("Microsoft OAuth token request failed:", {
      status: tokenResponse.status,
      error: errorCode,
      description,
      correlationId,
      traceId
    });
    throw new Error(`Microsoft 365-aanmelding mislukt (HTTP ${tokenResponse.status}, ${errorCode}): ${description}`);
  }
  const tokenData = await tokenResponse.json();
  if (!tokenData.access_token) throw new Error("Microsoft 365 gaf geen toegangstoken terug.");
  const lifetime = Number(tokenData.expires_in) || 0;
  cached = { key, token: tokenData.access_token, expiresAt: now + Math.max(0, lifetime - MARGIN_SECONDS) * 1000 };
  return tokenData.access_token;
}
