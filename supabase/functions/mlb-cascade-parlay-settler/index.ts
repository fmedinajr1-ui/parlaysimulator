import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function normalizeName(name: string): string {
  return name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
}

function namesMatch(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na === nb) return true;
  const aLast = na.split(' ').pop() || '';
  const bLast = nb.split(' ').pop() || '';
  if (aLast.length > 2 && aLast === bLast) {
    if ((na.split(' ')[0] || '')[0] === (nb.split(' ')[0] || '')[0]) return true;
  }
  return false;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const log = (msg: string) => console.log(`[cascade-settler] ${msg}`);

  try {
    // 1. Fetch pending cascade parlays
    const { data: parlays, error: pErr } = await supabase
      .from('bot_daily_parlays')
      .select('*')
      .eq('strategy_name', 'mlb_cascade_parlays')
      .eq('outcome', 'pending')
      .limit(100);

    if (pErr) throw pErr;
    if (!parlays || parlays.length === 0) {
      log('No pending cascade parlays');
      return new Response(JSON.stringify({ settled: 0, message: 'No pending parlays' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    log(`Found ${parlays.length} pending cascade parlays`);

    // 2. Get date range and fetch game logs
    const dates = [...new Set(parlays.map(p => p.parlay_date))];
    const minDate = dates.sort()[0];
    const maxDate = dates.sort().pop()!;
    // Extend by 1 day for night games
    const extDate = new Date(maxDate);
    extDate.setDate(extDate.getDate() + 1);

    const { data: gameLogs, error: glErr } = await supabase
      .from('mlb_player_game_logs')
      .select('player_name, game_date, rbis')
      .gte('game_date', minDate)
      .lte('game_date', extDate.toISOString().split('T')[0])
      .limit(5000);

    if (glErr) throw glErr;
    log(`Loaded ${gameLogs?.length || 0} game logs`);

    if (!gameLogs || gameLogs.length === 0) {
      log('No game logs available for settlement');
      return new Response(JSON.stringify({ settled: 0, message: 'No game logs available' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3. Build lookup: normalized name + date → rbis
    const logMap = new Map<string, number>();
    for (const gl of gameLogs) {
      const key = `${normalizeName(gl.player_name)}|${gl.game_date}`;
      logMap.set(key, gl.rbis ?? 0);
    }

    // Also build name-only map for fuzzy matching
    const nameToNormalized = new Map<string, string>();
    for (const gl of gameLogs) {
      nameToNormalized.set(gl.player_name, normalizeName(gl.player_name));
    }

    function findRBI(playerName: string, parlayDate: string): number | null {
      const norm = normalizeName(playerName);
      // Check exact match on parlay date and next day
      const nextDay = new Date(parlayDate);
      nextDay.setDate(nextDay.getDate() + 1);
      const nextStr = nextDay.toISOString().split('T')[0];

      const exact = logMap.get(`${norm}|${parlayDate}`) ?? logMap.get(`${norm}|${nextStr}`);
      if (exact !== undefined) return exact;

      // Fuzzy match
      for (const [rawName, normName] of nameToNormalized.entries()) {
        if (namesMatch(playerName, rawName)) {
          const fuzzy = logMap.get(`${normName}|${parlayDate}`) ?? logMap.get(`${normName}|${nextStr}`);
          if (fuzzy !== undefined) return fuzzy;
        }
      }
      return null; // DNP / no data
    }

    // 4. Settle each parlay
    let totalSettled = 0;
    let totalWon = 0;
    let totalLost = 0;
    let totalVoid = 0;
    let totalProfit = 0;
    let totalStaked = 0;

    for (const parlay of parlays) {
      const legs = (parlay.legs as any[]) || [];
      let legsHit = 0;
      let legsMissed = 0;
      let legsVoided = 0;

      for (const leg of legs) {
        const playerName = leg.player || leg.player_name || '';
        const rbi = findRBI(playerName, parlay.parlay_date);

        if (rbi === null) {
          legsVoided++;
        } else if (rbi === 0) {
          legsHit++; // Under 0.5 RBI hits
        } else {
          legsMissed++; // Had RBIs, under loses
        }
      }

      let outcome: string;
      let profitLoss: number;
      const stake = parlay.simulated_stake || 10;
      const payout = parlay.simulated_payout || 0;

      if (legsMissed > 0) {
        outcome = 'lost';
        profitLoss = -stake;
      } else if (legsVoided > 0 && legsHit === 0) {
        outcome = 'void';
        profitLoss = 0;
      } else if (legsVoided > 0) {
        // Some void, rest hit — recalculate at reduced odds
        const liveLegCount = legsHit;
        const origLegCount = legs.length;
        const reducedPayout = payout * (liveLegCount / origLegCount);
        outcome = 'won';
        profitLoss = reducedPayout - stake;
      } else {
        outcome = 'won';
        profitLoss = payout - stake;
      }

      const { error: upErr } = await supabase
        .from('bot_daily_parlays')
        .update({
          outcome,
          profit_loss: Math.round(profitLoss * 100) / 100,
          legs_hit: legsHit,
          legs_missed: legsMissed,
          legs_voided: legsVoided,
          settled_at: new Date().toISOString(),
        })
        .eq('id', parlay.id);

      if (!upErr) {
        totalSettled++;
        if (outcome === 'won') totalWon++;
        else if (outcome === 'lost') totalLost++;
        else totalVoid++;
        totalProfit += profitLoss;
        totalStaked += stake;
      }
    }

    // 5. Get running totals
    const { data: allSettled } = await supabase
      .from('bot_daily_parlays')
      .select('simulated_stake, profit_loss, outcome')
      .eq('strategy_name', 'mlb_cascade_parlays')
      .neq('outcome', 'pending');

    let runningStaked = 0;
    let runningPL = 0;
    if (allSettled) {
      for (const s of allSettled) {
        runningStaked += s.simulated_stake || 10;
        runningPL += s.profit_loss || 0;
      }
    }

    const roi = totalStaked > 0 ? ((totalProfit / totalStaked) * 100).toFixed(1) : '0';
    const runningROI = runningStaked > 0 ? ((runningPL / runningStaked) * 100).toFixed(1) : '0';
    const returned = totalStaked + totalProfit;

    log(`Settled ${totalSettled}: ${totalWon}W/${totalLost}L/${totalVoid}V, P/L: $${totalProfit.toFixed(2)}`);

    // 6. Send Telegram summary
    const plSign = totalProfit >= 0 ? '+' : '';
    const runSign = runningPL >= 0 ? '+' : '';

    let msg = `⚾ <b>MLB CASCADE SETTLEMENT</b>\n\n`;
    msg += `📊 <b>Today's Results:</b>\n`;
    msg += `✅ Won: ${totalWon}/${totalSettled} tickets\n`;
    msg += `❌ Lost: ${totalLost}/${totalSettled} tickets\n`;
    if (totalVoid > 0) msg += `⏸ Void: ${totalVoid}/${totalSettled} tickets\n`;
    msg += `\n`;
    msg += `💰 Staked: $${totalStaked.toFixed(2)}\n`;
    msg += `💵 Returned: $${returned.toFixed(2)}\n`;
    msg += `📈 Net Profit: ${plSign}$${totalProfit.toFixed(2)}\n`;
    msg += `📊 ROI: ${roi}%\n`;
    msg += `\n━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `🏆 <b>Running Totals:</b>\n`;
    msg += `Total Staked: $${runningStaked.toFixed(2)} | Net P/L: ${runSign}$${runningPL.toFixed(2)} (${runningROI}% ROI)`;

    try {
      await supabase.functions.invoke('bot-send-telegram', {
        body: { message: msg, parse_mode: 'HTML' },
      });
    } catch (tgErr) {
      log(`Telegram error: ${tgErr}`);
    }

    return new Response(JSON.stringify({
      settled: totalSettled, won: totalWon, lost: totalLost, void: totalVoid,
      profit: Math.round(totalProfit * 100) / 100,
      staked: totalStaked,
      roi: parseFloat(roi),
      running_staked: runningStaked,
      running_pl: Math.round(runningPL * 100) / 100,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    log(`Error: ${err.message}`);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
