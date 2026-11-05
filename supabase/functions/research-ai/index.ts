// deno-lint-ignore-file no-explicit-any
// On-demand research AI: explain one player's edge, rebuild today's top plays, or chat with the data.
import { createClient } from "npm:@supabase/supabase-js@2";
import { etDateKey } from "../_shared/date-et.ts";
import { describe, playerLogs, slateEdges, saveReport, STAT_LABEL } from "../_shared/research/context.ts";
import { runResearchAi, AiGatewayError, RESEARCH_INSTRUCTIONS } from "../_shared/research/ai.ts";
import type { StatKey } from "../_shared/research/math.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const today = etDateKey();
  try {
    const body = await req.json();
    const mode = body.mode as "explain" | "top" | "chat";

    if (mode === "explain") {
      const stat = (body.stat in STAT_LABEL ? body.stat : "points") as StatKey;
      const name = String(body.player ?? "").slice(0, 80);
      const logs = await playerLogs(sb, name);
      const line = body.line != null && body.line !== "" ? Number(body.line) : undefined;
      const d = describe(logs, stat, line);
      if (!d) return json({ error: "No recent games for that player." }, 404);
      const { data: lines } = await sb.from("research_prop_lines").select("line,book,over_price,under_price").eq("game_date", today).ilike("player_name", d.player).eq("stat", stat);
      const { data: inj } = await sb.from("nba_injury_reports").select("status,injury_type").ilike("player_name", d.player).eq("game_date", today).order("updated_at", { ascending: false }).limit(1);
      const text = await runResearchAi(RESEARCH_INSTRUCTIONS, [{ role: "user", content:
        `Explain ${d.player}'s ${d.stat} edge in 3-5 short bullet points and end with a lean (Over / Under / Pass).\nBox score math: ${JSON.stringify(d)}\nToday's lines: ${JSON.stringify(lines ?? [])}\nInjury: ${JSON.stringify(inj?.[0] ?? null)}` }], req.signal);
      await saveReport(sb, "explain", d.player, stat, today, text);
      return json({ text });
    }

    if (mode === "top") {
      const edges = (await slateEdges(sb, today)).slice(0, 25);
      if (!edges.length) return json({ text: "Today's sportsbook lines aren't loaded yet — they arrive with the daily 10 AM ET update. Check back after that." });
      const text = await runResearchAi(RESEARCH_INSTRUCTIONS, [{ role: "user", content:
        `Today's slate (${today}). Pick the 5 best plays from these edges and give one short reason each, plus one play to avoid. Data:\n${JSON.stringify(edges)}` }], req.signal);
      await saveReport(sb, "top_plays", null, null, today, text);
      return json({ text });
    }

    if (mode === "chat") {
      const history = (body.messages ?? []).slice(-10).map((m: any) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content).slice(0, 2000) }));
      const edges = (await slateEdges(sb, today)).slice(0, 40);
      // Pull box score math for players named in the latest question.
      const last = history[history.length - 1]?.content ?? "";
      const words = last.split(/[^A-Za-z'.-]+/).filter((w: string) => w.length > 3).slice(0, 6);
      const found: any[] = [];
      for (const w of words) {
        const { data } = await sb.from("nba_player_game_logs").select("player_name").ilike("player_name", `%${w}%`).limit(1);
        const n = data?.[0]?.player_name;
        if (n && !found.some((f) => f.player === n)) {
          const logs = await playerLogs(sb, n);
          for (const s of ["points", "rebounds", "assists", "threes_made"] as StatKey[]) { const d = describe(logs, s); if (d) found.push(d); }
        }
      }
      const context = `Today's date: ${today}.\nToday's edges (L10 median vs line): ${JSON.stringify(edges)}\nPlayers mentioned: ${JSON.stringify(found)}`;
      const text = await runResearchAi(`${RESEARCH_INSTRUCTIONS}\n\nData you may use:\n${context}`, history, req.signal);
      return json({ text });
    }
    if (mode === "hedge") {
      // Ticket numbers are computed on the desk (liveHedge.ts); the AI only explains them.
      const ticket = JSON.stringify(body.ticket ?? {}).slice(0, 4000);
      const text = await runResearchAi(RESEARCH_INSTRUCTIONS, [{ role: "user", content:
        `A live bet ticket with model numbers is below. In 3-4 short bullets: which leg is the risk and why (pace, minutes, gap to line), whether to hedge now, wait, or let it ride, and the hedge size if hedging. Use only these numbers.\n${ticket}` }], req.signal);
      return json({ text });
    }
    return json({ error: "Unknown request." }, 400);
  } catch (e) {
    if (e instanceof AiGatewayError) {
      const msg = e.status === 402 ? "AI credits are used up. Add credits in Settings → Plans & credits." : e.message;
      return json({ error: msg }, e.status);
    }
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
