import { cn } from "@/lib/utils";

interface ActivityPulseProps {
  level: 'quiet' | 'active' | 'hot';
  className?: string;
}

export function ActivityPulse({ level, className }: ActivityPulseProps) {
  const dots = level === 'quiet' ? 1 : level === 'active' ? 2 : 3;
  
  return (
    <div className={cn("flex items-center gap-0.5", className)}>
      {Array.from({ length: 3 }).map((_, i) => (
        <span
          key={i}
          className={cn(
            "w-1.5 h-1.5 rounded-full transition-all duration-300",
            i < dots
              ? level === 'hot'
                ? "bg-neon-green animate-pulse"
                : level === 'active'
                ? "bg-neon-yellow"
                : "bg-muted-foreground"
              : "bg-muted/50"
          )}
        />
      ))}
      {level === 'hot' && (
        <span className="ml-1 text-[10px] font-bold text-neon-green uppercase tracking-wider">
          HOT
        </span>
      )}
    </div>
  );
}
