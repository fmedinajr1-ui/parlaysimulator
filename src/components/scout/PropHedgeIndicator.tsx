import React from 'react';
import { PropEdge } from '@/types/scout-agent';
import { cn } from '@/lib/utils';
import { Shield, AlertTriangle, CheckCircle2, Eye, Lock } from 'lucide-react';
import { getHedgeActionLabel, type HedgeActionLabel } from '@/lib/hedgeStatusUtils';

type HedgeStatus = 'lock' | 'hold' | 'monitor' | 'hedge_alert' | 'hedge_now' | 'already_hit' | 'line_exceeded';

interface HedgeResult {
  status: HedgeStatus;
  label: string;
  detail: string;
  icon: React.ReactNode;
}

const ACTION_TO_STATUS: Record<HedgeActionLabel, HedgeStatus> = {
  LOCK: 'lock',
  HOLD: 'hold',
  MONITOR: 'monitor',
  'HEDGE ALERT': 'hedge_alert',
  'HEDGE NOW': 'hedge_now',
};

function calcHedgeStatus(edge: PropEdge): HedgeResult | null {
  const current = edge.currentStat ?? 0;
  const projected = edge.expectedFinal ?? 0;
  const line = edge.line ?? 0;
  const lean = edge.lean;

  if (line <= 0) return null;

  // Already settled states
  if (lean === 'OVER' && current >= line) {
    return { status: 'already_hit', label: '✅ HIT', detail: `Already cleared ${line}`, icon: <CheckCircle2 className="w-3 h-3" /> };
  }
  if (lean === 'UNDER' && current >= line) {
    return { status: 'line_exceeded', label: '❌ LOST', detail: `Exceeded line at ${current}`, icon: <AlertTriangle className="w-3 h-3" /> };
  }

  const actionLabel = getHedgeActionLabel({
    currentValue: current,
    projectedFinal: projected,
    line,
    side: lean ?? 'OVER',
    gameProgress: edge.remainingMinutes ? Math.max(0, 100 - (edge.remainingMinutes / 48) * 100) : 50,
  });

  const buffer = lean === 'OVER' ? projected - line : line - projected;
  const status = ACTION_TO_STATUS[actionLabel];
  const oppSide = lean === 'OVER' ? 'UNDER' : 'OVER';

  const details: Record<HedgeStatus, () => HedgeResult> = {
    lock: () => ({ status, label: 'LOCK', detail: `Projected to clear by ${buffer.toFixed(1)}`, icon: <Lock className="w-3 h-3" /> }),
    hold: () => ({ status, label: 'HOLD', detail: `On pace (+${buffer.toFixed(1)})`, icon: <CheckCircle2 className="w-3 h-3" /> }),
    monitor: () => ({ status, label: 'MONITOR', detail: `Thin margin (+${buffer.toFixed(1)})`, icon: <Eye className="w-3 h-3" /> }),
    hedge_alert: () => ({ status, label: 'HEDGE ALERT', detail: `Consider ${oppSide} ${line}`, icon: <Shield className="w-3 h-3" /> }),
    hedge_now: () => ({ status, label: 'HEDGE NOW', detail: `Bet ${oppSide} ${line}`, icon: <AlertTriangle className="w-3 h-3" /> }),
    already_hit: () => ({ status: 'already_hit', label: '✅ HIT', detail: '', icon: <CheckCircle2 className="w-3 h-3" /> }),
    line_exceeded: () => ({ status: 'line_exceeded', label: '❌ LOST', detail: '', icon: <AlertTriangle className="w-3 h-3" /> }),
  };

  return details[status]();
}

const STATUS_STYLES: Record<HedgeStatus, string> = {
  lock: 'bg-chart-2/15 text-chart-2 border-chart-2/30',
  hold: 'bg-chart-2/10 text-chart-2 border-chart-2/20',
  monitor: 'bg-chart-3/10 text-chart-3 border-chart-3/20',
  hedge_alert: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  hedge_now: 'bg-destructive/10 text-destructive border-destructive/20',
  already_hit: 'bg-chart-2/15 text-chart-2 border-chart-2/30',
  line_exceeded: 'bg-destructive/15 text-destructive border-destructive/30',
};

export function PropHedgeIndicator({ edge }: { edge: PropEdge }) {
  const result = calcHedgeStatus(edge);
  if (!result) return null;

  return (
    <div className={cn(
      "flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium border mt-1.5",
      STATUS_STYLES[result.status]
    )}>
      {result.icon}
      <span className="font-bold">{result.label}</span>
      <span className="opacity-80">— {result.detail}</span>
    </div>
  );
}
