import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type FunnelMode = "core" | "aggressive";

const modeSummary: Record<FunnelMode, string> = {
  core: "Core funnel active — tight scanner-first slate",
  aggressive: "Aggressive funnel active — wider ranked slate with scanner downgrades included",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl) throw new Error("SUPABASE_URL is not configured");
    if (!serviceRole) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
    if (!anonKey) throw new Error("SUPABASE_ANON_KEY is not configured");

    const adminClient = createClient(supabaseUrl, serviceRole);
    const authHeader = req.headers.get("Authorization");

    let userId: string | null = null;
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.replace("Bearer ", "");
      const authClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: authData, error: authError } = await authClient.auth.getUser(token);
      if (!authError) {
        userId = authData.user?.id ?? null;
      }
    }

    const body = await req.json().catch(() => ({}));
    const requestedMode = body?.funnelMode === "aggressive" ? "aggressive" : body?.funnelMode === "core" ? "core" : null;
    const source = typeof body?.source === "string" ? body.source : "sweet-spots";
    const notifyAdmin = body?.notifyAdmin !== false;

    let funnelMode: FunnelMode = requestedMode ?? "core";

    if (userId) {
      const { data } = await adminClient
        .from("sweet_spot_preferences")
        .select("funnel_mode")
        .eq("user_id", userId)
        .maybeSingle();

      if (data?.funnel_mode === "aggressive") {
        funnelMode = "aggressive";
      } else if (data?.funnel_mode === "core") {
        funnelMode = "core";
      }
    }

    const lines = [
      `🎯 *Sweet Spots Funnel*`,
      `Mode: *${funnelMode.toUpperCase()}*`,
      modeSummary[funnelMode],
      `Source: ${source}`,
      userId ? `User: \`${userId}\`` : `User: guest`,
    ];

    if (notifyAdmin) {
      await adminClient.functions.invoke("bot-send-telegram", {
        body: {
          message: lines.join("\n"),
          parse_mode: "Markdown",
          admin_only: true,
        },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      funnelMode,
      summary: modeSummary[funnelMode],
      userId,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[sweet-spot-telegram-sync]", message);
    return new Response(JSON.stringify({ success: false, error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});