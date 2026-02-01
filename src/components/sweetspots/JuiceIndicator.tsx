import { DollarSign, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { JuiceAnalysis } from "@/types/sweetSpot";

interface JuiceIndicatorProps {
  juice: JuiceAnalysis;
  compact?: boolean;
}

export function JuiceIndicator({ juice, compact = false }: JuiceIndicatorProps) {
  const formatPrice = (price: number) => {
    if (price >= 0) return `+${price}`;
    return price.toString();
  };
  
  const getColorClass = () => {
    if (juice.isValuePlay) return 'text-green-400';
    if (juice.isTrap) return 'text-red-400';
    if (juice.price >= -120) return 'text-muted-foreground';
    return 'text-orange-400';
  };
  
  const getBgClass = () => {
    if (juice.isValuePlay) return 'bg-green-500/20';
    if (juice.isTrap) return 'bg-red-500/20';
    if (juice.price >= -120) return 'bg-muted';
    return 'bg-orange-500/20';
  };
  
  const getLabel = () => {
    if (juice.isValuePlay) return 'VALUE';
    if (juice.isTrap) return 'TRAP';
    if (juice.price >= -120) return 'FAIR';
    return 'JUICE';
  };
  
  if (compact) {
    return (
      <span 
        className={cn(
          "inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-mono font-bold",
          getBgClass(),
          getColorClass()
        )}
      >
        {formatPrice(juice.price)}
      </span>
    );
  }
  
  return (
    <div className={cn(
      "flex items-center gap-2 px-2 py-1 rounded-md",
      getBgClass()
    )}>
      {juice.isValuePlay ? (
        <DollarSign className="h-4 w-4 text-green-400" />
      ) : juice.isTrap ? (
        <AlertCircle className="h-4 w-4 text-red-400" />
      ) : null}
      <div className="flex items-center gap-2">
        <span className={cn("text-sm font-mono font-bold", getColorClass())}>
          {formatPrice(juice.price)}
        </span>
        <span className={cn("text-xs font-medium", getColorClass())}>
          {getLabel()}
        </span>
      </div>
    </div>
  );
}
