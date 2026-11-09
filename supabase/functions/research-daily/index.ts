// deno-lint-ignore-file no-explicit-any
// Once-a-day NBA research job: box scores (ESPN) -> injuries (ESPN) -> prop lines (The Odds API) -> AI top plays.
import { createClient } from "npm:@supabase/supabase-js@2";
import { etDateKey, etDateKeyDaysAgo } from "../_shared/date-et.ts";
import { slateEdges, saveReport } from "../_shared/research/context.ts";
import { runResearchAi, AiGatewayError, RESEARCH_INSTRUCTIONS } from "../_shared/research/ai.ts";
import { gradeMinutes } from "../_shared/research/gradeMinutes.ts";
import { snapshotMinutes } from "../_shared/research/minutesPipeline.ts";
import { gradeResearchPick } from "../_shared/research/grading.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const ESPN = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const JOB = "research-daily";

async function getJson(url: string) {
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36", Accept: "application/json" } });
  if (!r.ok) throw new Error(`${r.status} ${url.split("?")[0]}`);
  return r.json();
}

async function syncBoxScores(sb: any, date: string) {
  const sb_ = await getJson(`${ESPN}/scoreboard?dates=${date.replaceAll("-", "")}`);
  const finals = (sb_.events ?? []).filter((e: any) => e.status?.type?.completed);
  const rows: any[] = [];
  for (const ev of finals) {
    const sum = await getJson(`${ESPN}/summary?event=${ev.id}`);
    const comps = sum.header?.competitions?.[0]?.competitors ?? [];
    for (const team of sum.boxscore?.players ?? []) {
      const me = comps.find((c: any) => c.team?.id === team.team?.id);
      const opp = comps.find((c: any) => c.team?.id !== team.team?.id);
      const st = team.statistics?.[0];
      if (!st) continue;
      const idx = (k: string) => st.keys.indexOf(k);
      for (const a of st.athletes ?? []) {
        if (a.didNotPlay || !a.stats?.length) continue;
        const v = (k: string) => Number(a.stats[idx(k)]) || 0;
        const pair = (k: string) => (a.stats[idx(k)] ?? "0-0").split("-").map((x: string) => Number(x) || 0);
        const [fgm, fga] = pair("fieldGoalsMade-fieldGoalsAttempted");
        const [tpm, tpa] = pair("threePointFieldGoalsMade-threePointFieldGoalsAttempted");
        const [ftm, fta] = pair("freeThrowsMade-freeThrowsAttempted");
        rows.push({
          player_name: a.athlete.displayName, game_date: date, opponent: opp?.team?.displayName ?? null,
          minutes_played: v("minutes"), points: v("points"), rebounds: v("rebounds"), assists: v("assists"),
          threes_made: tpm, threes_attempted: tpa, blocks: v("blocks"), steals: v("steals"), turnovers: v("turnovers"),
          field_goals_made: fgm, field_goals_attempted: fga, free_throws_made: ftm, free_throws_attempted: fta,
          offensive_rebounds: v("offensiveRebounds"), defensive_rebounds: v("defensiveRebounds"),
          is_home: me?.homeAway === "home", is_starter: !!a.starter,
        });
      }
    }
  }
  if (rows.length) {
    const { error } = await sb.from("nba_player_game_logs").upsert(rows, { onConflict: "player_name,game_date" });
    if (error) throw error;
  }
  return { games: finals.length, players: rows.length };
}

async function syncInjuries(sb: any, today: string) {
  const d = await getJson(`${ESPN}/injuries`);
  const rows: any[] = [];
  for (const t of d.injuries ?? []) for (const i of t.injuries ?? []) {
    rows.push({ team_name: t.displayName, player_name: i.athlete?.displayName, status: i.status,
      injury_type: i.details?.type ?? null, impact_level: i.status === "Out" ? "high" : "medium",
      affects_rotation: i.status === "Out", game_date: today, updated_at: new Date().toISOString() });
  }
  const valid = rows.filter((r) => r.player_name);
  if (valid.length) {
    await sb.from("nba_injury_reports").delete().eq("game_date", today);
    const { error } = await sb.from("nba_injury_reports").insert(valid);
    if (error) throw error;
  }
  return { injuries: valid.length };
}

/** Current rosters from ESPN for all 30 teams — the source of truth for who plays where. */
async function syncRosters(sb: any) {
  const t = await getJson(`${ESPN}/teams`);
  const teams = t.sports?.[0]?.leagues?.[0]?.teams?.map((x: any) => x.team) ?? [];
  const rows: any[] = [];
  for (const tm of teams) {
    const r = await getJson(`${ESPN}/teams/${tm.id}/roster`);
    for (const a of r.athletes ?? []) {
      if (!a.displayName) continue;
      rows.push({ player_name: a.displayName, team: tm.displayName, team_abbr: tm.abbreviation,
        position: a.position?.abbreviation ?? null, espn_id: String(a.id), updated_at: new Date().toISOString() });
    }
  }
  if (rows.length < 300) throw new Error(`roster scan too small (${rows.length}), not saved`);
  const dedup = [...new Map(rows.map((r) => [r.player_name, r])).values()];
  await sb.from("research_player_teams").delete().neq("player_name", "");
  const { error } = await sb.from("research_player_teams").insert(dedup);
  if (error) throw error;
  return { teams: teams.length, players: dedup.length };
}

