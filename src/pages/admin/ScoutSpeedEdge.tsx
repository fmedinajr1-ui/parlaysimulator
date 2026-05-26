import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAdminRole } from "@/hooks/useAdminRole";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Zap, Activity, Brain } from "lucide-react";
import { MobileHeader } from "@/components/layout/MobileHeader";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

type LagEdge = {
  id: string;
  game_id: string;
  player_name: string | null;
  edge_type: string;
  market_delay_seconds: number | null;
  excess_lag_seconds: number | null;
  confidence: number | null;
  expected_move: number | null;
  model_edge: number | null;
  stake_units: number | null;
  status: string;
  expires_at: string | null;
  fired_at: string | null;
  actual_move: number | null;
  outcome: string | null;
  created_at: string;
};

const LABELS: Record<string, string> = {
  player_ast: "Assists",
  player_pra: "Points+Reb+Ast",
  player_pts: "Points",
  player_reb: "Rebounds",
  live_spread: "Live Spread",
  live_total: "Live Total",
  team_score: "Team Score",
};

function evColor(ev: number | null): string {
  if (ev == null) return "bg-muted text-muted-foreground";
  if (ev >= 0.10) return "bg-red-500/15 text-red-400 border-red-500/30";
  if (ev >= 0.06) return "bg-orange-500/15 text-orange-400 border-orange-500/30";
  return "bg-muted text-muted-foreground";
}

function outcomeColor(o: string | null): string {
  if (o === "won") return "bg-emerald-500/15 text-emerald-400";
  if (o === "lost") return "bg-red-500/15 text-red-400";
  if (o === "void") return "bg-muted text-muted-foreground";
  return "bg-muted text-muted-foreground";
}

function useCountdown(target: string | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  if (!target) return "—";
  const s = Math.max(0, Math.floor((Date.parse(target) - now) / 1000));
  return `${s}s`;
}

function CountdownCell({ expiresAt }: { expiresAt: string | null }) {
  const text = useCountdown(expiresAt);
  return <span className="font-mono text-xs">{text}</span>;
}

