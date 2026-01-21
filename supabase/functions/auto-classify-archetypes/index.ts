import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Archetype classification rules based on stats
// Priority order: first match wins
interface ArchetypeRule {
  name: string;
  priority: number;
  condition: (stats: PlayerStats) => boolean;
  description: string;
}

interface PlayerStats {
  player_name: string;
  avg_points: number;
  avg_rebounds: number;
  avg_assists: number;
  avg_threes: number;
  avg_blocks: number;
  avg_steals: number;
  avg_minutes: number;
  games_played: number;
}

const ARCHETYPE_RULES: ArchetypeRule[] = [
  {
    name: 'ELITE_REBOUNDER',
    priority: 1,
    condition: (s) => s.avg_rebounds >= 9.0,
    description: 'Dominant rebounder (9+ RPG)'
  },
  {
    name: 'RIM_PROTECTOR',
    priority: 2,
    condition: (s) => s.avg_blocks >= 2.0 && s.avg_rebounds >= 6.0,
    description: 'Shot blocker + rebounder (2+ BPG, 6+ RPG)'
  },
  {
    name: 'GLASS_CLEANER',
    priority: 3,
    condition: (s) => s.avg_rebounds >= 7.0 && s.avg_rebounds < 9.0,
    description: 'Strong rebounder (7-9 RPG)'
  },
  {
    name: 'ELITE_PLAYMAKER',
    priority: 4,
    condition: (s) => s.avg_assists >= 8.0,
    description: 'Elite distributor (8+ APG)'
  },
  {
    name: 'PLAYMAKER',
    priority: 5,
    condition: (s) => s.avg_assists >= 6.0,
    description: 'Primary playmaker (6+ APG)'
  },
  {
    name: 'PRIMARY_SCORER',
    priority: 6,
    condition: (s) => s.avg_points >= 24.0 && s.avg_minutes >= 32,
    description: 'High volume scorer (24+ PPG, 32+ MPG)'
  },
  {
    name: 'PURE_SHOOTER',
    priority: 7,
    condition: (s) => s.avg_threes >= 2.5 && s.avg_points >= 12.0,
    description: '3PT specialist (2.5+ 3PM, 12+ PPG)'
  },
  {
    name: 'SCORING_WING',
    priority: 8,
    condition: (s) => s.avg_points >= 18.0 && s.avg_threes >= 1.5,
    description: 'Scoring wing player (18+ PPG, 1.5+ 3PM)'
  },
  {
    name: 'STRETCH_BIG',
    priority: 9,
    condition: (s) => s.avg_rebounds >= 5.0 && s.avg_threes >= 1.5,
    description: 'Rebounding big who shoots 3s (5+ RPG, 1.5+ 3PM)'
  },
  {
    name: 'COMBO_GUARD',
    priority: 10,
    condition: (s) => s.avg_assists >= 4.0 && s.avg_points >= 12.0 && s.avg_assists < 6.0,
    description: 'Scoring guard who can pass (4-6 APG, 12+ PPG)'
  },
  {
    name: 'TWO_WAY_WING',
    priority: 11,
    condition: (s) => s.avg_steals >= 1.2 && s.avg_points >= 10.0,
    description: 'Defensive wing with scoring (1.2+ SPG, 10+ PPG)'
  },
  {
    name: 'DEFENSIVE_ANCHOR',
    priority: 12,
    condition: (s) => s.avg_blocks >= 1.5 || (s.avg_steals >= 1.5 && s.avg_rebounds >= 4.0),
    description: 'Defense-first player (1.5+ BPG or 1.5+ SPG)'
  },
  {
    name: 'SCORING_GUARD',
    priority: 13,
    condition: (s) => s.avg_points >= 15.0 && s.avg_assists < 4.0,
    description: 'Shooting guard (15+ PPG, <4 APG)'
  },
  {
    name: 'ROLE_PLAYER',
    priority: 99,
    condition: () => true, // Default fallback
    description: 'Default classification'
  }
];

