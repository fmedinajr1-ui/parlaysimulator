// prop-alert-verifier
// Deep-research second-opinion agent. Reads inbound prop alerts, pulls fresh
// research via Perplexity sonar-deep-research, judges with GPT-5 via Lovable
// AI Gateway, writes a verdict to prop_alert_verdicts, and tags the source
// alert's metadata.verifier so the parlay engine can apply a confidence
// multiplier. Soft-gate only — never hard-blocks an alert.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SOURCE_TABLES = [
  "fanduel_prediction_alerts",
  "sharp_signals",
  "extreme_movement_alerts",
  "market_signals",
] as const;
type SourceTable = typeof SOURCE_TABLES[number];

const DAILY_CAP = 300;
const DEDUPE_HOURS = 2;
const PERPLEXITY_TIMEOUT_MS = 75_000;
const JUDGE_TIMEOUT_MS = 45_000;

type Verdict = "APPROVE" | "CAUTION" | "REJECT";

interface AlertCtx {
  alert_id: string;
  source_table: SourceTable;
  player_name: string | null;
  sport: string | null;
  prop_type: string | null;
  side: string | null;
  line: number | null;
  event_id: string | null;
  prediction: string | null;
  confidence: number | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getSupabase() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await p;
  } finally {
    clearTimeout(t);
  }
  void label; void ctrl;
}

export function multiplierFor(verdict: Verdict, confidence: number): number {
  // confidence 0-100. Soft haircut, never zero.
  if (verdict === "APPROVE") return 1 + Math.min(0.15, (confidence - 60) / 400);
  if (verdict === "CAUTION") return 0.85 - Math.min(0.20, (confidence - 50) / 250);
  // REJECT
  return Math.max(0.30, 0.55 - Math.min(0.25, (confidence - 50) / 200));
}

export function buildResearchPrompt(a: AlertCtx): { system: string; user: string } {
  const sport = (a.sport || "").toUpperCase();
  const sportBlock = sport === "MLB"
    ? "Weather at ballpark (wind dir/speed, temp), starting pitcher + bullpen status, batting order spot, opponent pitcher handedness split."
    : sport === "NBA"
    ? "Confirmed starting lineup, minutes restrictions, back-to-back, opponent defensive rank vs this prop type, pace."
    : sport === "NHL"
    ? "Starting goalie confirmation, line combinations, power-play unit, opponent goalie save % at this market."
    : "Confirmed availability, recent form, opponent matchup factors specific to this market.";

  const system =
    "You are a sports-betting research analyst. Pull only CONCRETE, dated, sourced facts from the last 24 hours that bear on the specific prop. Never speculate. Never explain methodology. If a category has no real news, say NONE.";
  const user = [
    `Prop alert to verify:`,
    `- Player: ${a.player_name ?? "?"}`,
    `- Sport: ${sport || "?"}`,
    `- Market: ${a.prop_type ?? "?"} ${a.side ?? ""} ${a.line ?? ""}`.trim(),
    `- Alert direction/prediction: ${a.prediction ?? "?"}`,
    `- Event: ${a.event_id ?? "?"}`,
    ``,
    `Return short bullets under these EXACT headings:`,
    `INJURY/AVAILABILITY:`,
    `LINEUP/ROLE:`,
    `SPORT-SPECIFIC: (${sportBlock})`,
    `RECENT FORM (last 5-10): (real numbers only)`,
    `OPPONENT MATCHUP vs this prop type:`,
    `LINE HISTORY / SHARP MOVES on this exact prop:`,
    `BOTTOM LINE: one sentence — does evidence SUPPORT, NEUTRAL, or CONTRADICT the alert direction?`,
  ].join("\n");
  return { system, user };
}

