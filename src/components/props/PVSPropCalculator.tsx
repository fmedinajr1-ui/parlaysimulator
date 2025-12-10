import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, RefreshCw, Trophy, Scan, BarChart3, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PVSProp, PVSTier } from "@/types/pvs";
import { PVSPropCard } from "./PVSPropCard";
import { PVSParlayBuilder } from "./PVSParlayBuilder";
import { MetricCard } from "./MetricCard";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const PROP_TYPE_OPTIONS = [
  { value: 'all', label: 'All Props' },
  { value: 'player_points', label: 'Points' },
  { value: 'player_rebounds', label: 'Rebounds' },
  { value: 'player_assists', label: 'Assists' },
  { value: 'player_threes', label: '3PT' },
  { value: 'player_steals', label: 'Steals' },
  { value: 'player_blocks', label: 'Blocks' },
  { value: 'player_points_rebounds_assists', label: 'PRA' },
  { value: 'player_turnovers', label: 'Turnovers' },
  { value: 'player_fantasy_score', label: 'Fantasy' },
];

const TIERS: PVSTier[] = ['GOD_TIER', 'HIGH_VALUE', 'MED_VOLATILITY', 'RISKY', 'FADE', 'uncategorized'];

export function PVSPropCalculator() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTier, setSelectedTier] = useState<PVSTier | "all">("all");
  const [selectedPropType, setSelectedPropType] = useState<string>("all");
  const [selectedProps, setSelectedProps] = useState<PVSProp[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { data: props, isLoading, refetch } = useQuery({
    queryKey: ['pvs-props'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('unified_props')
        .select('*')
        .eq('sport', 'basketball_nba')
        .eq('is_active', true)
        .gt('pvs_final_score', 0)
        .order('pvs_final_score', { ascending: false });

      if (error) throw error;
      return (data || []) as PVSProp[];
    }
  });

  const handleScanProps = async () => {
    setIsScanning(true);
    try {
      console.log('[PVS] Scanning for new props from The Odds API...');
      const { data, error } = await supabase.functions.invoke('pvs-data-ingestion', {
        body: { mode: 'all' }
      });
      
      if (error) {
        console.error('[PVS] Scan error:', error);
        toast.error('Failed to scan props');
      } else {
        toast.success(`Scanned ${data?.propsIngested || 0} new props`);
        await refetch();
      }
    } catch (error) {
      console.error('Error scanning props:', error);
      toast.error('Error scanning props');
    } finally {
      setIsScanning(false);
    }
  };

  const handleAnalyze = async () => {
    setIsAnalyzing(true);
    try {
      console.log('[PVS] Running unified props engine with PVS scoring...');
      const { data, error } = await supabase.functions.invoke('unified-props-engine', {
        body: { sports: ['basketball_nba'] }
      });
      
      if (error) {
        console.error('[PVS] Analyze error:', error);
        toast.error('Failed to analyze props');
      } else {
        toast.success(`Analyzed ${data?.totalPropsAnalyzed || 0} props with PVS scoring`);
        await refetch();
      }
    } catch (error) {
      console.error('Error analyzing props:', error);
      toast.error('Error analyzing props');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      console.log('[PVS] Generating AI-powered parlays...');
      const { data, error } = await supabase.functions.invoke('build-hitrate-parlays', {
        body: { sport: 'basketball_nba' }
      });
      
      if (error) {
        console.error('[PVS] Generate error:', error);
        toast.error('Failed to generate parlays');
      } else {
        toast.success(`Generated ${data?.parlaysCreated || 0} AI parlays`);
      }
    } catch (error) {
      console.error('Error generating parlays:', error);
      toast.error('Error generating parlays');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refetch();
      toast.success('Data refreshed');
    } catch (error) {
      console.error('Error refreshing:', error);
      toast.error('Error refreshing data');
    } finally {
      setIsRefreshing(false);
    }
  };

  const isAnyLoading = isScanning || isAnalyzing || isGenerating || isRefreshing;

  // Deduplicate props by player_name + prop_type + current_line, keeping the best odds/highest PVS score
  const deduplicatedProps = useMemo(() => {
    if (!props) return [];
    
    const propMap = new Map<string, PVSProp>();
    
    for (const prop of props) {
      const key = `${prop.player_name}-${prop.prop_type}-${prop.current_line}`;
      const existing = propMap.get(key);
      
      if (!existing || (prop.pvs_final_score || 0) > (existing.pvs_final_score || 0)) {
        propMap.set(key, prop);
      }
    }
    
    return Array.from(propMap.values());
  }, [props]);

  const filteredProps = useMemo(() => {
    if (!deduplicatedProps) return [];
    
    return deduplicatedProps.filter(prop => {
      const matchesSearch = searchQuery === "" || 
        prop.player_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        prop.game_description.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesTier = selectedTier === "all" || prop.pvs_tier === selectedTier;
      const matchesPropType = selectedPropType === "all" || prop.prop_type === selectedPropType;
      
      return matchesSearch && matchesTier && matchesPropType;
    });
  }, [deduplicatedProps, searchQuery, selectedTier, selectedPropType]);

  const tierCounts = useMemo(() => {
    if (!deduplicatedProps) return {} as Record<PVSTier, number>;
    return deduplicatedProps.reduce((acc, prop) => {
      acc[prop.pvs_tier] = (acc[prop.pvs_tier] || 0) + 1;
      return acc;
    }, {} as Record<PVSTier, number>);
  }, [deduplicatedProps]);

  const handleSelectProp = (prop: PVSProp) => {
    setSelectedProps(prev => {
      const exists = prev.find(p => p.id === prop.id);
      if (exists) {
        return prev.filter(p => p.id !== prop.id);
      }
      return [...prev, prop];
    });
  };

  const handleRemoveProp = (prop: PVSProp) => {
    setSelectedProps(prev => prev.filter(p => p.id !== prop.id));
  };

  return (
    <div className="app-wrapper">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2 text-white">
              <Trophy className="h-6 w-6 text-[#00ff8c]" />
              PVS Calculator
            </h1>
            <p className="text-gray-400 text-sm mt-1">
              Perfect Parlay Leg Score • AI-Powered NBA Prop Analysis
            </p>
          </div>
        </div>
        
        {/* Action Buttons Row */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleScanProps}
            disabled={isAnyLoading}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#00ff8c]/10 border border-[#00ff8c]/30 text-[#00ff8c] hover:bg-[#00ff8c]/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Scan className={cn("h-4 w-4", isScanning && "animate-pulse")} />
            {isScanning ? "Scanning..." : "Scan Props"}
          </button>
          
          <button
            onClick={handleAnalyze}
            disabled={isAnyLoading}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-400 hover:bg-blue-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <BarChart3 className={cn("h-4 w-4", isAnalyzing && "animate-pulse")} />
            {isAnalyzing ? "Analyzing..." : "Analyze"}
          </button>
          
          <button
            onClick={handleGenerate}
            disabled={isAnyLoading}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-400 hover:bg-purple-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Sparkles className={cn("h-4 w-4", isGenerating && "animate-spin")} />
            {isGenerating ? "Generating..." : "Generate"}
          </button>
          
          <button
            onClick={handleRefresh}
            disabled={isAnyLoading}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-white/20 text-white hover:bg-white/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="metrics-row">
        {TIERS.map(tier => (
          <MetricCard
            key={tier}
            tier={tier}
            count={tierCounts[tier] || 0}
            isSelected={selectedTier === tier}
            onClick={() => setSelectedTier(selectedTier === tier ? "all" : tier)}
          />
        ))}
      </div>

      {/* Search + Filter Row */}
      <div className="search-filter-row">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
          <input
            type="text"
            placeholder="Search player or game..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-player-bar pl-11"
          />
        </div>
        
        <select
          value={selectedPropType}
          onChange={(e) => setSelectedPropType(e.target.value)}
          className="prop-type-filter"
        >
          {PROP_TYPE_OPTIONS.map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {/* Main Layout - Parlay Builder LEFT, Props Sidebar RIGHT */}
      <div className="main-layout">
        {/* Parlay Builder (LEFT - Main Area) */}
        <div className="parlay-builder">
          <PVSParlayBuilder
            selectedProps={selectedProps}
            onRemove={handleRemoveProp}
            onClear={() => setSelectedProps([])}
          />
        </div>

        {/* Sidebar - Props List (RIGHT) */}
        <div className="sidebar">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">
              Props ({filteredProps.length})
            </h2>
            <span className="text-xs text-gray-500">
              Sorted by PVS
            </span>
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {[...Array(6)].map((_, i) => (
                <Skeleton key={i} className="h-36 w-full bg-[#222]" />
              ))}
            </div>
          ) : filteredProps.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No props found</p>
              <button
                onClick={() => {
                  setSearchQuery("");
                  setSelectedTier("all");
                  setSelectedPropType("all");
                }}
                className="text-[#00ff8c] text-sm mt-2 hover:underline"
              >
                Clear filters
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-5 w-full items-stretch">
              {filteredProps.map(prop => (
                <PVSPropCard
                  key={prop.id}
                  prop={prop}
                  isSelected={selectedProps.some(p => p.id === prop.id)}
                  onSelect={handleSelectProp}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
