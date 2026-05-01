/**
 * player-role-context.ts
 *
 * Shared helper that resolves a player's archetype + role tier (STARTER /
 * ROTATION / BENCH) + season-stat baseline for the prop being evaluated.
 *
 * Used by signal-alert-engine (miss-by-1 danger-band gate) and
 * signal-alert-telegram (role label rendering in cascade messages).
 *
 * Pure read-only. No new tables.
 */

// deno-lint-ignore no-explicit-any
type Sb = any;

export type RoleTier = 'STARTER' | 'ROTATION' | 'BENCH' | 'UNKNOWN';

export interface PlayerRoleContext {
  player_name: string;
  archetype: string | null;       // e.g. GLASS_CLEANER, PURE_SHOOTER, ROLE_PLAYER
  role_tier: RoleTier;
  avg_minutes: number | null;
  // baseline + std for the *current* prop_type, when we know it
  baseline_mean: number | null;   // last_10 if available, else season avg
  baseline_std: number | null;
  baseline_source: 'l10' | 'season' | null;
}

const STAT_FIELD_MAP: Record<string, { mean: string; l10: string; std: string }> = {
  // NBA
  rebound: { mean: 'avg_rebounds', l10: 'last_10_avg_rebounds', std: 'rebounds_std_dev' },
  assist:  { mean: 'avg_assists',  l10: 'last_10_avg_assists',  std: 'assists_std_dev'  },
  three:   { mean: 'avg_threes',   l10: 'last_10_avg_threes',   std: 'threes_std_dev'   },
  point:   { mean: 'avg_points',   l10: 'last_10_avg_points',   std: 'points_std_dev'   },
};

function statKeyFromPropType(prop_type: string | null): string | null {
  if (!prop_type) return null;
  const p = prop_type.toLowerCase();
  if (p.includes('rebound')) return 'rebound';
  if (p.includes('assist'))  return 'assist';
  if (p.includes('three'))   return 'three';
  if (p.includes('point'))   return 'point';
  return null;
}

function tierFromMinutes(m: number | null): RoleTier {
  if (m == null || !Number.isFinite(m)) return 'UNKNOWN';
  if (m >= 28) return 'STARTER';
  if (m >= 22) return 'ROTATION';
  return 'BENCH';
}

/**
 * Batch-fetch role context for many players in one round-trip.
 * Returns a Map keyed by lowercased player name.
 */
export async function loadRoleContexts(
  supabase: Sb,
  players: Array<{ player_name: string; prop_type: string | null }>,
): Promise<Map<string, PlayerRoleContext>> {
  const out = new Map<string, PlayerRoleContext>();
  const distinctNames = Array.from(new Set(players.map((p) => p.player_name).filter(Boolean)));
  if (distinctNames.length === 0) return out;

  const [{ data: archetypes }, { data: stats }] = await Promise.all([
    supabase
      .from('player_archetypes')
      .select('player_name, primary_archetype')
      .in('player_name', distinctNames),
    supabase
      .from('player_season_stats')
      .select('player_name, avg_minutes, avg_points, avg_rebounds, avg_assists, avg_threes, last_10_avg_points, last_10_avg_rebounds, last_10_avg_assists, last_10_avg_threes, points_std_dev, rebounds_std_dev, assists_std_dev, threes_std_dev')
      .in('player_name', distinctNames),
  ]);

  const archMap = new Map<string, string>();
  for (const a of (archetypes ?? []) as Array<Record<string, string>>) {
    if (a.player_name) archMap.set(a.player_name.toLowerCase(), a.primary_archetype);
  }

  const statMap = new Map<string, Record<string, number | null>>();
  for (const s of (stats ?? []) as Array<Record<string, number | null> & { player_name: string }>) {
    if (s.player_name) statMap.set(s.player_name.toLowerCase(), s);
  }

  for (const p of players) {
    const key = p.player_name.toLowerCase();
    if (out.has(key)) continue;
    const arch = archMap.get(key) ?? null;
    const s = statMap.get(key);
    const minutes = s?.avg_minutes != null ? Number(s.avg_minutes) : null;

    const statKey = statKeyFromPropType(p.prop_type);
    let mean: number | null = null;
    let std: number | null = null;
    let source: 'l10' | 'season' | null = null;
    if (statKey && s) {
      const fields = STAT_FIELD_MAP[statKey];
      const l10 = s[fields.l10];
      const seasonAvg = s[fields.mean];
      const stdRaw = s[fields.std];
      if (l10 != null) { mean = Number(l10); source = 'l10'; }
      else if (seasonAvg != null) { mean = Number(seasonAvg); source = 'season'; }
      if (stdRaw != null) std = Number(stdRaw);
    }

    out.set(key, {
      player_name: p.player_name,
      archetype: arch,
      role_tier: tierFromMinutes(minutes),
      avg_minutes: minutes,
      baseline_mean: mean,
      baseline_std: std,
      baseline_source: source,
    });
  }

  return out;
}