async function callPerplexity(prompt: { system: string; user: string }): Promise<{ content: string; citations: string[] } | null> {
  const key = Deno.env.get("PERPLEXITY_API_KEY");
  if (!key) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PERPLEXITY_TIMEOUT_MS);
  try {
    const r = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: "sonar-deep-research",
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
        search_recency_filter: "day",
        temperature: 0.1,
      }),
    });
    if (!r.ok) {
      console.warn("perplexity non-200", r.status, await r.text().catch(() => ""));
      return null;
    }
    const j = await r.json();
    return {
      content: j?.choices?.[0]?.message?.content ?? "",
      citations: Array.isArray(j?.citations) ? j.citations : [],
    };
  } catch (e) {
    console.warn("perplexity error", (e as Error).message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function callJudge(
  alert: AlertCtx,
  research: string,
  degraded: boolean,
): Promise<{ verdict: Verdict; confidence: number; reasoning: string; flags: string[] } | null> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) return null;
  const model = degraded ? "google/gemini-2.5-flash" : "openai/gpt-5";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), JUDGE_TIMEOUT_MS);
  const sys = [
    "You are a careful sports-betting risk judge. Take your time.",
    "Inputs: a candidate prop alert from our system + fresh research evidence.",
    "Output strict JSON only: {verdict, confidence, reasoning, flags}.",
    "verdict ∈ APPROVE|CAUTION|REJECT.",
    "confidence: 0-100 integer (your confidence in the verdict).",
    "reasoning: 2-3 sentences plain English, no jargon.",
    "flags: array from [INJURY_UPDATE_AFTER_LINE, LINEUP_CHANGE, WEATHER_FADE, STALE_LINE, BOOK_OVERREACTION, MATCHUP_MISMATCH, POISON_SIGNAL, ROLE_CHANGE, INSUFFICIENT_EVIDENCE].",
    "Be skeptical of snapback / reverse moves. Require concrete evidence to REJECT.",
    "If research is empty or NONE everywhere, return CAUTION with INSUFFICIENT_EVIDENCE.",
  ].join(" ");
  const usr = [
    "ALERT:",
    JSON.stringify({
      player: alert.player_name, sport: alert.sport, prop: alert.prop_type,
      side: alert.side, line: alert.line, prediction: alert.prediction,
      system_confidence: alert.confidence,
    }),
    "",
    "RESEARCH:",
    research || "(no fresh research available)",
    "",
    "Return ONLY the JSON object.",
  ].join("\n");
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: sys }, { role: "user", content: usr }],
        response_format: { type: "json_object" },
      }),
    });
    if (!r.ok) {
      console.warn("judge non-200", r.status, await r.text().catch(() => ""));
      return null;
    }
    const j = await r.json();
    const raw = j?.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw);
    const verdict = (["APPROVE", "CAUTION", "REJECT"].includes(parsed.verdict) ? parsed.verdict : "CAUTION") as Verdict;
    const confidence = Math.max(0, Math.min(100, Math.round(Number(parsed.confidence) || 50)));
    const flags = Array.isArray(parsed.flags) ? parsed.flags.filter((x: unknown) => typeof x === "string") : [];
    const reasoning = typeof parsed.reasoning === "string" ? parsed.reasoning.slice(0, 800) : "";
    return { verdict, confidence, flags, reasoning };
  } catch (e) {
    console.warn("judge error", (e as Error).message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function loadAlert(supa: ReturnType<typeof getSupabase>, source_table: SourceTable, alert_id: string): Promise<AlertCtx | null> {
  const cols = "id, player_name, sport, prop_type, event_id, metadata, created_at";
  // sharp_signals/extreme_movement_alerts/market_signals don't all have prediction/side/line/confidence columns —
  // try the rich select first for fanduel_prediction_alerts, fallback to base for the others.
  if (source_table === "fanduel_prediction_alerts") {
    const { data, error } = await supa.from(source_table)
      .select(`${cols}, prediction, confidence`).eq("id", alert_id).maybeSingle();
    if (error || !data) return null;
    const md = (data.metadata as Record<string, unknown> | null) ?? null;
    return {
      alert_id: data.id, source_table,
      player_name: data.player_name, sport: data.sport, prop_type: data.prop_type,
      side: (md?.side as string) ?? (md?.direction as string) ?? null,
      line: (md?.line as number) ?? null,
      event_id: data.event_id, prediction: data.prediction,
      confidence: data.confidence, metadata: md, created_at: data.created_at,
    };
  }
  const { data, error } = await supa.from(source_table).select(cols).eq("id", alert_id).maybeSingle();
  if (error || !data) return null;
  const md = (data.metadata as Record<string, unknown> | null) ?? null;
  return {
    alert_id: data.id, source_table,
    player_name: data.player_name ?? null,
    sport: data.sport ?? null,
    prop_type: data.prop_type ?? null,
    side: (md?.side as string) ?? null,
    line: (md?.line as number) ?? null,
    event_id: data.event_id ?? null,
    prediction: (md?.prediction as string) ?? null,
    confidence: (md?.confidence as number) ?? null,
    metadata: md, created_at: data.created_at,
  };
}

async function checkDailyCap(supa: ReturnType<typeof getSupabase>): Promise<{ over: boolean; count: number }> {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const { data } = await supa.from("prop_alert_verifier_daily_cost").select("*").eq("cost_date", today).maybeSingle();
  const count = data?.verdicts_count ?? 0;
  return { over: count >= DAILY_CAP, count };
}

async function bumpDailyCount(supa: ReturnType<typeof getSupabase>, costUsd: number) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  // upsert via insert + on conflict using a manual select/update so we don't need a custom rpc
  const { data: existing } = await supa.from("prop_alert_verifier_daily_cost").select("*").eq("cost_date", today).maybeSingle();
  if (existing) {
    await supa.from("prop_alert_verifier_daily_cost").update({
      verdicts_count: (existing.verdicts_count ?? 0) + 1,
      cost_usd: Number(existing.cost_usd ?? 0) + costUsd,
      updated_at: new Date().toISOString(),
    }).eq("cost_date", today);
  } else {
    await supa.from("prop_alert_verifier_daily_cost").insert({
      cost_date: today, verdicts_count: 1, cost_usd: costUsd,
    });
  }
}

async function patchAlertMetadata(
  supa: ReturnType<typeof getSupabase>,
  source_table: SourceTable, alert_id: string,
  verifier: { verdict: Verdict; multiplier: number; reasoning: string; flags: string[] },
) {
  const { data } = await supa.from(source_table).select("metadata").eq("id", alert_id).maybeSingle();
  const md = ((data?.metadata as Record<string, unknown>) ?? {});
  md.verifier = { ...verifier, verified_at: new Date().toISOString() };
  await supa.from(source_table).update({ metadata: md }).eq("id", alert_id);
}

async function verifyOne(
  supa: ReturnType<typeof getSupabase>,
  source_table: SourceTable, alert_id: string,
): Promise<{ ok: boolean; verdict?: Verdict; reason?: string }> {
  // dedupe: if a verdict already exists for the same (player, prop, side, line) within DEDUPE_HOURS, return cached
  const alert = await loadAlert(supa, source_table, alert_id);
  if (!alert) return { ok: false, reason: "alert_not_found" };

  const since = new Date(Date.now() - DEDUPE_HOURS * 3600 * 1000).toISOString();
  if (alert.player_name && alert.prop_type) {
    const { data: cached } = await supa.from("prop_alert_verdicts")
      .select("verdict, confidence_multiplier, reasoning, flags")
      .eq("player_name", alert.player_name)
      .eq("prop_type", alert.prop_type)
      .eq("side", alert.side ?? "")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (cached) {
      // upsert verdict row for this specific alert pointing at cached values
      await supa.from("prop_alert_verdicts").upsert({
        alert_id, source_table,
        player_name: alert.player_name, sport: alert.sport, prop_type: alert.prop_type,
        side: alert.side, line: alert.line, event_id: alert.event_id,
        verdict: cached.verdict, verdict_confidence: 0,
        confidence_multiplier: cached.confidence_multiplier,
        reasoning: `(cached) ${cached.reasoning ?? ""}`,
        flags: [...(cached.flags ?? []), "DEDUPED"],
        status: "complete",
      }, { onConflict: "source_table,alert_id" });
      await patchAlertMetadata(supa, source_table, alert_id, {
        verdict: cached.verdict as Verdict,
        multiplier: Number(cached.confidence_multiplier),
        reasoning: cached.reasoning ?? "",
        flags: cached.flags ?? [],
      });
      return { ok: true, verdict: cached.verdict as Verdict, reason: "deduped" };
    }
  }

  const cap = await checkDailyCap(supa);
  const degraded = cap.over;

  const t0 = Date.now();
  const prompt = buildResearchPrompt(alert);
  const research = degraded ? null : await callPerplexity(prompt);
  const researchText = research?.content ?? "";
  const citations = research?.citations ?? [];

  const judged = await callJudge(alert, researchText, degraded);
  if (!judged) {
    await supa.from("prop_alert_verdicts").upsert({
      alert_id, source_table,
      player_name: alert.player_name, sport: alert.sport, prop_type: alert.prop_type,
      side: alert.side, line: alert.line, event_id: alert.event_id,
      verdict: "CAUTION", verdict_confidence: 0, confidence_multiplier: 0.85,
      reasoning: "Judge unavailable; defaulting to CAUTION.",
      flags: ["JUDGE_ERROR"],
      research_model: degraded ? null : "perplexity:sonar-deep-research",
      judge_model: degraded ? "google/gemini-2.5-flash" : "openai/gpt-5",
      research_ms: Date.now() - t0,
      status: "error", error_message: "judge_unavailable",
    }, { onConflict: "source_table,alert_id" });
    return { ok: false, reason: "judge_unavailable" };
  }

  const multiplier = Number(multiplierFor(judged.verdict, judged.confidence).toFixed(3));
  const flags = degraded ? [...judged.flags, "DEGRADED"] : judged.flags;

  await supa.from("prop_alert_verdicts").upsert({
    alert_id, source_table,
    player_name: alert.player_name, sport: alert.sport, prop_type: alert.prop_type,
    side: alert.side, line: alert.line, event_id: alert.event_id,
    verdict: judged.verdict, verdict_confidence: judged.confidence,
    confidence_multiplier: multiplier,
    reasoning: judged.reasoning, flags,
    evidence: { citations, research: researchText.slice(0, 4000) },
    research_model: degraded ? null : "perplexity:sonar-deep-research",
    judge_model: degraded ? "google/gemini-2.5-flash" : "openai/gpt-5",
    research_ms: Date.now() - t0,
    status: "complete",
  }, { onConflict: "source_table,alert_id" });

  await patchAlertMetadata(supa, source_table, alert_id, {
    verdict: judged.verdict, multiplier, reasoning: judged.reasoning, flags,
  });
  // rough cost estimate: deep research ~$0.05, judge ~$0.02
  await bumpDailyCount(supa, degraded ? 0.005 : 0.07);
  return { ok: true, verdict: judged.verdict };
}

async function sweep(
  supa: ReturnType<typeof getSupabase>,
  sinceMinutes: number, limit: number,
): Promise<{ scanned: number; verified: number; errors: number }> {
  const since = new Date(Date.now() - sinceMinutes * 60 * 1000).toISOString();
  const candidates: Array<{ source_table: SourceTable; alert_id: string }> = [];
  for (const tbl of SOURCE_TABLES) {
    const { data } = await supa.from(tbl).select("id, created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(limit);
    for (const r of data ?? []) {
      const { data: existing } = await supa.from("prop_alert_verdicts").select("id").eq("source_table", tbl).eq("alert_id", r.id).maybeSingle();
      if (!existing) candidates.push({ source_table: tbl, alert_id: r.id });
    }
  }
  let verified = 0, errors = 0;
  // bounded concurrency = 3
  const queue = [...candidates];
  async function worker() {
    while (queue.length) {
      const job = queue.shift()!;
      try {
        const r = await verifyOne(supa, job.source_table, job.alert_id);
        if (r.ok) verified++; else errors++;
      } catch (e) {
        console.warn("sweep verify error", (e as Error).message);
        errors++;
      }
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  return { scanned: candidates.length, verified, errors };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const supa = getSupabase();

    if (body?.mode === "sweep") {
      const sinceMinutes = Number(body.since_minutes ?? 30);
      const limit = Math.min(200, Number(body.limit ?? 100));
      const res = await sweep(supa, sinceMinutes, limit);
      return jsonResponse({ ok: true, mode: "sweep", ...res });
    }

    const alert_id = String(body?.alert_id ?? "");
    const source_table = String(body?.source_table ?? "") as SourceTable;
    if (!alert_id || !SOURCE_TABLES.includes(source_table)) {
      return jsonResponse({ ok: false, error: "alert_id and valid source_table required" }, 400);
    }
    const r = await verifyOne(supa, source_table, alert_id);
    return jsonResponse(r);
  } catch (e) {
    console.error("prop-alert-verifier error", e);
    return jsonResponse({ ok: false, error: (e as Error).message }, 500);
  }
});

// re-export for tests
export { SOURCE_TABLES };