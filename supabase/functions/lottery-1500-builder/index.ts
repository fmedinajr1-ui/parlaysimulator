/**
 * lottery-1500-builder
 *
 * On-demand builder: scans every active sport in unified_props (today + 48h pregame),
 * runs Perplexity sonar-deep-research per sport, composes 5 competing parlays each
 * priced >= +1500, ranks them, and pushes the winner + runners-up to admin Telegram.
 *
 * Trigger:
 *   POST /lottery-1500-builder            -> full run (deep research + build + send)
 *   POST /lottery-1500-builder?dry=1      -> build + rank, skip Telegram
 *   POST /lottery-1500-builder?skip_research=1  -> use empty boost map
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Candidate = {
  key: string;
  sport: string;
  game: string;
  event_id: string;
  market_type: string;
  player_name: string;
  prop_type: string;
  side: "OVER" | "UNDER" | "HOME" | "AWAY";
  line: number | null;
  american: number;
  decimal: number;
  implied: number;
  boost: number;
  safety: number;
  why: string;
  boost_reason?: string;
  matchup_score?: number | null;   // normalized −1..+1 for the alerted side
  matchup_note?: string;            // human-readable cross-ref summary
  blocked_by_matchup?: boolean;     // matchup_intelligence.is_blocked = true
};

type Parlay = {
  variant: string;
  legs: Candidate[];
  decimal: number;
  american: number;
  mean_safety: number;
  min_safety: number;
  research_density: number;
  score: number;
};

function americanToDecimal(odds: number): number {
  if (odds === 0) return 1;
  return odds > 0 ? 1 + odds / 100 : 1 + 100 / Math.abs(odds);
}
function decimalToAmerican(d: number): number {
  if (d <= 1) return 0;
  return d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1));
}
function impliedProb(american: number): number {
  if (american === 0) return 0;
  return american > 0 ? 100 / (american + 100) : Math.abs(american) / (Math.abs(american) + 100);
}
function normSport(s: string): string {
  const x = s.toLowerCase();
  if (x.includes("mlb")) return "MLB";
  if (x.includes("nhl")) return "NHL";
  if (x.includes("wnba")) return "WNBA";
  if (x.includes("nba")) return "NBA";
  if (x.includes("ncaab") || x.includes("basketball_ncaa")) return "NCAAB";
  if (x.includes("ncaaf") || x.includes("football_ncaa")) return "NCAAF";
  if (x.includes("nfl")) return "NFL";
  if (x.includes("tennis")) return "TENNIS";
  if (x.includes("mma")) return "MMA";
  if (x.includes("soccer")) return "SOCCER";
  if (x.includes("golf")) return "GOLF";
  return s.toUpperCase();
}

const SPORT_PROMPTS: Record<string, string> = {
  MLB: "TODAY's MLB slate. Cover: (1) probable starters with ERA<3.50 and matchup history vs opposing lineup, (2) ballpark + weather (wind direction & speed, temp, humidity), (3) confirmed lineup scratches & late lineup news, (4) bullpen fatigue / closer availability, (5) sharp money + steam moves on totals/run-lines, (6) hot hitters on 5+ game streaks, (7) cold pitcher form (last 3 starts). Name specific players and teams.",
  NHL: "TODAY's NHL slate. Cover: (1) confirmed starting goalies + last-5 SV%, (2) injury scratches, (3) line-rush changes & power-play units, (4) sharp money on totals/puck-lines, (5) back-to-back fatigue, (6) any hot scorer streak. Be specific with names.",
  NBA: "TONIGHT's NBA. Cover: (1) confirmed scratches & load management, (2) starting lineup changes, (3) sharp money on player props (PTS/REB/AST/3PM), (4) pace-up matchups, (5) revenge/letdown spots, (6) referee tendencies. Specific names.",
  WNBA: "TONIGHT's WNBA. Cover: (1) confirmed injuries/scratches, (2) starting lineup, (3) sharp money on totals/spreads/player props, (4) pace mismatches, (5) hot scorer streaks.",
  NCAAB: "TODAY's NCAA men's basketball. Cover: (1) injured/suspended starters, (2) tempo mismatches (top-50 pace vs bottom-50), (3) reverse line movement on spreads/totals, (4) letdown/revenge spots, (5) home court advantage outliers.",
  NCAAF: "TODAY's NCAA football. Cover: (1) weather affecting totals (wind 15+, rain, cold), (2) starting QB injuries, (3) sharp money on spreads/totals, (4) letdown/revenge spots, (5) lookahead games.",
  NFL: "TODAY's NFL. Cover: (1) weather (wind, precip, cold), (2) QB & skill-position injuries (incl. inactives), (3) sharp money on spreads/totals/player props, (4) primetime/letdown spots, (5) divisional dynamics.",
  TENNIS: "TODAY's ATP/WTA matches. Cover: (1) surface form (clay/hard/grass last 10), (2) recent retirements/walkovers, (3) head-to-head history, (4) sharp money on moneylines/sets/games totals, (5) travel/altitude factors.",
  MMA: "TODAY's MMA card. Cover: (1) weight-cut issues / missed weight, (2) late replacements & short notice, (3) sharp money on moneylines/method/round totals, (4) reach/style matchup edges, (5) camp changes.",
  SOCCER: "TODAY's soccer matches. Cover: (1) confirmed lineups & key injuries/suspensions, (2) rotation risk for cup competitions, (3) sharp money on totals/BTTS/spreads, (4) home/away form splits, (5) European competition fatigue.",
  GOLF: "TODAY/THIS WEEK's PGA/LIV/DP tour. Cover: (1) weather (wind, rain), (2) withdrawals/MC risk, (3) hot recent form (last 5 events), (4) course history & fit, (5) sharp money on top-5/top-10/top-20 props.",
};

const BOOST_SCHEMA = {
  name: "boosts",
  schema: {
    type: "object",
    properties: {
      summary: { type: "string" },
      team_boosts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            team: { type: "string" },
            side: { type: "string" },
            boost: { type: "number" },
            reason: { type: "string" },
          },
          required: ["team", "boost", "reason"],
        },
      },
      player_boosts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            player: { type: "string" },
            side: { type: "string" },
            boost: { type: "number" },
            reason: { type: "string" },
          },
          required: ["player", "boost", "reason"],
        },
      },
    },
    required: ["summary", "team_boosts", "player_boosts"],
  },
};

async function deepResearch(sport: string, apiKey: string): Promise<{
  summary: string;
  team_boosts: { team: string; side?: string; boost: number; reason: string }[];
  player_boosts: { player: string; side?: string; boost: number; reason: string }[];
}> {
  const prompt = SPORT_PROMPTS[sport];
  if (!prompt) return { summary: "", team_boosts: [], player_boosts: [] };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 420_000); // 7 min — deep-research is slow
    const resp = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: "sonar-deep-research",
        messages: [
          {
            role: "system",
            content: `You are an elite ${sport} betting research analyst with access to live news, injury reports, weather feeds, and sharp money trackers. Be aggressive about flagging fades — losing tickets come from missed bad spots. Return AT LEAST 8 team_boosts and 8 player_boosts when possible (mix positive and negative). Return ONLY strict JSON matching the schema. Cap each boost at +/- 0.10. Boost > 0 favors the named side; boost < 0 fades it.`,
          },
          { role: "user", content: prompt },
        ],
        search_recency_filter: "day",
        max_tokens: 4000,
        response_format: { type: "json_schema", json_schema: BOOST_SCHEMA },
      }),
    });
    clearTimeout(t);
    if (!resp.ok) {
      console.error(`research ${sport}: ${resp.status}`);
      return { summary: "", team_boosts: [], player_boosts: [] };
    }
    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content ?? "";
    try {
      return JSON.parse(content);
    } catch {
      const m = String(content).match(/\{[\s\S]*\}/);
      if (m) {
        try { return JSON.parse(m[0]); } catch { /* ignore */ }
      }
      return { summary: String(content).slice(0, 400), team_boosts: [], player_boosts: [] };
    }
  } catch (e) {
    console.error(`research ${sport} threw`, e);
    return { summary: "", team_boosts: [], player_boosts: [] };
  }
}

