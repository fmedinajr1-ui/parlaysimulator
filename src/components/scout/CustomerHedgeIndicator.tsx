import React from 'react';
import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { DeepSweetSpot, HedgeStatus } from '@/types/sweetSpot';

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

interface CustomerHedgeIndicatorProps {
  spot: DeepSweetSpot;
}

export function CustomerHedgeIndicator({ spot }: CustomerHedgeIndicatorProps) {
  const status = spot.liveData?.hedgeStatus;
  if (!status) return null;

  const tier = mapToCustomerTier(status);
  const config = TIER_CONFIG[tier];
  const Icon = config.icon;
  const currentValue = spot.liveData?.currentValue ?? 0;
  const line = spot.line;

  return (
    <div className="flex items-center justify-between gap-2">
      <Badge variant="outline" className={cn('text-[10px] px-2 py-0.5 gap-1', config.className)}>
        <Icon className="w-3 h-3" />
        {config.label}
      </Badge>
      <span className="text-xs text-muted-foreground">
        {config.message} · {currentValue} of {line}
      </span>
    </div>
  );
}

export { mapToCustomerTier, type CustomerTier };
