import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface NewsItem {
  event_id: string;
  sport: string;
  home_team: string;
  away_team: string;
  commence_time: string;
  news_type: string;
  headline: string;
  impact_level: string;
  market_impact: boolean;
  source_table?: string;
  source_id?: string;
  player_name?: string;
  affected_props?: any;
}

function formatOdds(price: number): string {
  return price > 0 ? `+${price}` : `${price}`;
}

function truncateHeadline(text: string, maxLen = 160): string {
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen - 3) + '...';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { sport } = await req.json().catch(() => ({}));
    
    console.log(`[game-news-aggregator] Starting aggregation for sport: ${sport || 'all'}`);

    const newsItems: NewsItem[] = [];
    const gamesMap = new Map<string, any>();
    const now = new Date().toISOString();

    // 1. Get line movements (last 24 hours) - Sharp Action & Market Moves
    const { data: movements } = await supabase
      .from('line_movements')
      .select('*')
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(100);

    if (movements) {
      for (const m of movements) {
        const eventId = m.event_id;
        const isSharp = m.is_sharp_action || Math.abs(m.price_change || 0) >= 15;
        
        if (!gamesMap.has(eventId)) {
          gamesMap.set(eventId, {
            event_id: eventId,
            sport: m.sport || 'basketball_nba',
            home_team: m.home_team || 'Home',
            away_team: m.away_team || 'Away',
            commence_time: m.commence_time || now,
          });
        }

        const headline = isSharp
          ? `⚡ Sharp money on ${m.outcome_name}: ${formatOdds(m.old_price)} → ${formatOdds(m.new_price)}`
          : `📈 ${m.outcome_name} moved ${(m.price_change || 0) > 0 ? '↑' : '↓'} ${Math.abs(m.price_change || 0)} pts`;

        newsItems.push({
          ...gamesMap.get(eventId),
          news_type: isSharp ? 'sharp_action' : 'market_move',
          headline: truncateHeadline(headline),
          impact_level: isSharp ? 'high' : Math.abs(m.price_change || 0) >= 10 ? 'medium' : 'low',
          market_impact: isSharp,
          source_table: 'line_movements',
          source_id: m.id,
        });
      }
    }

    // 2. Get injury reports (last 48 hours)
    const { data: injuries } = await supabase
      .from('injury_reports')
      .select('*')
      .gte('updated_at', new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
      .order('updated_at', { ascending: false })
      .limit(50);

    if (injuries) {
      for (const inj of injuries) {
        const emoji = inj.status === 'OUT' ? '🚨' : inj.status === 'QUESTIONABLE' ? '⚠️' : '📋';
        const headline = `${emoji} ${inj.player_name} (${inj.status}): ${inj.injury_detail || inj.injury_type || 'Injury'}`;
        
        // Try to match with existing game or create placeholder
        const matchingGame = Array.from(gamesMap.values()).find(
          g => g.home_team?.includes(inj.team_name) || g.away_team?.includes(inj.team_name)
        );

        if (matchingGame) {
          newsItems.push({
            ...matchingGame,
            news_type: 'injury',
            headline: truncateHeadline(headline),
            impact_level: inj.is_star_player ? 'high' : 'medium',
            market_impact: inj.is_star_player || false,
            source_table: 'injury_reports',
            source_id: inj.id,
            player_name: inj.player_name,
          });
        }
      }
    }

    // 3. Get trap probability alerts (high trap score)
    const { data: traps } = await supabase
      .from('trap_probability_analysis')
      .select('*')
      .gte('trap_probability', 60)
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order('trap_probability', { ascending: false })
      .limit(30);

    if (traps) {
      for (const trap of traps) {
        const headline = `🚫 TRAP ALERT: ${trap.outcome_name} (${trap.trap_probability}% trap risk)`;
        
        if (gamesMap.has(trap.event_id)) {
          newsItems.push({
            ...gamesMap.get(trap.event_id),
            news_type: 'trap_alert',
            headline: truncateHeadline(headline),
            impact_level: trap.trap_probability >= 75 ? 'high' : 'medium',
            market_impact: true,
            source_table: 'trap_probability_analysis',
            source_id: trap.id,
          });
        }
      }
    }

    // 4. Get God Mode upset predictions
    const { data: upsets } = await supabase
      .from('god_mode_upset_predictions')
      .select('*')
      .gte('commence_time', now)
      .gte('upset_probability', 0.25)
      .order('upset_probability', { ascending: false })
      .limit(20);

    if (upsets) {
      for (const upset of upsets) {
        const prob = Math.round(upset.upset_probability * 100);
        const headline = `🎲 God Mode: ${upset.underdog} upset potential at ${prob}%`;
        
        if (!gamesMap.has(upset.event_id)) {
          gamesMap.set(upset.event_id, {
            event_id: upset.event_id,
            sport: upset.sport || 'basketball_nba',
            home_team: upset.home_team,
            away_team: upset.away_team,
            commence_time: upset.commence_time,
          });
        }

        newsItems.push({
          ...gamesMap.get(upset.event_id),
          news_type: 'upset_signal',
          headline: truncateHeadline(headline),
          impact_level: upset.chaos_mode_active ? 'high' : 'medium',
          market_impact: upset.upset_probability >= 0.35,
          source_table: 'god_mode_upset_predictions',
          source_id: upset.id,
        });
      }
    }

    console.log(`[game-news-aggregator] Collected ${newsItems.length} news items from ${gamesMap.size} games`);

    // 5. Upsert upcoming games cache
    const gamesList = Array.from(gamesMap.values());
    if (gamesList.length > 0) {
      const gamesWithCounts = gamesList.map(game => {
        const gameNews = newsItems.filter(n => n.event_id === game.event_id);
        const highImpactCount = gameNews.filter(n => n.impact_level === 'high').length;
        return {
          ...game,
          news_count: gameNews.length,
          last_news_at: now,
          activity_score: gameNews.length + (highImpactCount * 3),
          updated_at: now,
        };
      });

      const { error: gamesError } = await supabase
        .from('upcoming_games_cache')
        .upsert(gamesWithCounts, { onConflict: 'event_id' });

      if (gamesError) {
        console.error('[game-news-aggregator] Error upserting games:', gamesError);
      }
    }

    // 6. Insert news items (dedupe by source_table + source_id)
    if (newsItems.length > 0) {
      // Only insert recent news to avoid duplicates
      for (const item of newsItems.slice(0, 50)) {
        const { error } = await supabase
          .from('game_news_feed')
          .upsert({
            ...item,
            expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          }, { 
            onConflict: 'id',
            ignoreDuplicates: true 
          });

        if (error && !error.message.includes('duplicate')) {
          console.error('[game-news-aggregator] Error inserting news:', error);
        }
      }
    }

    // 7. Clean up expired news
    await supabase
      .from('game_news_feed')
      .delete()
      .lt('expires_at', now);

    return new Response(
      JSON.stringify({
        success: true,
        games_processed: gamesMap.size,
        news_items: newsItems.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('[game-news-aggregator] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