const MARKETS: Record<string, string> = {
  player_points: "points", player_rebounds: "rebounds", player_assists: "assists",
  player_threes: "threes_made", player_points_rebounds_assists: "pra",
};

async function syncLines(sb: any, today: string) {
  const key = Deno.env.get("THE_ODDS_API_KEY") || Deno.env.get("ODDS_API_KEY");
  if (!key) return { lines: 0, skipped: "no odds key" };
  const evRes = await fetch(`https://api.the-odds-api.com/v4/sports/basketball_nba/events?apiKey=${key}`);
  if (!evRes.ok) return { lines: 0, skipped: `odds key rejected (${evRes.status})` };
  const events = (await evRes.json()).filter((e: any) => etDateKey(new Date(e.commence_time)) === today).slice(0, 15);
  const { data: rost } = await sb.from("research_player_teams").select("player_name,team");
  const teamOf = new Map((rost ?? []).map((r: any) => [r.player_name.toLowerCase(), r.team]));
  const mismatched = new Set<string>();
  const rows: any[] = [];
  for (const e of events) {
    const r = await fetch(`https://api.the-odds-api.com/v4/sports/basketball_nba/events/${e.id}/odds?apiKey=${key}&regions=us&markets=${Object.keys(MARKETS).join(",")}&bookmakers=fanduel,draftkings&oddsFormat=american`);
    if (!r.ok) continue;
    const j = await r.json();
    for (const bk of j.bookmakers ?? []) for (const m of bk.markets ?? []) {
      const pairs = new Map<string, any>();
      for (const o of m.outcomes ?? []) {
        const k = `${o.description}|${o.point}`;
        const p = pairs.get(k) ?? { player_name: o.description, line: o.point };
        if (o.name === "Over") p.over_price = o.price; else p.under_price = o.price;
        pairs.set(k, p);
      }
      for (const p of pairs.values()) {
        if (p.line == null) continue;
        const tm = teamOf.get(String(p.player_name).toLowerCase());
        if (tm && tm !== e.home_team && tm !== e.away_team) { mismatched.add(`${p.player_name} (${tm}) in ${e.away_team} @ ${e.home_team}`); continue; }
        rows.push({ ...p, game_date: today, stat: MARKETS[m.key], book: bk.key, event_label: `${e.away_team} @ ${e.home_team}`, updated_at: new Date().toISOString() });
      }
    }
  }
  const dedup = [...new Map(rows.map((r) => [`${r.player_name}|${r.stat}|${r.book}`, r])).values()];
  if (dedup.length) await sb.from("research_prop_lines").upsert(dedup, { onConflict: "player_name,game_date,stat,book" });
  return { lines: dedup.length, events: events.length, wrongTeamSkipped: [...mismatched] };
}

/** Grades logged real bets from box scores: won / lost / push, or void when the player didn't play. */
async function gradeRealBets(sb: any, today: string) {
  const { data: open } = await sb.from("research_real_bets").select("*").eq("status", "open").lt("game_date", today).limit(1000);
  let graded = 0, waiting = 0;
  for (const b of open ?? []) {
    const { data: g } = await sb.from("nba_player_game_logs").select("minutes_played,points,rebounds,assists,threes_made")
      .ilike("player_name", b.player_name).eq("game_date", b.game_date).maybeSingle();
    if (!g) { waiting++; continue; }
    const { status, result_value } = gradeResearchPick(b, g);
    await sb.from("research_real_bets").update({ status, result_value, settled_at: new Date().toISOString() }).eq("id", b.id);
    graded++;
  }
  return { graded, waiting };
}

/** Grades yesterday's (and older) logged desk picks against box scores, same rules as real bets. */
async function gradePickLog(sb: any, today: string) {
  const { data: open } = await sb.from("research_pick_log").select("*").eq("status", "open").lt("game_date", today).limit(2000);
  let graded = 0, waiting = 0;
  for (const b of open ?? []) {
    const { data: g } = await sb.from("nba_player_game_logs").select("minutes_played,points,rebounds,assists,threes_made")
      .ilike("player_name", b.player_name).eq("game_date", b.game_date).maybeSingle();
    if (!g) {
      // No box score 3+ days later = didn't play.
      if (b.game_date < etDateKeyDaysAgo(3, new Date())) { await sb.from("research_pick_log").update({ status: "void", settled_at: new Date().toISOString() }).eq("id", b.id); graded++; }
      else waiting++;
      continue;
    }
    const { status, result_value } = gradeResearchPick(b, g);
    await sb.from("research_pick_log").update({ status, result_value, settled_at: new Date().toISOString() }).eq("id", b.id);
    graded++;
  }
  return { graded, waiting };
}

