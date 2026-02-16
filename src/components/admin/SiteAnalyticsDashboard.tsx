import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatsCard, StatItem, StatsGrid } from '@/components/ui/stats-card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from '@/components/ui/table';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { AreaChart, Area, XAxis, YAxis, BarChart, Bar, CartesianGrid } from 'recharts';
import { Loader2, Users, Eye, MousePointerClick, Percent, Activity } from 'lucide-react';
import { format, subDays, startOfDay, parseISO } from 'date-fns';

type TimeRange = '7d' | '30d' | '90d';

export function SiteAnalyticsDashboard() {
  const [range, setRange] = useState<TimeRange>('30d');

  const daysMap: Record<TimeRange, number> = { '7d': 7, '30d': 30, '90d': 90 };
  const days = daysMap[range];
  const startDate = subDays(new Date(), days).toISOString();

  const { data: events = [], isLoading } = useQuery({
    queryKey: ['analytics-events', range],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('analytics_events')
        .select('*')
        .gte('created_at', startDate)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const stats = useMemo(() => {
    const pageViews = events.filter(e => e.event_type === 'page_view');
    const subClicks = events.filter(e => e.event_type === 'subscribe_click');
    const uniqueFingerprints = new Set(events.map(e => e.device_fingerprint).filter(Boolean));
    const uniqueVisitors = uniqueFingerprints.size;
    const conversionRate = uniqueVisitors > 0 ? (subClicks.length / uniqueVisitors) * 100 : 0;

    return {
      uniqueVisitors,
      totalPageViews: pageViews.length,
      subscribeClicks: subClicks.length,
      conversionRate,
    };
  }, [events]);

  const dailyPageViews = useMemo(() => {
    const pvEvents = events.filter(e => e.event_type === 'page_view');
    const grouped: Record<string, number> = {};
    for (let i = days - 1; i >= 0; i--) {
      const d = format(subDays(new Date(), i), 'yyyy-MM-dd');
      grouped[d] = 0;
    }
    pvEvents.forEach(e => {
      const d = format(parseISO(e.created_at), 'yyyy-MM-dd');
      if (d in grouped) grouped[d]++;
    });
    return Object.entries(grouped).map(([date, views]) => ({
      date: format(parseISO(date), 'MMM d'),
      views,
    }));
  }, [events, days]);

  const topPages = useMemo(() => {
    const pvEvents = events.filter(e => e.event_type === 'page_view');
    const counts: Record<string, number> = {};
    pvEvents.forEach(e => {
      const p = e.page_path || '/';
      counts[p] = (counts[p] || 0) + 1;
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([path, count]) => ({ path, count }));
  }, [events]);

  const funnelData = useMemo(() => {
    return [
      { stage: 'Page Views', count: stats.totalPageViews },
      { stage: 'Sub Clicks', count: stats.subscribeClicks },
    ];
  }, [stats]);

  const recentEvents = useMemo(() => events.slice(0, 15), [events]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  const chartConfig = {
    views: { label: 'Page Views', color: 'hsl(var(--primary))' },
    count: { label: 'Count', color: 'hsl(var(--primary))' },
  };

  return (
    <div className="space-y-6">
      {/* Time Range */}
      <Tabs value={range} onValueChange={(v) => setRange(v as TimeRange)}>
        <TabsList>
          <TabsTrigger value="7d">7 Days</TabsTrigger>
          <TabsTrigger value="30d">30 Days</TabsTrigger>
          <TabsTrigger value="90d">90 Days</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Summary Cards */}
      <StatsGrid columns={2} className="sm:grid-cols-4">
        <StatsCard>
          <StatItem label="Unique Visitors" value={stats.uniqueVisitors} icon={<Users className="w-5 h-5 text-primary" />} />
        </StatsCard>
        <StatsCard>
          <StatItem label="Page Views" value={stats.totalPageViews} icon={<Eye className="w-5 h-5 text-blue-500" />} />
        </StatsCard>
        <StatsCard>
          <StatItem label="Sub Clicks" value={stats.subscribeClicks} icon={<MousePointerClick className="w-5 h-5 text-green-500" />} />
        </StatsCard>
        <StatsCard>
          <StatItem label="Conversion" value={`${stats.conversionRate.toFixed(1)}%`} icon={<Percent className="w-5 h-5 text-yellow-500" />} />
        </StatsCard>
      </StatsGrid>

      {/* Page Views Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Page Views Over Time</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig} className="h-[250px] w-full">
            <AreaChart data={dailyPageViews}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} className="text-muted-foreground" />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Area type="monotone" dataKey="views" stroke="var(--color-views)" fill="var(--color-views)" fillOpacity={0.15} strokeWidth={2} />
            </AreaChart>
          </ChartContainer>
        </CardContent>
      </Card>

      {/* Funnel + Top Pages */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Funnel */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Subscription Funnel</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[200px] w-full">
              <BarChart data={funnelData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                <XAxis dataKey="stage" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="count" fill="var(--color-count)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* Top Pages */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Top Pages</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Page</TableHead>
                  <TableHead className="text-right">Views</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topPages.length === 0 ? (
                  <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground">No data</TableCell></TableRow>
                ) : topPages.map(({ path, count }) => (
                  <TableRow key={path}>
                    <TableCell className="font-mono text-xs">{path}</TableCell>
                    <TableCell className="text-right">{count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="w-4 h-4" />
            Recent Activity
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead>Page</TableHead>
                <TableHead className="text-right">Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentEvents.length === 0 ? (
                <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">No events yet</TableCell></TableRow>
              ) : recentEvents.map(event => (
                <TableRow key={event.id}>
                  <TableCell>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      event.event_type === 'subscribe_click' 
                        ? 'bg-green-500/10 text-green-500' 
                        : 'bg-primary/10 text-primary'
                    }`}>
                      {event.event_type}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{event.page_path || '/'}</TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {format(parseISO(event.created_at), 'MMM d, h:mm a')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
