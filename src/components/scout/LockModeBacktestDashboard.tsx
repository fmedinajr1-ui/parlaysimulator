import React, { useState } from 'react';
import { format, subDays } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { CalendarIcon, Play, CheckCircle, XCircle, MinusCircle, Target, TrendingUp, Shield, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLockModeBacktest, type BacktestRun, type BacktestSlip } from '@/hooks/useLockModeBacktest';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

const GATE_COLORS: Record<string, string> = {
  minutes: 'hsl(var(--chart-1))',
  statType: 'hsl(var(--chart-2))',
  edge: 'hsl(var(--chart-3))',
  under: 'hsl(var(--chart-4))',
  confidence: 'hsl(var(--chart-5))',
};

const GATE_LABELS: Record<string, string> = {
  minutes: 'Minutes Gate',
  statType: 'Stat Type Gate',
  edge: 'Edge vs Uncertainty',
  under: 'UNDER Rules',
  confidence: 'Confidence Filter',
};

export function LockModeBacktestDashboard() {
  const [dateStart, setDateStart] = useState<Date>(subDays(new Date(), 14));
  const [dateEnd, setDateEnd] = useState<Date>(new Date());
  const [selectedRun, setSelectedRun] = useState<BacktestRun | null>(null);
  const [slips, setSlips] = useState<BacktestSlip[]>([]);
  const [loadingSlips, setLoadingSlips] = useState(false);

  const { runs, runsLoading, isRunning, runBacktest, fetchSlips } = useLockModeBacktest();

  const handleRunBacktest = () => {
    runBacktest.mutate({
      dateStart: format(dateStart, 'yyyy-MM-dd'),
      dateEnd: format(dateEnd, 'yyyy-MM-dd'),
    });
  };

  const handleSelectRun = async (run: BacktestRun) => {
    setSelectedRun(run);
    setLoadingSlips(true);
    try {
      const slipData = await fetchSlips(run.id);
      setSlips(slipData);
    } catch (error) {
      console.error('Failed to fetch slips:', error);
    }
    setLoadingSlips(false);
  };

  const gateChartData = selectedRun?.gate_block_stats
    ? Object.entries(selectedRun.gate_block_stats).map(([key, value]) => ({
        name: GATE_LABELS[key] || key,
        blocked: value,
        key,
      }))
    : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="border-primary/20 bg-gradient-to-br from-background to-muted/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Lock Mode Backtester
          </CardTitle>
          <CardDescription>
            Simulate 4-Gate Filtering on Historical Data to Validate 42%+ Win Rate
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            {/* Start Date */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Start Date</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-[180px] justify-start">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(dateStart, 'MMM d, yyyy')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={dateStart}
                    onSelect={(d) => d && setDateStart(d)}
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* End Date */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">End Date</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-[180px] justify-start">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(dateEnd, 'MMM d, yyyy')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={dateEnd}
                    onSelect={(d) => d && setDateEnd(d)}
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* Run Button */}
            <Button 
              onClick={handleRunBacktest} 
              disabled={isRunning}
              className="gap-2"
            >
              {isRunning ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Running...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" />
                  Run Backtest
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Main Content */}
      <Tabs defaultValue="results" className="space-y-4">
        <TabsList>
          <TabsTrigger value="results">Results</TabsTrigger>
          <TabsTrigger value="history">Run History</TabsTrigger>
        </TabsList>

        <TabsContent value="results" className="space-y-4">
          {selectedRun ? (
            <>
              {/* Headline Stats */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className={cn(
                  "border-2",
                  selectedRun.leg_hit_rate >= 75 ? "border-green-500/50 bg-green-500/5" : "border-yellow-500/50 bg-yellow-500/5"
                )}>
                  <CardContent className="pt-6">
                    <div className="text-center">
                      <TrendingUp className="h-8 w-8 mx-auto mb-2 text-green-500" />
                      <div className="text-3xl font-bold">{selectedRun.leg_hit_rate.toFixed(1)}%</div>
                      <div className="text-sm text-muted-foreground">Leg Hit Rate</div>
                      <div className="text-xs text-muted-foreground mt-1">(Target: 75%+)</div>
                    </div>
                  </CardContent>
                </Card>

                <Card className={cn(
                  "border-2",
                  selectedRun.parlay_win_rate >= 42 ? "border-green-500/50 bg-green-500/5" : "border-yellow-500/50 bg-yellow-500/5"
                )}>
                  <CardContent className="pt-6">
                    <div className="text-center">
                      <Target className="h-8 w-8 mx-auto mb-2 text-primary" />
                      <div className="text-3xl font-bold">{selectedRun.parlay_win_rate.toFixed(1)}%</div>
                      <div className="text-sm text-muted-foreground">Parlay Win Rate</div>
                      <div className="text-xs text-muted-foreground mt-1">(Target: 42%+)</div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="pt-6">
                    <div className="text-center">
                      <Shield className="h-8 w-8 mx-auto mb-2 text-blue-500" />
                      <div className="text-3xl font-bold">
                        {selectedRun.slips_generated} / {selectedRun.total_slates}
                      </div>
                      <div className="text-sm text-muted-foreground">Slips Generated</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        ({selectedRun.slips_passed} passed)
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Gate Blocking Chart */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Gate Blocking Effectiveness</CardTitle>
                  <CardDescription>
                    How many candidates each gate filtered out
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-[200px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={gateChartData} layout="vertical">
                        <XAxis type="number" />
                        <YAxis type="category" dataKey="name" width={120} />
                        <Tooltip />
                        <Bar dataKey="blocked" radius={[0, 4, 4, 0]}>
                          {gateChartData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={GATE_COLORS[entry.key]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              {/* Daily Results Table */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Daily Results</CardTitle>
                </CardHeader>
                <CardContent>
                  {loadingSlips ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    <ScrollArea className="h-[400px]">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Date</TableHead>
                            <TableHead>Valid</TableHead>
                            <TableHead>Legs</TableHead>
                            <TableHead>Outcome</TableHead>
                            <TableHead>Missing Slots</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {slips.map((slip) => (
                            <TableRow key={slip.id}>
                              <TableCell className="font-medium">
                                {format(new Date(slip.slate_date), 'MMM d, yyyy')}
                              </TableCell>
                              <TableCell>
                                {slip.slip_valid ? (
                                  <Badge variant="default" className="bg-green-500">Yes</Badge>
                                ) : (
                                  <Badge variant="secondary">No</Badge>
                                )}
                              </TableCell>
                              <TableCell>
                                {slip.slip_valid ? (
                                  <div className="flex items-center gap-1">
                                    <span className="text-green-500">{slip.legs_hit}</span>
                                    <span className="text-muted-foreground">/</span>
                                    <span className="text-red-500">{slip.legs_missed}</span>
                                    {slip.legs_pushed > 0 && (
                                      <>
                                        <span className="text-muted-foreground">/</span>
                                        <span className="text-yellow-500">{slip.legs_pushed}P</span>
                                      </>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </TableCell>
                              <TableCell>
                                {slip.slip_valid ? (
                                  slip.all_legs_hit ? (
                                    <Badge className="bg-green-500 gap-1">
                                      <CheckCircle className="h-3 w-3" />
                                      WIN
                                    </Badge>
                                  ) : (
                                    <Badge variant="destructive" className="gap-1">
                                      <XCircle className="h-3 w-3" />
                                      LOSS
                                    </Badge>
                                  )
                                ) : (
                                  <Badge variant="outline" className="gap-1">
                                    <MinusCircle className="h-3 w-3" />
                                    PASS
                                  </Badge>
                                )}
                              </TableCell>
                              <TableCell>
                                {slip.missing_slots.length > 0 ? (
                                  <div className="flex flex-wrap gap-1">
                                    {slip.missing_slots.map((slot) => (
                                      <Badge key={slot} variant="outline" className="text-xs">
                                        {slot}
                                      </Badge>
                                    ))}
                                  </div>
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                  )}
                </CardContent>
              </Card>
            </>
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Shield className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Run a backtest or select a previous run to see results</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle>Previous Backtest Runs</CardTitle>
            </CardHeader>
            <CardContent>
              {runsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : runs && runs.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Run Name</TableHead>
                      <TableHead>Date Range</TableHead>
                      <TableHead>Slips</TableHead>
                      <TableHead>Leg Hit %</TableHead>
                      <TableHead>Parlay Win %</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runs.map((run) => (
                      <TableRow 
                        key={run.id}
                        className={cn(
                          "cursor-pointer hover:bg-muted/50",
                          selectedRun?.id === run.id && "bg-muted"
                        )}
                        onClick={() => handleSelectRun(run)}
                      >
                        <TableCell className="font-medium">
                          {run.run_name || 'Unnamed Run'}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {format(new Date(run.date_range_start), 'MMM d')} - {format(new Date(run.date_range_end), 'MMM d, yyyy')}
                        </TableCell>
                        <TableCell>
                          {run.slips_generated} / {run.total_slates}
                        </TableCell>
                        <TableCell>
                          <Badge variant={run.leg_hit_rate >= 75 ? "default" : "secondary"}>
                            {run.leg_hit_rate.toFixed(1)}%
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={run.parlay_win_rate >= 42 ? "default" : "secondary"}>
                            {run.parlay_win_rate.toFixed(1)}%
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {format(new Date(run.created_at), 'MMM d, h:mm a')}
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm">View</Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="py-8 text-center text-muted-foreground">
                  No backtest runs yet. Run your first backtest above.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