/**
 * Miss-by-1 danger band check.
 *
 * Returns { drop: true, reason } when the leg's line sits inside half a
 * standard deviation of the player's recent mean (the band where one rebound
 * or one point routinely flips a leg).  Bench players use a stricter 0.75 std
 * band because their minutes/usage volatility makes them lose by 1 even more
 * often.
 */
export interface DangerBandInput {
  side: 'Over' | 'Under';
  line: number;
  ctx: PlayerRoleContext;
}

export interface DangerBandResult {
  drop: boolean;
  reason: string | null;
  distance: number | null;
  band: number | null;
}

export function dangerBandCheck(input: DangerBandInput): DangerBandResult {
  const { side, line, ctx } = input;
  if (ctx.baseline_mean == null) {
    return { drop: false, reason: null, distance: null, band: null };
  }

  const mean = ctx.baseline_mean;
  const std = ctx.baseline_std != null && Number.isFinite(ctx.baseline_std) && ctx.baseline_std > 0
    ? ctx.baseline_std
    : 1.5; // safe default when we don't have std (one rebound / one point)

  const distance = Math.abs(line - mean);
  // Stricter band for bench / role-player legs (where miss-by-1 is most common)
  const isBench = ctx.role_tier === 'BENCH' || ctx.archetype === 'ROLE_PLAYER';
  const bandMultiplier = isBench ? 0.75 : 0.5;
  const band = Math.max(0.6, bandMultiplier * std);

  // Only suppress if the mean is on the *wrong* side of the line for our pick.
  // Over wants mean comfortably above the line; Under wants mean comfortably below.
  const wrongSide = (side === 'Over' && line > mean) || (side === 'Under' && line < mean);

  if (wrongSide && distance < band) {
    const tierLabel = isBench ? `${ctx.role_tier} (${ctx.archetype ?? 'unknown'})` : ctx.role_tier;
    const reason = `miss_by_1_risk · line ${line} vs ${ctx.baseline_source ?? 'season'} mean ${mean.toFixed(1)} (Δ ${distance.toFixed(2)} < band ${band.toFixed(2)}, ${tierLabel})`;
    return { drop: true, reason, distance: Number(distance.toFixed(2)), band: Number(band.toFixed(2)) };
  }

  // Volume floor: very low minutes → drop regardless (high variance = miss-by-1 magnet)
  if (ctx.avg_minutes != null) {
    const minutesFloor = isBench ? 14 : 22;
    if (ctx.avg_minutes < minutesFloor) {
      return {
        drop: true,
        reason: `low_minutes · ${ctx.avg_minutes.toFixed(1)} mpg < ${minutesFloor} (${ctx.role_tier})`,
        distance: Number(distance.toFixed(2)),
        band: Number(band.toFixed(2)),
      };
    }
  }

  return { drop: false, reason: null, distance: Number(distance.toFixed(2)), band: Number(band.toFixed(2)) };
}

// ─── Telegram-facing helpers ────────────────────────────────────────────

const ARCHETYPE_EMOJI: Record<string, string> = {
  ELITE_REBOUNDER: '🛡️',
  GLASS_CLEANER: '🛡️',
  RIM_PROTECTOR: '🛡️',
  PRIMARY_SCORER: '⭐',
  SCORING_WING: '⭐',
  SCORING_GUARD: '⭐',
  ELITE_PLAYMAKER: '🎯',
  PLAYMAKER: '🎯',
  COMBO_GUARD: '🎯',
  PURE_SHOOTER: '🏹',
  STRETCH_BIG: '🏹',
  DEFENSIVE_ANCHOR: '🦅',
  TWO_WAY_WING: '🦅',
  ROLE_PLAYER: '🔧',
};

export function archetypeEmoji(arch: string | null): string {
  if (!arch) return '👤';
  return ARCHETYPE_EMOJI[arch] ?? '👤';
}

export function formatRoleLine(ctx: PlayerRoleContext | null | undefined): string | null {
  if (!ctx) return null;
  const arch = ctx.archetype ?? 'UNKNOWN';
  const tier = ctx.role_tier;
  const mpg = ctx.avg_minutes != null ? ` (${ctx.avg_minutes.toFixed(1)} mpg)` : '';
  return `${archetypeEmoji(ctx.archetype)} ${arch} · ${tier}${mpg}`;
}