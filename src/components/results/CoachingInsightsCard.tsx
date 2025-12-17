import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, TrendingUp, TrendingDown, Clock, Activity, ChevronDown, ChevronUp, Target, Percent } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { motion, AnimatePresence } from "framer-motion";
import { ParlayLeg, LegAnalysis } from "@/types/parlay";
import { cn } from "@/lib/utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface CoachTendencySignal {
  teamName: string;
  coachName: string;
  tenureMonths: number;
  overallScore: number;
  recommendation: 'PICK' | 'FADE' | 'NEUTRAL';
  confidence: number;
  reasoning: string;
  tendencies: {
    paceScore: number;
    rotationScore: number;
    starUsageScore: number;
    b2bRestScore: number;
  };
  propAdjustments: {
    points: number;
    rebounds: number;
    assists: number;
    minutes: number;
  };
  accuracy?: {
    winRate: number;
    totalPredictions: number;
    sampleConfidence: 'high' | 'medium' | 'low';
  };
}

interface CoachingInsightsCardProps {
  legs: ParlayLeg[];
  legAnalyses?: LegAnalysis[];
  delay?: number;
}

interface AccuracyMetric {
  coach_id: string;
  coach_name: string;
  win_rate: number;
  total_predictions: number;
}

export const CoachingInsightsCard = ({ legs, legAnalyses, delay = 0 }: CoachingInsightsCardProps) => {
  const [coachingData, setCoachingData] = useState<CoachTendencySignal[]>([]);
  const [accuracyData, setAccuracyData] = useState<Map<string, AccuracyMetric>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);

  // Extract team names from legs
  const extractTeamNames = (): string[] => {
    const teams = new Set<string>();
    
    legs.forEach((leg, idx) => {
      const analysis = legAnalyses?.[idx];
      if (analysis?.team) {
        teams.add(analysis.team);
      }
      
      // Also try to extract from description
      const desc = leg.description.toLowerCase();
      const nbaTeams = [
        'hawks', 'celtics', 'nets', 'hornets', 'bulls', 'cavaliers', 'mavericks',
        'nuggets', 'pistons', 'warriors', 'rockets', 'pacers', 'clippers', 'lakers',
        'grizzlies', 'heat', 'bucks', 'timberwolves', 'pelicans', 'knicks', 'thunder',
        'magic', '76ers', 'sixers', 'suns', 'trail blazers', 'blazers', 'kings',
        'spurs', 'raptors', 'jazz', 'wizards'
      ];
      
      nbaTeams.forEach(team => {
        if (desc.includes(team)) {
          // Map to full team names
          const teamMap: Record<string, string> = {
            'hawks': 'Atlanta Hawks',
            'celtics': 'Boston Celtics',
            'nets': 'Brooklyn Nets',
            'hornets': 'Charlotte Hornets',
            'bulls': 'Chicago Bulls',
            'cavaliers': 'Cleveland Cavaliers',
            'mavericks': 'Dallas Mavericks',
            'nuggets': 'Denver Nuggets',
            'pistons': 'Detroit Pistons',
            'warriors': 'Golden State Warriors',
            'rockets': 'Houston Rockets',
            'pacers': 'Indiana Pacers',
            'clippers': 'LA Clippers',
            'lakers': 'Los Angeles Lakers',
            'grizzlies': 'Memphis Grizzlies',
            'heat': 'Miami Heat',
            'bucks': 'Milwaukee Bucks',
            'timberwolves': 'Minnesota Timberwolves',
            'pelicans': 'New Orleans Pelicans',
            'knicks': 'New York Knicks',
            'thunder': 'Oklahoma City Thunder',
            'magic': 'Orlando Magic',
            '76ers': 'Philadelphia 76ers',
            'sixers': 'Philadelphia 76ers',
            'suns': 'Phoenix Suns',
            'trail blazers': 'Portland Trail Blazers',
            'blazers': 'Portland Trail Blazers',
            'kings': 'Sacramento Kings',
            'spurs': 'San Antonio Spurs',
            'raptors': 'Toronto Raptors',
            'jazz': 'Utah Jazz',
            'wizards': 'Washington Wizards'
          };
          if (teamMap[team]) {
            teams.add(teamMap[team]);
          }
        }
      });
    });
    
    return Array.from(teams);
  };

  useEffect(() => {
    const fetchCoachingData = async () => {
      const teams = extractTeamNames();
      if (teams.length === 0) {
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      const results: CoachTendencySignal[] = [];

      // Fetch accuracy metrics first
      const { data: metricsData } = await supabase
        .from('coaching_accuracy_metrics')
        .select('coach_id, coach_name, win_rate, total_predictions')
        .gt('total_predictions', 0);

      const metricsMap = new Map<string, AccuracyMetric>();
      metricsData?.forEach((m: AccuracyMetric) => {
        metricsMap.set(m.coach_name.toLowerCase(), m);
      });
      setAccuracyData(metricsMap);

      // Fetch coaching data for each team (in parallel)
      const promises = teams.map(async (team) => {
        try {
          const { data, error } = await supabase.functions.invoke('coach-tendencies-engine', {
            body: {
              action: 'analyze',
              teamName: team,
              situation: 'normal'
            }
          });

          if (!error && data?.data) {
            const coachData = data.data as CoachTendencySignal;
            
            // Add accuracy info if available
            const accuracyInfo = metricsMap.get(coachData.coachName?.toLowerCase());
            if (accuracyInfo && accuracyInfo.total_predictions > 0) {
              coachData.accuracy = {
                winRate: accuracyInfo.win_rate,
                totalPredictions: accuracyInfo.total_predictions,
                sampleConfidence: accuracyInfo.total_predictions >= 30 ? 'high' : 
                                   accuracyInfo.total_predictions >= 15 ? 'medium' : 'low'
              };
            }
            
            return coachData;
          }
        } catch (err) {
          console.error(`Error fetching coaching data for ${team}:`, err);
        }
        return null;
      });

      const responses = await Promise.all(promises);
      responses.forEach(r => {
        if (r) results.push(r);
      });

      setCoachingData(results);
      setIsLoading(false);
    };

    fetchCoachingData();
  }, [legs, legAnalyses]);

  const getRecommendationColor = (rec: string) => {
    switch (rec) {
      case 'PICK': return 'bg-green-500/20 text-green-400 border-green-500/30';
      case 'FADE': return 'bg-red-500/20 text-red-400 border-red-500/30';
      default: return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 70) return 'text-green-400';
    if (score >= 40) return 'text-yellow-400';
    return 'text-red-400';
  };

  const formatAdjustment = (value: number) => {
    if (value === 0) return null;
    const sign = value > 0 ? '+' : '';
    return `${sign}${value}%`;
  };

  if (isLoading) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: delay / 1000 }}
      >
        <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" />
              Coaching Tendencies
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  if (coachingData.length === 0) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: delay / 1000 }}
    >
      <Card className="border-border/50 bg-card/80 backdrop-blur-sm overflow-hidden">
        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          <CollapsibleTrigger asChild>
            <CardHeader className="pb-2 cursor-pointer hover:bg-muted/50 transition-colors">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Users className="w-4 h-4 text-primary" />
                  Coaching Tendencies
                  <Badge variant="outline" className="text-xs ml-2">
                    {coachingData.length} coach{coachingData.length !== 1 ? 'es' : ''}
                  </Badge>
                </CardTitle>
                {isOpen ? (
                  <ChevronUp className="w-4 h-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-muted-foreground" />
                )}
              </div>
              
              {/* Preview when collapsed */}
              {!isOpen && coachingData.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {coachingData.map((coach, idx) => (
                    <Badge
                      key={idx}
                      className={cn("text-xs", getRecommendationColor(coach.recommendation))}
                    >
                      {coach.coachName}: {coach.recommendation}
                    </Badge>
                  ))}
                </div>
              )}
            </CardHeader>
          </CollapsibleTrigger>

          <CollapsibleContent>
            <CardContent className="space-y-4 pt-0">
              <AnimatePresence>
                {coachingData.map((coach, idx) => (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.1 }}
                    className="p-3 rounded-lg bg-muted/30 border border-border/30"
                  >
                    {/* Coach Header */}
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-foreground">{coach.coachName}</span>
                          <Badge
                            className={cn("text-xs", getRecommendationColor(coach.recommendation))}
                          >
                            {coach.recommendation}
                          </Badge>
                          {coach.accuracy && (
                            <Badge 
                              variant="outline" 
                              className={cn(
                                "text-xs gap-1",
                                coach.accuracy.winRate >= 55 
                                  ? "border-chart-2/50 text-chart-2" 
                                  : coach.accuracy.winRate >= 50 
                                    ? "border-chart-4/50 text-chart-4"
                                    : "border-muted text-muted-foreground"
                              )}
                            >
                              <Target className="w-3 h-3" />
                              {coach.accuracy.winRate.toFixed(1)}%
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {coach.teamName} • {Math.floor(coach.tenureMonths / 12)}y {coach.tenureMonths % 12}m tenure
                          {coach.accuracy && (
                            <span className="ml-1 text-muted-foreground/70">
                              • {coach.accuracy.totalPredictions} predictions ({coach.accuracy.sampleConfidence} conf)
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="text-right">
                        <span className={cn("text-lg font-bold", getScoreColor(coach.confidence))}>
                          {coach.confidence}%
                        </span>
                        <p className="text-xs text-muted-foreground">confidence</p>
                      </div>
                    </div>

                    {/* Tendency Scores */}
                    <div className="grid grid-cols-4 gap-2 mb-3">
                      <div className="text-center p-2 rounded bg-background/50">
                        <Activity className="w-3 h-3 mx-auto mb-1 text-muted-foreground" />
                        <span className={cn("text-sm font-medium", getScoreColor(coach.tendencies.paceScore))}>
                          {coach.tendencies.paceScore}
                        </span>
                        <p className="text-[10px] text-muted-foreground">Pace</p>
                      </div>
                      <div className="text-center p-2 rounded bg-background/50">
                        <Users className="w-3 h-3 mx-auto mb-1 text-muted-foreground" />
                        <span className={cn("text-sm font-medium", getScoreColor(coach.tendencies.rotationScore))}>
                          {coach.tendencies.rotationScore}
                        </span>
                        <p className="text-[10px] text-muted-foreground">Rotation</p>
                      </div>
                      <div className="text-center p-2 rounded bg-background/50">
                        <TrendingUp className="w-3 h-3 mx-auto mb-1 text-muted-foreground" />
                        <span className={cn("text-sm font-medium", getScoreColor(coach.tendencies.starUsageScore))}>
                          {coach.tendencies.starUsageScore}
                        </span>
                        <p className="text-[10px] text-muted-foreground">Star Usage</p>
                      </div>
                      <div className="text-center p-2 rounded bg-background/50">
                        <Clock className="w-3 h-3 mx-auto mb-1 text-muted-foreground" />
                        <span className={cn("text-sm font-medium", getScoreColor(coach.tendencies.b2bRestScore))}>
                          {coach.tendencies.b2bRestScore}
                        </span>
                        <p className="text-[10px] text-muted-foreground">B2B Rest</p>
                      </div>
                    </div>

                    {/* Prop Adjustments */}
                    {(coach.propAdjustments.points !== 0 || 
                      coach.propAdjustments.rebounds !== 0 || 
                      coach.propAdjustments.assists !== 0 || 
                      coach.propAdjustments.minutes !== 0) && (
                      <div className="flex flex-wrap gap-2 mb-3">
                        {Object.entries(coach.propAdjustments).map(([key, value]) => {
                          const adj = formatAdjustment(value);
                          if (!adj) return null;
                          const isPositive = value > 0;
                          return (
                            <Badge
                              key={key}
                              variant="outline"
                              className={cn(
                                "text-xs",
                                isPositive ? "border-green-500/30 text-green-400" : "border-red-500/30 text-red-400"
                              )}
                            >
                              {isPositive ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
                              {key}: {adj}
                            </Badge>
                          );
                        })}
                      </div>
                    )}

                    {/* Reasoning */}
                    <p className="text-xs text-muted-foreground italic">
                      "{coach.reasoning}"
                    </p>
                  </motion.div>
                ))}
              </AnimatePresence>
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>
    </motion.div>
  );
};
