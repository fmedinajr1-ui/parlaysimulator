import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─────────────────────────────────────────────────────────────────────────────
// first-inning-hr-scanner
//
// Scrapes today's FIRST INNING HOME RUN over/under lines directly from
// HardRock Bet via The Odds API, then cross-references four data sources:
//
//   1. BATTER HR RATE       — season HR/game, L20, L5 trend (mlb_player_game_logs)
//   2. OPPOSING PITCHER     — HR allowed per 9 IP from the starter's game logs
//   3. H2H MATCHUP HISTORY  — this batter vs this exact pitcher (matchup_history)
//   4. PARK FACTOR          — stadium HR index for all 30 MLB parks
//
// DATA SOURCES:
//   Primary  — The Odds API, bookmakers=hardrockbet, market=batter_first_inning_home_runs
//              Falls back to batter_home_runs market if first-inning specific market
//              isn't available for today's slate.
//   Fallback — unified_props (in case Odds API call fails or budget is exhausted)
//
// MODEL:
//   baseHrProb = batter season HR/game rate
//   × pitcherRatio (pitcher HR/9 ÷ league avg 1.25)
//   × parkFactor
//   × trendMult (hot/cold L5 vs season)
//   × pitcherFormMult (L5 starts vs L10)
//   blended with H2H if ≥5 matchups
//   → compare to HardRock implied probability → emit pick if edge ≥ 5%
//
// OUTPUT → category_sweet_spots (MLB_HR_OVER / MLB_HR_UNDER)
//        → Telegram report with full cross-reference breakdown
// ─────────────────────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Thresholds ────────────────────────────────────────────────────────────────
const MIN_EDGE_PCT    = 5.0;
const MIN_CONFIDENCE  = 0.58;
const MIN_BATTER_LOGS = 15;
const MIN_PITCHER_LOGS = 3;

// ── League baselines (2024 MLB season) ───────────────────────────────────────
const LEAGUE_HR_PER_GAME       = 0.155;
const LEAGUE_HR_ALLOWED_PER_9  = 1.25;

// ── First-inning specific market keys (The Odds API) ─────────────────────────
const FIRST_INNING_HR_MARKETS = [
  "batter_first_inning_home_runs",
  "batter_home_run_first_inning",
  "player_first_inning_home_run",
];
const FALLBACK_HR_MARKETS = [
  "batter_home_runs",
  "player_home_runs",
];

// ── Park factors (HR index: 1.00 = neutral, 1.35 = very HR-friendly) ─────────
const PARK_FACTORS: Record<string, number> = {
  "great american ball park": 1.20, "coors field": 1.35, "citizens bank park": 1.18,
  "globe life field": 1.12, "yankee stadium": 1.15, "fenway park": 1.08,
  "guaranteed rate field": 1.10, "american family field": 1.09, "pnc park": 1.06,
  "wrigley field": 1.07, "target field": 1.04, "kauffman stadium": 1.02,
  "angel stadium": 1.03, "truist park": 1.02, "busch stadium": 1.01,
  "minute maid park": 1.00, "camden yards": 1.01, "chase field": 1.03,
  "nationals park": 0.99, "citi field": 0.96, "oracle park": 0.86,
  "petco park": 0.90, "dodger stadium": 0.94, "t-mobile park": 0.88,
  "tropicana field": 0.92, "progressive field": 0.94, "comerica park": 0.91,
  "loandepot park": 0.98, "rogers centre": 1.05, "oakland coliseum": 0.90,
};

const TEAM_TO_PARK: Record<string, string> = {
  "new york yankees": "yankee stadium", "boston red sox": "fenway park",
  "toronto blue jays": "rogers centre", "baltimore orioles": "camden yards",
  "tampa bay rays": "tropicana field", "chicago white sox": "guaranteed rate field",
  "cleveland guardians": "progressive field", "detroit tigers": "comerica park",
  "minnesota twins": "target field", "kansas city royals": "kauffman stadium",
  "houston astros": "minute maid park", "texas rangers": "globe life field",
  "seattle mariners": "t-mobile park", "los angeles angels": "angel stadium",
  "oakland athletics": "oakland coliseum", "new york mets": "citi field",
  "philadelphia phillies": "citizens bank park", "washington nationals": "nationals park",
  "atlanta braves": "truist park", "miami marlins": "loandepot park",
  "chicago cubs": "wrigley field", "st. louis cardinals": "busch stadium",
  "milwaukee brewers": "american family field", "pittsburgh pirates": "pnc park",
  "cincinnati reds": "great american ball park", "los angeles dodgers": "dodger stadium",
  "san francisco giants": "oracle park", "san diego padres": "petco park",
  "arizona diamondbacks": "chase field", "colorado rockies": "coors field",
};

