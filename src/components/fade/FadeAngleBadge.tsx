import { AlertOctagon, Flame, AlertTriangle, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { FadeAngle } from "@/hooks/useFadeAngles";
import { pickTopFadeAngle } from "@/hooks/useFadeAngles";

interface FadeAngleBadgeProps {
  angles: FadeAngle[];
  compact?: boolean;
  className?: string;
}

const statusStyle: Record<string, string> = {
  OUT: "bg-red-500/20 text-red-400 border-red-500/40",
  DOUBTFUL: "bg-orange-500/20 text-orange-400 border-orange-500/40",
  QUESTIONABLE: "bg-yellow-500/20 text-yellow-400 border-yellow-500/40",
  GTD: "bg-yellow-500/20 text-yellow-400 border-yellow-500/40",
  "DAY-TO-DAY": "bg-amber-500/20 text-amber-400 border-amber-500/40",
  MINUTES_RISK: "bg-amber-500/20 text-amber-400 border-amber-500/40",
  NEWS: "bg-cyan-500/20 text-cyan-400 border-cyan-500/40",
};

function iconFor(status: string) {
  if (status === "OUT") return AlertOctagon;
  if (status === "DOUBTFUL" || status === "QUESTIONABLE") return AlertTriangle;
  if (status === "NEWS") return Info;
  return AlertTriangle;
}

export function FadeAngleBadge({ angles, compact = true, className }: FadeAngleBadgeProps) {
  if (!angles || angles.length === 0) return null;
  const top = pickTopFadeAngle(angles);
  if (!top) return null;

  const Icon = top.exploit ? Flame : iconFor(top.status);
  const label = top.exploit
    ? top.exploit.kind === "stale_line"
      ? "FADE: STALE LINE"
      : top.exploit.kind === "usage_shift"
        ? "FADE: USAGE SHIFT"
        : "FADE: EXPLOIT"
    : `FADE: ${top.status}`;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            data-testid="fade-angle-badge"
            variant="outline"
            className={cn(
              "gap-1 cursor-help",
              compact ? "text-[9px] px-1.5 py-0" : "text-xs px-2 py-0.5",
              top.exploit
                ? "bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/40"
                : statusStyle[top.status] || statusStyle.NEWS,
              className,
            )}
          >
            <Icon className={compact ? "w-2.5 h-2.5" : "w-3 h-3"} />
            {label}
            {angles.length > 1 && (
              <span className="opacity-70">+{angles.length - 1}</span>
            )}
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs space-y-2">
          {angles.slice(0, 4).map((a, i) => (
            <div key={i} className="space-y-0.5">
              <p className="text-xs font-semibold">
                {a.player || a.team || "Unknown"}{" "}
                <span className="opacity-70">— {a.status}</span>
              </p>
              {a.team && a.player && (
                <p className="text-[10px] text-muted-foreground">{a.team}</p>
              )}
              <p className="text-[11px]">{a.detail}</p>
              {a.exploit && (
                <p className="text-[11px] text-fuchsia-300">
                  🔥 {a.exploit.note}
                </p>
              )}
            </div>
          ))}
          {angles.length > 4 && (
            <p className="text-[10px] text-muted-foreground">
              +{angles.length - 4} more…
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}