import React from 'react';
import { ScoutSweetSpotProps } from './ScoutSweetSpotProps';
import { CustomerHedgePanel } from './CustomerHedgePanel';
import { Card, CardContent } from '@/components/ui/card';
import { Video } from 'lucide-react';
import type { ScoutGameContext } from '@/pages/Scout';

interface CustomerScoutViewProps {
  gameContext: ScoutGameContext;
}

export function CustomerScoutView({ gameContext }: CustomerScoutViewProps) {
  const { homeTeam, awayTeam } = gameContext;

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

      {/* Props + Hedge side by side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ScoutSweetSpotProps homeTeam={homeTeam} awayTeam={awayTeam} />
        <CustomerHedgePanel homeTeam={homeTeam} awayTeam={awayTeam} />
      </div>
    </div>
  );
}
