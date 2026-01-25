import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Check, TrendingUp, TrendingDown } from "lucide-react";
import type { ManualProp, DefenseGrade, PropProjection } from "@/hooks/useManualBuilder";

interface PropSelectionCardProps {
  prop: ManualProp;
  defense: DefenseGrade | null;
  projection: PropProjection | null;
  isSelected: boolean;
  selectedSide: "over" | "under" | null;
  onSelect: (prop: ManualProp, side: "over" | "under") => void;
  onDeselect: (propId: string) => void;
}

function formatPropType(propType: string): string {
  return propType
    .replace("player_", "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatOdds(odds: number | null): string {
  if (!odds) return "—";
  return odds > 0 ? `+${odds}` : `${odds}`;
}

function getGradeColor(grade: string): string {
  switch (grade) {
    case "A": return "text-destructive";
    case "B": return "text-warning";
    case "C": return "text-yellow-500";
    case "D": return "text-primary";
    case "F": return "text-accent";
    default: return "text-muted-foreground";
  }
}

export function PropSelectionCard({
  prop,
  defense,
  projection,
  isSelected,
  selectedSide,
  onSelect,
  onDeselect,
}: PropSelectionCardProps) {
  const [hoveredSide, setHoveredSide] = useState<"over" | "under" | null>(null);

  const handleSideClick = (side: "over" | "under") => {
    if (isSelected && selectedSide === side) {
      onDeselect(prop.id);
    } else {
      onSelect(prop, side);
    }
  };

  // Calculate edge from projection
  const edge = projection?.projected_value 
    ? projection.projected_value - prop.current_line 
    : null;

  const edgeColor = edge === null ? "text-muted-foreground" :
                    edge >= 2 ? "text-green-500" :
                    edge >= 0 ? "text-yellow-500" :
                    "text-red-500";

  // Determine recommended side
  const isRecommendedOver = projection?.recommended_side?.toLowerCase() === 'over';
  const isRecommendedUnder = projection?.recommended_side?.toLowerCase() === 'under';

  return (
    <Card
      className={cn(
        "p-3 transition-all duration-200 border",
        isSelected
          ? "border-primary bg-primary/5"
          : "border-border hover:border-primary/50"
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate">{prop.player_name}</p>
          <p className="text-xs text-muted-foreground truncate">
            {prop.game_description}
          </p>
        </div>
        {isSelected && (
          <Badge variant="default" className="ml-2 shrink-0">
            <Check className="w-3 h-3 mr-1" />
            {selectedSide?.toUpperCase()}
          </Badge>
        )}
      </div>

      {/* Prop Line + Projection */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <span className="text-xs text-muted-foreground">
            {formatPropType(prop.prop_type)}
          </span>
          <p className="text-lg font-bold">{prop.current_line}</p>
          {/* Projection display */}
          {projection?.projected_value && (
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-muted-foreground">
                Proj: <span className="text-foreground font-medium">{projection.projected_value.toFixed(1)}</span>
              </span>
              {edge !== null && (
                <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", edgeColor)}>
                  {edge >= 0 ? '+' : ''}{edge.toFixed(1)}
                </Badge>
              )}
            </div>
          )}
        </div>

        {/* Defense Grade + Recommended Side */}
        <div className="text-right">
          {projection?.recommended_side && (
            <Badge 
              variant="outline" 
              className={cn(
                "text-[10px] mb-1",
                isRecommendedOver 
                  ? "border-green-500/50 text-green-500"
                  : "border-red-500/50 text-red-500"
              )}
            >
              {projection.recommended_side.toUpperCase()}
            </Badge>
          )}
          {defense && (
            <p className={cn("text-lg font-bold", getGradeColor(defense.grade))}>
              {defense.grade}
              <span className="text-xs text-muted-foreground ml-1">
                #{defense.rank}
              </span>
            </p>
          )}
        </div>
      </div>

      {/* Over/Under Buttons */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => handleSideClick("over")}
          onMouseEnter={() => setHoveredSide("over")}
          onMouseLeave={() => setHoveredSide(null)}
          className={cn(
            "flex items-center justify-center gap-1 py-2 px-3 rounded-md text-sm font-medium transition-all",
            isSelected && selectedSide === "over"
              ? "bg-accent/20 text-accent border border-accent"
              : isRecommendedOver && !isSelected
              ? "bg-green-500/10 text-green-500 border border-green-500/30"
              : hoveredSide === "over"
              ? "bg-accent/10 text-accent"
              : "bg-muted hover:bg-muted/80"
          )}
        >
          <TrendingUp className="w-3 h-3" />
          O {formatOdds(prop.over_price)}
        </button>
        <button
          onClick={() => handleSideClick("under")}
          onMouseEnter={() => setHoveredSide("under")}
          onMouseLeave={() => setHoveredSide(null)}
          className={cn(
            "flex items-center justify-center gap-1 py-2 px-3 rounded-md text-sm font-medium transition-all",
            isSelected && selectedSide === "under"
              ? "bg-destructive/20 text-destructive border border-destructive"
              : isRecommendedUnder && !isSelected
              ? "bg-red-500/10 text-red-500 border border-red-500/30"
              : hoveredSide === "under"
              ? "bg-destructive/10 text-destructive"
              : "bg-muted hover:bg-muted/80"
          )}
        >
          <TrendingDown className="w-3 h-3" />
          U {formatOdds(prop.under_price)}
        </button>
      </div>
    </Card>
  );
}
