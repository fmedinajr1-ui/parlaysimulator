import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface UpsetPattern {
  team: string;
  sport: string;
  totalUpsets: number;
  avgOdds: number;
  winRate: number;
  totalBets: number;
  lastUpset: string | null;
}

interface SportUpsetStats {
  sport: string;
  totalUpsets: number;
  totalBets: number;
  upsetRate: number;
  avgUpsetOdds: number;
}

interface MonthlyUpsetTrend {
  month: number;
  label: string;
  upsets: number;
  totalBets: number;
  upsetRate: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { userId } = await req.json();

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Query for upset data - an upset is when odds > 150 (underdog) and bet won
    const UPSET_ODDS_THRESHOLD = 150;
    
    let query = supabase
      .from('parlay_training_data')
      .select('*')
      .not('parlay_outcome', 'is', null);
    
    if (userId) {
      query = query.eq('user_id', userId);
    }
    
    const { data: bettingData, error } = await query;

    if (error) {
      console.error("Error fetching betting data:", error);
      throw new Error("Failed to fetch betting data");
    }

    const data = bettingData || [];
    
    // Extract team names from descriptions
    const extractTeam = (description: string): string => {
      // Common patterns: "Team A vs Team B", "Team A +3.5", "Team A ML"
      const patterns = [
        /^([A-Za-z0-9\s]+?)\s+(?:vs\.?|@|ML|moneyline|\+|-|\d)/i,
        /^([A-Za-z0-9\s]+?)\s+(?:over|under)/i,
        /([A-Za-z]+)\s+(?:to win|wins)/i,
      ];
      
      for (const pattern of patterns) {
        const match = description.match(pattern);
        if (match && match[1]) {
          return match[1].trim();
        }
      }
      
      // Fallback: take first 2-3 words
      const words = description.split(' ').slice(0, 3).join(' ');
      return words.length > 20 ? words.slice(0, 20) + '...' : words;
    };

    // Calculate team-based upset patterns
    const teamUpsets = new Map<string, { 
      upsets: number; 
      total: number; 
      totalOdds: number;
      sport: string;
      lastUpset: string | null;
    }>();

    // Calculate sport-based upsets
    const sportUpsets = new Map<string, { 
      upsets: number; 
      total: number; 
      totalOdds: number;
    }>();

    // Calculate monthly trends
    const monthlyUpsets = new Map<number, { upsets: number; total: number }>();
    const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    for (const bet of data) {
      const odds = Number(bet.odds) || 0;
      const isUpset = bet.parlay_outcome === true && odds > UPSET_ODDS_THRESHOLD;
      const team = bet.team || extractTeam(bet.description);
      const sport = bet.sport || 'Unknown';
      const createdAt = new Date(bet.created_at);
      const month = createdAt.getMonth();

      // Team stats
      const teamKey = `${team}|${sport}`;
      const teamData = teamUpsets.get(teamKey) || { 
        upsets: 0, 
        total: 0, 
        totalOdds: 0, 
        sport,
        lastUpset: null 
      };
      teamData.total++;
      if (isUpset) {
        teamData.upsets++;
        teamData.totalOdds += odds;
        if (!teamData.lastUpset || createdAt > new Date(teamData.lastUpset)) {
          teamData.lastUpset = bet.created_at;
        }
      }
      teamUpsets.set(teamKey, teamData);

      // Sport stats
      const sportData = sportUpsets.get(sport) || { upsets: 0, total: 0, totalOdds: 0 };
      sportData.total++;
      if (isUpset) {
        sportData.upsets++;
        sportData.totalOdds += odds;
      }
      sportUpsets.set(sport, sportData);

      // Monthly stats
      const monthData = monthlyUpsets.get(month) || { upsets: 0, total: 0 };
      monthData.total++;
      if (isUpset) monthData.upsets++;
      monthlyUpsets.set(month, monthData);
    }

    // Format team upset patterns (top 10 by upset count)
    const topTeamUpsets: UpsetPattern[] = Array.from(teamUpsets.entries())
      .filter(([_, data]) => data.upsets > 0)
      .map(([key, data]) => {
        const [team, sport] = key.split('|');
        return {
          team,
          sport,
          totalUpsets: data.upsets,
          avgOdds: Math.round(data.totalOdds / data.upsets),
          winRate: Math.round((data.upsets / data.total) * 100),
          totalBets: data.total,
          lastUpset: data.lastUpset,
        };
      })
      .sort((a, b) => b.totalUpsets - a.totalUpsets)
      .slice(0, 10);

    // Format sport upset stats
    const sportStats: SportUpsetStats[] = Array.from(sportUpsets.entries())
      .filter(([sport, _]) => sport !== 'Unknown' && sport !== 'unknown')
      .map(([sport, data]) => ({
        sport,
        totalUpsets: data.upsets,
        totalBets: data.total,
        upsetRate: data.total > 0 ? Math.round((data.upsets / data.total) * 100) : 0,
        avgUpsetOdds: data.upsets > 0 ? Math.round(data.totalOdds / data.upsets) : 0,
      }))
      .sort((a, b) => b.upsetRate - a.upsetRate);

    // Format monthly trends
    const monthlyTrends: MonthlyUpsetTrend[] = Array.from(monthlyUpsets.entries())
      .map(([month, data]) => ({
        month,
        label: monthLabels[month],
        upsets: data.upsets,
        totalBets: data.total,
        upsetRate: data.total > 0 ? Math.round((data.upsets / data.total) * 100) : 0,
      }))
      .sort((a, b) => a.month - b.month);

    // Overall stats
    const totalBets = data.length;
    const totalUpsets = data.filter(b => b.parlay_outcome === true && Number(b.odds) > UPSET_ODDS_THRESHOLD).length;
    const overallUpsetRate = totalBets > 0 ? Math.round((totalUpsets / totalBets) * 100) : 0;

    const result = {
      topTeamUpsets,
      sportStats,
      monthlyTrends,
      summary: {
        totalBets,
        totalUpsets,
        overallUpsetRate,
        hasData: totalBets > 0,
      }
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Error in upset-tracker:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