/** Grades the separate Oversight Bot ledger with the same box-score rules. */
async function gradeBotPicks(sb: any, today: string) {
  const { data: open } = await sb.from("research_bot_picks").select("*").eq("status", "open").lt("game_date", today).limit(2000);
  let graded = 0, waiting = 0;
  for (const b of open ?? []) {
    const { data: g } = await sb.from("nba_player_game_logs").select("minutes_played,points,rebounds,assists,threes_made")
      .ilike("player_name", b.player_name).eq("game_date", b.game_date).maybeSingle();
    if (!g) {
      if (b.game_date < etDateKeyDaysAgo(3, new Date())) {
        await sb.from("research_bot_picks").update({ status: "void", settled_at: new Date().toISOString() }).eq("id", b.id);
        graded++;
      } else waiting++;
      continue;
    }
    const { status, result_value } = gradeResearchPick(b, g);
    await sb.from("research_bot_picks").update({ status, result_value, settled_at: new Date().toISOString() }).eq("id", b.id);
    graded++;
  }
  return { graded, waiting };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const now = new Date();
  const { data: st } = await sb.from("research_job_state").select("*").eq("job", JOB).maybeSingle();
  if (st?.locked_until && new Date(st.locked_until) > now) {
    return new Response(JSON.stringify({ skipped: "already running" }), { headers: { ...cors, "Content-Type": "application/json" } });
  }
  await sb.from("research_job_state").upsert({ job: JOB, locked_until: new Date(now.getTime() + 10 * 60_000).toISOString() });

  const today = etDateKey(now);
  const report: any = { date: today };
  const step = async (name: string, fn: () => Promise<any>) => {
    try { report[name] = await fn(); } catch (e) { report[name] = { error: String((e as Error).message ?? e) }; }
  };
  const body = await req.json().catch(() => ({}));
  const only = new URL(req.url).searchParams.get("only") ?? body?.only;
  if (only === "backfill" && body?.from && body?.to) {
    // Fill in box scores for a date range (YYYY-MM-DD, inclusive), e.g. missed days early in the season.
    for (let d = new Date(`${body.from}T12:00:00Z`); d <= new Date(`${body.to}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
      const key = d.toISOString().slice(0, 10);
      await step(key, () => syncBoxScores(sb, key));
    }
    await sb.from("research_job_state").upsert({ job: JOB, locked_until: null });
    return new Response(JSON.stringify(report), { headers: { ...cors, "Content-Type": "application/json" } });
  }
  if (only === "grade") {
    await step("gradeRealBets", () => gradeRealBets(sb, today));
    await step("gradePickLog", () => gradePickLog(sb, today));
    await step("gradeBotPicks", () => gradeBotPicks(sb, today));
    await step("gradeMinutes", () => gradeMinutes(sb, today));
    await sb.from("research_job_state").upsert({ job: JOB, locked_until: null });
    return new Response(JSON.stringify(report), { headers: { ...cors, "Content-Type": "application/json" } });
  }
  if (only === "minutes") {
    await step("gradeMinutes", () => gradeMinutes(sb, today));
    await step("minutesForecasts", () => snapshotMinutes(sb, today));
    await sb.from("research_job_state").upsert({ job: JOB, locked_until: null });
    return new Response(JSON.stringify(report), { headers: { ...cors, "Content-Type": "application/json" } });
  }
  if (only === "rosters") {
    await step("rosters", () => syncRosters(sb));
    await sb.from("research_job_state").upsert({ job: JOB, locked_until: null });
    return new Response(JSON.stringify(report), { headers: { ...cors, "Content-Type": "application/json" } });
  }
  await step("rosters", () => syncRosters(sb));
  // Last 3 days, so a missed run never leaves a gap in this season's games.
  for (const n of [3, 2, 1]) await step(`boxScores_${n}d`, () => syncBoxScores(sb, etDateKeyDaysAgo(n, now)));
  await step("gradeRealBets", () => gradeRealBets(sb, today));
  await step("gradePickLog", () => gradePickLog(sb, today));
  await step("gradeMinutes", () => gradeMinutes(sb, today));
  await step("injuries", () => syncInjuries(sb, today));
  await step("lines", () => syncLines(sb, today));
  await step("minutesForecasts", () => snapshotMinutes(sb, today));

  let paused = st?.paused_reason ?? null;
  // Paused by AI credits/policy: one probe per daily run only.
  await step("ai", async () => {
    const edges = (await slateEdges(sb, today)).slice(0, 25);
    if (!edges.length) return { skipped: "no prop lines for today" };
    try {
      const text = await runResearchAi(RESEARCH_INSTRUCTIONS, [{
        role: "user",
        content: `Today's slate (${today}). Pick the 5 best plays from these edges and give one short reason each, plus one play to avoid. Data:\n${JSON.stringify(edges)}`,
      }]);
      await saveReport(sb, "top_plays", null, null, today, text);
      paused = null;
      return { ok: true, edges: edges.length };
    } catch (e) {
      if (e instanceof AiGatewayError && (e.status === 402 || e.status === 403)) paused = `${e.status}: ${e.message}`;
      throw e;
    }
  });

  await sb.from("research_job_state").upsert({ job: JOB, locked_until: null, paused_reason: paused, last_run_at: new Date().toISOString(), last_report: report });
  return new Response(JSON.stringify(report), { headers: { ...cors, "Content-Type": "application/json" } });
});
