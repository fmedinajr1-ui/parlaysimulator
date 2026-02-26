import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function getEasternDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function normalizePropType(raw: string): string {
  const s = (raw || '').replace(/^(player_|batter_|pitcher_)/, '').toLowerCase().trim();
  if (/points.*rebounds.*assists|pts.*rebs.*asts|^pra$/.test(s)) return 'pra';
  if (/points.*rebounds|pts.*rebs|^pr$/.test(s)) return 'pr';
  if (/points.*assists|pts.*asts|^pa$/.test(s)) return 'pa';
  if (/rebounds.*assists|rebs.*asts|^ra$/.test(s)) return 'ra';
  if (/three_pointers|threes_made|^threes$/.test(s)) return 'threes';
  return s;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const today = getEasternDate();
    console.log(`[DoubleConfirmed] Scanning for ${today}...`);

    // Fetch both data sources in parallel
    const [sweetSpotsRes, mispricedRes] = await Promise.all([
      supabase
        .from('category_sweet_spots')
        .select('player_name, prop_type, recommended_side, l10_hit_rate, l10_avg, actual_line, category')
        .eq('analysis_date', today)
        .gte('l10_hit_rate', 0.70),
      supabase
        .from('mispriced_lines')
        .select('player_name, prop_type, signal, edge_pct, book_line, player_avg_l10, sport, confidence_tier')
        .eq('analysis_date', today)
        .gte('edge_pct', 15),
    ]);

    const sweetSpots = sweetSpotsRes.data || [];
    const mispricedLines = mispricedRes.data || [];

    console.log(`[DoubleConfirmed] Sweet spots (70%+ L10): ${sweetSpots.length}, Mispriced (15%+ edge): ${mispricedLines.length}`);

    // Build sweet spot map: key = lowercase(player_name)|normalized(prop_type)
    const sweetSpotMap = new Map<string, typeof sweetSpots[0]>();
    for (const ss of sweetSpots) {
      const key = `${(ss.player_name || '').toLowerCase()}|${normalizePropType(ss.prop_type)}`;
      // Keep the one with highest hit rate if duplicates
      const existing = sweetSpotMap.get(key);
      if (!existing || (ss.l10_hit_rate || 0) > (existing.l10_hit_rate || 0)) {
        sweetSpotMap.set(key, ss);
      }
    }

    // Cross-reference mispriced lines against sweet spots
    interface DoubleConfirmedPick {
      player_name: string;
      prop_type: string;
      side: string;
      l10_hit_rate: number;
      edge_pct: number;
      book_line: number;
      player_avg_l10: number;
      sport: string;
      confidence_tier: string;
      composite_score: number;
      category: string;
    }

    const doubleConfirmed: DoubleConfirmedPick[] = [];

    for (const ml of mispricedLines) {
      const key = `${(ml.player_name || '').toLowerCase()}|${normalizePropType(ml.prop_type)}`;
      const ss = sweetSpotMap.get(key);
      if (!ss) continue;

      // Check direction agreement
      const mispricedSide = (ml.signal || '').toUpperCase();
      const sweetSpotSide = (ss.recommended_side || '').toUpperCase();

      if (mispricedSide !== sweetSpotSide) continue;

      // Both qualify: 70%+ hit rate AND 15%+ edge (already filtered in queries)
      const hitRate = ss.l10_hit_rate || 0;
      const edgePct = Math.abs(ml.edge_pct || 0);

      // Composite score: weighted combination of hit rate and edge
      const compositeScore = (hitRate * 0.6) + (edgePct * 0.4);

      doubleConfirmed.push({
        player_name: ml.player_name,
        prop_type: ml.prop_type,
        side: mispricedSide,
        l10_hit_rate: hitRate,
        edge_pct: ml.edge_pct,
        book_line: ml.book_line,
        player_avg_l10: ml.player_avg_l10,
        sport: ml.sport || 'unknown',
        confidence_tier: ml.confidence_tier || 'MEDIUM',
        composite_score: compositeScore,
        category: ss.category || '',
      });
    }

    // Sort by composite score descending
    doubleConfirmed.sort((a, b) => b.composite_score - a.composite_score);

    console.log(`[DoubleConfirmed] Found ${doubleConfirmed.length} double-confirmed picks`);

    // Send Telegram report
    if (doubleConfirmed.length > 0) {
      try {
        await fetch(`${supabaseUrl}/functions/v1/bot-send-telegram`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            type: 'double_confirmed_report',
            data: {
              picks: doubleConfirmed,
              totalSweetSpots: sweetSpots.length,
              totalMispriced: mispricedLines.length,
              date: today,
            },
          }),
        });
        console.log(`[DoubleConfirmed] Telegram report sent`);
      } catch (e) {
        console.error(`[DoubleConfirmed] Failed to send Telegram:`, e);
      }
    }

    const sportBreakdown: Record<string, number> = {};
    for (const p of doubleConfirmed) {
      sportBreakdown[p.sport] = (sportBreakdown[p.sport] || 0) + 1;
    }

    return new Response(JSON.stringify({
      success: true,
      date: today,
      doubleConfirmedCount: doubleConfirmed.length,
      totalSweetSpots: sweetSpots.length,
      totalMispriced: mispricedLines.length,
      sportBreakdown,
      picks: doubleConfirmed,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[DoubleConfirmed] Error:', err);
    return new Response(JSON.stringify({
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
