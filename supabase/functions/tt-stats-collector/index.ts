/**
 * tt-stats-collector
 * 
 * Collects table tennis player statistics via Perplexity AI for the
 * Over Total Points scoring model. Populates tt_match_stats with:
 * - Average Match Total (AMT)
 * - Average Period/Set Total (APT)
 * - Set distribution percentages (p3, p4, p5)
 * - Recent Over rate
 * - Standard deviation of match totals
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TTPlayerStats {
  player_name: string;
  avg_match_total: number;
  avg_period_total: number;
  pct_3_sets: number;
  pct_4_sets: number;
  pct_5_sets: number;
  recent_over_rate: number;
  std_dev_total: number;
  sample_size: number;
  league?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const perplexityKey = Deno.env.get('PERPLEXITY_API_KEY');
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // 1. Get upcoming tennis_pingpong events from game_bets
    const { data: ttEvents } = await supabase
      .from('game_bets')
      .select('home_team, away_team, event_id, sport')
      .ilike('sport', '%pingpong%')
      .gte('commence_time', new Date().toISOString())
      .order('commence_time', { ascending: true })
      .limit(20);

    if (!ttEvents || ttEvents.length === 0) {
      console.log('[TT Stats] No upcoming table tennis events found');
      return new Response(JSON.stringify({ 
        message: 'No upcoming table tennis events', 
        players_updated: 0 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Extract unique player names
    const playerNames = new Set<string>();
    for (const event of ttEvents) {
      if (event.home_team) playerNames.add(event.home_team.trim());
      if (event.away_team) playerNames.add(event.away_team.trim());
    }

    console.log(`[TT Stats] Found ${ttEvents.length} events, ${playerNames.size} unique players`);

    // 2. Check which players need updates (stale > 12 hours)
    const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    const { data: freshStats } = await supabase
      .from('tt_match_stats')
      .select('player_name')
      .in('player_name', Array.from(playerNames))
      .gte('last_updated', twelveHoursAgo);

    const freshSet = new Set((freshStats || []).map(s => s.player_name));
    const stalePlayerNames = Array.from(playerNames).filter(p => !freshSet.has(p));

    if (stalePlayerNames.length === 0) {
      console.log('[TT Stats] All players have fresh stats');
      return new Response(JSON.stringify({ 
        message: 'All player stats are fresh', 
        players_updated: 0 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!perplexityKey) {
      console.error('[TT Stats] PERPLEXITY_API_KEY not configured');
      return new Response(JSON.stringify({ error: 'Missing API key' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3. Query Perplexity for player stats (batch players in groups of 5)
    const batches = [];
    const playerArray = stalePlayerNames.slice(0, 20); // Cap at 20 players
    for (let i = 0; i < playerArray.length; i += 5) {
      batches.push(playerArray.slice(i, i + 5));
    }

    let totalUpdated = 0;

    for (const batch of batches) {
      const playerList = batch.join(', ');
      
      const query = `For these table tennis players: ${playerList}

For EACH player provide:
1. Average total points per match (last 10-15 matches, best-of-5 format). Typical range: 70-95 points.
2. Average points per set (typical range: 18-24 points per set)
3. Percentage of matches ending in 3 sets, 4 sets, and 5 sets (must sum to ~100%)
4. Recent over/under rate against posted totals (last 10+ matches)
5. Standard deviation of their match totals
6. Sample size (number of recent matches analyzed)
7. League/tour they primarily compete in (ITTF, WTT, T2, etc.)

Format each player as:
PLAYER: [name]
AMT: [avg match total]
APT: [avg period total]  
P3: [pct 3 sets as decimal, e.g. 0.40]
P4: [pct 4 sets as decimal]
P5: [pct 5 sets as decimal]
RO: [recent over rate as decimal]
SD: [std dev]
N: [sample size]
LEAGUE: [league name]`;

      try {
        const response = await fetch('https://api.perplexity.ai/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${perplexityKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'sonar',
            messages: [
              {
                role: 'system',
                content: 'You are a table tennis statistics analyst. Provide precise numerical stats for professional table tennis players. Use best-of-5 match format (11-point sets). If exact data is unavailable, provide reasonable estimates based on player ranking and recent tournament results. Always include all requested fields.',
              },
              { role: 'user', content: query },
            ],
            search_recency_filter: 'week',
          }),
        });

        if (!response.ok) {
          console.error(`[TT Stats] Perplexity error: ${response.status}`);
          continue;
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '';

        // Parse the structured response
        const players = parsePlayerStats(content, batch);
        
        for (const stats of players) {
          const { error } = await supabase
            .from('tt_match_stats')
            .upsert({
              player_name: stats.player_name,
              avg_match_total: stats.avg_match_total,
              avg_period_total: stats.avg_period_total,
              pct_3_sets: stats.pct_3_sets,
              pct_4_sets: stats.pct_4_sets,
              pct_5_sets: stats.pct_5_sets,
              recent_over_rate: stats.recent_over_rate,
              std_dev_total: stats.std_dev_total,
              sample_size: stats.sample_size,
              league: stats.league,
              last_updated: new Date().toISOString(),
            }, { onConflict: 'player_name' });

          if (!error) {
            totalUpdated++;
            console.log(`[TT Stats] Updated: ${stats.player_name} (AMT=${stats.avg_match_total}, RO=${stats.recent_over_rate})`);
          } else {
            console.error(`[TT Stats] Upsert error for ${stats.player_name}:`, error.message);
          }
        }
      } catch (err) {
        console.error(`[TT Stats] Batch error:`, err);
      }
    }

    const result = {
      events_found: ttEvents.length,
      players_total: playerNames.size,
      players_stale: stalePlayerNames.length,
      players_updated: totalUpdated,
    };

    console.log('[TT Stats] Complete:', result);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[TT Stats] Fatal error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function parsePlayerStats(content: string, expectedPlayers: string[]): TTPlayerStats[] {
  const results: TTPlayerStats[] = [];
  
  // Split by PLAYER: markers
  const sections = content.split(/PLAYER:\s*/i).filter(s => s.trim());
  
  for (const section of sections) {
    const lines = section.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;

    const playerName = lines[0].replace(/[*_]/g, '').trim();
    
    // Match against expected players (fuzzy)
    const matchedPlayer = expectedPlayers.find(p => 
      playerName.toLowerCase().includes(p.toLowerCase()) ||
      p.toLowerCase().includes(playerName.toLowerCase())
    ) || playerName;

    const extract = (key: string, fallback: number): number => {
      const regex = new RegExp(`${key}:\\s*([\\d.]+)`, 'i');
      for (const line of lines) {
        const match = line.match(regex);
        if (match) return parseFloat(match[1]) || fallback;
      }
      return fallback;
    };

    const extractString = (key: string, fallback: string): string => {
      const regex = new RegExp(`${key}:\\s*(.+)`, 'i');
      for (const line of lines) {
        const match = line.match(regex);
        if (match) return match[1].trim();
      }
      return fallback;
    };

    const amt = extract('AMT', 80);
    const apt = extract('APT', 20);
    let p3 = extract('P3', 0.40);
    let p4 = extract('P4', 0.35);
    let p5 = extract('P5', 0.25);
    
    // Normalize set distribution to sum to 1.0
    const pSum = p3 + p4 + p5;
    if (pSum > 0 && Math.abs(pSum - 1.0) > 0.05) {
      p3 = p3 / pSum;
      p4 = p4 / pSum;
      p5 = p5 / pSum;
    }

    const ro = extract('RO', 0.50);
    const sd = extract('SD', 8);
    const n = extract('N', 0);
    const league = extractString('LEAGUE', 'ITTF');

    // Sanity checks — clamp to reasonable ranges
    results.push({
      player_name: matchedPlayer,
      avg_match_total: Math.max(60, Math.min(120, amt)),
      avg_period_total: Math.max(15, Math.min(30, apt)),
      pct_3_sets: Math.max(0, Math.min(1, p3)),
      pct_4_sets: Math.max(0, Math.min(1, p4)),
      pct_5_sets: Math.max(0, Math.min(1, p5)),
      recent_over_rate: Math.max(0, Math.min(1, ro)),
      std_dev_total: Math.max(3, Math.min(20, sd)),
      sample_size: Math.max(0, Math.round(n)),
      league,
    });
  }

  // For any expected players not parsed, add defaults
  for (const player of expectedPlayers) {
    if (!results.find(r => r.player_name.toLowerCase() === player.toLowerCase())) {
      results.push({
        player_name: player,
        avg_match_total: 80,
        avg_period_total: 20,
        pct_3_sets: 0.40,
        pct_4_sets: 0.35,
        pct_5_sets: 0.25,
        recent_over_rate: 0.50,
        std_dev_total: 8,
        sample_size: 0,
      });
    }
  }

  return results;
}