function lookupBoost(
  cand: { player_name: string; game: string; side: string; market_type: string },
  sportBoosts: { team: string; side?: string; boost: number; reason?: string }[] = [],
  playerBoosts: { player: string; side?: string; boost: number; reason?: string }[] = [],
): { boost: number; reason?: string } {
  const pname = cand.player_name.toLowerCase();
  if (cand.market_type === "player") {
    for (const b of playerBoosts) {
      if (pname.includes(b.player.toLowerCase()) || b.player.toLowerCase().includes(pname)) {
        if (!b.side || b.side.toLowerCase() === "any" || b.side.toLowerCase() === cand.side.toLowerCase()) {
          return { boost: Math.max(-0.1, Math.min(0.1, b.boost)), reason: b.reason };
        }
      }
    }
    return { boost: 0 };
  }
  const g = cand.game.toLowerCase();
  for (const b of sportBoosts) {
    const team = b.team.toLowerCase();
    if (g.includes(team)) {
      if (!b.side || b.side.toLowerCase() === "any" || b.side.toLowerCase() === cand.side.toLowerCase()) {
        return { boost: Math.max(-0.1, Math.min(0.1, b.boost)), reason: b.reason };
      }
    }
  }
  return { boost: 0 };
}

type MatchupRow = {
  matchup_score: number | null;
  opponent_defensive_rank: number | null;
  position_defense_rank: number | null;
  position_group: string | null;
  blowout_risk: number | null;
  game_script: string | null;
  is_blocked: boolean | null;
  block_reason: string | null;
  risk_flags: string[] | null;
  confidence_adjustment: number | null;
  opponent_team: string | null;
};

