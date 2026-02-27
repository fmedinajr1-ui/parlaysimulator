import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

interface TimePattern {
  month: number;
  day_of_week: number;
  total_bets: number;
  wins: number;
  win_rate: number;
  avg_odds: number;
  upset_wins: number;
}

interface MonthStat {
  month: number;
  label: string;
  winRate: number;
  totalBets: number;
  upsetWins: number;
}

interface DayStat {
  dayOfWeek: number;
  label: string;
  winRate: number;
  totalBets: number;
  isHot: boolean;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { userId } = await req.json();

    if (!userId) {
      return new Response(
        JSON.stringify({ error: "userId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get user's betting patterns
    const { data: patterns, error: patternsError } = await supabase
      .rpc('get_betting_time_patterns', { p_user_id: userId });

    if (patternsError) {
      console.error("Error fetching patterns:", patternsError);
      throw new Error("Failed to fetch betting patterns");
    }

    const timePatterns: TimePattern[] = patterns || [];

    // Aggregate by month
    const monthStats = new Map<number, { wins: number; total: number; upsets: number }>();
    const dayStats = new Map<number, { wins: number; total: number }>();

    for (const p of timePatterns) {
      // Aggregate months
      const monthData = monthStats.get(p.month) || { wins: 0, total: 0, upsets: 0 };
      monthData.wins += Number(p.wins);
      monthData.total += Number(p.total_bets);
      monthData.upsets += Number(p.upset_wins);
      monthStats.set(p.month, monthData);

      // Aggregate days
      const dayData = dayStats.get(p.day_of_week) || { wins: 0, total: 0 };
      dayData.wins += Number(p.wins);
      dayData.total += Number(p.total_bets);
      dayStats.set(p.day_of_week, dayData);
    }

    const dayLabels = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    // Calculate hot months
    const hotMonths: MonthStat[] = Array.from(monthStats.entries())
      .map(([month, data]) => ({
        month,
        label: monthLabels[month - 1],
        winRate: data.total > 0 ? Math.round((data.wins / data.total) * 100) : 0,
        totalBets: data.total,
        upsetWins: data.upsets,
      }))
      .sort((a, b) => b.winRate - a.winRate);

    // Calculate hot days
    const avgWinRate = timePatterns.length > 0
      ? timePatterns.reduce((sum, p) => sum + Number(p.win_rate), 0) / timePatterns.length
      : 50;

    const hotDays: DayStat[] = Array.from(dayStats.entries())
      .map(([dayOfWeek, data]) => {
        const winRate = data.total > 0 ? Math.round((data.wins / data.total) * 100) : 0;
        return {
          dayOfWeek,
          label: dayLabels[dayOfWeek],
          winRate,
          totalBets: data.total,
          isHot: winRate > avgWinRate + 5,
        };
      })
      .sort((a, b) => b.winRate - a.winRate);

    // Identify upset-prone days (days with high upset rate)
    const upsetDays = hotDays
      .filter(d => {
        const monthData = Array.from(monthStats.values());
        const totalUpsets = monthData.reduce((sum, m) => sum + m.upsets, 0);
        const totalBets = monthData.reduce((sum, m) => sum + m.total, 0);
        return totalUpsets / Math.max(totalBets, 1) > 0.1;
      })
      .map(d => ({ dayOfWeek: d.dayOfWeek, label: d.label }));

    // Generate AI insight
    let aiInsight = "Start betting to build your personal calendar insights!";
    
    if (timePatterns.length > 0) {
      const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
      
      if (OPENAI_API_KEY) {
        const bestDay = hotDays[0];
        const bestMonth = hotMonths[0];
        
        const prompt = `You are a sports betting analyst. Based on this user's betting history, provide ONE SHORT personalized tip (max 2 sentences):

Best performing day: ${bestDay?.label || 'N/A'} with ${bestDay?.winRate || 0}% win rate
Best performing month: ${bestMonth?.label || 'N/A'} with ${bestMonth?.winRate || 0}% win rate
Total bets analyzed: ${timePatterns.reduce((sum, p) => sum + Number(p.total_bets), 0)}
Upset wins: ${Array.from(monthStats.values()).reduce((sum, m) => sum + m.upsets, 0)}

Give a brief, actionable insight about when they should focus their betting. Be encouraging but realistic. Use betting slang.`;

        try {
          const response = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${OPENAI_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "gpt-4o-mini",
              messages: [{ role: "user", content: prompt }],
              max_tokens: 150,
            }),
          });

          if (response.ok) {
            const aiData = await response.json();
            aiInsight = aiData.choices?.[0]?.message?.content || aiInsight;
          }
        } catch (aiError) {
          console.error("AI insight generation failed:", aiError);
        }
      } else {
        // Fallback insight without AI
        const bestDay = hotDays[0];
        const bestMonth = hotMonths[0];
        if (bestDay && bestMonth) {
          aiInsight = `Your best days are ${bestDay.label}s (${bestDay.winRate}% win rate). ${bestMonth.label} has been your hottest month - lean into that!`;
        }
      }
    }

    const result = {
      hotMonths,
      hotDays,
      upsetDays,
      aiInsight,
      hasData: timePatterns.length > 0,
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Error in betting-calendar-insights:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
