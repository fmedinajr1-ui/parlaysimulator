import { Badge } from '@/components/ui/badge';
import { ArrowUp, ArrowDown } from 'lucide-react';

interface GameBet {
  bet_type: string;
  home_team: string;
  away_team: string;
  line: number | null;
  home_odds: number | null;
  away_odds: number | null;
  over_odds: number | null;
  under_odds: number | null;
  recommended_side: string | null;
}

function formatOdds(odds: number | null): string {
  if (odds === null) return '-';
  return odds > 0 ? `+${odds}` : `${odds}`;
}

export function TeamBetOddsDisplay({ bet }: { bet: GameBet }) {
  return (
    <div className="text-right space-y-1">
      {bet.bet_type === 'spread' && (
        <>
          <div className="flex items-center gap-2 justify-end">
            <span className="text-xs text-muted-foreground">{bet.home_team.split(' ').pop()}</span>
            <Badge variant={bet.recommended_side === 'HOME' ? 'default' : 'outline'}>
              {bet.line !== null && bet.line > 0 ? '+' : ''}{bet.line}
              <span className="ml-1 text-xs opacity-70">{formatOdds(bet.home_odds)}</span>
            </Badge>
          </div>
          <div className="flex items-center gap-2 justify-end">
            <span className="text-xs text-muted-foreground">{bet.away_team.split(' ').pop()}</span>
            <Badge variant={bet.recommended_side === 'AWAY' ? 'default' : 'outline'}>
              {bet.line !== null ? (bet.line > 0 ? `-${bet.line}` : `+${Math.abs(bet.line)}`) : '-'}
              <span className="ml-1 text-xs opacity-70">{formatOdds(bet.away_odds)}</span>
            </Badge>
          </div>
        </>
      )}
      
      {bet.bet_type === 'total' && (
        <>
          <div className="flex items-center gap-2 justify-end">
            <ArrowUp className="h-3 w-3 text-green-500" />
            <Badge variant={bet.recommended_side === 'OVER' ? 'default' : 'outline'}>
              O {bet.line}
              <span className="ml-1 text-xs opacity-70">{formatOdds(bet.over_odds)}</span>
            </Badge>
          </div>
          <div className="flex items-center gap-2 justify-end">
            <ArrowDown className="h-3 w-3 text-red-500" />
            <Badge variant={bet.recommended_side === 'UNDER' ? 'default' : 'outline'}>
              U {bet.line}
              <span className="ml-1 text-xs opacity-70">{formatOdds(bet.under_odds)}</span>
            </Badge>
          </div>
        </>
      )}
      
      {bet.bet_type === 'h2h' && (
        <>
          <div className="flex items-center gap-2 justify-end">
            <span className="text-xs text-muted-foreground">{bet.home_team.split(' ').pop()}</span>
            <Badge variant={bet.recommended_side === 'HOME' ? 'default' : 'outline'}>
              {formatOdds(bet.home_odds)}
            </Badge>
          </div>
          <div className="flex items-center gap-2 justify-end">
            <span className="text-xs text-muted-foreground">{bet.away_team.split(' ').pop()}</span>
            <Badge variant={bet.recommended_side === 'AWAY' ? 'default' : 'outline'}>
              {formatOdds(bet.away_odds)}
            </Badge>
          </div>
        </>
      )}
    </div>
  );
}
