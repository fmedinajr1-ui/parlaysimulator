import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Target, DollarSign } from "lucide-react";
import { cn } from "@/lib/utils";

interface StraightBet {
  id: string;
  bet_date: string;
  player_name: string;
  prop_type: string;
  line: number;
  side: string;
  l10_hit_rate: number;
  simulated_stake: number;
  simulated_payout: number;
  outcome: string;
  profit_loss: number;
  bet_type?: string;
  ceiling_line?: number;
  standard_line?: number;
  h2h_boost?: number;
  ceiling_reason?: string;
}

const PROP_LABELS: Record<string, string> = {
  threes: '3PT', points: 'PTS', assists: 'AST', rebounds: 'REB',
  steals: 'STL', blocks: 'BLK', turnovers: 'TO', pra: 'PRA',
  three_pointers_made: '3PT', player_points: 'PTS', player_rebounds: 'REB',
  player_assists: 'AST', player_threes: '3PT',
};

export function StraightBetsPnLCard() {
  const { data: bets, isLoading } = useQuery({
    queryKey: ['straight-bets-pnl'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bot_straight_bets')
        .select('*')
        .order('bet_date', { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data || []) as StraightBet[];
    },
    refetchInterval: 60000,
  });

  if (isLoading || !bets) {
    return null;
  }

  const totalBets = bets.length;
  const standardBets = bets.filter(b => b.bet_type !== 'ceiling_straight');
  const ceilingBets = bets.filter(b => b.bet_type === 'ceiling_straight');
  const settled = bets.filter(b => b.outcome !== 'pending');
  const won = settled.filter(b => b.outcome === 'won').length;
  const lost = settled.filter(b => b.outcome === 'lost').length;
  const pending = bets.filter(b => b.outcome === 'pending');
  const winRate = settled.length > 0 ? (won / settled.length) * 100 : 0;
  const totalPnL = settled.reduce((sum, b) => sum + (b.profit_loss || 0), 0);
  const totalStaked = settled.reduce((sum, b) => sum + (b.simulated_stake || 0), 0);
  const roi = totalStaked > 0 ? (totalPnL / totalStaked) * 100 : 0;

  // Today's bets
  const today = new Date().toISOString().split('T')[0];
  const todayBets = bets.filter(b => b.bet_date === today);
  const todayStandard = todayBets.filter(b => b.bet_type !== 'ceiling_straight');
  const todayCeiling = todayBets.filter(b => b.bet_type === 'ceiling_straight');
  const todayPending = todayBets.filter(b => b.outcome === 'pending').length;
  const todayWon = todayBets.filter(b => b.outcome === 'won').length;
  const todayLost = todayBets.filter(b => b.outcome === 'lost').length;
  const todayPnL = todayBets.reduce((sum, b) => sum + (b.profit_loss || 0), 0);
  const todayRisk = todayBets.reduce((sum, b) => sum + (b.simulated_stake || 0), 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Target className="w-4 h-4" />
            Straight Bets P&L
          </CardTitle>
          <Badge variant="outline" className="text-xs">
            {won}W-{lost}L ({winRate.toFixed(0)}%)
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center p-2 rounded-lg bg-muted/40">
            <p className="text-xs text-muted-foreground">Total P&L</p>
            <p className={cn("text-lg font-bold", totalPnL >= 0 ? "text-green-500" : "text-red-500")}>
              {totalPnL >= 0 ? '+' : ''}${totalPnL.toFixed(0)}
            </p>
          </div>
          <div className="text-center p-2 rounded-lg bg-muted/40">
            <p className="text-xs text-muted-foreground">ROI</p>
            <p className={cn("text-lg font-bold", roi >= 0 ? "text-green-500" : "text-red-500")}>
              {roi >= 0 ? '+' : ''}{roi.toFixed(1)}%
            </p>
          </div>
          <div className="text-center p-2 rounded-lg bg-muted/40">
            <p className="text-xs text-muted-foreground">Win Rate</p>
            <p className="text-lg font-bold">{winRate.toFixed(0)}%</p>
          </div>
        </div>

        {/* Today's picks */}
        {todayBets.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Today — ${todayRisk} risk · {todayPending} pending
            </p>
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {todayStandard.map(bet => {
                const label = PROP_LABELS[bet.prop_type] || bet.prop_type;
                return (
                  <div key={bet.id} className="flex items-center justify-between text-sm py-1.5 px-2 rounded-lg bg-muted/20">
                    <div className="flex items-center gap-2 min-w-0">
                      {bet.outcome === 'won' && <TrendingUp className="w-3.5 h-3.5 text-green-500 shrink-0" />}
                      {bet.outcome === 'lost' && <TrendingDown className="w-3.5 h-3.5 text-red-500 shrink-0" />}
                      {bet.outcome === 'pending' && <DollarSign className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                      <span className="truncate font-medium">{bet.player_name}</span>
                      <span className="text-muted-foreground text-xs shrink-0">
                        {bet.side} {bet.line} {label}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-muted-foreground">{bet.l10_hit_rate}%</span>
                      <span className="text-xs font-medium">${bet.simulated_stake}</span>
                      {bet.outcome !== 'pending' && (
                        <span className={cn("text-xs font-bold", (bet.profit_loss || 0) >= 0 ? "text-green-500" : "text-red-500")}>
                          {(bet.profit_loss || 0) >= 0 ? '+' : ''}${(bet.profit_loss || 0).toFixed(0)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
              {todayCeiling.length > 0 && (
                <>
                  <p className="text-xs font-semibold uppercase tracking-wider text-orange-400 mt-2 mb-1 flex items-center gap-1">
                    🚀 Ceiling Straights ({todayCeiling.length})
                  </p>
                  {todayCeiling.map(bet => {
                    const label = PROP_LABELS[bet.prop_type] || bet.prop_type;
                    return (
                      <div key={bet.id} className="flex items-center justify-between text-sm py-1.5 px-2 rounded-lg bg-orange-500/10 border border-orange-500/20">
                        <div className="flex items-center gap-2 min-w-0">
                          {bet.outcome === 'won' && <TrendingUp className="w-3.5 h-3.5 text-green-500 shrink-0" />}
                          {bet.outcome === 'lost' && <TrendingDown className="w-3.5 h-3.5 text-red-500 shrink-0" />}
                          {bet.outcome === 'pending' && <DollarSign className="w-3.5 h-3.5 text-orange-400 shrink-0" />}
                          <span className="truncate font-medium">{bet.player_name}</span>
                          <span className="text-muted-foreground text-xs shrink-0">
                            OVER {bet.ceiling_line || bet.line} {label}
                          </span>
                          {bet.standard_line && (
                            <span className="text-xs text-muted-foreground/60 shrink-0">
                              (book: {bet.standard_line})
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {bet.h2h_boost && <span className="text-xs text-orange-400">+{bet.h2h_boost}H2H</span>}
                          <span className="text-xs font-medium">${bet.simulated_stake}</span>
                          {bet.outcome !== 'pending' && (
                            <span className={cn("text-xs font-bold", (bet.profit_loss || 0) >= 0 ? "text-green-500" : "text-red-500")}>
                              {(bet.profit_loss || 0) >= 0 ? '+' : ''}${(bet.profit_loss || 0).toFixed(0)}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
            {todayBets.some(b => b.outcome !== 'pending') && (
              <div className="mt-2 pt-2 border-t border-border/50 flex justify-between text-sm">
                <span className="text-muted-foreground">Today's P&L</span>
                <span className={cn("font-bold", todayPnL >= 0 ? "text-green-500" : "text-red-500")}>
                  {todayPnL >= 0 ? '+' : ''}${todayPnL.toFixed(0)}
                </span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
