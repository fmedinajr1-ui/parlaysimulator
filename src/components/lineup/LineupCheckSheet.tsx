import React from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { 
  AlertTriangle, 
  CheckCircle2, 
  Clock, 
  XCircle,
  Activity,
  User
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { LineupAlert } from '@/hooks/useLineupCheck';
import { formatDistanceToNow } from 'date-fns';

interface LineupCheckSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  alerts: LineupAlert[];
  lastChecked: Date | null;
}

const RECOMMENDATION_CONFIG: Record<string, {
  icon: React.ElementType;
  label: string;
  className: string;
  description: string;
}> = {
  AVOID: {
    icon: XCircle,
    label: 'Avoid',
    className: 'bg-red-500/20 text-red-400 border-red-500/30',
    description: 'Player confirmed out or very unlikely to play',
  },
  WAIT: {
    icon: Clock,
    label: 'Wait',
    className: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    description: 'Check closer to game time for updates',
  },
  CAUTION: {
    icon: AlertTriangle,
    label: 'Caution',
    className: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    description: 'Some risk - monitor for changes',
  },
  PROCEED: {
    icon: CheckCircle2,
    label: 'Proceed',
    className: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    description: 'Player expected to play as normal',
  },
};

function PlayerAlertRow({ alert }: { alert: LineupAlert }) {
  const recConfig = RECOMMENDATION_CONFIG[alert.recommendation] || RECOMMENDATION_CONFIG.CAUTION;
  const RecIcon = recConfig.icon;

  return (
    <div className="p-3 rounded-lg bg-card/50 border border-border/50 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <User className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">{alert.playerName}</span>
        </div>
        <Badge 
          variant="outline"
          className={cn('gap-1 text-xs', recConfig.className)}
        >
          <RecIcon className="h-3 w-3" />
          {recConfig.label}
        </Badge>
      </div>

      <p className="text-sm text-muted-foreground">
        {alert.message}
      </p>

      {alert.injuryNote && (
        <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 rounded p-2">
          <Activity className="h-3 w-3 mt-0.5 shrink-0" />
          <span>{alert.injuryNote}</span>
        </div>
      )}

      <div className="flex items-center gap-2 text-xs">
        <Badge 
          variant="outline" 
          className={cn(
            'text-[10px]',
            alert.riskLevel === 'critical' && 'bg-red-500/20 text-red-400',
            alert.riskLevel === 'high' && 'bg-amber-500/20 text-amber-400',
            alert.riskLevel === 'medium' && 'bg-yellow-500/20 text-yellow-400',
            alert.riskLevel === 'low' && 'bg-emerald-500/15 text-emerald-400',
            alert.riskLevel === 'none' && 'bg-emerald-500/20 text-emerald-400',
          )}
        >
          {alert.riskLevel.toUpperCase()} RISK
        </Badge>
        {alert.isStarting && (
          <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary">
            STARTER
          </Badge>
        )}
      </div>
    </div>
  );
}

export function LineupCheckSheet({ 
  open, 
  onOpenChange, 
  alerts,
  lastChecked 
}: LineupCheckSheetProps) {
  const criticalAlerts = alerts.filter(a => a.riskLevel === 'critical');
  const highAlerts = alerts.filter(a => a.riskLevel === 'high');
  const otherAlerts = alerts.filter(a => !['critical', 'high'].includes(a.riskLevel));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            Lineup Status
          </SheetTitle>
          <SheetDescription>
            {lastChecked 
              ? `Last checked ${formatDistanceToNow(lastChecked, { addSuffix: true })}`
              : 'Check player availability before placing bets'
            }
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-140px)] mt-4 pr-4">
          {alerts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Activity className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No lineup data checked yet</p>
              <p className="text-sm mt-1">Click "Check Lineups" to fetch status</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Critical alerts */}
              {criticalAlerts.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-red-400">
                    <XCircle className="h-4 w-4" />
                    <span className="text-sm font-semibold">
                      Critical - {criticalAlerts.length} player(s) OUT
                    </span>
                  </div>
                  {criticalAlerts.map((alert, i) => (
                    <PlayerAlertRow key={i} alert={alert} />
                  ))}
                </div>
              )}

              {/* High risk alerts */}
              {highAlerts.length > 0 && (
                <>
                  {criticalAlerts.length > 0 && <Separator />}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-amber-400">
                      <AlertTriangle className="h-4 w-4" />
                      <span className="text-sm font-semibold">
                        GTD/Questionable - {highAlerts.length} player(s)
                      </span>
                    </div>
                    {highAlerts.map((alert, i) => (
                      <PlayerAlertRow key={i} alert={alert} />
                    ))}
                  </div>
                </>
              )}

              {/* Other alerts */}
              {otherAlerts.length > 0 && (
                <>
                  {(criticalAlerts.length > 0 || highAlerts.length > 0) && <Separator />}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <CheckCircle2 className="h-4 w-4" />
                      <span className="text-sm font-semibold">
                        Other Players - {otherAlerts.length}
                      </span>
                    </div>
                    {otherAlerts.map((alert, i) => (
                      <PlayerAlertRow key={i} alert={alert} />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
