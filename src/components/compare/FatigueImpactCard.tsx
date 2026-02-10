import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { getEasternDate } from '@/lib/dateUtils';
import { ParlaySimulation } from '@/types/parlay';
import { FeedCard } from '@/components/FeedCard';
import { Badge } from '@/components/ui/badge';
import { Battery, BatteryLow, BatteryWarning, TrendingUp, TrendingDown, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FatigueImpactCardProps {
  simulations: ParlaySimulation[];
}

interface FatigueScore {
  team_name: string;
  fatigue_score: number;
  fatigue_category: string;
  is_back_to_back: boolean;
  opponent: string;
}

const NBA_TEAMS = [
  'Hawks', 'Celtics', 'Nets', 'Hornets', 'Bulls', 'Cavaliers', 'Mavericks', 'Nuggets',
  'Pistons', 'Warriors', 'Rockets', 'Pacers', 'Clippers', 'Lakers', 'Grizzlies', 'Heat',
  'Bucks', 'Timberwolves', 'Pelicans', 'Knicks', 'Thunder', 'Magic', '76ers', 'Suns',
  'Blazers', 'Kings', 'Spurs', 'Raptors', 'Jazz', 'Wizards',
  'Atlanta', 'Boston', 'Brooklyn', 'Charlotte', 'Chicago', 'Cleveland', 'Dallas', 'Denver',
  'Detroit', 'Golden State', 'Houston', 'Indiana', 'Los Angeles', 'LA', 'Memphis', 'Miami',
  'Milwaukee', 'Minnesota', 'New Orleans', 'New York', 'Oklahoma City', 'Orlando', 'Philadelphia',
  'Phoenix', 'Portland', 'Sacramento', 'San Antonio', 'Toronto', 'Utah', 'Washington'
];

function extractTeamFromLeg(description: string): string | null {
  const upperDesc = description.toUpperCase();
  for (const team of NBA_TEAMS) {
    if (upperDesc.includes(team.toUpperCase())) {
      return team;
    }
  }
  return null;
}

function isNBALeg(description: string): boolean {
  return extractTeamFromLeg(description) !== null;
}

export function FatigueImpactCard({ simulations }: FatigueImpactCardProps) {
  const { data: fatigueScores, isLoading } = useQuery({
    queryKey: ['compare-fatigue-scores'],
    queryFn: async () => {
      const today = getEasternDate();
      const { data, error } = await supabase
        .from('nba_fatigue_scores')
        .select('team_name, fatigue_score, fatigue_category, is_back_to_back, opponent')
        .eq('game_date', today);
      
      if (error) throw error;
      return data as FatigueScore[];
    },
  });

  // Analyze each parlay for fatigue impact
  const parlayFatigueAnalysis = simulations.map((sim, idx) => {
    const nbaLegs = sim.legs.filter(leg => isNBALeg(leg.description));
    
    if (nbaLegs.length === 0 || !fatigueScores) {
      return { parlayIndex: idx, hasNBA: false, fatigueImpacts: [], totalBoost: 0, totalRisk: 0 };
    }

    const fatigueImpacts: Array<{
      leg: string;
      team: string;
      fatigue: number;
      category: string;
      impact: 'boost' | 'risk' | 'neutral';
      isB2B: boolean;
    }> = [];

    let totalBoost = 0;
    let totalRisk = 0;

    for (const leg of nbaLegs) {
      const team = extractTeamFromLeg(leg.description);
      if (!team) continue;

      // Find matching fatigue score
      const matchingScore = fatigueScores.find(fs => 
        fs.team_name.toLowerCase().includes(team.toLowerCase()) ||
        team.toLowerCase().includes(fs.team_name.toLowerCase().split(' ').pop() || '')
      );

      if (matchingScore) {
        // Determine if this is a bet FOR or AGAINST the fatigued team
        const isUnder = leg.description.toLowerCase().includes('under');
        const isFade = leg.description.toLowerCase().includes('fade') || 
                       leg.description.toLowerCase().includes('against');
        
        let impact: 'boost' | 'risk' | 'neutral' = 'neutral';
        
        if (matchingScore.fatigue_score >= 30) {
          // High fatigue - betting against them is good
          if (isUnder || isFade) {
            impact = 'boost';
            totalBoost += 2;
          } else {
            impact = 'risk';
            totalRisk += 2;
          }
        } else if (matchingScore.fatigue_score >= 20) {
          if (isUnder || isFade) {
            impact = 'boost';
            totalBoost += 1;
          } else {
            impact = 'risk';
            totalRisk += 1;
          }
        }

        fatigueImpacts.push({
          leg: leg.description,
          team: matchingScore.team_name,
          fatigue: matchingScore.fatigue_score,
          category: matchingScore.fatigue_category,
          impact,
          isB2B: matchingScore.is_back_to_back,
        });
      }
    }

    return {
      parlayIndex: idx,
      hasNBA: true,
      fatigueImpacts,
      totalBoost,
      totalRisk,
      netScore: totalBoost - totalRisk,
    };
  });

  const hasAnyFatigueData = parlayFatigueAnalysis.some(p => p.hasNBA && p.fatigueImpacts.length > 0);

  if (isLoading || !hasAnyFatigueData) {
    return null;
  }

  const bestFatigueParlayIdx = parlayFatigueAnalysis.reduce((best, curr) => 
    (curr.netScore || 0) > (best.netScore || 0) ? curr : best
  ).parlayIndex;

  return (
    <FeedCard className="p-4">
      <div className="flex items-center gap-2 mb-4">
        <Battery className="w-5 h-5 text-primary" />
        <h3 className="font-display text-sm">FATIGUE IMPACT ANALYSIS</h3>
      </div>

      <div className="space-y-4">
        {parlayFatigueAnalysis.map((analysis, idx) => {
          if (!analysis.hasNBA || analysis.fatigueImpacts.length === 0) {
            return (
              <div key={idx} className="p-3 bg-muted/20 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <Badge variant="secondary">Parlay {idx + 1}</Badge>
                  <span className="text-xs text-muted-foreground">No NBA legs</span>
                </div>
              </div>
            );
          }

          const isBestFatigue = idx === bestFatigueParlayIdx && analysis.netScore! > 0;

          return (
            <div 
              key={idx} 
              className={cn(
                "p-3 rounded-lg",
                isBestFatigue ? "bg-primary/10 ring-1 ring-primary/30" : "bg-muted/20"
              )}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Badge variant={isBestFatigue ? "default" : "secondary"}>
                    Parlay {idx + 1}
                  </Badge>
                  {isBestFatigue && (
                    <span className="text-xs text-primary font-medium">BEST FATIGUE</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {analysis.totalBoost! > 0 && (
                    <Badge variant="outline" className="text-green-500 border-green-500/30">
                      <TrendingUp className="w-3 h-3 mr-1" />
                      +{analysis.totalBoost}
                    </Badge>
                  )}
                  {analysis.totalRisk! > 0 && (
                    <Badge variant="outline" className="text-red-500 border-red-500/30">
                      <TrendingDown className="w-3 h-3 mr-1" />
                      -{analysis.totalRisk}
                    </Badge>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                {analysis.fatigueImpacts.map((impact, impactIdx) => (
                  <div 
                    key={impactIdx}
                    className="flex items-center justify-between text-xs p-2 bg-background/50 rounded"
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      {impact.impact === 'boost' ? (
                        <TrendingUp className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                      ) : impact.impact === 'risk' ? (
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                      ) : (
                        <Battery className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      )}
                      <span className="truncate text-muted-foreground">{impact.team}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Badge 
                        variant="outline" 
                        className={cn(
                          "text-xs",
                          impact.category === 'Red Alert' && "border-red-500/50 text-red-400",
                          impact.category === 'High Fatigue' && "border-amber-500/50 text-amber-400",
                          impact.category === 'Moderate' && "border-yellow-500/50 text-yellow-400"
                        )}
                      >
                        {impact.fatigue}
                      </Badge>
                      {impact.isB2B && (
                        <Badge variant="destructive" className="text-xs">B2B</Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 pt-3 border-t border-border">
        <p className="text-xs text-muted-foreground">
          <Battery className="w-3 h-3 inline mr-1" />
          Fatigue scores affect player props and team performance. Higher scores = more tired.
        </p>
      </div>
    </FeedCard>
  );
}
