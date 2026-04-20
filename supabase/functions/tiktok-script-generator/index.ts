// TikTok Script Generator — Phase 1
// Pulls today's locked picks, generates 3 scripts (one per template), runs safety
// linter, saves drafts, and pings admin Telegram.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import type { VideoScript, VideoTemplate, TiktokAccount, HookEntry, ScriptBeat } from "../_shared/tiktok-types.ts";
import { lintAndRewrite, softAnglePromptAddendum } from "../_shared/tiktok-safety.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const AI_MODEL = "google/gemini-3-flash-preview";
const MIN_COMPLIANCE = 75;

function sb() { return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY); }

// ─── Hook selection ───────────────────────────────────────────────────────
async function selectHook(style: string, template: VideoTemplate, fillVars: Record<string, string>): Promise<HookEntry | null> {
  const { data } = await sb()
    .from("tiktok_hook_performance")
    .select("*")
    .eq("style", style)
    .eq("template", template)
    .eq("active", true);
  if (!data || data.length === 0) return null;

  // Epsilon-greedy weighted by completion rate
  const pool = data as HookEntry[];
  let chosen: HookEntry;
  if (Math.random() < 0.25) {
    chosen = pool[Math.floor(Math.random() * pool.length)];
  } else {
    const weighted = pool.map(h => ({ hook: h, weight: (Number(h.avg_completion_rate) || 0.45) + (h.impressions < 5 ? 0.15 : 0) }));
    const total = weighted.reduce((s, x) => s + x.weight, 0);
    let r = Math.random() * total;
    chosen = weighted[0].hook;
    for (const w of weighted) { r -= w.weight; if (r <= 0) { chosen = w.hook; break; } }
  }
  let filled = chosen.text;
  for (const [k, v] of Object.entries(fillVars)) filled = filled.replace(new RegExp(`\\{${k}\\}`, "g"), v);
  return { ...chosen, text: filled };
}

