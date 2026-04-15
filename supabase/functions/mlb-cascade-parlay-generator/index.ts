import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const TIERS = [
  { name: 'GRIND', tickets: 8, legs: 3, emoji: '🎯' },
  { name: 'STACK', tickets: 7, legs: 5, emoji: '📦' },
  { name: 'LONGSHOT', tickets: 5, legs: 8, emoji: '🎰' },
];

const STAKE = 10;
const MAX_SAME_GAME = 2;

const READABLE_PROPS: Record<string, string> = {
  batter_rbis: 'RBI', pitcher_strikeouts: 'Strikeouts', batter_total_bases: 'Total Bases',
  batter_hits: 'Hits', batter_home_runs: 'Home Runs', batter_stolen_bases: 'Stolen Bases',
};

function readableProp(raw: string): string {
  return READABLE_PROPS[raw] || raw.replace(/^(player_|batter_|pitcher_)/, '').replace(/_/g, ' ');
}

function americanToDecimal(american: number): number {
  if (american < 0) return 1 + (100 / Math.abs(american));
  return 1 + (american / 100);
}

function decimalToAmerican(decimal: number): number {
  if (decimal >= 2) return Math.round((decimal - 1) * 100);
  return Math.round(-100 / (decimal - 1));
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

interface CascadePick {
  player_name: string;
  prop_type: string;
  side: string;
  line: number;
  odds_american: number;
  game_key?: string; // home_team vs away_team for same-game checks
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

    // 1. Pull today's cascade picks from straight_bet_tracker
    const { data: cascadePicks, error: pickErr } = await supabase
      .from('straight_bet_tracker')
      .select('*')
      .eq('bet_date', today)
      .eq('signal_type', 'cascade');

    if (pickErr) throw pickErr;

    if (!cascadePicks || cascadePicks.length === 0) {
      return new Response(JSON.stringify({ success: false, message: 'No cascade picks found today' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[MLB-Cascade-Parlays] Found ${cascadePicks.length} cascade picks for ${today}`);

    // 2. Fetch real odds via fetch-batch-odds
    const playerRequests = cascadePicks.map(p => ({
      player_name: p.player_name,
      prop_type: p.prop_type || 'batter_rbis',
    }));

    let oddsMap = new Map<string, { line: number; under_price: number; over_price: number | null; bookmaker: string }>();

    try {
      const oddsResp = await supabase.functions.invoke('fetch-batch-odds', {
        body: {
          sport: 'baseball_mlb',
          players: playerRequests,
          return_all_books: false,
        },
      });

      if (oddsResp.data?.results) {
        for (const r of oddsResp.data.results) {
          if (r.success && r.odds) {
            oddsMap.set(r.player_name, {
              line: r.odds.line,
              under_price: r.odds.under_price || -375,
              over_price: r.odds.over_price,
              bookmaker: r.odds.bookmaker,
            });
          }
        }
      }
      console.log(`[MLB-Cascade-Parlays] Got real odds for ${oddsMap.size}/${cascadePicks.length} players`);
    } catch (oddsErr) {
      console.warn(`[MLB-Cascade-Parlays] fetch-batch-odds failed, using default -375:`, oddsErr);
    }

    // 3. Build the pool with real or fallback odds
    const pool: CascadePick[] = cascadePicks.map(p => {
      const realOdds = oddsMap.get(p.player_name);
      return {
        player_name: p.player_name,
        prop_type: p.prop_type || 'batter_rbis',
        side: p.side || 'under',
        line: realOdds?.line ?? p.line ?? 0.5,
        odds_american: realOdds?.under_price ?? -375,
      };
    });

    // 4. Check for existing parlays today to avoid duplicates
    const { data: existingParlays } = await supabase
      .from('bot_daily_parlays')
      .select('id')
      .eq('parlay_date', today)
      .eq('strategy_name', 'mlb_cascade_parlays');

    if (existingParlays && existingParlays.length > 0) {
      console.log(`[MLB-Cascade-Parlays] ${existingParlays.length} parlays already exist today, skipping`);
      return new Response(JSON.stringify({
        success: false,
        message: `${existingParlays.length} MLB cascade parlays already generated today`,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // 5. Shuffle and build 20 tickets
    const shuffledPool = shuffle(pool);
    const totalSlotsNeeded = TIERS.reduce((s, t) => s + t.tickets * t.legs, 0);
    
    // If not enough unique players, allow reuse by cycling
    let playerIndex = 0;
    const getNextPlayers = (count: number): CascadePick[] => {
      const picks: CascadePick[] = [];
      for (let i = 0; i < count; i++) {
        picks.push(shuffledPool[playerIndex % shuffledPool.length]);
        playerIndex++;
      }
      return picks;
    };

    console.log(`[MLB-Cascade-Parlays] Building 20 tickets from ${shuffledPool.length} players (${totalSlotsNeeded} slots needed)`);

    const allTickets: Array<{
      tier: string;
      legs: CascadePick[];
      combined_odds_american: number;
      combined_decimal: number;
      stake: number;
      potential_payout: number;
    }> = [];

    for (const tier of TIERS) {
      for (let t = 0; t < tier.tickets; t++) {
        const legs = getNextPlayers(tier.legs);
        
        // Calculate combined decimal odds
        const combinedDecimal = legs.reduce((acc, leg) => acc * americanToDecimal(leg.odds_american), 1);
        const combinedAmerican = decimalToAmerican(combinedDecimal);
        const potentialPayout = STAKE * combinedDecimal;

        allTickets.push({
          tier: tier.name,
          legs,
          combined_odds_american: combinedAmerican,
          combined_decimal: combinedDecimal,
          stake: STAKE,
          potential_payout: potentialPayout,
        });
      }
    }

    // 6. Insert into bot_daily_parlays
    const parlaysToInsert = allTickets.map((ticket, idx) => ({
      parlay_date: today,
      strategy_name: 'mlb_cascade_parlays',
      tier: ticket.tier,
      leg_count: ticket.legs.length,
      legs: ticket.legs.map(l => ({
        player: l.player_name,
        prop: l.prop_type,
        side: l.side,
        line: l.line,
        odds: l.odds_american,
      })),
      expected_odds: ticket.combined_odds_american,
      combined_probability: 1 / ticket.combined_decimal,
      outcome: 'pending',
      simulated_stake: STAKE,
      simulated_payout: ticket.potential_payout,
      is_simulated: false,
    }));

    const { error: insertErr } = await supabase
      .from('bot_daily_parlays')
      .insert(parlaysToInsert);

    if (insertErr) throw insertErr;

    // 7. Broadcast to Telegram
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    let msg = `⚾ <b>MLB CASCADE PARLAY SLATE — ${today}</b>\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `🎲 ${allTickets.length} Tickets · $${STAKE} each · $${allTickets.length * STAKE} total risk\n`;
    msg += `📊 Pool: ${shuffledPool.length} Under RBI cascade picks\n\n`;

    let ticketNum = 0;
    for (const tier of TIERS) {
      const tierTickets = allTickets.filter(t => t.tier === tier.name);
      msg += `${tier.emoji} <b>${tier.name} (${tier.legs}-LEG)</b> — ${tierTickets.length} tickets\n`;
      msg += `─────────────────────\n`;

      for (const ticket of tierTickets) {
        ticketNum++;
        const payoutStr = ticket.potential_payout.toFixed(2);
        const oddsStr = ticket.combined_odds_american > 0 ? `+${ticket.combined_odds_american}` : `${ticket.combined_odds_american}`;
        msg += `🎫 <b>#${ticketNum}</b> (${oddsStr}) → $${payoutStr}\n`;
        for (const leg of ticket.legs) {
          const prop = readableProp(leg.prop_type);
          const legOdds = leg.odds_american > 0 ? `+${leg.odds_american}` : `${leg.odds_american}`;
          msg += `   └ ${esc(leg.player_name)} U${leg.line} ${prop} (${legOdds})\n`;
        }
        msg += `\n`;
      }
    }

    const totalPayout = allTickets.reduce((s, t) => s + t.potential_payout, 0);
    msg += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `💰 Total Risk: <b>$${allTickets.length * STAKE}</b>\n`;
    msg += `🏆 Max Payout: <b>$${totalPayout.toFixed(2)}</b>\n`;
    msg += `\n<i>All legs: Under 0.5 RBI · Cascade signals (96% WR)</i>`;

    try {
      await supabase.functions.invoke('bot-send-telegram', {
        body: { message: msg, parse_mode: 'HTML' },
      });
    } catch (tgErr) {
      console.error('[MLB-Cascade-Parlays] Telegram send error:', tgErr);
    }

    console.log(`[MLB-Cascade-Parlays] Generated ${allTickets.length} tickets, $${allTickets.length * STAKE} total risk`);

    return new Response(JSON.stringify({
      success: true,
      tickets: allTickets.length,
      total_risk: allTickets.length * STAKE,
      pool_size: shuffledPool.length,
      odds_fetched: oddsMap.size,
      tiers: TIERS.map(t => ({ name: t.name, tickets: t.tickets, legs: t.legs })),
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('[MLB-Cascade-Parlays] Error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