function lookupMatchup(
  player: string,
  prop: string,
  side: string,
  line: number | null,
  map: Map<string, MatchupRow>,
): MatchupRow | null {
  if (!player || !prop) return null;
  const sideKey = side === "OVER" || side === "UNDER" ? side : "ANY";
  const lineKey = line != null ? String(line) : "";
  const exact = map.get(`${player.toLowerCase()}|${prop}|${sideKey}|${lineKey}`);
  if (exact) return exact;
  // Fallback: any row for this player+prop+side (line may differ slightly)
  for (const [k, v] of map) {
    if (k.startsWith(`${player.toLowerCase()}|${prop}|${sideKey}|`)) return v;
  }
  return null;
}

function buildMatchupNote(m: MatchupRow): string {
  const bits: string[] = [];
  if (m.position_defense_rank != null) bits.push(`pos D rk ${m.position_defense_rank}${m.position_group ? `/${m.position_group}` : ""}`);
  else if (m.opponent_defensive_rank != null) bits.push(`D rk ${m.opponent_defensive_rank}`);
  if (m.matchup_score != null) bits.push(`m=${Number(m.matchup_score).toFixed(1)}`);
  if (m.game_script && m.game_script !== "COMPETITIVE") bits.push(`script ${m.game_script}`);
  if (m.blowout_risk != null && Number(m.blowout_risk) >= 0.5) bits.push(`blowout`);
  if (m.risk_flags && m.risk_flags.length) bits.push(m.risk_flags.slice(0, 2).join(","));
  return bits.join(" · ");
}

