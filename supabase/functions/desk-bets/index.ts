// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3";
import { minutesAccuracy, MINUTES_FORECAST_VERSION, V6_MODEL_VERSION } from "../_shared/research/minutesValidation.ts";
import { skepticalHistory, verifiedSkepticalMarket } from "../_shared/research/skeptical.ts";
import { skepticalFinal } from "../_shared/research/skepticalFinal.ts";
import { syncBotFromShelf } from "../_shared/research/botSync.ts";
import { noVig, paceFatigue, sharpStructure, type GameInput, type TeamGame } from "../_shared/research/gameModels.ts";

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
  z.object({ action: z.literal("game_board"), passcode: z.string() }),
  z.object({ action: z.literal("log_picks"), passcode: z.string(), picks: z.array(z.object({
    game_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), player_name: z.string().min(1).max(80),
    stat: z.string().max(20), side: z.enum(["over", "under"]), line: z.number(), odds: z.number().int().nullable(),
    projection: z.number().nullable(), win_prob: z.number().nullable(), ev: z.number().nullable(),
    opponent: z.string().max(60).nullable(), this_season: z.number().int().nullable(),
    reasons: z.array(z.any()).max(20), rank: z.number().int(), model_version: z.string().max(20),
  })).max(100) }),
  z.object({ action: z.literal("pick_record"), passcode: z.string() }),
  z.object({ action: z.literal("bot_record"), passcode: z.string() }),
  z.object({ action: z.literal("skeptical_record"), passcode: z.string(), model_version: z.string().max(30) }),
  z.object({ action: z.literal("log_skeptical_review"), passcode: z.string(), picks: z.array(z.unknown()).min(1).max(1000) }),
  z.object({ action: z.literal("log_skeptical_picks"), passcode: z.string(), picks: z.array(z.object({
    game_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), player_name: z.string().min(1).max(80),
    stat: z.enum(["points", "rebounds", "assists", "threes_made", "pra"]), side: z.enum(["over", "under"]),
    line: z.number().min(0).max(200), odds: z.number().int().nullable(), projection: z.number().min(0),
    win_prob: z.number().min(0).max(1), hits_l10: z.number().int().min(0).max(10), games_l10: z.number().int().min(1).max(10),
    warnings: z.array(z.string().max(300)).min(1).max(5), trend: z.enum(["hot", "cold", "flat"]),
    model_version: z.string().min(1).max(30), rank: z.number().int().positive(),
  })).max(1000) }),
  z.object({ action: z.literal("log_bot_picks"), passcode: z.string(), picks: z.array(z.object({
    game_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), player_name: z.string().min(1).max(80),
    stat: z.string().max(20), side: z.enum(["over", "under"]), line: z.number(), odds: z.number().int().refine((o) => Math.abs(o) >= 100),
    projection: z.number().nullable(), win_prob: z.number().nullable(), ev: z.number().nullable(),
    opponent: z.string().max(60).nullable(), model_version: z.string().max(30), strategy_version: z.string().max(30),
    rank: z.number().int().min(1).max(3), warning_count: z.number().int().min(1).max(5),
    warnings: z.array(z.string().max(300)).min(1).max(5), risk_score: z.number().int().min(0).max(100),
    stake_units: z.number().positive().max(1.5),
  })).max(3) }),
  z.object({ action: z.literal("minutes_record"), passcode: z.string() }),
  z.object({ action: z.literal("log_minutes"), passcode: z.string(), forecasts: z.array(z.object({
    game_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), player_name: z.string().min(1).max(80),
    team: z.string().min(1).max(80), projected_minutes: z.number().positive().max(48), baseline_minutes: z.number().positive().max(60),
  })).max(600) }),
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
  const day = etDay(new Date());
  if (b.action === "game_board") return json(await gameBoard(sb, day));
  if (b.action === "skeptical_record") {
    const { data, error } = await sb.from("research_skeptical_picks").select("*")
      .eq("model_version", b.model_version).order("game_date", { ascending: false }).order("rank").limit(10000);
    const { data: reviews, error: reviewError } = await sb.from("research_skeptical_reviews").select("*")
      .eq("model_version", b.model_version).order("game_date", { ascending: false }).order("rank").limit(10000);
    const { data: roster } = await sb.from("research_player_teams").select("player_name,team").limit(5000);
    const teams = new Map<string, string>((roster ?? []).map((r: any) => [r.player_name.toLowerCase(), r.team]));
    const withTeams = (rows: any[] | null) => (rows ?? []).map(row => ({ ...row, team: teams.get(row.player_name.toLowerCase()) ?? null }));
    return error || reviewError ? json({ error: error?.message ?? reviewError?.message }, 500) : json({ picks: withTeams(data), reviews: withTeams(reviews) });
  }
  if (b.action === "log_skeptical_review") {
    const validated = Body.safeParse({ ...b, action: "log_skeptical_picks" });
    if (!validated.success || validated.data.action !== "log_skeptical_picks") return json({ error: "Invalid shelf review" }, 400);
    const rows = [], unmatched = [];
    for (const date of [...new Set(validated.data.picks.map(p => p.game_date))]) {
      const board = await getJson(`${ESPN}/scoreboard?dates=${date.replaceAll("-", "")}`);
      const summaries = await Promise.all((board.events ?? []).filter((e: any) => e.status?.type?.completed)
        .map(async (e: any) => ({ event: e, summary: await getJson(`${ESPN}/summary?event=${e.id}`) })));
      for (const pick of validated.data.picks.filter(p=>p.game_date===date)) {
        let found = false;
        for (const {event, summary} of summaries) {
          const result = skepticalFinal(pick, summary);
          if (!result) continue;
          rows.push({...pick,...result,event_id:event.id,event_label:event.name,result_source:`ESPN final box score ${event.id}`});
          found = true; break;
        }
        if (!found) {
          unmatched.push(pick.player_name);
          rows.push({...pick,status:"open",result_value:null,result_source:"No matching final ESPN athlete row; result unverified"});
        }
      }
    }
    const {data,error} = await sb.from("research_skeptical_reviews").upsert(rows, {
      onConflict:"game_date,player_name,stat,side,model_version",ignoreDuplicates:true,
    }).select("id,status");
    return error ? json({error:error.message},500) : json({saved:data?.length ?? 0,unmatched});
  }
  if (b.action === "log_skeptical_picks") {
    const board = await getJson(`${ESPN}/scoreboard?dates=${day.replaceAll("-", "")}`).catch(() => null);
    if (!board) return json({ error: "Cannot verify pregame status" }, 503);
    const [{ data: roster, error: rosterError }, { data: lines, error: lineError }] = await Promise.all([
      sb.from("research_player_teams").select("player_name,team"),
      sb.from("research_prop_lines").select("player_name,stat,line,event_label,over_price,under_price").eq("game_date", day).limit(10000),
    ]);
    if (rosterError || lineError) return json({ error: "Cannot verify current roster or lines" }, 500);
    const teams = new Map<string, string>((roster ?? []).map((r: any) => [r.player_name.toLowerCase(), r.team]));
    const rows = [], rejected = [];
    for (const p of b.picks) {
      const market = verifiedSkepticalMarket(p, day, teams.get(p.player_name.toLowerCase()), board.events ?? [], lines ?? [], Date.now());
      if (!market) { rejected.push({ player_name: p.player_name, stat: p.stat, reason: "Game started or market unverified" }); continue; }
      const { data: history, error } = await sb.from("nba_player_game_logs")
        .select("player_name,game_date,minutes_played,points,rebounds,assists,threes_made,opponent")
        .ilike("player_name", p.player_name).lt("game_date", day).gt("minutes_played", 0)
        .order("game_date", { ascending: false }).limit(10);
      if (error) return json({ error: error.message }, 500);
      const actual = skepticalHistory(history ?? [], day, p.stat, p.side, p.line);
      if (!actual.games_l10 || actual.hits_l10 !== p.hits_l10 || actual.games_l10 !== p.games_l10) {
        rejected.push({ player_name: p.player_name, stat: p.stat, reason: "Last-10 data does not match the shelf" }); continue;
      }
      rows.push({ ...p, ...market, ...actual });
    }
    if (!rows.length) return json({ saved: 0, rejected, bot: await syncBotFromShelf(sb, day) });
    // Immutable first pregame snapshot, including the exact line used for its L10 record.
    const { data, error } = await sb.from("research_skeptical_picks").upsert(rows, {
      onConflict: "game_date,player_name,stat,side,model_version", ignoreDuplicates: true,
    }).select("id");
    return error ? json({ error: error.message }, 500) : json({ saved: data?.length ?? 0, rejected, bot: await syncBotFromShelf(sb, day) });
  }
  if (b.action === "minutes_record") {
    const { data, error } = await sb.from("research_minutes_log").select("game_date,projected_minutes,actual_minutes,status")
      .eq("forecast_version", MINUTES_FORECAST_VERSION).order("game_date", { ascending: false }).limit(10000);
    return error ? json({ error: error.message }, 500) : json({ accuracy: minutesAccuracy(data ?? []) });
  }
  if (b.action === "log_minutes" || b.action === "log_picks" || b.action === "log_bot_picks") {
    // Never call an after-tip snapshot pregame. Use the scoreboard, not a guessed cutoff.
    const board = await getJson(`${ESPN}/scoreboard?dates=${day.replaceAll("-", "")}`).catch(() => null);
    if (!board) return json({ error: "Cannot verify pregame status" }, 503);
    const preTeams = new Set<string>();
    for (const ev of board.events ?? []) {
      if (ev.status?.type?.state !== "pre" || !(new Date(ev.date).getTime() > Date.now())) continue;
      for (const c of ev.competitions?.[0]?.competitors ?? []) preTeams.add(c.team?.displayName);
    }
    if (b.action === "log_minutes") {
      const forecasts = b.forecasts.filter((f) => f.game_date === day && preTeams.has(f.team))
        .map((f) => ({ ...f, forecast_version: MINUTES_FORECAST_VERSION }));
      const { error } = await sb.from("research_minutes_log").upsert(forecasts, { onConflict: "game_date,player_name,forecast_version", ignoreDuplicates: true });
      return error ? json({ error: error.message }, 500) : json({ logged: forecasts.length });
    }
    const { data: roster, error: rosterError } = await sb.from("research_player_teams").select("player_name,team");
    if (rosterError) return json({ error: rosterError.message }, 500);
    const teams = new Map((roster ?? []).map((r) => [r.player_name, r.team]));
    if (b.picks.some((p) => p.model_version === "v6-projected-minutes" || p.model_version === V6_MODEL_VERSION)) {
      const { data, error } = await sb.from("research_minutes_log").select("game_date,projected_minutes,actual_minutes,status").eq("forecast_version", MINUTES_FORECAST_VERSION).limit(10000);
      if (error || !minutesAccuracy(data ?? []).ready) return json({ error: "Minutes accuracy is not confirmed" }, 409);
    }
    b.picks = b.picks.filter((p) => p.game_date === day && preTeams.has(teams.get(p.player_name) ?? ""));
  }
  if (b.action === "log_bot_picks") {
    return json({ ok: true, ...await syncBotFromShelf(sb, day) });
  }
  if (b.action === "log_picks") {
    // First snapshot of the day wins, so the record reflects the pick before tip-off.
    const { error } = await sb.from("research_pick_log").upsert(b.picks, { onConflict: "game_date,player_name,stat,side,model_version", ignoreDuplicates: true });
    return error ? json({ error: error.message }, 500) : json({ ok: true, logged: b.picks.length });
  }
  if (b.action === "pick_record") {
    const { data, error } = await sb.from("research_pick_log").select("game_date,player_name,stat,side,line,projection,win_prob,model_version,status,ev,odds,logged_at").limit(10000);
    if (error) return json({ error: error.message }, 500);
    return json({ picks: data });
  }
  if (b.action === "bot_record") {
    const { data, error } = await sb.from("research_bot_picks").select("*").order("game_date", { ascending: false }).limit(10000);
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

/** Tonight's totals and moneylines with both of last year's methods side by side. */
async function gameBoard(sb: any, day: string) {
  const key = Deno.env.get("THE_ODDS_API_KEY");
  if (!key) return { error: "Odds key missing", games: [] };
  const res = await fetch(`https://api.the-odds-api.com/v4/sports/basketball_nba/odds?apiKey=${key}&regions=us,eu&markets=h2h,spreads,totals&bookmakers=pinnacle,fanduel,draftkings&oddsFormat=american`);
  if (!res.ok) return { error: `Odds service ${res.status}`, games: [] };
  const events = ((await res.json()) as any[]).filter((e) => etDay(new Date(e.commence_time)) === day);
  const { data: roster } = await sb.from("research_player_teams").select("player_name,team");
  const teamOf = new Map<string, string>((roster ?? []).map((r: any) => [r.player_name, r.team]));
  const logs: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await sb.from("nba_player_game_logs").select("id,player_name,game_date,opponent,is_home,points,minutes_played,field_goals_attempted,free_throws_attempted,offensive_rebounds,turnovers")
      .gte("game_date", "2026-10-01").lt("game_date", day).order("game_date").order("player_name").order("id").range(from, from + 999);
    logs.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const agg = new Map<string, { team: string; date: string; opp: string; home: boolean; pts: number; poss: number; minutes: number }>();
  for (const l of logs) {
    const team = teamOf.get(l.player_name); if (!team) continue;
    const k = `${team}|${l.game_date}`;
    const a = agg.get(k) ?? { team, date: l.game_date, opp: l.opponent, home: !!l.is_home, pts: 0, poss: 0, minutes: 0 };
    a.pts += l.points ?? 0; a.minutes += l.minutes_played ?? 0;
    a.poss += (l.field_goals_attempted ?? 0) + 0.44 * (l.free_throws_attempted ?? 0) - (l.offensive_rebounds ?? 0) + (l.turnovers ?? 0);
    agg.set(k, a);
  }
  const byTeam = new Map<string, TeamGame[]>();
  for (const a of agg.values()) {
    const opp = agg.get(`${a.opp}|${a.date}`);
    if (!opp || a.minutes < 200) continue;
    const list = byTeam.get(a.team) ?? [];
    list.push({ date: a.date, pts: a.pts, oppPts: opp.pts, poss: (a.poss + opp.poss) / 2, minutes: a.minutes, home: a.home });
    byTeam.set(a.team, list);
  }
  const alias = (n: string) => (n === "Los Angeles Clippers" ? "LA Clippers" : n);
  const games = events.map((e) => {
    const rec = (e.bookmakers ?? []).filter((bk: any) => bk.key !== "pinnacle");
    const pin = (e.bookmakers ?? []).find((bk: any) => bk.key === "pinnacle");
    const mk = (bk: any, m: string) => bk?.markets?.find((x: any) => x.key === m)?.outcomes ?? [];
    const best = (m: string, name: string, point?: number) => {
      let out: { odds: number; book: string } | null = null;
      for (const bk of rec) for (const o of mk(bk, m)) if (o.name === name && (point == null || o.point === point) && (!out || o.price > out.odds)) out = { odds: o.price, book: bk.title };
      return out;
    };
    const totals = rec.flatMap((bk: any) => mk(bk, "totals").filter((o: any) => o.name === "Over").map((o: any) => o.point));
    const total = totals.length ? totals.sort((a: number, b: number) => a - b)[Math.floor(totals.length / 2)] : null;
    const spread = rec.flatMap((bk: any) => mk(bk, "spreads").filter((o: any) => o.name === e.home_team).map((o: any) => o.point))[0] ?? null;
    // Sharp fair price: Pinnacle, otherwise the average no-vig of the US books.
    const fair = (bks: any[]) => {
      const hw: number[] = [], ov: number[] = []; let tot: number | null = null;
      for (const bk of bks) {
        const h = mk(bk, "h2h"); const hh = h.find((o: any) => o.name === e.home_team), aa = h.find((o: any) => o.name === e.away_team);
        if (hh && aa) hw.push(noVig(hh.price, aa.price));
        const t = mk(bk, "totals"); const o = t.find((x: any) => x.name === "Over"), u = t.find((x: any) => x.name === "Under");
        if (o && u && (total == null || o.point === total || pin === bk)) { ov.push(noVig(o.price, u.price)); tot = o.point; }
      }
      const m = (v: number[]) => (v.length ? v.reduce((s, n) => s + n, 0) / v.length : null);
      return { homeWin: m(hw), over: m(ov), total: tot };
    };
    const sharp = pin ? { source: "Pinnacle", ...fair([pin]) } : { source: "US book average (no Pinnacle)", ...fair(rec) };
    const g: GameInput = {
      date: day, home: e.home_team, away: e.away_team, start: e.commence_time,
      homeGames: byTeam.get(alias(e.home_team)) ?? [], awayGames: byTeam.get(alias(e.away_team)) ?? [],
      total, over: total == null ? null : best("totals", "Over", total), under: total == null ? null : best("totals", "Under", total),
      homeSpread: spread, homeML: best("h2h", e.home_team), awayML: best("h2h", e.away_team), sharp,
    };
    return { home: g.home, away: g.away, start: g.start, total, homeSpread: spread, homeML: g.homeML, awayML: g.awayML, paceFatigue: paceFatigue(g), sharpStructure: sharpStructure(g) };
  });
  return { day, games };
}