const ABBREV_TO_TEAM: Record<string, string> = {
  NYY: "new york yankees", BOS: "boston red sox", TOR: "toronto blue jays",
  BAL: "baltimore orioles", TB: "tampa bay rays", TBR: "tampa bay rays",
  CWS: "chicago white sox", CLE: "cleveland guardians", DET: "detroit tigers",
  MIN: "minnesota twins", KC: "kansas city royals", KCR: "kansas city royals",
  HOU: "houston astros", TEX: "texas rangers", SEA: "seattle mariners",
  LAA: "los angeles angels", OAK: "oakland athletics",
  NYM: "new york mets", PHI: "philadelphia phillies", WSH: "washington nationals",
  WAS: "washington nationals", ATL: "atlanta braves", MIA: "miami marlins",
  CHC: "chicago cubs", STL: "st. louis cardinals", MIL: "milwaukee brewers",
  PIT: "pittsburgh pirates", CIN: "cincinnati reds",
  LAD: "los angeles dodgers", SF: "san francisco giants", SFG: "san francisco giants",
  SD: "san diego padres", SDP: "san diego padres", ARI: "arizona diamondbacks",
  COL: "colorado rockies",
};

// ── Helpers ────────────────────────────────────────────────────────────────────
function normName(s: string): string {
  return (s || "").toLowerCase().replace(/[.']/g, "").replace(/\s+/g, " ").trim();
}

function getEasternDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function getEasternMidnightUtc(): string {
  return `${getEasternDate()}T00:00:00-05:00`;
}

function americanToImplied(odds: number): number {
  if (!odds || odds === 0) return 0.50;
  if (odds >= 100) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

function getParkFactor(homeTeam: string, eventDesc?: string): number {
  const norm = normName(homeTeam || "");
  const park = TEAM_TO_PARK[norm];
  if (park && PARK_FACTORS[park]) return PARK_FACTORS[park];

  const upper = (homeTeam || "").toUpperCase().trim();
  const fullName = ABBREV_TO_TEAM[upper];
  if (fullName) {
    const park2 = TEAM_TO_PARK[fullName];
    if (park2 && PARK_FACTORS[park2]) return PARK_FACTORS[park2];
  }

  if (eventDesc) {
    const lower = eventDesc.toLowerCase();
    for (const [stadium, factor] of Object.entries(PARK_FACTORS)) {
      if (lower.includes(stadium.split(" ")[0])) return factor;
    }
  }

  return 1.00;
}

// ── Batter analysis from game logs ────────────────────────────────────────────
interface BatterProfile {
  hrRateSeason: number; hrRateL20: number; hrRateL5: number;
  trend: "hot" | "cold" | "neutral"; sampleGames: number;
  consecutiveGamesNoHR: number; lastHrDate: string | null;
}

function analyzeBatter(logs: any[]): BatterProfile | null {
  if (logs.length < MIN_BATTER_LOGS) return null;
  const l20 = logs.slice(0, Math.min(20, logs.length));
  const l5  = logs.slice(0, Math.min(5, logs.length));
  const hrSeason = logs.reduce((s, l) => s + (l.home_runs || 0), 0);
  const hrL20    = l20.reduce((s, l)  => s + (l.home_runs || 0), 0);
  const hrL5     = l5.reduce((s, l)   => s + (l.home_runs || 0), 0);
  const hrRateSeason = hrSeason / logs.length;
  const hrRateL20    = hrL20 / l20.length;
  const hrRateL5     = hrL5 / l5.length;
  let trend: "hot" | "cold" | "neutral" = "neutral";
  if (hrRateL5 > hrRateSeason * 1.5 && hrRateL5 > 0) trend = "hot";
  else if (hrRateL5 < hrRateSeason * 0.4) trend = "cold";
  let consecutiveGamesNoHR = 0;
  let lastHrDate: string | null = null;
  for (const log of logs) {
    if ((log.home_runs || 0) > 0) { lastHrDate = log.game_date; break; }
    consecutiveGamesNoHR++;
  }
  return {
    hrRateSeason: Math.round(hrRateSeason * 1000) / 1000,
    hrRateL20: Math.round(hrRateL20 * 1000) / 1000,
    hrRateL5: Math.round(hrRateL5 * 1000) / 1000,
    trend, sampleGames: logs.length, consecutiveGamesNoHR, lastHrDate,
  };
}

// ── Pitcher analysis from game logs ───────────────────────────────────────────
interface PitcherProfile {
  hrAllowedPer9: number; hrAllowedPerStart: number;
  sampleStarts: number; recentForm: "sharp" | "average" | "hittable";
}

function analyzePitcher(logs: any[]): PitcherProfile | null {
  const starts = logs
    .filter(l => l.innings_pitched != null && l.innings_pitched > 0 && l.pitcher_strikeouts != null)
    .slice(0, 15);
  if (starts.length < MIN_PITCHER_LOGS) return null;
  const totalIP  = starts.reduce((s, l) => s + (l.innings_pitched || 0), 0);
  const totalHR  = starts.reduce((s, l) => s + (l.home_runs || 0), 0);
  const hrPer9     = totalIP > 0 ? (totalHR / totalIP) * 9 : LEAGUE_HR_ALLOWED_PER_9;
  const hrPerStart = totalHR / starts.length;
  const l5    = starts.slice(0, 5);
  const l5IP  = l5.reduce((s, l) => s + (l.innings_pitched || 0), 0);
  const l5HR  = l5.reduce((s, l) => s + (l.home_runs || 0), 0);
  const l5Per9 = l5IP > 0 ? (l5HR / l5IP) * 9 : hrPer9;
  let recentForm: "sharp" | "average" | "hittable" = "average";
  if (l5Per9 < hrPer9 * 0.7 && l5Per9 < 0.9) recentForm = "sharp";
  else if (l5Per9 > hrPer9 * 1.4 || l5Per9 > 1.8) recentForm = "hittable";
  return {
    hrAllowedPer9: Math.round(hrPer9 * 100) / 100,
    hrAllowedPerStart: Math.round(hrPerStart * 100) / 100,
    sampleStarts: starts.length, recentForm,
  };
}

// ── Core HR probability model ─────────────────────────────────────────────────
function modelHrProbability(
  batter: BatterProfile, pitcher: PitcherProfile | null,
  parkFactor: number, matchupHrRate: number | null, matchupGames: number,
): { probability: number; narrative: string } {
  const baseRate = batter.hrRateSeason * 0.65 + batter.hrRateL20 * 0.35;
  let pitcherRatio = 1.0;
  if (pitcher) pitcherRatio = Math.max(0.4, Math.min(2.5, pitcher.hrAllowedPer9 / LEAGUE_HR_ALLOWED_PER_9));
  const parkAdj = Math.max(0.7, Math.min(1.5, parkFactor));
  const trendMult = batter.trend === "hot" ? 1.12 : batter.trend === "cold" ? 0.88 : 1.0;
  const pitcherFormMult = pitcher?.recentForm === "sharp" ? 0.85
    : pitcher?.recentForm === "hittable" ? 1.18 : 1.0;
  let rawProb = baseRate * pitcherRatio * parkAdj * trendMult * pitcherFormMult;
  if (matchupHrRate !== null && matchupGames >= 5) {
    const h2hWeight = Math.min(0.35, matchupGames * 0.02);
    rawProb = rawProb * (1 - h2hWeight) + matchupHrRate * h2hWeight;
  }
  const probability = Math.min(0.22, Math.max(0.02, rawProb));
  const parts = [
    `Season HR/g: ${batter.hrRateSeason.toFixed(3)}`,
    `L20 HR/g: ${batter.hrRateL20.toFixed(3)}`,
    pitcher ? `vs ${pitcher.sampleStarts}gp pitcher (${pitcher.hrAllowedPer9} HR/9, ${pitcher.recentForm})` : "pitcher: league avg",
    `Park: ${parkAdj.toFixed(2)}x`,
    batter.trend !== "neutral" ? `Trend: ${batter.trend}` : null,
    matchupHrRate !== null ? `H2H: ${matchupHrRate.toFixed(3)} HR/g (${matchupGames}g)` : null,
  ].filter(Boolean) as string[];
  return { probability, narrative: parts.join(" | ") };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN HANDLER
// ─────────────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  const apiKey = Deno.env.get("THE_ODDS_API_KEY");

  const log = (msg: string) => console.log(`[first-inning-hr-scanner] ${msg}`);
  const now = new Date();
  const today = getEasternDate();
  const todayStartUtc = getEasternMidnightUtc();

  try {
    log(`=== First-Inning HR Scanner — ${today} ===`);

    // ── 1. Get today's MLB events from The Odds API ───────────────────────
    interface RawProp {
      player_name: string; prop_type: string; side: "over" | "under";
      odds: number; line: number; event_id: string;
      home_team: string; away_team: string; game: string;
      bookmaker: string; is_first_inning: boolean;
    }

    const rawProps: RawProp[] = [];
    let scrapedFromApi = false;

    if (apiKey) {
      try {
        const eventsUrl = `https://api.the-odds-api.com/v4/sports/baseball_mlb/events?apiKey=${apiKey}`;
        const eventsResp = await fetch(eventsUrl, { signal: AbortSignal.timeout(12000) });

        if (eventsResp.ok) {
          const allEvents: any[] = await eventsResp.json();
          const toEasternDate = (iso: string) =>
            new Intl.DateTimeFormat("en-CA", {
              timeZone: "America/New_York",
              year: "numeric", month: "2-digit", day: "2-digit",
            }).format(new Date(iso));
          const todayEvents = allEvents.filter(e =>
            e.commence_time && toEasternDate(e.commence_time) === today
          );
          log(`MLB events today: ${todayEvents.length} of ${allEvents.length} total`);

          const allHrMarkets = [...FIRST_INNING_HR_MARKETS, ...FALLBACK_HR_MARKETS].join(",");

          await Promise.all(todayEvents.map(async (event) => {
            const propsUrl = `https://api.the-odds-api.com/v4/sports/baseball_mlb/events/${event.id}/odds?apiKey=${apiKey}&regions=us&markets=${allHrMarkets}&oddsFormat=american&bookmakers=hardrockbet`;
            try {
              const propsResp = await fetch(propsUrl, { signal: AbortSignal.timeout(10000) });
              if (!propsResp.ok) {
                log(`Event ${event.id}: HTTP ${propsResp.status}`);
                await propsResp.text();
                return;
              }
              const eventData = await propsResp.json();
              const game = `${event.away_team} @ ${event.home_team}`;

              for (const bm of (eventData.bookmakers || [])) {
                if (bm.key !== "hardrockbet") continue;
                for (const market of (bm.markets || [])) {
                  const isFirstInning = FIRST_INNING_HR_MARKETS.some(
                    mk => market.key === mk || market.key.includes("first_inning")
                  );
                  const isFallback = FALLBACK_HR_MARKETS.includes(market.key);
                  if (!isFirstInning && !isFallback) continue;

                  const playerOutcomes = new Map<string, { over?: any; under?: any }>();
                  for (const outcome of (market.outcomes || [])) {
                    const playerName = outcome.description || "";
                    if (!playerName) continue;
                    if (!playerOutcomes.has(playerName)) playerOutcomes.set(playerName, {});
                    const entry = playerOutcomes.get(playerName)!;
                    const name = (outcome.name || "").toLowerCase();
                    if (name === "over") entry.over = outcome;
                    else if (name === "under") entry.under = outcome;
                  }

                  for (const [playerName, outcomes] of playerOutcomes) {
                    if (outcomes.over) {
                      rawProps.push({
                        player_name: playerName, prop_type: market.key, side: "over",
                        odds: outcomes.over.price ?? -200, line: outcomes.over.point ?? 0.5,
                        event_id: event.id, home_team: event.home_team, away_team: event.away_team,
                        game, bookmaker: bm.key, is_first_inning: isFirstInning,
                      });
                    }
                    if (outcomes.under) {
                      rawProps.push({
                        player_name: playerName, prop_type: market.key, side: "under",
                        odds: outcomes.under.price ?? 120, line: outcomes.under.point ?? 0.5,
                        event_id: event.id, home_team: event.home_team, away_team: event.away_team,
                        game, bookmaker: bm.key, is_first_inning: isFirstInning,
                      });
                    }
                  }
                }
              }
            } catch (e: any) {
              log(`Event ${event.id} fetch error: ${e.message}`);
            }
          }));

          if (rawProps.length > 0) scrapedFromApi = true;
          log(`HardRock HR props scraped: ${rawProps.length} (${rawProps.filter(p => p.is_first_inning).length} first-inning specific)`);
        } else {
          log(`Events API error: ${eventsResp.status}`);
        }
      } catch (apiErr: any) {
        log(`Odds API error: ${apiErr.message} — falling back to unified_props`);
      }
    } else {
      log("THE_ODDS_API_KEY not set — falling back to unified_props");
    }

    // ── 2. Fallback: pull from unified_props if API returned nothing ──────
    if (rawProps.length === 0) {
      log("Falling back to unified_props for HR lines");
      const { data: dbProps, error: dbErr } = await supabase
        .from("unified_props")
        .select("player_name, prop_type, current_line, over_price, under_price, bookmaker, event_id, game_description, commence_time")
        .gte("commence_time", todayStartUtc)
        .eq("sport", "baseball_mlb")
        .in("prop_type", ["batter_home_runs", "player_home_runs", "batter_first_inning_home_runs", ...FIRST_INNING_HR_MARKETS])
        .not("player_name", "is", null);

      if (dbErr) log(`unified_props error: ${dbErr.message}`);

      for (const p of dbProps || []) {
        const line = Number(p.current_line || 0.5);
        const desc = p.game_description || "";
        const atMatch = desc.match(/^(.+?)\s+@\s+(.+?)(?:\s|$)/);
        rawProps.push({
          player_name: p.player_name, prop_type: p.prop_type, side: "over",
          odds: p.over_price ?? -200, line,
          event_id: p.event_id || "", home_team: atMatch?.[2]?.trim() || "",
          away_team: atMatch?.[1]?.trim() || "", game: desc,
          bookmaker: p.bookmaker || "unified_props",
          is_first_inning: (p.prop_type || "").includes("first_inning"),
        });
        rawProps.push({
          player_name: p.player_name, prop_type: p.prop_type, side: "under",
          odds: p.under_price ?? 120, line,
          event_id: p.event_id || "", home_team: atMatch?.[2]?.trim() || "",
          away_team: atMatch?.[1]?.trim() || "", game: desc,
          bookmaker: p.bookmaker || "unified_props",
          is_first_inning: (p.prop_type || "").includes("first_inning"),
        });
      }
      log(`unified_props fallback: ${rawProps.length} HR prop rows`);
    }

    if (rawProps.length === 0) {
      const result = {
        success: true, picks: 0, batters_analyzed: 0, scraped_from_api: scrapedFromApi,
        reason: "No HR props found. Check: (1) THE_ODDS_API_KEY is set, (2) HardRock is carrying HR lines for today's slate, (3) MLB games are scheduled.",
      };
      await supabase.from("cron_job_history").insert({
        job_name: "first-inning-hr-scanner", status: "completed",
        started_at: now.toISOString(), completed_at: new Date().toISOString(),
        duration_ms: Date.now() - now.getTime(), result,
      });
      return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── 3. De-duplicate — keep one OVER and one UNDER per player per event ─
    const propMap = new Map<string, { over?: RawProp; under?: RawProp }>();
    for (const p of rawProps) {
      const key = `${normName(p.player_name)}|${p.event_id}|${p.is_first_inning ? "1i" : "fg"}`;
      if (!propMap.has(key)) propMap.set(key, {});
      const entry = propMap.get(key)!;
      if (p.side === "over" && (!entry.over || (p.is_first_inning && !entry.over.is_first_inning))) entry.over = p;
      if (p.side === "under" && (!entry.under || (p.is_first_inning && !entry.under.is_first_inning))) entry.under = p;
    }

    const batterNames = [...new Set([...propMap.values()].map(e => e.over?.player_name || e.under?.player_name || "").filter(Boolean))];
    const eventHomeTeams = new Map<string, string>();
    for (const entry of propMap.values()) {
      const p = entry.over || entry.under;
      if (p?.event_id && p.home_team) eventHomeTeams.set(p.event_id, p.home_team);
    }

    log(`Unique batter props: ${propMap.size} | Batters: ${batterNames.length}`);

    // ── 4. Get opposing starters from unified_props pitcher props ──────────
    const { data: pitcherProps } = await supabase
      .from("unified_props")
      .select("player_name, event_id")
      .gte("commence_time", todayStartUtc)
      .eq("sport", "baseball_mlb")
      .in("prop_type", ["pitcher_strikeouts", "pitcher_outs", "pitcher_hits_allowed"]);

    const eventPitchers = new Map<string, string[]>();
    for (const pp of pitcherProps || []) {
      if (!pp.player_name || !pp.event_id) continue;
      if (!eventPitchers.has(pp.event_id)) eventPitchers.set(pp.event_id, []);
      const list = eventPitchers.get(pp.event_id)!;
      if (!list.includes(pp.player_name)) list.push(pp.player_name);
    }

    // ── 5. Fetch batter game logs ─────────────────────────────────────────
    const batterLogs = new Map<string, any[]>();
    for (let i = 0; i < batterNames.length; i += 20) {
      const batch = batterNames.slice(i, i + 20);
      const { data: logs } = await supabase
        .from("mlb_player_game_logs")
        .select("player_name, game_date, home_runs, at_bats, hits, team, opponent")
        .in("player_name", batch)
        .not("at_bats", "is", null)
        .order("game_date", { ascending: false })
        .limit(batch.length * 60);
      for (const l of logs || []) {
        const key = normName(l.player_name);
        if (!batterLogs.has(key)) batterLogs.set(key, []);
        batterLogs.get(key)!.push(l);
      }
    }
    log(`Batter logs loaded: ${batterLogs.size} players`);

    // ── 6. Fetch pitcher game logs ────────────────────────────────────────
    const allPitcherNames = [...new Set(Array.from(eventPitchers.values()).flat())];
    const pitcherLogs = new Map<string, any[]>();
    if (allPitcherNames.length > 0) {
      for (let i = 0; i < allPitcherNames.length; i += 20) {
        const batch = allPitcherNames.slice(i, i + 20);
        const { data: logs } = await supabase
          .from("mlb_player_game_logs")
          .select("player_name, game_date, innings_pitched, earned_runs, pitcher_strikeouts, walks, home_runs, team")
          .in("player_name", batch)
          .not("innings_pitched", "is", null)
          .order("game_date", { ascending: false })
          .limit(batch.length * 20);
        for (const l of logs || []) {
          const key = normName(l.player_name);
          if (!pitcherLogs.has(key)) pitcherLogs.set(key, []);
          pitcherLogs.get(key)!.push(l);
        }
      }
      log(`Pitcher logs loaded: ${pitcherLogs.size} pitchers`);
    }

    // ── 7. Load H2H matchup history ───────────────────────────────────────
    const { data: matchupRows } = await supabase
      .from("matchup_history")
      .select("player_name, opponent, prop_type, avg_stat, games_played")
      .in("player_name", batterNames)
      .eq("prop_type", "batter_home_runs");

    const h2hMap = new Map<string, { avgHr: number; games: number }>();
    for (const row of matchupRows || []) {
      const key = `${normName(row.player_name)}|${normName(row.opponent || "")}`;
      h2hMap.set(key, { avgHr: Number(row.avg_stat || 0), games: Number(row.games_played || 0) });
    }
    log(`H2H records loaded: ${h2hMap.size}`);

    // ── 8. Score each batter ──────────────────────────────────────────────
    const picks: any[] = [];
    const processedKeys = new Set<string>();
    let battersAnalyzed = 0, skippedNoLogs = 0, skippedEdge = 0;

    for (const [, entry] of propMap) {
      const overProp  = entry.over;
      const underProp = entry.under;
      const refProp   = overProp || underProp;
      if (!refProp) continue;

      const playerName = refProp.player_name;
      const eventId    = refProp.event_id;
      const dedupeKey  = `${normName(playerName)}|${eventId}`;
      if (processedKeys.has(dedupeKey)) continue;
      processedKeys.add(dedupeKey);

      const logs = batterLogs.get(normName(playerName));
      if (!logs || logs.length < MIN_BATTER_LOGS) { skippedNoLogs++; continue; }
      const batter = analyzeBatter(logs);
      if (!batter) { skippedNoLogs++; continue; }
      battersAnalyzed++;

      // Find opposing pitcher
      const eventPitcherList = eventPitchers.get(eventId) || [];
      const batterTeam = normName(logs[0]?.team || "");
      // Pick pitcher whose game logs show a different team than the batter
      let pitcher: PitcherProfile | null = null;
      let pitcherName = "Unknown SP";
      for (const pName of eventPitcherList) {
        const pLogs = pitcherLogs.get(normName(pName)) || [];
        if (pLogs.length > 0) {
          const pTeam = normName(pLogs[0]?.team || "");
          if (pTeam !== batterTeam) {
            pitcherName = pName;
            pitcher = analyzePitcher(pLogs);
            break;
          }
        }
      }

      const homeTeam   = eventHomeTeams.get(eventId) || refProp.home_team || "";
      const parkFactor = getParkFactor(homeTeam, refProp.game);

      // H2H
      const h2hKey = `${normName(playerName)}|${normName(pitcherName)}`;
      const h2h    = h2hMap.get(h2hKey) ?? null;

      const { probability, narrative } = modelHrProbability(
        batter, pitcher, parkFactor, h2h?.avgHr ?? null, h2h?.games ?? 0
      );

      const overOdds  = overProp?.odds  ?? null;
      const underOdds = underProp?.odds ?? null;
      const line      = overProp?.line  ?? underProp?.line ?? 0.5;

      const marketOverImplied  = overOdds  ? americanToImplied(overOdds)  : 0.145;
      const marketUnderImplied = underOdds ? americanToImplied(underOdds) : 0.855;

      const overEdge  = (probability - marketOverImplied) / marketOverImplied * 100;
      const underEdge = ((1 - probability) - marketUnderImplied) / marketUnderImplied * 100;

      const bestEdge = Math.max(overEdge, underEdge);
      if (bestEdge < MIN_EDGE_PCT) { skippedEdge++; continue; }

      const recommendedSide: "over" | "under" = overEdge >= underEdge ? "over" : "under";
      const edgePct        = Math.round(bestEdge * 10) / 10;
      const modelProb      = recommendedSide === "over" ? probability : 1 - probability;
      const marketImplied  = recommendedSide === "over" ? marketOverImplied : marketUnderImplied;
      const oddsForPick    = recommendedSide === "over" ? overOdds : underOdds;
      const isFirstInning  = refProp.is_first_inning;

      let confidence = 0.55 + Math.min(edgePct * 0.015, 0.12);
      if (pitcher && pitcher.sampleStarts >= 5) confidence += 0.04;
      if (h2h && h2h.games >= 5)               confidence += 0.04;
      if (batter.sampleGames >= 50)            confidence += 0.03;
      if (batter.trend === "hot"  && recommendedSide === "over")  confidence += 0.03;
      if (batter.trend === "cold" && recommendedSide === "under") confidence += 0.03;
      if (!isFirstInning) confidence -= 0.04;
      confidence = Math.min(0.88, Math.max(0.40, confidence));
      if (confidence < MIN_CONFIDENCE) continue;

      log(`PICK: ${playerName} HR ${recommendedSide.toUpperCase()} ${line}${isFirstInning ? " (1st inn)" : " (full game)"} | model ${(probability * 100).toFixed(1)}% | mkt ${(marketImplied * 100).toFixed(1)}% | edge ${edgePct}%`);

      picks.push({
        player_name: playerName, event_id: eventId, game: refProp.game, line,
        is_first_inning: isFirstInning, prop_type: refProp.prop_type,
        recommended_side: recommendedSide, odds: oddsForPick,
        model_prob: Math.round(probability * 1000) / 1000,
        market_implied: Math.round(marketImplied * 1000) / 1000,
        edge_pct: edgePct, confidence,
        batter_hr_season: batter.hrRateSeason, batter_hr_l20: batter.hrRateL20,
        batter_hr_l5: batter.hrRateL5, batter_trend: batter.trend,
        batter_games: batter.sampleGames,
        pitcher_name: pitcherName, pitcher_hr_per_9: pitcher?.hrAllowedPer9 ?? null,
        pitcher_form: pitcher?.recentForm ?? "unknown", pitcher_starts: pitcher?.sampleStarts ?? 0,
        park_factor: parkFactor, home_team: homeTeam,
        h2h_hr_rate: h2h?.avgHr ?? null, h2h_games: h2h?.games ?? 0,
        narrative, bookmaker: refProp.bookmaker,
      });
    }

    log(`Analyzed: ${battersAnalyzed} | Picks: ${picks.length} | No logs: ${skippedNoLogs} | Below edge: ${skippedEdge}`);

    // ── 9. Write to category_sweet_spots ─────────────────────────────────
    if (picks.length > 0) {
      await supabase.from("category_sweet_spots")
        .delete().eq("analysis_date", today)
        .in("category", ["MLB_HR_OVER", "MLB_HR_UNDER"]);

      const sweetSpotRows = picks.map(p => ({
        analysis_date: today, player_name: p.player_name,
        prop_type: p.is_first_inning ? "batter_first_inning_home_runs" : "batter_home_runs",
        category: p.recommended_side === "over" ? "MLB_HR_OVER" : "MLB_HR_UNDER",
        recommended_side: p.recommended_side, recommended_line: p.line,
        actual_line: p.line,
        confidence_score: Math.round(p.confidence * 100) / 100,
        l10_hit_rate: p.model_prob, l10_avg: p.batter_hr_season,
        l10_median: p.batter_hr_l20, l3_avg: p.batter_hr_l5,
        games_played: p.batter_games, is_active: true,
        risk_level: p.edge_pct >= 10 ? "LOW" : p.edge_pct >= 7 ? "MEDIUM" : "HIGH",
        recommendation: [
          `${p.recommended_side.toUpperCase()} ${p.line} HR${p.is_first_inning ? " (1st inn)" : ""}`,
          `${p.edge_pct}% edge`, `${p.bookmaker}`,
          `vs ${p.pitcher_name} (${p.pitcher_hr_per_9 !== null ? p.pitcher_hr_per_9 + " HR/9" : "starter"})`,
          `Park: ${p.park_factor.toFixed(2)}x`,
          p.h2h_games >= 5 ? `H2H: ${(p.h2h_hr_rate * 100).toFixed(1)}% HR (${p.h2h_games}g)` : null,
        ].filter(Boolean).join(" | "),
        projection_source: "FIRST_INNING_HR_SCANNER",
        eligibility_type: "MLB_BATTER",
      }));

      const { error: insertErr } = await supabase.from("category_sweet_spots").insert(sweetSpotRows);
      if (insertErr) log(`⚠ Insert error: ${insertErr.message}`);
      else log(`Inserted ${sweetSpotRows.length} HR picks`);
    }

    // ── 10. Telegram ──────────────────────────────────────────────────────
    if (picks.length > 0) {
      const sorted = [...picks].sort((a, b) => b.edge_pct - a.edge_pct);
      const lines = [
        `⚾💥 *HR Scanner — ${sorted.length} pick${sorted.length !== 1 ? "s" : ""}*`,
        `_Source: HardRock Bet${!scrapedFromApi ? " (unified_props fallback)" : ""} | 4-factor model_`,
        "",
      ];
      for (const [i, p] of sorted.entries()) {
        const emoji      = p.recommended_side === "over" ? "🔥" : "🧊";
        const sideLabel  = p.recommended_side === "over" ? "OVER" : "UNDER";
        const inningTag  = p.is_first_inning ? " _[1st inn]_" : " _[full game]_";
        const oddsStr    = p.odds ? ` (${p.odds > 0 ? "+" : ""}${p.odds})` : "";
        const trendEmoji = p.batter_trend === "hot" ? " 📈" : p.batter_trend === "cold" ? " 📉" : "";
        lines.push(`${i + 1}. ${emoji} *${p.player_name}* — HR ${sideLabel} ${p.line}${oddsStr}${trendEmoji}${inningTag}`);
        lines.push(`   ⚾ vs *${p.pitcher_name}* | ${p.pitcher_hr_per_9 !== null ? p.pitcher_hr_per_9 + " HR/9" : "n/a"} (${p.pitcher_form})`);
        lines.push(`   🏟 ${p.home_team || "??"} park (${p.park_factor.toFixed(2)}x) | Batter: ${(p.batter_hr_season * 100).toFixed(1)}% HR/g`);
        if (p.h2h_games >= 5) lines.push(`   🔄 H2H vs pitcher: ${(p.h2h_hr_rate * 100).toFixed(1)}% HR (${p.h2h_games}g)`);
        lines.push(`   📊 Model: ${(p.model_prob * 100).toFixed(1)}% | Mkt: ${(p.market_implied * 100).toFixed(1)}% | Edge: ${p.edge_pct}% | Conf: ${(p.confidence * 100).toFixed(0)}%`);
        lines.push("");
      }
      await supabase.functions.invoke("bot-send-telegram", {
        body: { message: lines.join("\n"), parse_mode: "Markdown", admin_only: true },
      }).catch(() => {});
    }

    // ── 11. Log ───────────────────────────────────────────────────────────
    const result = {
      success: true, picks: picks.length, batters_analyzed: battersAnalyzed,
      hr_props_scraped: rawProps.length, unique_batters: propMap.size,
      scraped_from_api: scrapedFromApi,
      first_inning_props: rawProps.filter(p => p.is_first_inning).length,
      pitchers_identified: allPitcherNames.length,
      skipped_no_logs: skippedNoLogs, skipped_below_edge: skippedEdge,
    };

    await supabase.from("cron_job_history").insert({
      job_name: "first-inning-hr-scanner", status: "completed",
      started_at: now.toISOString(), completed_at: new Date().toISOString(),
      duration_ms: Date.now() - now.getTime(), result,
    });

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    log(`❌ Fatal: ${err.message}`);
    await supabase.from("cron_job_history").insert({
      job_name: "first-inning-hr-scanner", status: "failed",
      started_at: now.toISOString(), completed_at: new Date().toISOString(),
      duration_ms: Date.now() - now.getTime(), result: { error: err.message },
    }).catch(() => {});
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
