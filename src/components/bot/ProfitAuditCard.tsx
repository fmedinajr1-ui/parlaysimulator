import React from 'react';
import { format, parseISO } from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { TrendingUp, TrendingDown, Target, Calendar, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useProfitAudit } from '@/hooks/useProfitAudit';

function fmt$(n: number) {
  return `$${Math.abs(n).toFixed(0)}`;
}

function fmtROI(n: number) {
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
}

function ROICell({ value }: { value: number }) {
  return (
    <span className={cn('font-semibold tabular-nums text-xs', value >= 0 ? 'text-green-400' : 'text-red-400')}>
      {fmtROI(value)}
    </span>
  );
}

const TIER_ORDER = ['execution', 'validation', 'exploration'];

export function ProfitAuditCard() {
  const {
    dailyTierRows,
    tierSummary,
    dowSummary,
    bestTier,
    bestDow,
    totalNetProfit,
    totalStaked,
    overallROI,
    dateRange,
    isLoading,
  } = useProfitAudit();

  // Group rows by date for the table
  const byDate = React.useMemo(() => {
    const map = new Map<string, typeof dailyTierRows>();
    for (const row of dailyTierRows) {
      const arr = map.get(row.parlay_date) ?? [];
      arr.push(row);
      map.set(row.parlay_date, arr);
    }
    // Sort tiers within each date by canonical order
    map.forEach((rows, date) => {
      map.set(date, rows.sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier)));
    });
    return map;
  }, [dailyTierRows]);

  const sortedDates = Array.from(byDate.keys()).sort((a, b) => b.localeCompare(a));

  const tierChartData = tierSummary.map(t => ({ name: t.tierLabel.slice(0, 5), roi: parseFloat(t.roiPct.toFixed(1)) }));
  const dowChartData = dowSummary.map(d => ({ name: d.dowLabel, roi: parseFloat(d.roiPct.toFixed(1)) }));

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Target className="w-4 h-4 text-primary" />
            7-Day Profit Audit
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-10">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const hasData = dailyTierRows.length > 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Target className="w-4 h-4 text-primary" />
            7-Day Profit Audit
          </CardTitle>
          {dateRange.from && (
            <span className="text-[10px] text-muted-foreground">
              {format(parseISO(dateRange.from), 'MMM d')} – {format(parseISO(dateRange.to), 'MMM d')}
            </span>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Section A — Summary Banner */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg bg-muted/40 p-2 text-center">
            <p className="text-[10px] text-muted-foreground mb-0.5">Staked</p>
            <p className="text-sm font-semibold tabular-nums">{fmt$(totalStaked)}</p>
          </div>
          <div className="rounded-lg bg-muted/40 p-2 text-center">
            <p className="text-[10px] text-muted-foreground mb-0.5">Net P&amp;L</p>
            <p className={cn('text-sm font-semibold tabular-nums', totalNetProfit >= 0 ? 'text-green-400' : 'text-red-400')}>
              {totalNetProfit >= 0 ? '+' : '-'}{fmt$(totalNetProfit)}
            </p>
          </div>
          <div className="rounded-lg bg-muted/40 p-2 text-center">
            <p className="text-[10px] text-muted-foreground mb-0.5">ROI</p>
            <p className={cn('text-sm font-semibold tabular-nums', overallROI >= 0 ? 'text-green-400' : 'text-red-400')}>
              {fmtROI(overallROI)}
            </p>
          </div>
        </div>

        {!hasData ? (
          <p className="text-center text-xs text-muted-foreground py-4">No settled parlays in the last 7 days</p>
        ) : (
          <>
            {/* Section B — Daily Breakdown Table */}
            <div className="overflow-x-auto rounded-lg border border-border/50">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/50 bg-muted/30">
                    <th className="text-left px-2 py-1.5 text-muted-foreground font-medium">Date</th>
                    <th className="text-left px-2 py-1.5 text-muted-foreground font-medium">Tier</th>
                    <th className="text-right px-2 py-1.5 text-muted-foreground font-medium">#</th>
                    <th className="text-right px-2 py-1.5 text-muted-foreground font-medium">Staked</th>
                    <th className="text-right px-2 py-1.5 text-muted-foreground font-medium">Net P&amp;L</th>
                    <th className="text-right px-2 py-1.5 text-muted-foreground font-medium">ROI</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedDates.map((date) => {
                    const rows = byDate.get(date)!;
                    return rows.map((row, i) => (
                      <tr
                        key={`${date}-${row.tier}`}
                        className={cn(
                          'border-b border-border/30 last:border-0',
                          i === 0 ? 'bg-muted/10' : ''
                        )}
                      >
                        <td className="px-2 py-1.5 text-muted-foreground">
                          {i === 0 ? format(parseISO(date), 'MMM d') : ''}
                        </td>
                        <td className="px-2 py-1.5 font-medium">{row.tierLabel}</td>
                        <td className="px-2 py-1.5 text-right text-muted-foreground">{row.parlayCount}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{fmt$(row.totalStaked)}</td>
                        <td className={cn('px-2 py-1.5 text-right tabular-nums font-medium',
                          row.netProfit >= 0 ? 'text-green-400' : 'text-red-400')}>
                          {row.netProfit >= 0 ? '+' : '-'}{fmt$(row.netProfit)}
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <ROICell value={row.roiPct} />
                        </td>
                      </tr>
                    ));
                  })}
                </tbody>
              </table>
            </div>

            {/* Section C — Intelligence Panel */}
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Focus Volume Here
              </p>
              <div className="grid grid-cols-2 gap-3">
                {/* Best Tier */}
                <div className="rounded-xl border border-border/50 bg-muted/20 p-3 space-y-2">
                  <div className="flex items-center gap-1.5">
                    <TrendingUp className="w-3.5 h-3.5 text-primary" />
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Best Tier</span>
                  </div>
                  {bestTier ? (
                    <>
                      <div>
                        <p className="text-sm font-bold leading-tight">{bestTier.tierLabel}</p>
                        <p className={cn('text-lg font-bold tabular-nums', bestTier.roiPct >= 0 ? 'text-green-400' : 'text-red-400')}>
                          {fmtROI(bestTier.roiPct)}
                        </p>
                        <p className="text-[10px] text-muted-foreground">{bestTier.wins}W / {bestTier.losses}L</p>
                      </div>
                      <div className="h-16">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={tierChartData} margin={{ top: 2, right: 0, left: -20, bottom: 0 }}>
                            <XAxis dataKey="name" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
                            <YAxis hide />
                            <Tooltip
                              contentStyle={{ fontSize: 10, padding: '2px 6px', background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                              formatter={(v: number) => [`${v.toFixed(1)}%`, 'ROI']}
                            />
                            <Bar dataKey="roi" radius={[3, 3, 0, 0]}>
                              {tierChartData.map((entry, idx) => (
                                <Cell key={idx} fill={entry.roi >= 0 ? 'hsl(var(--primary))' : 'hsl(var(--destructive))'} opacity={idx === 0 ? 1 : 0.5} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">No data</p>
                  )}
                </div>

                {/* Best Day-of-Week */}
                <div className="rounded-xl border border-border/50 bg-muted/20 p-3 space-y-2">
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-primary" />
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Best Day</span>
                  </div>
                  {bestDow ? (
                    <>
                      <div>
                        <p className="text-sm font-bold leading-tight">{bestDow.dowFull}</p>
                        <p className={cn('text-lg font-bold tabular-nums', bestDow.roiPct >= 0 ? 'text-green-400' : 'text-red-400')}>
                          {fmtROI(bestDow.roiPct)}
                        </p>
                        <p className="text-[10px] text-muted-foreground">{bestDow.parlayCount} parlays</p>
                      </div>
                      <div className="h-16">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={dowChartData} margin={{ top: 2, right: 0, left: -20, bottom: 0 }}>
                            <XAxis dataKey="name" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
                            <YAxis hide />
                            <Tooltip
                              contentStyle={{ fontSize: 10, padding: '2px 6px', background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                              formatter={(v: number) => [`${v.toFixed(1)}%`, 'ROI']}
                            />
                            <Bar dataKey="roi" radius={[3, 3, 0, 0]}>
                              {dowChartData.map((entry, idx) => (
                                <Cell key={idx} fill={entry.roi >= 0 ? 'hsl(var(--primary))' : 'hsl(var(--destructive))'} opacity={idx === 0 ? 1 : 0.5} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">No data</p>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