// ─── Prompt builder ───────────────────────────────────────────────────────
function buildPrompt(template: VideoTemplate, payload: any, persona: TiktokAccount, hookText: string): string {
  if (template === "pick_reveal") {
    const p = payload.pick;
    const reasoning = p.reasoning || {};
    return `You are writing a TikTok video script for "${persona.display_name}", a ${persona.tone_description}

The video should feel like a DATA ANALYST noticing a pattern — not a bettor sharing a pick.

SOURCE DATA:
- Player: ${p.player_name} (${p.team || "team unknown"})${p.opponent ? ` vs ${p.opponent}` : ""}
- Stat: ${p.prop_type} — line ${p.line}, side ${p.side}
- Confidence: ${Math.round(p.confidence)}/100
- Headline: ${reasoning.headline || ""}
- Drivers: ${(reasoning.drivers || []).join(" | ")}
- Recency: L3 ${p.recency?.l3_avg ?? "n/a"}, L10 ${p.recency?.l10_avg ?? "n/a"}, hit rate ${p.recency?.l10_hit_rate ?? "n/a"}%
- Risk: ${reasoning.risk_note || "n/a"}

HOOK (use this EXACT line as beat 0):
"${hookText}"

${softAnglePromptAddendum()}

STRUCTURE:
- Total 26-32 seconds, 4 beats + CTA (hook is beat 0)
- Beat 1 SETUP: 5-6s, visual=avatar_with_lower_third
- Beat 2 EVIDENCE: 7-9s, visual=stat_card with rows
- Beat 3 PAYOFF: 6-8s, visual=avatar
- Beat 4 CALLBACK: 3-4s, visual=broll
- CTA: 2s, visual=avatar

Output STRICT JSON, no markdown:
{"hook":{"vo_text":"<hook>","visual_style":"calm_authority"},"beats":[{"index":1,"vo_text":"...","duration_est_sec":5.5,"visual":"avatar_with_lower_third","on_screen_text":"MAX 40 CHARS"},{"index":2,"vo_text":"...","duration_est_sec":8,"visual":"stat_card","stat_card_data":{"title":"...","rows":[{"label":"vs OPP","value":"22 PTS","highlight":true}],"footer":"Line: ${p.line}"}},{"index":3,"vo_text":"...","duration_est_sec":7,"visual":"avatar"},{"index":4,"vo_text":"...","duration_est_sec":3.5,"visual":"broll","broll_query":"basketball arena"}],"cta":{"vo_text":"Full breakdown in the bio.","on_screen_text":"\u2192 LINK IN BIO"},"caption_seed":"...","hashtag_seed":["#sports","#nba"]}`;
  }
  if (template === "results_recap") {
    const r = payload;
    const winRate = r.total ? Math.round((r.won / r.total) * 100) : 0;
    return `You are writing a TikTok recap video for "${persona.display_name}" — ${persona.tone_description}

SOURCE DATA (yesterday):
- Date: ${r.date}
- Plays: ${r.total}, Hits: ${r.won} (${winRate}%), Misses: ${r.lost}
${r.standout_hit ? `- Top hit: ${r.standout_hit.player} ${r.standout_hit.stat} — line ${r.standout_hit.line}, actual ${r.standout_hit.actual}` : ""}
${r.standout_miss ? `- Worst miss: ${r.standout_miss.player} ${r.standout_miss.stat} — line ${r.standout_miss.line}, actual ${r.standout_miss.actual}` : ""}

HOOK (use exactly): "${hookText}"

${softAnglePromptAddendum()}

STRUCTURE: 25-32s total. Acknowledge the miss honestly.
- Beat 1 SUMMARY 4-5s stat_card
- Beat 2 HIGHLIGHT 7-9s broll
- Beat 3 HONEST MISS 5-6s avatar
- Beat 4 LESSON 4-5s avatar
- CTA 2s

Output STRICT JSON same shape as pick_reveal.`;
  }
  // data_insight
  const facts: string[] = payload.facts || [];
  return `You are writing a TikTok data-insight video for "${persona.display_name}" — ${persona.tone_description}

TOPIC: ${payload.topic}
FACTS:
${facts.map((f, i) => `${i + 1}. ${f}`).join("\n")}

HOOK (use exactly): "${hookText}"

${softAnglePromptAddendum()}

STRUCTURE: 22-30s.
- Beat 1 EXPAND 4s avatar_with_lower_third
- Beat 2 DATA 8-10s stat_card
- Beat 3 WHY 6-7s avatar
- Beat 4 FORWARD 3-4s avatar
- CTA 2s

Output STRICT JSON same shape as pick_reveal.`;
}

// ─── LLM call via Lovable AI Gateway ──────────────────────────────────────
async function callAI(systemPrompt: string, userPrompt: string): Promise<any | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const userText = attempt === 0 ? userPrompt : userPrompt + "\n\nIMPORTANT: Return ONLY valid JSON, no markdown fencing.";
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userText }],
        temperature: 0.8,
      }),
    });
    if (!resp.ok) {
      console.error(`[AI] ${resp.status} attempt ${attempt}:`, await resp.text());
      if (resp.status === 429 || resp.status === 402) throw new Error(`AI gateway error ${resp.status}`);
      continue;
    }
    const data = await resp.json();
    const text = data?.choices?.[0]?.message?.content;
    if (!text) continue;
    let cleaned = text.trim();
    if (cleaned.startsWith("```")) cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
    const first = cleaned.indexOf("{"), last = cleaned.lastIndexOf("}");
    if (first === -1 || last === -1) continue;
    try { return JSON.parse(cleaned.slice(first, last + 1)); } catch { continue; }
  }
  return null;
}

// ─── Telegram preview ────────────────────────────────────────────────────
async function sendTelegramPreview(script: VideoScript, persona: TiktokAccount): Promise<number | null> {
  try {
    const beatLines = script.beats.map(b => `   ${b.index}. ${b.vo_text}`).join("\n");
    const text = `🎬 *TikTok Draft Ready* — ${persona.display_name}
_Template:_ ${script.template} • _Score:_ ${script.compliance_score}/100

*Hook:* ${script.hook.vo_text}

*Beats:*
${beatLines}

*CTA:* ${script.cta.vo_text}

_Caption:_ ${script.caption_seed}

Review at /admin/tiktok`;
    const resp = await sb().functions.invoke("bot-send-telegram", {
      body: { message: text, admin_only: true, parse_mode: "Markdown" },
    });
    return resp?.data?.message_id || null;
  } catch (e) {
    console.warn("[telegram] preview send failed:", e);
    return null;
  }
}