function classifyPlayer(stats: PlayerStats): { archetype: string; description: string } {
  // Sort by priority and find first matching rule
  const sortedRules = [...ARCHETYPE_RULES].sort((a, b) => a.priority - b.priority);
  
  for (const rule of sortedRules) {
    if (rule.condition(stats)) {
      return { archetype: rule.name, description: rule.description };
    }
  }
  
  return { archetype: 'ROLE_PLAYER', description: 'Default classification' };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  
  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    console.log('[AutoClassify] Starting auto-archetype classification...');

    // Fetch all player season stats
    const { data: playerStats, error: statsError } = await supabase
      .from('player_season_stats')
      .select('player_name, avg_points, avg_rebounds, avg_assists, avg_threes, avg_blocks, avg_steals, avg_minutes, games_played')
      .gte('games_played', 3); // Only classify players with enough data

    if (statsError) {
      console.error('[AutoClassify] Error fetching player stats:', statsError);
      throw statsError;
    }

    if (!playerStats || playerStats.length === 0) {
      console.log('[AutoClassify] No player stats found to classify');
      return new Response(JSON.stringify({
        success: true,
        classified: 0,
        message: 'No players to classify'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`[AutoClassify] Found ${playerStats.length} players with stats`);

    // Fetch existing archetypes to avoid overwriting manual overrides
    const { data: existingArchetypes } = await supabase
      .from('player_archetypes')
      .select('player_name, primary_archetype, manual_override');

    const existingMap = new Map<string, { archetype: string; isManual: boolean }>();
    (existingArchetypes || []).forEach((a: { player_name: string; primary_archetype: string; manual_override?: boolean }) => {
      existingMap.set(a.player_name.toLowerCase(), {
        archetype: a.primary_archetype,
        isManual: a.manual_override === true
      });
    });

    console.log(`[AutoClassify] Found ${existingMap.size} existing archetype entries`);

    let classified = 0;
    let inserted = 0;
    let updated = 0;
    let skippedManual = 0;
    let skippedSame = 0;
    const classifications: { player: string; archetype: string; reason: string; action: string }[] = [];

    for (const stats of playerStats) {
      const playerLower = stats.player_name.toLowerCase();
      const existing = existingMap.get(playerLower);

      // Skip if manual override
      if (existing?.isManual) {
        skippedManual++;
        continue;
      }

      // Classify the player
      const result = classifyPlayer(stats as PlayerStats);

      // Skip if already has same archetype
      if (existing?.archetype === result.archetype) {
        skippedSame++;
        continue;
      }

      const isNew = !existing;
      
      // Upsert the archetype (INSERT or UPDATE)
      const { error: upsertError } = await supabase
        .from('player_archetypes')
        .upsert({
          player_name: stats.player_name,
          primary_archetype: result.archetype,
          avg_points: stats.avg_points,
          avg_rebounds: stats.avg_rebounds,
          avg_assists: stats.avg_assists,
          avg_threes: stats.avg_threes,
          avg_minutes: stats.avg_minutes,
          games_played: stats.games_played,
          manual_override: false,
          last_updated: new Date().toISOString()
        }, { onConflict: 'player_name' });

      if (!upsertError) {
        classified++;
        if (isNew) inserted++;
        else updated++;
        
        if (classifications.length < 30) { // Log first 30 for debugging
          classifications.push({
            player: stats.player_name,
            archetype: result.archetype,
            reason: `${result.description} (${stats.avg_points}/${stats.avg_rebounds}/${stats.avg_assists})`,
            action: isNew ? 'INSERT' : 'UPDATE'
          });
        }
      } else {
        console.error(`[AutoClassify] Error upserting ${stats.player_name}:`, upsertError);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[AutoClassify] Complete: ${classified} classified (${inserted} new, ${updated} updated, ${skippedManual} manual, ${skippedSame} same) in ${duration}ms`);

    // Log sample classifications
    if (classifications.length > 0) {
      console.log('[AutoClassify] Sample classifications:');
      classifications.slice(0, 15).forEach(c => {
        console.log(`  - [${c.action}] ${c.player}: ${c.archetype}`);
      });
    }

    // Log job to history
    await supabase.from('cron_job_history').insert({
      job_name: 'auto-classify-archetypes',
      status: 'completed',
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      result: { 
        playersAnalyzed: playerStats.length,
        classified,
        inserted,
        updated,
        skippedManual,
        skippedSame,
        sampleClassifications: classifications.slice(0, 15)
      }
    });

    return new Response(JSON.stringify({
      success: true,
      playersAnalyzed: playerStats.length,
      classified,
      inserted,
      updated,
      skippedManual,
      skippedSame,
      duration,
      sampleClassifications: classifications
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[AutoClassify] Error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
