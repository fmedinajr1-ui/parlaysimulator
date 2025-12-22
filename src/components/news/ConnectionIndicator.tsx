import { cn } from "@/lib/utils";
import { Radio } from "lucide-react";

interface ConnectionIndicatorProps {
  isConnected: boolean;
  className?: string;
}

export function ConnectionIndicator({ isConnected, className }: ConnectionIndicatorProps) {
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <Radio 
        className={cn(
          "w-3.5 h-3.5 transition-colors",
          isConnected ? "text-neon-green animate-pulse" : "text-muted-foreground"
        )} 
      />
      <span className={cn(
        "text-xs",
        isConnected ? "text-neon-green" : "text-muted-foreground"
      )}>
        {isConnected ? "LIVE" : "Connecting..."}
      </span>
    </div>
  );
}
