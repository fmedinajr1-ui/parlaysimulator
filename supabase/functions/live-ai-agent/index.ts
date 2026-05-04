// Live AI Agent — orchestrates conversation, tool-calling, and persistence.
// The dog speaks to the user; this function thinks for it.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FREE_DAILY_LIMIT = 3;

const SYSTEM_PROMPT = `You are "Spike", a sharp-tongued Brooklyn-born sportsbook bulldog mascot for ParlayFarm.
You speak like a confident NY guy from the borough — short sentences, slang ("yo", "lemme tell ya", "fuhgeddaboudit", "trust me"),
but always grounded in the data you pull from tools. You are a sportsbook analyst, not a hype man.

Personality:
- Sharp, fast, never wishy-washy. State a take and stand on it.
- Light gambling humor, never sleazy.
- If data is thin, SAY SO — don't fake confidence.
- Always reference WHICH tool/data point you used in plain English ("the L10 is showing...", "whale money came in on...").
- Talk like you're on FaceTime — ~2-4 short sentences max per turn unless asked for details.

Tools available — USE THEM, never invent stats:
- get_top_picks: today's top scored props from the engine
- get_player_recent_form: L10 stats for a specific player+prop
- get_whale_signals: sharp money/line movement on a player today
- build_parlay: assemble 2-4 leg parlay using top engine picks at requested risk mode
- analyze_slip: critique a parsed bet slip (legs come from OCR upstream)

Risk modes:
- aggressive 🔥 → 4+ legs, longer odds, ride the heaters
- smart 🧠 → 3 legs, balanced edge + correlation
- safe 🛡️ → 2 legs, highest-confidence picks only

Live mode: when live_mode=true, prioritize "take it now" lines and active games.

Output format: JUST the spoken text. No markdown headings, no bullet lists in voice replies.
If the tool returns parlay_card data, the UI will render it visually — your text just teases it ("Cooked you a 3-legger, take a look").
`;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "get_top_picks",
      description: "Get today's top scored player props from the engine. Returns up to N picks ordered by confidence.",
      parameters: {
        type: "object",
        properties: {
          sport: { type: "string", description: "Optional filter: NBA, NFL, MLB, NHL, etc." },
          limit: { type: "number", default: 6 },
          min_confidence: { type: "number", default: 0.6 },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_player_recent_form",
      description: "Get a player's recent (L10) hits/misses on a prop type",
      parameters: {
        type: "object",
        properties: {
          player_name: { type: "string" },
          prop_type: { type: "string" },
        },
        required: ["player_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_whale_signals",
      description: "Get today's sharp/whale money signals (line movement against public) for a player or sport",
      parameters: {
        type: "object",
        properties: {
          player_name: { type: "string" },
          sport: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "build_parlay",
      description: "Build a parlay from today's top picks at the given risk mode. Saves to live_ai_generated_parlays.",
      parameters: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["aggressive", "smart", "safe"] },
          sport: { type: "string" },
          legs: { type: "number" },
        },
        required: ["mode"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "analyze_slip",
      description: "Critique a list of bet legs the user already has on a slip. Returns per-leg verdict and swap suggestions.",
      parameters: {
        type: "object",
        properties: {
          legs: {
            type: "array",
            items: {
              type: "object",
              properties: {
                player_name: { type: "string" },
                prop_type: { type: "string" },
                line: { type: "number" },
                side: { type: "string", enum: ["over", "under"] },
              },
            },
          },
        },
        required: ["legs"],
      },
    },
  },
];

function americanToProb(odds: number): number {
  if (odds > 0) return 100 / (odds + 100);
  return -odds / (-odds + 100);
}

function combinedAmericanOdds(legs: { american_odds: number }[]): number {
  const decimal = legs.reduce((acc, l) => {
    const a = l.american_odds || -110;
    const dec = a > 0 ? 1 + a / 100 : 1 + 100 / Math.abs(a);
    return acc * dec;
  }, 1);
  if (decimal >= 2) return Math.round((decimal - 1) * 100);
  return Math.round(-100 / (decimal - 1));
}

async function runTool(name: string, args: any, supabase: any, userId: string) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

  if (name === "get_top_picks") {
    const limit = Math.min(args.limit ?? 6, 12);
    let q = supabase
      .from("final_verdict_picks")
      .select("player_name,prop_type,side,line,sport,verdict_grade,consensus_score,fanduel_signal_type")
      .eq("verdict_date", today)
      .gte("consensus_score", (args.min_confidence ?? 0.6) * 100)
      .order("consensus_score", { ascending: false })
      .limit(limit);
    if (args.sport) q = q.ilike("sport", args.sport);
    const { data, error } = await q;
    if (error) return { error: error.message };
    if (!data?.length) {
      // Fallback to bot_daily_picks
      const fb = await supabase
        .from("bot_daily_picks")
        .select("player_name,prop_type,side,line,sport,confidence,american_odds,tier,edge_pct")
        .eq("pick_date", today).eq("status", "locked")
        .order("confidence", { ascending: false }).limit(limit);
      return { picks: fb.data ?? [] };
    }
    return { picks: data };
  }

  if (name === "get_player_recent_form") {
    const { data } = await supabase
      .from("bot_daily_picks")
      .select("pick_date,prop_type,line,side,outcome,actual_value")
      .ilike("player_name", `%${args.player_name}%`)
      .order("pick_date", { ascending: false }).limit(10);
    return { recent: data ?? [], note: data?.length ? "Recent engine activity" : "No recent picks tracked for this player" };
  }

  if (name === "get_whale_signals") {
    let q = supabase.from("final_verdict_picks")
      .select("player_name,prop_type,side,fanduel_signal_type,fanduel_accuracy,sport")
      .eq("verdict_date", today)
      .not("fanduel_signal_type", "is", null)
      .order("consensus_score", { ascending: false }).limit(8);
    if (args.player_name) q = q.ilike("player_name", `%${args.player_name}%`);
    if (args.sport) q = q.ilike("sport", args.sport);
    const { data } = await q;
    return { signals: data ?? [] };
  }

  if (name === "build_parlay") {
    // Free-tier limit
    const { data: prefs } = await supabase.from("live_ai_user_prefs").select("*").eq("user_id", userId).maybeSingle();
    if (prefs && !prefs.is_premium) {
      const today = new Date().toISOString().slice(0, 10);
      const used = prefs.free_parlays_reset_date === today ? prefs.free_parlays_used_today : 0;
      if (used >= FREE_DAILY_LIMIT) {
        return { error: "free_limit_reached", message: "Free tier hit today's 3-parlay limit. Upgrade for unlimited." };
      }
    }

    const mode = args.mode || "smart";
    const legCount = args.legs ?? (mode === "aggressive" ? 4 : mode === "safe" ? 2 : 3);
    const minConf = mode === "safe" ? 75 : mode === "smart" ? 65 : 55;

    let q = supabase.from("final_verdict_picks")
      .select("player_name,prop_type,side,line,sport,verdict_grade,consensus_score")
      .eq("verdict_date", today)
      .gte("consensus_score", minConf)
      .in("verdict_grade", mode === "safe" ? ["A+", "A"] : mode === "smart" ? ["A+", "A", "B+"] : ["A+", "A", "B+", "B"])
      .order("consensus_score", { ascending: false }).limit(20);
    if (args.sport) q = q.ilike("sport", args.sport);
    const { data: pool } = await q;

    if (!pool || pool.length < legCount) {
      return { error: "insufficient_picks", message: `Only ${pool?.length ?? 0} qualifying picks available right now — try again later or change mode.` };
    }

    // Diversify across distinct players
    const seen = new Set<string>();
    const legs: any[] = [];
    for (const p of pool) {
      if (seen.has(p.player_name)) continue;
      legs.push({ ...p, american_odds: -110 });
      seen.add(p.player_name);
      if (legs.length >= legCount) break;
    }

    const combined = combinedAmericanOdds(legs);
    const confidence = legs.reduce((a, l) => a * (l.consensus_score / 100), 1);

    const { data: saved } = await supabase.from("live_ai_generated_parlays").insert({
      user_id: userId,
      mode,
      legs,
      combined_odds: combined,
      confidence: Math.round(confidence * 100),
      rationale: `${mode.toUpperCase()} mode • ${legs.length} legs • avg consensus ${Math.round(legs.reduce((a, l) => a + l.consensus_score, 0) / legs.length)}`,
    }).select().single();

    if (prefs && !prefs.is_premium) {
      const today = new Date().toISOString().slice(0, 10);
      const newCount = prefs.free_parlays_reset_date === today ? prefs.free_parlays_used_today + 1 : 1;
      await supabase.from("live_ai_user_prefs").update({
        free_parlays_used_today: newCount,
        free_parlays_reset_date: today,
      }).eq("user_id", userId);
    }

    return { parlay: saved };
  }

  if (name === "analyze_slip") {
    const legs = args.legs || [];
    const verdicts = [];
    for (const leg of legs) {
      const { data } = await supabase.from("final_verdict_picks")
        .select("side,consensus_score,verdict_grade,fanduel_signal_type")
        .eq("verdict_date", today)
        .ilike("player_name", `%${leg.player_name}%`)
        .ilike("prop_type", `%${leg.prop_type}%`)
        .maybeSingle();
      if (!data) {
        verdicts.push({ ...leg, verdict: "no_data", note: "Engine has no take on this leg." });
      } else if (data.side?.toLowerCase() === leg.side?.toLowerCase()) {
        verdicts.push({ ...leg, verdict: "agree", grade: data.verdict_grade, score: data.consensus_score, signal: data.fanduel_signal_type });
      } else {
        verdicts.push({ ...leg, verdict: "fade", grade: data.verdict_grade, score: data.consensus_score, engine_side: data.side });
      }
    }
    return { verdicts };
  }

  return { error: `Unknown tool: ${name}` };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { conversation_id, user_text, mode = "smart", live_mode = false } = await req.json();
    if (!user_text) return new Response(JSON.stringify({ error: "user_text required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Resolve conversation
    let convId = conversation_id;
    if (!convId) {
      const { data: c } = await supabase.from("live_ai_conversations").insert({
        user_id: user.id, mode, live_mode, title: user_text.slice(0, 60),
      }).select().single();
      convId = c?.id;
    }

    // Save user message
    await supabase.from("live_ai_messages").insert({
      conversation_id: convId, user_id: user.id, role: "user", content: user_text,
    });

    // Load history (last 12)
    const { data: history } = await supabase.from("live_ai_messages")
      .select("role,content,tool_name,tool_result,tool_calls")
      .eq("conversation_id", convId).order("created_at", { ascending: true }).limit(12);

    const messages: any[] = [
      { role: "system", content: SYSTEM_PROMPT + `\n\nCurrent risk mode: ${mode}. Live mode: ${live_mode}.` },
      ...(history ?? []).map((m: any) => ({
        role: m.role,
        content: m.content || (m.tool_result ? JSON.stringify(m.tool_result).slice(0, 2000) : ""),
        ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
      })),
    ];

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY missing");

    let toolLoops = 0;
    let assistantText = "";
    let lastParlay: any = null;
    let toolTrace: any[] = [];

    while (toolLoops < 4) {
      toolLoops++;
      const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages,
          tools: TOOLS,
        }),
      });
      if (r.status === 429) return new Response(JSON.stringify({ error: "Rate limited, try again in a moment." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (r.status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (!r.ok) throw new Error(`AI gateway: ${r.status} ${await r.text()}`);
      const j = await r.json();
      const msg = j.choices?.[0]?.message;
      if (!msg) break;

      if (msg.tool_calls?.length) {
        messages.push({ role: "assistant", content: msg.content || "", tool_calls: msg.tool_calls });
        for (const tc of msg.tool_calls) {
          let args: any = {};
          try { args = JSON.parse(tc.function.arguments || "{}"); } catch {}
          const result = await runTool(tc.function.name, args, supabase, user.id);
          toolTrace.push({ name: tc.function.name, args, result });
          if (tc.function.name === "build_parlay" && (result as any).parlay) lastParlay = (result as any).parlay;
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: JSON.stringify(result).slice(0, 4000),
          });
        }
        continue;
      }

      assistantText = msg.content || "";
      break;
    }

    // Save assistant message
    await supabase.from("live_ai_messages").insert({
      conversation_id: convId, user_id: user.id, role: "assistant",
      content: assistantText, tool_calls: toolTrace,
    });

    return new Response(JSON.stringify({
      conversation_id: convId,
      text: assistantText,
      parlay: lastParlay,
      tool_trace: toolTrace,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("agent error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});