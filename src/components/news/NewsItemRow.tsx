import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";
import type { NewsItem } from "@/hooks/useGameNewsStream";

interface NewsItemRowProps {
  item: NewsItem;
  onClick?: () => void;
}

const NEWS_TYPE_CONFIG: Record<string, { icon: string; label: string; className: string }> = {
  injury: { 
    icon: '🚨', 
    label: 'Injury', 
    className: 'bg-neon-red/20 text-neon-red border-neon-red/30' 
  },
  lineup: { 
    icon: '📋', 
    label: 'Lineup', 
    className: 'bg-primary/20 text-primary border-primary/30' 
  },
  market_move: { 
    icon: '📈', 
    label: 'Market', 
    className: 'bg-neon-green/20 text-neon-green border-neon-green/30' 
  },
  weather: { 
    icon: '🌧️', 
    label: 'Weather', 
    className: 'bg-neon-cyan/20 text-neon-cyan border-neon-cyan/30' 
  },
  sharp_action: { 
    icon: '⚡', 
    label: 'Sharp', 
    className: 'bg-neon-yellow/20 text-neon-yellow border-neon-yellow/30' 
  },
  trap_alert: { 
    icon: '🚫', 
    label: 'Trap', 
    className: 'bg-neon-orange/20 text-neon-orange border-neon-orange/30' 
  },
  upset_signal: { 
    icon: '🎲', 
    label: 'Upset', 
    className: 'bg-neon-purple/20 text-neon-purple border-neon-purple/30' 
  },
};

export function NewsItemRow({ item, onClick }: NewsItemRowProps) {
  const config = NEWS_TYPE_CONFIG[item.news_type] || NEWS_TYPE_CONFIG.market_move;
  
  const timeAgo = formatDistanceToNow(new Date(item.created_at), { addSuffix: false });
  const displayTime = timeAgo.includes('less than') ? 'Just now' : `${timeAgo} ago`;

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-3 py-2 rounded-lg transition-all duration-200",
        "hover:bg-muted/50 active:scale-[0.99]",
        item.isNew && "bg-neon-green/5 animate-pulse"
      )}
    >
      <div className="flex items-start gap-2">
        <span className="text-sm shrink-0">{config.icon}</span>
        <div className="flex-1 min-w-0">
          <p className={cn(
            "text-sm leading-tight",
            item.impact_level === 'high' ? "text-foreground font-medium" : "text-muted-foreground"
          )}>
            {item.headline}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <Badge 
              variant="outline" 
              className={cn("text-[10px] px-1.5 py-0 h-4 border", config.className)}
            >
              {config.label}
            </Badge>
            {item.market_impact && (
              <Badge 
                variant="outline" 
                className="text-[10px] px-1.5 py-0 h-4 border bg-destructive/20 text-destructive border-destructive/30"
              >
                Market Impact
              </Badge>
            )}
            <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
              {displayTime}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}
