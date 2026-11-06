// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

const Bet = z.object({
  player_name: z.string().min(1).max(80),
  stat: z.enum(["points", "rebounds", "assists", "threes_made", "pra"]),
  side: z.enum(["over", "under"]),
  line: z.number().min(0).max(200),
  odds: z.number().int().refine((o) => Math.abs(o) >= 100 && Math.abs(o) <= 100000),
  stake: z.number().positive().max(1_000_000),
  book: z.string().max(40).nullable().optional(),
  game_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  placed_at: z.string().optional(),
  parlay_id: z.string().uuid().nullable().optional(),
  parlay_odds: z.number().int().nullable().optional(),
});
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list"), passcode: z.string() }),
  z.object({ action: z.literal("add"), passcode: z.string(), bets: z.array(Bet).min(1).max(200) }),
  z.object({ action: z.literal("delete"), passcode: z.string(), id: z.string().uuid() }),
  z.object({ action: z.literal("live"), passcode: z.string() }),
  z.object({ action: z.literal("log_picks"), passcode: z.string(), picks: z.array(z.object({
    game_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), player_name: z.string().min(1).max(80),
    stat: z.string().max(20), side: z.enum(["over", "under"]), line: z.number(), odds: z.number().int().nullable(),
    projection: z.number().nullable(), win_prob: z.number().nullable(), ev: z.number().nullable(),
    opponent: z.string().max(60).nullable(), this_season: z.number().int().nullable(),
    reasons: z.array(z.any()).max(20), rank: z.number().int(), model_version: z.string().max(20),
  })).max(100) }),
  z.object({ action: z.literal("pick_record"), passcode: z.string() }),
]);

const ESPN = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const etDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
const getJson = async (u: string) => { const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } }); if (!r.ok) throw new Error(String(r.status)); return r.json(); };
const val = (s: any, stat: string) => stat === "pra" ? s.points + s.rebounds + s.assists : s[stat] ?? 0;

/** Live stats for open bets' games (ESPN), and grades legs whose game just went final. Runs only while the page is open. */
async function liveUpdate(sb: any) {
  const { data: open } = await sb.from("research_real_bets").select("*").eq("status", "open").gte("game_date", etDay(new Date(Date.now() - 86400000)));
  if (!open?.length) return {};
  const players = new Map<string, any>();
  for (const date of [...new Set(open.map((o: any) => o.game_date))] as string[]) {
    const board = await getJson(`${ESPN}/scoreboard?dates=${date.replaceAll("-", "")}`).catch(() => null);
    for (const ev of board?.events ?? []) {
      const t = ev.status?.type;
      if (t?.state === "pre") continue;
      const sum = await getJson(`${ESPN}/summary?event=${ev.id}`).catch(() => null);
      for (const team of sum?.boxscore?.players ?? []) {
        const st = team.statistics?.[0]; if (!st) continue;
        const i = (k: string) => st.keys.indexOf(k);
        for (const a of st.athletes ?? []) {
          const n = (k: string) => Number(a.stats?.[i(k)]) || 0;
          const tpm = Number(String(a.stats?.[i("threePointFieldGoalsMade-threePointFieldGoalsAttempted")] ?? "0").split("-")[0]) || 0;
          players.set(`${date}|${a.athlete.displayName.toLowerCase()}`, {
            points: n("points"), rebounds: n("rebounds"), assists: n("assists"), threes_made: tpm, minutes: n("minutes"),
            didNotPlay: !!a.didNotPlay, final: !!t?.completed, clock: t?.shortDetail ?? "",
            period: Number(ev.status?.period) || 0, clockSec: Number(ev.status?.clock) || 0,
          });
        }
      }
    }
  }
  const out: Record<string, unknown> = {};
  for (const b of open) {
    const p = players.get(`${b.game_date}|${b.player_name.toLowerCase()}`);
    if (!p) continue;
    const v = val(p, b.stat);
    out[b.id] = { value: v, minutes: p.minutes, clock: p.clock, final: p.final, period: p.period, clockSec: p.clockSec };
    if (p.final) {
      const line = Number(b.line);
      const status = p.didNotPlay || !(p.minutes > 0) ? "void" : v === line ? "push" : (b.side === "over" ? v > line : v < line) ? "won" : "lost";
      await sb.from("research_real_bets").update({ status, result_value: v, settled_at: new Date().toISOString() }).eq("id", b.id);
    }
  }
  return out;
}

/** Private bet log for the desk; every call must carry the desk passcode. */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);
  const b = parsed.data;
  const expected = Deno.env.get("DESK_PASSCODE") ?? "";
  if (!expected || b.passcode !== expected) {
    await new Promise((r) => setTimeout(r, 800));
    return json({ error: "Wrong passcode" }, 401);
  }
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  if (b.action === "log_picks") {
    // First snapshot of the day wins, so the record reflects the pick before tip-off.
    const { error } = await sb.from("research_pick_log").upsert(b.picks, { onConflict: "game_date,player_name,stat,side,model_version", ignoreDuplicates: true });
    return error ? json({ error: error.message }, 500) : json({ ok: true, logged: b.picks.length });
  }
  if (b.action === "pick_record") {
    const { data, error } = await sb.from("research_pick_log").select("model_version,status,ev,odds").limit(10000);
    if (error) return json({ error: error.message }, 500);
    return json({ picks: data });
  }
  if (b.action === "add") {
    const { error } = await sb.from("research_real_bets").insert(b.bets);
    if (error) return json({ error: error.message }, 500);
  }
  if (b.action === "delete") {
    const { error } = await sb.from("research_real_bets").delete().or(`id.eq.${b.id},parlay_id.eq.${b.id}`);
    if (error) return json({ error: error.message }, 500);
  }
  let live: Record<string, unknown> = {};
  if (b.action === "live") live = await liveUpdate(sb);
  const { data, error } = await sb.from("research_real_bets").select("*").order("placed_at", { ascending: false }).limit(2000);
  if (error) return json({ error: error.message }, 500);
  return json({ bets: data, live });
});
