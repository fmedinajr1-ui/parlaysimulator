import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function getEasternDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

// MLB team name mapping for schedule API matching
const TEAM_ALIASES: Record<string, string[]> = {
  'Arizona Diamondbacks': ['ARI', 'Arizona', 'D-backs'],
  'Atlanta Braves': ['ATL', 'Atlanta'],
  'Baltimore Orioles': ['BAL', 'Baltimore'],
  'Boston Red Sox': ['BOS', 'Boston'],
  'Chicago Cubs': ['CHC', 'Cubs'],
  'Chicago White Sox': ['CWS', 'White Sox'],
  'Cincinnati Reds': ['CIN', 'Cincinnati'],
  'Cleveland Guardians': ['CLE', 'Cleveland'],
  'Colorado Rockies': ['COL', 'Colorado'],
  'Detroit Tigers': ['DET', 'Detroit'],
  'Houston Astros': ['HOU', 'Houston'],
  'Kansas City Royals': ['KC', 'Kansas City'],
  'Los Angeles Angels': ['LAA', 'Angels'],
  'Los Angeles Dodgers': ['LAD', 'Dodgers'],
  'Miami Marlins': ['MIA', 'Miami'],
  'Milwaukee Brewers': ['MIL', 'Milwaukee'],
  'Minnesota Twins': ['MIN', 'Minnesota'],
  'New York Mets': ['NYM', 'Mets'],
  'New York Yankees': ['NYY', 'Yankees'],
  'Oakland Athletics': ['OAK', 'Oakland', 'Athletics'],
  'Philadelphia Phillies': ['PHI', 'Philadelphia'],
  'Pittsburgh Pirates': ['PIT', 'Pittsburgh'],
  'San Diego Padres': ['SD', 'San Diego'],
  'San Francisco Giants': ['SF', 'San Francisco'],
  'Seattle Mariners': ['SEA', 'Seattle'],
  'St. Louis Cardinals': ['STL', 'St. Louis'],
  'Tampa Bay Rays': ['TB', 'Tampa Bay'],
  'Texas Rangers': ['TEX', 'Texas'],
  'Toronto Blue Jays': ['TOR', 'Toronto'],
  'Washington Nationals': ['WSH', 'Washington'],
};

function findTeamFullName(abbrevOrPartial: string): string | null {
  const input = abbrevOrPartial.trim().toLowerCase();
  for (const [fullName, aliases] of Object.entries(TEAM_ALIASES)) {
    if (fullName.toLowerCase() === input) return fullName;
    for (const alias of aliases) {
      if (alias.toLowerCase() === input) return fullName;
    }
  }
  // Fuzzy: check if input is contained in full name
  for (const fullName of Object.keys(TEAM_ALIASES)) {
    if (fullName.toLowerCase().includes(input) || input.includes(fullName.toLowerCase())) return fullName;
  }
  return null;
}

interface ScheduleGame {
  homeTeam: string;
  awayTeam: string;
  homePitcher: string | null;
  awayPitcher: string | null;
}

