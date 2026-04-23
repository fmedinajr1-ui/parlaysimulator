import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BodySchema = z.object({
  eventId: z.string().min(1).max(255),
  gameDescription: z.string().min(1).max(255),
  sport: z.string().min(1).max(100),
  commenceTime: z.string().min(1).max(255),
  guidanceText: z.string().min(1).max(20000),
  props: z.array(
    z.object({
      key: z.string().min(1).max(255),
      playerName: z.string().min(1).max(255),
      propType: z.string().min(1).max(255),
      currentLine: z.number().nullable(),
      bookmakerCount: z.number().int().nonnegative(),
      bookmakers: z.array(z.string().min(1).max(100)).max(50),
      latestUpdateAt: z.string().nullable(),
      overPrice: z.number().nullable(),
      underPrice: z.number().nullable(),
    })
  ).min(1).max(100),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const token = authHeader.replace("Bearer ", "");

    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey);

    const { data: authData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !authData.user) {
      return new Response(JSON.stringify({ error: "User not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: roleRow, error: roleError } = await serviceClient
      .from("user_roles")
      .select("role")
      .eq("user_id", authData.user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (roleError || !roleRow) {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: parsed.error.flatten().fieldErrors }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { eventId, gameDescription, sport, commenceTime, guidanceText, props } = parsed.data;

    const normalizedProps = props.map((prop) => ({
      key: prop.key,
      player_name: prop.playerName,
      prop_type: prop.propType,
      current_line: prop.currentLine,
      bookmaker_count: prop.bookmakerCount,
      bookmakers: prop.bookmakers,
      latest_update_at: prop.latestUpdateAt,
      over_price: prop.overPrice,
      under_price: prop.underPrice,
    }));

    const ruleKey = `manual_training:${eventId}`;
    const timestamp = new Date().toISOString();

    const payload = {
      rule_key: ruleKey,
      rule_description: `Manual training guidance for ${gameDescription} (${sport})`,
      applies_to: ["bot-self-awareness", "manual-training", eventId],
      enforcement: "manual_override",
      is_active: true,
      rule_logic: {
        type: "manual_training_guidance",
        scope: "selected_game_props",
        event_id: eventId,
        game_description: gameDescription,
        sport,
        commence_time: commenceTime,
        guidance_text: guidanceText,
        selected_props: normalizedProps,
        selected_prop_count: normalizedProps.length,
        updated_by_user_id: authData.user.id,
        updated_at: timestamp,
      },
      updated_at: timestamp,
    };

    const { data, error } = await serviceClient
      .from("bot_owner_rules")
      .upsert(payload, { onConflict: "rule_key" })
      .select("id, rule_key, updated_at")
      .single();

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, rule: data }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
