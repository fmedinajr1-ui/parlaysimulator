/**
 * alert-explainer.ts
 *
 * Shared helper that produces a per-player "engine reasoning" block for any
 * signal alert (cascade, take_it_now, velocity_spike, sb_over_l10, etc.).
 *
 * Goal: every alert should explain WHY the engine picked this player and
 * WHAT they're going against — opponent defense, recent form, juice, role —
 * so we can audit and tune the engine's decision-making.
 *
 * Pure cross-reference. Reads only. No new tables.
 *
 * Contract version: v1
 */

// deno-lint-ignore no-explicit-any
type Sb = any;

export type Side = 'Over' | 'Under';
export type Verdict = 'STRONG' | 'LEAN' | 'WEAK';
export type Alignment = 'aligned' | 'neutral' | 'against' | 'no_data';

export interface ExplainerInput {
  player_name: string;
  prop_type: string;
  side: Side;
  line: number;
  event_id: string;
  sport: string;        // normalised: 'NBA' | 'MLB' | 'NHL' | 'NFL' | ...
  juice_gap?: number | null;
}

export interface PlayerReasoning {
  version: 'v1';
  matchup: {
    opponent_team: string | null;
    defense_rank: number | null;     // 1 = best defense (lowest stat allowed)
    position_defense_rank: number | null;
    stat_allowed: number | null;
    game_script: string | null;
    blowout_risk: number | null;
    vegas_total: number | null;
  };
  form: {
    l10_hits: number | null;         // games >= line (for Over) / <= line (for Under)
    l10_total: number | null;
    hit_rate: number | null;         // 0..1
    last_value: number | null;
  };
  role: {
    minutes_score: number | null;    // pvs_minutes_score from unified_props (lower = volatile)
    minutes_flag: 'volatile' | 'stable' | null;
  };
  pvs: {
    tier: string | null;
    matchup_score: number | null;
    pace_score: number | null;
  };
  juice: {
    gap: number | null;
    aligned_with_side: boolean | null;
  };
  injuries: {
    relevant_count: number;
    headlines: string[];             // e.g. "Carter Jr (probable - ankle)"
  };
  alignment: {
    defense: Alignment;
    form: Alignment;
    pace: Alignment;
    juice: Alignment;
    role: Alignment;
  };
  aligned_count: number;
  verdict: Verdict;
  headline: string;                  // one-line summary for telegram
  flags: string[];                   // short tags for UI ('volatile_minutes', 'soft_matchup', etc.)
}

export interface GroupReasoning {
  version: 'v1';
  opponent_team: string | null;
  vegas_total: number | null;
  game_script: string | null;
  shared_defense_rank: number | null;
  shared_position_defense_rank: number | null;
  injury_headlines: string[];
  headline_bullets: string[];        // 1-3 lines summarizing the group context
}

// ---------- helpers ----------

function pickPropFamily(prop_type: string): {
  sport_table: 'nba' | 'mlb' | 'nhl' | 'nfl' | null;
  log_field: string | null;
  defense_category: string | null;
} {
  const p = prop_type.toLowerCase();

  // NBA
  if (p.includes('rebound')) return { sport_table: 'nba', log_field: 'rebounds', defense_category: 'rebounds' };
  if (p.includes('assist'))  return { sport_table: 'nba', log_field: 'assists',  defense_category: 'assists'  };
  if (p.includes('three') || p === 'player_threes') return { sport_table: 'nba', log_field: 'threes_made', defense_category: 'threes' };
  if (p.includes('block'))   return { sport_table: 'nba', log_field: 'blocks',   defense_category: 'blocks'   };
  if (p.includes('steal'))   return { sport_table: 'nba', log_field: 'steals',   defense_category: null       };
  if (p.includes('point'))   return { sport_table: 'nba', log_field: 'points',   defense_category: 'points'   };

  // MLB
  if (p.includes('stolen_base')) return { sport_table: 'mlb', log_field: 'stolen_bases', defense_category: null };
  if (p.includes('home_run') || p.includes('hr'))      return { sport_table: 'mlb', log_field: 'home_runs',    defense_category: null };
  if (p.includes('rbi'))         return { sport_table: 'mlb', log_field: 'rbis',         defense_category: null };
  if (p.includes('hit'))         return { sport_table: 'mlb', log_field: 'hits',         defense_category: null };
  if (p.includes('total_base'))  return { sport_table: 'mlb', log_field: 'total_bases',  defense_category: null };
  if (p.includes('strikeout'))   return { sport_table: 'mlb', log_field: 'pitcher_strikeouts', defense_category: null };

  return { sport_table: null, log_field: null, defense_category: null };
}

