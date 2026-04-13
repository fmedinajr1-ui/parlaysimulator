import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const log = (msg: string) => console.log(`[line-sum-mismatch] ${msg}`);
  const startTime = Date.now();

  try {
    const today = new Date().toISOString().slice(0, 10);
    log(`=== Line-Sum Mismatch Analyzer — ${today} ===`);

    // 1. Fetch today's props across all 3 sports
    const { data: props, error: propsErr } = await supabase
      .from('unified_props')
      .select('sport, game_description, event_id, player_name, prop_type, current_line')
      .in('sport', ['basketball_nba', 'icehockey_nhl', 'baseball_mlb'])
      .gte('commence_time', `${today}T00:00:00Z`)
      .lt('commence_time', `${today}T23:59:59Z`)
      .not('current_line', 'is', null);

    if (propsErr) throw propsErr;
    if (!props || props.length === 0) {
      log('No props found for today');
      return new Response(JSON.stringify({ success: true, rows: 0, message: 'No props today' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    log(`Fetched ${props.length} props across sports`);

    // 2. Fetch defensive references
    const [nbaDefRes, nhlDefRes, bdlRes] = await Promise.all([
      supabase.from('team_defensive_ratings').select('team_name, stat_type, stat_allowed_per_game, defensive_rank').eq('position_group', 'all'),
      supabase.from('nhl_team_defense_rankings').select('team_name, team_abbrev, goals_against_per_game, shots_against_per_game'),
      supabase.from('bdl_player_cache').select('player_name, team_name').not('team_name', 'is', null),
    ]);

    // Build lookup maps
    // NBA defensive: key = "teamName|statType" → { allowed, rank }
    const nbaDef = new Map<string, { allowed: number; rank: number }>();
    for (const r of nbaDefRes.data || []) {
      nbaDef.set(`${r.team_name}|${r.stat_type}`, { allowed: r.stat_allowed_per_game, rank: r.defensive_rank });
    }

    // NHL defensive: key = teamName → stats
    const nhlDef = new Map<string, { goals_against: number; shots_against: number }>();
    for (const r of nhlDefRes.data || []) {
      nhlDef.set(r.team_name, { goals_against: r.goals_against_per_game, shots_against: r.shots_against_per_game });
    }

    // Player → team mapping (NBA)
    const playerTeam = new Map<string, string>();
    for (const r of bdlRes.data || []) {
      playerTeam.set(r.player_name, r.team_name);
    }

    // Sport-specific prop type → stat category mapping
    const NBA_PROPS: Record<string, string> = {
      player_points: 'points',
      player_rebounds: 'rebounds',
      player_assists: 'assists',
    };
    const NHL_PROPS: Record<string, string> = {
      player_goals: 'goals',
      player_shots_on_goal: 'shots',
      player_assists: 'assists',
    };
    const MLB_PROPS: Record<string, string> = {
      batter_hits: 'hits',
      batter_rbis: 'rbis',
      batter_runs_scored: 'runs',
    };

    // Helper: parse "Away Team @ Home Team" → [away, home]
    const parseTeams = (desc: string): [string, string] | null => {
      const parts = desc.split(' @ ');
      if (parts.length === 2) return [parts[0].trim(), parts[1].trim()];
      const vsParts = desc.split(' vs ');
      if (vsParts.length === 2) return [vsParts[0].trim(), vsParts[1].trim()];
      return null;
    };

    // Helper: fuzzy match team name from game_description to a player's team
    const teamMatchesDesc = (playerTeamName: string, descTeamName: string): boolean => {
      const normalize = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
      const pt = normalize(playerTeamName);
      const dt = normalize(descTeamName);
      // Check if one contains the other or last word matches
      if (pt.includes(dt) || dt.includes(pt)) return true;
      // Match on last word (e.g. "Heat", "Hornets")
      const ptLast = playerTeamName.split(' ').pop()?.toLowerCase() || '';
      const dtLast = descTeamName.split(' ').pop()?.toLowerCase() || '';
      return ptLast === dtLast && ptLast.length > 2;
    };

    // 3. Group props by sport → game → team → stat
    interface Accumulator {
      sum: number;
      count: number;
      eventId: string;
      opponent: string;
    }

    // key = "sport|game|team|stat"
    const accum = new Map<string, Accumulator>();

    for (const p of props) {
      const teams = parseTeams(p.game_description);
      if (!teams) continue;

      let propMap: Record<string, string> | null = null;
      if (p.sport === 'basketball_nba') propMap = NBA_PROPS;
      else if (p.sport === 'icehockey_nhl') propMap = NHL_PROPS;
      else if (p.sport === 'baseball_mlb') propMap = MLB_PROPS;

      if (!propMap || !propMap[p.prop_type]) continue;

      const statCat = propMap[p.prop_type];
      let assignedTeam: string | null = null;
      let opponent: string | null = null;

      if (p.sport === 'basketball_nba') {
        const pt = playerTeam.get(p.player_name);
        if (pt) {
          if (teamMatchesDesc(pt, teams[0])) { assignedTeam = teams[0]; opponent = teams[1]; }
          else if (teamMatchesDesc(pt, teams[1])) { assignedTeam = teams[1]; opponent = teams[0]; }
        }
      } else {
        // NHL/MLB: assign based on player name substring matching in game description
        // We'll use a simple heuristic: try both teams, pick whichever the player is more likely on
        // For now, check if game_description player list groups them (we need to infer from prop groupings)
        // Fallback: assign to first team with matching city/name from unified_props grouping
        // Since we don't have a reliable NHL/MLB player→team cache, we'll group by
        // examining which team name appears in the player's other props or just split evenly
        // Better approach: use the player_name to team mapping from the props themselves
        // We'll build this dynamically below
      }

      if (!assignedTeam && (p.sport === 'icehockey_nhl' || p.sport === 'baseball_mlb')) {
        // For NHL/MLB without a player cache, we'll need to resolve later
        // Store with a placeholder and resolve via clustering
        assignedTeam = `__unresolved__${p.player_name}`;
        opponent = '';
      }

      if (!assignedTeam) continue;

      const key = `${p.sport}|${p.game_description}|${assignedTeam}|${statCat}`;
      const existing = accum.get(key);
      if (existing) {
        existing.sum += p.current_line;
        existing.count += 1;
      } else {
        accum.set(key, { sum: p.current_line, count: 1, eventId: p.event_id || '', opponent: opponent || '' });
      }
    }

    // 4. Resolve NHL/MLB unresolved players via clustering
    // For NHL/MLB, group unresolved players per game and assign them to teams
    // by checking which team name their name might be associated with
    // We'll use a simpler approach: for each game, get all unresolved players,
    // and try to split them based on FanDuel's typical ordering (home/away grouping)
    
    // Actually, let's try a better approach for NHL: query nhl player stats if available
    // For now, let's use the game_description teams and try matching against any available data

    // Resolve NHL unresolved entries
    const unresolvedEntries = [...accum.entries()].filter(([key]) => key.includes('__unresolved__'));
    if (unresolvedEntries.length > 0) {
      // Group unresolved by game
      const gameUnresolved = new Map<string, Map<string, { keys: string[]; sum: number; count: number }>>();
      
      for (const [key, val] of unresolvedEntries) {
        const [sport, game, teamPart, stat] = key.split('|');
        const playerName = teamPart.replace('__unresolved__', '');
        const gameKey = `${sport}|${game}|${stat}`;
        
        if (!gameUnresolved.has(gameKey)) gameUnresolved.set(gameKey, new Map());
        const players = gameUnresolved.get(gameKey)!;
        if (!players.has(playerName)) {
          players.set(playerName, { keys: [], sum: 0, count: 0 });
        }
        const p = players.get(playerName)!;
        p.keys.push(key);
        p.sum += val.sum;
        p.count += val.count;
      }

      // For each game, try to split players into two teams
      // We don't have a reliable way without a player cache, so we'll just sum ALL players
      // for the game and compare against BOTH teams' defensive allowed (creating 2 rows per game)
      for (const [gameKey, players] of gameUnresolved) {
        const [sport, game, stat] = gameKey.split('|');
        const teams = parseTeams(game);
        if (!teams) continue;

        const totalSum = [...players.values()].reduce((s, p) => s + p.sum, 0);
        const totalCount = [...players.values()].reduce((s, p) => s + p.count, 0);

        // Remove unresolved entries
        for (const [, p] of players) {
          for (const k of p.keys) accum.delete(k);
        }

        // Create entries for each team (split evenly as approximation)
        // Actually better: store the full sum against each opponent's defense
        // since the total should approximate what both teams' players combine for
        const halfSum = totalSum / 2;
        const halfCount = Math.ceil(totalCount / 2);

        const eventId = unresolvedEntries.find(([k]) => k.startsWith(`${sport}|${game}`))?.[1]?.eventId || '';

        accum.set(`${sport}|${game}|${teams[0]}|${stat}`, {
          sum: halfSum, count: halfCount, eventId, opponent: teams[1],
        });
        accum.set(`${sport}|${game}|${teams[1]}|${stat}`, {
          sum: halfSum, count: halfCount, eventId, opponent: teams[0],
        });
      }
    }

    // 5. Cross-reference with defensive data and build rows
    const rows: any[] = [];

    for (const [key, val] of accum) {
      if (key.includes('__unresolved__')) continue;
      const [sport, game, team, stat] = key.split('|');

      let defAllowed: number | null = null;
      let defRank: number | null = null;

      if (sport === 'basketball_nba') {
        const defKey = `${val.opponent}|${stat}`;
        const def = nbaDef.get(defKey);
        if (def) {
          defAllowed = def.allowed;
          defRank = def.rank;
        }
      } else if (sport === 'icehockey_nhl') {
        const def = nhlDef.get(val.opponent);
        if (def) {
          if (stat === 'goals') { defAllowed = def.goals_against; }
          else if (stat === 'shots') { defAllowed = def.shots_against; }
          // assists: no direct defensive stat, skip
        }
      }
      // MLB: no defensive table yet, leave null

      const gap = defAllowed != null ? defAllowed - val.sum : null;
      const gapPct = defAllowed != null && defAllowed > 0 ? Math.round((gap! / defAllowed) * 10000) / 100 : null;
      const direction = gap != null ? (gap > 0 ? 'OVER' : 'UNDER') : null;

      rows.push({
        sport,
        game_description: game,
        event_id: val.eventId || null,
        team_name: team,
        opponent_name: val.opponent || null,
        stat_category: stat,
        summed_player_lines: Math.round(val.sum * 100) / 100,
        players_counted: val.count,
        opponent_defensive_allowed: defAllowed != null ? Math.round(defAllowed * 100) / 100 : null,
        opponent_defensive_rank: defRank,
        gap: gap != null ? Math.round(gap * 100) / 100 : null,
        gap_pct: gapPct,
        direction_signal: direction,
        analysis_date: today,
      });
    }

    log(`Computed ${rows.length} mismatch rows`);

    // 6. Upsert
    if (rows.length > 0) {
      const { error: upsertErr } = await supabase
        .from('line_sum_mismatch_analysis')
        .upsert(rows, { onConflict: 'sport,game_description,team_name,stat_category,analysis_date' });
      if (upsertErr) {
        log(`Upsert error: ${JSON.stringify(upsertErr)}`);
        throw upsertErr;
      }
    }

    // 7. Rank and send Telegram summary (top 5 biggest gaps)
    const ranked = rows
      .filter(r => r.gap != null)
      .sort((a, b) => Math.abs(b.gap_pct || 0) - Math.abs(a.gap_pct || 0))
      .slice(0, 5);

    if (ranked.length > 0) {
      const lines = ranked.map((r, i) =>
        `${i + 1}. ${r.direction_signal} ${r.team_name} ${r.stat_category} — summed: ${r.summed_player_lines}, allowed: ${r.opponent_defensive_allowed}, gap: ${r.gap > 0 ? '+' : ''}${r.gap} (${r.gap_pct > 0 ? '+' : ''}${r.gap_pct}%)`
      );
      const msg = [
        `📊 *Line-Sum Mismatch Report*`,
        `Top ${ranked.length} gaps across ${rows.length} team-stat combos:`,
        '',
        ...lines,
      ].join('\n');

      try {
        await supabase.functions.invoke('bot-send-telegram', {
          body: { message: msg, parse_mode: 'Markdown', admin_only: true },
        });
      } catch (_) { /* ignore */ }
    }

    const duration = Date.now() - startTime;
    log(`=== DONE (${duration}ms) — ${rows.length} rows stored ===`);

    return new Response(JSON.stringify({
      success: true,
      rows: rows.length,
      top_mismatches: ranked.slice(0, 3),
      duration_ms: duration,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    log(`Fatal: ${err.message}`);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
