import { useState } from "react";
import { Info, ChevronDown, ChevronUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { motion, AnimatePresence } from "framer-motion";

export function WhaleDisclaimer() {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="rounded-xl border border-blue-500/20 bg-blue-500/10 overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full p-3 flex items-center gap-3 text-left hover:bg-blue-500/5 transition-colors"
      >
        <Info className="w-4 h-4 text-blue-400 flex-shrink-0" />
        <span className="text-xs text-blue-200 flex-1">
          These signals show market movement patterns, not confirmed bets. Tap to learn more.
        </span>
        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-blue-400 flex-shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-blue-400 flex-shrink-0" />
        )}
      </button>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-3 border-t border-blue-500/20">
              <div className="pt-3">
                <h4 className="text-sm font-semibold text-foreground mb-2">
                  What are these signals?
                </h4>
                <p className="text-xs text-muted-foreground mb-3">
                  This dashboard detects where professional bettors ("sharps") may be moving lines by analyzing:
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-start gap-2">
                  <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30 text-[10px] flex-shrink-0">
                    DIVERGENCE
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    PrizePicks line differs significantly from book consensus
                  </span>
                </div>

                <div className="flex items-start gap-2">
                  <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-[10px] flex-shrink-0">
                    STEAM
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    Rapid line movement detected across multiple sportsbooks
                  </span>
                </div>

                <div className="flex items-start gap-2">
                  <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30 text-[10px] flex-shrink-0">
                    BOOK_DIVERGENCE
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    Major books (FanDuel, DraftKings) disagree on the line
                  </span>
                </div>
              </div>

              <div className="pt-2 border-t border-blue-500/10">
                <p className="text-xs text-amber-400/80">
                  <strong>Important:</strong> These are statistical patterns, not confirmed whale bets. 
                  Sharp money is inferred from line movements, not tracked directly. 
                  Use signals as one data point in your research, not as guaranteed picks.
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
