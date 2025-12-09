import React from "react";
import { cn } from "@/lib/utils";
import { PVSTier } from "@/types/pvs";
import { Trophy, Star, AlertTriangle, XCircle, Skull, Sparkles } from "lucide-react";

interface MetricCardProps {
  tier: PVSTier;
  count: number;
  isSelected?: boolean;
  onClick?: () => void;
}

const TIER_CONFIG: Record<PVSTier, {
  label: string;
  gradient: string;
  icon: React.ReactNode;
}> = {
  GOD_TIER: {
    label: 'God Tier',
    gradient: 'linear-gradient(135deg, #ffd700, #ff8c00)',
    icon: <Trophy className="h-4 w-4" />
  },
  HIGH_VALUE: {
    label: 'High Value',
    gradient: 'linear-gradient(135deg, #00ff8c, #00d97e)',
    icon: <Star className="h-4 w-4" />
  },
  MED_VOLATILITY: {
    label: 'Medium',
    gradient: 'linear-gradient(135deg, #00d4ff, #0099cc)',
    icon: <AlertTriangle className="h-4 w-4" />
  },
  RISKY: {
    label: 'Risky',
    gradient: 'linear-gradient(135deg, #ff8c00, #ff6600)',
    icon: <XCircle className="h-4 w-4" />
  },
  FADE: {
    label: 'Fade',
    gradient: 'linear-gradient(135deg, #ff4444, #cc0000)',
    icon: <Skull className="h-4 w-4" />
  },
  uncategorized: {
    label: 'Other',
    gradient: 'linear-gradient(135deg, #666666, #444444)',
    icon: <Sparkles className="h-4 w-4" />
  }
};

export function MetricCard({ tier, count, isSelected, onClick }: MetricCardProps) {
  const config = TIER_CONFIG[tier];
  
  return (
    <div
      onClick={onClick}
      className={cn(
        "metric-card cursor-pointer transition-all duration-200",
        isSelected && "ring-2 ring-white/50 scale-105"
      )}
      style={{ background: config.gradient }}
    >
      <span className="text-3xl font-bold text-white drop-shadow-lg">
        {count}
      </span>
      <span className="text-xs font-medium text-white/90 flex items-center gap-1 mt-1">
        {config.icon}
        {config.label}
      </span>
    </div>
  );
}
