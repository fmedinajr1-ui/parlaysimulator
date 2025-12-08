import React from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, Minus, Zap, Shield, Activity } from 'lucide-react';

interface GodModePressureGaugeProps {
  sharpPressure: number;
  trapPressure: number;
  marketNoise: number;
  eventVolatilityModifier: number;
  nmes: number;
  sharpProbability: number;
  trapProbability: number;
  godModeScore: number;
  recommendation: 'pick' | 'fade' | 'caution';
  className?: string;
}

export function GodModePressureGauge({
  sharpPressure,
  trapPressure,
  marketNoise,
  eventVolatilityModifier,
  nmes,
  sharpProbability,
  trapProbability,
  godModeScore,
  recommendation,
  className = ''
}: GodModePressureGaugeProps) {
  // Calculate pressure bar widths (normalized to max 150)
  const maxPressure = 150;
  const sharpWidth = Math.min(100, (sharpPressure / maxPressure) * 100);
  const trapWidth = Math.min(100, (trapPressure / maxPressure) * 100);
  
  // Probability meter angle (-90 to 90 degrees)
  const probAngle = (sharpProbability - 0.5) * 180;
  
  // Color based on recommendation
  const getRecommendationColor = () => {
    switch (recommendation) {
      case 'pick': return 'text-green-400';
      case 'fade': return 'text-red-400';
      default: return 'text-yellow-400';
    }
  };

  const getRecommendationBg = () => {
    switch (recommendation) {
      case 'pick': return 'from-green-500/20 to-green-500/5';
      case 'fade': return 'from-red-500/20 to-red-500/5';
      default: return 'from-yellow-500/20 to-yellow-500/5';
    }
  };

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Main GOD MODE Score Display */}
      <div className={`bg-gradient-to-br ${getRecommendationBg()} rounded-xl p-4 border border-border/50`}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Zap className={`w-5 h-5 ${getRecommendationColor()}`} />
            <span className="text-sm font-medium text-muted-foreground">GOD MODE SCORE</span>
          </div>
          <span className={`text-2xl font-bold ${getRecommendationColor()}`}>
            {godModeScore >= 0 ? '+' : ''}{godModeScore.toFixed(1)}
          </span>
        </div>
        
        {/* NMES Display */}
        <div className="flex items-center justify-between text-sm mb-2">
          <span className="text-muted-foreground">NMES (Net Market Edge)</span>
          <span className={nmes >= 0 ? 'text-green-400' : 'text-red-400'}>
            {nmes >= 0 ? '+' : ''}{nmes.toFixed(1)}
          </span>
        </div>
        
        {/* EVM Display */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Event Volatility</span>
          <span className={eventVolatilityModifier > 1.2 ? 'text-orange-400' : 'text-foreground'}>
            ×{eventVolatilityModifier.toFixed(2)}
          </span>
        </div>
      </div>

      {/* Pressure Bars */}
      <div className="space-y-3">
        {/* Sharp Pressure Bar */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4 text-green-400" />
              <span className="text-muted-foreground">Sharp Pressure (SP)</span>
            </div>
            <span className="text-green-400 font-medium">{sharpPressure.toFixed(0)}</span>
          </div>
          <div className="h-3 bg-background/50 rounded-full overflow-hidden border border-border/50">
            <motion.div
              className="h-full bg-gradient-to-r from-green-600 to-green-400 rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${sharpWidth}%` }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
            />
          </div>
        </div>

        {/* Trap Pressure Bar */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-1.5">
              <TrendingDown className="w-4 h-4 text-red-400" />
              <span className="text-muted-foreground">Trap Pressure (TP)</span>
            </div>
            <span className="text-red-400 font-medium">{trapPressure.toFixed(0)}</span>
          </div>
          <div className="h-3 bg-background/50 rounded-full overflow-hidden border border-border/50">
            <motion.div
              className="h-full bg-gradient-to-r from-red-600 to-red-400 rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${trapWidth}%` }}
              transition={{ duration: 0.8, ease: 'easeOut', delay: 0.1 }}
            />
          </div>
        </div>

        {/* Market Noise */}
        <div className="flex items-center justify-between text-sm py-1 border-t border-border/30">
          <div className="flex items-center gap-1.5">
            <Activity className="w-4 h-4 text-muted-foreground" />
            <span className="text-muted-foreground">Market Noise (NP)</span>
          </div>
          <span className="text-muted-foreground">{marketNoise.toFixed(1)}</span>
        </div>
      </div>

      {/* Probability Meter */}
      <div className="bg-background/30 rounded-xl p-4 border border-border/50">
        <div className="text-center mb-3">
          <span className="text-sm text-muted-foreground">Sharp vs Trap Probability</span>
        </div>
        
        {/* Visual Probability Bar */}
        <div className="relative h-6 bg-gradient-to-r from-red-500/30 via-yellow-500/30 to-green-500/30 rounded-full overflow-hidden">
          <div className="absolute inset-y-0 left-1/2 w-0.5 bg-border/50" />
          <motion.div
            className="absolute top-0 bottom-0 w-1 bg-white rounded-full shadow-lg"
            initial={{ left: '50%' }}
            animate={{ left: `${sharpProbability * 100}%` }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            style={{ marginLeft: '-2px' }}
          />
        </div>
        
        {/* Labels */}
        <div className="flex justify-between mt-2 text-xs">
          <div className="text-red-400">
            <div className="font-medium">TRAP</div>
            <div>{(trapProbability * 100).toFixed(0)}%</div>
          </div>
          <div className="text-center text-muted-foreground">
            <div>NEUTRAL</div>
          </div>
          <div className="text-green-400 text-right">
            <div className="font-medium">SHARP</div>
            <div>{(sharpProbability * 100).toFixed(0)}%</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default GodModePressureGauge;
