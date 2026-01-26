import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Lock, Copy, AlertTriangle, ShieldCheck } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { PropEdge, PlayerLiveState, LockModeLegSlot } from '@/types/scout-agent';
import { buildLockModeSlip, getSlotDisplayName } from '@/lib/lockModeEngine';
import { LockModeLegCard } from './LockModeLegCard';

interface LockModeTabProps {
  edges: PropEdge[];
  playerStates: Map<string, PlayerLiveState>;
  gameTime: string;
  isHalftime: boolean;
}

export function LockModeTab({ edges, playerStates, gameTime, isHalftime }: LockModeTabProps) {
  const { toast } = useToast();
  
  const slip = useMemo(() => 
    buildLockModeSlip(edges, playerStates, gameTime),
    [edges, playerStates, gameTime]
  );

  const handleCopySlip = () => {
    if (!slip.isValid) return;
    
    const text = slip.legs.map((leg, i) => {
      const propAbbrev = leg.prop === 'Rebounds' ? 'REB' : leg.prop === 'Assists' ? 'AST' : leg.prop === 'Points' ? 'PTS' : leg.prop;
      const leanSymbol = leg.lean === 'OVER' ? 'O' : 'U';
      return `${i + 1}. ${leg.player} ${propAbbrev} ${leanSymbol}${leg.line} (Proj: ${leg.projected.toFixed(1)} | Edge: +${leg.edge.toFixed(1)})`;
    }).join('\n');
    
    navigator.clipboard.writeText(`🔒 LOCK MODE 3-LEG SLIP\n${gameTime}\n\n${text}`);
    
    toast({
      title: "Copied Lock Mode Slip",
      description: "3 legs copied to clipboard",
    });
  };

  return (
    <div className="space-y-4">
      {/* Header Card */}
      <Card className={cn(
        "border-2",
        slip.isValid 
          ? "border-emerald-500/50 bg-emerald-500/5" 
          : "border-amber-500/50 bg-amber-500/5"
      )}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Lock className={cn(
                "w-5 h-5",
                slip.isValid ? "text-emerald-400" : "text-amber-400"
              )} />
              LOCK MODE — 3 LEG SLIP
            </CardTitle>
            {slip.isValid && (
              <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/50">
                <ShieldCheck className="w-3 h-3 mr-1" />
                VALID
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Only highest-certainty halftime plays
          </p>
        </CardHeader>
        
        {slip.isValid ? (
          <CardContent className="space-y-3">
            {slip.legs.map((leg, index) => (
              <LockModeLegCard key={`${leg.player}-${leg.prop}`} leg={leg} index={index} />
            ))}
            
            <Button 
              onClick={handleCopySlip}
              className="w-full mt-4 gap-2 bg-emerald-600 hover:bg-emerald-700"
            >
              <Copy className="w-4 h-4" />
              Copy All 3 Legs
            </Button>
          </CardContent>
        ) : (
          <CardContent>
            <div className="text-center py-8 space-y-4">
              <div className="w-16 h-16 mx-auto rounded-full bg-amber-500/10 flex items-center justify-center">
                <AlertTriangle className="w-8 h-8 text-amber-400" />
              </div>
              
              <div>
                <h3 className="text-lg font-semibold text-foreground mb-1">
                  NO LOCK MODE SLIP TODAY
                </h3>
                <p className="text-sm text-muted-foreground">
                  Could not fill all 3 required slots.
                </p>
                <p className="text-sm text-emerald-400 font-medium mt-2">
                  This is a pass, not a failure.
                </p>
              </div>
              
              {slip.missingSlots && slip.missingSlots.length > 0 && (
                <div className="mt-4 p-3 bg-muted/50 rounded-lg text-left">
                  <p className="text-xs text-muted-foreground mb-2">Missing Slots:</p>
                  <div className="flex flex-wrap gap-2">
                    {slip.missingSlots.map((slot) => (
                      <Badge 
                        key={slot} 
                        variant="outline" 
                        className="text-amber-400 border-amber-500/50"
                      >
                        {getSlotDisplayName(slot)}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        )}
      </Card>

      {/* Info Card */}
      <Card className="border-border/50">
        <CardContent className="py-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center text-sm">
            <div>
              <p className="text-2xl font-bold text-emerald-400">72%+</p>
              <p className="text-xs text-muted-foreground">Min Confidence</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">3</p>
              <p className="text-xs text-muted-foreground">Legs Only</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-amber-400">≤3</p>
              <p className="text-xs text-muted-foreground">Max Fouls</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-blue-400">14+</p>
              <p className="text-xs text-muted-foreground">1H Minutes</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
