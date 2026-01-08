import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { FeedCard, FeedCardHeader } from "@/components/FeedCard";
import { PropRow } from "./PropRow";
import { calculateHeatLevel, HeatLevel } from "./HeatBadge";
import { Brain, ChevronRight, Flame } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface PropMarketItem {
  id: string;
  playerName: string;
  propType: string;
  line: number;
  side: 'over' | 'under';
  engineScore: number;
  marketScore: number;
  heatScore: number;
  heatLevel: HeatLevel;
  playerRole: string;
  gameScript: string;
  hoursToTip: number;
}

export function PropMarketWidget() {
  // Fetch risk engine picks - get most recent high-confidence picks
  const { data: picks, isLoading: picksLoading } = useQuery({
    queryKey: ['risk-engine-picks-widget'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('nba_risk_engine_picks')
        .select('id, player_name, prop_type, line, side, confidence_score, player_role, game_script, game_date')
        .gte('confidence_score', 7.5)
        .order('game_date', { ascending: false })
        .order('confidence_score', { ascending: false })
        .limit(10);
      
      if (error) throw error;
      return data;
    },
    staleTime: 2 * 60 * 1000, // 2 minutes
  });

  // Fetch market signals
  const { data: signals, isLoading: signalsLoading } = useQuery({
    queryKey: ['market-signals-widget'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('market_signals')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      
      if (error) throw error;
      return data;
    },
    staleTime: 2 * 60 * 1000,
  });

  const isLoading = picksLoading || signalsLoading;

  // Combine and calculate heat scores
  const combinedData: PropMarketItem[] = picks?.map(pick => {
    // Find matching market signal
    const signal = signals?.find(s => 
      s.player_name?.toLowerCase() === pick.player_name?.toLowerCase() ||
      s.outcome_name?.toLowerCase().includes(pick.player_name?.toLowerCase())
    );
    
    const marketScore = signal?.market_score ?? 50;
    const { heat, level } = calculateHeatLevel(pick.confidence_score ?? 7.5, marketScore);
    
    // Calculate hours to tip (mock for now - would use game time)
    const hoursToTip = Math.random() * 12 + 1; // 1-13 hours
    
    return {
      id: pick.id,
      playerName: pick.player_name,
      propType: pick.prop_type,
      line: pick.line,
      side: pick.side?.toLowerCase() as 'over' | 'under',
      engineScore: pick.confidence_score ?? 7.5,
      marketScore,
      heatScore: heat,
      heatLevel: level,
      playerRole: pick.player_role ?? 'STAR',
      gameScript: pick.game_script ?? 'Competitive',
      hoursToTip,
    };
  }).sort((a, b) => b.heatScore - a.heatScore).slice(0, 3) ?? [];

  // Count by heat level
  const sharpRisingCount = combinedData.filter(p => p.heatLevel === 'RED' || p.heatLevel === 'ORANGE').length;

  if (isLoading) {
    return (
      <FeedCard variant="glass">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-8 w-20" />
          </div>
          <Skeleton className="h-4 w-64" />
          <div className="space-y-2 pt-2">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        </div>
      </FeedCard>
    );
  }

  if (!combinedData.length) {
    return (
      <FeedCard variant="glass">
        <FeedCardHeader 
          title="Prop Market Engine"
          subtitle="We bet later, sharper, and less often"
          icon={<Brain className="w-5 h-5" />}
        />
        <div className="text-center py-6">
          <Brain className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-50" />
          <p className="text-sm text-muted-foreground">No sharp pressure detected</p>
          <p className="text-xs text-muted-foreground mt-1">Markets are quiet — check back later</p>
        </div>
      </FeedCard>
    );
  }

  return (
    <FeedCard variant="glass">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Brain className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Prop Market Engine</h3>
          </div>
        </div>
        <Link to="/prop-market">
          <Button variant="ghost" size="sm" className="gap-1 text-xs">
            View All
            <ChevronRight className="w-3 h-3" />
          </Button>
        </Link>
      </div>
      
      <p className="text-xs text-muted-foreground mb-4 italic">
        "We bet later, sharper, and less often"
      </p>

      {/* Sharp Rising Header */}
      <div className="flex items-center gap-2 mb-3">
        <Flame className="w-4 h-4 text-orange-400" />
        <span className="text-sm font-medium text-foreground">Sharp Rising</span>
        <span className="text-xs text-muted-foreground">({sharpRisingCount})</span>
      </div>

      {/* Prop Rows */}
      <div className="space-y-2">
        {combinedData.map((prop) => (
          <PropRow
            key={prop.id}
            playerName={prop.playerName}
            propType={prop.propType}
            line={prop.line}
            side={prop.side}
            engineScore={prop.engineScore}
            marketScore={prop.marketScore}
            heatScore={prop.heatScore}
            heatLevel={prop.heatLevel}
            playerRole={prop.playerRole}
            gameScript={prop.gameScript}
            hoursToTip={prop.hoursToTip}
          />
        ))}
      </div>
    </FeedCard>
  );
}
