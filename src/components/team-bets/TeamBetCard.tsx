import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  Target,
  Zap,
  Clock,
  ArrowUp,
  ArrowDown,
  CheckCircle2
} from 'lucide-react';
import { format } from 'date-fns';
import { TeamBetOddsDisplay } from './TeamBetOddsDisplay';
import { TeamBetPickBanner } from './TeamBetPickBanner';

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
      return { label: 'Spread', icon: Target };
    case 'total':
      return { label: 'Total', icon: Target };
    case 'h2h':
      return { label: 'Moneyline', icon: Zap };
    default:
      return { label: betType, icon: Target };
  }
}

export function TeamBetCard({ bet }: TeamBetCardProps) {
  const betTypeInfo = getBetTypeDisplay(bet.bet_type);
  const BetIcon = betTypeInfo.icon;
  const hasSharpSignal = (bet.sharp_score || 0) >= 50;
  const hasRecommendation = !!bet.recommended_side;
  
  const gameTime = new Date(bet.commence_time);
  const isToday = new Date().toDateString() === gameTime.toDateString();
  
  return (
    <Card className={`transition-all ${hasSharpSignal ? 'border-primary/30 bg-primary/5' : ''}`}>
      <CardContent className="p-3">
        {/* Recommended Pick Banner */}
        {hasRecommendation && (
          <TeamBetPickBanner bet={bet} />
        )}

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
          <TeamBetOddsDisplay bet={bet} />
        </div>

        {/* Sharp Signal Sources */}
        {hasSharpSignal && bet.signal_sources && bet.signal_sources.length > 0 && (
          <div className="mt-2 pt-2 border-t border-border/50">
            <div className="flex flex-wrap gap-1">
              {(bet.signal_sources as string[]).map((source, i) => (
                <Badge key={i} variant="secondary" className="text-xs">
                  {source}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