function rowToCandidates(
  row: any,
  boosts: { team_boosts: any[]; player_boosts: any[] },
  matchupMap: Map<string, MatchupRow>,
): Candidate[] {
  const out: Candidate[] = [];
  const sport = normSport(row.sport);
  const game = String(row.game_description ?? "");
  const mt = String(row.market_type ?? "player");
  const player = String(row.player_name ?? "");
  const prop = String(row.prop_type ?? "");
  const line = row.current_line != null ? Number(row.current_line) : null;

  // Build (side, price) tuples per market type.
  type Tup = { side: Candidate["side"]; american: number };
  const tups: Tup[] = [];
  const op = row.over_price != null ? Number(row.over_price) : null;
  const up = row.under_price != null ? Number(row.under_price) : null;

  if (mt === "player" || mt === "total") {
    if (op != null) tups.push({ side: "OVER", american: op });
    if (up != null) tups.push({ side: "UNDER", american: up });
  } else if (mt === "moneyline" || mt === "spread") {
    // unified_props stores h2h/spreads at the matchup level. over_price = HOME, under_price = AWAY by convention.
    if (op != null) tups.push({ side: "HOME", american: op });
    if (up != null) tups.push({ side: "AWAY", american: up });
  }

  for (const t of tups) {
    if (!Number.isFinite(t.american) || t.american === 0) continue;
    // Gates widened: allow heavier chalk for chalk-stack variants, longer dogs for stretch.
    if (t.american <= -1000 || t.american >= 900) continue;
    // Skip extreme spreads only
    if (mt === "spread" && line != null && Math.abs(line) >= 14) continue;
    // Fade fully-juiced fade alerts (negative research boost) by skipping if boost <= -0.08
    // (handled later, just compute here)
    const dec = americanToDecimal(t.american);
    const imp = impliedProb(t.american);
    const bl = lookupBoost({ player_name: player, game, side: t.side, market_type: mt }, boosts.team_boosts, boosts.player_boosts);
    const boost = bl.boost;
    const composite = row.composite_score != null ? Number(row.composite_score) / 100 : 0;
    const conf = row.confidence != null ? Number(row.confidence) / 100 : 0;

    // Team-matchup cross-reference (player props only; team markets fall through).
    let matchupScore: number | null = null;
    let matchupNote = "";
    let blockedByMatchup = false;
    let matchupAdj = 0;
    if (mt === "player" && player) {
      const m = lookupMatchup(player, prop, t.side, line, matchupMap);
      if (m) {
        if (m.is_blocked) {
          blockedByMatchup = true;
        }
        // matchup_score in DB ranges roughly -6..+6 for the side stored. Normalize to ±1.
        if (m.matchup_score != null) {
          matchupScore = Math.max(-1, Math.min(1, Number(m.matchup_score) / 5));
        }
        matchupNote = buildMatchupNote(m);
        // Safety adjustment: ±7% from normalized matchup, ±5% from confidence_adjustment.
        const ca = m.confidence_adjustment != null ? Math.max(-0.05, Math.min(0.05, Number(m.confidence_adjustment))) : 0;
        matchupAdj = (matchupScore ?? 0) * 0.07 + ca;
        // Hard fade: blowout risk on Over of a counting stat, or risk_flags contains BLOWOUT/FADE.
        if (m.blowout_risk != null && Number(m.blowout_risk) >= 0.7 && t.side === "OVER") {
          matchupAdj -= 0.05;
        }
      }
    }
    if (blockedByMatchup) continue; // skip leg entirely

    // Safety = dejuiced implied + composite/confidence signal + research boost + matchup cross-ref
    const safety = Math.max(0, Math.min(1,
      0.55 * imp + 0.18 * composite + 0.13 * conf + 0.07 + boost + matchupAdj,
    ));
    const why = buildWhy(mt, t.side, line, t.american, boost);
    out.push({
      key: `${row.event_id}|${mt}|${player}|${prop}|${t.side}|${line ?? ""}`,
      sport,
      game,
      event_id: String(row.event_id),
      market_type: mt,
      player_name: player,
      prop_type: prop,
      side: t.side,
      line,
      american: t.american,
      decimal: dec,
      implied: imp,
      boost,
      safety,
      why,
      boost_reason: bl.reason,
      matchup_score: matchupScore,
      matchup_note: matchupNote || undefined,
    });
  }
  return out;
}

function buildWhy(mt: string, side: string, line: number | null, am: number, boost: number): string {
  const sign = am > 0 ? `+${am}` : `${am}`;
  const tag = boost > 0.04 ? " 🔥 research-backed" : boost < -0.04 ? " ⚠️ research-fade" : "";
  if (mt === "player") return `${side} ${line ?? ""} @ ${sign}${tag}`;
  if (mt === "total") return `${side} ${line ?? ""} @ ${sign}${tag}`;
  if (mt === "moneyline") return `${side} ML @ ${sign}${tag}`;
  if (mt === "spread") return `${side} ${line ?? ""} @ ${sign}${tag}`;
  return `${side} @ ${sign}${tag}`;
}

function legLabel(c: Candidate): string {
  if (c.market_type === "player") {
    return `${c.player_name} ${c.side} ${c.line ?? ""} ${prettyProp(c.prop_type)}`.trim();
  }
  if (c.market_type === "total") {
    const teams = c.game.replace(" @ ", " vs ");
    return `${teams} TOTAL ${c.side} ${c.line ?? ""}`;
  }
  if (c.market_type === "moneyline" || c.market_type === "spread") {
    const teams = c.game.split(" @ ");
    const team = c.side === "HOME" ? (teams[1] ?? c.side) : (teams[0] ?? c.side);
    if (c.market_type === "moneyline") return `${team} ML`;
    const ln = (c.side === "AWAY" && c.line != null) ? -c.line : c.line;
    return `${team} ${ln != null && ln > 0 ? "+" : ""}${ln}`;
  }
  return `${c.player_name} ${c.side}`;
}

