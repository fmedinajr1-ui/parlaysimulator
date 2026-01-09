import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Flame, Shield, TrendingUp, AlertTriangle } from "lucide-react";

interface ParlayLeg {
  player_name: string;
  market_type: string;
  line: number;
  side: string;
  book_name: string;
  final_score: number;
  signal_label: string;
  reason: string;
  event_id: string;
  sport: string;
}

interface HeatParlay {
  id: string;
  parlay_date: string;
  parlay_type: 'CORE' | 'UPSIDE';
  leg_1: ParlayLeg;
  leg_2: ParlayLeg;
  summary: string;
  risk_level: string;
  no_bet_flags: string[];
}

interface HeatParlayCardProps {
  parlay: HeatParlay | null;
  type: 'CORE' | 'UPSIDE';
}

export function HeatParlayCard({ parlay, type }: HeatParlayCardProps) {
  const isCore = type === 'CORE';
  
  if (!parlay) {
    return (
      <Card className={`border-2 ${isCore ? 'border-muted/50' : 'border-muted/30'}`}>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            {isCore ? (
              <Shield className="h-5 w-5 text-blue-500" />
            ) : (
              <TrendingUp className="h-5 w-5 text-amber-500" />
            )}
            {type} 2-MAN
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <AlertTriangle className="h-5 w-5 mr-2" />
            <span>NO {type} PLAY TODAY</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const getSignalBadge = (label: string) => {
    switch (label) {
      case 'STRONG_SHARP':
        return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">STRONG SHARP</Badge>;
      case 'SHARP_LEAN':
        return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">SHARP LEAN</Badge>;
      case 'NEUTRAL':
        return <Badge className="bg-muted text-muted-foreground">NEUTRAL</Badge>;
      default:
        return <Badge className="bg-destructive/20 text-destructive">TRAP</Badge>;
    }
  };

  const renderLeg = (leg: ParlayLeg, index: number) => (
    <div key={index} className="p-3 rounded-lg bg-muted/30 space-y-2">
      <div className="flex items-start justify-between">
        <div>
          <p className="font-semibold">{leg.player_name}</p>
          <p className="text-sm text-muted-foreground">
            {leg.market_type} {leg.side.toUpperCase()} {leg.line}
          </p>
        </div>
        <div className="text-right">
          <div className="flex items-center gap-1">
            <Flame className="h-4 w-4 text-orange-500" />
            <span className="font-mono text-sm">{leg.final_score}</span>
          </div>
          {getSignalBadge(leg.signal_label)}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{leg.reason}</p>
    </div>
  );

  return (
    <Card className={`border-2 ${isCore ? 'border-blue-500/30 bg-blue-500/5' : 'border-amber-500/30 bg-amber-500/5'}`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            {isCore ? (
              <Shield className="h-5 w-5 text-blue-500" />
            ) : (
              <TrendingUp className="h-5 w-5 text-amber-500" />
            )}
            {type} 2-MAN
          </CardTitle>
          <Badge variant="outline" className={isCore ? 'border-blue-500/50 text-blue-400' : 'border-amber-500/50 text-amber-400'}>
            Risk: {parlay.risk_level}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {renderLeg(parlay.leg_1, 1)}
        {renderLeg(parlay.leg_2, 2)}
        
        <div className="pt-2 border-t border-muted/30">
          <p className="text-sm text-muted-foreground">{parlay.summary}</p>
        </div>
        
        {parlay.no_bet_flags && parlay.no_bet_flags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {parlay.no_bet_flags.map((flag, i) => (
              <Badge key={i} variant="destructive" className="text-xs">
                {flag}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
