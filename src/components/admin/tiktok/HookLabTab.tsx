// @ts-nocheck
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Loader2, Sparkles, TrendingUp, RefreshCw, Wand2, Trophy } from "lucide-react";

interface HookRow {
  id: string;
  text: string;
  style: string;
  template: string;
  impressions: number;
  avg_completion_rate: number;
  avg_views: number;
  uses_count: number;
  is_winning_hook: boolean;
  active: boolean;
  origin: string;
  notes?: string;
}

interface PostRow {
  id: string;
  account_id: string;
  hook_id: string | null;
  manual_post_url?: string | null;
  tiktok_url?: string | null;
  posted_manually_at?: string | null;
  posted_at?: string | null;
  latest_views: number;
  latest_completion_rate: number | null;
  viral_score: number;
}

interface AccountRow { id: string; display_name: string; persona_key: string }

interface Props {
  hooks: HookRow[];
  posts: PostRow[];
  accounts: AccountRow[];
  onReload: () => Promise<void> | void;
}

export default function HookLabTab({ hooks, posts, accounts, onReload }: Props) {
  const [processing, setProcessing] = useState(false);
  const [variantBusy, setVariantBusy] = useState<string | null>(null);
  const [pasteUrl, setPasteUrl] = useState("");
  const [views, setViews] = useState("");
  const [watchSec, setWatchSec] = useState("");
  const [likes, setLikes] = useState("");
  const [comments, setComments] = useState("");
  const [shares, setShares] = useState("");
  const [savingMetric, setSavingMetric] = useState(false);

  const accountById = useMemo(() => {
    const m = new Map<string, AccountRow>();
    accounts.forEach(a => m.set(a.id, a));
    return m;
  }, [accounts]);

  const heatmap = useMemo(() => {
    const styles = ["data_nerd", "streetwise", "confident_calm"];
    const templates = ["pick_reveal", "results_recap", "data_insight"];
    const grid: Record<string, Record<string, { compl: number; uses: number; n: number }>> = {};
    styles.forEach(s => {
      grid[s] = {};
      templates.forEach(t => { grid[s][t] = { compl: 0, uses: 0, n: 0 }; });
    });
    hooks.forEach(h => {
      if (!grid[h.style] || !grid[h.style][h.template]) return;
      const cell = grid[h.style][h.template];
      cell.compl += Number(h.avg_completion_rate || 0);
      cell.uses += h.uses_count || 0;
      cell.n += 1;
    });
    return { styles, templates, grid };
  }, [hooks]);

  const topHooks = useMemo(
    () => [...hooks]
      .filter(h => h.uses_count >= 1)
      .sort((a, b) => Number(b.avg_completion_rate || 0) - Number(a.avg_completion_rate || 0))
      .slice(0, 5),
    [hooks],
  );

  const recentPostedPosts = useMemo(
    () => posts
      .filter(p => p.posted_manually_at || p.posted_at)
      .sort((a, b) => {
        const ta = new Date(a.posted_manually_at || a.posted_at || 0).getTime();
        const tb = new Date(b.posted_manually_at || b.posted_at || 0).getTime();
        return tb - ta;
      })
      .slice(0, 25),
    [posts],
  );

  async function runProcessor() {
    setProcessing(true);
    try {
      const { data, error } = await supabase.functions.invoke("tiktok-metrics-processor", { body: {} });
      if (error) throw error;
      toast.success(`Processed ${data?.posts || 0} posts • ${data?.promoted || 0} promoted • ${data?.demoted || 0} demoted`);
      await onReload();
    } catch (e: any) {
      toast.error(`Processor failed: ${e.message}`);
    } finally {
      setProcessing(false);
    }
  }

  async function generateVariants(hookId: string) {
    setVariantBusy(hookId);
    try {
      const { data, error } = await supabase.functions.invoke("tiktok-hook-variants", { body: { hook_id: hookId } });
      if (error) throw error;
      toast.success(`Added ${data?.count || 0} variants to hook library`);
      await onReload();
    } catch (e: any) {
      toast.error(`Variants failed: ${e.message}`);
    } finally {
      setVariantBusy(null);
    }
  }

  async function saveMetric() {
    if (!pasteUrl.trim()) {
      toast.error("Paste a TikTok post URL");
      return;
    }
    const cleanUrl = pasteUrl.trim();
    const post = posts.find(p =>
      (p.manual_post_url && p.manual_post_url.trim() === cleanUrl) ||
      (p.tiktok_url && p.tiktok_url.trim() === cleanUrl),
    );
    if (!post) {
      toast.error("No matching posted record found for that URL");
      return;
    }

    const viewsN = parseInt(views, 10);
    if (Number.isNaN(viewsN) || viewsN < 0) {
      toast.error("Views must be a number");
      return;
    }

    setSavingMetric(true);
    try {
      const watchN = watchSec ? parseFloat(watchSec) : null;
      const likesN = likes ? parseInt(likes, 10) : 0;
      const commentsN = comments ? parseInt(comments, 10) : 0;
      const sharesN = shares ? parseInt(shares, 10) : 0;

      // Estimate completion rate from watch_sec assuming a 30s avg target duration.
      // The script row carries the real target_duration, but for the quick-paste form
      // we keep the math simple — processor will reaggregate.
      const completionRate = watchN != null ? Math.min(1, Math.max(0, watchN / 30)) : null;

      const { error: insErr } = await supabase.from("tiktok_post_metrics").insert({
        post_id: post.id,
        views: viewsN,
        likes: likesN,
        comments: commentsN,
        shares: sharesN,
        avg_watch_time_sec: watchN,
        completion_rate: completionRate,
        source: "manual",
      });
      if (insErr) throw insErr;

      const { error: upErr } = await supabase.from("tiktok_posts").update({
        latest_views: viewsN,
        latest_likes: likesN,
        latest_comments: commentsN,
        latest_shares: sharesN,
        latest_completion_rate: completionRate,
        last_metrics_check_at: new Date().toISOString(),
        view_count_snapshot: viewsN,
      }).eq("id", post.id);
      if (upErr) throw upErr;

      toast.success("Metric saved — run processor to update hook scores");
      setPasteUrl(""); setViews(""); setWatchSec(""); setLikes(""); setComments(""); setShares("");
      await onReload();
    } catch (e: any) {
      toast.error(`Save failed: ${e.message}`);
    } finally {
      setSavingMetric(false);
    }
  }

  async function toggleHook(id: string, active: boolean) {
    const { error } = await supabase.from("tiktok_hook_performance").update({ active: !active }).eq("id", id);
    if (error) toast.error(error.message); else onReload();
  }

  return (
    <div className="space-y-4">
      {/* Quick-paste metrics */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="w-4 h-4" /> Log Performance (Quick Paste)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            placeholder="Paste TikTok post URL (must match a logged manual post)"
            value={pasteUrl}
            onChange={(e) => setPasteUrl(e.target.value)}
          />
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <Input placeholder="Views" inputMode="numeric" value={views} onChange={(e) => setViews(e.target.value)} />
            <Input placeholder="Avg watch (sec)" inputMode="decimal" value={watchSec} onChange={(e) => setWatchSec(e.target.value)} />
            <Input placeholder="Likes" inputMode="numeric" value={likes} onChange={(e) => setLikes(e.target.value)} />
            <Input placeholder="Comments" inputMode="numeric" value={comments} onChange={(e) => setComments(e.target.value)} />
            <Input placeholder="Shares" inputMode="numeric" value={shares} onChange={(e) => setShares(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <Button onClick={saveMetric} disabled={savingMetric || !pasteUrl.trim() || !views.trim()}>
              {savingMetric ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <TrendingUp className="w-4 h-4 mr-2" />}
              Save Metric
            </Button>
            <Button variant="outline" onClick={runProcessor} disabled={processing}>
              {processing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
              Run Processor
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Saves a snapshot to <code>tiktok_post_metrics</code> + updates <code>tiktok_posts.latest_*</code>. The processor recomputes hook scores and promotes/demotes.
          </p>
        </CardContent>
      </Card>

      {/* Performance heatmap */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Style × Template Heatmap (avg completion)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left p-2 text-xs text-muted-foreground uppercase">Style \\ Template</th>
                  {heatmap.templates.map(t => (
                    <th key={t} className="text-center p-2 text-xs text-muted-foreground uppercase">{t}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {heatmap.styles.map(s => (
                  <tr key={s} className="border-t">
                    <td className="p-2 font-medium">{s}</td>
                    {heatmap.templates.map(t => {
                      const cell = heatmap.grid[s][t];
                      const compl = cell.n > 0 ? cell.compl / cell.n : 0;
                      const pct = Math.round(compl * 100);
                      const tone = pct >= 55 ? "bg-primary/20 text-primary" :
                                   pct >= 40 ? "bg-secondary text-secondary-foreground" :
                                   pct > 0   ? "bg-destructive/10 text-destructive" :
                                               "bg-muted text-muted-foreground";
                      return (
                        <td key={t} className="p-2 text-center">
                          <div className={`rounded px-2 py-1 ${tone}`}>
                            <div className="font-bold">{pct}%</div>
                            <div className="text-[10px] opacity-70">{cell.n} hooks · {cell.uses} uses</div>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Top performers */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Trophy className="w-4 h-4" /> Top Performers — generate variants
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {topHooks.length === 0 && (
            <p className="text-sm text-muted-foreground">No hooks have logged uses yet. Post a few videos and run the processor.</p>
          )}
          {topHooks.map(h => (
            <div key={h.id} className="flex flex-wrap items-center justify-between gap-2 border rounded-lg p-3">
              <div className="flex-1 min-w-[240px]">
                <div className="text-sm font-medium">{h.text}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  <Badge variant="outline" className="mr-1">{h.style}</Badge>
                  <Badge variant="outline" className="mr-1">{h.template}</Badge>
                  {h.is_winning_hook && <Badge className="mr-1">WINNER</Badge>}
                  {Math.round(Number(h.avg_completion_rate) * 100)}% compl • {h.uses_count} uses • {h.avg_views.toLocaleString()} avg views
                </div>
              </div>
              <Button size="sm" onClick={() => generateVariants(h.id)} disabled={variantBusy === h.id}>
                {variantBusy === h.id ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Wand2 className="w-3 h-3 mr-1" />}
                Generate 3 variants
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Recent posts with metrics */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent Posts — Performance</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead className="text-right">Views</TableHead>
                <TableHead className="text-right">Compl%</TableHead>
                <TableHead className="text-right">Viral/hr</TableHead>
                <TableHead>Posted</TableHead>
                <TableHead>URL</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentPostedPosts.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No posted videos yet.</TableCell></TableRow>
              )}
              {recentPostedPosts.map(p => {
                const acct = accountById.get(p.account_id);
                const url = p.manual_post_url || p.tiktok_url;
                const when = p.posted_manually_at || p.posted_at;
                return (
                  <TableRow key={p.id}>
                    <TableCell className="text-sm">{acct?.display_name || "—"}</TableCell>
                    <TableCell className="text-right">{(p.latest_views || 0).toLocaleString()}</TableCell>
                    <TableCell className="text-right">{p.latest_completion_rate != null ? `${Math.round(Number(p.latest_completion_rate) * 100)}%` : "—"}</TableCell>
                    <TableCell className="text-right">{Number(p.viral_score || 0).toFixed(1)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{when ? new Date(when).toLocaleString() : "—"}</TableCell>
                    <TableCell className="text-xs">{url ? <a href={url} target="_blank" rel="noopener noreferrer" className="underline">open</a> : "—"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Hook library */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="w-4 h-4" /> Hook Library
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Hook</TableHead>
                <TableHead>Style</TableHead>
                <TableHead>Template</TableHead>
                <TableHead>Origin</TableHead>
                <TableHead className="text-right">Uses</TableHead>
                <TableHead className="text-right">Compl%</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {hooks.map(h => (
                <TableRow key={h.id} className="cursor-pointer" onClick={() => toggleHook(h.id, h.active)}>
                  <TableCell className="text-sm">
                    {h.is_winning_hook && <Badge className="mr-1">★</Badge>}
                    {h.text}
                  </TableCell>
                  <TableCell><Badge variant="outline">{h.style}</Badge></TableCell>
                  <TableCell><Badge variant="outline">{h.template}</Badge></TableCell>
                  <TableCell><Badge variant="secondary">{h.origin}</Badge></TableCell>
                  <TableCell className="text-right">{h.uses_count}</TableCell>
                  <TableCell className="text-right">{Math.round(Number(h.avg_completion_rate || 0) * 100)}%</TableCell>
                  <TableCell><Badge variant={h.active ? "default" : "secondary"}>{h.active ? "Active" : "Paused"}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}