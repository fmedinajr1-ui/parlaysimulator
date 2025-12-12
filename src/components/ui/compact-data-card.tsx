import * as React from "react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { ChevronDown } from "lucide-react";

export interface DataItem {
  id: string;
  icon: React.ReactNode;
  label: string;
  value: string;
  status?: 'positive' | 'negative' | 'neutral' | 'none';
  colorClass?: string;
  detail?: string;
  confidence?: number;
}

interface CompactDataCardProps {
  title: string;
  icon: React.ReactNode;
  data: DataItem[];
  variant?: 'full' | 'compact' | 'mini';
  accentColor?: string;
  headerValue?: string;
  headerValueClass?: string;
  onItemTap?: (item: DataItem) => void;
  className?: string;
  maxItemsCompact?: number;
}

const getStatusStyle = (status: DataItem['status']) => {
  switch (status) {
    case 'positive':
      return 'bg-neon-green/10 border-neon-green/30 text-neon-green';
    case 'negative':
      return 'bg-neon-red/10 border-neon-red/30 text-neon-red';
    case 'neutral':
      return 'bg-muted/30 border-muted-foreground/20 text-muted-foreground';
    case 'none':
    default:
      return 'bg-muted/10 border-muted-foreground/10 text-muted-foreground/50';
  }
};

const getStatusIndicator = (status: DataItem['status']) => {
  switch (status) {
    case 'positive':
      return <span className="w-1.5 h-1.5 rounded-full bg-neon-green" />;
    case 'negative':
      return <span className="w-1.5 h-1.5 rounded-full bg-neon-red" />;
    case 'neutral':
      return <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50" />;
    default:
      return null;
  }
};

export function CompactDataCard({
  title,
  icon,
  data,
  variant: propVariant,
  accentColor = 'primary',
  headerValue,
  headerValueClass,
  onItemTap,
  className,
  maxItemsCompact = 4,
}: CompactDataCardProps) {
  const isMobile = useIsMobile();
  const [isExpanded, setIsExpanded] = React.useState(false);
  
  // Auto-detect variant based on screen size
  const variant = propVariant || (isMobile ? 'compact' : 'full');
  
  const visibleData = variant === 'compact' && !isExpanded 
    ? data.slice(0, maxItemsCompact) 
    : data;
  
  const hasMore = data.length > maxItemsCompact;

  if (variant === 'mini') {
    return (
      <div className={cn(
        "inline-flex items-center gap-1.5 px-2 py-1 rounded-full",
        "bg-card/80 border border-border/30 text-xs",
        className
      )}>
        <span className={cn("font-semibold", headerValueClass)}>{headerValue}</span>
        <div className="flex items-center gap-0.5">
          {data.slice(0, 5).map((item) => (
            <span key={item.id} className="flex items-center">
              {getStatusIndicator(item.status)}
            </span>
          ))}
        </div>
        {data.length > 5 && (
          <span className="text-muted-foreground">+{data.length - 5}</span>
        )}
      </div>
    );
  }

  return (
    <div className={cn(
      "rounded-lg border border-border/50 bg-gradient-to-br from-card/80 to-card overflow-hidden",
      className
    )}>
      {/* Header */}
      <div className={cn(
        "px-3 py-2 sm:px-4 sm:py-3 flex items-center justify-between",
        `bg-${accentColor}/10`
      )}>
        <div className="flex items-center gap-2">
          <div className={cn("p-1 sm:p-1.5 rounded-md", `bg-${accentColor}/20`)}>
            {icon}
          </div>
          <span className="text-xs sm:text-sm font-semibold text-foreground uppercase tracking-wide">
            {title}
          </span>
        </div>
        {headerValue && (
          <span className={cn("text-base sm:text-lg font-bold", headerValueClass)}>
            {headerValue}
          </span>
        )}
      </div>

      {/* Content Grid */}
      <div className="p-3 sm:p-4">
        <div className={cn(
          "grid gap-2",
          variant === 'compact' ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-4"
        )}>
          {visibleData.map((item) => (
            <button
              key={item.id}
              onClick={() => onItemTap?.(item)}
              className={cn(
                "flex flex-col items-center p-2 rounded-lg border transition-all",
                "touch-target active:scale-95",
                getStatusStyle(item.status),
                onItemTap && "cursor-pointer hover:bg-white/5"
              )}
            >
              <div className="flex items-center gap-1 mb-1">
                {getStatusIndicator(item.status)}
              </div>
              <div className={cn("h-4 w-4 mb-1", item.colorClass)}>
                {item.icon}
              </div>
              <span className="text-[9px] sm:text-[10px] font-medium text-muted-foreground truncate max-w-full">
                {item.label}
              </span>
              <span className="text-xs sm:text-sm font-semibold text-foreground">
                {item.value}
              </span>
            </button>
          ))}
        </div>

        {/* Show More Button */}
        {variant === 'compact' && hasMore && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className={cn(
              "w-full mt-3 py-2 flex items-center justify-center gap-1",
              "text-xs text-muted-foreground hover:text-foreground",
              "border border-dashed border-border/50 rounded-lg",
              "transition-all active:scale-98"
            )}
          >
            <span>{isExpanded ? 'Show less' : `Show all ${data.length}`}</span>
            <ChevronDown className={cn(
              "h-3 w-3 transition-transform",
              isExpanded && "rotate-180"
            )} />
          </button>
        )}
      </div>
    </div>
  );
}
