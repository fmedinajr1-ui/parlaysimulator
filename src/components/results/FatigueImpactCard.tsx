import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { Battery, BatteryLow, BatteryWarning, TrendingUp, TrendingDown, Minus, Plane, Clock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ParlayLeg, LegAnalysis } from "@/types/parlay";

interface FatigueScore {
  team_name: string;
  fatigue_score: number;
  fatigue_category: string;
  is_back_to_back: boolean;
  is_road_back_to_back: boolean;
  is_three_in_four: boolean;
  travel_miles: number;
  spread_adjustment: number;
  points_adjustment_pct: number;
  betting_edge_summary: string | null;
  recommended_angle: string | null;
}

interface FatigueImpactCardProps {
  legs: ParlayLeg[];
  legAnalyses?: Array<LegAnalysis & { legIndex: number }>;
  delay?: number;
}

// NBA team name variations for matching
const teamNameMap: Record<string, string[]> = {
  "Lakers": ["Los Angeles Lakers", "LA Lakers", "LAL"],
  "Celtics": ["Boston Celtics", "BOS"],
  "Warriors": ["Golden State Warriors", "GSW"],
  "Bucks": ["Milwaukee Bucks", "MIL"],
  "76ers": ["Philadelphia 76ers", "Sixers", "PHI"],
  "Heat": ["Miami Heat", "MIA"],
  "Suns": ["Phoenix Suns", "PHX"],
  "Nuggets": ["Denver Nuggets", "DEN"],
  "Mavericks": ["Dallas Mavericks", "Mavs", "DAL"],
  "Clippers": ["Los Angeles Clippers", "LA Clippers", "LAC"],
  "Nets": ["Brooklyn Nets", "BKN"],
  "Knicks": ["New York Knicks", "NYK"],
  "Bulls": ["Chicago Bulls", "CHI"],
  "Raptors": ["Toronto Raptors", "TOR"],
  "Hawks": ["Atlanta Hawks", "ATL"],
  "Cavaliers": ["Cleveland Cavaliers", "Cavs", "CLE"],
  "Pacers": ["Indiana Pacers", "IND"],
  "Pistons": ["Detroit Pistons", "DET"],
  "Magic": ["Orlando Magic", "ORL"],
  "Hornets": ["Charlotte Hornets", "CHA"],
  "Wizards": ["Washington Wizards", "WAS"],
  "Timberwolves": ["Minnesota Timberwolves", "Wolves", "MIN"],
  "Thunder": ["Oklahoma City Thunder", "OKC"],
  "Trail Blazers": ["Portland Trail Blazers", "Blazers", "POR"],
  "Jazz": ["Utah Jazz", "UTA"],
  "Kings": ["Sacramento Kings", "SAC"],
  "Spurs": ["San Antonio Spurs", "SAS"],
  "Rockets": ["Houston Rockets", "HOU"],
  "Grizzlies": ["Memphis Grizzlies", "MEM"],
  "Pelicans": ["New Orleans Pelicans", "NOP"],
};

