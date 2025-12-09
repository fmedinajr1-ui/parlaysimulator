import { X } from "lucide-react";
import { PVSProp, PVS_TIER_CONFIG } from "@/types/pvs";
import { cn } from "@/lib/utils";

interface SelectedPropCardProps {
  prop: PVSProp;
  index: number;
  onRemove: (prop: PVSProp) => void;
}

export function SelectedPropCard({ prop, index, onRemove }: SelectedPropCardProps) {
  const formatPropType = (propType: string) => {
    return propType
      .replace('player_', '')
      .replace(/_/g, ' ')
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const formatOdds = (odds: number | null) => {
    if (odds === null) return '-110';
    return odds > 0 ? `+${odds}` : odds.toString();
  };

  const getOdds = () => {
    return prop.recommended_side === 'over' ? prop.over_price : prop.under_price;
  };

  return (
    <div className="selected-prop-card group">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#00ff8c]/20 flex items-center justify-center text-xs font-bold text-[#00ff8c]">
            {index + 1}
          </span>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-white text-sm truncate">
              {prop.player_name}
            </div>
            <div className="text-xs text-gray-400">
              {prop.recommended_side?.toUpperCase() || 'N/A'} {prop.current_line} {formatPropType(prop.prop_type)}
            </div>
          </div>
        </div>
        
        <button
          onClick={() => onRemove(prop)}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-white/10 rounded"
        >
          <X className="h-4 w-4 text-gray-400 hover:text-white" />
        </button>
      </div>
      
      <div className="flex items-center justify-between mt-2 text-xs">
        <span className={cn("font-medium", PVS_TIER_CONFIG[prop.pvs_tier]?.color || "text-gray-400")}>
          {prop.pvs_tier.replace('_', ' ')} • {prop.pvs_final_score.toFixed(0)} PVS
        </span>
        <span className="font-mono text-[#00ff8c]">
          {formatOdds(getOdds())}
        </span>
      </div>
    </div>
  );
}
