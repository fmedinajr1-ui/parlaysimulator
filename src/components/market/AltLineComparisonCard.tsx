import { AlertTriangle, TrendingDown, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface AltLineComparisonCardProps {
  playerName: string;
  propType: string;
  currentLine: number;
  side: string;
  altLineRecommendation: number;
  altLineReason: string | null;
  isJuiced: boolean;
  juiceMagnitude?: number;
  lineWarning?: string | null;
}

export function AltLineComparisonCard({
  playerName,
  propType,
  currentLine,
  side,
  altLineRecommendation,
  altLineReason,
  isJuiced,
  juiceMagnitude,
  lineWarning,
}: AltLineComparisonCardProps) {
  const formatPropType = (type: string) =>
    type
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());

  const sideUpper = side.toUpperCase();

  return (
    <div className="mt-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
      <div className="flex items-center gap-2 text-xs mb-2">
        <AlertTriangle className="w-4 h-4 text-amber-400" />
        <span className="text-amber-400 font-medium">Alt Line Recommended</span>
        {isJuiced && (
          <Badge variant="destructive" className="text-xs ml-auto">
            Juiced {juiceMagnitude && `${juiceMagnitude}`}
          </Badge>
        )}
      </div>

      <p className="text-xs text-muted-foreground mb-3">{formatPropType(propType)}</p>

      <div className="grid grid-cols-[1fr,auto,1fr] gap-2 items-center">
        {/* Current Line */}
        <div className={cn(
          "text-center p-2 rounded-lg bg-muted/30 border",
          isJuiced ? "border-red-500/30" : "border-border/50"
        )}>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Current</p>
          <p className={cn(
            "text-lg font-bold",
            isJuiced ? "text-red-400" : "text-foreground"
          )}>
            {sideUpper} {currentLine}
          </p>
          {isJuiced && (
            <div className="flex items-center justify-center gap-1 mt-1">
              <TrendingDown className="w-3 h-3 text-red-400" />
              <span className="text-[10px] text-red-400">Bad Value</span>
            </div>
          )}
        </div>

        {/* Arrow */}
        <ArrowRight className="w-5 h-5 text-muted-foreground" />

        {/* Recommended Alt Line */}
        <div className="text-center p-2 rounded-lg bg-green-500/10 border border-green-500/30">
          <p className="text-[10px] text-green-400 uppercase tracking-wide mb-1">Recommended</p>
          <p className="text-lg font-bold text-green-400">
            {sideUpper} {altLineRecommendation}
          </p>
          <Badge variant="outline" className="text-[10px] mt-1 text-green-400 border-green-500/30">
            Better Value
          </Badge>
        </div>
      </div>

      {(altLineReason || lineWarning) && (
        <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
          {altLineReason || lineWarning}
        </p>
      )}
    </div>
  );
}