function classifyAlignment(value: number | null, threshold_aligned: number, threshold_against: number, higher_is_aligned = true): Alignment {
  if (value == null || !Number.isFinite(value)) return 'no_data';
  if (higher_is_aligned) {
    if (value >= threshold_aligned) return 'aligned';
    if (value <= threshold_against) return 'against';
  } else {
    if (value <= threshold_aligned) return 'aligned';
    if (value >= threshold_against) return 'against';
  }
  return 'neutral';
}

function computeVerdict(aligned_count: number, against_count: number): Verdict {
  if (aligned_count >= 4) return 'STRONG';
  if (against_count >= 3) return 'WEAK';
  if (aligned_count >= 3) return 'LEAN';
  if (aligned_count <= 1) return 'WEAK';
  return 'LEAN';
}

function side_emoji(side: Side): string {
  return side === 'Over' ? '⬆️' : '⬇️';
}

function fmtRank(n: number | null | undefined): string {
  if (n == null) return '—';
  const v = Math.round(n);
  const s = v % 100;
  if (s >= 11 && s <= 13) return `${v}th`;
  switch (v % 10) {
    case 1: return `${v}st`;
    case 2: return `${v}nd`;
    case 3: return `${v}rd`;
    default: return `${v}th`;
  }
}

// ---------- main ----------

/**
 * Build a per-player reasoning block. Returns null only if the player is
 * completely unknown to our data layer (we still want the alert to fire,
 * just without the explainer).
 */
