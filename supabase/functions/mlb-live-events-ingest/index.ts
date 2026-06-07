// MLB Live Events Ingest
// Polls MLB Stats API (free, official) for in-progress games, detects new plays,
// and POSTs HMAC-signed events to scout-live-edge. Runs every minute via cron.
//
// Event types emitted (match scout-speed/relevance.ts vocabulary):
//   STRIKEOUT, WALK, HIT, HOME_RUN, RBI, RUN_SCORED, STOLEN_BASE, PITCHER_PULLED

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { BaseState, basesFromBools, applyTransition, type GameState, type Tier1Event } from "../_shared/mlb-fair-price/state.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("LIVE_EVENT_WEBHOOK_SECRET");

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function hmacSign(body: string): Promise<string> {
  if (!WEBHOOK_SECRET) return "";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const hex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `sha256=${hex}`;
}

async function postEvent(event: Record<string, unknown>): Promise<boolean> {
  const body = JSON.stringify(event);
  const sig = await hmacSign(body);
  const res = await fetch(`${SUPABASE_URL}/functions/v1/scout-live-edge`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SERVICE_KEY}`,
      "apikey": SERVICE_KEY,
      ...(sig ? { "x-webhook-signature": sig } : {}),
    },
    body,
  });
  if (!res.ok) {
    const txt = await res.text();
    console.error(`[mlb-ingest] scout-live-edge ${res.status}: ${txt}`);
    return false;
  }
  await res.text();
  return true;
}

type EventType =
  | "STRIKEOUT" | "WALK" | "HIT" | "HOME_RUN" | "RBI"
  | "RUN_SCORED" | "STOLEN_BASE" | "PITCHER_PULLED";

// Reconstruct the pre-event GameState from an MLB feed play.
// We use play.matchup's pre-play base occupancy (preOnFirst/Second/Third)
// when available; otherwise we walk the runners' origin bases.
function preStateFromPlay(play: any, feedTs: number): GameState | null {
  const inning = Number(play?.about?.inning);
  const halfStr = play?.about?.halfInning;
  if (!Number.isFinite(inning) || (halfStr !== "top" && halfStr !== "bottom")) return null;
  const battingTeam = halfStr === "top" ? "away" : "home";

  // play.count.outs in MLB feed is outs AT START of plate appearance (pre-play).
  const preOuts = Math.max(0, Math.min(2, Number(play?.count?.outs ?? 0))) as 0 | 1 | 2;

  // Pre-play base occupancy: derive from runners' originBase.
  let b1 = false, b2 = false, b3 = false;
  for (const r of play?.runners ?? []) {
    const origin = r?.movement?.originBase;
    if (origin === "1B") b1 = true;
    else if (origin === "2B") b2 = true;
    else if (origin === "3B") b3 = true;
  }
  const bases = basesFromBools(b1, b2, b3);

  // scoreDiff BEFORE this play: use awayScore/homeScore on play.result (post)
  // and subtract this play's run contribution.
  const postHome = Number(play?.result?.homeScore ?? 0);
  const postAway = Number(play?.result?.awayScore ?? 0);
  let runs = 0;
  for (const r of play?.runners ?? []) {
    if (r?.movement?.end === "score") runs++;
  }
  const preHome = battingTeam === "home" ? postHome - runs : postHome;
  const preAway = battingTeam === "away" ? postAway - runs : postAway;

  return {
    inning,
    half: halfStr,
    outs: preOuts,
    bases,
    scoreDiff: preHome - preAway,
    battingTeam,
    feedTs,
    batterId: play?.matchup?.batter?.id ? String(play.matchup.batter.id) : null,
    pitcherId: play?.matchup?.pitcher?.id ? String(play.matchup.pitcher.id) : null,
  };
}

const TIER1_MAP: Record<string, Tier1Event | undefined> = {
  STRIKEOUT: "STRIKEOUT",
  WALK: "WALK",
  HOME_RUN: "HOME_RUN",
};

function fairPriceMetaFor(play: any, eventType: EventType, feedTs: number) {
  const t1 = TIER1_MAP[eventType];
  if (!t1) return null;
  const pre = preStateFromPlay(play, feedTs);
  if (!pre) return null;
  const post = applyTransition(pre, t1);
  return { tier: 1 as const, pre_state: pre, post_state: post, feed_ts: feedTs };
}

function classifyPlay(play: any): { type: EventType; player: string | null; team: string | null } | null {
  const eventType = (play?.result?.eventType ?? "").toLowerCase();
  const event = (play?.result?.event ?? "").toLowerCase();
  const batter = play?.matchup?.batter?.fullName ?? null;
  const teamSide = play?.about?.halfInning === "top" ? "away" : "home";

  if (eventType.includes("strikeout") || event.includes("strikeout")) {
    return { type: "STRIKEOUT", player: play?.matchup?.pitcher?.fullName ?? null, team: teamSide };
  }
  if (eventType === "walk" || event === "walk") {
    return { type: "WALK", player: batter, team: teamSide };
  }
  if (eventType === "home_run" || event === "home run") {
    return { type: "HOME_RUN", player: batter, team: teamSide };
  }
  if (eventType === "stolen_base_2b" || eventType === "stolen_base_3b" || eventType === "stolen_base_home" || event.startsWith("stolen base")) {
    return { type: "STOLEN_BASE", player: play?.runners?.[0]?.details?.runner?.fullName ?? null, team: teamSide };
  }
  if (["single", "double", "triple"].includes(eventType) || ["single", "double", "triple"].includes(event)) {
    return { type: "HIT", player: batter, team: teamSide };
  }
  return null;
}

function isPitchingChange(play: any): boolean {
  const t = (play?.result?.eventType ?? play?.result?.event ?? "").toLowerCase();
  return t.includes("pitching_substitution") || t.includes("pitching substitution");
}

async function processGame(gamePk: number): Promise<{ posted: number; skipped: number }> {
  let posted = 0, skipped = 0;
  try {
    const feedRes = await fetch(`https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`);
    if (!feedRes.ok) { await feedRes.text(); return { posted, skipped }; }
    const feed = await feedRes.json();
    const status = feed?.gameData?.status?.abstractGameState;
    if (status !== "Live") return { posted, skipped };

    const plays: any[] = feed?.liveData?.plays?.allPlays ?? [];
    const gameId = `mlb_${gamePk}`;

    // Dedup against already-ingested events for this game in last 6h.
    const sinceIso = new Date(Date.now() - 6 * 3600_000).toISOString();
    const { data: existing } = await supabase
      .from("live_events")
      .select("raw_data")
      .eq("game_id", gameId)
      .gte("event_time", sinceIso);
    const seen = new Set<string>((existing ?? []).map((r: any) => r?.raw_data?.play_id).filter(Boolean));

    for (const play of plays) {
      if (!play?.about?.isComplete) continue;
      const playId = `${gamePk}_${play?.about?.atBatIndex}_${play?.about?.playEndTime ?? play?.about?.endTime ?? ""}`;
      if (seen.has(playId)) { skipped++; continue; }
      const eventTime = play?.about?.endTime ?? play?.about?.startTime ?? new Date().toISOString();

      // Pitching change
      if (isPitchingChange(play)) {
        const ok = await postEvent({
          sport: "MLB",
          game_id: gameId,
          event_time: eventTime,
          event_type: "PITCHER_PULLED",
          player_name: play?.matchup?.pitcher?.fullName ?? null,
          team: play?.about?.halfInning === "top" ? "home" : "away",
          play_id: playId,
          source: "mlb-statsapi",
        });
        if (ok) posted++;
        continue;
      }

      const cls = classifyPlay(play);
      if (!cls) continue;

      const feedTs = Date.now();
      const fpMeta = fairPriceMetaFor(play, cls.type, feedTs);

      const ok = await postEvent({
        sport: "MLB",
        game_id: gameId,
        event_time: eventTime,
        event_type: cls.type,
        player_name: cls.player,
        team: cls.team,
        play_id: playId,
        source: "mlb-statsapi",
        fair_price: fpMeta,
      });
      if (ok) posted++;

      // RBI / RUN_SCORED side-effects
      const rbis = play?.result?.rbi ?? 0;
      if (rbis > 0 && cls.type !== "HOME_RUN") {
        await postEvent({
          sport: "MLB",
          game_id: gameId,
          event_time: eventTime,
          event_type: "RBI",
          player_name: cls.player,
          team: cls.team,
          play_id: `${playId}_rbi`,
          source: "mlb-statsapi",
        });
        posted++;
      }
      const runners = play?.runners ?? [];
      for (const r of runners) {
        if (r?.movement?.end === "score") {
          await postEvent({
            sport: "MLB",
            game_id: gameId,
            event_time: eventTime,
            event_type: "RUN_SCORED",
            player_name: r?.details?.runner?.fullName ?? null,
            team: cls.team,
            play_id: `${playId}_run_${r?.details?.runner?.id ?? ""}`,
            source: "mlb-statsapi",
          });
          posted++;
        }
      }
    }
  } catch (e) {
    console.error(`[mlb-ingest] processGame ${gamePk} failed`, e);
  }
  return { posted, skipped };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const today = new Date().toISOString().slice(0, 10);
    const schedRes = await fetch(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${today}`);
    if (!schedRes.ok) {
      await schedRes.text();
      return json({ error: "schedule fetch failed", status: schedRes.status }, 502);
    }
    const sched = await schedRes.json();
    const games: any[] = sched?.dates?.[0]?.games ?? [];
    const live = games.filter((g) => g?.status?.abstractGameState === "Live");

    let totalPosted = 0, totalSkipped = 0;
    for (const g of live) {
      const { posted, skipped } = await processGame(g.gamePk);
      totalPosted += posted;
      totalSkipped += skipped;
    }
    return json({ ok: true, live_games: live.length, posted: totalPosted, skipped: totalSkipped });
  } catch (e) {
    console.error("[mlb-ingest] fatal", e);
    return json({ error: String(e) }, 500);
  }
});