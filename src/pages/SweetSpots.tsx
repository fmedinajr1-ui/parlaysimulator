import { useState, useMemo, useCallback } from "react";
import { ArrowLeft, RefreshCw, Crown, Star, TrendingUp, Filter, Radio, Flame, Snowflake, Target, Users, Zap, DollarSign, BarChart3, RotateCcw, CheckCircle2, Dices } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useDeepSweetSpots } from "@/hooks/useDeepSweetSpots";
import { useSweetSpotLiveData } from "@/hooks/useSweetSpotLiveData";
import { useTodayProps } from "@/hooks/useTodayProps";
import { useContrarianParlayBuilder } from "@/hooks/useContrarianParlayBuilder";
import { useSimulatedParlayBuilder, SimulationMode } from "@/hooks/useSimulatedParlayBuilder";
import { SweetSpotCard } from "@/components/sweetspots/SweetSpotCard";
import { TodayPropsSection } from "@/components/sweetspots/TodayPropsSection";
import { HedgeStatusAccuracyCard } from "@/components/sweetspots/HedgeStatusAccuracyCard";
import { ContrarianSection } from "@/components/sweetspots/ContrarianFadeCard";
import { SimulationCard } from "@/components/sweetspots/SimulationCard";
import { MatchupScannerDashboard } from "@/components/matchup-scanner";
import { useParlayBuilder } from "@/contexts/ParlayBuilderContext";
import { getEasternDate } from "@/lib/dateUtils";
import { cn } from "@/lib/utils";
import type { PropType, DeepSweetSpot } from "@/types/sweetSpot";
import { PROP_TYPE_CONFIG } from "@/types/sweetSpot";
import type { PlayerMatchupAnalysis } from "@/types/matchupScanner";

type PropFilter = PropType | 'all';
type QualityFilter = 'all' | 'ELITE' | 'PREMIUM+' | 'STRONG+' | 'MIDDLE' | 'ON_TRACK';
type SortOption = 'score' | 'floor' | 'edge' | 'juice';
type PaceFilter = 'all' | 'live-only' | 'fast' | 'slow';
type MainTab = 'sweet-spots' | 'matchup-scanner' | 'contrarian';

