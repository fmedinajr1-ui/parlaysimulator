import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import { Loader2 } from "lucide-react";

interface EngineStatusCardProps {
  title: string;
  icon: React.ReactNode;
  isActive: boolean;
  isRunning?: boolean;
  lastRun: string | null;
  stats: Array<{ label: string; value: string | number }>;
  details?: React.ReactNode;
  actions: Array<{ label: string; onClick: () => void; variant?: "default" | "outline" }>;
}

export function EngineStatusCard({
  title,
  icon,
  isActive,
  isRunning = false,
  lastRun,
  stats,
  details,
  actions,
}: EngineStatusCardProps) {
  const getStatusColor = () => {
    if (isRunning) return "bg-blue-500";
    if (isActive) return "bg-emerald-500";
    return "bg-red-500";
  };

  const getStatusText = () => {
    if (isRunning) return "RUNNING";
    if (isActive) return "ACTIVE";
    return "INACTIVE";
  };

  return (
    <div className="relative overflow-hidden rounded-2xl bg-card border border-border/50 p-4">
      {/* Status indicator glow */}
      <div className={cn(
        "absolute top-0 left-0 right-0 h-1",
        getStatusColor()
      )} />
      
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-muted">
            {icon}
          </div>
          <div>
            <h3 className="font-semibold text-foreground">{title}</h3>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={cn(
                "inline-flex items-center gap-1.5 text-xs font-medium",
                isRunning ? "text-blue-400" : isActive ? "text-emerald-400" : "text-red-400"
              )}>
                <span className={cn(
                  "w-2 h-2 rounded-full",
                  getStatusColor(),
                  (isActive || isRunning) && "animate-pulse"
                )} />
                {getStatusText()}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Last Run */}
      <div className="text-xs text-muted-foreground mb-3">
        Last Run: {lastRun 
          ? formatDistanceToNow(new Date(lastRun), { addSuffix: true })
          : "Never"
        }
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        {stats.map((stat, idx) => (
          <div key={idx} className="bg-muted/50 rounded-lg p-2.5">
            <div className="text-lg font-bold text-foreground">{stat.value}</div>
            <div className="text-xs text-muted-foreground">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Additional Details */}
      {details && (
        <div className="mb-4 text-sm">
          {details}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        {actions.map((action, idx) => (
          <Button
            key={idx}
            variant={action.variant || "default"}
            size="sm"
            onClick={action.onClick}
            disabled={isRunning}
            className="flex-1"
          >
            {isRunning && idx === 0 ? (
              <>
                <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                Running...
              </>
            ) : (
              action.label
            )}
          </Button>
        ))}
      </div>
    </div>
  );
}
