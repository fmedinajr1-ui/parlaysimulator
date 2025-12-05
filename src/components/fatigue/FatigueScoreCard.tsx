import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FatigueMeter } from './FatigueMeter';
import { FatigueBreakdown } from './FatigueBreakdown';
import { PropImpactTable } from './PropImpactTable';
import { 
  Zap, TrendingUp, TrendingDown, Target,
  ChevronDown, ChevronUp, RefreshCw
} from 'lucide-react';
import { toast } from 'sonner';

interface FatigueData {
  team_name: string;
  opponent: string;
  fatigue_score: number;
  fatigue_category: string;
  is_back_to_back: boolean;
  is_road_back_to_back: boolean;
  travel_miles: number;
  timezone_changes: number;
  is_altitude_game: boolean;
  is_three_in_four: boolean;
  is_four_in_six: boolean;
  is_early_start: boolean;
  ml_adjustment_pct: number;
  spread_adjustment: number;
  points_adjustment_pct: number;
  rebounds_adjustment_pct: number;
  assists_adjustment_pct: number;
  three_pt_adjustment_pct: number;
  blocks_adjustment_pct: number;
  recommended_angle: string;
  betting_edge_summary: string;
  is_home: boolean;
}

interface FatigueScoreCardProps {
  eventId?: string;
  homeTeam?: string;
  awayTeam?: string;
  gameTime?: string;
  compact?: boolean;
}

