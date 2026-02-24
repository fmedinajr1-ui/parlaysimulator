import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function getEasternDate(daysAgo = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
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

function formatPropType(pt: string): string {
  return (pt || '')
    .replace(/^player_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const today = getEasternDate(0);
    const yesterday = getEasternDate(1);
    console.log(`[RecurringWinners] Scanning: yesterday=${yesterday}, today=${today}`);

    // Fetch yesterday's hits and today's sweet spots in parallel
    const [yesterdayRes, todayRes, priorStreaksRes] = await Promise.all([
      supabase
        .from('category_sweet_spots')
        .select('player_name, prop_type, recommended_side, actual_line, actual_value, l10_hit_rate')
        .eq('analysis_date', yesterday)
        .eq('outcome', 'hit'),
      supabase
        .from('category_sweet_spots')
        .select('player_name, prop_type, recommended_side, actual_line, l10_hit_rate, l10_avg')
        .eq('analysis_date', today)
        .gte('l10_hit_rate', 80),
      supabase
        .from('recurring_winners')
        .select('player_name, prop_type, streak_days')
        .eq('analysis_date', yesterday),
    ]);

    const yesterdayHits = yesterdayRes.data || [];
    const todaySpots = todayRes.data || [];
    const priorStreaks = priorStreaksRes.data || [];

    console.log(`[RecurringWinners] Yesterday hits: ${yesterdayHits.length}, Today 80%+ spots: ${todaySpots.length}, Prior streaks: ${priorStreaks.length}`);

    // Build yesterday hits map: key = player_name|prop_type|side
    const yesterdayMap = new Map<string, typeof yesterdayHits[0]>();
    for (const h of yesterdayHits) {
      const key = `${(h.player_name || '').toLowerCase()}|${normalizePropType(h.prop_type || '')}|${(h.recommended_side || '').toUpperCase()}`;
      const existing = yesterdayMap.get(key);
      if (!existing || (h.l10_hit_rate || 0) > (existing.l10_hit_rate || 0)) {
        yesterdayMap.set(key, h);
      }
    }

    // Build prior streak map
    const streakMap = new Map<string, number>();
    for (const s of priorStreaks) {
      const key = `${(s.player_name || '').toLowerCase()}|${normalizePropType(s.prop_type || '')}`;
      streakMap.set(key, s.streak_days || 2);
    }

    // Match today's spots against yesterday's hits
    interface RecurringWinner {
      analysis_date: string;
      player_name: string;
      prop_type: string;
      recommended_side: string;
      yesterday_line: number | null;
      yesterday_actual: number | null;
      today_line: number | null;
      today_l10_hit_rate: number | null;
      today_l10_avg: number | null;
      streak_days: number;
      composite_score: number;
    }

    const winners: RecurringWinner[] = [];
    const seen = new Set<string>();

    for (const spot of todaySpots) {
      const key = `${(spot.player_name || '').toLowerCase()}|${normalizePropType(spot.prop_type || '')}|${(spot.recommended_side || '').toUpperCase()}`;
      const dedupeKey = `${(spot.player_name || '').toLowerCase()}|${normalizePropType(spot.prop_type || '')}`;

      if (seen.has(dedupeKey)) continue;

      const yHit = yesterdayMap.get(key);
      if (!yHit) continue;

      seen.add(dedupeKey);

      // Streak detection
      const priorStreak = streakMap.get(dedupeKey) || 1;
      const streakDays = priorStreak + 1; // They hit yesterday, so at least 2

      const hitRate = spot.l10_hit_rate || 0;
      const edge = Math.abs((spot.l10_avg || 0) - (spot.actual_line || 0));
      const compositeScore = (hitRate * 0.5) + (streakDays * 10) + (edge * 0.3);

      winners.push({
        analysis_date: today,
        player_name: spot.player_name,
        prop_type: spot.prop_type,
        recommended_side: (spot.recommended_side || '').toUpperCase(),
        yesterday_line: yHit.actual_line,
        yesterday_actual: yHit.actual_value,
        today_line: spot.actual_line,
        today_l10_hit_rate: hitRate,
        today_l10_avg: spot.l10_avg,
        streak_days: streakDays,
        composite_score: Math.round(compositeScore * 100) / 100,
      });
    }

    // Sort by composite score descending
    winners.sort((a, b) => b.composite_score - a.composite_score);

    console.log(`[RecurringWinners] Found ${winners.length} recurring winners`);

    // Upsert into recurring_winners
    if (winners.length > 0) {
      const { error: upsertError } = await supabase
        .from('recurring_winners')
        .upsert(winners, { onConflict: 'analysis_date,player_name,prop_type' });

      if (upsertError) {
        console.error('[RecurringWinners] Upsert error:', upsertError);
      }
    }

    // Send Telegram report
    if (winners.length > 0) {
      const streakPlayers = winners.filter(w => w.streak_days >= 3);
      const repeatHitters = winners.filter(w => w.streak_days < 3);

      let report = `🔄 RECURRING WINNERS — ${today}\n\n`;

      if (streakPlayers.length > 0) {
        report += `🔥 STREAK PLAYERS (${streakPlayers.length}):\n`;
        for (const w of streakPlayers) {
          report += `  ${w.player_name} | ${formatPropType(w.prop_type)} ${w.recommended_side} ${w.today_line ?? '?'} | ${w.today_l10_hit_rate}% L10 | ${w.streak_days}-day streak\n`;
        }
        report += '\n';
      }

      if (repeatHitters.length > 0) {
        report += `✅ REPEAT HITTERS (${repeatHitters.length}):\n`;
        for (const w of repeatHitters) {
          report += `  ${w.player_name} | ${formatPropType(w.prop_type)} ${w.recommended_side} ${w.today_line ?? '?'} | ${w.today_l10_hit_rate}% L10\n`;
        }
        report += '\n';
      }

      report += `Total: ${winners.length} recurring winners from ${todaySpots.length} sweet spots`;

      try {
        await fetch(`${supabaseUrl}/functions/v1/bot-send-telegram`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            type: 'recurring_winners_report',
            data: { message: report, winners, date: today },
          }),
        });
        console.log('[RecurringWinners] Telegram report sent');
      } catch (e) {
        console.error('[RecurringWinners] Telegram failed:', e);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      date: today,
      yesterdayHits: yesterdayHits.length,
      todaySweetSpots: todaySpots.length,
      recurringWinners: winners.length,
      streakPlayers: winners.filter(w => w.streak_days >= 3).length,
      winners,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[RecurringWinners] Error:', err);
    return new Response(JSON.stringify({
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
