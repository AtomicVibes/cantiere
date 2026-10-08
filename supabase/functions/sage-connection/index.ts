import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---------------------------------------------------------------------
// Sage integration (Settings -> Integrations, Super Admin only)
//
//   action: "status"     -> safe summary of config + connection/sync state
//   action: "save"       -> persist non secret config (+ optional secret)
//   action: "test"       -> server side connection test
//   action: "disconnect" -> disable integration and drop stored secret
//
// Rules enforced here:
//   * only Super Admins reach this function (checked server side);
//   * the client secret is written through a SECURITY DEFINER RPC so the
//     browser can neither read nor probe it (no RLS policy on
//     sage_integration_credentials);
//   * outbound requests are restricted to an allow listed HTTPS Sage host
//     (SSRF guard);
//   * responses contain no secrets and are sanitised before display;
//   * every configuration change, test and disconnection is audited.
// ---------------------------------------------------------------------

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_ALLOWED_HOSTS = [
  "*.sage.com",
  "*.sage.co.uk",
  "*.sage.eu",
  "*.sage.com.au",
  "*.sagenow.com",
];

const BLOCKED_HOST_SUFFIXES = [".local", ".internal", ".localhost", ".localdomain"];
const REQUEST_TIMEOUT_MS = 10_000;

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const SYNC_DIRECTIONS = new Set(["export", "import", "both"]);

function respond(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fail(message: string, status = 400, extra: Record<string, unknown> = {}) {
  return respond({ error: message, ...extra }, status);
}

function allowedHosts(): string[] {
  const fromEnv = Deno.env.get("SAGE_ALLOWED_HOSTS");
  if (fromEnv?.trim()) {
    return fromEnv.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  }
  return DEFAULT_ALLOWED_HOSTS;
}

function hostMatches(hostname: string, pattern: string): boolean {
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(1); // ".sage.com"
    return hostname === pattern.slice(2) || hostname.endsWith(suffix);
  }
  return hostname === pattern;
}

/** Reject anything that is not a public HTTPS Sage endpoint (SSRF guard). */
function validateSageUrl(raw: string): { ok: true; url: URL } | { ok: false; message: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, message: "The API URL is not a valid URL." };
  }

  if (url.protocol !== "https:") {
    return { ok: false, message: "The API URL must use HTTPS." };
  }
  if (url.username || url.password) {
    return { ok: false, message: "The API URL must not contain credentials." };
  }
  if (url.port && url.port !== "443") {
    return { ok: false, message: "Only the standard HTTPS port is allowed." };
  }

  const host = url.hostname.toLowerCase();
  if (!host || host === "localhost" || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    return { ok: false, message: "The API URL host is not allowed." };
  }
  // No IP literals.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":") || host.startsWith("[")) {
    return { ok: false, message: "The API URL must use a Sage domain, not an IP address." };
  }

  const hosts = allowedHosts();
  if (!hosts.some((pattern) => hostMatches(host, pattern))) {
    return { ok: false, message: "The API URL must point to a Sage domain." };
  }

  return { ok: true, url };
}

/** Strip anything secret looking from upstream messages before returning it. */
function sanitizeMessage(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  const cleaned = value
    .replace(/(access_token|refresh_token|client_secret|secret|password|bearer)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .replace(/\b[A-Za-z0-9._\-]{40,}\b/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || fallback).slice(0, 200);
}

async function audit(actor: string, payload: Record<string, unknown>) {
  const { error } = await supabase.rpc("write_audit_log", {
    p_actor: actor,
    ...payload,
  });
  if (error) console.error("[sage-connection] audit failed:", error.message);
}

async function requireSuperAdmin(token: string) {
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData?.user) return null;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, role_id, roles!inner(name)")
    .eq("id", userData.user.id)
    .single();

  if (profileError || !profile) return null;
  // PostgREST answers a to-one embed as an object, but the generated types can
  // infer an array: accept both shapes.
  const embeddedRoles = Array.isArray(profile.roles) ? profile.roles[0] : profile.roles;
  if (embeddedRoles?.name !== "super_admin") return null;
  return userData.user;
}

const CONFIG_COLUMNS =
  "id, user_id, api_url, client_id, tenant_id, company_id, enabled, connection_status, " +
  "connection_status_message, last_connection_test_at, last_connection_test_status, " +
  "sync_invoices, sync_clients, sync_products, sync_direction, sync_interval_minutes, " +
  "last_sync_started_at, last_sync, last_sync_status, last_sync_error, last_sync_error_at, updated_at";

