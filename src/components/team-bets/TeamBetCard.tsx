import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  Target,
  Zap,
  Clock,
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
  composite_score: number | null;
  score_breakdown: Record<string, number | string> | null;
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
    'icehockey_nhl': '🏒',
    'americanfootball_nfl': '🏈',
    'basketball_ncaab': '🎓',
    'americanfootball_ncaaf': '🏈',
  };
  return map[sport] || '🎯';
}

function getSportDisplay(sport: string): string {
  const map: Record<string, string> = {
    'basketball_nba': 'NBA',
    'hockey_nhl': 'NHL',
    'icehockey_nhl': 'NHL',
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

function getScoreColor(score: number | null): string {
  if (!score) return 'text-muted-foreground';
  if (score >= 75) return 'text-green-500';
  if (score >= 65) return 'text-yellow-500';
  return 'text-muted-foreground';
}

function getScoreBorderClass(score: number | null): string {
  if (!score) return '';
  if (score >= 75) return 'border-green-500/30 bg-green-500/5';
  if (score >= 65) return 'border-yellow-500/30 bg-yellow-500/5';
  return '';
}

/** Extract top 2-3 human-readable breakdown labels */
function getBreakdownPills(breakdown: Record<string, number | string> | null): string[] {
  if (!breakdown) return [];
  const pills: string[] = [];
  
  // Priority: labels first (human-readable), then numeric factors
  const labelKeys = Object.keys(breakdown).filter(k => k.endsWith('_label'));
  for (const key of labelKeys) {
    pills.push(String(breakdown[key]));
    if (pills.length >= 3) return pills;
  }

  // Add numeric factor descriptions
  const factorMap: Record<string, string> = {
    efficiency_edge: 'Efficiency edge',
    tempo_fast: 'Fast tempo',
    tempo_slow: 'Slow tempo',
    home_court: 'Home court',
    home_ice: 'Home ice',
    elite_rank: 'Elite rank',
    top50_rank: 'Top 50',
    ats_record: 'ATS trend',
    rank_mismatch: 'Rank mismatch',
    rank_edge: 'Rank edge',
    shot_differential: 'Shot differential',
    goaltending: 'Goaltending edge',
    high_scoring: 'High scoring',
    strong_defense: 'Strong defense',
    sharp_confirmation: 'Sharp money',
    sharp_signal: 'Sharp signal',
  };

  for (const [key, label] of Object.entries(factorMap)) {
    if (breakdown[key] && typeof breakdown[key] === 'number' && (breakdown[key] as number) > 0) {
      pills.push(`${label}: +${breakdown[key]}`);
      if (pills.length >= 3) return pills;
    }
  }

  return pills;
}

export function TeamBetCard({ bet }: TeamBetCardProps) {
  const betTypeInfo = getBetTypeDisplay(bet.bet_type);
  const BetIcon = betTypeInfo.icon;
  const displayScore = bet.composite_score ?? bet.sharp_score;
  const hasStrongSignal = (displayScore || 0) >= 62;
  const hasRecommendation = !!bet.recommended_side;
  const breakdownPills = getBreakdownPills(bet.score_breakdown);
  
  const gameTime = new Date(bet.commence_time);
  const isToday = new Date().toDateString() === gameTime.toDateString();
  
  return (
    <Card className={`transition-all ${hasStrongSignal ? getScoreBorderClass(displayScore) : ''}`}>
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
              {displayScore && (
                <Badge variant="outline" className={`text-xs font-bold ${getScoreColor(displayScore)}`}>
                  {Math.round(displayScore)}
                </Badge>
              )}
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

            {/* Breakdown Pills */}
            {breakdownPills.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {breakdownPills.map((pill, i) => (
                  <Badge key={i} variant="secondary" className="text-[10px] font-normal py-0 px-1.5">
                    {pill}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Right: Line & Odds */}
          <TeamBetOddsDisplay bet={bet} />
        </div>

        {/* Sharp Signal Sources */}
        {hasStrongSignal && bet.signal_sources && bet.signal_sources.length > 0 && (
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
