import React from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Flame, Snowflake } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { DeepSweetSpot, HedgeStatus } from '@/types/sweetSpot';
import type { SignalType } from '@/hooks/useCustomerWhaleSignals';

type CustomerTier = 'on_track' | 'caution' | 'action_needed';

function mapToCustomerTier(status: HedgeStatus): CustomerTier {
  if (status === 'on_track' || status === 'profit_lock') return 'on_track';
  if (status === 'monitor') return 'caution';
  return 'action_needed';
}

const TIER_CONFIG: Record<CustomerTier, {
  label: string;
  message: string;
  icon: React.ElementType;
  className: string;
}> = {
  on_track: {
    label: 'ON TRACK',
    message: 'Looking good',
    icon: CheckCircle2,
    className: 'bg-chart-2/15 text-chart-2 border-chart-2/30',
  },
  caution: {
    label: 'CAUTION',
    message: 'Keep watching',
    icon: AlertTriangle,
    className: 'bg-chart-3/15 text-chart-3 border-chart-3/30',
  },
  action_needed: {
    label: 'ACTION NEEDED',
    message: 'At risk',
    icon: XCircle,
    className: 'bg-destructive/15 text-destructive border-destructive/30',
  },
};

const SIGNAL_BADGES: Record<SignalType, { label: string; icon: React.ElementType; className: string }> = {
  STEAM: { label: 'STEAM', icon: Flame, className: 'bg-orange-500/15 text-orange-400 border-orange-500/30' },
  FREEZE: { label: 'FREEZE', icon: Snowflake, className: 'bg-sky-500/15 text-sky-400 border-sky-500/30' },
  DIVERGENCE: { label: 'SHARP', icon: () => <span className="text-[10px]">🐋</span>, className: 'bg-violet-500/15 text-violet-400 border-violet-500/30' },
};

interface CustomerHedgeIndicatorProps {
  spot: DeepSweetSpot;
  signal?: SignalType;
}

export function CustomerHedgeIndicator({ spot, signal }: CustomerHedgeIndicatorProps) {
  const status = spot.liveData?.hedgeStatus;
  if (!status) return null;

  const tier = mapToCustomerTier(status);
  const config = TIER_CONFIG[tier];
  const Icon = config.icon;
  const currentValue = spot.liveData?.currentValue ?? 0;
  const line = spot.line;

  const signalBadge = signal ? SIGNAL_BADGES[signal] : null;
  const SignalIcon = signalBadge?.icon;

  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-1.5">
        <Badge variant="outline" className={cn('text-[10px] px-2 py-0.5 gap-1', config.className)}>
          <Icon className="w-3 h-3" />
          {config.label}
        </Badge>
        {signalBadge && SignalIcon && (
          <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0.5 gap-0.5', signalBadge.className)}>
            <SignalIcon className="w-3 h-3" />
            {signalBadge.label}
          </Badge>
        )}
      </div>
      <span className="text-xs text-muted-foreground">
        {config.message} · {currentValue} of {line}
      </span>
    </div>
  );
}

export { mapToCustomerTier, type CustomerTier };
