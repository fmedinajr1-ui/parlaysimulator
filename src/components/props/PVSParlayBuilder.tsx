import { Zap, Sparkles, TrendingUp } from "lucide-react";
import { PVSProp, PVS_TIER_CONFIG } from "@/types/pvs";
import { SelectedPropCard } from "./SelectedPropCard";
import { cn } from "@/lib/utils";

interface PVSParlayBuilderProps {
  selectedProps: PVSProp[];
  onRemove: (prop: PVSProp) => void;
  onClear: () => void;
}

export function PVSParlayBuilder({ selectedProps, onRemove, onClear }: PVSParlayBuilderProps) {
  const calculateCombinedOdds = () => {
    if (selectedProps.length === 0) return 0;
    
    const decimalOdds = selectedProps.map(prop => {
      const odds = prop.recommended_side === 'over' ? prop.over_price : prop.under_price;
      if (!odds) return 1.91; // Default -110
      return odds > 0 ? (odds / 100 + 1) : (100 / Math.abs(odds) + 1);
    });
    
    const combined = decimalOdds.reduce((acc, odds) => acc * odds, 1);
    const americanOdds = combined >= 2 ? (combined - 1) * 100 : -100 / (combined - 1);
    return Math.round(americanOdds);
  };

  const calculateCombinedPVS = () => {
    if (selectedProps.length === 0) return 0;
    return selectedProps.reduce((acc, prop) => acc + prop.pvs_final_score, 0) / selectedProps.length;
  };

  const calculateWinProbability = () => {
    if (selectedProps.length === 0) return 0;
    return selectedProps.reduce((acc, prop) => acc * (prop.pvs_final_score / 100), 1) * 100;
  };

  const calculatePayout = () => {
    const odds = calculateCombinedOdds();
    if (odds > 0) {
      return 100 + odds;
    } else {
      return 100 + (100 / Math.abs(odds)) * 100;
    }
  };

  const combinedOdds = calculateCombinedOdds();
  const combinedPVS = calculateCombinedPVS();
  const winProbability = calculateWinProbability();

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-[#00ff8c]" />
          Parlay Builder
        </h2>
        {selectedProps.length > 0 && (
          <button
            onClick={onClear}
            className="text-sm text-gray-400 hover:text-red-400 transition-colors"
          >
            Clear All
          </button>
        )}
      </div>

      {/* Empty State */}
      {selectedProps.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center py-12">
          <div className="w-16 h-16 rounded-full bg-[#00ff8c]/10 flex items-center justify-center mb-4">
            <Zap className="h-8 w-8 text-[#00ff8c]" />
          </div>
          <h3 className="text-lg font-semibold text-white mb-2">
            Add props to build your parlay
          </h3>
          <p className="text-sm text-gray-400 max-w-[200px]">
            Select GOD TIER props for the best results
          </p>
        </div>
      ) : (
        <>
          {/* Selected Props */}
          <div className="flex-1 space-y-3 overflow-y-auto mb-6">
            {selectedProps.map((prop, index) => (
              <SelectedPropCard
                key={prop.id}
                prop={prop}
                index={index}
                onRemove={onRemove}
              />
            ))}
          </div>

          {/* Parlay Footer */}
          <div className="parlay-footer border-t border-white/10 pt-4 space-y-4">
            {/* Stats Row */}
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-xs text-gray-400 mb-1">Legs</div>
                <div className="text-xl font-bold text-white">{selectedProps.length}</div>
              </div>
              <div>
                <div className="text-xs text-gray-400 mb-1">Avg PVS</div>
                <div className={cn(
                  "text-xl font-bold",
                  combinedPVS >= 85 ? "text-[#00ff8c]" :
                  combinedPVS >= 70 ? "text-yellow-400" : "text-orange-400"
                )}>
                  {combinedPVS.toFixed(0)}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-400 mb-1">Odds</div>
                <div className="text-xl font-bold text-[#00ff8c] font-mono">
                  {combinedOdds > 0 ? `+${combinedOdds}` : combinedOdds}
                </div>
              </div>
            </div>

            {/* Win Probability Bar */}
            <div className="bg-[#111] rounded-lg p-3">
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="text-gray-400">Est. Win Probability</span>
                <span className={cn(
                  "font-bold",
                  winProbability >= 50 ? "text-[#00ff8c]" :
                  winProbability >= 25 ? "text-yellow-400" : "text-orange-400"
                )}>
                  {winProbability.toFixed(1)}%
                </span>
              </div>
              <div className="h-2 bg-[#222] rounded-full overflow-hidden">
                <div 
                  className="h-full rounded-full transition-all bg-gradient-to-r from-[#00ff8c] to-[#00d97e]"
                  style={{ width: `${Math.min(100, winProbability)}%` }}
                />
              </div>
            </div>

            {/* Payout Display */}
            <div className="flex items-center justify-between bg-[#111] rounded-lg p-3">
              <span className="text-gray-400 text-sm">$100 wins</span>
              <span className="text-2xl font-bold text-[#00ff8c] font-mono">
                ${calculatePayout().toFixed(0)}
              </span>
            </div>

            {/* Generate Button */}
            <button className="w-full py-4 rounded-xl font-bold text-black text-lg flex items-center justify-center gap-2 transition-all hover:scale-[1.02] active:scale-[0.98]"
              style={{ background: 'linear-gradient(135deg, #00ff8c, #00d97e)' }}
            >
              <TrendingUp className="h-5 w-5" />
              Generate Parlay Simulation
            </button>
          </div>
        </>
      )}
    </div>
  );
}
