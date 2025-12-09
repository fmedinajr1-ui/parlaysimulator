import { PVSProp, PVS_TIER_CONFIG } from "@/types/pvs";
import { cn } from "@/lib/utils";
import { Plus, Check } from "lucide-react";

interface PVSPropCardProps {
  prop: PVSProp;
  isSelected?: boolean;
  onSelect?: (prop: PVSProp) => void;
}

const TIER_GRADIENTS: Record<string, string> = {
  GOD_TIER: 'linear-gradient(135deg, #ffd700, #ff8c00)',
  HIGH_VALUE: 'linear-gradient(135deg, #00ff8c, #00d97e)',
  MED_VOLATILITY: 'linear-gradient(135deg, #00d4ff, #0099cc)',
  RISKY: 'linear-gradient(135deg, #ff8c00, #ff6600)',
  FADE: 'linear-gradient(135deg, #ff4444, #cc0000)',
  uncategorized: 'linear-gradient(135deg, #666666, #444444)'
};

export function PVSPropCard({ prop, isSelected = false, onSelect }: PVSPropCardProps) {
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

  const getLineDisplay = () => {
    const side = prop.recommended_side === 'over' ? 'O' : prop.recommended_side === 'under' ? 'U' : 'O/U';
    return `${formatPropType(prop.prop_type)} ${side} ${prop.current_line}`;
  };

  return (
    <div 
      className={cn(
        "prop-card w-full max-w-full self-stretch",
        isSelected && "ring-1 ring-[#00ff8c]/50"
      )}
    >
      {/* Row 1: Player Name */}
      <div className="prop-player">
        {prop.player_name}
      </div>
      
      {/* Row 2: Prop Type + Line */}
      <div className="prop-info-row">
        <span className="text-gray-300 text-sm">{getLineDisplay()}</span>
        <span className="text-xs text-gray-500 truncate max-w-[120px]">
          {prop.game_description}
        </span>
      </div>
      
      {/* Row 3: PVS Score Badge */}
      <div className="flex items-center justify-between">
        <div 
          className="prop-score-badge"
          style={{ background: TIER_GRADIENTS[prop.pvs_tier] || TIER_GRADIENTS.uncategorized }}
        >
          <span className="font-bold text-white text-xs drop-shadow">
            {prop.pvs_final_score.toFixed(0)} PVS
          </span>
        </div>
        
        <div className="flex gap-2 text-xs font-mono">
          <span className="text-[#00ff8c]">O {formatOdds(prop.over_price)}</span>
          <span className="text-gray-500">/</span>
          <span className="text-red-400">U {formatOdds(prop.under_price)}</span>
        </div>
      </div>
      
      {/* Row 4: Add Button */}
      <button
        onClick={() => onSelect?.(prop)}
        className={cn(
          "prop-add-button",
          isSelected && "bg-[#1a1a1a] text-[#00ff8c] border border-[#00ff8c]"
        )}
      >
        {isSelected ? (
          <>
            <Check className="h-4 w-4" />
            Added
          </>
        ) : (
          <>
            <Plus className="h-4 w-4" />
            Add to Parlay
          </>
        )}
      </button>
    </div>
  );
}