export async function buildPlayerReasoning(
  supabase: Sb,
  input: ExplainerInput,
): Promise<PlayerReasoning> {
  const family = pickPropFamily(input.prop_type);
  const isOver = input.side === 'Over';

  // 1. Pull matchup_intelligence for this player+prop
  const todayIso = new Date().toISOString().slice(0, 10);
  const { data: mi } = await supabase
    .from('matchup_intelligence')
    .select('opponent_team, opponent_defensive_rank, position_defense_rank, opponent_stat_allowed, game_script, blowout_risk, vegas_total')
    .eq('player_name', input.player_name)
    .eq('prop_type', input.prop_type)
    .gte('game_date', todayIso)
    .order('game_date', { ascending: true })
    .limit(1)
    .maybeSingle();

  // 2. Pull unified_props for PVS sub-scores + recommendation context
  const { data: up } = await supabase
    .from('unified_props')
    .select('pvs_tier, pvs_matchup_score, pvs_pace_score, pvs_minutes_score')
    .eq('player_name', input.player_name)
    .eq('prop_type', input.prop_type)
    .eq('event_id', input.event_id)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // 3. L10 hit rate from the sport's game logs
  let l10_hits: number | null = null;
  let l10_total: number | null = null;
  let last_value: number | null = null;
  if (family.sport_table && family.log_field) {
    const tableMap = {
      nba: 'nba_player_game_logs',
      mlb: 'mlb_player_game_logs',
      nhl: 'nhl_player_game_logs',
      nfl: 'nfl_player_game_logs',
    } as const;
    const tableName = tableMap[family.sport_table];
    const { data: logs } = await supabase
      .from(tableName)
      .select(`game_date, ${family.log_field}`)
      .eq('player_name', input.player_name)
      .order('game_date', { ascending: false })
      .limit(10);
    if (logs && logs.length > 0) {
      l10_total = logs.length;
      l10_hits = 0;
      for (const row of logs as Array<Record<string, number>>) {
        const v = Number(row[family.log_field as string] ?? 0);
        if (isOver ? v > input.line : v < input.line) l10_hits += 1;
      }
      last_value = Number((logs[0] as Record<string, number>)[family.log_field as string] ?? 0);
    }
  }
  const hit_rate = l10_total && l10_total > 0 ? (l10_hits ?? 0) / l10_total : null;

  // 4. Injuries on the opponent team (roster context)
  const injury_headlines: string[] = [];
  let injury_count = 0;
  if (mi?.opponent_team) {
    const { data: injs } = await supabase
      .from('injury_reports')
      .select('player_name, position, status, injury_type')
      .eq('team_name', mi.opponent_team)
      .gte('updated_at', new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString())
      .limit(5);
    if (injs && injs.length > 0) {
      injury_count = injs.length;
      for (const inj of injs as Array<Record<string, string>>) {
        injury_headlines.push(`${inj.player_name} (${(inj.status || '').toLowerCase()}${inj.injury_type ? ' - ' + inj.injury_type : ''})`);
      }
    }
  }

  // 5. Alignments
  // Defense: low rank = strong defense. For Under, strong defense = aligned.
  //          For Over, weak defense (high rank) = aligned.
  const positionRank = mi?.position_defense_rank ?? mi?.opponent_defensive_rank ?? null;
  let defenseAlign: Alignment = 'no_data';
  if (positionRank != null) {
    if (isOver) {
      defenseAlign = positionRank >= 22 ? 'aligned' : positionRank <= 10 ? 'against' : 'neutral';
    } else {
      defenseAlign = positionRank <= 10 ? 'aligned' : positionRank >= 22 ? 'against' : 'neutral';
    }
  }

  // Form: hit rate >= 0.6 = aligned, <= 0.3 = against
  const formAlign: Alignment = hit_rate == null
    ? 'no_data'
    : hit_rate >= 0.6 ? 'aligned' : hit_rate <= 0.3 ? 'against' : 'neutral';

  // Pace: vegas_total directional. Over wants high totals, Under wants low.
  // NBA threshold reference: ~225 high / ~215 low. MLB: 9 high / 7.5 low.
  let paceAlign: Alignment = 'no_data';
  const total = mi?.vegas_total ?? null;
  if (total != null) {
    const isMlb = input.sport === 'MLB';
    const high = isMlb ? 9 : 225;
    const low = isMlb ? 7.5 : 215;
    if (isOver) {
      paceAlign = total >= high ? 'aligned' : total <= low ? 'against' : 'neutral';
    } else {
      paceAlign = total <= low ? 'aligned' : total >= high ? 'against' : 'neutral';
    }
  }

  // Juice: gap >= 15 always confirms whatever side the engine picked
  const juiceAlign: Alignment = input.juice_gap == null
    ? 'no_data'
    : input.juice_gap >= 30 ? 'aligned' : input.juice_gap >= 15 ? 'neutral' : 'against';

  // Role / minutes (NBA-only really; MLB will be no_data)
  let roleAlign: Alignment = 'no_data';
  let minutes_flag: 'volatile' | 'stable' | null = null;
  const minutes_score = up?.pvs_minutes_score ?? null;
  if (minutes_score != null) {
    minutes_flag = minutes_score < 50 ? 'volatile' : 'stable';
    roleAlign = minutes_score >= 70 ? 'aligned' : minutes_score < 40 ? 'against' : 'neutral';
  }

  const alignment = { defense: defenseAlign, form: formAlign, pace: paceAlign, juice: juiceAlign, role: roleAlign };
  const aligned_count = Object.values(alignment).filter((a) => a === 'aligned').length;
  const against_count = Object.values(alignment).filter((a) => a === 'against').length;
  const verdict = computeVerdict(aligned_count, against_count);

  // Headline
  const headlineParts: string[] = [];
  if (defenseAlign !== 'no_data' && positionRank != null) {
    const dRank = fmtRank(positionRank);
    if (defenseAlign === 'aligned') {
      headlineParts.push(isOver ? `vs soft D (${dRank})` : `vs tough D (${dRank})`);
    } else if (defenseAlign === 'against') {
      headlineParts.push(isOver ? `tough D (${dRank})` : `soft D (${dRank})`);
    }
  }
  if (formAlign === 'aligned' && l10_hits != null && l10_total != null) {
    headlineParts.push(`L10 ${input.side} ${l10_hits}/${l10_total}`);
  } else if (formAlign === 'against' && l10_hits != null && l10_total != null) {
    headlineParts.push(`cold L10 (${l10_hits}/${l10_total})`);
  }
  if (juiceAlign === 'aligned' && input.juice_gap) {
    headlineParts.push(`juice +${Math.round(input.juice_gap)}`);
  }
  if (minutes_flag === 'volatile') {
    headlineParts.push('volatile minutes');
  }

  const headline = headlineParts.length > 0
    ? headlineParts.join(' · ')
    : (verdict === 'STRONG' ? 'multi-signal alignment' : 'price-driven, matchup unverified');

  // Flags
  const flags: string[] = [];
  if (minutes_flag === 'volatile') flags.push('volatile_minutes');
  if (defenseAlign === 'aligned')  flags.push(isOver ? 'soft_matchup' : 'tough_matchup');
  if (defenseAlign === 'against')  flags.push('matchup_against_side');
  if (formAlign === 'against')     flags.push('cold_form');
  if (juiceAlign === 'against')    flags.push('thin_juice');
  if (mi?.blowout_risk && Number(mi.blowout_risk) > 0.6) flags.push('blowout_risk');

  return {
    version: 'v1',
    matchup: {
      opponent_team: mi?.opponent_team ?? null,
      defense_rank: mi?.opponent_defensive_rank ?? null,
      position_defense_rank: mi?.position_defense_rank ?? null,
      stat_allowed: mi?.opponent_stat_allowed ?? null,
      game_script: mi?.game_script ?? null,
      blowout_risk: mi?.blowout_risk != null ? Number(mi.blowout_risk) : null,
      vegas_total: mi?.vegas_total != null ? Number(mi.vegas_total) : null,
    },
    form: { l10_hits, l10_total, hit_rate, last_value },
    role: { minutes_score, minutes_flag },
    pvs: {
      tier: up?.pvs_tier ?? null,
      matchup_score: up?.pvs_matchup_score ?? null,
      pace_score: up?.pvs_pace_score ?? null,
    },
    juice: { gap: input.juice_gap ?? null, aligned_with_side: juiceAlign === 'aligned' },
    injuries: { relevant_count: injury_count, headlines: injury_headlines },
    alignment,
    aligned_count,
    verdict,
    headline,
    flags,
  };
}