// Shape of the non secret configuration row (no credential columns exist
// there by design: they live in sage_integration_credentials).
type SageIntegrationRow = {
  id: string;
  user_id: string;
  api_url: string | null;
  client_id: string | null;
  tenant_id: string | null;
  company_id: string | null;
  enabled: boolean;
  connection_status: string | null;
  connection_status_message: string | null;
  last_connection_test_at: string | null;
  last_connection_test_status: string | null;
  sync_invoices: boolean;
  sync_clients: boolean;
  sync_products: boolean;
  sync_direction: string;
  sync_interval_minutes: number;
  last_sync_started_at: string | null;
  last_sync: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
  last_sync_error_at: string | null;
  updated_at: string | null;
};

async function readIntegration(userId: string): Promise<SageIntegrationRow | null> {
  // The project has no generated Database types: supabase-js cannot infer the
  // select string, so the row is asserted to its documented shape.
  const { data, error } = (await supabase
    .from("sage_integrations")
    .select(CONFIG_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle()) as unknown as { data: SageIntegrationRow | null; error: { message: string } | null };
  if (error) throw error;
  return data ?? null;
}

async function hasSecret(integrationId: string | null): Promise<boolean> {
  if (!integrationId) return false;
  const { data, error } = await supabase.rpc("sage_has_secret", {
    p_integration_id: integrationId,
  });
  if (error) {
    console.error("[sage-connection] sage_has_secret failed:", error.message);
    return false;
  }
  return Boolean(data);
}

function isComplete(config: { api_url?: string | null; client_id?: string | null }) {
  return Boolean(config.api_url && config.client_id);
}

async function statusPayload(user: { id: string }) {
  const config = await readIntegration(user.id);
  const secretPresent = await hasSecret(config?.id ?? null);
  const complete = Boolean(config && isComplete(config) && secretPresent);

  return {
    success: true,
    configured: Boolean(config),
    complete,
    hasSecret: secretPresent,
    config: config
      ? {
          apiUrl: config.api_url,
          clientId: config.client_id,
          tenantId: config.tenant_id,
          companyId: config.company_id,
          enabled: Boolean(config.enabled),
          connectionStatus: config.connection_status ?? "not_connected",
          connectionStatusMessage: config.connection_status_message,
          lastConnectionTestAt: config.last_connection_test_at,
          lastConnectionTestStatus: config.last_connection_test_status,
          syncInvoices: Boolean(config.sync_invoices),
          syncClients: Boolean(config.sync_clients),
          syncProducts: Boolean(config.sync_products),
          syncDirection: config.sync_direction ?? "export",
          syncIntervalMinutes: config.sync_interval_minutes ?? 60,
          lastSync: config.last_sync,
          lastSyncStartedAt: config.last_sync_started_at,
          lastSyncStatus: config.last_sync_status,
          lastSyncError: config.last_sync_error,
          lastSyncErrorAt: config.last_sync_error_at,
          updatedAt: config.updated_at,
        }
      : null,
  };
}

type Body = Record<string, unknown>;

function str(body: Body, key: string): string | null {
  const value = body[key];
  return typeof value === "string" ? value.trim() : null;
}
function bool(body: Body, key: string, fallback = false): boolean {
  const value = body[key];
  return typeof value === "boolean" ? value : fallback;
}
function int(body: Body, key: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(body[key] ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

async function saveConfig(user: { id: string }, body: Body) {
  const apiUrl = str(body, "apiUrl");
  const clientId = str(body, "clientId");
  const tenantId = str(body, "tenantId");
  const companyId = str(body, "companyId");
  const secret = typeof body.clientSecret === "string" ? body.clientSecret : "";
  const syncDirectionRaw = str(body, "syncDirection") ?? "export";
  const enabled = bool(body, "enabled", false);

  if (apiUrl) {
    const check = validateSageUrl(apiUrl);
    if (!check.ok) return fail(check.message, 400);
  }

  if (!SYNC_DIRECTIONS.has(syncDirectionRaw)) {
    return fail("Unsupported synchronization direction.", 400);
  }

  const syncIntervalMinutes = int(body, "syncIntervalMinutes", 60, 5, 1440);
  const existing = await readIntegration(user.id);
  const secretPresent = await hasSecret(existing?.id ?? null);
  const willHaveSecret = secretPresent || Boolean(secret);

  const syncInvoices = bool(body, "syncInvoices", false);
  const syncClients = bool(body, "syncClients", false);
  const syncProducts = bool(body, "syncProducts", false);

  if (enabled && !(apiUrl && clientId && willHaveSecret)) {
    return fail(
      "An API URL, a client ID and a client secret are required before the integration can be enabled.",
      400,
    );
  }

  const complete = Boolean(apiUrl && clientId && willHaveSecret);
  // A freshly saved (possibly rotated) credential is unverified until
  // a real connection test succeeds: "connected" is never claimed or
  // kept just because a secret was saved.
  const credentialSaved = Boolean(secret);
  const previouslyConnected = existing?.connection_status === "connected";
  const connectionStatus = complete
    ? (previouslyConnected && !credentialSaved ? "connected" : "configured")
    : "not_configured";

  const row = {
    user_id: user.id,
    api_url: apiUrl,
    client_id: clientId,
    tenant_id: tenantId,
    company_id: companyId,
    enabled,
    connection_status: connectionStatus,
    connection_status_message: null,
    sync_invoices: syncInvoices,
    sync_clients: syncClients,
    sync_products: syncProducts,
    sync_direction: syncDirectionRaw,
    sync_interval_minutes: syncIntervalMinutes,
  };

  const { data: saved, error: saveError } = await supabase
    .from("sage_integrations")
    .upsert(row, { onConflict: "user_id" })
    .select("id")
    .single();
  if (saveError) {
    console.error("[sage-connection] save failed:", saveError.message);
    return fail("Could not save the Sage configuration.", 500);
  }

  if (secret) {
    const { error: secretError } = await supabase.rpc("sage_save_secret", {
      p_integration_id: saved.id,
      p_secret: secret,
    });
    if (secretError) {
      console.error("[sage-connection] secret save failed:", secretError.message);
      return fail("The configuration was saved but the credential could not be stored.", 500);
    }
  }

  await audit(user.id, {
    p_action_type: "SAGE_CONFIG_SAVED",
    p_message: "Sage integration configuration saved",
    p_details: {
      user_id: user.id,
      enabled,
      connection_status: connectionStatus,
      sync: { invoices: syncInvoices, clients: syncClients, products: syncProducts },
      secret_updated: Boolean(secret),
    },
    p_entity_type: "sage_integrations",
    p_entity_id: saved.id,
  });

  return respond(await statusPayload(user));
}

async function testConnection(user: { id: string }, body: Body) {
  const config = await readIntegration(user.id);
  if (!config || !config.api_url || !config.client_id) {
    return fail("Save the Sage configuration before testing the connection.", 400);
  }

  const check = validateSageUrl(config.api_url);
  if (!check.ok) {
    await recordTest(config.id, false, check.message, "invalid_url");
    return fail(check.message, 400, { code: "invalid_url" });
  }

  const url = check.url;
  let httpStatus: number | null = null;
  let outcome: "ok" | "auth_rejected" | "auth_endpoint_missing" | "unreachable" = "unreachable";
  let message = "";

  // 1) Reachability of the configured endpoint.
  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });
    httpStatus = response.status;
    await response.body?.cancel();
    outcome = response.status < 500 ? "ok" : "unreachable";
    message = `Endpoint responded with HTTP ${response.status}.`;
  } catch (err) {
    outcome = "unreachable";
    message = `Could not reach ${url.hostname}.`;
    console.error("[sage-connection] reachability error:", err instanceof Error ? err.message : err);
  }

  // 2) Credential check against the OAuth token endpoint when a secret is stored.
  const secretPresent = await hasSecret(config.id);
  let authenticated: boolean | null = null;

  if (outcome !== "unreachable" && secretPresent) {
    const tokenUrl = new URL("/oauth/token", url.origin);
    const clientSecret = await readClientSecret(config.id);
    try {
      const tokenBody = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: config.client_id ?? "",
        ...(clientSecret ? { client_secret: clientSecret } : {}),
        ...(config.tenant_id ? { client_tenant: config.tenant_id } : {}),
      });

      const response = await fetch(tokenUrl.toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: tokenBody,
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      // The body may contain a token: only the OAuth `error` code is read.
      const rawBody = await response.text();
      let oauthError: string | null = null;
      try {
        const parsed = JSON.parse(rawBody);
        if (typeof parsed?.error === "string") oauthError = parsed.error;
      } catch {
        oauthError = null;
      }

      httpStatus = response.status;
      if (response.status >= 200 && response.status < 300) {
        authenticated = true;
        message = "Credentials accepted by Sage.";
      } else if (oauthError === "unsupported_grant_type" || response.status === 404 || response.status === 405) {
        outcome = "auth_endpoint_missing";
        message = `The endpoint is reachable but ${url.origin}/oauth/token did not accept a client credentials grant (HTTP ${response.status}).`;
      } else if (response.status === 401 || response.status === 403 || oauthError === "invalid_client") {
        authenticated = false;
        outcome = "auth_rejected";
        message = `Sage rejected the credentials (HTTP ${response.status}).`;
      } else {
        authenticated = false;
        outcome = "auth_rejected";
        message = `The credential check returned HTTP ${response.status}${oauthError ? ` (${oauthError})` : ""}.`;
      }
    } catch (err) {
      outcome = "auth_rejected";
      authenticated = false;
      message = "The credential check could not be completed.";
      console.error("[sage-connection] token check error:", err instanceof Error ? err.message : err);
    }
  } else if (outcome !== "unreachable" && !secretPresent) {
    // Reachable endpoint, but without a stored credential the
    // integration cannot be verified: the test must not report a
    // successful connection (no fake "connected" state).
    outcome = "no_credential";
    message += " No client secret is stored, so credentials were not verified.";
  }

  const ok = outcome === "ok";
  const testedAt = new Date().toISOString();
  await recordTest(config.id, ok, sanitizeMessage(message, "Connection test completed."), outcome);

  await audit(user.id, {
    p_action_type: "SAGE_CONNECTION_TESTED",
    p_message: ok ? "Sage connection test succeeded" : "Sage connection test failed",
    p_details: {
      user_id: user.id,
      ok,
      code: outcome,
      http_status: httpStatus,
      authenticated,
    },
    p_entity_type: "sage_integrations",
    p_entity_id: config.id,
  });

  return respond({
    success: ok,
    ok,
    code: outcome,
    message: sanitizeMessage(message, ok ? "Connection succeeded." : "Connection failed."),
    httpStatus,
    authenticated,
    testedAt,
  });
}

