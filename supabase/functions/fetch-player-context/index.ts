import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 30000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

interface PlayerContext {
  playerName: string;
  team: string | null;
  sport: string;
  recentStats: {
    last5Avg: number | null;
    seasonAvg: number | null;
    trend: "hot" | "cold" | "neutral";
    statType: string;
  } | null;
  injuryStatus: {
    status: string;
    details: string | null;
    impactScore: number | null;
  } | null;
  contextNarrative: string;
  keyFactors: string[];
  lastUpdated: string;
}

interface LegInput {
  legId: string;
  description: string;
  propType?: string;
  line?: number;
  sport?: string;
}

// Extract player name from leg description
function extractPlayerName(description: string): string | null {
  // Common patterns: "Player Name Over/Under X.5 stat"
  const patterns = [
    /^([A-Z][a-z]+ [A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:Over|Under|o|u)/i,
    /^([A-Z][a-z]+ [A-Z][a-z]+(?:\s+Jr\.?|Sr\.?|III|II|IV)?)/i,
    /Player:\s*([A-Z][a-z]+ [A-Z][a-z]+)/i,
  ];

  for (const pattern of patterns) {
    const match = description.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  // If no player pattern found, return null (might be a team bet)
  return null;
}

// Extract team names from leg description
function extractTeamName(description: string): string | null {
  const teamPatterns = [
    /(?:vs\.?|@)\s*([A-Za-z]+\s*[A-Za-z]*)/i,
    /([A-Za-z]+)\s+(?:ML|Moneyline|Spread|Over|Under)/i,
    /^([A-Za-z]+\s*[A-Za-z]*)\s+[-+]/i,
  ];

  for (const pattern of teamPatterns) {
    const match = description.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  return null;
}

// Detect sport from description
function detectSport(description: string, providedSport?: string): string {
  if (providedSport) return providedSport.toUpperCase();

  const sportKeywords: Record<string, string[]> = {
    NBA: ["points", "rebounds", "assists", "steals", "blocks", "3-pointers", "threes"],
    NFL: ["passing", "rushing", "receiving", "touchdowns", "yards", "completions", "interceptions"],
    NHL: ["goals", "assists", "shots", "saves", "power play"],
    MLB: ["hits", "runs", "strikeouts", "home runs", "RBIs", "batting"],
  };

  const lowerDesc = description.toLowerCase();
  for (const [sport, keywords] of Object.entries(sportKeywords)) {
    if (keywords.some((kw) => lowerDesc.includes(kw))) {
      return sport;
    }
  }

  return "UNKNOWN";
}

// Generate AI narrative using OpenAI
async function generateNarrative(
  playerName: string,
  context: {
    recentStats: PlayerContext["recentStats"];
    injuryStatus: PlayerContext["injuryStatus"];
    propType?: string;
    line?: number;
    sport: string;
  }
): Promise<{ narrative: string; keyFactors: string[] }> {
  const openaiKey = Deno.env.get("OPENAI_API_KEY");

  if (!openaiKey) {
    // Fallback to simple narrative without AI
    return generateFallbackNarrative(playerName, context);
  }

  try {
    const prompt = buildNarrativePrompt(playerName, context);

    const response = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a sports betting analyst providing concise, actionable context for prop bets. 
            Keep responses brief (1-2 sentences for narrative). 
            Focus on factors that directly impact the prop outcome.
            Be direct and avoid filler words.`,
          },
          { role: "user", content: prompt },
        ],
        max_tokens: 200,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      console.error("OpenAI API error:", await response.text());
      return generateFallbackNarrative(playerName, context);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    // Parse the response - expecting format: "NARRATIVE: ... | FACTORS: factor1, factor2, factor3"
    const narrativeMatch = content.match(/NARRATIVE:\s*(.+?)(?:\||\n|$)/i);
    const factorsMatch = content.match(/FACTORS:\s*(.+?)$/i);

    const narrative = narrativeMatch?.[1]?.trim() || content.trim();
    const keyFactors = factorsMatch?.[1]
      ? factorsMatch[1].split(",").map((f: string) => f.trim()).filter(Boolean)
      : extractKeyFactors(context);

    return { narrative, keyFactors };
  } catch (error) {
    console.error("Error generating narrative:", error);
    return generateFallbackNarrative(playerName, context);
  }
}

function buildNarrativePrompt(
  playerName: string,
  context: {
    recentStats: PlayerContext["recentStats"];
    injuryStatus: PlayerContext["injuryStatus"];
    propType?: string;
    line?: number;
    sport: string;
  }
): string {
  let prompt = `Generate a brief betting context for ${playerName}`;

  if (context.propType && context.line !== undefined) {
    prompt += ` on the ${context.propType} prop with line ${context.line}`;
  }

  prompt += `. Sport: ${context.sport}.\n\n`;

  if (context.recentStats) {
    prompt += `Recent performance: Averaging ${context.recentStats.last5Avg} ${context.recentStats.statType} over last 5 games`;
    if (context.recentStats.seasonAvg) {
      const diff = (context.recentStats.last5Avg || 0) - context.recentStats.seasonAvg;
      prompt += ` (${diff > 0 ? "+" : ""}${diff.toFixed(1)} vs season avg of ${context.recentStats.seasonAvg})`;
    }
    prompt += `. Trend: ${context.recentStats.trend}.\n`;
  }

  if (context.injuryStatus) {
    prompt += `Injury status: ${context.injuryStatus.status}`;
    if (context.injuryStatus.details) {
      prompt += ` (${context.injuryStatus.details})`;
    }
    prompt += `.\n`;
  }

  prompt += `\nRespond in format: NARRATIVE: [1-2 sentence analysis] | FACTORS: [factor1], [factor2], [factor3]`;

  return prompt;
}

function extractKeyFactors(context: {
  recentStats: PlayerContext["recentStats"];
  injuryStatus: PlayerContext["injuryStatus"];
}): string[] {
  const factors: string[] = [];

  if (context.recentStats?.trend === "hot") {
    factors.push("🔥 Hot streak");
  } else if (context.recentStats?.trend === "cold") {
    factors.push("❄️ Cold stretch");
  }

  if (context.injuryStatus) {
    if (context.injuryStatus.status.toLowerCase().includes("out")) {
      factors.push("🚫 Out - Injury");
    } else if (
      context.injuryStatus.status.toLowerCase().includes("questionable") ||
      context.injuryStatus.status.toLowerCase().includes("doubtful")
    ) {
      factors.push("⚠️ Injury concern");
    } else if (context.injuryStatus.status.toLowerCase().includes("probable")) {
      factors.push("🟡 Probable to play");
    }
  }

  return factors;
}

function generateFallbackNarrative(
  playerName: string,
  context: {
    recentStats: PlayerContext["recentStats"];
    injuryStatus: PlayerContext["injuryStatus"];
    propType?: string;
    line?: number;
    sport: string;
  }
): { narrative: string; keyFactors: string[] } {
  const parts: string[] = [];
  const keyFactors: string[] = [];

  if (context.recentStats) {
    if (context.recentStats.trend === "hot") {
      parts.push(
        `${playerName} is on a hot streak, averaging ${context.recentStats.last5Avg} ${context.recentStats.statType} over the last 5 games`
      );
      keyFactors.push("🔥 Hot streak");
    } else if (context.recentStats.trend === "cold") {
      parts.push(
        `${playerName} has been struggling, averaging ${context.recentStats.last5Avg} ${context.recentStats.statType} recently`
      );
      keyFactors.push("❄️ Cold stretch");
    } else {
      parts.push(
        `${playerName} is performing consistently at ${context.recentStats.last5Avg} ${context.recentStats.statType} per game`
      );
    }
  }

  if (context.injuryStatus) {
    parts.push(`Listed as ${context.injuryStatus.status}${context.injuryStatus.details ? ` (${context.injuryStatus.details})` : ""}`);
    keyFactors.push(`⚠️ ${context.injuryStatus.status}`);
  }

  const narrative = parts.length > 0 ? parts.join(". ") + "." : `No recent data available for ${playerName}.`;

  return { narrative, keyFactors };
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Missing Supabase configuration");
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { legs } = (await req.json()) as { legs: LegInput[] };

    if (!legs || !Array.isArray(legs)) {
      throw new Error("Invalid request: legs array required");
    }

    const results: Record<string, PlayerContext> = {};

    for (const leg of legs) {
      const playerName = extractPlayerName(leg.description);
      const teamName = extractTeamName(leg.description);
      const sport = detectSport(leg.description, leg.sport);

      if (!playerName && !teamName) {
        results[leg.legId] = {
          playerName: "Unknown",
          team: null,
          sport,
          recentStats: null,
          injuryStatus: null,
          contextNarrative: "Unable to extract player/team from this prop.",
          keyFactors: [],
          lastUpdated: new Date().toISOString(),
        };
        continue;
      }

      // Fetch injury data
      let injuryStatus: PlayerContext["injuryStatus"] = null;
      if (playerName) {
        const { data: injuryData } = await supabase
          .from("injury_reports")
          .select("status, injury_detail, impact_score, team_name")
          .ilike("player_name", `%${playerName}%`)
          .order("updated_at", { ascending: false })
          .limit(1);

        if (injuryData && injuryData.length > 0) {
          injuryStatus = {
            status: injuryData[0].status,
            details: injuryData[0].injury_detail,
            impactScore: injuryData[0].impact_score,
          };
        }
      }

      // Fetch recent stats based on sport
      let recentStats: PlayerContext["recentStats"] = null;

      // Try to get game log data
      const gameLogTable = sport === "NBA" ? "nba_player_game_logs" : 
                           sport === "NFL" ? "nfl_player_game_logs" : 
                           sport === "NHL" ? "nhl_player_game_logs" : null;

      if (gameLogTable && playerName) {
        try {
          const { data: gameLogs } = await supabase
            .from(gameLogTable)
            .select("*")
            .ilike("player_name", `%${playerName}%`)
            .order("game_date", { ascending: false })
            .limit(10);

          if (gameLogs && gameLogs.length >= 3) {
            // Determine the stat type from the prop
            const statType = leg.propType || detectStatType(leg.description);
            const statField = mapStatTypeToField(statType, sport);

            if (statField && gameLogs[0][statField] !== undefined) {
              const last5 = gameLogs.slice(0, 5);
              const last5Avg = last5.reduce((sum, g) => sum + (Number(g[statField]) || 0), 0) / last5.length;
              const seasonAvg = gameLogs.reduce((sum, g) => sum + (Number(g[statField]) || 0), 0) / gameLogs.length;

              const trend: "hot" | "cold" | "neutral" =
                last5Avg > seasonAvg * 1.15 ? "hot" : last5Avg < seasonAvg * 0.85 ? "cold" : "neutral";

              recentStats = {
                last5Avg: Math.round(last5Avg * 10) / 10,
                seasonAvg: Math.round(seasonAvg * 10) / 10,
                trend,
                statType: statType || "performance",
              };
            }
          }
        } catch (err) {
          console.log(`No game logs found for ${playerName} in ${gameLogTable}`);
        }
      }

      // Generate narrative
      const { narrative, keyFactors } = await generateNarrative(playerName || teamName || "Unknown", {
        recentStats,
        injuryStatus,
        propType: leg.propType,
        line: leg.line,
        sport,
      });

      results[leg.legId] = {
        playerName: playerName || teamName || "Unknown",
        team: teamName,
        sport,
        recentStats,
        injuryStatus,
        contextNarrative: narrative,
        keyFactors,
        lastUpdated: new Date().toISOString(),
      };
    }

    return new Response(JSON.stringify({ success: true, contexts: results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in fetch-player-context:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// Helper functions
function detectStatType(description: string): string {
  const lowerDesc = description.toLowerCase();
  
  if (lowerDesc.includes("point") || lowerDesc.includes("pts")) return "points";
  if (lowerDesc.includes("rebound") || lowerDesc.includes("reb")) return "rebounds";
  if (lowerDesc.includes("assist") || lowerDesc.includes("ast")) return "assists";
  if (lowerDesc.includes("3-pointer") || lowerDesc.includes("three")) return "threes";
  if (lowerDesc.includes("steal")) return "steals";
  if (lowerDesc.includes("block")) return "blocks";
  if (lowerDesc.includes("passing") || lowerDesc.includes("pass yard")) return "passing_yards";
  if (lowerDesc.includes("rushing") || lowerDesc.includes("rush yard")) return "rushing_yards";
  if (lowerDesc.includes("receiving") || lowerDesc.includes("rec yard")) return "receiving_yards";
  if (lowerDesc.includes("touchdown")) return "touchdowns";
  if (lowerDesc.includes("reception")) return "receptions";
  if (lowerDesc.includes("goal")) return "goals";
  if (lowerDesc.includes("shot")) return "shots";
  
  return "general";
}

function mapStatTypeToField(statType: string, sport: string): string | null {
  const mappings: Record<string, Record<string, string>> = {
    NBA: {
      points: "pts",
      rebounds: "reb",
      assists: "ast",
      steals: "stl",
      blocks: "blk",
      threes: "fg3m",
    },
    NFL: {
      passing_yards: "passing_yards",
      rushing_yards: "rushing_yards",
      receiving_yards: "receiving_yards",
      touchdowns: "touchdowns",
      receptions: "receptions",
    },
    NHL: {
      goals: "goals",
      assists: "assists",
      shots: "shots",
    },
  };

  return mappings[sport]?.[statType] || null;
}
