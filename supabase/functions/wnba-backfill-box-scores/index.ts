// WNBA box-score backfill via ESPN public endpoints.
// Idempotent: upserts on (espn_event_id, player_name).
// Trigger:
//   POST /functions/v1/wnba-backfill-box-scores
//   body: { "start": "2024-05-14", "end": "2024-10-20", "limit_days": 200 }
// Defaults to the most recent completed WNBA season window.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const ESPN_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard";
const ESPN_SUMMARY    = "https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/summary";

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function fmtYmd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}
function isoDay(d: Date): string { return d.toISOString().slice(0, 10); }
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

function intStat(stats: string[] | undefined, i: number): number | null {
  if (!stats || stats[i] == null) return null;
  const n = Number(stats[i]);
  return Number.isFinite(n) ? n : null;
}
function splitMade(stats: string[] | undefined, i: number): { made: number | null; att: number | null } {
  if (!stats || stats[i] == null) return { made: null, att: null };
  const m = String(stats[i]).match(/^(\d+)-(\d+)$/);
  if (!m) return { made: null, att: null };
  return { made: Number(m[1]), att: Number(m[2]) };
}

async function fetchScoreboardDay(d: Date) {
  const url = `${ESPN_SCOREBOARD}?dates=${fmtYmd(d)}&limit=100`;
  const r = await fetch(url);
  if (!r.ok) return [];
  const j = await r.json();
  return (j.events ?? []) as any[];
}

async function fetchSummary(eventId: string) {
  const url = `${ESPN_SUMMARY}?event=${eventId}`;
  const r = await fetch(url);
  if (!r.ok) return null;
  return await r.json();
}

function parseSeasonType(t: number | undefined): string {
  if (t === 2) return "regular";
  if (t === 3) return "playoff";
  if (t === 1) return "preseason";
  return "other";
}

async function processEvent(ev: any) {
  const eid = String(ev.id);
  const dateIso = ev.date as string;
  const gameStart = new Date(dateIso);
  const gameDateEt = new Date(gameStart.getTime() - 4 * 3600_000).toISOString().slice(0, 10); // approx ET
  const season = ev.season?.year as number | undefined;
  const seasonType = parseSeasonType(ev.season?.type);
  if (seasonType === "preseason") return { rows: 0, skipped: true };

  const status = ev.status?.type?.completed ?? false;
  if (!status) return { rows: 0, incomplete: true };

  const summary = await fetchSummary(eid);
  if (!summary) return { rows: 0, no_summary: true };

  const teams = (summary.boxscore?.players ?? []) as any[];
  if (teams.length !== 2) return { rows: 0, bad_box: true };

  const teamNames: Record<string, string> = {};
  for (const t of teams) {
    teamNames[t.team.id] = t.team.displayName ?? t.team.name ?? "";
  }

  const rows: any[] = [];
  for (const t of teams) {
    const teamId = String(t.team.id);
    const teamName = teamNames[teamId];
    const oppName = Object.entries(teamNames).find(([id]) => id !== teamId)?.[1] ?? "";
    // ESPN exposes `keys` (camelCase) plus `labels`/`names` (short abbreviations
    // like MIN/PTS/3PT). The athlete `stats` array is positionally aligned to
    // labels/names, so we index by those.
    const statBlock = t.statistics?.[0] ?? {};
    const statLabels: string[] = (statBlock.labels ?? statBlock.names ?? []) as string[];
    const players = statBlock.athletes ?? [];
    const idx = (name: string) => statLabels.findIndex((k) => String(k).toUpperCase() === name);
    const iMIN = idx("MIN");
    const iFG  = idx("FG");
    const i3PT = idx("3PT");
    const iFT  = idx("FT");
    const iREB = idx("REB");
    const iAST = idx("AST");
    const iSTL = idx("STL");
    const iBLK = idx("BLK");
    const iTO  = idx("TO");
    const iPTS = idx("PTS");

    for (const a of players) {
      const stats: string[] = a.stats ?? [];
      const didNotPlay = !!a.didNotPlay || stats.length === 0;
      const fg = splitMade(stats, iFG);
      const tp = splitMade(stats, i3PT);
      const ft = splitMade(stats, iFT);
      rows.push({
        espn_event_id: eid,
        espn_athlete_id: String(a.athlete?.id ?? ""),
        player_name: a.athlete?.displayName ?? "",
        team: teamName,
        opponent_team: oppName,
        game_date_et: gameDateEt,
        game_start_ts: dateIso,
        season,
        season_type: seasonType,
        minutes: didNotPlay ? 0 : (intStat(stats, iMIN) ?? 0),
        points: didNotPlay ? 0 : intStat(stats, iPTS),
        rebounds: didNotPlay ? 0 : intStat(stats, iREB),
        assists: didNotPlay ? 0 : intStat(stats, iAST),
        steals: didNotPlay ? 0 : intStat(stats, iSTL),
        blocks: didNotPlay ? 0 : intStat(stats, iBLK),
        turnovers: didNotPlay ? 0 : intStat(stats, iTO),
        threes_made: tp.made,
        threes_att: tp.att,
        fg_made: fg.made,
        fg_att: fg.att,
        ft_made: ft.made,
        ft_att: ft.att,
        did_not_play: didNotPlay,
        updated_at: new Date().toISOString(),
      });
    }
  }

  if (rows.length === 0) return { rows: 0 };
  const { error } = await sb.from("wnba_player_game_logs").upsert(rows, { onConflict: "espn_event_id,player_name" });
  if (error) {
    console.warn(`[wnba-box] upsert error event=${eid}:`, error.message);
    return { rows: 0, error: error.message };
  }
  return { rows: rows.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let body: any = {};
  try { body = await req.json(); } catch { /* allow GET-style */ }

  const start = new Date(body.start ?? "2024-05-14");
  const end   = new Date(body.end   ?? "2024-10-20");
  const limitDays = Number(body.limit_days ?? 200);
  const stopAfterEvents = Number(body.max_events ?? 9999);

  let totalEvents = 0;
  let totalRows = 0;
  let failed = 0;
  const dayCursor = new Date(start);
  let dayCount = 0;

  while (dayCursor <= end && dayCount < limitDays && totalEvents < stopAfterEvents) {
    try {
      const events = await fetchScoreboardDay(dayCursor);
      for (const ev of events) {
        if (totalEvents >= stopAfterEvents) break;
        try {
          const res = await processEvent(ev);
          totalEvents += 1;
          totalRows += (res.rows ?? 0);
          await sleep(150); // ESPN rate-limit politeness
        } catch (e) {
          failed += 1;
          console.warn("[wnba-box] event err", (e as Error).message);
        }
      }
    } catch (e) {
      console.warn(`[wnba-box] scoreboard ${isoDay(dayCursor)} err:`, (e as Error).message);
    }
    dayCursor.setUTCDate(dayCursor.getUTCDate() + 1);
    dayCount += 1;
  }

  return new Response(JSON.stringify({
    ok: true,
    days_scanned: dayCount,
    events_processed: totalEvents,
    rows_upserted: totalRows,
    failed,
    start: isoDay(start),
    end: isoDay(end),
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});