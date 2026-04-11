/**
 * mma-rounds-analyzer
 * 
 * Analyzes UFC/MMA total rounds markets for over/under value.
 * Compares Hard Rock Bet line vs consensus (FanDuel, DraftKings, BetMGM).
 * Identifies fights where HRB diverges from consensus by ≥ 0.5 rounds
 * or where odds show significant value.
 * 
 * Writes to category_sweet_spots and sends Telegram alerts.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SPORT = 'mma_mixed_martial_arts';
const MARKET = 'totals';
const HRB = 'hardrockbet';
const CONSENSUS_BOOKS = ['fanduel', 'draftkings', 'betmgm'];
const ALL_BOOKS = [HRB, ...CONSENSUS_BOOKS];

function getEasternDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

async function fetchWithTimeout(url: string, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { signal: controller.signal }); }
  finally { clearTimeout(id); }
}

interface FightTotals {
  eventId: string;
  fightLabel: string;
  commenceTime: string;
  hrbLine: number | null;
  hrbOverOdds: number | null;
  hrbUnderOdds: number | null;
  consensusLines: number[];
  consensusAvg: number | null;
  divergence: number | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const apiKey = Deno.env.get('THE_ODDS_API_KEY');
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'THE_ODDS_API_KEY not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const log = (msg: string) => console.log(`[mma-rounds] ${msg}`);
  const today = getEasternDate();

  try {
    // Step 1: Fetch MMA events with totals from all bookmakers
    const url = `https://api.the-odds-api.com/v4/sports/${SPORT}/odds?apiKey=${apiKey}&regions=us&markets=${MARKET}&oddsFormat=american&bookmakers=${ALL_BOOKS.join(',')}`;
    const res = await fetchWithTimeout(url, 15000);
    if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
    const events: any[] = await res.json();

    // Filter to upcoming fights (within 7 days for MMA — cards are weekly)
    const now = new Date();
    const cutoff = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const upcoming = events.filter(e => {
      const ct = new Date(e.commence_time);
      return ct > now && ct < cutoff;
    });
    log(`${upcoming.length} upcoming MMA fights within 7 days`);

    // Step 2: Parse totals per fight and compare HRB vs consensus
    const fights: FightTotals[] = [];

    for (const event of upcoming) {
      const fightLabel = `${event.away_team} vs ${event.home_team}`;
      const fight: FightTotals = {
        eventId: event.id,
        fightLabel,
        commenceTime: event.commence_time,
        hrbLine: null,
        hrbOverOdds: null,
        hrbUnderOdds: null,
        consensusLines: [],
        consensusAvg: null,
        divergence: null,
      };

      for (const bm of (event.bookmakers || [])) {
        for (const market of (bm.markets || [])) {
          if (market.key !== MARKET) continue;

          const overOutcome = market.outcomes?.find((o: any) => o.name === 'Over');
          const underOutcome = market.outcomes?.find((o: any) => o.name === 'Under');
          const line = overOutcome?.point ?? underOutcome?.point;
          if (line == null) continue;

          if (bm.key === HRB) {
            fight.hrbLine = line;
            fight.hrbOverOdds = overOutcome?.price ?? null;
            fight.hrbUnderOdds = underOutcome?.price ?? null;
          } else if (CONSENSUS_BOOKS.includes(bm.key)) {
            fight.consensusLines.push(line);
          }
        }
      }

      // Calculate consensus average
      if (fight.consensusLines.length > 0) {
        fight.consensusAvg = fight.consensusLines.reduce((a, b) => a + b, 0) / fight.consensusLines.length;
      }

      // Calculate divergence (HRB vs consensus)
      if (fight.hrbLine != null && fight.consensusAvg != null) {
        fight.divergence = Math.round((fight.hrbLine - fight.consensusAvg) * 10) / 10;
      }

      fights.push(fight);
    }

    // Step 3: Filter for value picks
    // Criteria: HRB diverges from consensus by ≥ 0.5 rounds OR significant odds value
    const picks = fights.filter(f => {
      if (f.hrbLine == null) return false;
      // Divergence-based: HRB line is ≥ 0.5 different from consensus
      if (f.divergence != null && Math.abs(f.divergence) >= 0.5) return true;
      // Odds-based: if we only have HRB, check for plus-money on either side
      if (f.hrbOverOdds != null && f.hrbOverOdds >= 110) return true;
      if (f.hrbUnderOdds != null && f.hrbUnderOdds >= 110) return true;
      return false;
    });

    log(`${picks.length} MMA rounds picks from ${fights.length} fights`);

    // Step 4: Write to category_sweet_spots
    if (picks.length > 0) {
      // Clear today's old MMA rounds picks
      await supabase
        .from('category_sweet_spots')
        .delete()
        .like('category', 'MMA_ROUNDS_%')
        .gte('created_at', `${today}T00:00:00`);

      const rows = picks.map(p => {
        // Determine side: if HRB line is BELOW consensus, take OVER (HRB undervalues duration)
        // If HRB line is ABOVE consensus, take UNDER
        let side: string;
        let category: string;

        if (p.divergence != null && p.divergence < 0) {
          side = 'over';
          category = 'MMA_ROUNDS_OVER';
        } else if (p.divergence != null && p.divergence > 0) {
          side = 'under';
          category = 'MMA_ROUNDS_UNDER';
        } else {
          // No consensus — use odds value
          side = (p.hrbOverOdds ?? -999) > (p.hrbUnderOdds ?? -999) ? 'over' : 'under';
          category = side === 'over' ? 'MMA_ROUNDS_OVER' : 'MMA_ROUNDS_UNDER';
        }

        const edge = p.divergence != null ? Math.abs(p.divergence) / (p.consensusAvg || 2.5) : 0.1;
        const confidence = p.divergence != null && Math.abs(p.divergence) >= 1.0 ? 75
          : p.divergence != null ? 65
          : 55;

        return {
          category,
          side,
          player_name: p.fightLabel,
          prop_type: 'total_rounds',
          line: p.hrbLine!,
          confidence_score: confidence,
          edge_value: Math.round(edge * 100) / 100,
          reasoning: p.consensusAvg != null
            ? `HRB line ${p.hrbLine} vs consensus ${p.consensusAvg!.toFixed(1)} (divergence ${p.divergence! > 0 ? '+' : ''}${p.divergence})`
            : `HRB line ${p.hrbLine} with value odds (Over ${p.hrbOverOdds} / Under ${p.hrbUnderOdds})`,
          sport: 'mma_mixed_martial_arts',
          source_engine: 'mma-rounds-analyzer',
          is_active: true,
        };
      });

      const { error: insertErr } = await supabase.from('category_sweet_spots').insert(rows);
      if (insertErr) log(`Insert error: ${JSON.stringify(insertErr)}`);
      else log(`Inserted ${rows.length} MMA rounds sweet spots`);
    }

    // Step 5: Telegram alert
    if (picks.length > 0) {
      const lines = picks.map((p, i) => {
        const side = (p.divergence != null && p.divergence < 0) ? 'OVER' : 'UNDER';
        const narrative = p.consensusAvg != null
          ? `HRB line sits ${Math.abs(p.divergence!).toFixed(1)} rounds ${p.divergence! < 0 ? 'below' : 'above'} consensus.`
          : `Value odds on HRB.`;

        const oddsStr = side === 'OVER'
          ? `Over ${p.hrbLine} @ ${(p.hrbOverOdds ?? 0) > 0 ? '+' : ''}${p.hrbOverOdds}`
          : `Under ${p.hrbLine} @ ${(p.hrbUnderOdds ?? 0) > 0 ? '+' : ''}${p.hrbUnderOdds}`;

        const consensusStr = p.consensusAvg != null
          ? `📊 Consensus: ${p.consensusAvg.toFixed(1)} | HRB: ${p.hrbLine}`
          : '';

        return [
          `${i + 1}️⃣ ${p.fightLabel} — ${side} ${p.hrbLine} rounds`,
          `   ${narrative}`,
          consensusStr ? `   ${consensusStr}` : null,
          `   💰 ${oddsStr} (HRB)`,
        ].filter(Boolean).join('\n');
      });

      const msg = [
        `🥊 *MMA Rounds Analyzer* — ${picks.length} pick${picks.length > 1 ? 's' : ''}`,
        '',
        ...lines,
        '',
        `📅 ${today}`,
      ].join('\n');

      try {
        await supabase.functions.invoke('bot-send-telegram', {
          body: { message: msg, parse_mode: 'Markdown', admin_only: true },
        });
      } catch (_) { /* ignore */ }
    }

    return new Response(JSON.stringify({
      success: true,
      fights_scanned: fights.length,
      picks: picks.length,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    log(`Fatal: ${error}`);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
