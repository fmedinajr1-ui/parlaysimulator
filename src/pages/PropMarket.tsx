import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PropRow } from "@/components/market/PropRow";
import { calculateHeatLevel, HeatLevel } from "@/components/market/HeatBadge";
import { Brain, Flame, Filter, ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";

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
  gameDate: string;
}

type HeatFilter = 'all' | 'RED' | 'ORANGE' | 'YELLOW' | 'GREEN';

export default function PropMarket() {
  const [heatFilter, setHeatFilter] = useState<HeatFilter>('all');

  // Fetch risk engine picks
  const { data: picks, isLoading: picksLoading } = useQuery({
    queryKey: ['risk-engine-picks-full'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('nba_risk_engine_picks')
        .select('id, player_name, prop_type, line, side, confidence_score, player_role, game_script, game_date')
        .gte('confidence_score', 7.5)
        .order('game_date', { ascending: false })
        .order('confidence_score', { ascending: false })
        .limit(50);
      
      if (error) throw error;
      return data;
    },
    staleTime: 2 * 60 * 1000,
  });

  // Fetch market signals
  const { data: signals, isLoading: signalsLoading } = useQuery({
    queryKey: ['market-signals-full'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('market_signals')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      
      if (error) throw error;
      return data;
    },
    staleTime: 2 * 60 * 1000,
  });

  const isLoading = picksLoading || signalsLoading;

  // Combine and calculate heat scores
  const combinedData: PropMarketItem[] = picks?.map(pick => {
    const signal = signals?.find(s => 
      s.player_name?.toLowerCase() === pick.player_name?.toLowerCase() ||
      s.outcome_name?.toLowerCase().includes(pick.player_name?.toLowerCase())
    );
    
    const marketScore = signal?.market_score ?? null;
    const { heat, level } = calculateHeatLevel(pick.confidence_score ?? 7.5, marketScore);
    
    const hoursToTip = Math.random() * 12 + 1;
    
    return {
      id: pick.id,
      playerName: pick.player_name,
      propType: pick.prop_type,
      line: pick.line,
      side: pick.side?.toLowerCase() as 'over' | 'under',
      engineScore: pick.confidence_score ?? 7.5,
      marketScore: marketScore ?? 50,
      heatScore: heat,
      heatLevel: level,
      playerRole: pick.player_role ?? 'STAR',
      gameScript: pick.game_script ?? 'Competitive',
      hoursToTip,
      gameDate: pick.game_date,
    };
  }).sort((a, b) => b.heatScore - a.heatScore) ?? [];

  // Filter by heat level
  const filteredData = heatFilter === 'all' 
    ? combinedData 
    : combinedData.filter(p => p.heatLevel === heatFilter);

  // Count by heat level
  const heatCounts = {
    RED: combinedData.filter(p => p.heatLevel === 'RED').length,
    ORANGE: combinedData.filter(p => p.heatLevel === 'ORANGE').length,
    YELLOW: combinedData.filter(p => p.heatLevel === 'YELLOW').length,
    GREEN: combinedData.filter(p => p.heatLevel === 'GREEN').length,
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-2xl mx-auto px-4 py-6 pb-24">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Link to="/">
            <Button variant="ghost" size="icon" className="shrink-0">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Brain className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Prop Market Engine</h1>
              <p className="text-sm text-muted-foreground italic">
                "We bet later, sharper, and less often"
              </p>
            </div>
          </div>
        </div>

        {/* Heat Filter */}
        <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-2">
          <Filter className="w-4 h-4 text-muted-foreground shrink-0" />
          <Badge 
            variant={heatFilter === 'all' ? 'default' : 'outline'}
            className="cursor-pointer"
            onClick={() => setHeatFilter('all')}
          >
            All ({combinedData.length})
          </Badge>
          <Badge 
            variant={heatFilter === 'RED' ? 'default' : 'outline'}
            className="cursor-pointer bg-red-500/20 text-red-400 border-red-500/30 hover:bg-red-500/30"
            onClick={() => setHeatFilter('RED')}
          >
            🟥 Sharp ({heatCounts.RED})
          </Badge>
          <Badge 
            variant={heatFilter === 'ORANGE' ? 'default' : 'outline'}
            className="cursor-pointer bg-orange-500/20 text-orange-400 border-orange-500/30 hover:bg-orange-500/30"
            onClick={() => setHeatFilter('ORANGE')}
          >
            🟧 Rising ({heatCounts.ORANGE})
          </Badge>
          <Badge 
            variant={heatFilter === 'YELLOW' ? 'default' : 'outline'}
            className="cursor-pointer bg-yellow-500/20 text-yellow-400 border-yellow-500/30 hover:bg-yellow-500/30"
            onClick={() => setHeatFilter('YELLOW')}
          >
            🟨 Warm ({heatCounts.YELLOW})
          </Badge>
          <Badge 
            variant={heatFilter === 'GREEN' ? 'default' : 'outline'}
            className="cursor-pointer bg-green-500/20 text-green-400 border-green-500/30 hover:bg-green-500/30"
            onClick={() => setHeatFilter('GREEN')}
          >
            🟩 Cool ({heatCounts.GREEN})
          </Badge>
        </div>

        {/* Sharp Rising Section */}
        {(heatFilter === 'all' || heatFilter === 'RED' || heatFilter === 'ORANGE') && 
         (heatCounts.RED > 0 || heatCounts.ORANGE > 0) && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <Flame className="w-4 h-4 text-orange-400" />
              <span className="text-sm font-medium text-foreground">Sharp Rising</span>
              <span className="text-xs text-muted-foreground">
                ({heatCounts.RED + heatCounts.ORANGE})
              </span>
            </div>
            <div className="space-y-2">
              {filteredData
                .filter(p => p.heatLevel === 'RED' || p.heatLevel === 'ORANGE')
                .map((prop) => (
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
          </div>
        )}

        {/* All Props Section */}
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : !filteredData.length ? (
          <div className="text-center py-12">
            <Brain className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-50" />
            <p className="text-muted-foreground">No props match this filter</p>
            <Button 
              variant="outline" 
              size="sm" 
              className="mt-4"
              onClick={() => setHeatFilter('all')}
            >
              Show All Props
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {heatFilter !== 'all' && heatFilter !== 'RED' && heatFilter !== 'ORANGE' ? (
              filteredData.map((prop) => (
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
              ))
            ) : (
              filteredData
                .filter(p => p.heatLevel !== 'RED' && p.heatLevel !== 'ORANGE')
                .map((prop) => (
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
                ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
