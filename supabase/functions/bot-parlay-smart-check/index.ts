import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface LegCheck {
  parlay_id: string;
  leg_index: number;
  player_name: string;
  prop_type: string;
  line: number;
  side: string;
  team: string | null;
  risk_tags: string[];
  recommendation: 'KEEP' | 'FLIP' | 'DROP' | 'CAUTION';
  details: Record<string, any>;
  quality_score: number;
}

const TAG_SCORE_ADJUSTMENTS: Record<string, number> = {
  'L3_CONFIRMED': 15,
  'ELITE_MATCHUP': 10,
  'PRIME_MATCHUP': 5,
  'L3_BELOW_LINE': -10,
  'L3_ABOVE_LINE': -10,
  'L3_DECLINE': -20,
  'L3_SURGE': -15,
  'BLOWOUT_RISK': -15,
  'ELEVATED_SPREAD': -5,
  'PLAYER_OUT': -50,
  'PLAYER_DOUBTFUL': -30,
  'PLAYER_QUESTIONABLE': -10,
  'AVOID_MATCHUP': -10,
  'NO_L3_DATA': -5,
  'NO_MATCHUP_DATA': 0,
  'ROLE_PLAYER_VOLATILE': -15,
};

function computeQualityScore(riskTags: string[]): number {
  let score = 50;
  for (const tag of riskTags) {
    const baseTag = tag.replace(/\(.*\)/, '');
    score += TAG_SCORE_ADJUSTMENTS[baseTag] ?? 0;
  }
  return Math.max(0, Math.min(100, score));
}

interface ParlayCheckResult {
  parlay_id: string;
  strategy_name: string;
  tier: string | null;
  leg_count: number;
  legs: LegCheck[];
  summary: { keeps: number; flips: number; drops: number; cautions: number };
  avg_quality: number;
}

