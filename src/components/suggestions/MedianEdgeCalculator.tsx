import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Calculator, Zap, ChevronDown, ChevronUp, RotateCcw, TrendingUp, TrendingDown, Minus, Home, Plane, UserMinus, Clock, Info, Lock } from "lucide-react";
import { CelebrationEffect } from "@/components/results/CelebrationEffect";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Slider } from "@/components/ui/slider";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { 
  calculateMedianEdge, 
  getRecommendationColor,
  type StatType, 
  type GameLocation, 
  type InjuryContext,
  type MedianCalcResult 
} from "@/lib/median-calculator";

const STAT_ICONS = {
  points: "🏀",
  rebounds: "📊", 
  assists: "🎯"
};

export function MedianEdgeCalculator() {
  const [statType, setStatType] = useState<StatType>("points");
  const [gameStats, setGameStats] = useState<string[]>(["", "", "", "", ""]);
  const [sportsbookLine, setSportsbookLine] = useState<string>("");
  const [expectedMinutes, setExpectedMinutes] = useState<number>(32);
  const [spread, setSpread] = useState<string>("0");
  const [gameLocation, setGameLocation] = useState<GameLocation>("home");
  const [injuryContext, setInjuryContext] = useState<InjuryContext>("none");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [result, setResult] = useState<MedianCalcResult | null>(null);
  const [hasCalculated, setHasCalculated] = useState(false);

  const isValidInput = useMemo(() => {
    const hasStats = gameStats.some(s => s !== "" && !isNaN(parseFloat(s)));
    const hasLine = sportsbookLine !== "" && !isNaN(parseFloat(sportsbookLine));
    return hasStats && hasLine;
  }, [gameStats, sportsbookLine]);

  const handleStatChange = (index: number, value: string) => {
    // Allow only numbers and decimals
    if (value !== "" && !/^\d*\.?\d*$/.test(value)) return;
    const newStats = [...gameStats];
    newStats[index] = value;
    setGameStats(newStats);
  };

  const handleCalculate = () => {
    if (!isValidInput) return;
    
    const stats = gameStats.map(s => parseFloat(s) || 0);
    const line = parseFloat(sportsbookLine) || 0;
    const spreadNum = parseFloat(spread) || 0;

    const calcResult = calculateMedianEdge({
      gameStats: stats,
      sportsbookLine: line,
      statType,
      expectedMinutes,
      spread: spreadNum,
      gameLocation,
      injuryContext
    });

    setResult(calcResult);
    setHasCalculated(true);
  };

  const handleReset = () => {
    setGameStats(["", "", "", "", ""]);
    setSportsbookLine("");
    setExpectedMinutes(32);
    setSpread("0");
    setGameLocation("home");
    setInjuryContext("none");
    setResult(null);
    setHasCalculated(false);
  };

  const colors = result ? getRecommendationColor(result.recommendation) : null;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-cyan-500/30 bg-gradient-to-br from-card/90 via-card/70 to-cyan-950/30 backdrop-blur-sm">
      {/* Glow effect */}
      <div className="absolute -top-20 -right-20 w-40 h-40 bg-cyan-500/10 rounded-full blur-3xl" />
      <div className="absolute -bottom-20 -left-20 w-40 h-40 bg-primary/10 rounded-full blur-3xl" />
      
      <div className="relative p-5 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-cyan-500/20 border border-cyan-500/30">
              <Calculator className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <h3 className="font-bold text-lg">5-Median Edge Calculator</h3>
              <p className="text-xs text-muted-foreground">Enter stats to find your edge</p>
            </div>
          </div>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button className="p-2 rounded-lg hover:bg-muted/50 transition-colors">
                  <Info className="w-4 h-4 text-muted-foreground" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p>Enter the last 5 game stats and the sportsbook line to calculate your edge using weighted median analysis.</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        {/* Stat Type Selector */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Stat Type</label>
          <ToggleGroup 
            type="single" 
            value={statType} 
            onValueChange={(v) => v && setStatType(v as StatType)}
            className="justify-start gap-2"
          >
            {(["points", "rebounds", "assists"] as StatType[]).map((type) => (
              <ToggleGroupItem 
                key={type}
                value={type} 
                className="px-4 py-2 data-[state=on]:bg-cyan-500/20 data-[state=on]:border-cyan-500/50 data-[state=on]:text-cyan-300 border border-border/50 rounded-xl transition-all"
              >
                <span className="mr-2">{STAT_ICONS[type]}</span>
                <span className="capitalize">{type}</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        {/* Game Stats Input */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Last 5 Game Stats</label>
          <div className="grid grid-cols-5 gap-2">
            {gameStats.map((stat, index) => (
              <div key={index} className="space-y-1">
                <Input
                  type="text"
                  inputMode="decimal"
                  placeholder="0"
                  value={stat}
                  onChange={(e) => handleStatChange(index, e.target.value)}
                  className="text-center font-mono text-lg h-14 bg-background/50 border-border/50 focus:border-cyan-500/50"
                />
                <p className="text-[10px] text-center text-muted-foreground">G{index + 1}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Sportsbook Line */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Sportsbook Line</label>
          <Input
            type="text"
            inputMode="decimal"
            placeholder="24.5"
            value={sportsbookLine}
            onChange={(e) => {
              if (e.target.value === "" || /^\d*\.?\d*$/.test(e.target.value)) {
                setSportsbookLine(e.target.value);
              }
            }}
            className="text-center font-mono text-xl h-14 bg-background/50 border-border/50 focus:border-cyan-500/50"
          />
        </div>

        {/* Advanced Settings */}
        <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full justify-center py-2">
              {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              <span>Advanced Settings</span>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-4 pt-3">
            {/* Expected Minutes */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Expected Minutes</label>
                <span className="text-sm font-mono text-cyan-400">{expectedMinutes}</span>
              </div>
              <Slider
                value={[expectedMinutes]}
                onValueChange={(v) => setExpectedMinutes(v[0])}
                min={20}
                max={42}
                step={1}
                className="py-2"
              />
            </div>

            {/* Spread */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Game Spread</label>
              <Input
                type="text"
                inputMode="numeric"
                placeholder="0"
                value={spread}
                onChange={(e) => {
                  if (e.target.value === "" || e.target.value === "-" || /^-?\d*\.?\d*$/.test(e.target.value)) {
                    setSpread(e.target.value);
                  }
                }}
                className="text-center font-mono h-12 bg-background/50 border-border/50"
              />
              <p className="text-[10px] text-center text-muted-foreground">Positive = home favored, Negative = away favored</p>
            </div>

            {/* Game Location */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Game Location</label>
              <ToggleGroup 
                type="single" 
                value={gameLocation} 
                onValueChange={(v) => v && setGameLocation(v as GameLocation)}
                className="justify-start gap-2"
              >
                <ToggleGroupItem 
                  value="home" 
                  className="flex-1 py-2 data-[state=on]:bg-emerald-500/20 data-[state=on]:border-emerald-500/50 data-[state=on]:text-emerald-300 border border-border/50 rounded-xl"
                >
                  <Home className="w-4 h-4 mr-2" />
                  Home
                </ToggleGroupItem>
                <ToggleGroupItem 
                  value="away" 
                  className="flex-1 py-2 data-[state=on]:bg-amber-500/20 data-[state=on]:border-amber-500/50 data-[state=on]:text-amber-300 border border-border/50 rounded-xl"
                >
                  <Plane className="w-4 h-4 mr-2" />
                  Away
                </ToggleGroupItem>
              </ToggleGroup>
            </div>

            {/* Injury Context */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Injury Context</label>
              <ToggleGroup 
                type="single" 
                value={injuryContext} 
                onValueChange={(v) => v && setInjuryContext(v as InjuryContext)}
                className="justify-start gap-2 flex-wrap"
              >
                <ToggleGroupItem 
                  value="none" 
                  className="py-2 px-3 data-[state=on]:bg-muted data-[state=on]:border-muted-foreground/50 border border-border/50 rounded-xl text-sm"
                >
                  None
                </ToggleGroupItem>
                <ToggleGroupItem 
                  value="teammate_out" 
                  className="py-2 px-3 data-[state=on]:bg-emerald-500/20 data-[state=on]:border-emerald-500/50 data-[state=on]:text-emerald-300 border border-border/50 rounded-xl text-sm"
                >
                  <UserMinus className="w-4 h-4 mr-1" />
                  Teammate Out
                </ToggleGroupItem>
                <ToggleGroupItem 
                  value="minutes_limit" 
                  className="py-2 px-3 data-[state=on]:bg-red-500/20 data-[state=on]:border-red-500/50 data-[state=on]:text-red-300 border border-border/50 rounded-xl text-sm"
                >
                  <Clock className="w-4 h-4 mr-1" />
                  Mins Limit
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Action Buttons */}
        <div className="flex gap-3">
          <Button
            onClick={handleCalculate}
            disabled={!isValidInput}
            className="flex-1 h-12 bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 text-white font-semibold rounded-xl shadow-lg shadow-cyan-500/25 disabled:opacity-50 disabled:shadow-none transition-all"
          >
            <Zap className="w-5 h-5 mr-2" />
            Calculate Edge
          </Button>
          <Button
            onClick={handleReset}
            variant="outline"
            className="h-12 px-4 rounded-xl border-border/50"
          >
            <RotateCcw className="w-4 h-4" />
          </Button>
        </div>

        {/* Results */}
        <AnimatePresence mode="wait">
          {hasCalculated && result && (() => {
            const line = parseFloat(sportsbookLine);
            const isOver = result.trueMedian > line;
            const isUnder = result.trueMedian < line;
            const direction = isOver ? 'OVER' : isUnder ? 'UNDER' : 'PUSH';
            const isStrongEdge = Math.abs(result.edge) >= 2;

            return (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3 }}
                className="space-y-4 pt-4 border-t border-border/30"
              >
                {/* Big OVER/UNDER Direction Badge with Celebration */}
                <CelebrationEffect isActive={isStrongEdge}>
                  <motion.div
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 300, damping: 20 }}
                    className={`relative p-6 rounded-2xl text-center overflow-hidden ${
                      isOver 
                        ? 'bg-gradient-to-br from-emerald-500/20 via-emerald-600/10 to-emerald-500/20 border-2 border-emerald-500/50 shadow-lg shadow-emerald-500/20' 
                        : isUnder 
                          ? 'bg-gradient-to-br from-cyan-500/20 via-cyan-600/10 to-cyan-500/20 border-2 border-cyan-500/50 shadow-lg shadow-cyan-500/20'
                          : 'bg-gradient-to-br from-amber-500/20 via-amber-600/10 to-amber-500/20 border-2 border-amber-500/50 shadow-lg shadow-amber-500/20'
                    }`}
                  >
                    {/* Animated background glow */}
                    {isStrongEdge && (
                      <motion.div
                        className={`absolute inset-0 opacity-30 ${
                          isOver ? 'bg-emerald-500' : isUnder ? 'bg-cyan-500' : 'bg-amber-500'
                        }`}
                        animate={{ opacity: [0.1, 0.3, 0.1] }}
                        transition={{ duration: 2, repeat: Infinity }}
                      />
                    )}

                    <div className="relative z-10">
                      {/* Direction Icon and Text */}
                      <div className="flex items-center justify-center gap-3 mb-3">
                        {isOver ? (
                          <motion.div
                            animate={{ y: [0, -5, 0] }}
                            transition={{ duration: 1, repeat: Infinity }}
                          >
                            <TrendingUp className="w-10 h-10 text-emerald-400" />
                          </motion.div>
                        ) : isUnder ? (
                          <motion.div
                            animate={{ y: [0, 5, 0] }}
                            transition={{ duration: 1, repeat: Infinity }}
                          >
                            <TrendingDown className="w-10 h-10 text-cyan-400" />
                          </motion.div>
                        ) : (
                          <Minus className="w-10 h-10 text-amber-400" />
                        )}
                        <span className={`text-4xl font-black tracking-wider ${
                          isOver ? 'text-emerald-400' : isUnder ? 'text-cyan-400' : 'text-amber-400'
                        }`}>
                          {direction}
                        </span>
                        {isOver ? (
                          <motion.div
                            animate={{ y: [0, -5, 0] }}
                            transition={{ duration: 1, repeat: Infinity, delay: 0.5 }}
                          >
                            <TrendingUp className="w-10 h-10 text-emerald-400" />
                          </motion.div>
                        ) : isUnder ? (
                          <motion.div
                            animate={{ y: [0, 5, 0] }}
                            transition={{ duration: 1, repeat: Infinity, delay: 0.5 }}
                          >
                            <TrendingDown className="w-10 h-10 text-cyan-400" />
                          </motion.div>
                        ) : (
                          <Minus className="w-10 h-10 text-amber-400" />
                        )}
                      </div>

                      {/* Line Value */}
                      <p className="text-2xl font-bold font-mono text-foreground mb-4">
                        {sportsbookLine} {statType.toUpperCase()}
                      </p>

                      {/* Stats Row */}
                      <div className="flex items-center justify-center gap-6 text-sm">
                        <div className="text-center">
                          <p className="text-muted-foreground text-xs uppercase tracking-wider">True Median</p>
                          <p className="text-lg font-bold font-mono text-cyan-400">{result.trueMedian}</p>
                        </div>
                        <div className="w-px h-8 bg-border/50" />
                        <div className="text-center">
                          <p className="text-muted-foreground text-xs uppercase tracking-wider">Edge</p>
                          <p className={`text-lg font-bold font-mono ${
                            result.edge > 0 ? 'text-emerald-400' : result.edge < 0 ? 'text-red-400' : 'text-muted-foreground'
                          }`}>
                            {result.edge > 0 ? '+' : ''}{result.edge}
                          </p>
                        </div>
                        <div className="w-px h-8 bg-border/50" />
                        <div className="text-center">
                          <p className="text-muted-foreground text-xs uppercase tracking-wider">Confidence</p>
                          <p className={`text-lg font-bold ${
                            isOver ? 'text-emerald-400' : isUnder ? 'text-cyan-400' : 'text-amber-400'
                          }`}>{result.confidence}%</p>
                        </div>
                      </div>

                      {/* Strong Pick Badge */}
                      {isStrongEdge && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ delay: 0.3 }}
                          className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-primary/20 to-primary/10 border border-primary/30"
                        >
                          <span className="text-lg">🔥</span>
                          <span className="font-semibold text-primary">STRONG EDGE FOUND</span>
                          <span className="text-lg">🔥</span>
                        </motion.div>
                      )}
                    </div>
                  </motion.div>
                </CelebrationEffect>

                {/* Reason Summary */}
                <div className="p-3 rounded-xl bg-background/30 border border-border/20 text-center">
                  <p className="text-sm text-muted-foreground">{result.reasonSummary}</p>
                </div>

              {/* Median Breakdown */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Median Breakdown</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-3 rounded-lg bg-background/30 border border-border/20 text-center">
                    <p className="text-[10px] text-muted-foreground uppercase">Form Median</p>
                    <p className="text-lg font-mono font-semibold">{result.m1FormMedian}</p>
                    <p className="text-[10px] text-cyan-500">25% weight</p>
                  </div>
                  <div className="p-3 rounded-lg bg-background/30 border border-border/20 text-center">
                    <p className="text-[10px] text-muted-foreground uppercase">Mins-Adjusted</p>
                    <p className="text-lg font-mono font-semibold">{result.m2MinutesWeighted}</p>
                    <p className="text-[10px] text-cyan-500">75% weight</p>
                  </div>
                </div>
              </div>

              {/* Adjustments Applied */}
              {(result.adjustments.blowoutRisk !== 0 || 
                result.adjustments.injuryBoost !== 0 || 
                result.adjustments.minutesLimit !== 0 ||
                result.adjustments.homeAdvantage !== 0) && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Adjustments Applied</p>
                  <div className="space-y-1">
                    {result.adjustments.blowoutRisk !== 0 && (
                      <div className="flex items-center justify-between p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm">
                        <span className="text-amber-300">Blowout Risk</span>
                        <span className="font-mono text-amber-400">{result.adjustments.blowoutRisk > 0 ? '+' : ''}{result.adjustments.blowoutRisk}</span>
                      </div>
                    )}
                    {result.adjustments.injuryBoost !== 0 && (
                      <div className="flex items-center justify-between p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-sm">
                        <span className="text-emerald-300">Teammate Out Boost</span>
                        <span className="font-mono text-emerald-400">+{result.adjustments.injuryBoost}</span>
                      </div>
                    )}
                    {result.adjustments.minutesLimit !== 0 && (
                      <div className="flex items-center justify-between p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-sm">
                        <span className="text-red-300">Minutes Restriction</span>
                        <span className="font-mono text-red-400">{result.adjustments.minutesLimit}</span>
                      </div>
                    )}
                    {result.adjustments.homeAdvantage !== 0 && (
                      <div className="flex items-center justify-between p-2 rounded-lg bg-blue-500/10 border border-blue-500/20 text-sm">
                        <span className="text-blue-300">{gameLocation === 'home' ? 'Home Court' : 'Road Game'}</span>
                        <span className="font-mono text-blue-400">{result.adjustments.homeAdvantage > 0 ? '+' : ''}{result.adjustments.homeAdvantage}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
              </motion.div>
            );
          })()}
        </AnimatePresence>
      </div>
    </div>
  );
}
