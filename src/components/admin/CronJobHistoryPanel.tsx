import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Clock, CheckCircle, XCircle, Loader2, Timer } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface CronJobHistory {
  id: string;
  job_name: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  result: Record<string, unknown> | null;
  error_message: string | null;
  duration_ms: number | null;
}

export function CronJobHistoryPanel() {
  const { data: history, isLoading } = useQuery({
    queryKey: ['cron-job-history'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cron_job_history')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(20);
      
      if (error) throw error;
      return data as CronJobHistory[];
    },
    refetchInterval: 30000 // Refresh every 30 seconds
  });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-neon-green" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-400" />;
      case 'running':
        return <Loader2 className="h-4 w-4 text-neon-yellow animate-spin" />;
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-neon-green/20 text-neon-green border-neon-green/30';
      case 'failed':
        return 'bg-red-500/20 text-red-400 border-red-500/30';
      case 'running':
        return 'bg-neon-yellow/20 text-neon-yellow border-neon-yellow/30';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  const formatDuration = (ms: number | null) => {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const formatJobName = (name: string) => {
    return name
      .replace(/-/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase());
  };

  if (isLoading) {
    return (
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            Cron Job History
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (!history || history.length === 0) {
    return (
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            Cron Job History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-4">
            No cron job executions recorded yet.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Clock className="h-4 w-4 text-primary" />
          Cron Job History
          <Badge variant="outline" className="ml-auto text-xs">
            Last {history.length} runs
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {history.map((job) => (
          <div
            key={job.id}
            className="p-3 rounded-lg bg-muted/30 border border-border/50"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {getStatusIcon(job.status)}
                <span className="font-medium text-sm">
                  {formatJobName(job.job_name)}
                </span>
              </div>
              <Badge className={getStatusBadgeClass(job.status)}>
                {job.status}
              </Badge>
            </div>
            
            <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
              <span>
                {formatDistanceToNow(new Date(job.started_at), { addSuffix: true })}
              </span>
              <div className="flex items-center gap-2">
                <Timer className="h-3 w-3" />
                <span>{formatDuration(job.duration_ms)}</span>
              </div>
            </div>

            {job.status === 'completed' && job.result && (
              <div className="mt-2 p-2 rounded bg-background/50 text-xs">
                <div className="flex flex-wrap gap-2">
                  {Object.entries(job.result).slice(0, 4).map(([key, value]) => (
                    <span key={key} className="text-muted-foreground">
                      <span className="text-foreground">{key}:</span> {String(value)}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {job.status === 'failed' && job.error_message && (
              <div className="mt-2 p-2 rounded bg-red-500/10 text-xs text-red-400">
                {job.error_message}
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