// ─── Main pipeline ────────────────────────────────────────────────────────
async function generateForBrief(template: VideoTemplate, payload: any, persona: TiktokAccount): Promise<{ ok: boolean; script_id?: string; reason?: string }> {
  // 1. Hook
  const fillVars: Record<string, string> = {};
  if (template === "pick_reveal" && payload.pick) fillVars.player = payload.pick.player_name.split(" ").pop();
  if (template === "results_recap") {
    fillVars.count = String(payload.total || 0);
    fillVars.winrate = String(Math.round((payload.won / Math.max(1, payload.total)) * 100));
  }
  const hook = await selectHook(persona.hook_style, template, fillVars);
  if (!hook) return { ok: false, reason: "no_hook_available" };

  // 2. Build + call LLM
  const prompt = buildPrompt(template, payload, persona, hook.text);
  const llm = await callAI("You are a sports data storyteller. Output ONLY valid JSON matching the schema.", prompt);
  if (!llm) return { ok: false, reason: "llm_returned_null" };

  // 3. Assemble script
  const beats: ScriptBeat[] = (llm.beats || []).map((b: any, i: number) => ({
    index: b.index ?? i + 1,
    vo_text: b.vo_text || "",
    duration_est_sec: b.duration_est_sec || 5,
    visual: b.visual || "avatar",
    on_screen_text: b.on_screen_text,
    broll_query: b.broll_query,
    stat_card_data: b.stat_card_data,
  }));
  const script: VideoScript = {
    id: crypto.randomUUID(),
    template,
    target_persona_key: persona.persona_key,
    account_id: persona.id,
    target_duration_sec: beats.reduce((s, b) => s + b.duration_est_sec, 0) + 1.8 + 2.0,
    hook: { vo_text: llm.hook?.vo_text || hook.text, visual_style: llm.hook?.visual_style || "calm_authority", hook_source_id: hook.id },
    beats,
    cta: llm.cta || { vo_text: "Full breakdown in the bio.", on_screen_text: "→ LINK IN BIO" },
    caption_seed: llm.caption_seed || "",
    hashtag_seed: [...(llm.hashtag_seed || []), ...persona.baseline_hashtags],
    source: {
      pick_ids: payload.pick ? [payload.pick.id] : undefined,
      recap_date: payload.date,
      insight_topic: payload.topic,
    },
    source_data: payload,
    compliance_score: 100,
    lint_transforms: [],
  };

  // 4. Lint + rewrite
  const lint = lintAndRewrite(script);
  script.lint_transforms = lint.transforms.map(t => ({ from: t.from, to: t.to, beat_index: t.beat_index }));
  script.lint_warnings = lint.warnings;
  script.compliance_score = lint.score;
  if (lint.rejected) return { ok: false, reason: `lint_rejected: ${lint.rejection_reasons.join(", ")}` };
  if (script.compliance_score < MIN_COMPLIANCE) return { ok: false, reason: `low_compliance_${script.compliance_score}` };

  // 5. Persist as draft
  const { error } = await sb().from("tiktok_video_scripts").insert({
    id: script.id,
    account_id: script.account_id,
    target_persona_key: script.target_persona_key,
    template: script.template,
    hook: script.hook,
    beats: script.beats,
    cta: script.cta,
    caption_seed: script.caption_seed,
    hashtag_seed: script.hashtag_seed,
    target_duration_sec: script.target_duration_sec,
    source: script.source,
    source_data: script.source_data,
    compliance_score: script.compliance_score,
    lint_transforms: script.lint_transforms,
    lint_warnings: script.lint_warnings,
    status: "draft",
  });
  if (error) return { ok: false, reason: `db_insert: ${error.message}` };

  // 6. Telegram preview (best-effort)
  const msgId = await sendTelegramPreview(script, persona);
  if (msgId) await sb().from("tiktok_video_scripts").update({ telegram_message_id: msgId }).eq("id", script.id);

  return { ok: true, script_id: script.id };
}