/**
 * The stored credential is only ever read inside this function (service role,
 * SECURITY DEFINER RPC): it is never sent to the browser and never logged.
 */
async function readClientSecret(integrationId: string): Promise<string> {
  const { data, error } = await supabase.rpc("sage_get_secret", {
    p_integration_id: integrationId,
  });
  if (error) {
    console.error("[sage-connection] secret read failed:", error.message);
    return "";
  }
  return typeof data === "string" ? data : "";
}

async function recordTest(
  integrationId: string,
  ok: boolean,
  message: string,
  code: string,
) {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("sage_integrations")
    .update({
      connection_status: ok ? "connected" : "error",
      connection_status_message: message,
      last_connection_test_at: now,
      last_connection_test_status: ok ? "success" : code,
    })
    .eq("id", integrationId);
  if (error) console.error("[sage-connection] test bookkeeping failed:", error.message);
}

async function disconnect(user: { id: string }) {
  const existing = await readIntegration(user.id);
  if (!existing) return fail("No Sage integration is configured.", 404);

  const { error } = await supabase
    .from("sage_integrations")
    .update({
      enabled: false,
      connection_status: "not_connected",
      connection_status_message: null,
      last_connection_test_at: null,
      last_connection_test_status: null,
    })
    .eq("id", existing.id);
  if (error) {
    console.error("[sage-connection] disconnect failed:", error.message);
    return fail("Could not disconnect the Sage integration.", 500);
  }

  const { error: secretError } = await supabase
    .from("sage_integration_credentials")
    .delete()
    .eq("integration_id", existing.id);
  if (secretError) {
    console.error("[sage-connection] credential removal failed:", secretError.message);
  }

  await audit(user.id, {
    p_action_type: "SAGE_DISCONNECTED",
    p_message: "Sage integration disconnected and stored credential removed",
    p_details: { user_id: user.id, credential_removed: !secretError },
    p_entity_type: "sage_integrations",
    p_entity_id: existing.id,
  });

  return respond(await statusPayload(user));
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return fail("Method not allowed", 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return fail("Authentication required", 401);
    }

    const user = await requireSuperAdmin(authHeader.slice("Bearer ".length));
    if (!user) {
      return fail("Super Admin privileges are required to manage integrations.", 403);
    }

    let body: Body = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const action = typeof body.action === "string" ? body.action : "status";

    switch (action) {
      case "status":
        return respond(await statusPayload(user));
      case "save":
        return await saveConfig(user, body);
      case "test":
        return await testConnection(user, body);
      case "disconnect":
        return await disconnect(user);
      default:
        return fail("Unknown action.", 400);
    }
  } catch (err) {
    console.error("[sage-connection] error:", err instanceof Error ? err.message : err);
    return fail("The Sage integration request failed.", 500);
  }
});
