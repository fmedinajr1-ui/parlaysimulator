/**
 * Parlay Veto Utility Functions
 * 
 * Shared utility functions for enforcing parlay correlation rules:
 * 1. One player per parlay (no same player appearing twice)
 * 2. No base + combo overlap (e.g., points + PRA for same player)
 * 3. No same event in safe mode
 */

export interface LegBase {
  player_name?: string;
  playerName?: string;
  stat_type?: string;
  propType?: string;
  event_id?: string;
  eventId?: string;
}

// Combo stat types mapped to their base components
export const COMBO_STAT_BASES: Record<string, string[]> = {
  'pra': ['points', 'rebounds', 'assists'],
  'points_rebounds_assists': ['points', 'rebounds', 'assists'],
  'player_points_rebounds_assists': ['points', 'rebounds', 'assists'],
  'pr': ['points', 'rebounds'],
  'points_rebounds': ['points', 'rebounds'],
  'player_points_rebounds': ['points', 'rebounds'],
  'pa': ['points', 'assists'],
  'points_assists': ['points', 'assists'],
  'player_points_assists': ['points', 'assists'],
  'ra': ['rebounds', 'assists'],
  'rebounds_assists': ['rebounds', 'assists'],
  'player_rebounds_assists': ['rebounds', 'assists'],
};

// Stat safety ranking - used for prioritizing safer prop types
export const STAT_SAFETY: Record<string, number> = {
  ra: 5,
  rebounds_assists: 5,
  rebounds: 4,
  assists: 3,
  points: 2,
  pra: 1,
  pr: 2,
  pa: 2,
};

/**
 * Normalize player name for consistent comparison
 */
export function normalizePlayerName(leg: LegBase): string {
  return ((leg.player_name || leg.playerName || '') as string).toLowerCase().trim();
}

/**
 * Normalize stat type for consistent comparison
 */
export function normalizeStatType(leg: LegBase): string {
  const stat = ((leg.stat_type || leg.propType || '') as string).toLowerCase().trim();
  
  // Normalize variations to canonical form
  if (stat.includes('player_points_rebounds_assists')) return 'pra';
  if (stat.includes('points_rebounds_assists')) return 'pra';
  if (stat.includes('player_points_rebounds') && !stat.includes('assists')) return 'pr';
  if (stat.includes('points_rebounds') && !stat.includes('assists')) return 'pr';
  if (stat.includes('player_points_assists') && !stat.includes('rebounds')) return 'pa';
  if (stat.includes('points_assists') && !stat.includes('rebounds')) return 'pa';
  if (stat.includes('player_rebounds_assists') && !stat.includes('points')) return 'ra';
  if (stat.includes('rebounds_assists') && !stat.includes('points')) return 'ra';
  if (stat.includes('player_points') && !stat.includes('rebounds') && !stat.includes('assists')) return 'points';
  if (stat.includes('player_rebounds') && !stat.includes('points') && !stat.includes('assists')) return 'rebounds';
  if (stat.includes('player_assists') && !stat.includes('points') && !stat.includes('rebounds')) return 'assists';
  
  return stat;
}

/**
 * Normalize event ID for consistent comparison
 */
export function normalizeEventId(leg: LegBase): string {
  return ((leg.event_id || leg.eventId || '') as string);
}

/**
 * Check if a player can be added to a parlay (one player per parlay rule)
 * Returns true if the player is NOT already in the parlay
 */
export function canAddPlayerLeg(
  playerCount: Record<string, number>,
  playerName: string
): boolean {
  const key = playerName.toLowerCase().trim();
  return (playerCount[key] || 0) === 0;
}

/**
 * Check if adding a candidate leg would violate the combo overlap rule
 * Returns true if there IS a violation (combo + base overlap for same player)
 */
export function violatesComboOverlap(
  existingLegs: LegBase[],
  candidate: LegBase
): boolean {
  const player = normalizePlayerName(candidate);
  const stat = normalizeStatType(candidate);

  const existingStats = existingLegs
    .filter(l => normalizePlayerName(l) === player)
    .map(l => normalizeStatType(l));

  if (existingStats.length === 0) return false;

  const comboStats = Object.keys(COMBO_STAT_BASES);
  const baseStats = ['points', 'rebounds', 'assists'];

  // If candidate is a combo stat
  if (comboStats.includes(stat)) {
    const bases = COMBO_STAT_BASES[stat] || [];
    // Check if any base component already exists
    if (existingStats.some(s => bases.includes(s))) return true;
    // Check if another combo exists (no combo stacking)
    if (existingStats.some(s => comboStats.includes(s))) return true;
    return true; // Block combo if player already has any leg
  }

  // If candidate is a base stat, check if a combo exists
  if (baseStats.includes(stat)) {
    for (const existingStat of existingStats) {
      if (comboStats.includes(existingStat)) {
        const existingBases = COMBO_STAT_BASES[existingStat] || [];
        if (existingBases.includes(stat)) return true;
      }
    }
  }

  return false;
}

/**
 * Check if all players in a parlay are unique (no same player)
 * Returns true if there are NO duplicate players
 */
export function noSamePlayer(legs: LegBase[]): boolean {
  const players = legs.map(l => normalizePlayerName(l));
  return players.length === new Set(players).size;
}

/**
 * Check if there are no base + combo overlaps for any player
 * Returns true if there are NO overlaps
 */
export function noBaseComboOverlap(legs: LegBase[]): boolean {
  for (let i = 1; i < legs.length; i++) {
    if (violatesComboOverlap(legs.slice(0, i), legs[i])) {
      return false;
    }
  }
  return true;
}

/**
 * Check if there are no same events in safe mode
 * Returns true if there are NO same events (in safe mode) or mode is high_risk
 */
export function noSameEventInSafeMode(
  legs: LegBase[],
  mode: 'safe' | 'high_risk'
): boolean {
  if (mode !== 'safe') return true;
  const events = legs.map(l => normalizeEventId(l)).filter(e => e);
  return events.length === new Set(events).size;
}

/**
 * Select the best prop from a list of picks based on quality score
 * Used when a player has multiple qualifying props (duo detection)
 */
export function selectBestPropFromList(
  picks: Array<{
    hit_rate_over_10?: number;
    hit_rate_under_10?: number;
    edge?: number;
    volatility?: number;
    stat_type?: string;
    recommendation?: string;
    [key: string]: unknown;
  }>
): typeof picks[0] | null {
  if (!picks || picks.length === 0) return null;

  return picks
    .map(p => {
      const isOver = p.recommendation?.includes('OVER');
      const hitRate = isOver ? (p.hit_rate_over_10 || 0.5) : (p.hit_rate_under_10 || 0.5);
      const statType = p.stat_type || '';
      return {
        ...p,
        quality_score:
          (hitRate * 100) +
          Math.abs(p.edge || 0) * 8 -
          ((p.volatility || 0) * 40) +
          (STAT_SAFETY[statType] || 1) * 5
      };
    })
    .sort((a, b) => b.quality_score - a.quality_score)[0];
}

/**
 * Fail-fast invariant assertion for duplicate players
 * Throws an error if duplicate players are detected
 */
export function assertNoDuplicatePlayers(legs: LegBase[], context: string): void {
  const uniquePlayers = new Set(legs.map(l => normalizePlayerName(l)));
  if (uniquePlayers.size !== legs.length) {
    const players = legs.map(l => normalizePlayerName(l));
    console.error(`[${context}] INVARIANT VIOLATION: Duplicate player detected!`, players);
    throw new Error(`Invariant violation: duplicate player detected in parlay (${context})`);
  }
}
