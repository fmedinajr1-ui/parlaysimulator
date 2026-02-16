import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatsCard, StatItem, StatsGrid } from '@/components/ui/stats-card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from '@/components/ui/table';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { AreaChart, Area, XAxis, YAxis, BarChart, Bar, CartesianGrid } from 'recharts';
import { Loader2, Users, Eye, MousePointerClick, Percent, Activity, Clock, Target } from 'lucide-react';
import { format, subDays, parseISO } from 'date-fns';

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
    const ctaClicks = events.filter(e => e.event_type === 'cta_click');
    const timeEvents = events.filter(e => e.event_type === 'time_on_page');
    const uniqueFingerprints = new Set(events.map(e => e.device_fingerprint).filter(Boolean));
    const uniqueVisitors = uniqueFingerprints.size;
    const conversionRate = uniqueVisitors > 0 ? (subClicks.length / uniqueVisitors) * 100 : 0;

    const avgTime = timeEvents.length > 0
      ? timeEvents.reduce((sum, e) => sum + (Number((e.metadata as Record<string, unknown>)?.duration_seconds) || 0), 0) / timeEvents.length
      : 0;

    return {
      uniqueVisitors,
      totalPageViews: pageViews.length,
      subscribeClicks: subClicks.length,
      conversionRate,
      ctaClicks: ctaClicks.length,
      avgTimeOnPage: Math.round(avgTime),
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
      { stage: 'CTA Clicks', count: stats.ctaClicks },
      { stage: 'Sub Clicks', count: stats.subscribeClicks },
    ];
  }, [stats]);

  const ctaBreakdown = useMemo(() => {
    const ctaEvents = events.filter(e => e.event_type === 'cta_click');
    const counts: Record<string, number> = {};
    ctaEvents.forEach(e => {
      const label = String((e.metadata as Record<string, unknown>)?.label || 'unknown');
      counts[label] = (counts[label] || 0) + 1;
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => ({ label, count }));
  }, [events]);

  const sectionReach = useMemo(() => {
    const sectionEvents = events.filter(e => e.event_type === 'section_view');
    const uniqueVisitors = new Set(events.map(e => e.device_fingerprint).filter(Boolean)).size;
    const sections: Record<string, Set<string>> = {};
    sectionEvents.forEach(e => {
      const section = String((e.metadata as Record<string, unknown>)?.section || 'unknown');
      if (!sections[section]) sections[section] = new Set();
      if (e.device_fingerprint) sections[section].add(e.device_fingerprint);
    });
    const order = ['hero_stats', 'performance_calendar', 'why_multiple_parlays', 'pricing'];
    return order
      .filter(s => sections[s])
      .map(section => ({
        section,
        viewers: sections[section].size,
        percentage: uniqueVisitors > 0 ? Math.round((sections[section].size / uniqueVisitors) * 100) : 0,
      }));
  }, [events]);

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

  const formatTime = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
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
      <StatsGrid columns={2} className="sm:grid-cols-3 lg:grid-cols-6">
        <StatsCard>
          <StatItem label="Unique Visitors" value={stats.uniqueVisitors} icon={<Users className="w-5 h-5 text-primary" />} />
        </StatsCard>
        <StatsCard>
          <StatItem label="Page Views" value={stats.totalPageViews} icon={<Eye className="w-5 h-5 text-blue-500" />} />
        </StatsCard>
        <StatsCard>
          <StatItem label="CTA Clicks" value={stats.ctaClicks} icon={<MousePointerClick className="w-5 h-5 text-green-500" />} />
        </StatsCard>
        <StatsCard>
          <StatItem label="Sub Clicks" value={stats.subscribeClicks} icon={<Target className="w-5 h-5 text-orange-500" />} />
        </StatsCard>
        <StatsCard>
          <StatItem label="Conversion" value={`${stats.conversionRate.toFixed(1)}%`} icon={<Percent className="w-5 h-5 text-yellow-500" />} />
        </StatsCard>
        <StatsCard>
          <StatItem label="Avg. Time" value={formatTime(stats.avgTimeOnPage)} icon={<Clock className="w-5 h-5 text-purple-500" />} />
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
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Conversion Funnel</CardTitle>
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

      {/* CTA Breakdown + Section Reach */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">CTA Click Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>CTA Label</TableHead>
                  <TableHead className="text-right">Clicks</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ctaBreakdown.length === 0 ? (
                  <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground">No CTA clicks yet</TableCell></TableRow>
                ) : ctaBreakdown.map(({ label, count }) => (
                  <TableRow key={label}>
                    <TableCell className="font-mono text-xs">{label}</TableCell>
                    <TableCell className="text-right">{count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Section Reach</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Section</TableHead>
                  <TableHead className="text-right">Viewers</TableHead>
                  <TableHead className="text-right">% Reached</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sectionReach.length === 0 ? (
                  <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">No section data yet</TableCell></TableRow>
                ) : sectionReach.map(({ section, viewers, percentage }) => (
                  <TableRow key={section}>
                    <TableCell className="font-mono text-xs">{section}</TableCell>
                    <TableCell className="text-right">{viewers}</TableCell>
                    <TableCell className="text-right">{percentage}%</TableCell>
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
                      event.event_type === 'cta_click'
                        ? 'bg-green-500/10 text-green-500'
                        : event.event_type === 'section_view'
                        ? 'bg-blue-500/10 text-blue-500'
                        : event.event_type === 'time_on_page'
                        ? 'bg-purple-500/10 text-purple-500'
                        : event.event_type === 'subscribe_click'
                        ? 'bg-orange-500/10 text-orange-500'
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
