// Pre-game baseline types for Scout agent

export interface PreGameBaseline {
  playerName: string;
  fatigueScore: number;     // From team fatigue (0-100)
  speedIndex: number;       // From consistency + trend (0-100)
  effortScore: number;      // From minutes + trend (0-100)
  minutesEstimate: number;  // From avg_minutes
  trend: 'hot' | 'cold' | 'stable';
  consistency: number;      // Player consistency score (0-100)
}

export interface TeamFatigueData {
  teamName: string;
  fatigueScore: number;       // 0-100
  fatigueCategory: string;    // 'fresh', 'moderate', 'elevated', 'high'
  isBackToBack: boolean;
  isRoadB2B: boolean;
  isThreeInFour: boolean;
  isFourInSix: boolean;
  travelMiles: number | null;
}

export interface PlayerSeasonStats {
  playerName: string;
  avgMinutes: number;
  avgPoints: number;
  avgRebounds: number;
  avgAssists: number;
  consistencyScore: number;   // 0-100
  trendDirection: 'hot' | 'cold' | 'stable';
  last10AvgPoints: number | null;
  b2bAvgPoints: number | null;
  restAvgPoints: number | null;
}

// Calculate pre-game baseline for a player
export function calculatePreGameBaseline(
  playerName: string,
  playerStats: PlayerSeasonStats | null,
  teamFatigue: TeamFatigueData | null
): PreGameBaseline {
  // Base fatigue from team schedule (default to fresh 10)
  const teamFatigueScore = teamFatigue?.fatigueScore ?? 10;
  
  // Apply multipliers for schedule factors
  let fatigueScore = teamFatigueScore;
  if (teamFatigue?.isBackToBack) fatigueScore = Math.min(fatigueScore + 15, 50);
  if (teamFatigue?.isRoadB2B) fatigueScore = Math.min(fatigueScore + 10, 60);
  if (teamFatigue?.isThreeInFour) fatigueScore = Math.min(fatigueScore + 8, 55);
  if (teamFatigue?.isFourInSix) fatigueScore = Math.min(fatigueScore + 12, 58);
  
  // Travel fatigue
  if (teamFatigue?.travelMiles && teamFatigue.travelMiles > 1500) {
    fatigueScore = Math.min(fatigueScore + 5, 60);
  }
  
  // Player consistency affects speed reliability
  const consistency = playerStats?.consistencyScore ?? 65;
  const trend = playerStats?.trendDirection ?? 'stable';
  
  // Speed index based on consistency (high consistency = reliable speed)
  let speedIndex = consistency;
  
  // Effort based on recent performance trend
  let effortScore = 55;
  
  if (trend === 'hot') {
    speedIndex = Math.min(speedIndex + 10, 85);
    effortScore = 70;
  } else if (trend === 'cold') {
    speedIndex = Math.max(speedIndex - 10, 40);
    effortScore = 45;
  }
  
  // Minutes estimate from season average
  const minutesEstimate = playerStats?.avgMinutes ?? 25;
  
  return {
    playerName,
    fatigueScore: Math.round(fatigueScore),
    speedIndex: Math.round(speedIndex),
    effortScore: Math.round(effortScore),
    minutesEstimate: Math.round(minutesEstimate * 10) / 10,
    trend: trend as 'hot' | 'cold' | 'stable',
    consistency: Math.round(consistency),
  };
}
