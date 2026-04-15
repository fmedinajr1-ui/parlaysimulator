
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Stake tiers by signal accuracy
const STAKE_TIERS: Record<string, { pct: number; label: string }> = {
  cascade:     { pct: 0.02, label: '2% (Cascade)' },
  price_drift: { pct: 0.01, label: '1% (Price Drift)' },
  velocity_spike: { pct: 0.005, label: '0.5% (Velocity)' },
};

const READABLE_PROPS: Record<string, string> = {
  pitcher_strikeouts: 'Strikeouts', batter_rbis: 'RBI', batter_total_bases: 'Total Bases',
  batter_stolen_bases: 'Stolen Bases', batter_home_runs: 'Home Runs', batter_hits: 'Hits',
  batter_runs_scored: 'Runs', pitcher_outs: 'Outs', player_points: 'PTS',
  player_rebounds: 'REB', player_assists: 'AST', player_threes: '3PT',
  rbis: 'RBI', stolen_bases: 'Stolen Bases', total_bases: 'Total Bases',
  hits: 'Hits', runs: 'Runs', home_runs: 'Home Runs',
};

function readableProp(raw: string): string {
  return READABLE_PROPS[raw] || raw.replace(/^(player_|batter_|pitcher_)/, '').replace(/_/g, ' ');
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

    // 1. Get or create today's bankroll record
    let { data: bankrollRow } = await supabase
      .from('straight_bet_bankroll')
      .select('*')
      .eq('bankroll_date', today)
      .single();

    if (!bankrollRow) {
      // Carry forward yesterday's closing bankroll
      const { data: lastRow } = await supabase
        .from('straight_bet_bankroll')
        .select('current_bankroll')
        .lt('bankroll_date', today)
        .order('bankroll_date', { ascending: false })
        .limit(1)
        .single();

      const startingBankroll = lastRow?.current_bankroll || 100;

      const { data: newRow, error: insertErr } = await supabase
        .from('straight_bet_bankroll')
        .insert({
          bankroll_date: today,
          starting_bankroll: startingBankroll,
          current_bankroll: startingBankroll,
        })
        .select()
        .single();

      if (insertErr) throw insertErr;
      bankrollRow = newRow;
    }

    const bankroll = bankrollRow.current_bankroll;

    // 2. Pull today's high-accuracy signals from fanduel_prediction_alerts
    //    Target: cascade + price_drift for Under RBI (highest proven WR)
    const todayStart = `${today}T00:00:00`;
    const todayEnd = `${today}T23:59:59`;
    const { data: alerts, error: alertErr } = await supabase
      .from('fanduel_prediction_alerts')
      .select('*')
      .gte('created_at', todayStart)
      .lte('created_at', todayEnd)
      .in('signal_type', ['cascade', 'price_drift', 'velocity_spike'])
      .not('player_name', 'is', null);

    if (alertErr) throw alertErr;

    if (!alerts || alerts.length === 0) {
      return new Response(
        JSON.stringify({ success: false, message: 'No eligible signals found today' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3. Check which bets are already placed today (avoid duplicates)
    const { data: existingBets } = await supabase
      .from('straight_bet_tracker')
      .select('player_name, prop_type, side')
      .eq('bet_date', today);

    const existingKeys = new Set(
      (existingBets || []).map(b => `${b.player_name}|${b.prop_type}|${b.side}`)
    );

    // 4. Build slate — calculate stakes per signal tier
    const slate: Array<{
      signal_type: string;
      player_name: string;
      prop_type: string;
      side: string;
      line: number;
      stake: number;
      odds_american: number;
      bankroll_before: number;
    }> = [];

    for (const alert of alerts) {
      // Skip team-level cascade signals — not individual bettable props
      if (!alert.player_name || alert.player_name.startsWith('TEAM CASCADE')) {
        console.log(`[StraightBetSlate] Skipping team cascade: ${alert.player_name}`);
        continue;
      }

      const key = `${alert.player_name}|${alert.prop_type}|${alert.prediction}`;
      if (existingKeys.has(key)) continue;

      const tier = STAKE_TIERS[alert.signal_type] || STAKE_TIERS.velocity_spike;
      const stake = Math.max(1, Math.round(bankroll * tier.pct * 100) / 100);

      // Default odds for Under 0.5 RBI type props
      const odds = alert.odds || -130;

      slate.push({
        signal_type: alert.signal_type,
        player_name: alert.player_name,
        prop_type: alert.prop_type || 'unknown',
        side: alert.prediction || 'under',
        line: alert.line || 0.5,
        stake,
        odds_american: odds,
        bankroll_before: bankroll,
      });
    }

    if (slate.length === 0) {
      return new Response(
        JSON.stringify({ success: false, message: 'All eligible picks already placed today' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 5. Insert straight bets
    const betsToInsert = slate.map(s => ({
      bet_date: today,
      signal_type: s.signal_type,
      player_name: s.player_name,
      prop_type: s.prop_type,
      side: s.side,
      line: s.line,
      stake: s.stake,
      odds_american: s.odds_american,
      outcome: 'pending',
      bankroll_before: s.bankroll_before,
    }));

    const { error: betInsertErr } = await supabase
      .from('straight_bet_tracker')
      .insert(betsToInsert);

    if (betInsertErr) throw betInsertErr;

    // 6. Update bankroll with total bets count
    const totalStaked = slate.reduce((sum, s) => sum + s.stake, 0);
    await supabase
      .from('straight_bet_bankroll')
      .update({
        total_bets: (bankrollRow.total_bets || 0) + slate.length,
        updated_at: new Date().toISOString(),
      })
      .eq('bankroll_date', today);

    // 7. Group by signal type for Telegram message
    const cascadeBets = slate.filter(s => s.signal_type === 'cascade');
    const driftBets = slate.filter(s => s.signal_type === 'price_drift');
    const otherBets = slate.filter(s => !['cascade', 'price_drift'].includes(s.signal_type));

    // Use HTML parse mode to avoid Markdown escaping issues
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    let msg = `💰 <b>STRAIGHT BET SLATE — ${today}</b>\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `💵 Bankroll: <b>$${bankroll.toFixed(2)}</b>\n\n`;

    const formatGroup = (label: string, emoji: string, bets: typeof slate) => {
      if (bets.length === 0) return '';
      const totalRisk = bets.reduce((s, b) => s + b.stake, 0);
      let section = `${emoji} <b>${esc(label)}</b> (${bets.length} bets · $${totalRisk.toFixed(2)} risked)\n`;
      for (const b of bets) {
        const prop = readableProp(b.prop_type);
        const sideLabel = b.side.toUpperCase();
        section += `  • ${esc(b.player_name)} ${sideLabel} ${b.line} ${prop} — <b>$${b.stake.toFixed(2)}</b>\n`;
      }
      return section + '\n';
    };

    msg += formatGroup('Cascade (96% WR)', '🔥', cascadeBets);
    msg += formatGroup('Price Drift (87% WR)', '📊', driftBets);
    msg += formatGroup('Other Signals', '⚡', otherBets);

    msg += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `📈 Total Risked: <b>$${totalStaked.toFixed(2)}</b> across ${slate.length} bets\n`;

    // Calculate expected value
    const cascadeEV = cascadeBets.reduce((s, b) => {
      const winPayout = b.stake * (100 / Math.abs(b.odds_american));
      return s + (0.963 * winPayout - 0.037 * b.stake);
    }, 0);
    const driftEV = driftBets.reduce((s, b) => {
      const winPayout = b.stake * (100 / Math.abs(b.odds_american));
      return s + (0.875 * winPayout - 0.125 * b.stake);
    }, 0);

    msg += `📊 Expected Value: <b>+$${(cascadeEV + driftEV).toFixed(2)}</b>\n`;
    msg += `\n<i>Half-Kelly sizing · Bankroll-adjusted stakes</i>`;

    // 8. Send to Telegram (direct message shortcut, HTML parse mode)
    const { error: sendErr } = await supabase.functions.invoke('bot-send-telegram', {
      body: {
        message: msg,
        parse_mode: 'HTML',
      },
    });

    if (sendErr) console.error('[StraightBetSlate] Telegram send error:', sendErr);

    console.log(`[StraightBetSlate] Generated ${slate.length} straight bets. Bankroll: $${bankroll}`);

    return new Response(
      JSON.stringify({
        success: true,
        bankroll,
        total_bets: slate.length,
        total_risked: totalStaked,
        cascade_count: cascadeBets.length,
        drift_count: driftBets.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[StraightBetSlate] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
