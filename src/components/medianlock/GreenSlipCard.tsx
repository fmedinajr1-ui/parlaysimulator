import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle, TrendingUp, Sparkles, Copy, Share2 } from "lucide-react";
import { toast } from "sonner";
import { useParlayBuilder } from "@/contexts/ParlayBuilderContext";

interface SlipLeg {
  playerName: string;
  confidenceScore: number;
  status: 'LOCK' | 'STRONG';
}

interface GreenSlip {
  id: string;
  slate_date: string;
  slip_type: '2-leg' | '3-leg';
  legs: SlipLeg[];
  slip_score: number;
  probability: number;
  stake_tier: 'A' | 'B' | 'C';
  outcome?: 'won' | 'lost' | 'push' | 'pending';
}

interface GreenSlipCardProps {
  slip: GreenSlip;
  rank?: number;
}

export function GreenSlipCard({ slip, rank }: GreenSlipCardProps) {
  const { addLeg } = useParlayBuilder();

  const getStakeTierBadge = () => {
    switch (slip.stake_tier) {
      case 'A':
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/30 font-bold">Tier A</Badge>;
      case 'B':
        return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 font-bold">Tier B</Badge>;
      case 'C':
        return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">Tier C</Badge>;
    }
  };

  const getOutcomeBadge = () => {
    if (!slip.outcome || slip.outcome === 'pending') return null;
    switch (slip.outcome) {
      case 'won':
        return <Badge className="bg-green-500 text-white">WON ✓</Badge>;
      case 'lost':
        return <Badge variant="destructive">LOST</Badge>;
      case 'push':
        return <Badge variant="secondary">PUSH</Badge>;
    }
  };

  const handleCopy = () => {
    const text = slip.legs.map(l => `${l.playerName} (${l.status})`).join('\n');
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  const handleAddToParlay = () => {
    slip.legs.forEach((leg) => {
      addLeg({
        description: `${leg.playerName} - MedianLock ${leg.status}`,
        odds: -110,
        source: 'hitrate',
        confidenceScore: leg.confidenceScore,
      });
    });
    toast.success(`Added ${slip.legs.length} legs to parlay builder`);
  };

  return (
    <Card className={`bg-gradient-to-br from-card/90 to-card/70 backdrop-blur-sm border-border/50 overflow-hidden ${
      slip.stake_tier === 'A' ? 'ring-2 ring-green-500/30' : 
      slip.stake_tier === 'B' ? 'ring-1 ring-blue-500/20' : ''
    }`}>
      {/* Rank Badge */}
      {rank && (
        <div className="absolute top-0 left-0 bg-primary text-primary-foreground px-3 py-1 text-sm font-bold rounded-br-lg">
          #{rank}
        </div>
      )}

      <CardHeader className={`pb-2 ${rank ? 'pt-8' : ''}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-yellow-400" />
            <CardTitle className="text-base">Green Slip</CardTitle>
            <Badge variant="outline">{slip.slip_type}</Badge>
          </div>
          <div className="flex items-center gap-2">
            {getStakeTierBadge()}
            {getOutcomeBadge()}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Probability & Score */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-muted/30 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-primary">
              {(slip.probability * 100).toFixed(1)}%
            </div>
            <div className="text-xs text-muted-foreground">Win Probability</div>
          </div>
          <div className="bg-muted/30 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-foreground">
              {slip.slip_score.toFixed(0)}
            </div>
            <div className="text-xs text-muted-foreground">Slip Score</div>
          </div>
        </div>

        {/* Legs */}
        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">Legs</div>
          {slip.legs.map((leg, i) => (
            <div 
              key={i}
              className="flex items-center justify-between bg-muted/20 rounded-lg px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{leg.playerName}</span>
                <Badge 
                  variant="secondary" 
                  className={`text-xs ${
                    leg.status === 'LOCK' 
                      ? 'bg-green-500/20 text-green-400' 
                      : 'bg-blue-500/20 text-blue-400'
                  }`}
                >
                  {leg.status === 'LOCK' ? '🔒' : '💪'} {leg.status}
                </Badge>
              </div>
              <span className="text-sm text-muted-foreground">
                {leg.confidenceScore.toFixed(0)} conf
              </span>
            </div>
          ))}
        </div>

        {/* Stake Recommendation */}
        <div className={`rounded-lg p-3 text-sm ${
          slip.stake_tier === 'A' ? 'bg-green-500/10 border border-green-500/20' :
          slip.stake_tier === 'B' ? 'bg-blue-500/10 border border-blue-500/20' :
          'bg-yellow-500/10 border border-yellow-500/20'
        }`}>
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            <span className="font-medium">
              {slip.stake_tier === 'A' ? 'High Confidence - Full Stake' :
               slip.stake_tier === 'B' ? 'Good Value - Standard Stake' :
               'Lower Edge - Reduced Stake'}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Button 
            variant="default" 
            size="sm" 
            className="flex-1"
            onClick={handleAddToParlay}
          >
            <CheckCircle className="h-4 w-4 mr-1" />
            Add to Parlay
          </Button>
          <Button variant="outline" size="sm" onClick={handleCopy}>
            <Copy className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
