import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle, XCircle, AlertTriangle, Activity, Timer } from "lucide-react";

interface Run {
  status: string;
  duration_ms: number | null;
}

export function CrawlerSummaryStrip({ runs }: { runs: Run[] }) {
  const total = runs.length;
  const completed = runs.filter((r) => r.status === "completed").length;
  const failed = runs.filter((r) => r.status === "failed").length;
  const noData = runs.filter((r) => r.status === "no_data").length;
  const durations = runs.map((r) => r.duration_ms ?? 0).filter((d) => d > 0);
  const avgMs = durations.length
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : 0;

  const stats = [
    { label: "Total (24h)", value: total, icon: Activity, color: "text-primary" },
    { label: "Completed", value: completed, icon: CheckCircle, color: "text-neon-green" },
    { label: "No data", value: noData, icon: AlertTriangle, color: "text-orange-400" },
    { label: "Failed", value: failed, icon: XCircle, color: "text-red-400" },
    {
      label: "Avg duration",
      value: avgMs < 1000 ? `${avgMs}ms` : `${(avgMs / 1000).toFixed(1)}s`,
      icon: Timer,
      color: "text-muted-foreground",
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {stats.map((s) => (
        <Card key={s.label} className="bg-card border-border">
          <CardContent className="p-3 flex items-center gap-3">
            <s.icon className={`h-5 w-5 ${s.color}`} />
            <div>
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-lg font-semibold">{s.value}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}