import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Filter, RefreshCw, Trophy, Star, AlertTriangle, XCircle, Skull, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PVSProp, PVSTier, PVS_TIER_CONFIG } from "@/types/pvs";
import { PVSPropCard } from "./PVSPropCard";
import { PVSParlayBuilder } from "./PVSParlayBuilder";
import { PVSAutoParlays } from "./PVSAutoParlays";
import { cn } from "@/lib/utils";

const TIER_ICONS: Record<PVSTier, React.ReactNode> = {
  GOD_TIER: <Trophy className="h-4 w-4" />,
  HIGH_VALUE: <Star className="h-4 w-4" />,
  MED_VOLATILITY: <AlertTriangle className="h-4 w-4" />,
  RISKY: <XCircle className="h-4 w-4" />,
  FADE: <Skull className="h-4 w-4" />,
  uncategorized: <Sparkles className="h-4 w-4" />
};

export function PVSPropCalculator() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTier, setSelectedTier] = useState<PVSTier | "all">("all");
  const [selectedPropType, setSelectedPropType] = useState<string>("all");
  const [selectedProps, setSelectedProps] = useState<PVSProp[]>([]);
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

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      // Step 1: Run data ingestion to refresh supporting data (defense, pace, game logs)
      console.log('[PVS] Running data ingestion...');
      await supabase.functions.invoke('pvs-data-ingestion', {
        body: { mode: 'all' }
      });
      
      // Step 2: Run unified props engine with PVS calculations
      console.log('[PVS] Running unified props engine with PVS scoring...');
      const { data, error } = await supabase.functions.invoke('unified-props-engine', {
        body: { sports: ['basketball_nba'] }
      });
      
      if (error) {
        console.error('[PVS] Engine error:', error);
      } else {
        console.log('[PVS] Engine result:', data);
      }
      
      await refetch();
    } catch (error) {
      console.error('Error refreshing props:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  const filteredProps = useMemo(() => {
    if (!props) return [];
    
    return props.filter(prop => {
      const matchesSearch = searchQuery === "" || 
        prop.player_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        prop.game_description.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesTier = selectedTier === "all" || prop.pvs_tier === selectedTier;
      
      const matchesPropType = selectedPropType === "all" || prop.prop_type === selectedPropType;
      
      return matchesSearch && matchesTier && matchesPropType;
    });
  }, [props, searchQuery, selectedTier, selectedPropType]);

  const propTypes = useMemo(() => {
    if (!props) return [];
    return [...new Set(props.map(p => p.prop_type))];
  }, [props]);

  const tierCounts = useMemo(() => {
    if (!props) return {};
    return props.reduce((acc, prop) => {
      acc[prop.pvs_tier] = (acc[prop.pvs_tier] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }, [props]);

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

  const formatPropType = (propType: string) => {
    return propType
      .replace('player_', '')
      .replace(/_/g, ' ')
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Trophy className="h-6 w-6 text-primary" />
            PVS Calculator
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Perfect Parlay Leg Score • AI-Powered NBA Prop Analysis
          </p>
        </div>
        
        <Button 
          onClick={handleRefresh} 
          disabled={isRefreshing}
          variant="outline"
          className="flex items-center gap-2"
        >
          <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
          {isRefreshing ? "Analyzing..." : "Refresh Props"}
        </Button>
      </div>

      {/* Auto-Generated Parlays */}
      <section>
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          AI-Generated Parlays
        </h2>
        <PVSAutoParlays />
      </section>

      {/* Tier Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
        {(Object.keys(PVS_TIER_CONFIG) as PVSTier[]).map(tier => (
          <Card 
            key={tier}
            className={cn(
              "cursor-pointer transition-all border-2",
              selectedTier === tier 
                ? "border-primary bg-primary/5" 
                : "border-transparent hover:border-primary/30",
              PVS_TIER_CONFIG[tier].bgColor
            )}
            onClick={() => setSelectedTier(selectedTier === tier ? "all" : tier)}
          >
            <CardContent className="p-3 text-center">
              <div className={cn("text-2xl font-bold", PVS_TIER_CONFIG[tier].color)}>
                {tierCounts[tier] || 0}
              </div>
              <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                {TIER_ICONS[tier]}
                {tier.replace('_', ' ')}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search player or game..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            
            <Select value={selectedPropType} onValueChange={setSelectedPropType}>
              <SelectTrigger className="w-full sm:w-48">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Prop Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Prop Types</SelectItem>
                {propTypes.map(type => (
                  <SelectItem key={type} value={type}>
                    {formatPropType(type)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {selectedTier !== "all" && (
              <Button 
                variant="outline" 
                onClick={() => setSelectedTier("all")}
                className="flex items-center gap-1"
              >
                Clear Filter
                <Badge variant="secondary" className="ml-1">{selectedTier.replace('_', ' ')}</Badge>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Main Content */}
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Props Grid */}
        <div className="order-2 lg:order-1 flex-1 space-y-4 min-w-0 overflow-hidden">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">
              Props ({filteredProps.length})
            </h2>
            <div className="text-sm text-muted-foreground">
              Sorted by PVS Score
            </div>
          </div>

          {isLoading ? (
            <div className="grid gap-4 xl:grid-cols-2">
              {[...Array(6)].map((_, i) => (
                <Skeleton key={i} className="h-64" />
              ))}
            </div>
          ) : filteredProps.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center text-muted-foreground">
                <Search className="h-10 w-10 mx-auto mb-2 opacity-50" />
                <p>No props found matching your filters</p>
                <Button 
                  variant="link" 
                  onClick={() => {
                    setSearchQuery("");
                    setSelectedTier("all");
                    setSelectedPropType("all");
                  }}
                >
                  Clear all filters
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
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

        {/* Parlay Builder Sidebar */}
        <div className="order-1 lg:order-2 w-full lg:w-[350px] flex-shrink-0">
          <div className="lg:sticky lg:top-4">
            <PVSParlayBuilder
              selectedProps={selectedProps}
              onRemove={handleRemoveProp}
              onClear={() => setSelectedProps([])}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
