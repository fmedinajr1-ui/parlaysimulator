import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { 
  Shield, 
  Target, 
  Rocket, 
  TrendingUp, 
  AlertTriangle,
  CheckCircle,
  RefreshCw,
  Zap
} from 'lucide-react';
import { toast } from 'sonner';

interface ParlayLeg {
  player: string;
  prop: string;
  line: number;
  side: string;
  odds: number;
  confidence_tier: 'HIGH' | 'MEDIUM' | 'UPSIDE';
  rationale: string;
}

interface SharpParlay {
  id: string;
  parlay_date: string;
  parlay_type: 'SAFE' | 'BALANCED' | 'UPSIDE';
  legs: ParlayLeg[];
  total_odds: number;
  combined_probability: number;
  outcome: string;
}

const PARLAY_CONFIG = {
  SAFE: {
    icon: Shield,
    label: 'Safe Parlay',
    description: '2-3 legs, high confidence',
    color: 'text-green-500',
    bgColor: 'bg-green-500/10',
    borderColor: 'border-green-500/30'
  },
  BALANCED: {
    icon: Target,
    label: 'Balanced Parlay',
    description: '3-4 legs, moderate risk',
    color: 'text-blue-500',
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500/30'
  },
  UPSIDE: {
    icon: Rocket,
    label: 'Upside Parlay',
    description: '3-4 legs, higher payout',
    color: 'text-purple-500',
    bgColor: 'bg-purple-500/10',
    borderColor: 'border-purple-500/30'
  }
};

const CONFIDENCE_BADGES = {
  HIGH: { label: 'High', className: 'bg-green-500/20 text-green-400 border-green-500/30' },
  MEDIUM: { label: 'Medium', className: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
  UPSIDE: { label: 'Upside', className: 'bg-purple-500/20 text-purple-400 border-purple-500/30' }
};

function formatOdds(odds: number): string {
  return odds > 0 ? `+${odds}` : `${odds}`;
}

function formatProbability(prob: number): string {
  return `${(prob * 100).toFixed(1)}%`;
}

function ParlayLegItem({ leg }: { leg: ParlayLeg }) {
  const confidenceConfig = CONFIDENCE_BADGES[leg.confidence_tier];
  
  return (
    <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-foreground">{leg.player}</span>
          <Badge variant="outline" className={confidenceConfig.className}>
            {confidenceConfig.label}
          </Badge>
        </div>
        <span className="text-sm font-mono text-muted-foreground">
          {formatOdds(leg.odds)}
        </span>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <Badge variant="secondary" className="text-xs">
          {leg.prop}
        </Badge>
        <span className={`font-medium ${leg.side === 'over' ? 'text-green-400' : 'text-red-400'}`}>
          {leg.side.toUpperCase()} {leg.line}
        </span>
      </div>
      <p className="text-xs text-muted-foreground mt-2 italic">
        {leg.rationale}
      </p>
    </div>
  );
}

function SingleParlayCard({ parlay }: { parlay: SharpParlay }) {
  const config = PARLAY_CONFIG[parlay.parlay_type];
  const Icon = config.icon;
  const legs = parlay.legs as ParlayLeg[];
  
  return (
    <Card className={`${config.bgColor} ${config.borderColor} border`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon className={`h-5 w-5 ${config.color}`} />
            <CardTitle className="text-lg">{config.label}</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono">
              {formatOdds(parlay.total_odds)}
            </Badge>
            {parlay.outcome === 'won' && (
              <Badge className="bg-green-500">Won</Badge>
            )}
            {parlay.outcome === 'lost' && (
              <Badge className="bg-red-500">Lost</Badge>
            )}
            {parlay.outcome === 'pending' && (
              <Badge variant="secondary">Pending</Badge>
            )}
          </div>
        </div>
        <p className="text-sm text-muted-foreground">{config.description}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {legs.map((leg, index) => (
          <ParlayLegItem key={`${leg.player}-${leg.prop}-${index}`} leg={leg} />
        ))}
        
        <div className="pt-3 border-t border-border/50 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <TrendingUp className="h-4 w-4" />
            <span>Combined Probability:</span>
            <span className="font-semibold text-foreground">
              {formatProbability(parlay.combined_probability)}
            </span>
          </div>
          <div className="text-xs text-muted-foreground">
            {legs.length} legs
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function SharpParlayCards() {
  const [isBuilding, setIsBuilding] = React.useState(false);
  
  const { data: parlays, isLoading, error, refetch } = useQuery({
    queryKey: ['sharp-parlays'],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0];
      const { data, error } = await supabase
        .from('sharp_ai_parlays')
        .select('*')
        .eq('parlay_date', today)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return (data || []).map(p => ({
        ...p,
        legs: p.legs as unknown as ParlayLeg[]
      })) as SharpParlay[];
    },
    refetchInterval: 60000
  });
  
  const handleBuildParlays = async () => {
    setIsBuilding(true);
    try {
      const { data, error } = await supabase.functions.invoke('sharp-parlay-builder', {
        body: { action: 'build' }
      });
      
      if (error) throw error;
      
      toast.success(`Built ${data.saved?.length || 0} sharp parlays`, {
        description: `Evaluated ${data.candidates_evaluated} props, ${data.candidates_passed} passed all rules`
      });
      
      refetch();
    } catch (err) {
      console.error('Error building parlays:', err);
      toast.error('Failed to build parlays');
    } finally {
      setIsBuilding(false);
    }
  };
  
  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Zap className="h-5 w-5 text-yellow-500" />
            Sharp AI Parlays
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-64 w-full" />
          ))}
        </div>
      </div>
    );
  }
  
  if (error) {
    return (
      <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30">
        <div className="flex items-center gap-2 text-red-400">
          <AlertTriangle className="h-5 w-5" />
          <span>Error loading sharp parlays</span>
        </div>
      </div>
    );
  }
  
  // Group by parlay type
  const parlaysByType = {
    SAFE: parlays?.find(p => p.parlay_type === 'SAFE'),
    BALANCED: parlays?.find(p => p.parlay_type === 'BALANCED'),
    UPSIDE: parlays?.find(p => p.parlay_type === 'UPSIDE')
  };
  
  const hasParlays = parlays && parlays.length > 0;
  
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Zap className="h-5 w-5 text-yellow-500" />
          Sharp AI Parlays
        </h2>
        <Button 
          onClick={handleBuildParlays} 
          disabled={isBuilding}
          variant="outline"
          size="sm"
        >
          {isBuilding ? (
            <>
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              Building...
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4 mr-2" />
              {hasParlays ? 'Rebuild' : 'Build Parlays'}
            </>
          )}
        </Button>
      </div>
      
      {!hasParlays ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-8">
            <Zap className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground text-center mb-4">
              No sharp parlays built for today yet.<br />
              Click "Build Parlays" to generate SAFE, BALANCED, and UPSIDE picks.
            </p>
            <Button onClick={handleBuildParlays} disabled={isBuilding}>
              {isBuilding ? 'Building...' : 'Build Sharp Parlays'}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {parlaysByType.SAFE && <SingleParlayCard parlay={parlaysByType.SAFE} />}
          {parlaysByType.BALANCED && <SingleParlayCard parlay={parlaysByType.BALANCED} />}
          {parlaysByType.UPSIDE && <SingleParlayCard parlay={parlaysByType.UPSIDE} />}
        </div>
      )}
      
      {hasParlays && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <CheckCircle className="h-3 w-3" />
          <span>All legs passed 6-rule sharp validation: Minutes, Median, Role Lock, Blowout Filter, Volatility, Public Trap</span>
        </div>
      )}
    </div>
  );
}

export default SharpParlayCards;