function prettyProp(p: string): string {
  const map: Record<string, string> = {
    batter_hits: "Hits",
    batter_total_bases: "Total Bases",
    batter_home_runs: "Home Runs",
    batter_rbis: "RBIs",
    batter_runs_scored: "Runs",
    batter_stolen_bases: "Stolen Bases",
    batter_strikeouts: "Strikeouts",
    pitcher_strikeouts: "Strikeouts",
    pitcher_outs: "Outs",
    pitcher_hits_allowed: "Hits Allowed",
    pitcher_walks: "Walks",
    pitcher_earned_runs: "Earned Runs",
    player_points: "Points",
    player_rebounds: "Rebounds",
    player_assists: "Assists",
    player_threes: "3-Pointers",
    player_shots_on_goal: "Shots",
    player_goals: "Goals",
  };
  return map[p] ?? p.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function noConflict(legs: Candidate[], cand: Candidate, maxPerGame = 2): boolean {
  for (const l of legs) {
    if (l.key === cand.key) return false;
    // No duplicate player
    if (cand.market_type === "player" && l.market_type === "player" && l.player_name.toLowerCase() === cand.player_name.toLowerCase()) return false;
    // No opposing team-market legs on same game
    if (l.event_id === cand.event_id && cand.market_type !== "player" && l.market_type !== "player") {
      if (l.market_type === cand.market_type) return false;
    }
  }
  // Concentration cap: at most maxPerGame legs from same event
  const sameGame = legs.filter((l) => l.event_id === cand.event_id).length;
  if (sameGame >= maxPerGame) return false;
  return true;
}

function distinctGames(legs: Candidate[]): number {
  return new Set(legs.map((l) => l.event_id)).size;
}

function buildVariant(
  variant: string,
  pool: Candidate[],
  filter: (c: Candidate) => boolean,
  comparator: (a: Candidate, b: Candidate) => number,
  opts: { minLegs: number; maxLegs: number; minBoosted?: number; maxPerGame?: number },
): Parlay | null {
  const TARGET = 16.0; // +1500
  const filtered = pool.filter(filter).sort(comparator);
  if (filtered.length < opts.minLegs) return null;

  const legs: Candidate[] = [];
  let dec = 1;
  const maxPerGame = opts.maxPerGame ?? 2;

  for (const c of filtered) {
    if (legs.length >= opts.maxLegs) break;
    if (!noConflict(legs, c, maxPerGame)) continue;
    legs.push(c);
    dec *= c.decimal;
    if (dec >= TARGET && legs.length >= opts.minLegs && distinctGames(legs) >= 2) {
      if (opts.minBoosted == null || legs.filter((l) => l.boost >= 0.05).length >= opts.minBoosted) {
        break;
      }
    }
  }
  console.log(`[${variant}] legs=${legs.length} dec=${dec.toFixed(2)} distinct=${distinctGames(legs)}`);
  if (dec < TARGET || legs.length < opts.minLegs || distinctGames(legs) < 2) return null;
  if (opts.minBoosted != null && legs.filter((l) => l.boost >= 0.05).length < opts.minBoosted) return null;

  const safeties = legs.map((l) => l.safety);
  const mean = safeties.reduce((a, b) => a + b, 0) / safeties.length;
  const min = Math.min(...safeties);
  const research_density = legs.filter((l) => l.boost !== 0).length / legs.length;
  const payout_scaled = Math.min(1, Math.log10(dec) / 2);
  const score = 0.50 * mean + 0.25 * min + 0.15 * payout_scaled + 0.10 * research_density;

  return {
    variant,
    legs,
    decimal: dec,
    american: decimalToAmerican(dec),
    mean_safety: mean,
    min_safety: min,
    research_density,
    score,
  };
}

const VARIANT_DRIVERS: Record<string, string> = {
  "Chalk-Stack": "Stacks heavy favorites (-150 to -600). Wins on volume of small-edge legs; vulnerable to a single upset.",
  "Balanced": "Mix of -250 to +160 legs ranked by safety. Best risk/reward when slate has moderate juice.",
  "Player-Primary": "Player props only. Lowest correlation, leans on per-player research + composite scores.",
  "Research-Boosted": "Sorted by deep-research boost first, safety second. Highest 'sharp' density.",
  "Lottery-Stretch": "3–4 longshots (+100 to +700) from different games. Big payout, low hit rate.",
  "Heavy-Chalk-Mega": "20+ deep favorites (-250 to -800). Multiplies tiny edges to reach +1500. Single miss = bust.",
};

function formatParlay(p: Parlay, idx: number, isWinner: boolean): string {
  const head = isWinner
    ? `🏆 *WINNER — ${p.variant}*  +${p.american}`
    : `*#${idx} ${p.variant}*  +${p.american}`;
  const legs = p.legs
    .map((l, i) => `  ${i + 1}. [${l.sport}] ${legLabel(l)}  \`${l.why}\``)
    .join("\n");

  // ── Explainer ──
  // EV estimate: our blended safety vs book payout. Implied = book product.
  const ourProb = p.legs.reduce((a, l) => a * l.safety, 1);
  const bookProb = p.legs.reduce((a, l) => a * l.implied, 1);
  const evPct = (ourProb * p.decimal - 1) * 100;
  const edgePct = (ourProb - bookProb) * 100;

  // Tier drivers: show weighted score breakdown
  const meanC = 0.50 * p.mean_safety;
  const minC = 0.25 * p.min_safety;
  const payoutC = 0.15 * Math.min(1, Math.log10(p.decimal) / 2);
  const researchC = 0.10 * p.research_density;

  const driverNote = VARIANT_DRIVERS[p.variant] ?? "";
  const explainer = [
    `   📊 *EV est:* ${evPct >= 0 ? "+" : ""}${evPct.toFixed(1)}% per $1 · edge vs book ${edgePct >= 0 ? "+" : ""}${edgePct.toFixed(2)}pp`,
    `   🧪 *Our prob:* ${(ourProb * 100).toFixed(2)}% · *Book implied:* ${(bookProb * 100).toFixed(2)}% · *Payout:* ${p.decimal.toFixed(1)}x`,
    `   🏷️ *Tier drivers:* mean=${meanC.toFixed(2)} min=${minC.toFixed(2)} payout=${payoutC.toFixed(2)} research=${researchC.toFixed(2)} → score *${p.score.toFixed(3)}*`,
    `   🎯 *Strategy:* ${driverNote}`,
    `   🛡 Avg safety ${(p.mean_safety * 100).toFixed(0)}% · Min ${(p.min_safety * 100).toFixed(0)}% · Research-tagged ${(p.research_density * 100).toFixed(0)}%`,
  ].join("\n");

  // Research factors actually applied to legs
  const researchLegs = p.legs.filter((l) => l.boost !== 0);
  let researchBlock = "";
  if (researchLegs.length > 0) {
    const shown = researchLegs.slice(0, 8);
    const lines = shown.map((l) => {
      const sign = l.boost > 0 ? "🔥" : "⚠️";
      const tag = l.boost > 0 ? "back" : "fade";
      const reason = (l.boost_reason ?? "research signal").replace(/\s+/g, " ").trim().slice(0, 140);
      const name = l.market_type === "player" ? l.player_name : l.game;
      return `     ${sign} *${name}* (${tag} ${(l.boost * 100).toFixed(0)}bp) — ${reason}`;
    }).join("\n");
    const more = researchLegs.length > shown.length ? `\n     …+${researchLegs.length - shown.length} more research-tagged legs` : "";
    researchBlock = `\n   🔬 *Research factors used:*\n${lines}${more}`;
  } else {
    researchBlock = `\n   🔬 *Research factors used:* none — built from price + composite/confidence only`;
  }

  return `${head}\n${legs}\n${explainer}${researchBlock}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST" && req.method !== "GET") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const started = Date.now();
  const url = new URL(req.url);
  const dry = url.searchParams.get("dry") === "1";
  const skipResearch = url.searchParams.get("skip_research") === "1";
  const async_ = url.searchParams.get("async") !== "0";  // default async

  if (async_) {
    // Fire-and-forget: return immediately, do the work in background.
    // @ts-ignore EdgeRuntime is a Supabase runtime global
    EdgeRuntime.waitUntil(runLottery({ dry, skipResearch, started }).catch((e) => {
      console.error("background runLottery failed", e);
    }));
    return new Response(JSON.stringify({
      ok: true, status: "started", dry, skip_research: skipResearch,
      note: "Building in background. Telegram will fire when complete.",
    }), { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Synchronous mode (for testing)
  try {
    const result = await runLottery({ dry, skipResearch, started });
    return new Response(JSON.stringify(result), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("lottery-1500-builder error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function runLottery(opts: { dry: boolean; skipResearch: boolean; started: number }): Promise<any> {
  const { dry, skipResearch, started } = opts;
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");

    // 1) Pull active pool (next 48h pregame), paginated
    const rows: any[] = [];
    const pageSize = 1000;
    for (let from = 0; from < 20000; from += pageSize) {
      const { data: page, error } = await supabase
        .from("unified_props")
        .select("event_id, sport, game_description, commence_time, player_name, prop_type, current_line, over_price, under_price, market_type, composite_score, confidence")
        .eq("is_active", true)
        .gt("commence_time", new Date(Date.now() + 15 * 60_000).toISOString())
        .lt("commence_time", new Date(Date.now() + 48 * 3600_000).toISOString())
        .range(from, from + pageSize - 1);
      if (error) throw new Error(`unified_props query failed: ${error.message}`);
      if (!page || page.length === 0) break;
      rows.push(...page);
      if (page.length < pageSize) break;
    }

    const sportsSet = new Set<string>((rows ?? []).map((r) => normSport(r.sport)));
    const sports = [...sportsSet];
    console.log(`pool: ${rows?.length ?? 0} rows · sports: ${sports.join(",")}`);

    // 2) Deep research per sport (sequential — sonar-deep-research is slow)
    const research: Record<string, { team_boosts: any[]; player_boosts: any[] }> = {};
    if (!skipResearch && PERPLEXITY_API_KEY) {
      for (const sport of sports) {
        console.log(`deep-research → ${sport}`);
        const r = await deepResearch(sport, PERPLEXITY_API_KEY);
        research[sport] = { team_boosts: r.team_boosts ?? [], player_boosts: r.player_boosts ?? [] };
        try {
          await supabase.from("bot_research_findings").insert({
            research_date: new Date().toISOString().slice(0, 10),
            category: `lottery_${sport.toLowerCase()}`,
            title: `${sport} lottery deep research`,
            summary: r.summary ?? "",
            key_insights: r,
            sources: [],
            relevance_score: 0.8,
            actionable: true,
          });
        } catch (e) {
          console.error("research insert failed", e);
        }
      }
    }

    // 3) Build candidate pool
    const pool: Candidate[] = [];
    for (const r of rows ?? []) {
      const sport = normSport(r.sport);
      const b = research[sport] ?? { team_boosts: [], player_boosts: [] };
      const cs = rowToCandidates(r, b);
      pool.push(...cs);
    }
    console.log(`candidate pool: ${pool.length}`);

    // 4) Build 5 variants
    const variants: (Parlay | null)[] = [];

    // V1 Chalk-Stack: all heavy chalk (any -EV side), pick highest safety first,
    // accept up to 15 legs to reach +1500 even when avg juice is -500.
    variants.push(buildVariant(
      "Chalk-Stack",
      pool,
    (c) => c.american <= -150 && c.american >= -600 && c.boost > -0.05,
      (a, b) => b.safety - a.safety,
      { minLegs: 5, maxLegs: 18 },
    ));

    // V2 Balanced: mix of -200..+150, sort by safety, room for 8 legs.
    variants.push(buildVariant(
      "Balanced",
      pool,
      (c) => c.american >= -250 && c.american <= 160,
      (a, b) => b.safety - a.safety,
      { minLegs: 4, maxLegs: 9 },
    ));

    // V3 Player-Primary: only player props, room for 10 legs.
    variants.push(buildVariant(
      "Player-Primary",
      pool.filter((c) => c.market_type === "player"),
      (c) => c.american >= -300 && c.american <= 200,
      (a, b) => b.safety - a.safety,
      { minLegs: 4, maxLegs: 10 },
    ));

    // V4 Research-Boosted: sort by boost+safety; if no boosts (skip_research) this
    // degrades to plain safety sort and may collide with Balanced — acceptable.
    variants.push(buildVariant(
      "Research-Boosted",
      pool,
      (c) => c.american >= -300 && c.american <= 250,
      (a, b) => (b.boost - a.boost) || (b.safety - a.safety),
      { minLegs: 4, maxLegs: 10 },
    ));

    // V5 Lottery-Stretch: 3 legs, dog-friendly, sort by price (longest legs first)
    variants.push(buildVariant(
      "Lottery-Stretch",
      pool,
    (c) => c.american >= 100 && c.american <= 700 && c.boost > -0.05,
      (a, b) => b.decimal - a.decimal || b.safety - a.safety,
      { minLegs: 3, maxLegs: 4, maxPerGame: 1 },
    ));

    // V6 Heavy-Chalk-Mega: stack 20+ deep favorites (-300 to -800) to reach +1500.
    // Demanded by user: "create one parlay with as many -400s as needed."
    variants.push(buildVariant(
      "Heavy-Chalk-Mega",
      pool,
      (c) => c.american <= -250 && c.american >= -800 && c.boost > -0.05,
      (a, b) => b.safety - a.safety,
      { minLegs: 8, maxLegs: 30, maxPerGame: 3 },
    ));

    const built = variants.filter((v): v is Parlay => v != null);
    built.sort((a, b) => b.score - a.score);

    console.log(`variants built: ${built.length}/${variants.length}`);
    if (built.length === 0) {
      const msg = `⚠️ *Lottery +1500 run failed*\n\nNo parlays could be built that reach +1500.\nPool: ${pool.length} candidates across ${sports.length} sports.\nTry again once more lines are posted.`;
      if (!dry) await sendTelegram(msg);
      return { ok: false, reason: "no_parlays", pool: pool.length, sports };
    }

    // 5) Persist + 6) Telegram
    const parlay_date = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }))
      .toISOString().slice(0, 10);
    const records = built.map((p, i) => ({
      parlay_date,
      legs: p.legs.map((l) => ({
        sport: l.sport,
        event_id: l.event_id,
        market_type: l.market_type,
        player_name: l.player_name,
        prop_type: l.prop_type,
        side: l.side,
        line: l.line,
        american: l.american,
        decimal: l.decimal,
        game_description: l.game,
        boost: l.boost,
        safety: l.safety,
        label: legLabel(l),
      })),
      leg_count: p.legs.length,
      combined_probability: p.legs.reduce((a, l) => a * l.implied, 1),
      expected_odds: p.american,
      strategy_name: `lottery_1500_v${i + 1}_${p.variant.toLowerCase().replace(/[^a-z]/g, "_")}`,
      strategy_version: 1,
      tier: i === 0 ? "winner" : "runner_up",
      selection_rationale: `Lottery +1500 ${p.variant} · score=${p.score.toFixed(3)} · mean_safety=${(p.mean_safety * 100).toFixed(0)}%`,
      is_simulated: true,
      simulated_stake: 50,
      approval_status: "auto_approved",
    }));
    try {
      const { error: insErr } = await supabase.from("bot_daily_parlays").insert(records);
      if (insErr) console.error("bot_daily_parlays insert", insErr.message);
    } catch (e) {
      console.error("insert threw", e);
    }

    const header = `🎰 *LOTTERY +1500 DROP*\n_${sports.length} sports · ${pool.length} candidates · ${built.length} parlays built_\n`;
    const body = built.map((p, i) => formatParlay(p, i + 1, i === 0)).join("\n\n");
    const footer = `\n\n_Built in ${(Math.round((Date.now() - started) / 100) / 10).toFixed(1)}s · admin only_`;
    const msg = header + "\n" + body + footer;

    if (!dry) {
      const sent = await sendTelegram(msg);
      if (!sent.ok) console.error("telegram send failed", sent.error);
    }

    return {
      ok: true,
      pool: pool.length,
      sports,
      parlays: built.map((p) => ({
        variant: p.variant,
        legs: p.legs.length,
        american: p.american,
        decimal: Number(p.decimal.toFixed(2)),
        score: Number(p.score.toFixed(3)),
        mean_safety: Number(p.mean_safety.toFixed(3)),
      })),
      dry,
      ms: Date.now() - started,
    };
  } catch (e) {
    console.error("lottery-1500-builder error", e);
    const errMsg = e instanceof Error ? e.message : String(e);
    try { await sendTelegram(`❌ *Lottery +1500 errored*\n\n\`${errMsg.slice(0, 500)}\``); } catch (_) { /* ignore */ }
    return { ok: false, error: errMsg };
  }
}

async function sendTelegram(message: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRole) return { ok: false, error: "missing supabase env" };
    const resp = await fetch(`${supabaseUrl}/functions/v1/bot-send-telegram`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceRole}`,
      },
      body: JSON.stringify({
        message,
        parse_mode: "Markdown",
        admin_only: true,
        type: "lottery_1500",
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data?.success) {
      return { ok: false, error: data?.error ?? `status ${resp.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}