async function fetchTodaySchedule(dateStr: string): Promise<ScheduleGame[]> {
  try {
    const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${dateStr}&hydrate=probablePitcher`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    const games: ScheduleGame[] = [];
    for (const date of (data.dates || [])) {
      for (const game of (date.games || [])) {
        games.push({
          homeTeam: game.teams?.home?.team?.name || '',
          awayTeam: game.teams?.away?.team?.name || '',
          homePitcher: game.teams?.home?.probablePitcher?.fullName || null,
          awayPitcher: game.teams?.away?.probablePitcher?.fullName || null,
        });
      }
    }
    return games;
  } catch (e) {
    console.error('[RBI Under] Schedule fetch error:', e);
    return [];
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);
  const log = (msg: string) => console.log(`[RBI Under] ${msg}`);

  try {
    const today = getEasternDate();
    log(`Starting analysis for ${today}`);

    // 1. Get active RBI props at 0.5 line
    const { data: rbiProps } = await supabase
      .from('pp_snapshot')
      .select('player_name, team, pp_line')
      .eq('stat_type', 'batter_rbis')
      .eq('is_active', true)
      .eq('pp_line', 0.5);

    // Dedupe by player name
    const seen = new Set<string>();
    const uniqueProps = (rbiProps || []).filter(p => {
      const k = p.player_name.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    log(`Found ${uniqueProps.length} active RBI 0.5 props`);
    if (uniqueProps.length === 0) {
      return new Response(JSON.stringify({ success: true, message: 'No RBI props found', analyzed: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Get L10 RBI stats for all players
    const playerNames = uniqueProps.map(p => p.player_name);
    const { data: gameLogs } = await supabase
      .from('mlb_player_game_logs')
      .select('player_name, rbis, game_date')
      .in('player_name', playerNames)
      .order('game_date', { ascending: false })
      .limit(1000);

    // Group by player, take last 10
    const playerL10: Record<string, { rbis: number[]; totalRbis: number; hitRate: number }> = {};
    const playerGames: Record<string, any[]> = {};
    for (const g of (gameLogs || [])) {
      if (!playerGames[g.player_name]) playerGames[g.player_name] = [];
      playerGames[g.player_name].push(g);
    }
    for (const [name, games] of Object.entries(playerGames)) {
      const l10 = games.slice(0, 10);
      const rbis = l10.map(g => g.rbis || 0);
      const totalRbis = rbis.reduce((s, v) => s + v, 0);
      const hitRate = rbis.filter(r => r >= 1).length / rbis.length;
      playerL10[name] = { rbis, totalRbis, hitRate };
    }

    // 3. Filter to Under candidates (0-2 RBIs in L10)
    const underCandidates = uniqueProps.filter(p => {
      const stats = playerL10[p.player_name];
      if (!stats || stats.rbis.length < 5) return false;
      return stats.totalRbis <= 2;
    });

    log(`${underCandidates.length} Under candidates (0-2 RBIs in L10)`);

    // 4. Fetch today's schedule for pitcher matchups
    const schedule = await fetchTodaySchedule(today);
    log(`Got ${schedule.length} games from MLB schedule`);

    // 5. Score each candidate
    interface ScoredPlayer {
      player_name: string;
      team: string | null;
      opponent: string | null;
      opposing_pitcher: string | null;
      pitcher_era: number | null;
      pitcher_k_rate: number | null;
      l10_rbis: number;
      l10_hit_rate: number;
      score: number;
      tier: string;
    }

    const scored: ScoredPlayer[] = [];

    for (const prop of underCandidates) {
      const stats = playerL10[prop.player_name];
      if (!stats) continue;

      // Find opposing pitcher from schedule
      let opposingPitcher: string | null = null;
      let opponentTeam: string | null = null;
      const playerTeam = findTeamFullName(prop.team || '');

      for (const game of schedule) {
        if (playerTeam === game.homeTeam) {
          opposingPitcher = game.awayPitcher;
          opponentTeam = game.awayTeam;
          break;
        } else if (playerTeam === game.awayTeam) {
          opposingPitcher = game.homePitcher;
          opponentTeam = game.homeTeam;
          break;
        }
      }

      // Look up pitcher stats from game logs if we have them
      let pitcherEra: number | null = null;
      let pitcherKRate: number | null = null;

      if (opposingPitcher) {
        // Try MLB Stats API for pitcher season stats
        try {
          // Search pitcher by name
          const searchUrl = `https://statsapi.mlb.com/api/v1/people/search?names=${encodeURIComponent(opposingPitcher)}&sportId=1`;
          const searchRes = await fetch(searchUrl);
          if (searchRes.ok) {
            const searchData = await searchRes.json();
            const pitcher = searchData.people?.[0];
            if (pitcher?.id) {
              const statsUrl = `https://statsapi.mlb.com/api/v1/people/${pitcher.id}/stats?stats=season&season=2025&group=pitching`;
              const statsRes = await fetch(statsUrl);
              if (statsRes.ok) {
                const statsData = await statsRes.json();
                const splits = statsData.stats?.[0]?.splits?.[0]?.stat;
                if (splits) {
                  pitcherEra = parseFloat(splits.era) || null;
                  const ip = parseFloat(splits.inningsPitched) || 0;
                  const ks = parseInt(splits.strikeOuts) || 0;
                  const gamesStarted = parseInt(splits.gamesStarted) || 1;
                  pitcherKRate = ip > 0 ? Math.round((ks / gamesStarted) * 10) / 10 : null;
                }
              }
            }
          }
        } catch (e) {
          log(`Pitcher stats error for ${opposingPitcher}: ${e}`);
        }
      }

      // Calculate score
      let score = 100 - (stats.hitRate * 100);

      // Pitcher bonuses
      if (pitcherKRate != null) {
        if (pitcherKRate >= 7) score += 10;
        else if (pitcherKRate >= 5) score += 5;
      }
      if (pitcherEra != null) {
        if (pitcherEra < 2.5) score += 10;
        else if (pitcherEra < 3.5) score += 5;
      }

      const tier = score >= 90 ? 'LOCK' : score >= 75 ? 'STRONG' : score >= 60 ? 'LEAN' : 'SKIP';
      if (tier === 'SKIP') continue;

      scored.push({
        player_name: prop.player_name,
        team: prop.team,
        opponent: opponentTeam,
        opposing_pitcher: opposingPitcher,
        pitcher_era: pitcherEra,
        pitcher_k_rate: pitcherKRate,
        l10_rbis: stats.totalRbis,
        l10_hit_rate: Math.round(stats.hitRate * 100),
        score: Math.round(score),
        tier,
      });
    }

    scored.sort((a, b) => b.score - a.score);
    log(`${scored.length} scored plays after filtering`);

    // 6. Save to tracking table
    if (scored.length > 0) {
      const rows = scored.map(s => ({
        player_name: s.player_name,
        team: s.team,
        opponent: s.opponent,
        opposing_pitcher: s.opposing_pitcher,
        pitcher_era: s.pitcher_era,
        pitcher_k_rate: s.pitcher_k_rate,
        l10_rbis: s.l10_rbis,
        l10_hit_rate: s.l10_hit_rate,
        score: s.score,
        tier: s.tier,
        analysis_date: today,
      }));
      const { error } = await supabase.from('mlb_rbi_under_analysis').insert(rows);
      if (error) log(`Insert error: ${JSON.stringify(error)}`);
      else log(`Saved ${rows.length} analysis rows`);
    }

    // 7. Send Telegram alert
    const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
    const TELEGRAM_CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID');

    if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID && scored.length > 0) {
      let msg = `⚾ *RBI UNDER LOCKS — ${today}*\n`;
      msg += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      msg += `${scored.length} plays found\n\n`;

      const tiers = ['LOCK', 'STRONG', 'LEAN'];
      const tierEmoji: Record<string, string> = { LOCK: '🔒', STRONG: '💪', LEAN: '📊' };

      for (const tier of tiers) {
        const plays = scored.filter(s => s.tier === tier);
        if (plays.length === 0) continue;
        msg += `${tierEmoji[tier]} *${tier}:*\n`;
        for (const p of plays) {
          msg += `• ${p.player_name} U 0.5 RBI\n`;
          msg += `  L10: ${p.l10_rbis} RBIs (${p.l10_hit_rate}% hit rate)`;
          if (p.opposing_pitcher) {
            msg += ` | vs ${p.opposing_pitcher}`;
            const extras: string[] = [];
            if (p.pitcher_era != null) extras.push(`${p.pitcher_era.toFixed(2)} ERA`);
            if (p.pitcher_k_rate != null) extras.push(`${p.pitcher_k_rate} K/g`);
            if (extras.length > 0) msg += ` (${extras.join(', ')})`;
          }
          msg += `\n  Score: ${p.score}\n`;
        }
        msg += `\n`;
      }

      // Also check for OVER candidates (70%+ hit rate)
      const overCandidates = uniqueProps.filter(p => {
        const stats = playerL10[p.player_name];
        return stats && stats.rbis.length >= 5 && stats.hitRate >= 0.7;
      });

      if (overCandidates.length > 0) {
        msg += `\n🔥 *RBI OVER PLAYS (70%+ hit rate):*\n`;
        for (const p of overCandidates) {
          const stats = playerL10[p.player_name];
          const avg = (stats.totalRbis / stats.rbis.length).toFixed(1);
          msg += `• ${p.player_name} O 0.5 RBI\n`;
          msg += `  L10: ${avg} avg (${Math.round(stats.hitRate * 100)}% hit rate)\n`;
        }
      }

      // Send
      const chunks: string[] = [];
      let remaining = msg;
      while (remaining.length > 0) {
        if (remaining.length <= 4096) { chunks.push(remaining); break; }
        let splitAt = remaining.lastIndexOf('\n', 4096);
        if (splitAt < 100) splitAt = 4096;
        chunks.push(remaining.slice(0, splitAt));
        remaining = remaining.slice(splitAt);
      }
      for (const chunk of chunks) {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: chunk, parse_mode: 'Markdown' }),
        });
      }
      log('Telegram alert sent');
    }

    return new Response(JSON.stringify({
      success: true,
      under_plays: scored.length,
      results: scored,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    log(`Fatal: ${error}`);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
