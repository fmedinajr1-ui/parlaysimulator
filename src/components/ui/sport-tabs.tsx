import { cn } from "@/lib/utils";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";

interface SportTab {
  id: string;
  label: string;
  icon?: string;
  count?: number;
}

interface SportTabsProps {
  tabs: SportTab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  className?: string;
}

const sportIcons: Record<string, string> = {
  all: "🎯",
  nfl: "🏈",
  nba: "🏀",
  mlb: "⚾",
  nhl: "🏒",
  ncaaf: "🏈",
  ncaab: "🏀",
  soccer: "⚽",
  mma: "🥊",
  tennis: "🎾",
  golf: "⛳",
};

export function SportTabs({ tabs, activeTab, onTabChange, className }: SportTabsProps) {
  return (
    <ScrollArea className={cn("w-full", className)}>
      <div className="flex gap-2 pb-2 px-1">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          const icon = tab.icon || sportIcons[tab.id.toLowerCase()] || "📊";
          
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 rounded-full whitespace-nowrap",
                "text-sm font-medium transition-all duration-200",
                "touch-target active:scale-95",
                isActive 
                  ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20" 
                  : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <span className="text-base">{icon}</span>
              <span>{tab.label}</span>
              {tab.count !== undefined && tab.count > 0 && (
                <span className={cn(
                  "px-1.5 py-0.5 rounded-full text-xs font-bold",
                  isActive 
                    ? "bg-primary-foreground/20 text-primary-foreground" 
                    : "bg-muted text-muted-foreground"
                )}>
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <ScrollBar orientation="horizontal" className="hidden" />
    </ScrollArea>
  );
}

interface QuickFilterProps {
  label: string;
  active: boolean;
  onClick: () => void;
  icon?: string;
  variant?: 'default' | 'success' | 'danger' | 'warning';
}

export function QuickFilter({ label, active, onClick, icon, variant = 'default' }: QuickFilterProps) {
  const variantColors = {
    default: active ? "bg-primary text-primary-foreground" : "bg-muted/50 text-muted-foreground",
    success: active ? "bg-neon-green/20 text-neon-green border border-neon-green/30" : "bg-muted/50 text-muted-foreground",
    danger: active ? "bg-neon-red/20 text-neon-red border border-neon-red/30" : "bg-muted/50 text-muted-foreground",
    warning: active ? "bg-neon-yellow/20 text-neon-yellow border border-neon-yellow/30" : "bg-muted/50 text-muted-foreground",
  };

  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 px-3 py-2 rounded-full whitespace-nowrap",
        "text-xs font-medium transition-all duration-200",
        "active:scale-95",
        variantColors[variant]
      )}
    >
      {icon && <span>{icon}</span>}
      <span>{label}</span>
    </button>
  );
}
