import React from 'react';
import { ScoutSweetSpotProps } from './ScoutSweetSpotProps';
import { CustomerHedgePanel } from './CustomerHedgePanel';
import { CustomerSlipScanner } from './CustomerSlipScanner';
import { CustomerConfidenceDashboard } from './CustomerConfidenceDashboard';
import { CustomerRiskToggle } from './CustomerRiskToggle';
import { CustomerAIWhisper } from './CustomerAIWhisper';
import { useCustomerWhaleSignals } from '@/hooks/useCustomerWhaleSignals';
import { useDeepSweetSpots } from '@/hooks/useDeepSweetSpots';
import { useSweetSpotLiveData } from '@/hooks/useSweetSpotLiveData';
import { Card, CardContent } from '@/components/ui/card';
import { Video } from 'lucide-react';
import type { ScoutGameContext } from '@/pages/Scout';

interface CustomerScoutViewProps {
  gameContext: ScoutGameContext;
}

export function CustomerScoutView({ gameContext }: CustomerScoutViewProps) {
  const { homeTeam, awayTeam } = gameContext;
  const { data: whaleSignals } = useCustomerWhaleSignals();

  // Get enriched spots for confidence dashboard + whisper
  const { data } = useDeepSweetSpots();
  const rawSpots = data?.spots ?? [];
  const { spots: enrichedSpots } = useSweetSpotLiveData(rawSpots);

  // Build confidence picks from enriched spots that have live data
  const confidencePicks = enrichedSpots
    .filter((s) => s.liveData?.currentValue != null)
    .map((s) => ({
      playerName: s.playerName,
      propType: s.propType,
      line: s.line,
      currentValue: s.liveData?.currentValue ?? 0,
      side: s.side,
    }));

  // Build whisper picks with game progress
  const whisperPicks = confidencePicks.map((p) => ({
    ...p,
    gameProgress: 0.5, // Default; would come from live game state if available
  }));

  return (
    <div className="space-y-4">
      {/* Stream Panel */}
      <Card className="border-border/50 overflow-hidden">
        <CardContent className="p-0">
          <div className="aspect-video bg-muted/30 flex items-center justify-center">
            <div className="text-center space-y-2">
              <Video className="w-10 h-10 mx-auto text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                {awayTeam} @ {homeTeam}
              </p>
              <p className="text-xs text-muted-foreground/60">
                Stream coming soon
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Slip Scanner */}
      <CustomerSlipScanner />

      {/* Props + Hedge side by side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ScoutSweetSpotProps homeTeam={homeTeam} awayTeam={awayTeam} />
        <CustomerHedgePanel homeTeam={homeTeam} awayTeam={awayTeam} />
      </div>

      {/* Confidence Dashboard */}
      <CustomerConfidenceDashboard picks={confidencePicks} />

      {/* Risk Mode Toggle */}
      <CustomerRiskToggle />

      {/* AI Commentary Whisper */}
      <CustomerAIWhisper picks={whisperPicks} signals={whaleSignals} />
    </div>
  );
}
