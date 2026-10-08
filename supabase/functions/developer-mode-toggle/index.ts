import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---------------------------------------------------------------------
// Developer Mode toggle (Super Admin only)
//
// Security rules honoured here:
//   * the activation secret is validated server side only and is never
//     returned, echoed or logged;
//   * the expected value is stored as a SHA-256 representation supplied at
//     deploy time (DEVELOPER_MODE_SECRET_SHA256, or SHA-256 of
//     DEVELOPER_MODE_SECRET) so the plaintext secret is never part of the
//     function source, the build output or the logs;
//   * there is NO built-in fallback secret: the previous development secret
//     was exposed during development, is permanently revoked, and was removed
//     from the repository. Without configuration the function fails closed;
//   * comparison is timing safe and rate limited (5 failures -> 15 minute
//     lock, configurable);
//   * every activation is short lived (expires_at) and every failure/success
//     is written to the audit log;
//   * there is deliberately no audit suppression path.
// ---------------------------------------------------------------------

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const DEFAULT_TTL_MINUTES = 240;

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

function respond(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fail(message: string, status: number, extra: Record<string, unknown> = {}) {
  return respond({ error: message, ...extra }, status);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Constant time comparison (length leak only, never content).
function secureEquals(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

// Returns null when the server has no configured secret: activation then
// fails closed instead of falling back to any hard coded value.
async function expectedSecretHash(): Promise<string | null> {
  const fromEnv = Deno.env.get("DEVELOPER_MODE_SECRET_SHA256")?.trim().toLowerCase();
  if (fromEnv) {
    return /^[0-9a-f]{64}$/.test(fromEnv) ? fromEnv : null;
  }
  const raw = Deno.env.get("DEVELOPER_MODE_SECRET");
  if (raw) return await sha256Hex(raw);
  return null;
}

function envInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(Deno.env.get(name) ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function audit(actor: string, payload: Record<string, unknown>) {
  const { error } = await supabase.rpc("write_audit_log", {
    p_actor: actor,
    ...payload,
  });
  if (error) console.error("[developer-mode-toggle] audit failed:", error.message);
}

// Resolves the caller and their role. Returns null when the token
// is missing/invalid (no attributable actor); returns
// { userId, superAdmin } otherwise so a non Super Admin attempt can
// be audited with the real actor instead of being silently dropped.
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
  return { userId: userData.user.id, superAdmin: embeddedRoles?.name === "super_admin" };
}

async function readState(userId: string) {
  const { data, error } = await supabase
    .from("developer_mode")
    .select("enabled, activated_at, deactivated_at, expires_at, failed_attempts, first_failed_at, locked_until, last_verified_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
}

function toStatus(state: Awaited<ReturnType<typeof readState>>, ttlMinutes: number) {
  const now = Date.now();
  const expiresAt = state?.expires_at ?? null;
  const expired = expiresAt ? new Date(expiresAt).getTime() <= now : false;
  const enabled = Boolean(state?.enabled) && !expired;
  const lockedUntil = state?.locked_until ?? null;
  const locked = lockedUntil ? new Date(lockedUntil).getTime() > now : false;

  return {
    enabled,
    expired,
    activatedAt: state?.activated_at ?? null,
    deactivatedAt: state?.deactivated_at ?? null,
    expiresAt,
    lastVerifiedAt: state?.last_verified_at ?? null,
    failedAttempts: state?.failed_attempts ?? 0,
    maxFailedAttempts: MAX_FAILED_ATTEMPTS,
    lockedUntil: locked ? lockedUntil : null,
    ttlMinutes,
  };
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

    const auth = await requireSuperAdmin(authHeader.slice("Bearer ".length));
    if (!auth) {
      return fail("Super Admin privileges are required for Developer Mode.", 403);
    }
    if (!auth.superAdmin) {
      // Failed authorization attempt: audited with the real actor so
      // privilege-escalation probes stay visible in the audit trail.
      await audit(auth.userId, {
        p_action_type: "DEV_MODE_UNAUTHORIZED",
        p_message: "Developer Mode access rejected: Super Admin role required",
        p_details: { user_id: auth.userId, reason: "not_super_admin" },
        p_entity_type: "developer_mode",
        p_entity_id: auth.userId,
      });
      return fail("Super Admin privileges are required for Developer Mode.", 403);
    }
    const user = { id: auth.userId };

    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    // Backwards compatible: `{ enable: true|false }` still works.
    const rawAction = typeof body.action === "string" ? body.action : null;
    const action =
      rawAction ??
      (body.enable === true ? "activate" : body.enable === false ? "deactivate" : "status");

    const ttlMinutes = envInt("DEVELOPER_MODE_TTL_MINUTES", DEFAULT_TTL_MINUTES);
    const state = await readState(user.id);

    if (action === "status") {
      // Persist expiration the first time it is observed so the stored row can
      // never keep claiming an active session past expires_at (the audit
      // trigger records the flip). Subsequent status calls are then no-ops.
      const stateExpired =
        Boolean(state?.enabled) &&
        Boolean(state?.expires_at) &&
        new Date(state!.expires_at as string).getTime() <= Date.now();

      if (stateExpired) {
        const { error: expireError } = await supabase.from("developer_mode").upsert(
          {
            user_id: user.id,
            enabled: false,
            deactivated_at: new Date().toISOString(),
            expires_at: null,
          },
          { onConflict: "user_id" },
        );
        if (expireError) throw expireError;
        return respond({ success: true, ...(await statusOnly(user.id, ttlMinutes)) });
      }

      return respond({ success: true, ...toStatus(state, ttlMinutes) });
    }

    if (action !== "activate" && action !== "deactivate") {
      return fail("Unknown action.", 400);
    }

    if (action === "deactivate") {
      const now = new Date().toISOString();
      // failed_attempts / first_failed_at / locked_until are deliberately NOT
      // part of this payload: deactivating must never clear a lockout earned
      // by failed activation attempts.
      const { error: updateError } = await supabase.from("developer_mode").upsert(
        {
          user_id: user.id,
          enabled: false,
          deactivated_at: now,
          expires_at: null,
        },
        { onConflict: "user_id" },
      );
      if (updateError) throw updateError;
      return respond({ success: true, ...(await statusOnly(user.id, ttlMinutes)) });
    }

    // --- activate -----------------------------------------------------
    const now = Date.now();
    const lockedUntil = state?.locked_until
      ? new Date(state.locked_until).getTime()
      : 0;

    if (lockedUntil > now) {
      const retryAfterSeconds = Math.ceil((lockedUntil - now) / 1000);
      await audit(user.id, {
        p_action_type: "DEV_MODE_ACTIVATE_FAILED",
        p_message: "Developer Mode activation rejected: temporarily locked",
        p_details: { user_id: user.id, reason: "locked" },
        p_entity_type: "developer_mode",
        p_entity_id: user.id,
      });
      return respond(
        {
          error: "Too many failed attempts. Please wait before trying again.",
          lockedUntil: new Date(lockedUntil).toISOString(),
          retryAfterSeconds,
        },
        429,
      );
    }

    const secret = typeof body.secret === "string" ? body.secret : "";
    if (!secret) {
      return fail("Activation secret is required.", 400);
    }

    // Fail closed: without a server side configuration there is nothing
    // legitimate to compare against, and no secret may be accepted.
    const expectedHash = await expectedSecretHash();
    if (!expectedHash) {
      return fail(
        "Developer Mode is not configured on this server. Set DEVELOPER_MODE_SECRET_SHA256 for this function.",
        503,
        { code: "not_configured" },
      );
    }

    const providedHash = await sha256Hex(secret);
    const valid = secureEquals(providedHash, expectedHash);

    if (!valid) {
      const windowMinutes = LOCK_MINUTES;
      const firstFailedAt = state?.first_failed_at
        ? new Date(state.first_failed_at).getTime()
        : 0;
      const withinWindow = firstFailedAt > 0 && now - firstFailedAt < windowMinutes * 60_000;
      const attempts = (withinWindow ? state?.failed_attempts ?? 0 : 0) + 1;
      const lockNow = attempts >= MAX_FAILED_ATTEMPTS;
      const nowIso = new Date().toISOString();

      const { error: updateError } = await supabase.from("developer_mode").upsert(
        {
          user_id: user.id,
          enabled: state?.enabled ?? false,
          activated_at: state?.activated_at ?? null,
          failed_attempts: attempts,
          first_failed_at: withinWindow && state?.first_failed_at ? state.first_failed_at : nowIso,
          locked_until: lockNow ? new Date(now + LOCK_MINUTES * 60_000).toISOString() : state?.locked_until ?? null,
        },
        { onConflict: "user_id" },
      );
      if (updateError) throw updateError;

      await audit(user.id, {
        p_action_type: "DEV_MODE_ACTIVATE_FAILED",
        p_message: lockNow
          ? "Developer Mode activation failed: invalid secret (locked)"
          : "Developer Mode activation failed: invalid secret",
        p_details: {
          user_id: user.id,
          reason: "invalid_secret",
          failed_attempts: attempts,
          locked: lockNow,
        },
        p_entity_type: "developer_mode",
        p_entity_id: user.id,
      });

      return fail("Invalid activation secret.", 401, {
        failedAttempts: attempts,
        maxFailedAttempts: MAX_FAILED_ATTEMPTS,
        ...(lockNow ? { lockedUntil: new Date(now + LOCK_MINUTES * 60_000).toISOString() } : {}),
      });
    }

    const nowIso = new Date().toISOString();
    const expiresAt = new Date(now + ttlMinutes * 60_000).toISOString();
    const { error: enableError } = await supabase.from("developer_mode").upsert(
      {
        user_id: user.id,
        enabled: true,
        activated_at: nowIso,
        deactivated_at: null,
        expires_at: expiresAt,
        failed_attempts: 0,
        first_failed_at: null,
        locked_until: null,
        last_verified_at: nowIso,
      },
      { onConflict: "user_id" },
    );
    if (enableError) throw enableError;

    return respond({
      success: true,
      ...(await statusOnly(user.id, ttlMinutes)),
    });
  } catch (err) {
    // Never include the submitted secret or any credential in the response.
    console.error("[developer-mode-toggle] error:", err instanceof Error ? err.message : err);
    return fail("Developer Mode operation failed.", 500);
  }
});

async function statusOnly(userId: string, ttlMinutes: number) {
  const state = await readState(userId);
  return toStatus(state, ttlMinutes);
}