export const FatigueScoreCard = ({ 
  eventId, 
  homeTeam, 
  awayTeam, 
  gameTime,
  compact = false 
}: FatigueScoreCardProps) => {
  const [homeData, setHomeData] = useState<FatigueData | null>(null);
  const [awayData, setAwayData] = useState<FatigueData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCalculating, setIsCalculating] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<'home' | 'away'>('home');

  useEffect(() => {
    if (eventId) {
      fetchFatigueData();
    }
  }, [eventId]);

  const fetchFatigueData = async () => {
    if (!eventId) return;
    
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('nba_fatigue_scores')
        .select('*')
        .eq('event_id', eventId);
      
      if (error) throw error;
      
      if (data && data.length > 0) {
        const home = data.find(d => d.is_home);
        const away = data.find(d => !d.is_home);
        setHomeData(home || null);
        setAwayData(away || null);
      }
    } catch (error) {
      console.error('Error fetching fatigue data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const calculateFatigue = async () => {
    if (!eventId || !homeTeam || !awayTeam || !gameTime) {
      toast.error('Missing game data for fatigue calculation');
      return;
    }
    
    setIsCalculating(true);
    try {
      const { data, error } = await supabase.functions.invoke('nba-fatigue-engine', {
        body: {
          action: 'calculate',
          eventId,
          homeTeam,
          awayTeam,
          gameTime,
        }
      });
      
      if (error) throw error;
      
      toast.success('Fatigue scores calculated');
      await fetchFatigueData();
    } catch (error) {
      console.error('Error calculating fatigue:', error);
      toast.error('Failed to calculate fatigue scores');
    } finally {
      setIsCalculating(false);
    }
  };

  if (isLoading) {
    return (
      <Card className="bg-card/50 border-border/50">
        <CardContent className="p-4">
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!homeData && !awayData) {
    return (
      <Card className="bg-card/50 border-border/50">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Zap className="w-4 h-4" />
              <span>NBA Fatigue Analysis</span>
            </div>
            <Button 
              size="sm" 
              variant="outline"
              onClick={calculateFatigue}
              disabled={isCalculating}
              className="h-8"
            >
              {isCalculating ? (
                <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
              ) : (
                <Zap className="w-3 h-3 mr-1" />
              )}
              Calculate
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const fatigueDiff = (awayData?.fatigue_score || 0) - (homeData?.fatigue_score || 0);
  const hasFatigueEdge = Math.abs(fatigueDiff) >= 20;
  const favoredTeam = fatigueDiff > 0 ? homeData?.team_name : awayData?.team_name;

  if (compact) {
    return (
      <div className="flex items-center gap-3 p-2 bg-card/30 rounded-lg">
        <Zap className="w-4 h-4 text-yellow-500" />
        <div className="flex-1 flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{homeData?.team_name?.split(' ').pop()}</span>
            <FatigueMeter 
              score={homeData?.fatigue_score || 0} 
              category={homeData?.fatigue_category || 'Fresh'}
              size="sm"
              showLabel={false}
            />
          </div>
          <span className="text-muted-foreground">vs</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{awayData?.team_name?.split(' ').pop()}</span>
            <FatigueMeter 
              score={awayData?.fatigue_score || 0} 
              category={awayData?.fatigue_category || 'Fresh'}
              size="sm"
              showLabel={false}
            />
          </div>
        </div>
        {hasFatigueEdge && (
          <Badge variant="outline" className="text-xs bg-green-500/20 text-green-400 border-green-500/30">
            <Target className="w-3 h-3 mr-1" />
            Edge: {favoredTeam?.split(' ').pop()}
          </Badge>
        )}
      </div>
    );
  }

  return (
    <Card className="bg-card/50 border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Zap className="w-5 h-5 text-yellow-500" />
            NBA Fatigue Analysis
          </CardTitle>
          <Button 
            variant="ghost" 
            size="sm"
            onClick={() => setExpanded(!expanded)}
            className="h-8"
          >
            {expanded ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </Button>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Team Comparison */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-xs">HOME</Badge>
              <span className="font-medium text-sm">{homeData?.team_name}</span>
            </div>
            <FatigueMeter 
              score={homeData?.fatigue_score || 0}
              category={homeData?.fatigue_category || 'Fresh'}
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">AWAY</Badge>
              <span className="font-medium text-sm">{awayData?.team_name}</span>
            </div>
            <FatigueMeter 
              score={awayData?.fatigue_score || 0}
              category={awayData?.fatigue_category || 'Fresh'}
            />
          </div>
        </div>

        {/* Best Betting Edge Box */}
        {hasFatigueEdge && (
          <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
            <div className="flex items-center gap-2 text-green-400 font-medium text-sm mb-1">
              <Target className="w-4 h-4" />
              Best Betting Edge
            </div>
            <p className="text-sm text-foreground">
              {fatigueDiff > 0 ? (
                <>
                  <TrendingUp className="w-3 h-3 inline mr-1 text-green-400" />
                  Lean <strong>{homeData?.team_name}</strong> - {Math.abs(fatigueDiff)}pt fatigue advantage
                </>
              ) : (
                <>
                  <TrendingDown className="w-3 h-3 inline mr-1 text-green-400" />
                  Lean <strong>{awayData?.team_name}</strong> - {Math.abs(fatigueDiff)}pt fatigue advantage
                </>
              )}
            </p>
          </div>
        )}

        {/* Expanded Details */}
        {expanded && (
          <div className="space-y-4 pt-2 border-t border-border/50">
            <Tabs value={selectedTeam} onValueChange={(v) => setSelectedTeam(v as 'home' | 'away')}>
              <TabsList className="w-full">
                <TabsTrigger value="home" className="flex-1">
                  {homeData?.team_name?.split(' ').pop()}
                </TabsTrigger>
                <TabsTrigger value="away" className="flex-1">
                  {awayData?.team_name?.split(' ').pop()}
                </TabsTrigger>
              </TabsList>
              
              <TabsContent value="home" className="space-y-4 mt-4">
                {homeData && (
                  <>
                    <FatigueBreakdown
                      isBackToBack={homeData.is_back_to_back}
                      isRoadBackToBack={homeData.is_road_back_to_back}
                      travelMiles={homeData.travel_miles}
                      timezoneChanges={homeData.timezone_changes}
                      isAltitudeGame={homeData.is_altitude_game}
                      isThreeInFour={homeData.is_three_in_four}
                      isFourInSix={homeData.is_four_in_six}
                      isEarlyStart={homeData.is_early_start}
                    />
                    <PropImpactTable
                      pointsAdjustment={homeData.points_adjustment_pct}
                      reboundsAdjustment={homeData.rebounds_adjustment_pct}
                      assistsAdjustment={homeData.assists_adjustment_pct}
                      threePtAdjustment={homeData.three_pt_adjustment_pct}
                      blocksAdjustment={homeData.blocks_adjustment_pct}
                      teamName={homeData.team_name}
                    />
                    <div className="text-xs text-muted-foreground space-y-1">
                      <div>ML Adjustment: <span className="text-foreground">{homeData.ml_adjustment_pct.toFixed(1)}%</span></div>
                      <div>Spread Adjustment: <span className="text-foreground">{homeData.spread_adjustment > 0 ? '+' : ''}{homeData.spread_adjustment.toFixed(1)}</span></div>
                    </div>
                  </>
                )}
              </TabsContent>
              
              <TabsContent value="away" className="space-y-4 mt-4">
                {awayData && (
                  <>
                    <FatigueBreakdown
                      isBackToBack={awayData.is_back_to_back}
                      isRoadBackToBack={awayData.is_road_back_to_back}
                      travelMiles={awayData.travel_miles}
                      timezoneChanges={awayData.timezone_changes}
                      isAltitudeGame={awayData.is_altitude_game}
                      isThreeInFour={awayData.is_three_in_four}
                      isFourInSix={awayData.is_four_in_six}
                      isEarlyStart={awayData.is_early_start}
                    />
                    <PropImpactTable
                      pointsAdjustment={awayData.points_adjustment_pct}
                      reboundsAdjustment={awayData.rebounds_adjustment_pct}
                      assistsAdjustment={awayData.assists_adjustment_pct}
                      threePtAdjustment={awayData.three_pt_adjustment_pct}
                      blocksAdjustment={awayData.blocks_adjustment_pct}
                      teamName={awayData.team_name}
                    />
                    <div className="text-xs text-muted-foreground space-y-1">
                      <div>ML Adjustment: <span className="text-foreground">{awayData.ml_adjustment_pct.toFixed(1)}%</span></div>
                      <div>Spread Adjustment: <span className="text-foreground">{awayData.spread_adjustment > 0 ? '+' : ''}{awayData.spread_adjustment.toFixed(1)}</span></div>
                    </div>
                  </>
                )}
              </TabsContent>
            </Tabs>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