export function FatigueImpactCard({ legs, legAnalyses, delay = 0 }: FatigueImpactCardProps) {
  const [fatigueData, setFatigueData] = useState<FatigueScore[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [legFatigueMap, setLegFatigueMap] = useState<Map<number, FatigueScore | null>>(new Map());

  useEffect(() => {
    const fetchFatigueData = async () => {
      setIsLoading(true);
      try {
        const today = new Date().toISOString().split('T')[0];
        const { data, error } = await supabase
          .from('nba_fatigue_scores')
          .select('*')
          .gte('game_date', today)
          .order('fatigue_score', { ascending: false });

        if (error) throw error;
        setFatigueData(data || []);

        // Map fatigue data to legs
        const fatigueMap = new Map<number, FatigueScore | null>();
        legs.forEach((leg, idx) => {
          const match = findFatigueMatch(leg.description, data || []);
          fatigueMap.set(idx, match);
        });
        setLegFatigueMap(fatigueMap);
      } catch (err) {
        console.error('Error fetching fatigue data:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchFatigueData();
  }, [legs]);

  const findFatigueMatch = (description: string, fatigueScores: FatigueScore[]): FatigueScore | null => {
    const descLower = description.toLowerCase();
    
    for (const score of fatigueScores) {
      const teamLower = score.team_name.toLowerCase();
      if (descLower.includes(teamLower)) {
        return score;
      }
      
      // Check team name variations
      for (const [shortName, variations] of Object.entries(teamNameMap)) {
        if (variations.some(v => v.toLowerCase() === teamLower)) {
          if (descLower.includes(shortName.toLowerCase()) || 
              variations.some(v => descLower.includes(v.toLowerCase()))) {
            return score;
          }
        }
      }
    }
    return null;
  };

  const getFatigueIcon = (category: string) => {
    switch (category) {
      case 'Exhausted':
      case 'Heavy':
        return <BatteryLow className="w-4 h-4 text-destructive" />;
      case 'Moderate':
        return <BatteryWarning className="w-4 h-4 text-neon-orange" />;
      default:
        return <Battery className="w-4 h-4 text-neon-green" />;
    }
  };

  const getFatigueBadgeColor = (category: string) => {
    switch (category) {
      case 'Exhausted':
        return 'bg-destructive/20 text-destructive border-destructive/30';
      case 'Heavy':
        return 'bg-neon-red/20 text-neon-red border-neon-red/30';
      case 'Moderate':
        return 'bg-neon-orange/20 text-neon-orange border-neon-orange/30';
      case 'Light':
        return 'bg-neon-yellow/20 text-neon-yellow border-neon-yellow/30';
      default:
        return 'bg-neon-green/20 text-neon-green border-neon-green/30';
    }
  };

  const getImpactIcon = (adjustment: number) => {
    if (adjustment > 1) return <TrendingDown className="w-3 h-3 text-destructive" />;
    if (adjustment < -1) return <TrendingUp className="w-3 h-3 text-neon-green" />;
    return <Minus className="w-3 h-3 text-muted-foreground" />;
  };

  // Get legs with fatigue matches
  const legsWithFatigue = legs
    .map((leg, idx) => ({ leg, idx, fatigue: legFatigueMap.get(idx) }))
    .filter(item => item.fatigue !== null);

  if (isLoading) {
    return (
      <Card className="p-4 bg-card/50 border-border/50 slide-up" style={{ animationDelay: `${delay}ms` }}>
        <div className="flex items-center gap-2 mb-3">
          <Battery className="w-4 h-4 text-neon-purple" />
          <span className="text-xs font-semibold text-neon-purple uppercase">Fatigue Impact</span>
        </div>
        <div className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      </Card>
    );
  }

  if (legsWithFatigue.length === 0) {
    return null; // Don't show if no NBA legs found
  }

  return (
    <Card 
      className="p-4 bg-card/50 border-border/50 slide-up" 
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Battery className="w-4 h-4 text-neon-purple" />
          <span className="text-xs font-semibold text-neon-purple uppercase">NBA Fatigue Impact</span>
        </div>
        <Badge variant="outline" className="text-[10px] bg-neon-purple/10 border-neon-purple/30 text-neon-purple">
          {legsWithFatigue.length} legs
        </Badge>
      </div>

      <div className="space-y-3">
        {legsWithFatigue.map(({ leg, idx, fatigue }) => (
          <div 
            key={idx}
            className="bg-background/50 rounded-lg p-3 border border-border/30"
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <p className="text-xs text-foreground font-medium line-clamp-2 flex-1">
                {leg.description}
              </p>
              <Badge 
                variant="outline" 
                className={`text-[10px] shrink-0 ${getFatigueBadgeColor(fatigue!.fatigue_category)}`}
              >
                {getFatigueIcon(fatigue!.fatigue_category)}
                <span className="ml-1">{fatigue!.fatigue_category}</span>
              </Badge>
            </div>

            <div className="flex items-center gap-2 text-[10px] text-muted-foreground mb-2">
              <span className="font-medium text-foreground">{fatigue!.team_name}</span>
              <span>•</span>
              <span>Score: {fatigue!.fatigue_score}</span>
            </div>

            {/* Fatigue Factors */}
            <div className="flex flex-wrap gap-1.5 mb-2">
              {fatigue!.is_back_to_back && (
                <Badge variant="outline" className="text-[9px] bg-neon-orange/10 border-neon-orange/30 text-neon-orange">
                  <Clock className="w-2.5 h-2.5 mr-0.5" />
                  B2B
                </Badge>
              )}
              {fatigue!.is_road_back_to_back && (
                <Badge variant="outline" className="text-[9px] bg-destructive/10 border-destructive/30 text-destructive">
                  <Plane className="w-2.5 h-2.5 mr-0.5" />
                  Road B2B
                </Badge>
              )}
              {fatigue!.is_three_in_four && (
                <Badge variant="outline" className="text-[9px] bg-neon-yellow/10 border-neon-yellow/30 text-neon-yellow">
                  3-in-4
                </Badge>
              )}
              {fatigue!.travel_miles > 1000 && (
                <Badge variant="outline" className="text-[9px] bg-muted/50 border-border text-muted-foreground">
                  <Plane className="w-2.5 h-2.5 mr-0.5" />
                  {Math.round(fatigue!.travel_miles)} mi
                </Badge>
              )}
            </div>

            {/* Betting Impact */}
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <div className="flex items-center gap-1">
                {getImpactIcon(fatigue!.spread_adjustment)}
                <span className="text-muted-foreground">Spread:</span>
                <span className={fatigue!.spread_adjustment > 0 ? 'text-destructive' : fatigue!.spread_adjustment < 0 ? 'text-neon-green' : 'text-muted-foreground'}>
                  {fatigue!.spread_adjustment > 0 ? '+' : ''}{fatigue!.spread_adjustment.toFixed(1)} pts
                </span>
              </div>
              <div className="flex items-center gap-1">
                {getImpactIcon(-fatigue!.points_adjustment_pct)}
                <span className="text-muted-foreground">Points:</span>
                <span className={fatigue!.points_adjustment_pct < 0 ? 'text-destructive' : fatigue!.points_adjustment_pct > 0 ? 'text-neon-green' : 'text-muted-foreground'}>
                  {fatigue!.points_adjustment_pct > 0 ? '+' : ''}{fatigue!.points_adjustment_pct.toFixed(1)}%
                </span>
              </div>
            </div>

            {/* Edge Summary */}
            {fatigue!.betting_edge_summary && (
              <p className="text-[10px] text-muted-foreground mt-2 italic border-t border-border/30 pt-2">
                💡 {fatigue!.betting_edge_summary}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Overall Summary */}
      {legsWithFatigue.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border/30">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-muted-foreground">Fatigue-affected legs:</span>
            <span className="font-medium text-foreground">{legsWithFatigue.length} of {legs.length}</span>
          </div>
          {legsWithFatigue.some(l => l.fatigue?.fatigue_category === 'Exhausted' || l.fatigue?.fatigue_category === 'Heavy') && (
            <p className="text-[10px] text-neon-orange mt-1">
              ⚠️ Some legs involve fatigued teams - consider adjusting expectations
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