/**
 * Group-level reasoning shared across multiple players in a cascade.
 * Pulls one matchup_intelligence row per (event, prop_type, side) and
 * derives the shared defensive context + opponent injury list.
 */
export function buildGroupReasoning(
  players: PlayerReasoning[],
  side: Side,
  prop_type: string,
): GroupReasoning {
  // Use the most common opponent_team across the group (they should match)
  const teamCounts = new Map<string, number>();
  for (const p of players) {
    const t = p.matchup.opponent_team;
    if (t) teamCounts.set(t, (teamCounts.get(t) ?? 0) + 1);
  }
  let opponent_team: string | null = null;
  let opponent_n = 0;
  for (const [t, n] of teamCounts) {
    if (n > opponent_n) { opponent_team = t; opponent_n = n; }
  }

  const totals = players.map((p) => p.matchup.vegas_total).filter((x): x is number => x != null);
  const vegas_total = totals.length > 0 ? totals[0] : null;

  const scripts = players.map((p) => p.matchup.game_script).filter((x): x is string => !!x);
  const game_script = scripts[0] ?? null;

  const ranks = players.map((p) => p.matchup.defense_rank).filter((x): x is number => x != null);
  const posRanks = players.map((p) => p.matchup.position_defense_rank).filter((x): x is number => x != null);

  const shared_defense_rank = ranks.length > 0 ? Math.round(ranks.reduce((s, r) => s + r, 0) / ranks.length) : null;
  const shared_position_defense_rank = posRanks.length > 0 ? Math.round(posRanks.reduce((s, r) => s + r, 0) / posRanks.length) : null;

  const injury_set = new Set<string>();
  for (const p of players) for (const h of p.injuries.headlines) injury_set.add(h);
  const injury_headlines = Array.from(injury_set).slice(0, 3);

  const isOver = side === 'Over';
  const propLabel = prop_type.replace(/^batter_|^player_/, '').replace(/_/g, ' ');

  const bullets: string[] = [];
  if (opponent_team && shared_position_defense_rank != null) {
    if (isOver && shared_position_defense_rank >= 22) {
      bullets.push(`${opponent_team} allow top-${33 - shared_position_defense_rank} ${propLabel} to this position`);
    } else if (!isOver && shared_position_defense_rank <= 10) {
      bullets.push(`${opponent_team} allow bottom-${shared_position_defense_rank} ${propLabel} to this position`);
    } else {
      bullets.push(`vs ${opponent_team} — ${propLabel} D rank ${fmtRank(shared_position_defense_rank)} (neutral)`);
    }
  }
  if (vegas_total != null) {
    bullets.push(isOver
      ? `Game total ${vegas_total} — ${vegas_total >= 225 ? 'pace tailwind' : vegas_total <= 215 ? 'pace headwind ⚠️' : 'neutral pace'}`
      : `Game total ${vegas_total} — ${vegas_total <= 215 ? 'pace tailwind' : vegas_total >= 225 ? 'pace headwind ⚠️' : 'neutral pace'}`);
  }
  if (injury_headlines.length > 0) {
    bullets.push(`Opponent injuries: ${injury_headlines.join(', ')}`);
  }

  return {
    version: 'v1',
    opponent_team,
    vegas_total,
    game_script,
    shared_defense_rank,
    shared_position_defense_rank,
    injury_headlines,
    headline_bullets: bullets,
  };
}