function getEasternDate(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { checks = ['l3', 'blowout', 'injury', 'bidirectional'], parlay_ids } = await req.json().catch(() => ({}));
    const today = getEasternDate();

    // 1. Fetch today's pending parlays
    let query = supabase
      .from('bot_daily_parlays')
      .select('*')
      .eq('parlay_date', today)
      .eq('outcome', 'pending');

    if (parlay_ids?.length) {
      query = query.in('id', parlay_ids);
    }

    const { data: parlays, error: parlayErr } = await query;
    if (parlayErr) throw parlayErr;
    if (!parlays?.length) {
      return new Response(JSON.stringify({ results: [], message: 'No pending parlays for today' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Collect all unique player names and teams from all legs
    const allLegs: { parlay_id: string; idx: number; player_name: string; prop_type: string; line: number; side: string; team: string | null }[] = [];
    for (const p of parlays) {
      const legs = Array.isArray(p.legs) ? p.legs : [];
      legs.forEach((leg: any, idx: number) => {
        allLegs.push({
          parlay_id: p.id,
          idx,
          player_name: leg.player_name || '',
          prop_type: leg.prop_type || leg.market_type || '',
          line: leg.line || 0,
          side: (leg.side || 'over').toLowerCase(),
          team: leg.team || null,
        });
      });
    }

    const playerNames = [...new Set(allLegs.map(l => l.player_name).filter(Boolean))];
    const teams = [...new Set(allLegs.map(l => l.team).filter(Boolean))];

    // 2. Pre-fetch data for each check type in parallel
    const fetchPromises: Record<string, Promise<any>> = {};

    if (checks.includes('l3')) {
      fetchPromises.sweetSpots = supabase
        .from('category_sweet_spots')
        .select('player_name, prop_type, l3_avg, l10_avg, l10_hit_rate, l10_min, l10_max, recommended_line, analysis_date')
        .eq('analysis_date', today)
        .in('player_name', playerNames.length ? playerNames : ['__none__'])
        .then(r => r.data || []);
    }

    if (checks.includes('blowout')) {
      fetchPromises.spreads = supabase
        .from('whale_picks')
        .select('team, spread, game_date')
        .eq('game_date', today)
        .then(r => r.data || []);
    }

    if (checks.includes('injury')) {
      fetchPromises.injuries = supabase
        .from('lineup_alerts')
        .select('player_name, status, injury_type, alert_date')
        .gte('alert_date', today)
        .in('player_name', playerNames.length ? playerNames : ['__none__'])
        .then(r => r.data || []);
    }

    if (checks.includes('bidirectional')) {
      fetchPromises.matchups = supabase
        .from('bot_research_findings')
        .select('title, summary, key_insights, category')
        .eq('research_date', today)
        .eq('category', 'matchup_scan')
        .then(r => r.data || []);
    }

    const resolved = await Promise.all(
      Object.entries(fetchPromises).map(async ([key, promise]) => [key, await promise])
    );
    const data: Record<string, any[]> = Object.fromEntries(resolved);

    // Build lookup maps
    const sweetSpotMap = new Map<string, any>();
    (data.sweetSpots || []).forEach((ss: any) => {
      sweetSpotMap.set(`${ss.player_name}::${ss.prop_type}`.toLowerCase(), ss);
    });

    const spreadMap = new Map<string, number>();
    (data.spreads || []).forEach((s: any) => {
      if (s.team && s.spread != null) {
        spreadMap.set(s.team.toUpperCase(), Number(s.spread));
      }
    });

    const injuryMap = new Map<string, string>();
    (data.injuries || []).forEach((inj: any) => {
      injuryMap.set(inj.player_name.toLowerCase(), (inj.status || '').toUpperCase());
    });

    // Parse matchup tiers from research findings
    const matchupTierMap = new Map<string, string>();
    (data.matchups || []).forEach((m: any) => {
      try {
        const insights = typeof m.key_insights === 'string' ? JSON.parse(m.key_insights) : m.key_insights;
        if (Array.isArray(insights)) {
          insights.forEach((i: any) => {
            if (i.team && i.tier) {
              matchupTierMap.set(i.team.toUpperCase(), i.tier);
            }
          });
        }
      } catch {}
    });

    // 3. Analyze each leg
    const results: ParlayCheckResult[] = [];

    for (const parlay of parlays) {
      const legs = Array.isArray(parlay.legs) ? parlay.legs : [];
      const legChecks: LegCheck[] = [];

      legs.forEach((leg: any, idx: number) => {
        const playerName = leg.player_name || '';
        const propType = leg.prop_type || leg.market_type || '';
        const line = leg.line || 0;
        const side = (leg.side || 'over').toLowerCase();
        const team = (leg.team || '').toUpperCase();

        const riskTags: string[] = [];
        const details: Record<string, any> = {};
        let recommendation: 'KEEP' | 'FLIP' | 'DROP' | 'CAUTION' = 'KEEP';

        // L3 Check
        if (checks.includes('l3')) {
          const key = `${playerName}::${propType}`.toLowerCase();
          const ss = sweetSpotMap.get(key);
          if (ss) {
            details.l3_avg = ss.l3_avg;
            details.l10_avg = ss.l10_avg;
            details.l10_hit_rate = ss.l10_hit_rate;

            if (ss.l3_avg != null) {
              if (side === 'over' && ss.l3_avg < line) {
                riskTags.push('L3_BELOW_LINE');
                details.l3_vs_line = `${ss.l3_avg} < ${line}`;
                if (recommendation === 'KEEP') recommendation = 'CAUTION';
              } else if (side === 'over' && ss.l3_avg >= line) {
                riskTags.push('L3_CONFIRMED');
              } else if (side === 'under' && ss.l3_avg > line) {
                riskTags.push('L3_ABOVE_LINE');
                details.l3_vs_line = `${ss.l3_avg} > ${line}`;
                if (recommendation === 'KEEP') recommendation = 'CAUTION';
              } else if (side === 'under' && ss.l3_avg <= line) {
                riskTags.push('L3_CONFIRMED');
              }

              if (ss.l10_avg && ss.l3_avg / ss.l10_avg < 0.80) {
                riskTags.push('L3_DECLINE');
                if (side === 'over') {
                  recommendation = 'FLIP';
                  details.flip_reason = `L3 decline: ${ss.l3_avg} vs L10 ${ss.l10_avg}`;
                }
              }
              if (ss.l10_avg && ss.l3_avg / ss.l10_avg > 1.20) {
                riskTags.push('L3_SURGE');
                if (side === 'under') {
                  recommendation = 'FLIP';
                  details.flip_reason = `L3 surge: ${ss.l3_avg} vs L10 ${ss.l10_avg}`;
                }
              }
            }
          } else {
            riskTags.push('NO_L3_DATA');
          }
        }

        // Role-Player Volatility Check (low-floor props with deceptively high hit rates)
        if (checks.includes('l3')) {
          const LOW_FLOOR_THRESHOLDS: Record<string, number> = {
            rebounds: 4.5, reb: 4.5, total_rebounds: 4.5, player_rebounds: 4.5,
            assists: 4.5, ast: 4.5, player_assists: 4.5,
            steals: 1.5, stl: 1.5, player_steals: 1.5,
            blocks: 1.5, blk: 1.5, player_blocks: 1.5,
            threes: 2.5, '3pm': 2.5, three_pointers: 2.5, player_threes: 2.5,
          };
          const volatileThreshold = LOW_FLOOR_THRESHOLDS[propType.toLowerCase()];
          if (volatileThreshold != null && line <= volatileThreshold && side === 'over') {
            const key = `${playerName}::${propType}`.toLowerCase();
            const ss = sweetSpotMap.get(key);
            if (ss && ss.l10_hit_rate != null && ss.l10_hit_rate >= 0.70 && ss.l10_avg != null) {
              const marginOverLine = ss.l10_avg - line;
              if (marginOverLine < 1.5) {
                riskTags.push('ROLE_PLAYER_VOLATILE');
                details.volatile_reason = `Low-floor prop (${line} ${propType}) with thin margin (avg ${ss.l10_avg}) — bench player variance risk`;
                if (recommendation === 'KEEP') recommendation = 'CAUTION';
              }
            }
          }
        }

        // Blowout Check
        if (checks.includes('blowout') && team) {
          const spread = spreadMap.get(team);
          if (spread != null) {
            details.spread = spread;
            if (Math.abs(spread) >= 10 && side === 'over') {
              riskTags.push(`BLOWOUT_RISK(${spread > 0 ? '+' : ''}${spread})`);
              if (recommendation !== 'DROP') recommendation = 'CAUTION';
            } else if (Math.abs(spread) >= 7 && side === 'over') {
              riskTags.push(`ELEVATED_SPREAD(${spread > 0 ? '+' : ''}${spread})`);
            }
          }
        }

        // Injury Check
        if (checks.includes('injury')) {
          const status = injuryMap.get(playerName.toLowerCase());
          if (status) {
            details.injury_status = status;
            if (status === 'OUT' || status === 'O') {
              riskTags.push('PLAYER_OUT');
              recommendation = 'DROP';
            } else if (status === 'DOUBTFUL' || status === 'D') {
              riskTags.push('PLAYER_DOUBTFUL');
              recommendation = 'DROP';
            } else if (status === 'QUESTIONABLE' || status === 'Q' || status === 'GTD') {
              riskTags.push('PLAYER_QUESTIONABLE');
              if (recommendation === 'KEEP') recommendation = 'CAUTION';
            }
          }
        }

        // Bidirectional Check
        if (checks.includes('bidirectional') && team) {
          const tier = matchupTierMap.get(team);
          if (tier) {
            details.matchup_tier = tier;
            if (tier === 'elite' || tier === 'prime') {
              riskTags.push(`${tier.toUpperCase()}_MATCHUP`);
            } else if (tier === 'avoid') {
              riskTags.push('AVOID_MATCHUP');
              if (recommendation === 'KEEP') recommendation = 'CAUTION';
            }
          } else {
            riskTags.push('NO_MATCHUP_DATA');
          }
        }

        const quality_score = computeQualityScore(riskTags);

        legChecks.push({
          parlay_id: parlay.id,
          leg_index: idx,
          player_name: playerName,
          prop_type: propType,
          line,
          side,
          team: leg.team || null,
          risk_tags: riskTags,
          recommendation,
          details,
          quality_score,
        });
      });

      // Sort legs by quality_score ascending (worst first)
      legChecks.sort((a, b) => a.quality_score - b.quality_score);

      const summary = {
        keeps: legChecks.filter(l => l.recommendation === 'KEEP').length,
        flips: legChecks.filter(l => l.recommendation === 'FLIP').length,
        drops: legChecks.filter(l => l.recommendation === 'DROP').length,
        cautions: legChecks.filter(l => l.recommendation === 'CAUTION').length,
      };

      const avg_quality = legChecks.length > 0
        ? Math.round(legChecks.reduce((s, l) => s + l.quality_score, 0) / legChecks.length)
        : 50;

      results.push({
        parlay_id: parlay.id,
        strategy_name: parlay.strategy_name,
        tier: parlay.tier,
        leg_count: legs.length,
        legs: legChecks,
        summary,
        avg_quality,
      });
    }

    const totalIssues = results.reduce((s, r) => s + r.summary.flips + r.summary.drops + r.summary.cautions, 0);

    return new Response(JSON.stringify({
      results,
      checks_run: checks,
      parlays_checked: results.length,
      total_issues: totalIssues,
      checked_at: new Date().toISOString(),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Smart check error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
