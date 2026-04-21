// @ts-nocheck
// Phase 7 — Analytics tab: KPIs, daily views chart, hook leaderboard, A/B results.
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { RefreshCw, Loader2, Trophy, Eye, Activity, Crown, Sparkles } from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend, BarChart, Bar,
} from "recharts";

function startOf(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function dayKey(d: Date) { return d.toISOString().slice(0, 10); }

export default function AnalyticsTab({ accounts }: { accounts: any[] }) {
  const [posts, setPosts] = useState<any[]>([]);
  const [hooks, setHooks] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [resolving, setResolving] = useState(false);

  async function load() {
    setLoading(true);
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const [p, h, l] = await Promise.all([
      supabase.from("tiktok_posts").select("*").gte("posted_at", since).order("posted_at", { ascending: false }),
      supabase.from("tiktok_hook_performance").select("*").order("avg_completion_rate", { ascending: false }),
      supabase.from("tiktok_pipeline_logs").select("*").eq("run_type", "ab_resolved").order("created_at", { ascending: false }).limit(30),
    ]);
    setPosts(p.data || []);
    setHooks(h.data || []);
    setLogs(l.data || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function runSync() {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("tiktok-metrics-sync", { body: {} });
      if (error) throw error;
      toast.success(`Synced ${data?.synced || 0} posts • ${data?.hooks_updated || 0} hooks updated`);
      await load();
    } catch (e: any) { toast.error(`Sync failed: ${e.message}`); }
    finally { setSyncing(false); }
  }

  async function runResolver() {
    setResolving(true);
    try {
      const { data, error } = await supabase.functions.invoke("tiktok-ab-resolver", { body: {} });
      if (error) throw error;
      toast.success(`Resolved ${data?.resolved || 0} of ${data?.checked || 0} A/B groups`);
      await load();
    } catch (e: any) { toast.error(`Resolver failed: ${e.message}`); }
    finally { setResolving(false); }
  }

  const accountById = useMemo(() => {
    const m = new Map<string, any>();
    for (const a of accounts) m.set(a.id, a);
    return m;
  }, [accounts]);

  const kpis = useMemo(() => {
    const now = Date.now();
    const last7 = posts.filter(p => p.posted_at && now - new Date(p.posted_at).getTime() <= 7 * 86400000);
    const last30 = posts;
    const sum = (arr: any[], k: string) => arr.reduce((s, x) => s + (Number(x[k]) || 0), 0);
    const avg = (arr: any[], k: string) => {
      const vals = arr.map(x => Number(x[k])).filter(v => !isNaN(v) && v > 0);
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    };

    // Top persona by total views
    const byPersona = new Map<string, number>();
    for (const p of last30) {
      const id = p.account_id;
      byPersona.set(id, (byPersona.get(id) || 0) + (Number(p.latest_views) || 0));
    }
    const topPersonaId = [...byPersona.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const topPersona = topPersonaId ? accountById.get(topPersonaId) : null;

    // Top hook by avg completion (sample size ≥ 2)
    const topHook = [...hooks].filter(h => (h.impressions || 0) >= 2)
      .sort((a, b) => Number(b.avg_completion_rate || 0) - Number(a.avg_completion_rate || 0))[0];

    return {
      views7: sum(last7, "latest_views"),
      views30: sum(last30, "latest_views"),
      avgCompletion: avg(last30, "completion_rate"),
      avgViral: avg(last30, "viral_score"),
      topPersona,
      topPersonaViews: topPersonaId ? byPersona.get(topPersonaId) : 0,
      topHook,
      postCount30: last30.length,
    };
  }, [posts, hooks, accountById]);

  // Daily views, stacked by persona
  const dailyData = useMemo(() => {
    const days: Record<string, Record<string, number>> = {};
    const now = startOf(new Date());
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      days[dayKey(d)] = {};
    }
    for (const p of posts) {
      if (!p.posted_at) continue;
      const k = dayKey(new Date(p.posted_at));
      if (!(k in days)) continue;
      const persona = accountById.get(p.account_id)?.persona_key || "unknown";
      days[k][persona] = (days[k][persona] || 0) + (Number(p.latest_views) || 0);
    }
    return Object.entries(days).map(([day, vals]) => ({ day: day.slice(5), ...vals }));
  }, [posts, accountById]);

  const personaKeys = useMemo(() => {
    const s = new Set<string>();
    for (const a of accounts) s.add(a.persona_key);
    return [...s];
  }, [accounts]);

  const palette = ["hsl(var(--primary))", "hsl(var(--chart-2,200_70%_50%))", "hsl(var(--chart-3,30_70%_50%))", "hsl(var(--chart-4,280_70%_50%))"];

  // A/B leaderboard from logs
  const abRows = useMemo(() => logs.map(l => {
    const m = (l.metadata as any) || {};
    const winnerAcc = accountById.get(m.winner_account_id);
    return {
      id: l.id,
      created_at: l.created_at,
      group_id: m.ab_group_id,
      winner_persona: winnerAcc?.persona_key || "—",
      winner_score: m.winner_viral_score,
      loser_scores: (m.loser_viral_scores || []).join(", "),
    };
  }), [logs, accountById]);

  if (loading) return <div className="py-12 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button size="sm" variant="outline" onClick={runResolver} disabled={resolving}>
          {resolving ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Trophy className="w-3 h-3 mr-1" />}
          Resolve A/B
        </Button>
        <Button size="sm" onClick={runSync} disabled={syncing}>
          {syncing ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}
          Sync metrics
        </Button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="py-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Eye className="w-3 h-3" /> 7-DAY VIEWS</div>
          <div className="text-2xl font-bold mt-1">{kpis.views7.toLocaleString()}</div>
        </CardContent></Card>
        <Card><CardContent className="py-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Eye className="w-3 h-3" /> 30-DAY VIEWS</div>
          <div className="text-2xl font-bold mt-1">{kpis.views30.toLocaleString()}</div>
          <div className="text-xs text-muted-foreground">{kpis.postCount30} posts</div>
        </CardContent></Card>
        <Card><CardContent className="py-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Activity className="w-3 h-3" /> AVG COMPLETION</div>
          <div className="text-2xl font-bold mt-1">{(kpis.avgCompletion * 100).toFixed(1)}%</div>
          <div className="text-xs text-muted-foreground">viral: {kpis.avgViral.toFixed(1)}</div>
        </CardContent></Card>
        <Card><CardContent className="py-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Crown className="w-3 h-3" /> TOP PERSONA</div>
          <div className="text-base font-bold mt-1">{kpis.topPersona?.persona_key || "—"}</div>
          <div className="text-xs text-muted-foreground">{(kpis.topPersonaViews || 0).toLocaleString()} views</div>
        </CardContent></Card>
      </div>

      {kpis.topHook && (
        <Card>
          <CardContent className="py-3 flex items-start gap-3">
            <Sparkles className="w-4 h-4 text-primary mt-0.5" />
            <div className="text-sm">
              <span className="font-semibold">Top hook:</span>{" "}
              <span className="italic">"{kpis.topHook.text}"</span>{" "}
              <Badge variant="secondary" className="ml-1">
                {((Number(kpis.topHook.avg_completion_rate) || 0) * 100).toFixed(0)}% completion
              </Badge>
              <span className="text-xs text-muted-foreground ml-2">n={kpis.topHook.impressions}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Daily views chart */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Views per day (last 14 days)</CardTitle></CardHeader>
        <CardContent>
          <div style={{ width: "100%", height: 260 }}>
            <ResponsiveContainer>
              <BarChart data={dailyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))" }}
                />
                <Legend />
                {personaKeys.map((k, i) => (
                  <Bar key={k} dataKey={k} stackId="views" fill={palette[i % palette.length]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Hook leaderboard */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Hook leaderboard</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Hook</TableHead><TableHead>Style</TableHead><TableHead>Template</TableHead>
              <TableHead className="text-right">Completion</TableHead>
              <TableHead className="text-right">Avg views</TableHead>
              <TableHead className="text-right">N</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {hooks.slice(0, 20).map(h => (
                <TableRow key={h.id}>
                  <TableCell className="text-xs italic max-w-md truncate">"{h.text}"</TableCell>
                  <TableCell><Badge variant="outline">{h.style}</Badge></TableCell>
                  <TableCell><Badge variant="outline">{h.template}</Badge></TableCell>
                  <TableCell className="text-right tabular-nums">
                    {h.avg_completion_rate != null ? `${(Number(h.avg_completion_rate) * 100).toFixed(0)}%` : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{Number(h.avg_views || 0).toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums">{h.impressions || 0}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* A/B results */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">A/B test results</CardTitle></CardHeader>
        <CardContent className="p-0">
          {abRows.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No resolved A/B tests yet. Run a test from the Publish tab.
            </div>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>When</TableHead><TableHead>Group</TableHead>
                <TableHead>Winner</TableHead>
                <TableHead className="text-right">Winner score</TableHead>
                <TableHead className="text-right">Loser scores</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {abRows.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs">{new Date(r.created_at).toLocaleDateString()}</TableCell>
                    <TableCell className="text-xs font-mono">{(r.group_id || "").slice(0, 8)}</TableCell>
                    <TableCell><Badge>{r.winner_persona}</Badge></TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{Number(r.winner_score || 0).toFixed(1)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{r.loser_scores}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