// ---------- presentation helpers (used by Telegram formatter) ----------

export function verdictBadge(v: Verdict): string {
  switch (v) {
    case 'STRONG': return '✅ STRONG';
    case 'LEAN':   return '⚠️ LEAN';
    case 'WEAK':   return '❌ WEAK';
  }
}

export function formatPlayerReasoningLines(
  player: string,
  side: Side,
  line: number,
  confidence: number,
  reasoning: PlayerReasoning,
): string[] {
  const lines: string[] = [];
  const sideTag = `${side[0]} ${line}`;
  lines.push(`• ${player}  ${sideTag}  conf ${Math.round(confidence)}%`);

  // Matchup line
  const m = reasoning.matchup;
  const defRank = m.position_defense_rank ?? m.defense_rank;
  const matchParts: string[] = [];
  if (m.opponent_team && defRank != null) {
    matchParts.push(`vs ${m.opponent_team} D rank ${fmtRank(defRank)}`);
  }
  if (reasoning.form.l10_total) {
    matchParts.push(`L10 ${side} ${reasoning.form.l10_hits}/${reasoning.form.l10_total}`);
  }
  if (matchParts.length > 0) lines.push(`   ↳ ${matchParts.join(' · ')}`);

  // Secondary signals (juice + role)
  const sec: string[] = [];
  if (reasoning.juice.gap && reasoning.juice.gap >= 15) {
    sec.push(`Juice gap ${Math.round(reasoning.juice.gap)} ${reasoning.juice.aligned_with_side ? '(book on this side)' : '(thin)'}`);
  }
  if (reasoning.pvs.tier && reasoning.pvs.tier !== 'uncategorized') {
    sec.push(`PVS ${reasoning.pvs.tier}`);
  }
  if (reasoning.role.minutes_flag === 'volatile') {
    sec.push('⚠️ volatile minutes');
  }
  if (sec.length > 0) lines.push(`   ↳ ${sec.join(' · ')}`);

  // Verdict
  lines.push(`   ↳ Verdict: ${verdictBadge(reasoning.verdict)} — ${reasoning.headline} ${side_emoji(side)}`);
  return lines;
}