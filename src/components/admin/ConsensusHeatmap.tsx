import React from 'react';
import { motion } from 'framer-motion';
import { BookOpen, TrendingUp, TrendingDown, Minus, AlertCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface SharpSignal {
  name: string;
  baseWeight: number;
  contextMultiplier: number;
  finalWeight: number;
  description: string;
  isActive: boolean;
}

interface TrapSignal {
  name: string;
  baseWeight: number;
  severityModifier: number;
  finalWeight: number;
  description: string;
  isActive: boolean;
}

interface ConsensusHeatmapProps {
  consensusRatio: number;
  consensusStrength: string;
  sharpSignals: SharpSignal[];
  trapSignals: TrapSignal[];
  className?: string;
}

export function ConsensusHeatmap({
  consensusRatio,
  consensusStrength,
  sharpSignals,
  trapSignals,
  className = ''
}: ConsensusHeatmapProps) {
  const getStrengthColor = () => {
    switch (consensusStrength) {
      case 'strong': return 'text-green-400 bg-green-500/20 border-green-500/30';
      case 'moderate': return 'text-blue-400 bg-blue-500/20 border-blue-500/30';
      case 'weak': return 'text-yellow-400 bg-yellow-500/20 border-yellow-500/30';
      default: return 'text-red-400 bg-red-500/20 border-red-500/30';
    }
  };

  const activeSharp = sharpSignals.filter(s => s.isActive);
  const activeTrap = trapSignals.filter(s => s.isActive);

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Consensus Strength */}
      <div className="bg-background/30 rounded-xl p-4 border border-border/50">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium text-muted-foreground">Market Consensus</span>
          </div>
          <Badge className={getStrengthColor()}>
            {consensusStrength.toUpperCase()}
          </Badge>
        </div>
        
        {/* Consensus Ratio Bar */}
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>0%</span>
            <span className="font-medium text-foreground">{(consensusRatio * 100).toFixed(0)}%</span>
            <span>100%</span>
          </div>
          <div className="h-2 bg-background/50 rounded-full overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{
                background: `linear-gradient(90deg, 
                  hsl(0, 70%, 50%) 0%, 
                  hsl(45, 70%, 50%) 40%, 
                  hsl(120, 70%, 50%) 75%, 
                  hsl(120, 70%, 50%) 100%)`
              }}
              initial={{ width: 0 }}
              animate={{ width: `${consensusRatio * 100}%` }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
            />
          </div>
        </div>
      </div>

      {/* Signal Breakdowns */}
      <div className="grid grid-cols-2 gap-3">
        {/* Sharp Signals */}
        <div className="bg-green-500/5 rounded-xl p-3 border border-green-500/20">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-4 h-4 text-green-400" />
            <span className="text-xs font-medium text-green-400">SHARP SIGNALS</span>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-green-500/30 text-green-400">
              {activeSharp.length}/{sharpSignals.length}
            </Badge>
          </div>
          
          <div className="space-y-1.5">
            {sharpSignals.map((signal, idx) => (
              <motion.div
                key={signal.name}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.05 }}
                className={`flex items-center justify-between text-[11px] py-1 px-2 rounded ${
                  signal.isActive 
                    ? 'bg-green-500/20 text-green-300' 
                    : 'bg-background/30 text-muted-foreground'
                }`}
              >
                <span className="truncate flex-1">{signal.name.replace(/_/g, ' ')}</span>
                {signal.isActive && (
                  <span className="font-medium ml-1">+{signal.finalWeight.toFixed(0)}</span>
                )}
              </motion.div>
            ))}
          </div>
        </div>

        {/* Trap Signals */}
        <div className="bg-red-500/5 rounded-xl p-3 border border-red-500/20">
          <div className="flex items-center gap-2 mb-3">
            <TrendingDown className="w-4 h-4 text-red-400" />
            <span className="text-xs font-medium text-red-400">TRAP SIGNALS</span>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-red-500/30 text-red-400">
              {activeTrap.length}/{trapSignals.length}
            </Badge>
          </div>
          
          <div className="space-y-1.5">
            {trapSignals.map((signal, idx) => (
              <motion.div
                key={signal.name}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.05 }}
                className={`flex items-center justify-between text-[11px] py-1 px-2 rounded ${
                  signal.isActive 
                    ? 'bg-red-500/20 text-red-300' 
                    : 'bg-background/30 text-muted-foreground'
                }`}
              >
                <span className="truncate flex-1">{signal.name.replace(/_/g, ' ')}</span>
                {signal.isActive && (
                  <span className="font-medium ml-1">-{signal.finalWeight.toFixed(0)}</span>
                )}
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ConsensusHeatmap;
