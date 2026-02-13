import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Zap } from 'lucide-react';

interface GameBet {
  bet_type: string;
  home_team: string;
  away_team: string;
  line: number | null;
  home_odds: number | null;
  away_odds: number | null;
  over_odds: number | null;
  under_odds: number | null;
  sharp_score: number | null;
  recommended_side: string | null;
}

function formatOdds(odds: number | null): string {
  if (odds === null) return '';
  return odds > 0 ? `+${odds}` : `${odds}`;
}

function getSharpGrade(score: number | null): { grade: string; color: string } {
  if (!score) return { grade: '-', color: 'text-muted-foreground' };
  if (score >= 80) return { grade: 'A', color: 'text-green-500' };
  if (score >= 65) return { grade: 'B', color: 'text-blue-500' };
  if (score >= 50) return { grade: 'C', color: 'text-yellow-500' };
  return { grade: 'D', color: 'text-muted-foreground' };
}

function getPickDescription(bet: GameBet): { label: string; detail: string } {
  const side = bet.recommended_side;
  if (!side) return { label: '', detail: '' };

  if (bet.bet_type === 'spread') {
    const team = side === 'HOME' ? bet.home_team : bet.away_team;
    const line = bet.line !== null
      ? (side === 'HOME' 
          ? `${bet.line > 0 ? '+' : ''}${bet.line}` 
          : `${bet.line > 0 ? `-${bet.line}` : `+${Math.abs(bet.line)}`}`)
      : '';
    const odds = side === 'HOME' ? formatOdds(bet.home_odds) : formatOdds(bet.away_odds);
    return { label: `Take ${team} ${line}`, detail: odds };
  }

  if (bet.bet_type === 'total') {
    const line = bet.line !== null ? bet.line : '';
    const direction = side === 'OVER' ? 'Over' : 'Under';
    const odds = side === 'OVER' ? formatOdds(bet.over_odds) : formatOdds(bet.under_odds);
    return { label: `Take ${direction} ${line}`, detail: odds };
  }

  if (bet.bet_type === 'h2h') {
    const team = side === 'HOME' ? bet.home_team : bet.away_team;
    const odds = side === 'HOME' ? formatOdds(bet.home_odds) : formatOdds(bet.away_odds);
    return { label: `Take ${team}`, detail: odds };
  }

  return { label: side, detail: '' };
}

export function TeamBetPickBanner({ bet }: { bet: GameBet }) {
  const { label, detail } = getPickDescription(bet);
  const sharpGrade = getSharpGrade(bet.sharp_score);
  const hasSharpSignal = (bet.sharp_score || 0) >= 50;

  return (
    <div className="mb-2 p-2 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 min-w-0">
        <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
        <span className="text-sm font-semibold text-primary truncate">{label}</span>
        {detail && (
          <span className="text-xs text-muted-foreground">({detail})</span>
        )}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {hasSharpSignal && (
          <>
            <Zap className="h-3.5 w-3.5 text-primary" />
            <Badge variant="outline" className={`text-xs ${sharpGrade.color}`}>
              {bet.sharp_score}
            </Badge>
          </>
        )}
      </div>
    </div>
  );
}