export default function ScoutSpeedEdge() {
  const { isAdmin, isLoading: roleLoading } = useAdminRole();
  const [active, setActive] = useState<LagEdge[]>([]);
  const [recent, setRecent] = useState<LagEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const [model, setModel] = useState<any>(null);
  const [training, setTraining] = useState(false);

  async function load() {
    try {
      const [a, r, m] = await Promise.all([
        supabase
          .from("lag_edges")
          .select("*")
          .eq("status", "active")
          .gt("expires_at", new Date().toISOString())
          .order("model_edge", { ascending: false })
          .limit(100),
        supabase
          .from("lag_edges")
          .select("*")
          .not("fired_at", "is", null)
          .order("fired_at", { ascending: false })
          .limit(30),
        supabase
          .from("scout_speed_models")
          .select("version, n_samples, log_loss, brier, mse_move, active, fit_at")
          .order("fit_at", { ascending: false })
          .limit(5),
      ]);
      if (!a.error) setActive((a.data as LagEdge[]) ?? []);
      if (!r.error) setRecent((r.data as LagEdge[]) ?? []);
      if (!m.error) setModel(m.data ?? []);
    } catch (e) {
      console.error("[ScoutSpeedEdge] load failed", e);
    } finally {
      setLoading(false);
    }
  }

  async function runTrainer(opts: { activate_latest?: boolean } = {}) {
    setTraining(true);
    try {
      const { data, error } = await supabase.functions.invoke("scout-speed-model-trainer", { body: opts });
      if (error) throw error;
      if (data?.skipped === "insufficient_data") {
        toast({ title: "Not enough data yet", description: `${data.n}/${data.min_samples} resolved edges. ${data.message}` });
      } else if (data?.ok) {
        toast({ title: opts.activate_latest ? "Model activated" : "Model trained", description: `v${data.version ?? "—"} · n=${data.n ?? "—"} · log-loss=${data.log_loss?.toFixed?.(3) ?? "—"}` });
        load();
      } else {
        toast({ title: "Trainer error", description: data?.error ?? "unknown", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Trainer failed", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setTraining(false);
    }
  }

  useEffect(() => {
    if (!isAdmin) return;
    load();
    const interval = setInterval(load, 5000);
    const channel = supabase
      .channel("scout-speed-edges")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "lag_edges" },
        () => load(),
      )
      .subscribe();
    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [isAdmin]);

  if (roleLoading) return null;
  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-background p-6">
        <p className="text-muted-foreground">Admins only.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-12">
      <MobileHeader
        title="Scout Speed Edge"
        subtitle="Lag-hunter edge terminal (Phase 0)"
        showBack
        backTo="/admin"
        showLogo={false}
        icon={<Zap className="w-5 h-5 text-primary" />}
      />
      <main className="container mx-auto px-4 py-6 space-y-6">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Brain className="w-4 h-4 text-primary" />
              Learned model (Phase 1)
            </CardTitle>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={training} onClick={() => runTrainer()}>Train now</Button>
              <Button size="sm" variant="default" disabled={training} onClick={() => runTrainer({ activate_latest: true })}>Activate latest</Button>
            </div>
          </CardHeader>
          <CardContent>
            {!model || (Array.isArray(model) && model.length === 0) ? (
              <p className="text-sm text-muted-foreground">
                No models trained yet. Engine is using the Phase-0 heuristic. Click <em>Train now</em> once
                ≥200 resolved edges have accumulated in <code className="text-xs">lag_edges</code>.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Version</TableHead>
                    <TableHead className="text-right">Samples</TableHead>
                    <TableHead className="text-right">Log-loss</TableHead>
                    <TableHead className="text-right">Brier</TableHead>
                    <TableHead className="text-right">MSE (move)</TableHead>
                    <TableHead>Fit at</TableHead>
                    <TableHead className="text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(model as any[]).map((m) => (
                    <TableRow key={m.version}>
                      <TableCell className="font-mono">v{m.version}</TableCell>
                      <TableCell className="text-right">{m.n_samples}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{m.log_loss != null ? Number(m.log_loss).toFixed(3) : "—"}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{m.brier != null ? Number(m.brier).toFixed(3) : "—"}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{m.mse_move != null ? Number(m.mse_move).toFixed(3) : "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{new Date(m.fit_at).toLocaleString()}</TableCell>
                      <TableCell className="text-right">
                        {m.active ? (
                          <Badge className="bg-emerald-500/15 text-emerald-400">active</Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">inactive</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-primary" />
                Active edges
              </CardTitle>
            </div>
            <Badge variant="outline">{active.length}</Badge>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : active.length === 0 ? (
              <p className="text-sm text-muted-foreground">No active edges. Waiting for live events…</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Player</TableHead>
                    <TableHead>Market</TableHead>
                    <TableHead className="text-right">Confidence</TableHead>
                    <TableHead className="text-right">EV</TableHead>
                    <TableHead className="text-right">Lag (s)</TableHead>
                    <TableHead className="text-right">Stake</TableHead>
                    <TableHead className="text-right">Window</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {active.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="font-medium">{e.player_name ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {LABELS[e.edge_type] ?? e.edge_type}
                      </TableCell>
                      <TableCell className="text-right">
                        {e.confidence != null ? `${(e.confidence * 100).toFixed(0)}%` : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant="outline" className={evColor(e.model_edge)}>
                          {e.model_edge != null ? `${(e.model_edge * 100).toFixed(1)}%` : "—"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {e.market_delay_seconds != null ? Number(e.market_delay_seconds).toFixed(1) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {e.stake_units != null ? `${(e.stake_units * 100).toFixed(1)}%` : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <CountdownCell expiresAt={e.expires_at} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recently fired</CardTitle>
          </CardHeader>
          <CardContent>
            {recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">No fired alerts yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Player</TableHead>
                    <TableHead>Market</TableHead>
                    <TableHead className="text-right">EV</TableHead>
                    <TableHead className="text-right">Actual move</TableHead>
                    <TableHead className="text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recent.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell>{e.player_name ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {LABELS[e.edge_type] ?? e.edge_type}
                      </TableCell>
                      <TableCell className="text-right">
                        {e.model_edge != null ? `${(e.model_edge * 100).toFixed(1)}%` : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {e.actual_move != null ? Number(e.actual_move).toFixed(2) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant="outline" className={outcomeColor(e.outcome ?? e.status)}>
                          {e.outcome ?? e.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}