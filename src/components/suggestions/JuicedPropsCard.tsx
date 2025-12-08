import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { 
  Flame, 
  Lock, 
  Clock, 
  TrendingUp, 
  TrendingDown,
  RefreshCw,
  Loader2,
  Target,
  AlertCircle,
  CheckCircle2,
  Brain,
  Sparkles,
  Shield
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

interface JuicedProp {
  id: string;
  event_id: string;
  sport: string;
  game_description: string;
  player_name: string;
  prop_type: string;
  line: number;
  over_price: number;
  under_price: number;
  juice_level: 'heavy' | 'moderate' | 'light';
  juice_direction: string;
  juice_amount: number;
  final_pick: string | null;
  final_pick_reason: string | null;
  final_pick_confidence: number | null;
  final_pick_time: string | null;
  is_locked: boolean;
  commence_time: string;
  bookmaker: string;
  morning_scan_time: string;
  // Unified Intelligence fields
  unified_composite_score: number | null;
  unified_pvs_tier: string | null;
  unified_recommendation: string | null;
  unified_confidence: number | null;
  unified_trap_score: number | null;
  used_unified_intelligence: boolean | null;
}

const formatOdds = (odds: number) => odds > 0 ? `+${odds}` : odds.toString();

const formatTime = (dateString: string) => {
  const date = new Date(dateString);
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
};

const getJuiceLevelColor = (level: string) => {
  switch (level) {
    case 'heavy': return 'text-neon-red bg-neon-red/10 border-neon-red/30';
    case 'moderate': return 'text-neon-orange bg-neon-orange/10 border-neon-orange/30';
    case 'light': return 'text-neon-yellow bg-neon-yellow/10 border-neon-yellow/30';
    default: return 'text-muted-foreground bg-muted/10';
  }
};

const getConfidenceColor = (confidence: number) => {
  if (confidence >= 0.70) return 'text-neon-green';
  if (confidence >= 0.60) return 'text-neon-yellow';
  return 'text-neon-orange';
};

const getPVSTierConfig = (tier: string | null) => {
  switch (tier) {
    case 'ELITE_PICK':
      return { label: 'S', color: 'bg-neon-green text-background', description: 'Elite Pick' };
    case 'STRONG_LEAN':
      return { label: 'A', color: 'bg-neon-purple text-white', description: 'Strong Lean' };
    case 'MODERATE_EDGE':
      return { label: 'B', color: 'bg-neon-blue text-white', description: 'Moderate Edge' };
    case 'SLIGHT_EDGE':
      return { label: 'C', color: 'bg-neon-yellow text-background', description: 'Slight Edge' };
    case 'MED_VOLATILITY':
      return { label: 'D', color: 'bg-neon-orange text-background', description: 'Medium Volatility' };
    case 'HIGH_RISK':
      return { label: 'F', color: 'bg-neon-red text-white', description: 'High Risk' };
    default:
      return null;
  }
};

const isHighConfidenceTier = (tier: string | null): boolean => {
  return tier === 'ELITE_PICK' || tier === 'STRONG_LEAN';
};

export const JuicedPropsCard = () => {
  const { toast } = useToast();
  const [props, setProps] = useState<JuicedProp[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [activeTab, setActiveTab] = useState<'pending' | 'locked'>('pending');
  const [showOnlyUnified, setShowOnlyUnified] = useState(false);
  const [showOnlyHighTier, setShowOnlyHighTier] = useState(false);

  const fetchJuicedProps = async () => {
    try {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const { data, error } = await supabase
        .from('juiced_props')
        .select('*')
        .gte('commence_time', new Date().toISOString())
        .order('juice_level', { ascending: true })
        .order('commence_time', { ascending: true });

      if (error) throw error;

      setProps(data as JuicedProp[] || []);
    } catch (err) {
      console.error('Failed to fetch juiced props:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchJuicedProps();
    
    // Set up realtime subscription
    const channel = supabase
      .channel('juiced_props_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'juiced_props' },
        () => fetchJuicedProps()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const runMorningScan = async () => {
    setIsScanning(true);
    try {
      const { data, error } = await supabase.functions.invoke('morning-props-scanner');
      
      if (error) throw error;
      
      toast({
        title: "Morning Scan Complete",
        description: `Found ${data.stats?.total || 0} juiced over props`,
      });
      
      await fetchJuicedProps();
    } catch (err) {
      console.error('Failed to run morning scan:', err);
      toast({
        title: "Scan Failed",
        description: "Could not complete morning scan. Try again later.",
        variant: "destructive",
      });
    } finally {
      setIsScanning(false);
    }
  };

  // Filter props based on unified intelligence settings
  const filterProps = (propList: JuicedProp[]) => {
    let filtered = propList;
    
    if (showOnlyUnified) {
      filtered = filtered.filter(p => p.used_unified_intelligence);
    }
    
    if (showOnlyHighTier) {
      filtered = filtered.filter(p => isHighConfidenceTier(p.unified_pvs_tier));
    }
    
    return filtered;
  };

  const pendingProps = filterProps(props.filter(p => !p.is_locked));
  const lockedProps = filterProps(props.filter(p => p.is_locked));

  // Stats for unified intelligence
  const totalUnified = props.filter(p => p.used_unified_intelligence).length;
  const highTierCount = props.filter(p => isHighConfidenceTier(p.unified_pvs_tier)).length;

  if (isLoading) {
    return (
      <Card className="bg-card border-border">
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card border-border overflow-hidden">
      <CardHeader className="bg-gradient-to-r from-neon-orange/10 to-neon-yellow/10 border-b border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-neon-orange/20 rounded-lg">
              <Flame className="w-5 h-5 text-neon-orange" />
            </div>
            <div>
              <CardTitle className="text-lg font-display">JUICED PROPS</CardTitle>
              <p className="text-xs text-muted-foreground">Morning scan for public action</p>
            </div>
          </div>
          <Button 
            variant="outline" 
            size="sm"
            onClick={runMorningScan}
            disabled={isScanning}
            className="gap-2"
          >
            {isScanning ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            {isScanning ? 'Scanning...' : 'Scan Now'}
          </Button>
        </div>

        {/* Unified Intelligence Filters */}
        <div className="mt-4 p-3 bg-background/50 rounded-lg border border-border">
          <div className="flex items-center gap-2 mb-3">
            <Brain className="w-4 h-4 text-neon-purple" />
            <span className="text-sm font-semibold">Unified Intelligence Filters</span>
            {totalUnified > 0 && (
              <Badge variant="outline" className="ml-auto text-xs bg-neon-purple/10 text-neon-purple border-neon-purple/30">
                {totalUnified} AI-backed
              </Badge>
            )}
          </div>
          
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
            <div className="flex items-center gap-2">
              <Switch
                id="unified-filter"
                checked={showOnlyUnified}
                onCheckedChange={setShowOnlyUnified}
              />
              <Label htmlFor="unified-filter" className="text-sm cursor-pointer flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-neon-purple" />
                Show only AI-backed
              </Label>
            </div>
            
            <div className="flex items-center gap-2">
              <Switch
                id="high-tier-filter"
                checked={showOnlyHighTier}
                onCheckedChange={setShowOnlyHighTier}
              />
              <Label htmlFor="high-tier-filter" className="text-sm cursor-pointer flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-neon-green" />
                A/S Tier Only
                {highTierCount > 0 && (
                  <Badge className="ml-1 text-[10px] px-1.5 py-0 bg-neon-green/20 text-neon-green border-neon-green/30">
                    {highTierCount}
                  </Badge>
                )}
              </Label>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'pending' | 'locked')}>
          <TabsList className="w-full rounded-none border-b border-border bg-background/50">
            <TabsTrigger value="pending" className="flex-1 gap-2 data-[state=active]:bg-neon-orange/10">
              <Clock className="w-4 h-4" />
              Pending ({pendingProps.length})
            </TabsTrigger>
            <TabsTrigger value="locked" className="flex-1 gap-2 data-[state=active]:bg-neon-green/10">
              <Lock className="w-4 h-4" />
              Final Picks ({lockedProps.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pending" className="m-0">
            {pendingProps.length === 0 ? (
              <div className="p-8 text-center">
                <AlertCircle className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">
                  {showOnlyUnified || showOnlyHighTier ? 'No matching props found' : 'No juiced props found'}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {showOnlyUnified || showOnlyHighTier 
                    ? 'Try adjusting your filters' 
                    : 'Run a morning scan to find today\'s action'}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {pendingProps.map((prop) => (
                  <PropCard key={prop.id} prop={prop} isLocked={false} />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="locked" className="m-0">
            {lockedProps.length === 0 ? (
              <div className="p-8 text-center">
                <Lock className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">
                  {showOnlyUnified || showOnlyHighTier ? 'No matching picks found' : 'No final picks yet'}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {showOnlyUnified || showOnlyHighTier 
                    ? 'Try adjusting your filters' 
                    : 'Picks lock 30 min before game time'}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {lockedProps.map((prop) => (
                  <PropCard key={prop.id} prop={prop} isLocked={true} />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* Stats Footer */}
        {props.length > 0 && (
          <div className="p-3 bg-muted/20 border-t border-border">
            <div className="flex items-center justify-around text-center">
              <div>
                <p className="text-lg font-display text-neon-red">
                  {props.filter(p => p.juice_level === 'heavy').length}
                </p>
                <p className="text-xs text-muted-foreground">Heavy</p>
              </div>
              <div>
                <p className="text-lg font-display text-neon-orange">
                  {props.filter(p => p.juice_level === 'moderate').length}
                </p>
                <p className="text-xs text-muted-foreground">Moderate</p>
              </div>
              <div>
                <p className="text-lg font-display text-neon-purple">
                  {totalUnified}
                </p>
                <p className="text-xs text-muted-foreground">AI-Backed</p>
              </div>
              <div>
                <p className="text-lg font-display text-neon-green">
                  {highTierCount}
                </p>
                <p className="text-xs text-muted-foreground">A/S Tier</p>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

// Separate PropCard component for cleaner code
const PropCard = ({ prop, isLocked }: { prop: JuicedProp; isLocked: boolean }) => {
  const tierConfig = getPVSTierConfig(prop.unified_pvs_tier);
  
  return (
    <div className={cn(
      "p-4 hover:bg-muted/20 transition-colors",
      isLocked && "bg-gradient-to-r from-neon-green/5 to-transparent"
    )}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            {isLocked && (
              <Badge className="bg-neon-green/20 text-neon-green border-neon-green/30 text-xs gap-1">
                <CheckCircle2 className="w-3 h-3" />
                LOCKED
              </Badge>
            )}
            <Badge variant="outline" className="text-xs">
              {prop.sport}
            </Badge>
            <Badge variant="outline" className={cn("text-xs", getJuiceLevelColor(prop.juice_level))}>
              {prop.juice_level.toUpperCase()} JUICE
            </Badge>
            
            {/* Unified Intelligence Badge */}
            {prop.used_unified_intelligence && tierConfig && (
              <Badge className={cn("text-xs gap-1 font-bold", tierConfig.color)}>
                <Brain className="w-3 h-3" />
                {tierConfig.label}
              </Badge>
            )}
          </div>
          
          <h4 className="font-semibold text-foreground truncate">
            {prop.player_name}
          </h4>
          <p className="text-sm text-muted-foreground">
            {prop.prop_type} | {prop.game_description}
          </p>
          
          {/* Unified Intelligence Details */}
          {prop.used_unified_intelligence && (
            <div className="mt-2 flex items-center gap-3 text-xs">
              {prop.unified_composite_score && (
                <span className="text-neon-purple">
                  Score: {prop.unified_composite_score.toFixed(1)}
                </span>
              )}
              {prop.unified_recommendation && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                  {prop.unified_recommendation}
                </Badge>
              )}
              {prop.unified_trap_score !== null && prop.unified_trap_score > 0.5 && (
                <span className="text-neon-red flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  Trap: {Math.round(prop.unified_trap_score * 100)}%
                </span>
              )}
            </div>
          )}
          
          <div className="flex items-center gap-4 mt-2">
            <div className="flex items-center gap-1">
              <TrendingUp className="w-3 h-3 text-neon-red" />
              <span className="text-sm">
                O {prop.line} <span className="font-mono text-neon-red">{formatOdds(prop.over_price)}</span>
              </span>
            </div>
            <div className="flex items-center gap-1">
              <TrendingDown className="w-3 h-3 text-neon-green" />
              <span className="text-sm">
                U {prop.line} <span className="font-mono text-neon-green">{formatOdds(prop.under_price)}</span>
              </span>
            </div>
          </div>

          {/* Final Pick Display for locked props */}
          {isLocked && prop.final_pick && (
            <div className="mt-3 p-3 bg-card rounded-lg border border-neon-green/30">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Target className="w-5 h-5 text-neon-green" />
                  <span className="font-display text-lg text-neon-green">
                    {prop.final_pick.toUpperCase()} {prop.line}
                  </span>
                  <span className="font-mono text-foreground">
                    {formatOdds(prop.final_pick === 'over' ? prop.over_price : prop.under_price)}
                  </span>
                </div>
                {prop.final_pick_confidence && (
                  <div className={cn("text-sm font-semibold", getConfidenceColor(prop.final_pick_confidence))}>
                    {Math.round(prop.final_pick_confidence * 100)}%
                  </div>
                )}
              </div>
              {prop.final_pick_reason && (
                <p className="text-xs text-muted-foreground mt-2">
                  {prop.final_pick_reason}
                </p>
              )}
            </div>
          )}

          {/* Pending pick message */}
          {!isLocked && (
            <div className="mt-3 p-2 bg-muted/30 rounded-lg flex items-center gap-2">
              <Clock className="w-4 h-4 text-neon-yellow" />
              <span className="text-xs text-muted-foreground">
                Final pick locks ~30 min before game
              </span>
            </div>
          )}
        </div>
        
        <div className="text-right shrink-0">
          <div className="flex items-center gap-1 text-muted-foreground">
            <Clock className="w-3 h-3" />
            <span className="text-xs">{formatTime(prop.commence_time)}</span>
          </div>
          {isLocked && prop.final_pick_time && (
            <p className="text-xs text-neon-green mt-1">
              Locked {formatTime(prop.final_pick_time)}
            </p>
          )}
          {!isLocked && (
            <p className="text-xs text-muted-foreground mt-1">{prop.bookmaker}</p>
          )}
        </div>
      </div>
    </div>
  );
};
