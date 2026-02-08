import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  TrendingUp, 
  TrendingDown,
  Target,
  Zap,
  Clock,
  ArrowUp,
  ArrowDown
} from 'lucide-react';
import { format } from 'date-fns';

interface GameBet {
  id: string;
  game_id: string;
  sport: string;
  bet_type: string;
  home_team: string;
  away_team: string;
  line: number | null;
  home_odds: number | null;
  away_odds: number | null;
  over_odds: number | null;
  under_odds: number | null;
  bookmaker: string;
  commence_time: string;
  sharp_score: number | null;
  recommended_side: string | null;
  signal_sources: string[] | null;
  is_active: boolean;
  outcome: string | null;
}

interface TeamBetCardProps {
  bet: GameBet;
}

function getSportEmoji(sport: string): string {
  const map: Record<string, string> = {
    'basketball_nba': '🏀',
    'hockey_nhl': '🏒',
    'americanfootball_nfl': '🏈',
    'basketball_ncaab': '🏀',
    'americanfootball_ncaaf': '🏈',
  };
  return map[sport] || '🎯';
}

function getSportDisplay(sport: string): string {
  const map: Record<string, string> = {
    'basketball_nba': 'NBA',
    'hockey_nhl': 'NHL',
    'americanfootball_nfl': 'NFL',
    'basketball_ncaab': 'NCAAB',
    'americanfootball_ncaaf': 'NCAAF',
  };
  return map[sport] || sport.toUpperCase();
}

function getBetTypeDisplay(betType: string): { label: string; icon: typeof Target } {
  switch (betType) {
    case 'spread':
      return { label: 'Spread', icon: TrendingUp };
    case 'total':
      return { label: 'Total', icon: Target };
    case 'h2h':
      return { label: 'Moneyline', icon: Zap };
    default:
      return { label: betType, icon: Target };
  }
}

function formatOdds(odds: number | null): string {
  if (odds === null) return '-';
  return odds > 0 ? `+${odds}` : `${odds}`;
}

function getSharpGrade(score: number | null): { grade: string; color: string } {
  if (!score) return { grade: '-', color: 'text-muted-foreground' };
  if (score >= 80) return { grade: 'A', color: 'text-green-500' };
  if (score >= 65) return { grade: 'B', color: 'text-blue-500' };
  if (score >= 50) return { grade: 'C', color: 'text-yellow-500' };
  return { grade: 'D', color: 'text-muted-foreground' };
}

export function TeamBetCard({ bet }: TeamBetCardProps) {
  const betTypeInfo = getBetTypeDisplay(bet.bet_type);
  const BetIcon = betTypeInfo.icon;
  const sharpGrade = getSharpGrade(bet.sharp_score);
  const hasSharpSignal = (bet.sharp_score || 0) >= 50;
  
  const gameTime = new Date(bet.commence_time);
  const isToday = new Date().toDateString() === gameTime.toDateString();
  
  return (
    <Card className={`transition-all ${hasSharpSignal ? 'border-primary/30 bg-primary/5' : ''}`}>
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-2">
          {/* Left: Game Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg">{getSportEmoji(bet.sport)}</span>
              <Badge variant="outline" className="text-xs">
                {getSportDisplay(bet.sport)}
              </Badge>
              <Badge variant="secondary" className="text-xs gap-1">
                <BetIcon className="h-3 w-3" />
                {betTypeInfo.label}
              </Badge>
            </div>
            
            <div className="font-medium text-sm">
              {bet.away_team} @ {bet.home_team}
            </div>
            
            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
              <Clock className="h-3 w-3" />
              {isToday ? format(gameTime, 'h:mm a') : format(gameTime, 'MMM d, h:mm a')}
              <span className="text-muted-foreground/50">•</span>
              <span className="capitalize">{bet.bookmaker}</span>
            </div>
          </div>

          {/* Right: Line & Odds */}
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
        </div>

        {/* Sharp Signal */}
        {hasSharpSignal && (
          <div className="mt-2 pt-2 border-t border-border/50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-primary" />
                <span className="text-xs font-medium text-primary">Sharp Signal</span>
                <Badge variant="outline" className={`text-xs ${sharpGrade.color}`}>
                  Grade {sharpGrade.grade}
                </Badge>
              </div>
              <Badge variant="default" className="text-xs">
                {bet.recommended_side}
              </Badge>
            </div>
            {bet.signal_sources && bet.signal_sources.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {(bet.signal_sources as string[]).map((source, i) => (
                  <Badge key={i} variant="secondary" className="text-xs">
                    {source}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