export default function SweetSpots() {
  const navigate = useNavigate();
  const { data, isLoading, error, refetch, isFetching } = useDeepSweetSpots();
  const { addLeg } = useParlayBuilder();
  const todayET = getEasternDate();
  
  // Main tab state
  const [mainTab, setMainTab] = useState<MainTab>('matchup-scanner');
  
  // Fetch today's 3PT and Assist props
  const { picks: threesPicks, isLoading: threesLoading, stats: threesStats } = useTodayProps({ propType: 'threes' });
  const { picks: assistsPicks, isLoading: assistsLoading, stats: assistsStats } = useTodayProps({ propType: 'assists' });
  
  // Contrarian fade picks
  const { 
    allFades, 
    topFades, 
    categoryStats, 
    isLoading: contrarianLoading 
  } = useContrarianParlayBuilder();
  
  const [propFilter, setPropFilter] = useState<PropFilter>('all');
  const [qualityFilter, setQualityFilter] = useState<QualityFilter>('all');
  const [sortBy, setSortBy] = useState<SortOption>('score');
  const [paceFilter, setPaceFilter] = useState<PaceFilter>('all');
  
  // Monte Carlo simulation hook
  const {
    runSimulation,
    cancelSimulation,
    isSimulating,
    progress: simProgress,
    bestParlay,
    viableParlays,
    config: simConfig,
    setMode: setSimMode,
  } = useSimulatedParlayBuilder();
  
  // Enrich spots with live data
  const { spots: enrichedSpots, liveGameCount, spotsWithLineMovement } = useSweetSpotLiveData(data?.spots || []);
  
  // Count middle opportunities
  const middleCount = spotsWithLineMovement.length;
  
  // Count on-track spots
  const onTrackCount = useMemo(() => 
    enrichedSpots.filter(s => 
      s.liveData?.hedgeStatus === 'on_track' || s.liveData?.hedgeStatus === 'profit_lock'
    ).length, 
    [enrichedSpots]
  );
  
  const filteredSpots = useMemo(() => {
    let filtered = [...enrichedSpots];
    
    // Apply prop type filter
    if (propFilter !== 'all') {
      filtered = filtered.filter(s => s.propType === propFilter);
    }
    
    // Apply quality filter
    if (qualityFilter === 'ELITE') {
      filtered = filtered.filter(s => s.qualityTier === 'ELITE');
    } else if (qualityFilter === 'PREMIUM+') {
      filtered = filtered.filter(s => 
        s.qualityTier === 'ELITE' || s.qualityTier === 'PREMIUM'
      );
    } else if (qualityFilter === 'STRONG+') {
      filtered = filtered.filter(s => 
        s.qualityTier === 'ELITE' || s.qualityTier === 'PREMIUM' || s.qualityTier === 'STRONG'
      );
    } else if (qualityFilter === 'MIDDLE') {
      // Filter to only spots with significant line movement (middle opportunities)
      const middleIds = new Set(spotsWithLineMovement.map(s => s.id));
      filtered = filtered.filter(s => middleIds.has(s.id));
    } else if (qualityFilter === 'ON_TRACK') {
      // Filter to only spots with on_track or profit_lock hedge status
      filtered = filtered.filter(s => 
        s.liveData?.hedgeStatus === 'on_track' || s.liveData?.hedgeStatus === 'profit_lock'
      );
    }
    
    // Apply pace filter
    if (paceFilter === 'live-only') {
      filtered = filtered.filter(s => s.liveData?.isLive);
    } else if (paceFilter === 'fast') {
      filtered = filtered.filter(s => 
        !s.liveData?.isLive || (s.liveData.paceRating >= 102)
      );
    } else if (paceFilter === 'slow') {
      filtered = filtered.filter(s => 
        s.liveData?.isLive && s.liveData.paceRating < 98
      );
    }
    
    // Apply sort
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'floor':
          return b.floorProtection - a.floorProtection;
        case 'edge':
          return b.edge - a.edge;
        case 'juice':
          return b.juice.price - a.juice.price;
        case 'score':
        default:
          return b.sweetSpotScore - a.sweetSpotScore;
      }
    });
    
    return filtered;
  }, [enrichedSpots, propFilter, qualityFilter, paceFilter, sortBy, spotsWithLineMovement]);
  
  const handleAddToBuilder = (spot: DeepSweetSpot) => {
    const propConfig = PROP_TYPE_CONFIG[spot.propType];
    const description = `${spot.playerName} ${spot.side.toUpperCase()} ${spot.line} ${propConfig.shortLabel}`;
    addLeg({
      description,
      odds: spot.side === 'over' ? spot.overPrice : spot.underPrice,
      source: 'sweet-spots',
      playerName: spot.playerName,
      propType: propConfig.label,
      line: spot.line,
      side: spot.side,
    });
  };
  
  // Handler for adding matchup analysis to builder
  const handleAddMatchupToBuilder = (analysis: PlayerMatchupAnalysis) => {
    const description = `${analysis.playerName} (${analysis.overallGrade}) vs ${analysis.opponentAbbrev}`;
    addLeg({
      description,
      odds: -110,
      source: 'sweet-spots',
      playerName: analysis.playerName,
      propType: 'Points',
      line: 0,
      side: 'over',
    });
  };
  
  // Count live spots
  const liveSpotCount = useMemo(() => 
    enrichedSpots.filter(s => s.liveData?.isLive).length, 
    [enrichedSpots]
  );
  
  // Convert DeepSweetSpot to SweetSpotPick format for simulation
  const simulationCandidates = useMemo(() => {
    return filteredSpots.slice(0, 20).map(spot => ({
      id: spot.id,
      player_name: spot.playerName,
      prop_type: spot.propType,
      line: spot.line,
      side: spot.side,
      confidence_score: spot.sweetSpotScore / 100,
      edge: spot.edge,
      archetype: null,
      category: spot.qualityTier,
      team_name: spot.teamName,
      event_id: spot.gameDescription, // Use gameDescription as identifier
      projectedValue: spot.l10Stats?.avg || spot.line, // Use L10 avg as projection
      actualLine: spot.line,
    }));
  }, [filteredSpots]);
  
  // Handler for running simulation
  const handleRunSimulation = useCallback((mode: SimulationMode) => {
    setSimMode(mode);
    runSimulation(simulationCandidates, 6);
  }, [simulationCandidates, runSimulation, setSimMode]);
  
  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border">
        <div className="max-w-4xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button 
                variant="ghost" 
                size="icon"
                onClick={() => navigate(-1)}
              >
                <ArrowLeft size={20} />
              </Button>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-lg font-bold text-foreground">Player Analysis</h1>
                  {liveGameCount > 0 && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-400 text-xs font-medium">
                      <Radio size={10} className="animate-pulse" />
                      {liveGameCount} Live
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{todayET}</p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              className="gap-1.5"
            >
              <RefreshCw size={14} className={cn(isFetching && "animate-spin")} />
              Refresh
            </Button>
          </div>
          
          {/* Main Tab Navigation */}
          <div className="mt-3">
            <Tabs value={mainTab} onValueChange={(v) => setMainTab(v as MainTab)}>
              <TabsList className="w-full grid grid-cols-3">
                <TabsTrigger value="matchup-scanner" className="gap-1.5">
                  <Zap size={14} />
                  Scanner
                </TabsTrigger>
                <TabsTrigger value="sweet-spots" className="gap-1.5">
                  <Target size={14} />
                  Sweet Spots
                </TabsTrigger>
                <TabsTrigger value="contrarian" className="gap-1.5">
                  <RotateCcw size={14} />
                  Fades
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>
      </div>
      
      <div className="max-w-4xl mx-auto px-4 py-4 space-y-4">
        {/* Matchup Scanner Tab */}
        {mainTab === 'matchup-scanner' && (
          <MatchupScannerDashboard onAddToBuilder={handleAddMatchupToBuilder} />
        )}
        
        {/* Contrarian Fade Tab */}
        {mainTab === 'contrarian' && (
          <ContrarianSection
            picks={allFades}
            categoryStats={categoryStats}
            isLoading={contrarianLoading}
            onBuildParlay={() => {
              // Add top 3 fades to parlay
              topFades.forEach(pick => {
                const description = `${pick.playerName} ${pick.fadeSide.toUpperCase()} ${pick.line} ${pick.propType}`;
                addLeg({
                  description,
                  odds: -110,
                  source: 'contrarian',
                  playerName: pick.playerName,
                  propType: pick.propType,
                  line: pick.line,
                  side: pick.fadeSide,
                  confidenceScore: pick.confidence,
                  sourceData: {
                    type: 'contrarian-fade',
                    originalCategory: pick.originalCategory,
                    fadeHitRate: pick.fadeHitRate,
                    fadeEdge: pick.fadeEdge
                  }
                });
              });
            }}
          />
        )}
        
        {/* Sweet Spots Tab */}
        {mainTab === 'sweet-spots' && (
          <>
            {/* Today's Props Section */}
            <TodayPropsSection
              threesPicks={threesPicks}
              assistsPicks={assistsPicks}
              threesStats={threesStats}
              assistsStats={assistsStats}
              isLoading={threesLoading || assistsLoading}
              onAddToBuilder={(pick, propType) => {
                const shortLabel = propType === 'threes' ? '3PM' : 'AST';
                addLeg({
                  description: `${pick.player_name} ${pick.recommended_side} ${pick.actual_line ?? pick.recommended_line} ${shortLabel}`,
                  odds: -110,
                  source: 'sweet-spots',
                  playerName: pick.player_name,
                  propType: propType === 'threes' ? 'Player Threes' : 'Player Assists',
                  line: pick.actual_line ?? pick.recommended_line,
                  side: pick.recommended_side.toLowerCase() as 'over' | 'under',
                });
              }}
            />

        {/* Summary Stats */}
        {data?.stats && (
          <div className="grid grid-cols-4 gap-2">
            <Card className="bg-purple-500/10 border-purple-500/30">
              <CardContent className="p-3 text-center">
                <div className="flex items-center justify-center gap-1.5 mb-1">
                  <Crown size={14} className="text-purple-400" />
                  <span className="text-xs text-purple-300">ELITE</span>
                </div>
                <div className="text-2xl font-bold text-purple-400">
                  {data.stats.eliteCount}
                </div>
              </CardContent>
            </Card>
            <Card className="bg-teal-500/10 border-teal-500/30">
              <CardContent className="p-3 text-center">
                <div className="flex items-center justify-center gap-1.5 mb-1">
                  <Star size={14} className="text-teal-400" />
                  <span className="text-xs text-teal-300">PREMIUM</span>
                </div>
                <div className="text-2xl font-bold text-teal-400">
                  {data.stats.premiumCount}
                </div>
              </CardContent>
            </Card>
            <Card className="bg-green-500/10 border-green-500/30">
              <CardContent className="p-3 text-center">
                <div className="flex items-center justify-center gap-1.5 mb-1">
                  <TrendingUp size={14} className="text-green-400" />
                  <span className="text-xs text-green-300">STRONG</span>
                </div>
                <div className="text-2xl font-bold text-green-400">
                  {data.stats.strongCount}
                </div>
              </CardContent>
            </Card>
            <Card className="bg-muted border-border">
              <CardContent className="p-3 text-center">
                <div className="text-xs text-muted-foreground mb-1">Total</div>
                <div className="text-2xl font-bold text-foreground">
                  {data.stats.totalPicks}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
        
        {/* Monte Carlo Simulation Card */}
        {!isLoading && simulationCandidates.length >= 4 && (
          <SimulationCard
            isSimulating={isSimulating}
            progress={simProgress}
            bestParlay={bestParlay}
            viableParlays={viableParlays}
            onRunSimulation={handleRunSimulation}
            onCancel={cancelSimulation}
            currentMode={simConfig.mode}
            candidateCount={simulationCandidates.length}
            legCount={6}
          />
        )}
        
        {/* Prop Type Tabs */}
        <Tabs value={propFilter} onValueChange={(v) => setPropFilter(v as PropFilter)}>
          <TabsList className="w-full grid grid-cols-5">
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="points">Points</TabsTrigger>
            <TabsTrigger value="assists">Assists</TabsTrigger>
            <TabsTrigger value="threes">3PT</TabsTrigger>
            <TabsTrigger value="blocks">Blocks</TabsTrigger>
          </TabsList>
        </Tabs>
        
        {/* Filters Row */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Filter size={14} />
            <span>Quality:</span>
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {(['all', 'ELITE', 'PREMIUM+', 'STRONG+'] as QualityFilter[]).map((filter) => (
              <Button
                key={filter}
                size="sm"
                variant={qualityFilter === filter ? 'default' : 'outline'}
                onClick={() => setQualityFilter(filter)}
                className="text-xs h-7 px-2"
              >
                {filter === 'all' ? 'All' : filter}
              </Button>
            ))}
            {/* Middle opportunity filter - only shows when opportunities exist */}
            {middleCount > 0 && (
              <Button
                size="sm"
                variant={qualityFilter === 'MIDDLE' ? 'default' : 'outline'}
                onClick={() => setQualityFilter('MIDDLE')}
                className={cn(
                  "text-xs h-7 px-2 gap-1",
                  qualityFilter === 'MIDDLE' && "bg-yellow-600 hover:bg-yellow-700 text-white"
                )}
              >
                <DollarSign size={12} />
                MIDDLE ({middleCount})
              </Button>
            )}
            {/* On Track filter - only shows when live games exist */}
            {liveGameCount > 0 && (
              <Button
                size="sm"
                variant={qualityFilter === 'ON_TRACK' ? 'default' : 'outline'}
                onClick={() => setQualityFilter('ON_TRACK')}
                className={cn(
                  "text-xs h-7 px-2 gap-1",
                  qualityFilter === 'ON_TRACK' && "bg-green-600 hover:bg-green-700 text-white"
                )}
              >
                <CheckCircle2 size={12} />
                ON TRACK ({onTrackCount})
              </Button>
            )}
          </div>
          
          <div className="flex-1" />
          
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <span>Sort:</span>
          </div>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortOption)}
            className="h-7 px-2 text-xs bg-background border border-border rounded-md"
          >
            <option value="score">Score</option>
            <option value="floor">Floor</option>
            <option value="edge">Edge</option>
            <option value="juice">Juice</option>
          </select>
        </div>
        
        {/* Pace Filter Row (for live games) */}
        {liveGameCount > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Radio size={14} className="text-green-400" />
              <span>Pace:</span>
            </div>
            <div className="flex gap-1.5">
              {(['all', 'live-only', 'fast', 'slow'] as PaceFilter[]).map((filter) => (
                <Button
                  key={filter}
                  size="sm"
                  variant={paceFilter === filter ? 'default' : 'outline'}
                  onClick={() => setPaceFilter(filter)}
                  className={cn(
                    "text-xs h-7 px-2 gap-1",
                    paceFilter === filter && filter === 'live-only' && "bg-green-600 hover:bg-green-700",
                    paceFilter === filter && filter === 'fast' && "bg-orange-600 hover:bg-orange-700",
                    paceFilter === filter && filter === 'slow' && "bg-blue-600 hover:bg-blue-700"
                  )}
                >
                  {filter === 'all' ? 'All' : 
                   filter === 'live-only' ? (
                     <>
                       <Radio size={10} className="animate-pulse" />
                       Live ({liveSpotCount})
                     </>
                   ) :
                   filter === 'fast' ? (
                     <>
                       <Flame size={10} />
                       Fast
                     </>
                   ) : (
                     <>
                       <Snowflake size={10} />
                       Slow
                     </>
                   )}
                </Button>
              ))}
            </div>
          </div>
        )}
        
        {/* Loading State */}
        {isLoading && (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <Card key={i}>
                <CardContent className="p-4 space-y-3">
                  <Skeleton className="h-6 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                </CardContent>
              </Card>
            ))}
          </div>
        )}
        
        {/* Error State */}
        {error && (
          <Card className="border-destructive">
            <CardContent className="p-4 text-center">
              <p className="text-destructive">Error loading sweet spots</p>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => refetch()}
                className="mt-2"
              >
                Try Again
              </Button>
            </CardContent>
          </Card>
        )}
        
        {/* Empty State */}
        {!isLoading && !error && filteredSpots.length === 0 && (
          <Card>
            <CardContent className="p-8 text-center">
              <p className="text-muted-foreground mb-2">
                No sweet spots found for current filters
              </p>
              <p className="text-xs text-muted-foreground">
                Try adjusting your filters or check back when games are available
              </p>
            </CardContent>
          </Card>
        )}
        
        {/* Sweet Spot Cards */}
        <div className="grid gap-3 md:grid-cols-2">
          {filteredSpots.map((spot) => (
            <SweetSpotCard
              key={spot.id}
              spot={spot}
              onAddToBuilder={handleAddToBuilder}
            />
          ))}
        </div>
        
        {/* Results Count */}
        {!isLoading && filteredSpots.length > 0 && (
          <p className="text-center text-xs text-muted-foreground pt-4">
            Showing {filteredSpots.length} of {data?.stats.totalPicks} sweet spots
            {liveSpotCount > 0 && ` (${liveSpotCount} live)`}
          </p>
        )}
        
        {/* Hedge Status Accuracy Analytics */}
        <div className="pt-4">
          <HedgeStatusAccuracyCard />
        </div>
          </>
        )}
      </div>
    </div>
  );
}
