import { useState } from "react";
import { cn } from "@/lib/utils";
import { FeedCard } from "@/components/FeedCard";
import { ActivityPulse } from "./ActivityPulse";
import { NewsItemRow } from "./NewsItemRow";
import { ChevronDown, ChevronUp } from "lucide-react";
import { format } from "date-fns";
import type { GameWithNews, NewsItem } from "@/hooks/useGameNewsStream";

interface GameNewsCardProps {
  game: GameWithNews;
  defaultExpanded?: boolean;
  onNewsClick?: (item: NewsItem) => void;
}

const SPORT_ICONS: Record<string, string> = {
  nfl: '🏈',
  americanfootball_nfl: '🏈',
  football_nfl: '🏈',
  nhl: '🏒',
  icehockey_nhl: '🏒',
  hockey_nhl: '🏒',
  nba: '🏀',
  basketball_nba: '🏀',
};

function getSportIcon(sport: string): string {
  const normalizedSport = sport.toLowerCase();
  for (const [key, icon] of Object.entries(SPORT_ICONS)) {
    if (normalizedSport.includes(key)) return icon;
  }
  return '🎯';
}

function getActivityLevel(score: number): 'quiet' | 'active' | 'hot' {
  if (score >= 8) return 'hot';
  if (score >= 3) return 'active';
  return 'quiet';
}

export function GameNewsCard({ game, defaultExpanded = false, onNewsClick }: GameNewsCardProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded || game.activity_score >= 5);
  
  const activityLevel = getActivityLevel(game.activity_score);
  const sportIcon = getSportIcon(game.sport);
  const gameTime = format(new Date(game.commence_time), 'h:mm a');
  const visibleNews = isExpanded ? game.news : game.news.slice(0, 3);
  const hiddenCount = game.news.length - 3;

  return (
    <FeedCard 
      variant="glass" 
      className={cn(
        "transition-all duration-300",
        activityLevel === 'hot' && "ring-1 ring-neon-green/30"
      )}
    >
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between gap-3 p-1"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-xl shrink-0">{sportIcon}</span>
          <div className="min-w-0 text-left">
            <p className="font-semibold text-sm truncate">
              {game.away_team} @ {game.home_team}
            </p>
            <p className="text-xs text-muted-foreground">{gameTime}</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2 shrink-0">
          <ActivityPulse level={activityLevel} />
          {game.news.length > 3 && (
            isExpanded ? (
              <ChevronUp className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            )
          )}
        </div>
      </button>

      {/* News Stack */}
      {game.news.length > 0 ? (
        <div className="mt-3 -mx-1 border-t border-border/50 pt-2">
          <div className="space-y-1">
            {visibleNews.map((item) => (
              <NewsItemRow 
                key={item.id} 
                item={item} 
                onClick={() => onNewsClick?.(item)}
              />
            ))}
          </div>
          
          {!isExpanded && hiddenCount > 0 && (
            <button
              onClick={() => setIsExpanded(true)}
              className="w-full text-center py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              +{hiddenCount} more updates
            </button>
          )}
        </div>
      ) : (
        <div className="mt-3 text-center py-4 text-xs text-muted-foreground border-t border-border/50">
          No updates yet
        </div>
      )}
    </FeedCard>
  );
}
