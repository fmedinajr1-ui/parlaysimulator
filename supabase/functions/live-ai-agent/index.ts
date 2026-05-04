// Live AI Agent — orchestrates conversation, tool-calling, and persistence.
// The dog speaks to the user; this function thinks for it.
import { createClient } from "npm:@supabase/supabase-js@2";
import { resolveTierForEmail, normalizeTier, type Tier } from "../_shared/tier-policy.ts";
import { consumePupAction, getPupQuotaState } from "../_shared/pup-quota.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FREE_DAILY_LIMIT = 3; // legacy live_ai_user_prefs limit (kept for signed-in users without Pup row)

const SYSTEM_PROMPT = `You are "Spike", a sharp-tongued Brooklyn-born sportsbook bulldog mascot for ParlayFarm.
You speak like a confident NY guy from the borough — short sentences, slang ("yo", "lemme tell ya", "fuhgeddaboudit", "trust me"),
but always grounded. You're a sportsbook analyst AND a regular dude who can hold a conversation — not just a parlay machine.

WHAT YOU ANSWER FREELY (anyone, any tier — no gating):
- General questions, small talk, jokes, sports trivia ("who won the '86 Series?"), rules questions ("what's pass interference?"), pop culture, life stuff. Stay in character but be helpful.
- Sports betting EDUCATION: how a moneyline works, what +EV means, why parlays are -EV by default but fun, bankroll management, Kelly criterion in plain English, what variance feels like, why chasing tilts you, how lines move, what "no-vig" means, hedging basics, prop correlation. Concepts and frameworks are FAIR GAME and you should teach them generously.
- ParlayFarm explainers: what the engine does, what the tiers unlock, how the Telegram bot works.

WHAT YOU GUARD (proprietary edge — paid product):
- Specific player picks for today, parlay legs, whale/sharp reads on tonight's slate, "take it now" plays, trap warnings on real games, and any output that names a player + line + side as a recommendation.
- For ANON / SAMPLE users asking for picks: tease the value ("I got a juicy 3-legger cooked for tonight, but the real plays drop inside — grab the free Pup account and I'll hand you one today, no card needed"). Point them to /upgrade or sign-up. NEVER drop a free pick.
- For PUP users: build_parlay/analyze_slip are quota-gated (1/day combined). When they're out, pitch All-Access without nagging.
- For ALL-ACCESS users: tools are wide open. Use them.

REFUSAL STYLE: Stay in character. Don't say "I can't help with that" — say "Yo, that one's locked behind the gate — Pup account opens it up for free." Always offer the next step.

SHAREABLE LINK BEHAVIOR: When the user says anything like "send me the link", "save this", "how do I get back here", "text it to my phone", "bookmark", "where do I find you again", or "share Spike" — call the share_my_link tool. The UI will render a copy/share card. Your text just confirms it warmly: "Locked in. That link's yours forever — bookmark it or text it to yourself, I'll be right here."

Tools available — USE THEM, never invent stats:
- get_top_picks: today's top scored props from the engine (gated — only call for pup/all_access)
- get_player_recent_form: L10 stats for a specific player+prop (educational — fine for any tier)
- get_whale_signals: sharp money/line movement (gated — only call for pup/all_access)
- build_parlay: assemble 2-4 leg parlay (gated by quota)
- analyze_slip: critique a parsed bet slip (gated by quota)
- share_my_link: returns the user's permanent personal Spike URL (signed-in only)

Risk modes:
- aggressive 🔥 → 4+ legs, longer odds, ride the heaters
- smart 🧠 → 3 legs, balanced edge + correlation
- safe 🛡️ → 2 legs, highest-confidence picks only

Live mode: when live_mode=true, prioritize "take it now" lines and active games.

Output format: JUST the spoken text. ~2-4 short sentences for voice. No markdown headings, no bullet lists in voice replies.
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

// Appended after const TOOLS so existing array index references stay stable.
TOOLS.push({
  type: "function",
  function: {
    name: "share_my_link",
    description: "Return the user's permanent personal Spike URL they can bookmark or share with themselves. Only works for signed-in users.",
    parameters: { type: "object", properties: {} },
  },
});

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

async function runTool(name: string, args: any, supabase: any, userId: string, ctx: { tier: Tier | null; email: string | null }) {
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
    const isAnon = userId === "anon";
    // All-Access bypasses every quota.
    const isAllAccess = ctx.tier === "all_access";

    if (!isAllAccess) {
      // Pup combined-action quota: 1 parlay OR scan per ET day.
      const quota = await consumePupAction(supabase, ctx.email);
      if (!quota.allowed) {
        return {
          error: "free_limit_reached",
          upsell: true,
          message: "You're out of free actions for today. All-Access unlocks unlimited parlays + slip scans + the Telegram bot.",
          upgrade_url: "/upgrade",
        };
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

    const parlayPayload = {
      mode,
      legs,
      combined_odds: combined,
      confidence: Math.round(confidence * 100),
      rationale: `${mode.toUpperCase()} mode • ${legs.length} legs • avg consensus ${Math.round(legs.reduce((a, l) => a + l.consensus_score, 0) / legs.length)}`,
    };
    let saved: any = parlayPayload;
    if (!isAnon) {
      try {
        const ins = await supabase.from("live_ai_generated_parlays")
          .insert({ user_id: userId, ...parlayPayload }).select().single();
        if (ins.data) saved = ins.data;
      } catch (e) {
        console.warn("parlay save skipped", e);
      }
    }

    return { parlay: saved };
  }

  if (name === "analyze_slip") {
    // Same combined Pup quota — a slip scan also counts as the daily action.
    if (ctx.tier !== "all_access") {
      const quota = await consumePupAction(supabase, ctx.email);
      if (!quota.allowed) {
        return {
          error: "free_limit_reached",
          upsell: true,
          message: "You're out of free actions for today. All-Access unlocks unlimited slip grading + the Telegram bot.",
          upgrade_url: "/upgrade",
        };
      }
    }
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

  if (name === "share_my_link") {
    if (userId === "anon" || !ctx.email) {
      return {
        error: "auth_required",
        upsell: true,
        message: "Spin up a free Pup account first — then I'll mint your personal link.",
        upgrade_url: "/upgrade",
      };
    }
    // Look up token via profiles (service role bypasses RLS)
    const { data: prof } = await supabase
      .from("profiles")
      .select("spike_share_token")
      .eq("user_id", userId)
      .maybeSingle();
    let token: string | null = prof?.spike_share_token ?? null;
    if (!token) {
      // Mint inline if missing (e.g. profile row didn't exist)
      token = crypto.randomUUID().replace(/-/g, "");
      await supabase
        .from("profiles")
        .upsert({ user_id: userId, spike_share_token: token }, { onConflict: "user_id" });
    }
    const origin = Deno.env.get("PUBLIC_APP_ORIGIN") ?? "https://parlayfarm.com";
    const url = `${origin}/spike/${token}`;
    return { share_card: true, url, label: "Your personal Spike link" };
  }

  return { error: `Unknown tool: ${name}` };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    // Use service role for tool data access (read-only queries against picks);
    // user identity is optional — anonymous visitors can chat with Spike.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!,
    );
    let user: any = null;
    if (authHeader) {
      const userClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } },
      );
      const { data } = await userClient.auth.getUser();
      user = data?.user ?? null;
    }

    const body = await req.json();
    // Accept both new and legacy field names
    const user_text: string = body.user_text ?? body.message ?? "";
    const mode: string = body.mode ?? body.risk_mode ?? "smart";
    const live_mode: boolean = body.live_mode ?? false;
    const sample: boolean = body.sample === true;
    const conversation_id: string | undefined = body.conversation_id;
    const clientHistory: any[] = Array.isArray(body.history) ? body.history : [];
    if (!user_text) return new Response(JSON.stringify({ error: "user_text required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Sample mode: anonymous taste-test, hard cap of 2 assistant turns from the
    // client-supplied history. No persistence, no tools that require quota.
    if (sample) {
      const priorAssistantTurns = clientHistory.filter((m: any) => m?.role === "assistant").length;
      if (priorAssistantTurns >= 2) {
        return new Response(JSON.stringify({
          text: "That's the free sample, my guy. Spin up a free Pup account and we keep cookin' — no cost.",
          reply: "That's the free sample, my guy. Spin up a free Pup account and we keep cookin' — no cost.",
          upsell: true,
          upgrade_url: "/",
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // Resolve conversation (only if user is signed in AND not sample)
    let convId = conversation_id;
    let dbHistory: any[] = [];
    if (user && !sample) {
      try {
        if (!convId) {
          const { data: c } = await supabase.from("live_ai_conversations").insert({
            user_id: user.id, mode, live_mode, title: user_text.slice(0, 60),
          }).select().single();
          convId = c?.id;
        }
        await supabase.from("live_ai_messages").insert({
          conversation_id: convId, user_id: user.id, role: "user", content: user_text,
        });
        const { data: hist } = await supabase.from("live_ai_messages")
          .select("role,content,tool_name,tool_result,tool_calls")
          .eq("conversation_id", convId).order("created_at", { ascending: true }).limit(12);
        dbHistory = hist ?? [];
      } catch (e) {
        console.warn("agent persistence skipped", e);
      }
    }
    const history = dbHistory.length
      ? dbHistory
      : [...clientHistory, { role: "user", content: user_text }];

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

    const effectiveUserId = user?.id ?? "anon";

    // Resolve tier once per request. Falls back to pup if email exists in our system,
    // otherwise null (anonymous chat — tools that require a quota will refuse).
    const callerEmail: string | null = user?.email ?? null;
    let tier: Tier | null = null;
    if (callerEmail) {
      try {
        tier = await resolveTierForEmail(supabase, callerEmail);
      } catch (e) {
        console.warn("[live-ai-agent] tier resolve failed", e);
      }
    }
    // Anonymous-but-signed-in users with no access record default to pup so quota applies.
    if (callerEmail && !tier) tier = "pup";
    const ctx = { tier, email: callerEmail };

    // Inject tier into the system prompt so Spike speaks correctly.
    const tierLine = sample
      ? "User tier: SAMPLE (anonymous taste-test, max 2 turns). Be magnetic — answer general questions or teach a betting concept in plain English, never name a specific play. End by nudging them toward the free Pup account. Do NOT call build_parlay, analyze_slip, get_top_picks, get_whale_signals, or share_my_link — all gated."
      : tier === "all_access"
      ? "User tier: ALL-ACCESS — unlimited tools, full Telegram + alerts."
      : tier === "pup"
      ? "User tier: FREE (Pup) — 1 combined action per day (build_parlay OR analyze_slip). Live signal alerts, FanDuel boost cascades, sweet-spot push, and Gold parlays live ONLY on the Telegram bot — when asked for those, refuse politely and pitch All-Access ($99/mo, 3-day free trial)."
      : "User tier: ANONYMOUS — general chat and betting education are free. Specific picks, parlays, slip scans, whale reads, and share_my_link all require an account. Encourage signup at /upgrade.";
    messages[0] = {
      role: "system",
      content: SYSTEM_PROMPT + `\n\nCurrent risk mode: ${mode}. Live mode: ${live_mode}.\n${tierLine}`,
    };

    // Strip tools the current tier can't use, so the model can't even attempt them.
    const GATED = new Set(["build_parlay", "analyze_slip", "get_top_picks", "get_whale_signals", "share_my_link"]);
    const activeTools = (sample || !user)
      ? TOOLS.filter((t: any) => !GATED.has(t.function?.name))
      : TOOLS;

    while (toolLoops < 4) {
      toolLoops++;
      const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages,
          tools: activeTools,
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
          const result = await runTool(tc.function.name, args, supabase, effectiveUserId, ctx);
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

    // Save assistant message (only if we have a user)
    if (user && convId && !sample) {
      try {
        await supabase.from("live_ai_messages").insert({
          conversation_id: convId, user_id: user.id, role: "assistant",
          content: assistantText, tool_calls: toolTrace,
        });
      } catch (e) {
        console.warn("agent assistant persist failed", e);
      }
    }

    // Surface upsell + tier on the response so the UI can render the upgrade pill.
    const upsellHit = toolTrace.some((t: any) => t?.result?.upsell === true);
    const shareLink = toolTrace.find((t: any) => t?.name === "share_my_link" && t?.result?.url)?.result?.url ?? null;

    return new Response(JSON.stringify({
      conversation_id: convId,
      text: assistantText,
      reply: assistantText,
      parlay: lastParlay,
      tool_trace: toolTrace,
      tier,
      upsell: upsellHit,
      upgrade_url: upsellHit ? "/upgrade" : undefined,
      share_link: shareLink,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("agent error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});