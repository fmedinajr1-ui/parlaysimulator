// MLB Live Events Ingest
// Polls MLB Stats API (free, official) for in-progress games, detects new plays,
// and POSTs HMAC-signed events to scout-live-edge. Runs every minute via cron.
//
// Event types emitted (match scout-speed/relevance.ts vocabulary):
//   STRIKEOUT, WALK, HIT, HOME_RUN, RBI, RUN_SCORED, STOLEN_BASE, PITCHER_PULLED

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

      const ok = await postEvent({
        sport: "MLB",
        game_id: gameId,
        event_time: eventTime,
        event_type: cls.type,
        player_name: cls.player,
        team: cls.team,
        play_id: playId,
        source: "mlb-statsapi",
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