// ─── Build today's briefs ─────────────────────────────────────────────────
async function buildBriefs(): Promise<Array<{ template: VideoTemplate; payload: any; persona: TiktokAccount }>> {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  const { data: accounts } = await sb().from("tiktok_accounts").select("*").neq("status", "paused");
  if (!accounts || accounts.length === 0) return [];

  const { data: existingToday } = await sb()
    .from("tiktok_video_scripts")
    .select("target_persona_key, template")
    .gte("created_at", today + "T00:00:00Z");
  const doneByPersona = new Map<string, Set<string>>();
  for (const r of existingToday || []) {
    const set = doneByPersona.get(r.target_persona_key) || new Set();
    set.add(r.template);
    doneByPersona.set(r.target_persona_key, set);
  }

  // Pull source data
  const { data: picks } = await sb().from("bot_daily_picks").select("*").eq("pick_date", today).eq("status", "locked").order("confidence", { ascending: false }).limit(5);
  const { data: yesterdayParlays } = await sb().from("bot_daily_parlays").select("*").eq("parlay_date", yesterday).in("outcome", ["won", "lost"]);

  const briefs: Array<{ template: VideoTemplate; payload: any; persona: TiktokAccount }> = [];
  for (let i = 0; i < accounts.length; i++) {
    const persona = accounts[i] as TiktokAccount;
    const done = doneByPersona.get(persona.persona_key) || new Set();

    if (picks && picks.length > 0 && !done.has("pick_reveal")) {
      briefs.push({ template: "pick_reveal", payload: { pick: picks[Math.min(i, picks.length - 1)] }, persona });
    } else if (yesterdayParlays && yesterdayParlays.length > 0 && !done.has("results_recap")) {
      const won = yesterdayParlays.filter(p => p.outcome === "won").length;
      const lost = yesterdayParlays.filter(p => p.outcome === "lost").length;
      briefs.push({ template: "results_recap", payload: { date: yesterday, total: won + lost, won, lost }, persona });
    }
  }
  return briefs;
}

// ─── HTTP entry ───────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const startMs = Date.now();
  try {
    const body = await req.json().catch(() => ({}));

    // Manual mode: caller specifies template + payload + persona_key
    if (body.template && body.persona_key && body.payload) {
      const { data: persona } = await sb().from("tiktok_accounts").select("*").eq("persona_key", body.persona_key).maybeSingle();
      if (!persona) return new Response(JSON.stringify({ success: false, error: "persona not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const result = await generateForBrief(body.template, body.payload, persona as TiktokAccount);
      return new Response(JSON.stringify({ success: result.ok, ...result }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Cron / batch mode
    const briefs = await buildBriefs();
    const results: any[] = [];
    let generated = 0, rejected = 0;
    for (const brief of briefs) {
      let r: any = null;
      for (let attempt = 0; attempt < 2 && (!r || !r.ok); attempt++) {
        try { r = await generateForBrief(brief.template, brief.payload, brief.persona); }
        catch (e) { r = { ok: false, reason: (e as Error).message }; }
      }
      results.push({ persona: brief.persona.persona_key, template: brief.template, ...r });
      if (r?.ok) generated++; else rejected++;
    }

    await sb().from("tiktok_pipeline_logs").insert({
      run_type: "script_generation",
      status: rejected === 0 ? "success" : (generated > 0 ? "partial" : "failed"),
      message: `Generated ${generated} of ${briefs.length} scripts`,
      metadata: { results },
      duration_ms: Date.now() - startMs,
      scripts_generated: generated,
      scripts_rejected: rejected,
    });

    return new Response(JSON.stringify({ success: true, briefs: briefs.length, generated, rejected, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[script-gen] fatal:", e);
    await sb().from("tiktok_pipeline_logs").insert({
      run_type: "script_generation", status: "failed", message: (e as Error).message, duration_ms: Date.now() - startMs,
    });
    return new Response(JSON.stringify({ success: false, error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
