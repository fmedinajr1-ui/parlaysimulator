import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format, parseISO } from 'date-fns';
import { CheckCircle, XCircle, Clock, Minus, Loader2, Calendar } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MobileDetailDrawer } from '@/components/ui/mobile-detail-drawer';
import { cn } from '@/lib/utils';

interface DayParlayDetailProps {
  date: string | null; // 'yyyy-MM-dd'
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface BotLeg {
  player_name?: string;
  prop_type?: string;
  line?: number;
  side?: string;
  category?: string;
  outcome?: string;
  actual_value?: number;
  american_odds?: number;
  type?: string;
  home_team?: string;
  away_team?: string;
  bet_type?: string;
}

export function DayParlayDetail({ date, open, onOpenChange }: DayParlayDetailProps) {
  const { data: parlays = [], isLoading } = useQuery({
    queryKey: ['bot-day-parlays', date],
    queryFn: async () => {
      if (!date) return [];
      const { data, error } = await supabase
        .from('bot_daily_parlays')
        .select('*')
        .eq('parlay_date', date)
        .order('created_at', { ascending: true });

      if (error) throw error;
      return (data || []).map(p => ({
        ...p,
        legs: Array.isArray(p.legs) ? p.legs : JSON.parse(p.legs as string),
      }));
    },
    enabled: !!date && open,
  });

  const won = parlays.filter(p => p.outcome === 'won').length;
  const lost = parlays.filter(p => p.outcome === 'lost').length;
  const totalPnL = parlays.reduce((s, p) => s + (p.profit_loss || 0), 0);

  const getOutcomeIcon = (outcome: string) => {
    switch (outcome) {
      case 'won': return <CheckCircle className="w-3.5 h-3.5 text-green-400" />;
      case 'lost': return <XCircle className="w-3.5 h-3.5 text-red-400" />;
      case 'push': return <Minus className="w-3.5 h-3.5 text-blue-400" />;
      case 'void': return <Minus className="w-3.5 h-3.5 text-muted-foreground" />;
      default: return <Clock className="w-3.5 h-3.5 text-muted-foreground" />;
    }
  };

  const formattedDate = date ? format(parseISO(date), 'EEEE, MMM d') : '';

  return (
    <MobileDetailDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={formattedDate}
      description={parlays.length > 0 ? `${won}W - ${lost}L • ${totalPnL >= 0 ? '+' : ''}$${totalPnL.toFixed(0)}` : 'No parlays'}
      icon={<Calendar className="w-5 h-5" />}
      iconColorClass="text-primary"
    >
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : parlays.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-8">No parlays on this day</p>
      ) : (
        <ScrollArea className="max-h-[50vh]">
          <div className="space-y-3">
            {parlays.map((parlay) => {
              const legs = parlay.legs as BotLeg[];
              return (
                <div
                  key={parlay.id}
                  className={cn(
                    'rounded-lg border p-3 space-y-2',
                    parlay.outcome === 'won' && 'border-green-500/30 bg-green-500/5',
                    parlay.outcome === 'lost' && 'border-red-500/30 bg-red-500/5',
                    parlay.outcome === 'pending' && 'border-border/50',
                  )}
                >
                  {/* Header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {getOutcomeIcon(parlay.outcome || 'pending')}
                      <Badge variant="outline" className="text-[10px] capitalize">
                        {parlay.outcome || 'pending'}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{parlay.leg_count}L</span>
                    </div>
                    <span className={cn(
                      'text-xs font-medium',
                      (parlay.profit_loss || 0) >= 0 ? 'text-green-400' : 'text-red-400'
                    )}>
                      {(parlay.profit_loss || 0) >= 0 ? '+' : ''}${(parlay.profit_loss || 0).toFixed(0)}
                    </span>
                  </div>

                  {/* Legs */}
                  <div className="space-y-1">
                    {legs.map((leg, idx) => {
                      const isTeam = leg.type === 'team' || (!!leg.home_team && !!leg.away_team);
                      const name = isTeam
                        ? (leg.bet_type === 'total' && leg.home_team && leg.away_team
                          ? `${leg.home_team} vs ${leg.away_team}`
                          : leg.side === 'home' ? leg.home_team : leg.away_team) || leg.category || 'Team'
                        : leg.player_name || 'Unknown';

                      return (
                        <div key={idx} className="flex items-center justify-between text-xs py-0.5">
                          <div className="flex items-center gap-1.5 flex-1 min-w-0">
                            {leg.outcome === 'hit' && <CheckCircle className="w-3 h-3 text-green-400 shrink-0" />}
                            {leg.outcome === 'miss' && <XCircle className="w-3 h-3 text-red-400 shrink-0" />}
                            {leg.outcome === 'push' && <Minus className="w-3 h-3 text-blue-400 shrink-0" />}
                            {!leg.outcome && <Clock className="w-3 h-3 text-muted-foreground shrink-0" />}
                            <span className="truncate">{name}</span>
                            <span className="text-muted-foreground shrink-0">
                              {isTeam
                                ? `${(leg.bet_type || 'spread')} ${leg.line || 0}`
                                : `${leg.prop_type || ''} ${(leg.side || 'O').charAt(0).toUpperCase()} ${leg.line || 0}`}
                            </span>
                          </div>
                          {leg.actual_value != null && (
                            <span className="text-muted-foreground ml-2 shrink-0">
                              ({leg.actual_value})
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Footer */}
                  <div className="text-[10px] text-muted-foreground flex items-center justify-between pt-1 border-t border-border/30">
                    <span>{parlay.strategy_name}</span>
                    <span>{parlay.legs_hit || 0} hit / {parlay.legs_missed || 0} missed</span>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      )}
    </MobileDetailDrawer>
  );
}
