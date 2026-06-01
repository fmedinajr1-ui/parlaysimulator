import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAdminRole } from "@/hooks/useAdminRole";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, RefreshCw, Radar } from "lucide-react";
import {
  CRAWLER_CATEGORIES,
  CRAWLER_JOB_NAMES,
  CrawlerCategory,
  getJobCategory,
} from "@/lib/crawlerJobs";
import {
  CrawlerRunsTable,
  type CrawlerRun,
} from "@/components/admin/CrawlerRunsTable";
import { CrawlerSummaryStrip } from "@/components/admin/CrawlerSummaryStrip";

const STATUS_OPTIONS = ["all", "completed", "failed", "no_data", "running"] as const;
type StatusFilter = (typeof STATUS_OPTIONS)[number];

export default function CrawlerRunsPage() {
  const { isAdmin, isLoading: authLoading } = useAdminRole();
  const [category, setCategory] = useState<"all" | CrawlerCategory>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);

  const since24h = useMemo(
    () => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    [],
  );

  const { data: recentRuns, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["crawler-runs-recent"],
    enabled: isAdmin,
    refetchInterval: autoRefresh ? 30_000 : false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cron_job_history")
        .select("*")
        .in("job_name", CRAWLER_JOB_NAMES)
        .order("started_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data as CrawlerRun[]) || [];
    },
  });

  const { data: last24h } = useQuery({
    queryKey: ["crawler-runs-24h", since24h],
    enabled: isAdmin,
    refetchInterval: autoRefresh ? 60_000 : false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cron_job_history")
        .select("status,duration_ms,started_at")
        .in("job_name", CRAWLER_JOB_NAMES)
        .gte("started_at", since24h)
        .limit(2000);
      if (error) throw error;
      return (data as { status: string; duration_ms: number | null }[]) || [];
    },
  });

  const filtered = useMemo(() => {
    const all = recentRuns ?? [];
    return all.filter((r) => {
      if (category !== "all" && getJobCategory(r.job_name) !== category) return false;
      if (status !== "all" && r.status !== status) return false;
      if (search && !r.job_name.toLowerCase().includes(search.toLowerCase()))
        return false;
      return true;
    });
  }, [recentRuns, category, status, search]);

  const latestPerJob = useMemo(() => {
    const seen = new Set<string>();
    const out: CrawlerRun[] = [];
    for (const r of filtered) {
      if (seen.has(r.job_name)) continue;
      seen.add(r.job_name);
      out.push(r);
    }
    return out;
  }, [filtered]);

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAdmin) {
    return <Navigate to="/admin-login" replace />;
  }

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6 max-w-7xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Radar className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Crawler & Odds Builder Runs</h1>
            <p className="text-sm text-muted-foreground">
              Latest scraper, fetcher, and builder executions from{" "}
              <code>cron_job_history</code>.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch
              id="auto-refresh"
              checked={autoRefresh}
              onCheckedChange={setAutoRefresh}
            />
            <label htmlFor="auto-refresh" className="text-xs text-muted-foreground">
              Auto 30s
            </label>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isRefetching}
          >
            <RefreshCw
              className={`h-4 w-4 mr-1 ${isRefetching ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </div>
      </div>

      <CrawlerSummaryStrip runs={last24h ?? []} />

      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <div className="min-w-[180px]">
            <Select
              value={category}
              onValueChange={(v) => setCategory(v as typeof category)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {CRAWLER_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[180px]">
            <Select
              value={status}
              onValueChange={(v) => setStatus(v as StatusFilter)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s === "all" ? "All statuses" : s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Input
            placeholder="Search job name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Latest run per job</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <CrawlerRunsTable
              runs={latestPerJob}
              emptyMessage="No crawler jobs match these filters yet."
            />
          )}
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Recent run history{" "}
            <span className="text-xs text-muted-foreground font-normal">
              (last {filtered.length})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <CrawlerRunsTable runs={filtered.slice(0, 100)} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}