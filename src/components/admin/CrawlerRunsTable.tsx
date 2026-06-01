import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, CheckCircle, XCircle, Loader2, Clock, AlertTriangle } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import {
  extractFetchedCount,
  formatJobLabel,
  getJobCategory,
} from "@/lib/crawlerJobs";

export interface CrawlerRun {
  id: string;
  job_name: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  result: Record<string, unknown> | null;
  error_message: string | null;
  duration_ms: number | null;
}

function statusIcon(status: string) {
  switch (status) {
    case "completed":
      return <CheckCircle className="h-4 w-4 text-neon-green" />;
    case "failed":
      return <XCircle className="h-4 w-4 text-red-400" />;
    case "running":
      return <Loader2 className="h-4 w-4 text-neon-yellow animate-spin" />;
    case "no_data":
      return <AlertTriangle className="h-4 w-4 text-orange-400" />;
    default:
      return <Clock className="h-4 w-4 text-muted-foreground" />;
  }
}

function statusBadgeClass(status: string) {
  switch (status) {
    case "completed":
      return "bg-neon-green/20 text-neon-green border-neon-green/30";
    case "failed":
      return "bg-red-500/20 text-red-400 border-red-500/30";
    case "running":
      return "bg-neon-yellow/20 text-neon-yellow border-neon-yellow/30";
    case "no_data":
      return "bg-orange-500/20 text-orange-400 border-orange-500/30";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function formatDuration(ms: number | null) {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function CrawlerRunsTable({
  runs,
  emptyMessage = "No runs found.",
}: {
  runs: CrawlerRun[];
  emptyMessage?: string;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  if (runs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className="rounded-md border border-border overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8" />
            <TableHead>Job</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Last run</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Duration</TableHead>
            <TableHead>Fetched</TableHead>
            <TableHead>Note</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((r) => {
            const isOpen = !!expanded[r.id];
            const fetched = extractFetchedCount(r.result);
            const zeroRows =
              r.status === "completed" && fetched && fetched.value === 0;
            const note =
              r.status === "failed" || r.status === "no_data"
                ? r.error_message ?? ""
                : zeroRows
                  ? `0 ${fetched.key}`
                  : "";

            return (
              <>
                <TableRow key={r.id}>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() =>
                        setExpanded((e) => ({ ...e, [r.id]: !isOpen }))
                      }
                    >
                      {isOpen ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </Button>
                  </TableCell>
                  <TableCell className="font-medium text-sm">
                    {formatJobLabel(r.job_name)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      {getJobCategory(r.job_name)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <div>
                      {formatDistanceToNow(new Date(r.started_at), {
                        addSuffix: true,
                      })}
                    </div>
                    <div className="text-[10px] opacity-70">
                      {format(new Date(r.started_at), "MMM d, HH:mm:ss")}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge className={`${statusBadgeClass(r.status)} gap-1`}>
                      {statusIcon(r.status)}
                      {r.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">
                    {formatDuration(r.duration_ms)}
                  </TableCell>
                  <TableCell className="text-xs">
                    {fetched ? (
                      <span
                        className={
                          zeroRows ? "text-orange-400" : "text-foreground"
                        }
                      >
                        {fetched.value.toLocaleString()}{" "}
                        <span className="text-muted-foreground">
                          {fetched.key}
                        </span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs max-w-[280px] truncate">
                    {note ? (
                      <span
                        className={
                          r.status === "failed"
                            ? "text-red-400"
                            : "text-orange-400"
                        }
                        title={note}
                      >
                        {note}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
                {isOpen && (
                  <TableRow key={`${r.id}-detail`}>
                    <TableCell colSpan={8} className="bg-muted/20">
                      <div className="grid md:grid-cols-2 gap-4 p-2 text-xs">
                        <div>
                          <p className="font-semibold mb-1 text-foreground">
                            Result
                          </p>
                          <pre className="bg-background/50 p-2 rounded overflow-x-auto max-h-64">
                            {r.result
                              ? JSON.stringify(r.result, null, 2)
                              : "—"}
                          </pre>
                        </div>
                        <div>
                          <p className="font-semibold mb-1 text-foreground">
                            Error / Notes
                          </p>
                          <pre className="bg-background/50 p-2 rounded overflow-x-auto max-h-64 whitespace-pre-wrap">
                            {r.error_message || "—"}
                          </pre>
                          <p className="mt-2 text-muted-foreground">
                            Started:{" "}
                            {format(new Date(r.started_at), "PPpp")}
                          </p>
                          {r.completed_at && (
                            <p className="text-muted-foreground">
                              Completed:{" "}
                              {format(new Date(r.completed_at), "PPpp")}
                            </p>
                          )}
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}