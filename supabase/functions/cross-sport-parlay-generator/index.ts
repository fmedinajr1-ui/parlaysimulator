/**
 * cross-sport-parlay-generator
 *
 * Bulk-assembles 25 parlays per run from cross_sport_sweet_spots across all sports.
 * Mix: 8 x 2-leg Lock | 8 x 3-leg Strong | 6 x 4-leg Stretch | 3 x 5-leg Lottery.
 * Player-primary: any ticket with leg_count >= 3 must contain >=1 player leg, and
 * team-market legs are capped at 40% of the ticket. Persists into bot_daily_parlays
 * and broadcasts top picks via bot-send-telegram (type: cross_sport_parlay).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Leg = {
  id: string;
  sport: string;
  market_type: string;
  event_id: string;
  game_description: string | null;
  player_name: string | null;
  team: string | null;
  opponent: string | null;
  prop_type: string;
  recommended_side: string;
  recommended_line: number | null;
  price: number;
  safety_score: number;
  tier: string;
  l10_hit_rate: number | null;
  research_notes: string | null;
  commence_time: string | null;
};

const SLOTS = [
  { name: "lock_2", count: 8, legs: 2, tiers: ["lock"], minSports: 1, requireTeamLeg: false },
  { name: "strong_3", count: 8, legs: 3, tiers: ["lock", "strong"], minSports: 2, requireTeamLeg: false },
  { name: "stretch_4", count: 6, legs: 4, tiers: ["lock", "strong"], minSports: 2, requireTeamLeg: true },
  { name: "lottery_5", count: 3, legs: 5, tiers: ["lock", "strong", "lean"], minSports: 2, requireTeamLeg: true },
];

function decimal(american: number): number {
  return american >= 0 ? 1 + american / 100 : 1 + 100 / -american;
}
function americanFromDecimal(d: number): number {
  return d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1));
}
function todayET() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }))
    .toISOString().slice(0, 10);
}
function gameKey(l: Leg) { return l.event_id; }
function legFp(l: Leg) {
  return `${l.event_id}|${l.market_type}|${l.prop_type}|${l.player_name ?? l.team ?? ""}|${l.recommended_side}`;
}
function comboHash(legs: Leg[]) {
  return legs.map(legFp).sort().join("##");
}
function geomean(xs: number[]) {
  const log = xs.reduce((a, b) => a + Math.log(Math.max(b, 1e-6)), 0) / xs.length;
  return Math.exp(log);
}

function violates(legs: Leg[]): string | null {
  const games = new Set(legs.map(gameKey));
  if (games.size < Math.min(2, legs.length)) return "single_game_stack";
  // ≤1 team leg per game
  const teamLegsByGame = new Map<string, number>();
  for (const l of legs) {
    if (l.market_type !== "player") {
      teamLegsByGame.set(gameKey(l), (teamLegsByGame.get(gameKey(l)) ?? 0) + 1);
    }
  }
  for (const c of teamLegsByGame.values()) if (c > 1) return "multiple_team_legs_same_game";
  // ≤1 prop per player per ticket — prevents redundant correlated misses
  // (e.g. same batter Hits + Singles + Total Bases all riding on one at-bat).
  const playerCounts = new Map<string, number>();
  for (const l of legs) {
    if (l.market_type === "player" && l.player_name) {
      const k = l.player_name.toLowerCase();
      playerCounts.set(k, (playerCounts.get(k) ?? 0) + 1);
    }
  }
  for (const c of playerCounts.values()) if (c > 1) return "multiple_props_same_player";
  // player-primary: legs>=3 needs >=1 player
  const playerLegs = legs.filter(l => l.market_type === "player").length;
  if (legs.length >= 3 && playerLegs < 1) return "no_player_leg";
  // team legs <= 40% of ticket
  const teamLegs = legs.length - playerLegs;
  if (teamLegs / legs.length > 0.40 + 1e-9 && legs.length >= 3) return "team_legs_over_40pct";
  // no duplicate player or duplicate game-side
  const seen = new Set<string>();
  for (const l of legs) {
    const k = legFp(l);
    if (seen.has(k)) return "duplicate_leg";
    seen.add(k);
  }
  return null;
}

function pickLabel(l: Leg): string {
  if (l.market_type === "player") {
    return `${l.player_name} ${prettyProp(l.prop_type)} ${l.recommended_side} ${l.recommended_line ?? ""}`.trim();
  }
  if (l.market_type === "total") {
    return `${gameTitle(l)} Total ${l.recommended_side} ${l.recommended_line ?? ""}`.trim();
  }
  if (l.market_type === "spread") {
    return `${l.team} Spread ${l.recommended_line ?? ""} (vs ${l.opponent})`.trim();
  }
  return `${l.team} ML (vs ${l.opponent})`;
}
function gameTitle(l: Leg): string {
  return l.game_description ?? `${l.team ?? ""} vs ${l.opponent ?? ""}`;
}
function prettyProp(p: string): string {
  return p.replace(/^batter_|^pitcher_|^player_/, "").replace(/_/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
}
function sportEmoji(s: string) {
  if (s.includes("mlb")) return "⚾";
  if (s.includes("nhl")) return "🏒";
  if (s.includes("nba")) return "🏀";
  if (s.includes("ncaab")) return "🏀";
  if (s.includes("ncaaf") || s.includes("football")) return "🏈";
  return "🎯";
}

function buildSlot(pool: Leg[], slot: typeof SLOTS[number], used: Set<string>): { legs: Leg[]; score: number } | null {
  // candidates ranked by safety desc
  const filtered = pool.filter(l => slot.tiers.includes(l.tier))
    .sort((a, b) => b.safety_score - a.safety_score);
  const teamPoolSize = filtered.filter(l => l.market_type !== "player").length;
  // Soft floor: only enforce the team-leg requirement when the pool actually has
  // ≥3 team candidates. Otherwise (rare slates) fall back to player-only.
  const enforceTeamFloor = slot.requireTeamLeg && teamPoolSize >= 3;
  // greedy diversified selection
  const tried = new Set<string>();
  for (let attempt = 0; attempt < 80; attempt++) {
    const picked: Leg[] = [];
    const gamesUsed = new Set<string>();
    const sportsUsed = new Set<string>();
    // Seed one team leg first when the floor is enforced, so greedy player-sort
    // doesn't crowd out the team requirement. Rotate seed across attempts.
    if (enforceTeamFloor) {
      const teamCands = filtered.filter(l => l.market_type !== "player");
      if (teamCands.length > 0) {
        const seed = teamCands[attempt % teamCands.length];
        picked.push(seed);
        gamesUsed.add(gameKey(seed));
        sportsUsed.add(seed.sport);
      }
    }
    for (const cand of filtered) {
      if (picked.length >= slot.legs) break;
      if (picked.some(p => legFp(p) === legFp(cand))) continue;
      if (gamesUsed.has(gameKey(cand)) && cand.market_type !== "player") continue;
      // allow up to 2 player legs same game, but stop after 2
      if (cand.market_type === "player") {
        const sg = picked.filter(p => p.event_id === cand.event_id && p.market_type === "player").length;
        if (sg >= 2) continue;
      }
      // skip with rotating offset to diversify across attempts
      if (attempt > 0 && Math.random() < 0.15) continue;
      picked.push(cand);
      gamesUsed.add(gameKey(cand));
      sportsUsed.add(cand.sport);
    }
    if (picked.length < slot.legs) continue;
    if (sportsUsed.size < slot.minSports) continue;
    if (enforceTeamFloor && picked.every(l => l.market_type === "player")) continue;
    const reason = violates(picked);
    if (reason) continue;
    const hash = comboHash(picked);
    if (used.has(hash) || tried.has(hash)) { tried.add(hash); continue; }
    used.add(hash);
    const score = geomean(picked.map(l => l.safety_score));
    return { legs: picked, score };
  }
  return null;
}

async function broadcast(supabase: ReturnType<typeof createClient>, parlays: Array<{ slotName: string; legs: Leg[]; score: number; american: number }>) {
  const top = parlays.slice(0, 5);
  if (top.length === 0) return;
  const lines: string[] = [
    "🔥 *Cross-Sport Parlay Drop* 🔥",
    `_${todayET()} — ${parlays.length} tickets generated, top 5 below_`,
    "",
  ];
  for (const p of top) {
    lines.push(`*${slotEmoji(p.slotName)} ${slotTitle(p.slotName)}* — ${p.american > 0 ? "+" : ""}${p.american} (safety ${Math.round(p.score * 100)})`);
    for (const l of p.legs) {
      lines.push(`  ${sportEmoji(l.sport)} ${pickLabel(l)}`);
    }
    lines.push("");
  }
  await supabase.functions.invoke("bot-send-telegram", {
    body: {
      type: "cross_sport_parlay",
      message: lines.join("\n"),
      parse_mode: "Markdown",
    },
  });
}

function slotEmoji(name: string) {
  if (name.startsWith("lock")) return "🔒";
  if (name.startsWith("strong")) return "💪";
  if (name.startsWith("stretch")) return "📈";
  return "🎰";
}
function slotTitle(name: string) {
  if (name === "lock_2") return "Lock 2-Leg";
  if (name === "strong_3") return "Strong 3-Leg";
  if (name === "stretch_4") return "Stretch 4-Leg";
  return "Lottery 5-Leg";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const dryRun = url.searchParams.get("dry") === "1";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const date = todayET();
    const { data, error } = await supabase
      .from("cross_sport_sweet_spots")
      .select("*")
      .eq("analysis_date", date)
      .eq("is_active", true);
    if (error) throw error;
    const rawPool = (data ?? []) as Leg[];
    // Belt-and-suspenders: drop any leg whose game has started (or starts within 15 min)
    const cutoffMs = Date.now() + 15 * 60_000;
    const staleDrops: Leg[] = [];
    const pool = rawPool.filter(l => {
      if (!l.commence_time) return true;
      if (new Date(l.commence_time).getTime() < cutoffMs) { staleDrops.push(l); return false; }
      return true;
    });
    if (staleDrops.length > 0) {
      console.warn(`[cross-sport-generator] dropped ${staleDrops.length} stale legs at runtime`);
      await supabase.functions.invoke("bot-send-telegram", {
        body: { type: "cross_sport_parlay", admin_only: true,
          message: `⚠️ Cross-Sport Generator: ${staleDrops.length} stale legs filtered at runtime (sweet-spots SQL filter should have caught these). Investigate upstream.` },
      });
    }
    if (pool.length === 0) {
      await supabase.functions.invoke("bot-send-telegram", {
        body: { type: "cross_sport_parlay", admin_only: true,
          message: `⚠️ Cross-Sport Parlay Generator: 0 candidates for ${date} (after stale filter: ${staleDrops.length} dropped). Check upstream sync.` },
      });
      return new Response(JSON.stringify({ ok: true, date, generated: 0, reason: "empty_pool" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const used = new Set<string>();
    const built: Array<{ slotName: string; legs: Leg[]; score: number; american: number }> = [];
    const sportsInPool = new Set(pool.map(l => l.sport)).size;
    for (const slot of SLOTS) {
      const effectiveMinSports = Math.min(slot.minSports, sportsInPool);
      const slotEff = { ...slot, minSports: effectiveMinSports };
      for (let i = 0; i < slot.count; i++) {
        const r = buildSlot(pool, slotEff, used);
        if (!r) break;
        const dec = r.legs.reduce((a, l) => a * decimal(l.price), 1);
        built.push({ slotName: slot.name, legs: r.legs, score: r.score, american: americanFromDecimal(dec) });
      }
    }

    built.sort((a, b) => b.score - a.score);

    let persisted = 0;
    if (!dryRun) {
      for (const p of built) {
        const legsJson = p.legs.map(l => ({
          sport: l.sport,
          market_type: l.market_type,
          event_id: l.event_id,
          game_description: l.game_description,
          team: l.team,
          opponent: l.opponent,
          player_name: l.player_name,
          prop_type: l.prop_type,
          side: l.recommended_side,
          line: l.recommended_line,
          price: l.price,
          safety_score: l.safety_score,
          tier: l.tier,
          l10_hit_rate: l.l10_hit_rate,
          label: pickLabel(l),
        }));
        const { error: ierr } = await supabase.from("bot_daily_parlays").insert({
          parlay_date: date,
          legs: legsJson,
          leg_count: p.legs.length,
          combined_probability: p.score,
          expected_odds: p.american,
          strategy_name: `cross_sport_${p.slotName}`,
          strategy_version: 1,
          tier: p.slotName.startsWith("lock") ? "lock" : p.slotName.startsWith("strong") ? "strong" : p.slotName.startsWith("stretch") ? "stretch" : "lottery",
          selection_rationale: `cross-sport: ${[...new Set(p.legs.map(l => l.sport))].join(",")} | safety=${p.score.toFixed(3)}`,
        });
        if (!ierr) persisted++;
      }
      await broadcast(supabase, built);
    }

    return new Response(JSON.stringify({
      ok: true, date, generated: built.length, persisted, dryRun,
      by_slot: built.reduce((a, p) => ({ ...a, [p.slotName]: (a[p.slotName] ?? 0) + 1 }), {} as Record<string, number>),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("cross-sport-parlay-generator error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});