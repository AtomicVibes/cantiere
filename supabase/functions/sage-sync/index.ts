import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---------------------------------------------------------------------
// Sage synchronization (Super Admin only)
//
// Runs only when the integration has been configured AND enabled by the
// Super Admin. Updates the invoice sync state (sage_sync_status,
// sage_last_synced_at, sage_sync_error) and records last_sync/last_sync_error
// on the integration row. Every run is audited. Credentials are never
// returned or logged.
// ---------------------------------------------------------------------

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// A run that dies without reaching its own cleanup releases the claim after
// this window, so Sync Now can never stay locked forever.
const STALE_SYNC_MS = 5 * 60_000;

function respond(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fail(message: string, status = 400, extra: Record<string, unknown> = {}) {
  return respond({ error: message, ...extra }, status);
}

function sanitizeMessage(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  const cleaned = value
    .replace(/(access_token|refresh_token|client_secret|secret|password|bearer)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .replace(/\b[A-Za-z0-9._\-]{40,}\b/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || fallback).slice(0, 300);
}

async function audit(actor: string, payload: Record<string, unknown>) {
  const { error } = await supabase.rpc("write_audit_log", {
    p_actor: actor,
    ...payload,
  });
  if (error) console.error("[sage-sync] audit failed:", error.message);
}

/**
 * Audits a rejected synchronization attempt (misconfiguration,
 * missing credential, unverified connection, concurrency
 * rejection) with the real actor so every Sync Now attempt is
 * visible in the audit trail.
 */
async function auditRejection(
  actor: string,
  code: string,
  message: string,
  integrationId: string | null,
) {
  await audit(actor, {
    p_action_type: "SAGE_SYNC_REJECTED",
    p_message: `Sage synchronization rejected: ${message}`,
    p_details: { user_id: actor, code, reason: code },
    p_entity_type: "sage_integrations",
    p_entity_id: integrationId,
  });
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

type SyncResults = {
  invoices: { synced: number; errors: string[] };
  clients: { synced: number; errors: string[] };
  products: { synced: number; errors: string[] };
};

/**
 * Placeholder for the real Sage API mapping. It deliberately performs no
 * external call: until the mapping is implemented the run reports zero
 * records instead of pretending data moved.
 */
async function runSync(config: Record<string, unknown>): Promise<SyncResults> {
  const results: SyncResults = {
    invoices: { synced: 0, errors: [] },
    clients: { synced: 0, errors: [] },
    products: { synced: 0, errors: [] },
  };

  if (config.sync_invoices) {
    results.invoices.errors.push("Sage invoice mapping is not implemented yet.");
  }
  if (config.sync_clients) {
    results.clients.errors.push("Sage client mapping is not implemented yet.");
  }
  if (config.sync_products) {
    results.products.errors.push("Sage product mapping is not implemented yet.");
  }

  return results;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return fail("Method not allowed", 405);
  }

  let userId: string | null = null;
  let integrationId: string | null = null;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return fail("Authentication required", 401);
    }

    const user = await requireSuperAdmin(authHeader.slice("Bearer ".length));
    if (!user) {
      return fail("Super Admin privileges are required to synchronize with Sage.", 403);
    }
    userId = user.id;

    const { data: config, error: configError } = await supabase
      .from("sage_integrations")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    if (configError) throw configError;
    if (!config) {
      await auditRejection(user.id, "not_configured", "Sage has not been configured yet", null);
      return fail("Sage has not been configured yet.", 400, { code: "not_configured" });
    }
    integrationId = config.id;
    if (!config.enabled) {
      await auditRejection(user.id, "disabled", "The Sage integration is disabled", integrationId);
      return fail("Enable the Sage integration before synchronizing.", 400, { code: "disabled" });
    }
    if (!config.api_url || !config.client_id) {
      await auditRejection(user.id, "incomplete", "The Sage configuration is incomplete", integrationId);
      return fail("The Sage configuration is incomplete.", 400, { code: "incomplete" });
    }

    const { data: secretPresent } = await supabase.rpc("sage_has_secret", {
      p_integration_id: config.id,
    });
    if (!secretPresent) {
      await auditRejection(user.id, "no_credential", "The Sage credential is missing", integrationId);
      return fail("The Sage credential is missing. Save it again in Integrations.", 400, {
        code: "no_credential",
      });
    }

    // Only a real, verified connection may be synchronized:
    // connection_status = 'connected' is set exclusively by a
    // successful sage-connection test (reachability + OAuth
    // client-credentials verification), never by saving config
    // or starting a sync.
    if (config.connection_status !== "connected") {
      await auditRejection(user.id, "not_connected", "The Sage connection has not been verified", integrationId);
      return fail("Run a successful connection test before synchronizing.", 400, {
        code: "not_connected",
      });
    }

    // Atomic claim: only one run may hold the "running" marker. A crashed run
    // stops blocking the feature after STALE_SYNC_MS, so the operation stays
    // safe to retry and cannot be wedged by a dead process.
    const startedAt = new Date().toISOString();
    const staleCutoff = new Date(Date.now() - STALE_SYNC_MS).toISOString();
    const { data: claimedRows, error: claimError } = await supabase
      .from("sage_integrations")
      .update({
        last_sync_started_at: startedAt,
        last_sync_status: "running",
        last_sync_error: null,
      })
      .eq("id", config.id)
      .or(
        `last_sync_status.neq.running,last_sync_started_at.is.null,last_sync_started_at.lt.${staleCutoff}`,
      )
      .select("id");

    if (claimError) throw claimError;
    if (!claimedRows || claimedRows.length === 0) {
      // Concurrent "Sync Now" click (or a run that just finished): refuse the
      // second run instead of interleaving writes.
      await auditRejection(user.id, "sync_in_progress", "A synchronization is already running", integrationId);
      return fail("A synchronization is already running. Please wait for it to finish.", 409, {
        code: "sync_in_progress",
      });
    }

    const results = await runSync(config);
    const finishedAt = new Date().toISOString();

    const errorCount =
      results.invoices.errors.length + results.clients.errors.length + results.products.errors.length;
    const status = errorCount > 0 ? "partial" : "success";
    const summary = errorCount > 0 ? sanitizeMessage(results.invoices.errors[0], "Synchronization finished with warnings.") : "Synchronization completed.";

    const { error: syncUpdateError } = await supabase
      .from("sage_integrations")
      .update({
        last_sync: finishedAt,
        last_sync_status: status,
        last_sync_error: errorCount > 0 ? summary : null,
        last_sync_error_at: errorCount > 0 ? finishedAt : null,
        // connection_status is deliberately untouched: only a real connection
        // test may claim the integration is connected.
      })
      .eq("id", config.id);
    if (syncUpdateError) throw syncUpdateError;

    await audit(user.id, {
      p_action_type: "SAGE_SYNC_COMPLETED",
      p_message: errorCount > 0 ? "Sage synchronization completed with warnings" : "Sage synchronization completed",
      p_details: {
        user_id: user.id,
        status,
        started_at: startedAt,
        finished_at: finishedAt,
        results,
      },
      p_entity_type: "sage_integrations",
      p_entity_id: config.id,
    });

    return respond({
      success: true,
      status,
      message: summary,
      startedAt,
      finishedAt,
      results,
      lastSync: finishedAt,
    });
  } catch (err) {
    // Never include credentials: only a sanitized message is persisted.
    console.error("[sage-sync] error:", err instanceof Error ? err.message : err);
    const now = new Date().toISOString();
    const message = sanitizeMessage(err instanceof Error ? err.message : null, "Synchronization failed.");

    if (integrationId) {
      await supabase
        .from("sage_integrations")
        .update({
          last_sync: now,
          last_sync_status: "error",
          last_sync_error: message,
          last_sync_error_at: now,
        })
        .eq("id", integrationId);
    }
    if (userId && integrationId) {
      await audit(userId, {
        p_action_type: "SAGE_SYNC_FAILED",
        p_message: "Sage synchronization failed",
        p_details: { user_id: userId, error: message, at: now },
        p_entity_type: "sage_integrations",
        p_entity_id: integrationId,
      });
    }

    return fail(message, 500, { at: now });
  }
});
